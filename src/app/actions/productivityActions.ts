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
import { pbxCalls, users } from "@/db/schema"
import { and, gte, lte, eq, isNotNull } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { computeDayMetrics, median, type DayCall } from "@/lib/cdr/dayMetrics"

/** Sotto questa soglia la giornata non è rappresentativa (mezze giornate, assenze). */
const MIN_CALLS_PER_DAY = 40

export type PhoneProductivityRow = {
    userId: string
    gdo: string
    days: number
    callsPerDay: number
    talkMinPerDay: number
    offPhoneMinPerDay: number
    offPhonePct: number
    avgGapSeconds: number
    medianGapSeconds: number
    ritmoMinPerDay: number
    assenzeMinPerDay: number
}

export async function getPhoneProductivity(
    fromDateLocal: string,
    toDateLocal: string,
): Promise<{ rows: PhoneProductivityRow[]; benchmarkMin: number }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

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
    const byDay = new Map<string, { userId: string; gdo: string; calls: DayCall[] }>()
    for (const r of raw) {
        const key = `${r.userId}|${r.dateLocal}`
        let slot = byDay.get(key)
        if (!slot) {
            slot = { userId: r.userId!, gdo: r.displayName || r.name || r.userId!, calls: [] }
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
        gdo: string; days: number; calls: number; talk: number
        offPhone: number; window: number; gaps: number[]
        ritmo: number; grigia: number; assenze: number
    }>()
    for (const slot of byDay.values()) {
        if (slot.calls.length < MIN_CALLS_PER_DAY) continue
        const m = computeDayMetrics(slot.calls)
        if (!m) continue
        let u = byUser.get(slot.userId)
        if (!u) {
            u = { gdo: slot.gdo, days: 0, calls: 0, talk: 0, offPhone: 0, window: 0, gaps: [], ritmo: 0, grigia: 0, assenze: 0 }
            byUser.set(slot.userId, u)
        }
        u.days += 1
        u.calls += m.calls
        u.talk += m.talkSeconds
        u.offPhone += m.offPhoneSeconds
        u.window += m.windowSeconds
        u.gaps.push(...m.gaps)
        u.ritmo += m.buckets.under1m + m.buckets.m1to3
        u.grigia += m.buckets.m3to10
        u.assenze += m.buckets.m10to30 + m.buckets.over30m
    }

    const rows: PhoneProductivityRow[] = [...byUser.entries()].map(([userId, u]) => ({
        userId,
        gdo: u.gdo,
        days: u.days,
        callsPerDay: Math.round(u.calls / u.days),
        talkMinPerDay: Math.round(u.talk / u.days / 60),
        offPhoneMinPerDay: Math.round(u.offPhone / u.days / 60),
        offPhonePct: u.window ? Math.round((100 * u.offPhone) / u.window) : 0,
        avgGapSeconds: u.gaps.length ? Math.round(u.gaps.reduce((a, b) => a + b, 0) / u.gaps.length) : 0,
        medianGapSeconds: Math.round(median(u.gaps)),
        ritmoMinPerDay: Math.round(u.ritmo / u.days / 60),
        assenzeMinPerDay: Math.round(u.assenze / u.days / 60),
    })).sort((a, b) => b.assenzeMinPerDay - a.assenzeMinPerDay)

    // Il riferimento è il migliore del gruppo sulle assenze, non sul totale
    // (deve essere omogeneo con assenzeMinPerDay, usato per lo scostamento
    // "Oltre il migliore" in UI) — non lo zero.
    const benchmarkMin = rows.length ? Math.min(...rows.map(r => r.assenzeMinPerDay)) : 0
    return { rows, benchmarkMin }
}
