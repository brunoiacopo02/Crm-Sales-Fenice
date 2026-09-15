/**
 * Validazione del corpo che il bot (B4) manda alle route del lancio.
 *
 * `info` e `note` viaggiano identici su `/book` e su `/call-now`: stanno qui e
 * non nella route perché due copie della stessa validazione divergono al primo
 * ritocco, e il confine di scrittura su `leads.lancioBotInfo` (jsonb, poi
 * renderizzato dalla pagina /lancio) dev'essere uno solo.
 */
import type { LancioBotInfo } from './config'

/** Quanto del racconto del bot accettiamo di scrivere su `leads.lancioBotInfo`. */
export const MAX_RISPOSTE = 6
export const MAX_RISPOSTA_CHARS = 300
export const MAX_NOTE_CHARS = 1000

/**
 * `info` arriva da una chat: senza confine finirebbe in `lancioBotInfo` (jsonb)
 * qualunque cosa, di qualunque dimensione, e la pagina /lancio la renderizza.
 * Si tiene SOLO `risposte: string[]`, ripulita e limitata; le chiavi in più si
 * ignorano. Un tipo sbagliato non si salva a metà: 400, il bot è nostro e il
 * suo contratto lo correggiamo noi.
 */
export function parseInfo(raw: unknown): { ok: true; info?: LancioBotInfo } | { ok: false; detail: string } {
    if (raw === undefined || raw === null) return { ok: true }
    if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, detail: 'info deve essere un oggetto' }
    const risposte = (raw as Record<string, unknown>).risposte
    if (risposte === undefined || risposte === null) return { ok: true }
    if (!Array.isArray(risposte)) return { ok: false, detail: 'info.risposte deve essere un array di stringhe' }
    if (!risposte.every(r => typeof r === 'string')) return { ok: false, detail: 'info.risposte deve contenere solo stringhe' }
    const pulite = (risposte as string[])
        .map(r => r.trim().slice(0, MAX_RISPOSTA_CHARS))
        .filter(r => r.length > 0)
        .slice(0, MAX_RISPOSTE)
    return { ok: true, info: { risposte: pulite } }
}

/** `note` finisce in `appointmentNote`: stringa, e non un romanzo. */
export function parseNote(raw: unknown): { ok: true; note?: string } | { ok: false; detail: string } {
    if (raw === undefined || raw === null) return { ok: true }
    if (typeof raw !== 'string') return { ok: false, detail: 'note deve essere una stringa' }
    if (raw.length > MAX_NOTE_CHARS) return { ok: false, detail: `note oltre ${MAX_NOTE_CHARS} caratteri` }
    return { ok: true, note: raw }
}
