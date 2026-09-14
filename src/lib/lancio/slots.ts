/**
 * Ore libere della mattina del giorno dopo e round robin fra i venditori.
 * Puro: riceve fatti già letti (Task 5 li legge dal DB) e un `now` esplicito.
 *
 * "Libero in un'ora" = l'ha dichiarata nel calendario, non l'ha bloccata e non
 * ha già un appuntamento: la stessa lettura di checkBookingAllowed (Conferme).
 * Un esente (calendarExempt) non dichiara mai ore: esce da solo.
 */
import { romeInstant } from '@/lib/venditore/calendarSlots'
import { MIN_LEAD_TIME_MS } from './config'
import { hourKey } from './rules'

export interface ShiftMember {
    salesUserId: string
    lastAssignedAt: Date | null
}

export interface VenditoreDayFacts extends ShiftMember {
    declared: Set<string>
    blocked: Set<string>
    busy: Set<string>
}

export interface MattinaHour {
    hour: number
    liberi: number
    venditoriLiberi: string[]
}

export function isFreeAt(v: VenditoreDayFacts, key: string): boolean {
    return v.declared.has(key) && !v.blocked.has(key) && !v.busy.has(key)
}

export function mattinaSlots(input: {
    dateStr: string
    hours: number[]
    venditori: VenditoreDayFacts[]
    now: Date
}): { mattina: MattinaHour[]; mattinaEsaurita: boolean } {
    const cutoff = input.now.getTime() + MIN_LEAD_TIME_MS
    const mattina: MattinaHour[] = []
    for (const hour of input.hours) {
        if (romeInstant(input.dateStr, hour).getTime() < cutoff) continue
        const key = hourKey(input.dateStr, hour)
        const liberi = input.venditori.filter(v => isFreeAt(v, key)).map(v => v.salesUserId).sort()
        mattina.push({ hour, liberi: liberi.length, venditoriLiberi: liberi })
    }
    return { mattina, mattinaEsaurita: mattina.every(m => m.liberi === 0) }
}

/** `coalesce(lastAssignedAt,'epoch'), salesUserId` — la stessa regola dell'ORDER BY della spec. */
export function pickRoundRobin<T extends ShiftMember>(candidati: T[]): T | null {
    if (candidati.length === 0) return null
    return [...candidati].sort((a, b) => {
        const ta = a.lastAssignedAt?.getTime() ?? 0
        const tb = b.lastAssignedAt?.getTime() ?? 0
        if (ta !== tb) return ta - tb
        return a.salesUserId < b.salesUserId ? -1 : a.salesUserId > b.salesUserId ? 1 : 0
    })[0]
}
