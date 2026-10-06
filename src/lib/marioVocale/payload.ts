/**
 * Webhook dell'agenda del Mario vocale di Federico (PO 06/10/2026).
 *
 * Il Mario vocale chiama i lead della coda IA vocale (/ia-vocale) e, quando
 * fissa, il suo sito ci manda una POST. Il contratto e' il suo
 * (docs/mario/webhook-agenda.md nel suo repo, tipo PayloadAgenda): qui c'e' solo
 * la parte pura — lettura del corpo, segreto, scelta del lead — cosi' si testa
 * senza DB. Il flusso con le scritture sta in ./applica.ts.
 */
import crypto from 'node:crypto'
import { personKeyOf } from '@/lib/bot-fissatore/personKey'

export type AgendaMario = {
    idInvio: string
    tentativo: number | null
    nome: string | null
    email: string | null
    telefono: string
    /** Ultime 10 cifre: la stessa chiave persona del resto del CRM. */
    chiaveTelefono: string
    inizio: Date
    riassunto: string | null
    lavora: boolean
    figli: boolean
    richiestaId: string | null
    chiamataId: string | null
}

export type AgendaMarioReason =
    | 'bad_request'
    | 'evento_ignoto'
    | 'versione_ignota'
    | 'id_invio_mancante'
    | 'telefono_non_valido'
    | 'data_mancante'
    | 'data_senza_offset'
    | 'appuntamento_passato'

const ISO_CON_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

const testo = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null

/** "sì" e' l'unico si'. n.d., null e qualsiasi altra cosa valgono no (video standard). */
export function siNo(v: unknown): boolean {
    if (typeof v !== 'string') return false
    const s = v.trim().toLowerCase()
    return s === 'sì' || s === 'si'
}

export function parseAgendaMario(
    raw: unknown,
    adessoMs: number,
): { ok: true; value: AgendaMario } | { ok: false; reason: AgendaMarioReason } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'bad_request' }
    const o = raw as Record<string, unknown>

    if (o.evento !== 'appuntamento_fissato') return { ok: false, reason: 'evento_ignoto' }
    // "cambia solo se cambia il significato dei campi": una versione che non
    // conosciamo non si interpreta con le regole della 1.
    if (o.versione !== 1) return { ok: false, reason: 'versione_ignota' }

    const idInvio = testo(o.id_invio)
    if (!idInvio) return { ok: false, reason: 'id_invio_mancante' }

    const telefono = testo(o.telefono)
    const chiaveTelefono = personKeyOf(telefono)
    // Numeri segnaposto (0000000001, 3333333333): nel CRM esistono lead con questi
    // numeri, e un test col numero finto li ha agganciati (06/10/2026).
    if (!telefono || !chiaveTelefono || /(\d)\1{7,}/.test(chiaveTelefono)) {
        return { ok: false, reason: 'telefono_non_valido' }
    }

    const app = o.appuntamento
    const inizioRaw = app && typeof app === 'object' ? testo((app as Record<string, unknown>).inizio) : null
    if (!inizioRaw) return { ok: false, reason: 'data_mancante' }
    if (!ISO_CON_OFFSET.test(inizioRaw)) return { ok: false, reason: 'data_senza_offset' }
    const inizio = new Date(inizioRaw)
    if (Number.isNaN(inizio.getTime())) return { ok: false, reason: 'data_mancante' }
    if (inizio.getTime() <= adessoMs) return { ok: false, reason: 'appuntamento_passato' }

    return {
        ok: true,
        value: {
            idInvio,
            tentativo: typeof o.tentativo === 'number' ? o.tentativo : null,
            nome: testo(o.nome),
            email: testo(o.email),
            telefono,
            chiaveTelefono,
            inizio,
            riassunto: testo(o.riassunto),
            lavora: siNo(o.lavora),
            figli: siNo(o.figli_a_carico),
            richiestaId: testo(o.richiesta_id),
            chiamataId: testo(o.chiamata_id),
        },
    }
}

/** La nota dell'appuntamento: le Conferme e il venditore devono sapere chi l'ha fissato. */
export function notaAppuntamento(riassunto: string | null): string {
    const r = riassunto?.trim()
    return `[Mario vocale] ${r || 'appuntamento fissato al telefono'}`
}

/** X-Mario-Segreto contro MARIO_WEBHOOK_SEGRETO. Senza segreto configurato: chiuso. */
export function segretoValido(ricevuto: string | null, atteso: string | undefined): boolean {
    if (!ricevuto || !atteso) return false
    const a = Buffer.from(ricevuto)
    const b = Buffer.from(atteso)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export type CandidatoLead = { id: string; inCodaIaVocale: boolean; createdAt: Date }

/**
 * Piu' lead possono avere lo stesso numero (la stessa persona rientrata da un altro
 * funnel). Il Mario vocale chiama la coda IA vocale, quindi vince il lead che e' in
 * coda; altrimenti il piu' recente.
 */
export function sceltaLead<T extends CandidatoLead>(candidati: T[]): T | null {
    if (candidati.length === 0) return null
    const ordinati = [...candidati].sort((x, y) => {
        if (x.inCodaIaVocale !== y.inCodaIaVocale) return x.inCodaIaVocale ? -1 : 1
        return y.createdAt.getTime() - x.createdAt.getTime()
    })
    return ordinati[0]
}
