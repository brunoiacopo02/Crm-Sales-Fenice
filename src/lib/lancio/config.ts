/**
 * Date e fasce del lancio "Web Developer AI" (webinar 5/10/2026 ore 21).
 * Unica sorgente: API, pagina /lancio, scheda venditore e test leggono da qui.
 * I test passano un `now` esplicito: nessuna funzione di questa cartella
 * chiama `new Date()` da sola se può riceverlo.
 *
 * Bucket/funnel/slug/company NON si ridefiniscono: vivono in intake.ts (B1) e
 * qui si ri-esportano, così chi sta in src/lib/lancio/ ha un solo import.
 */
import { LANCIO_BUCKET, LANCIO_COMPANY, LANCIO_FUNNEL, LANCIO_SLUG } from './intake'

export { LANCIO_BUCKET, LANCIO_COMPANY, LANCIO_FUNNEL, LANCIO_SLUG }

export interface LancioConfig {
    bucket: string
    funnel: string
    /** ISO con offset Europe/Rome. */
    webinarAt: string
    /** 'YYYY-MM-DD' Europe/Rome. */
    giornoDopo: string
    dopodomani: string
    /** Ore tonde del giorno dopo servite dai venditori (appuntamento già confermato). */
    oreVenditori: number[]
    /** Ore tonde del giorno dopo servite dalle Conferme. */
    orePomeriggio: number[]
}

export const LANCIO_WEBDEV: LancioConfig = {
    bucket: LANCIO_BUCKET,
    funnel: LANCIO_FUNNEL,
    webinarAt: '2026-10-05T21:00:00+02:00',
    giornoDopo: '2026-10-06',
    dopodomani: '2026-10-07',
    oreVenditori: [9, 10, 11, 12, 13, 14],
    orePomeriggio: [15, 16, 17, 18, 19, 20],
}

export type LancioScelta = 'chiamata_subito' | 'app_mattina' | 'app_pomeriggio' | 'app_dopodomani' | 'followup'

/**
 * Le risposte di riscaldamento raccolte dal bot (contratto B4, `lib/lancio-crm.ts`
 * del bot): `{ risposte: string[], slotsMostratiAt?: string|null }`. Si salva
 * com'è in `leads.lancioBotInfo` (jsonb) e si mostra `risposte` in ordine.
 * Chiavi in più sono tollerate e ignorate dalla UI.
 */
export interface LancioBotInfo {
    risposte?: string[]
    slotsMostratiAt?: string | null
    [k: string]: unknown
}

export type ShiftKind = 'SERA' | 'GIORNO_DOPO'

/** Un appuntamento si accetta solo se comincia almeno un'ora dopo la richiesta. */
export const MIN_LEAD_TIME_MS = 60 * 60 * 1000

/** Tentativi massimi della chiamata subito prima del passaggio alle Conferme (assunzione A1). */
export const CALL_NOW_MAX_ATTEMPTS = 3
/** Minuti fra un tentativo e il successivo. */
export const CALL_NOW_RETRY_MINUTES = 30
