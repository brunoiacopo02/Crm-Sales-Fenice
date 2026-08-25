"use server"

/**
 * Produttività telefonica dei GDO dai tabulati del centralino (tabella
 * pbxCalls, alimentata da scripts/import-cdr.ts).
 *
 * Il "tempo non telefonico" comprende la compilazione degli esiti e la
 * scelta del lead: non è tempo di pausa. Va confrontato col migliore del
 * gruppo (benchmarkMin), mai con lo zero.
 */

import { db } from "@/db"
import { pbxCalls, users, leads } from "@/db/schema"
import { and, gte, lte, lt, eq, isNotNull, or } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { computeDayMetrics, median, type DayCall } from "@/lib/cdr/dayMetrics"
import { shiftBoundsFor, lateAndEarly, saturdayAllowanceSec, fermoTotalSeconds, SATURDAY_TRAINING_ALLOWANCE_MIN, WEEKDAY_DAYS_SHORT_THRESHOLD_MIN, SATURDAY_DAYS_SHORT_THRESHOLD_MIN, romeDowOf } from "@/lib/cdr/shift"
import { apptSetAt } from "@/lib/kpi/canon"
import { dayBoundsRome } from "@/lib/dateUtils"

/** Sotto questa soglia la giornata non è rappresentativa (mezze giornate, assenze). */
const MIN_CALLS_PER_DAY = 40

/** Ruoli che possono vedere produttività telefonica e qualità appuntamenti dei GDO. */
const PRODUCTIVITY_VIEW_ROLES = ['ADMIN', 'MANAGER', 'TL']

export type PhoneProductivityRow = {
    userId: string
    gdo: string
    days: number
    callsPerDay: number
    talkMinPerDay: number
    /**
     * Il telefono squilla ma nessuno risponde — media giornaliera di
     * sum(duration - billsec). Non è conversazione (talkMinPerDay) né tempo
     * fermo (fermoTotalMin): è il terzo pezzo del turno, calcolato con lo
     * stesso schema degli altri campi (accumulo per giornata, poi media).
     */
    ringingMinPerDay: number
    ritmoMinPerDay: number
    grigiaMinPerDay: number
    assenzeMinPerDay: number
    /**
     * Ritardo fra l'inizio turno e la prima chiamata — MEDIANA sulle giornate
     * (mai negativo). Non la media: poche giornate anomale (permessi, mezze
     * giornate, uscite autorizzate) la trascinano lontano dal caso tipico.
     */
    startLateMin: number
    /**
     * Anticipo fra la fine dell'ultima chiamata e la fine turno — MEDIANA
     * sulle giornate (mai negativo). Stesso motivo di startLateMin: la media
     * di questo campo può arrivare a 22-51 min pur avendo la maggioranza
     * delle giornate a 1-12 min, perché 1-2 giornate anomale a 200+ min la
     * spostano — vedi daysFullShift/daysShort per non perdere l'eccezione.
     */
    endEarlyMin: number
    /** Giornate in cui si arriva a fine turno: anticipo ≤ 15 minuti. */
    daysFullShift: number
    /**
     * Giornate con anticipo oltre la soglia: mezze giornate, permessi, uscite
     * autorizzate. Soglia: 60 min nei feriali, 120 min il sabato (vedi
     * WEEKDAY_DAYS_SHORT_THRESHOLD_MIN e SATURDAY_DAYS_SHORT_THRESHOLD_MIN in shift.ts).
     * Il sabato 120 min sta dentro il gap fra formazione legittima (≤95 min)
     * e giornate anomale (≥113 min).
     */
    daysShort: number
    /** Buchi dentro il turno: fermo totale meno i due bordi. */
    idleInShiftMin: number
    /** Minuti del turno senza nessuna chiamata attiva (bordi + buchi interni). */
    fermoTotalMin: number
    /** fermoTotalMin in percentuale sulla durata del turno. */
    fermoPct: number
    /** Durata del turno usata per questa riga (media sulle giornate), per trasparenza. */
    shiftMinutes: number
}

