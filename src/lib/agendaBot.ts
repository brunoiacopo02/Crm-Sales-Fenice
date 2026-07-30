// Client verso l'endpoint /api/send-agenda del fornitore bot.
// Sostituisce il canale ActiveCampaign/Spoki per l'invio dell'agenda al lead.
// Spec: docs/superpowers/specs/2026-07-29-agenda-via-bot-design.md
//
// Firma HMAC identica a quella del push (`/api/bot/intake`): stesso
// BOT_WEBHOOK_SECRET, header `x-bot-signature`, nessun segreto nuovo.

import { signPayload } from '@/lib/marketing-webhooks/signing'

const AGENDA_BOT_URL = process.env.AGENDA_BOT_URL
    ?? 'https://web-app-messaggistica.vercel.app/api/send-agenda'

// Il fornitore risponde entro ~8s: oltre, chiude lui con `inviato`. Aspettiamo
// qualche secondo in più così un loro ritardo fisiologico non diventa un nostro
// errore di rete (che il GDO leggerebbe come "fallito" pur essendo partito).
const CLIENT_TIMEOUT_MS = 12_000

/** Esito applicativo dell'invio, dal corpo della risposta (non dallo stato HTTP). */
export type AgendaEsito = 'consegnato' | 'inviato' | 'fallito'

const VALID_ESITI: readonly string[] = ['consegnato', 'inviato', 'fallito']

export type AgendaVariant = {
    lavora: boolean
    haFamiglia: boolean
    offertaDelMese: boolean
}

export type SendAgendaViaBotInput = {
    leadId: string
    phone: string           // grezzo dal DB: la normalizzazione E.164 è loro
    name?: string | null
    email?: string | null
    funnel?: string | null
    variant: AgendaVariant
}

/**
 * `ok: true` significa che il fornitore ha risposto in modo valido — NON che il
 * messaggio è arrivato. L'esito applicativo sta in `esito`, e va sempre letto:
 * `fallito` è una risposta valida a una consegna non riuscita.
 */
export type SendAgendaViaBotResult =
    | {
        ok: true
        esito: AgendaEsito
        deduplicato: boolean
        message?: string
        conversationId?: number | null
        sid?: string | null
    }
    | { ok: false; kind: 'config' | 'protocol' | 'network'; error: string }

/** Messaggi di protocollo, tradotti per chi legge i log (mai mostrati al GDO). */
function protocolError(status: number, body: string): string {
    switch (status) {
        case 400: return `corpo rifiutato dal fornitore (400): ${body.slice(0, 200)}`
        case 401: return 'firma HMAC rifiutata (401) — BOT_WEBHOOK_SECRET disallineato'
        case 403: return 'companyId rifiutato (403) — atteso "fenice"'
        case 429: return 'rate limit del fornitore (429)'
        default: return `HTTP ${status}: ${body.slice(0, 200)}`
    }
}

export async function sendAgendaViaBot(input: SendAgendaViaBotInput): Promise<SendAgendaViaBotResult> {
    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!secret) {
        console.error('[agenda-bot] BOT_WEBHOOK_SECRET non impostato')
        return { ok: false, kind: 'config', error: 'BOT_WEBHOOK_SECRET non impostato' }
    }

    const rawBody = JSON.stringify({
        leadId: input.leadId,
        phone: input.phone,
        companyId: 'fenice',
        name: input.name ?? undefined,
        email: input.email ?? undefined,
        funnel: input.funnel ?? undefined,
        variant: input.variant,
    })

    let res: Response
    try {
        res = await fetch(AGENDA_BOT_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-bot-signature': signPayload(rawBody, secret),
            },
            body: rawBody,
            signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
        })
    } catch (e) {
        console.error(`[agenda-bot] rete/timeout per lead ${input.leadId}`, e)
        return { ok: false, kind: 'network', error: String(e) }
    }

    const text = await res.text().catch(() => '')
    if (!res.ok) {
        const error = protocolError(res.status, text)
        console.error(`[agenda-bot] ${error} (lead ${input.leadId})`)
        return { ok: false, kind: 'protocol', error }
    }

    let data: any
    try {
        data = JSON.parse(text)
    } catch {
        console.error(`[agenda-bot] risposta non JSON per lead ${input.leadId}: ${text.slice(0, 200)}`)
        return { ok: false, kind: 'protocol', error: 'risposta non JSON' }
    }

    // Contratto: HTTP 200 implica un esito applicativo valido nel corpo. Se manca
    // non inventiamo un successo — meglio un errore esplicito che un falso positivo,
    // che è esattamente il difetto per cui stiamo lasciando ActiveCampaign.
    if (!VALID_ESITI.includes(data?.esito)) {
        console.error(`[agenda-bot] esito assente/ignoto per lead ${input.leadId}: ${JSON.stringify(data).slice(0, 200)}`)
        return { ok: false, kind: 'protocol', error: `esito non riconosciuto: ${data?.esito ?? 'assente'}` }
    }

    return {
        ok: true,
        esito: data.esito as AgendaEsito,
        deduplicato: data.deduplicato === true,
        message: typeof data.message === 'string' ? data.message : undefined,
        conversationId: data.conversationId ?? null,
        sid: data.sid ?? null,
    }
}
