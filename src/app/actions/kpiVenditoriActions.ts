"use server"

import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { eq, and, gte, lt, isNotNull } from "drizzle-orm"
import { dayBoundsRome, weekBoundsRome, monthBoundsRome } from "@/lib/dateUtils"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"

export async function getVenditoriKpi(period: 'oggi' | 'settimana' | 'mese' | 'custom', customStart?: string, customEnd?: string) {
    // Bounds Europe/Rome espliciti (Sprint 2.3): risolve sfasamento UTC-vs-Rome
    // che faceva cadere primi 2 ore del giorno/mese nel periodo precedente.
    const now = new Date()
    let startDate: Date
    let endDate: Date

    switch (period) {
        case 'oggi': {
            const b = dayBoundsRome(now)
            startDate = b.start; endDate = b.end // end exclusive
            break
        }
        case 'settimana': {
            const b = weekBoundsRome(now)
            startDate = b.start; endDate = b.end
            break
        }
        case 'mese': {
            const b = monthBoundsRome(currentYearMonthRome(now))
            startDate = b.start; endDate = b.end
            break
        }
        case 'custom': {
            // customStart/customEnd format: 'YYYY-MM-DD'
            const startStr = customStart || `${currentYearMonthRome(now)}-01`
            const endStr = customEnd || customStart || `${currentYearMonthRome(now)}-01`
            const sb = dayBoundsRome(new Date(`${startStr}T12:00:00Z`))
            const eb = dayBoundsRome(new Date(`${endStr}T12:00:00Z`))
            startDate = sb.start; endDate = eb.end // end = giorno successivo 00:00 (exclusive)
            break
        }
    }

    // Prendiamo tutti i venditori
    const venditori = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        salesTargetEur: users.salesTargetEur,
    }).from(users).where(eq(users.role, 'VENDITORE'))

    // Prendiamo tutti gli esiti dei venditori nel periodo (salespersonOutcomeAt
    // come campo data canonico — vedi lib/metricsUtils mapping M5/M6).
    // Pattern bounds: gte(start) AND lt(end) — NO off-by-one ms.
    const outcomes = await db.select({
        salespersonUserId: leads.salespersonUserId,
        outcome: leads.salespersonOutcome,
        amount: leads.closeAmountEur
    }).from(leads).where(
        and(
            isNotNull(leads.salespersonOutcome),
            isNotNull(leads.salespersonUserId),
            gte(leads.salespersonOutcomeAt, startDate),
            lt(leads.salespersonOutcomeAt, endDate)
        )
    )

    const results = venditori.map(v => {
        const vOutcomes = outcomes.filter(o => o.salespersonUserId === v.id)

        const chiusi = vOutcomes.filter(o => o.outcome === 'Chiuso').length
        const nonChiusi = vOutcomes.filter(o => o.outcome === 'Non chiuso').length
        const sparito = vOutcomes.filter(o => o.outcome === 'Sparito').length

        const totalEsitati = chiusi + nonChiusi + sparito
        const closingRate = totalEsitati > 0 ? (chiusi / totalEsitati) * 100 : 0

        const fatturato = vOutcomes
            .filter(o => o.outcome === 'Chiuso')
            .reduce((sum, o) => sum + (o.amount || 0), 0)

        return {
            id: v.id,
            name: v.displayName || v.name,
            chiusi,
            nonChiusi,
            sparito,
            totalEsitati,
            closingRate: Math.round(closingRate),
            fatturato,
            salesTargetEur: v.salesTargetEur,
        }
    })

    // Ordina per fatturato decrescente
    results.sort((a, b) => b.fatturato - a.fatturato)

    // Assegna posizione in classifica
    return results.map((r, idx) => ({
        ...r,
        position: idx + 1
    }))
}