export async function getPhoneProductivity(
    fromDateLocal: string,
    toDateLocal: string,
): Promise<{ rows: PhoneProductivityRow[]; benchmarkMin: number }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!PRODUCTIVITY_VIEW_ROLES.includes(ctx.role)) {
        throw new Error(`Forbidden: user ${ctx.userId} has role '${ctx.role}', not allowed to view phone productivity`)
    }

    const raw = await db.select({
        userId: pbxCalls.userId,
        dateLocal: pbxCalls.dateLocal,
        calldate: pbxCalls.calldate,
        duration: pbxCalls.duration,
        billsec: pbxCalls.billsec,
        disposition: pbxCalls.disposition,
        name: users.name,
        displayName: users.displayName,
    })
        .from(pbxCalls)
        .innerJoin(users, eq(users.id, pbxCalls.userId))
        .where(and(
            companyScope(ctx, pbxCalls.companyId),
            eq(pbxCalls.direction, 'out'),
            isNotNull(pbxCalls.userId),
            gte(pbxCalls.dateLocal, fromDateLocal),
            lte(pbxCalls.dateLocal, toDateLocal),
        ))

    // Raggruppa per (utente, giorno)
    const byDay = new Map<string, { userId: string; gdo: string; dateLocal: string; calls: DayCall[] }>()
    for (const r of raw) {
        const key = `${r.userId}|${r.dateLocal}`
        let slot = byDay.get(key)
        if (!slot) {
            slot = { userId: r.userId!, gdo: r.displayName || r.name || r.userId!, dateLocal: r.dateLocal, calls: [] }
            byDay.set(key, slot)
        }
        slot.calls.push({
            calldate: r.calldate,
            duration: r.duration,
            billsec: r.billsec,
            disposition: r.disposition,
        })
    }

    // Aggrega per utente sulle sole giornate rappresentative
    const byUser = new Map<string, {
        gdo: string; days: number; calls: number; talk: number; ringing: number
        ritmo: number; grigia: number; assenze: number
        // startLate/endEarly per-giornata (secondi): servono per la MEDIANA,
        // non per una media — vedi commento su PhoneProductivityRow.
        startLateDaysSec: number[]; endEarlyDaysSec: number[]
        daysFullShift: number; daysShort: number
        idleInShift: number; fermoTotal: number; shiftMinutesSum: number
    }>()
    for (const slot of byDay.values()) {
        if (slot.calls.length < MIN_CALLS_PER_DAY) continue
        const m = computeDayMetrics(slot.calls)
        if (!m) continue

        // Le domeniche (se mai ce ne fossero) non hanno un turno definito:
        // la giornata va esclusa da tutte le metriche, non solo da quelle di turno.
        const shift = shiftBoundsFor(slot.dateLocal)
        if (!shift) continue

        let u = byUser.get(slot.userId)
        if (!u) {
            u = {
                gdo: slot.gdo, days: 0, calls: 0, talk: 0, ringing: 0, ritmo: 0, grigia: 0, assenze: 0,
                startLateDaysSec: [], endEarlyDaysSec: [], daysFullShift: 0, daysShort: 0,
                idleInShift: 0, fermoTotal: 0, shiftMinutesSum: 0,
            }
            byUser.set(slot.userId, u)
        }
        u.days += 1
        u.calls += m.calls
        u.talk += m.talkSeconds
        // squilli a vuoto = tempo occupato (duration) meno conversazione
        // effettiva (billsec), accumulato per giornata come talk/ritmo/ecc.
        u.ringing += m.occupiedSeconds - m.talkSeconds
        u.ritmo += m.buckets.under1m + m.buckets.m1to3
        u.grigia += m.buckets.m3to10
        u.assenze += m.buckets.m10to30 + m.buckets.over30m

        // Metriche di turno per questa giornata (secondi), poi mediate sulle
        // giornate come tutto il resto — mai sommate tutte insieme e divise alla fine.
        const shiftDurationSec = shift.minutes * 60
        const { startLateSec, endEarlySec } = lateAndEarly(m.firstAt, m.lastAt, shift)
        // Il sabato la formazione occupa spesso l'ultima ora: quell'anticipo
        // non conta come fermo, fino a SATURDAY_TRAINING_ALLOWANCE_MIN minuti
        // (vedi shift.ts). Nei feriali l'abbuono è sempre 0.
        const allowanceSec = saturdayAllowanceSec(slot.dateLocal, endEarlySec)
        const fermoTotalSec = fermoTotalSeconds(slot.dateLocal, shiftDurationSec, m.occupiedSeconds, endEarlySec)
        // I buchi interni restano quelli "grezzi" (non scalati dall'abbuono):
        // fermoTotalSec è già al netto dell'abbuono sull'anticipo, quindi qui
        // si sottrae l'anticipo altrettanto scalato per tornare ai soli buchi
        // interni — fermoTotale = startLate + idleInShift + (endEarly - abbuono).
        const idleInShiftSec = Math.max(0, fermoTotalSec - startLateSec - (endEarlySec - allowanceSec))

        u.startLateDaysSec.push(startLateSec)
        u.endEarlyDaysSec.push(endEarlySec)
        // Soglie sulla singola giornata, non sulla mediana: "arriva a fine
        // turno" e "mezza giornata/permesso" sono eventi puntuali.
        // La soglia di "corta" dipende dal giorno: feriali 60 min, sabato 120 min
        // (vedi shift.ts per la distribuzione che giustifica 120).
        if (endEarlySec <= 15 * 60) u.daysFullShift += 1
        const threshold = romeDowOf(slot.dateLocal) === 6
            ? SATURDAY_DAYS_SHORT_THRESHOLD_MIN * 60
            : WEEKDAY_DAYS_SHORT_THRESHOLD_MIN * 60
        if (endEarlySec > threshold) u.daysShort += 1
        u.idleInShift += idleInShiftSec
        u.fermoTotal += fermoTotalSec
        u.shiftMinutesSum += shift.minutes
    }

    const rows: PhoneProductivityRow[] = [...byUser.entries()].map(([userId, u]) => {
        const fermoTotalMin = Math.round(u.fermoTotal / u.days / 60)
        const shiftMinutes = Math.round(u.shiftMinutesSum / u.days)
        // fermoPct dai contatori grezzi in secondi (u.fermoTotal, shiftSecondsSum),
        // non dai minuti già arrotondati sopra (fermoTotalMin/shiftMinutes):
        // il doppio arrotondamento porta fino a 1-2 punti di scarto.
        const shiftSecondsSum = u.shiftMinutesSum * 60
        return {
            userId,
            gdo: u.gdo,
            days: u.days,
            callsPerDay: Math.round(u.calls / u.days),
            talkMinPerDay: Math.round(u.talk / u.days / 60),
            ringingMinPerDay: Math.round(u.ringing / u.days / 60),
            ritmoMinPerDay: Math.round(u.ritmo / u.days / 60),
            grigiaMinPerDay: Math.round(u.grigia / u.days / 60),
            assenzeMinPerDay: Math.round(u.assenze / u.days / 60),
            // Mediana, non media: vedi commento su PhoneProductivityRow.
            startLateMin: Math.round(median(u.startLateDaysSec) / 60),
            endEarlyMin: Math.round(median(u.endEarlyDaysSec) / 60),
            daysFullShift: u.daysFullShift,
            daysShort: u.daysShort,
            idleInShiftMin: Math.round(u.idleInShift / u.days / 60),
            fermoTotalMin,
            fermoPct: shiftSecondsSum ? Math.round((100 * u.fermoTotal) / shiftSecondsSum) : 0,
            shiftMinutes,
        }
    }).sort((a, b) => b.assenzeMinPerDay - a.assenzeMinPerDay)

    // Il riferimento è il migliore del gruppo sulle assenze, non sul totale
    // (deve essere omogeneo con assenzeMinPerDay, usato per lo scostamento
    // "Oltre il migliore" in UI) — non lo zero.
    const benchmarkMin = rows.length ? Math.min(...rows.map(r => r.assenzeMinPerDay)) : 0
    return { rows, benchmarkMin }
}

