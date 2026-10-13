// Parsing della coda lead del giorno spinta dal CRM marketing
// (POST /api/marketing-leads). Funzione pura: niente DB, testabile.
//
// Due livelli di errore:
// - body malformato (company/data/leads mancanti o del tipo sbagliato) → 400,
//   il marketing deve correggere l'invio;
// - singolo lead non valido → finisce in `scartati` con il motivo, gli altri
//   passano. Una riga sporca non deve bloccare la coda di tutti.

import { normalizePhoneStrict } from '@/lib/phoneNormalize'

export const MAX_LEADS_PER_CODA = 500

export type ParsedQueueLead = {
    marketingContactId: string
    posizione: number
    name: string
    phone: string
    email: string | null
    motivoChiamata: string | null
    punteggio: number | null
    funnelOrigine: string | null
    dataIngresso: string | null
    /** Il lead così come l'ha mandato il marketing, per l'audit. */
    raw: Record<string, unknown>
}

export type Scartato = { marketing_contact_id: string; motivo: string }

export type ParseResult =
    | { ok: true; company: string; queueDate: string; leads: ParsedQueueLead[]; scartati: Scartato[] }
    | { ok: false; error: string }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' di un giorno che esiste davvero (no 2026-02-30). */
export function isIsoDay(v: unknown): v is string {
    if (typeof v !== 'string' || !ISO_DAY.test(v)) return false
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

function str(v: unknown): string | null {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t ? t : null
}

function parseLead(item: unknown): { lead: ParsedQueueLead } | { scarto: Scartato } {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { scarto: { marketing_contact_id: '', motivo: 'lead non è un oggetto' } }
    }
    const raw = item as Record<string, unknown>
    const id = str(raw.marketing_contact_id)
    if (!id) return { scarto: { marketing_contact_id: '', motivo: 'marketing_contact_id mancante' } }
    const scarta = (motivo: string) => ({ scarto: { marketing_contact_id: id, motivo } })

    const posizione = raw.posizione
    if (typeof posizione !== 'number' || !Number.isInteger(posizione) || posizione < 1) {
        return scarta('posizione mancante o non intera ≥ 1')
    }

    const phoneRaw = str(raw.telefono_e164)
    if (!phoneRaw) return scarta('telefono_e164 mancante')
    const phone = normalizePhoneStrict(phoneRaw)
    if (!phone) return scarta('telefono_e164 non valido')

    const emailRaw = str(raw.email)
    const email = emailRaw && emailRaw.includes('@') ? emailRaw.toLowerCase() : null

    const punteggio = typeof raw.punteggio === 'number' && Number.isFinite(raw.punteggio) ? raw.punteggio : null
    const dataIngresso = isIsoDay(raw.data_ingresso) ? raw.data_ingresso : null

    const name = [str(raw.nome), str(raw.cognome)].filter(Boolean).join(' ') || 'Lead senza nome'

    return {
        lead: {
            marketingContactId: id,
            posizione,
            name,
            phone,
            email,
            motivoChiamata: str(raw.motivo_chiamata),
            punteggio,
            funnelOrigine: str(raw.funnel_origine),
            dataIngresso,
            raw,
        },
    }
}

export function parseMarketingQueue(body: unknown): ParseResult {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, error: 'body deve essere un oggetto JSON' }
    }
    const b = body as Record<string, unknown>
    const company = str(b.company)
    if (!company) return { ok: false, error: 'company mancante' }
    if (!isIsoDay(b.data)) return { ok: false, error: 'data mancante o non nel formato YYYY-MM-DD' }
    if (!Array.isArray(b.leads)) return { ok: false, error: 'leads deve essere un array' }
    if (b.leads.length > MAX_LEADS_PER_CODA) {
        return { ok: false, error: `troppi lead: ${b.leads.length} (massimo ${MAX_LEADS_PER_CODA})` }
    }

    const leads: ParsedQueueLead[] = []
    const scartati: Scartato[] = []
    const visti = new Set<string>()
    for (const item of b.leads) {
        const r = parseLead(item)
        if ('scarto' in r) { scartati.push(r.scarto); continue }
        if (visti.has(r.lead.marketingContactId)) {
            scartati.push({ marketing_contact_id: r.lead.marketingContactId, motivo: 'duplicato nella stessa coda' })
            continue
        }
        visti.add(r.lead.marketingContactId)
        leads.push(r.lead)
    }
    return { ok: true, company, queueDate: b.data as string, leads, scartati }
}

export type CandidatoEsistente = {
    id: string
    marketingContactId: string | null
    phone: string
    email: string | null
    createdAt: Date
}

/**
 * Fra i lead dell'azienda che combaciano (stesso contatto marketing, stesso
 * telefono o stessa email) sceglie quello da riusare: prima chi è già legato a
 * questo contatto marketing, poi per telefono, poi per email; a parità il più
 * recente. Null = nessuno, il lead va creato.
 */
export function scegliLeadEsistente<T extends CandidatoEsistente>(
    cerca: { marketingContactId: string; phone: string; email: string | null },
    candidati: T[],
): T | null {
    const rango = (c: T): number => {
        if (c.marketingContactId === cerca.marketingContactId) return 0
        if (c.phone === cerca.phone) return 1
        if (cerca.email && c.email && c.email.toLowerCase() === cerca.email) return 2
        return 9
    }
    const validi = candidati.filter(c => rango(c) < 9)
    validi.sort((a, b) => rango(a) - rango(b) || b.createdAt.getTime() - a.createdAt.getTime())
    return validi[0] ?? null
}
