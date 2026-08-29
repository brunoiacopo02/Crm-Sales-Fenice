// Client verso l'endpoint /api/send-agenda del fornitore bot.
// Sostituisce il canale ActiveCampaign/Spoki per l'invio dell'agenda al lead.
// Spec: docs/superpowers/specs/2026-07-29-agenda-via-bot-design.md
//
// Firma HMAC identica a quella del push (`/api/bot/intake`): stesso
// BOT_WEBHOOK_SECRET, header `x-bot-signature`, nessun segreto nuovo.

import { signPayload } from '@/lib/marketing-webhooks/signing'
import { formatRomeAppointmentLabel, toRomeIso } from '@/lib/dateUtils'

const AGENDA_BOT_URL = process.env.AGENDA_BOT_URL
    ?? 'https://web-app-messaggistica.vercel.app/api/send-agenda'

const APPOINTMENT_BOT_URL = process.env.APPOINTMENT_BOT_URL
    ?? 'https://web-app-messaggistica.vercel.app/api/appointment-set'

const CALL_ATTEMPT_BOT_URL = process.env.CALL_ATTEMPT_BOT_URL
    ?? 'https://web-app-messaggistica.vercel.app/api/bot/call-attempt'

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
    /**
     * Data/ora dell'appuntamento, se già nota. Quasi sempre NON lo è: il GDO
     * manda l'agenda mentre è al telefono e registra l'esito ~1 minuto dopo
     * (97% dei casi su 4 giorni di dati). Per quel 97% la data arriva al bot
     * con la notifica separata di `notifyAppointmentToBot`; qui copriamo i
     * rifissaggi, dove l'appuntamento esiste già quando l'agenda riparte.
     */
    appointmentAt?: Date | null
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
        /** Il fornitore ha aggiornato il video che partirà alla risposta del lead. */
        varianteAggiornata: boolean
        /**
         * Il lead aveva già risposto e il video SBAGLIATO è già partito: la
         * correzione non è più recuperabile via software. Va detto al GDO, che
         * è l'unico che può rimediare parlandone col lead.
         */
        videoGiaInviato: boolean
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
        appointmentAt: input.appointmentAt ? toRomeIso(input.appointmentAt) : undefined,
        appointmentLabel: input.appointmentAt ? formatRomeAppointmentLabel(input.appointmentAt) : undefined,
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
        varianteAggiornata: data.varianteAggiornata === true,
        videoGiaInviato: data.videoGiaInviato === true,
        message: typeof data.message === 'string' ? data.message : undefined,
        conversationId: data.conversationId ?? null,
        sid: data.sid ?? null,
    }
}

/** Perché stiamo comunicando l'appuntamento: primo fissaggio o spostamento. */
export type AppointmentTrigger = 'fissato' | 'spostato'

export type NotifyAppointmentInput = {
    lead: {
        id: string
        phone: string | null
        name?: string | null
        funnel?: string | null
        companyId: string
    }
    appointmentAt: Date | null
    trigger: AppointmentTrigger
}

/**
 * Comunica al bot data e ora dell'appuntamento del lead.
 *
 * Serve perché il payload di `/api/send-agenda` non può portarle: quando il GDO
 * invia l'agenda l'appuntamento non è ancora stato registrato (97% dei casi).
 * Questa è quindi una seconda chiamata, fatta nel momento in cui la data esiste
 * davvero — e ripetuta a ogni spostamento, altrimenti il bot resterebbe con la
 * data vecchia e la direbbe sbagliata al lead.
 *
 * Non lancia MAI: un fornitore giù non deve impedire a un GDO di esitare il
 * lead. In caso di errore resta solo la riga di log — nessuna scrittura sul
 * lead, quindi nessun dato del CRM può divergere per colpa di questa chiamata.
 */
export async function notifyAppointmentToBot(input: NotifyAppointmentInput): Promise<void> {
    const { lead, appointmentAt, trigger } = input

    // Stesso interruttore del canale agenda: se siamo tornati ad ActiveCampaign
    // il bot non ha una conversazione aperta con questi lead, e la notifica non
    // avrebbe destinatario. Togliere AGENDA_CHANNEL spegne tutto insieme.
    if (process.env.AGENDA_CHANNEL !== 'bot') return
    // Serenamente ha il suo canale (Twilio diretto), qui non c'entra.
    if (lead.companyId !== 'fenice') return
    if (!appointmentAt || !lead.phone) return

    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!secret) {
        console.error('[agenda-bot] BOT_WEBHOOK_SECRET non impostato — appuntamento non notificato')
        return
    }

    const rawBody = JSON.stringify({
        leadId: lead.id,
        phone: lead.phone,
        companyId: 'fenice',
        name: lead.name ?? undefined,
        funnel: lead.funnel ?? undefined,
        appointmentAt: toRomeIso(appointmentAt),
        appointmentLabel: formatRomeAppointmentLabel(appointmentAt),
        trigger,
    })

    try {
        const res = await fetch(APPOINTMENT_BOT_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-bot-signature': signPayload(rawBody, secret),
            },
            body: rawBody,
            // Più stretto dei 12s dell'agenda: qui siamo dentro l'esito del GDO,
            // che non deve restare appeso ad aspettare il fornitore.
            signal: AbortSignal.timeout(6_000),
        })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            console.error(`[agenda-bot] appuntamento non accettato (lead ${lead.id}): ${protocolError(res.status, body)}`)
        }
    } catch (e) {
        console.error(`[agenda-bot] rete/timeout su appuntamento per lead ${lead.id}`, e)
    }
}