export type ApptQualityRow = {
    userId: string
    gdo: string
    app: number
    presenziati: number
    chiusi: number
    fatturato: number
    presenzaPct: number
    chiusuraPct: number
    euroPerApp: number
}

/**
 * Cascata di qualità degli appuntamenti per GDO.
 *
 * Attenzione alle date: l'appuntamento si conta al momento in cui è stato
 * fissato, la presenza al giorno in cui il lead si è presentato, la chiusura
 * alla data dell'esito del venditore. Sono tre date diverse: gli appuntamenti
 * di fine mese si presentano e si chiudono nel mese successivo, quindi la
 * cascata dell'ultimo mese è sempre parziale. Va detto nella UI.
 */
export async function getApptQuality(
    fromDateLocal: string,
    toDateLocal: string,
): Promise<ApptQualityRow[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!PRODUCTIVITY_VIEW_ROLES.includes(ctx.role)) {
        throw new Error(`Forbidden: user ${ctx.userId} has role '${ctx.role}', not allowed to view appointment quality`)
    }

    // Bounds Europe/Rome del periodo [fromDateLocal, toDateLocal] (inclusive),
    // via dayBoundsRome (gestisce il DST) invece di un offset scritto a mano:
    // `from` = inizio del primo giorno, `to` = inizio del giorno dopo `toDateLocal`
    // (esclusivo) — vedi inRange più sotto.
    const from = dayBoundsRome(new Date(`${fromDateLocal}T00:00:00Z`)).start
    const to = dayBoundsRome(new Date(`${toDateLocal}T00:00:00Z`)).end

    const rows = await db.select({
        userId: leads.assignedToId,
        name: users.name,
        displayName: users.displayName,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeAt: leads.salespersonOutcomeAt,
        closeAmountEur: leads.closeAmountEur,
    })
        .from(leads)
        .innerJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            companyScope(ctx, leads.companyId),
            eq(users.role, 'GDO'),
            eq(users.isBot, false),
            or(
                and(gte(leads.appointmentCreatedAt, from), lt(leads.appointmentCreatedAt, to)),
                and(gte(leads.appointmentDate, from), lt(leads.appointmentDate, to)),
                and(gte(leads.presentedAt, from), lt(leads.presentedAt, to)),
                and(gte(leads.salespersonOutcomeAt, from), lt(leads.salespersonOutcomeAt, to)),
            ),
        ))

    const agg = new Map<string, ApptQualityRow>()
    const slot = (id: string, gdo: string) => {
        let s = agg.get(id)
        if (!s) {
            s = { userId: id, gdo, app: 0, presenziati: 0, chiusi: 0, fatturato: 0, presenzaPct: 0, chiusuraPct: 0, euroPerApp: 0 }
            agg.set(id, s)
        }
        return s
    }
    const inRange = (d: Date | null) => !!d && d >= from && d < to

    for (const r of rows) {
        if (!r.userId) continue
        const s = slot(r.userId, r.displayName || r.name || r.userId)
        if (inRange(apptSetAt(r))) s.app += 1
        if (inRange(r.presentedAt)) s.presenziati += 1
        if (r.salespersonOutcome?.toLowerCase() === 'chiuso' && inRange(r.salespersonOutcomeAt)) {
            s.chiusi += 1
            s.fatturato += r.closeAmountEur || 0
        }
    }

    return [...agg.values()]
        .filter(s => s.app > 0)
        .map(s => ({
            ...s,
            fatturato: Math.round(s.fatturato),
            presenzaPct: s.app ? Math.round((100 * s.presenziati) / s.app) : 0,
            chiusuraPct: s.presenziati ? Math.round((100 * s.chiusi) / s.presenziati) : 0,
            euroPerApp: s.app ? Math.round(s.fatturato / s.app) : 0,
        }))
        .sort((a, b) => b.euroPerApp - a.euroPerApp)
}
