/**
 * Regole dure sull'ora richiesta dal bot. Pure: niente DB, `now` esplicito.
 *
 * Il bot NON inventa ore: qui si decide se `at` è una delle ore ammesse
 * (6/10 9-20, poi lun-sab 9-20 senza fine; tutte tonde) e con almeno un'ora di anticipo.
 * Il fuso è Europe/Rome via calendarSlots: l'unico posto che fa aritmetica
 * sulle ore in tutto il progetto.
 */
import { romeHour, romeInstant } from '@/lib/venditore/calendarSlots'
import { toRomeDateStr } from '@/lib/dateUtils'
import { LANCIO_WEBDEV, MIN_LEAD_TIME_MS, ORE_CONFERME, type LancioConfig } from './config'

export type AtKind = 'mattina' | 'pomeriggio' | 'dopodomani' | 'conferme'

export type AtDecision =
    | { ok: true; kind: AtKind; dateStr: string; hour: number }
    | { ok: false; motivo: 'fuori_regole' }

const FUORI: AtDecision = { ok: false, motivo: 'fuori_regole' }

/** 'giornoDopo' | 'dopodomani' | null per una data 'YYYY-MM-DD'. */
export function slotDateKind(dateStr: string, cfg: LancioConfig = LANCIO_WEBDEV): 'giornoDopo' | 'dopodomani' | null {
    if (dateStr === cfg.giornoDopo) return 'giornoDopo'
    if (dateStr === cfg.dopodomani) return 'dopodomani'
    return null
}

/** Domenica per una data 'YYYY-MM-DD' (ancora a mezzogiorno UTC: immune dalla DST). */
export function isDomenica(dateStr: string): boolean {
    return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 0
}

export function giornoDopo(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
}

/** Ore Conferme di una data: il 6 solo il pomeriggio, dal 7 lun-sab 9-20, prima del 6 e la domenica nessuna. */
export function oreConfermeDel(dateStr: string, cfg: LancioConfig = LANCIO_WEBDEV): number[] {
    if (dateStr < cfg.giornoDopo || isDomenica(dateStr)) return []
    if (dateStr === cfg.giornoDopo) return [...cfg.orePomeriggio]
    return [...ORE_CONFERME]
}

export function classifyAt(at: Date, now: Date, cfg: LancioConfig = LANCIO_WEBDEV): AtDecision {
    if (!(at instanceof Date) || isNaN(at.getTime())) return FUORI
    if (at.getTime() < now.getTime() + MIN_LEAD_TIME_MS) return FUORI

    const dateStr = toRomeDateStr(at)
    const hour = romeHour(at)
    // Ora tonda: l'istante deve coincidere con l'ora piena italiana.
    if (romeInstant(dateStr, hour).getTime() !== at.getTime()) return FUORI

    if (dateStr === cfg.giornoDopo && cfg.oreVenditori.includes(hour)) return { ok: true, kind: 'mattina', dateStr, hour }
    if (!oreConfermeDel(dateStr, cfg).includes(hour)) return FUORI
    return { ok: true, kind: dateStr === cfg.giornoDopo ? 'pomeriggio' : 'conferme', dateStr, hour }
}

/** Stessa forma di `slotKey` (calendarSlots): '2026-10-06@9'. */
export function hourKey(dateStr: string, hour: number): string {
    return `${dateStr}@${hour}`
}

/** Idempotenza di `book`: lo stesso `at` entro 60 s è la stessa richiesta. */
export function sameInstant(a: Date | null | undefined, b: Date, toleranceMs = 60_000): boolean {
    if (!a) return false
    return Math.abs(a.getTime() - b.getTime()) <= toleranceMs
}
