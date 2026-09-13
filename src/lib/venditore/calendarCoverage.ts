/**
 * Copertura per slot e stima dell'affluenza.
 *
 * Un solo calcolo per tre viste (venditore, Conferme, direzione): se i numeri
 * divergessero fra le schermate, la prima discussione sul perché costerebbe più
 * di questa astrazione.
 *
 * Puro: riceve righe già lette dal DB, non ne legge nessuna.
 */

import { slotKey, romeDow, romeHour } from './calendarSlots'

/** Settimane intere guardate all'indietro per la media (quella in corso esclusa). */
export const DEMAND_WEEKS = 8

export interface DemandSample {
    appointmentAt: Date
    /** `leads.presentedAt` valorizzato: la presenza latchata al giorno dell'appuntamento. */
    presented: boolean
}

export interface DemandStat {
    dow: number
    hour: number
    /** Appuntamenti fissati in quella fascia, per settimana. */
    expected: number
    /** Quota di quelli che si presentano. */
    showRate: number
    /** `expected * showRate`: persone che ci si aspetta davvero. */
    expectedPeople: number
}

export function buildDemand(samples: DemandSample[], weeks: number = DEMAND_WEEKS): DemandStat[] {
    // Una finestra di zero settimane non è una domanda sensata: senza questo
    // minimo la media diventa Infinity e si propaga come NaN fino al semaforo.
    const finestra = Math.max(1, Math.floor(weeks))

    const acc = new Map<string, { dow: number; hour: number; total: number; presented: number }>()
    for (const s of samples) {
        const dow = romeDow(s.appointmentAt)
        const hour = romeHour(s.appointmentAt)
        // Fuori griglia: non è una fascia che il calendario possa coprire.
        if (dow === 7 || hour < 9 || hour > 21) continue
        const k = `${dow}-${hour}`
        const cur = acc.get(k) || { dow, hour, total: 0, presented: 0 }
        cur.total += 1
        if (s.presented) cur.presented += 1
        acc.set(k, cur)
    }

    return [...acc.values()].map(v => {
        const expected = v.total / finestra
        const showRate = v.total > 0 ? v.presented / v.total : 0
        return { dow: v.dow, hour: v.hour, expected, showRate, expectedPeople: expected * showRate }
    })
}

export type CoverageStatus = 'rosso' | 'ambra' | 'verde' | 'neutro'

export function coverageStatus(available: number, expectedPeople: number): CoverageStatus {
    // Un numero non finito (finestra storica degenere) non è una copertura
    // piena: senza questa guardia NaN scivolerebbe fino a 'verde', e la cella
    // direbbe "stai tranquillo" proprio quando il dato è spazzatura.
    if (!Number.isFinite(expectedPeople)) return 'neutro'
    if (expectedPeople <= 0) return 'neutro'
    if (available === 0) return 'rosso'
    if (available < expectedPeople) return 'ambra'
    return 'verde'
}

export interface CoverageCell {
    slotKey: string
    /** ISO dell'istante d'inizio: il client lo riconverte per l'etichetta. */
    slotStart: string
    dow: number
    hour: number
    /** Chi è davvero disponibile: dichiarato, non bloccato e senza appuntamento in quell'ora. */
    available: string[]
    /** Chi ha dichiarato ma è bloccato (follow-up o imprevisto). */
    blocked: string[]
    busy: Array<{ salesUserId: string; leadId: string; leadName: string }>
    expectedPeople: number
    showRate: number
    status: CoverageStatus
}

export function buildCoverage(params: {
    slots: Date[]
    availability: Array<{ salesUserId: string; slotKey: string }>
    blocks: Array<{ salesUserId: string; slotKey: string }>
    appointments: Array<{ salesUserId: string; slotKey: string; leadId: string; leadName: string }>
    demand: DemandStat[]
}): CoverageCell[] {
    const declaredBy = new Map<string, Set<string>>()
    for (const a of params.availability) {
        if (!declaredBy.has(a.slotKey)) declaredBy.set(a.slotKey, new Set())
        declaredBy.get(a.slotKey)!.add(a.salesUserId)
    }
    const blockedBy = new Map<string, Set<string>>()
    for (const b of params.blocks) {
        if (!blockedBy.has(b.slotKey)) blockedBy.set(b.slotKey, new Set())
        blockedBy.get(b.slotKey)!.add(b.salesUserId)
    }
    const busyBy = new Map<string, CoverageCell['busy']>()
    for (const a of params.appointments) {
        if (!busyBy.has(a.slotKey)) busyBy.set(a.slotKey, [])
        busyBy.get(a.slotKey)!.push({ salesUserId: a.salesUserId, leadId: a.leadId, leadName: a.leadName })
    }
    const demandBy = new Map(params.demand.map(d => [`${d.dow}-${d.hour}`, d]))

    return params.slots.map(slot => {
        const key = slotKey(slot)
        const dow = romeDow(slot)
        const hour = romeHour(slot)
        const declared = declaredBy.get(key) || new Set<string>()
        const blockedSet = blockedBy.get(key) || new Set<string>()
        // Un'ora dichiarata è un'ora offerta, e un appuntamento la consuma:
        // chi sta già ricevendo un cliente non è disponibile per un secondo.
        // Resta in `busy`, che è la vista di chi c'è, non di chi è libero.
        const busyUsers = new Set((busyBy.get(key) || []).map(b => b.salesUserId))
        const available = [...declared].filter(u => !blockedSet.has(u) && !busyUsers.has(u))
        const blocked = [...declared].filter(u => blockedSet.has(u))
        const d = demandBy.get(`${dow}-${hour}`)
        const expectedPeople = d?.expectedPeople ?? 0
        return {
            slotKey: key,
            slotStart: slot.toISOString(),
            dow,
            hour,
            available,
            blocked,
            busy: busyBy.get(key) || [],
            expectedPeople,
            showRate: d?.showRate ?? 0,
            status: coverageStatus(available.length, expectedPeople),
        }
    })
}