export type NotifyCallAttemptInput = {
    leadId: string
    companyId: string
    /** 1 o 3: il fornitore non ha un messaggio per il secondo tentativo. */
    tentativo: 1 | 3
    /** Istante del mancato contatto: il messaggio funziona finché il lead ha la chiamata persa sul telefono. */
    at: Date
    /** Data e ora della call. Senza, il messaggio diventa generico e recupera molto meno. */
    appointmentAt: Date | null
}

/**
 * Esito applicativo dal corpo della risposta. Il fornitore risponde SEMPRE 200,
 * anche quando non scrive al lead: `inviato: false` con il `motivo` è una
 * risposta valida, non un errore.
 */
export type CallAttemptOutcome = {
    inviato: boolean
    ramo?: string
    motivo?: string
}

/**
 * Comunica al bot che la Conferma ha provato a chiamare il lead senza risposta,
 * così lui glielo scrive nella chat WhatsApp che ha già aperta.
 *
 * Lo scarto per "3 NR consecutivi" vale il 42% degli appuntamenti fissati dal
 * bot e il 44% di quelli fissati dai GDO: ~1.288 appuntamenti persi dal 24
 * giugno. È il collo di bottiglia più grande che abbiamo.
 *
 * NON filtriamo qui: il fornitore ha sette guardie sue (lead non suo, bot fermato
 * a mano, disdetta già chiesta, chat passata a una persona, lead che ha già
 * risposto, appuntamento passato, tentativo già scritto) e dice esplicitamente
 * "chiamateci pure sempre, filtriamo noi". Duplicarle qui significherebbe due
 * copie della stessa regola che divergono al primo cambio da parte loro.
 *
 * Non lancia MAI: un fornitore giù non deve impedire a una Conferma di
 * registrare il mancato contatto.
 */
export async function notifyCallAttemptToBot(input: NotifyCallAttemptInput): Promise<CallAttemptOutcome> {
    // Interruttore dedicato, NON AGENDA_CHANNEL: il recupero serve anche sugli
    // appuntamenti fissati dai GDO, che hanno una chat aperta col bot solo
    // perché l'agenda passa da lì. Vanno potuti spegnere separatamente.
    if (process.env.BOT_CALL_ATTEMPT === 'off') {
        return { inviato: false, motivo: 'kill_switch_off' }
    }
    // Serenamente ha il suo canale Twilio diretto, qui non c'entra.
    if (input.companyId !== 'fenice') {
        return { inviato: false, motivo: 'company_non_fenice' }
    }

    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!secret) {
        console.error('[call-attempt] BOT_WEBHOOK_SECRET non impostato')
        return { inviato: false, motivo: 'missing_secret' }
    }

    const rawBody = JSON.stringify({
        leadId: input.leadId,
        esito: 'no_answer',
        tentativo: input.tentativo,
        at: toRomeIso(input.at),
        appointmentAt: input.appointmentAt ? toRomeIso(input.appointmentAt) : undefined,
    })

    try {
        const res = await fetch(CALL_ATTEMPT_BOT_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-bot-signature': signPayload(rawBody, secret),
            },
            body: rawBody,
            signal: AbortSignal.timeout(8_000),
        })
        const text = await res.text().catch(() => '')
        if (!res.ok) {
            const error = protocolError(res.status, text)
            console.error(`[call-attempt] ${error} (lead ${input.leadId}, tentativo ${input.tentativo})`)
            return { inviato: false, motivo: error }
        }
        let data: any
        try {
            data = JSON.parse(text)
        } catch {
            return { inviato: false, motivo: 'risposta non JSON' }
        }
        return {
            inviato: data?.inviato === true,
            ramo: typeof data?.ramo === 'string' ? data.ramo : undefined,
            motivo: typeof data?.motivo === 'string' ? data.motivo : undefined,
        }
    } catch (e) {
        console.error(`[call-attempt] rete/timeout per lead ${input.leadId}`, e)
        return { inviato: false, motivo: `rete: ${String(e).slice(0, 120)}` }
    }
}
