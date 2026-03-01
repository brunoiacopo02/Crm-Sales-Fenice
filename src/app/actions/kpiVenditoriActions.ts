"use server"

import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { eq, and, gte, lte, isNotNull } from "drizzle-orm"
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } from "date-fns"

export async function getVenditoriKpi(period: 'oggi' | 'settimana' | 'mese' | 'custom', customStart?: string, customEnd?: string) {
    const now = new Date()
    let startDate: Date
    let endDate: Date

    switch (period) {
        case 'oggi':
            startDate = startOfDay(now)
            endDate = endOfDay(now)
            break
        case 'settimana':
            startDate = startOfWeek(now, { weekStartsOn: 1 }) // Inizia da Lunedì
            endDate = endOfWeek(now, { weekStartsOn: 1 })
            break
        case 'mese':
            startDate = startOfMonth(now)
            endDate = endOfMonth(now)
            break
        case 'custom':
            startDate = customStart ? startOfDay(parseISO(customStart)) : startOfMonth(now)
            endDate = customEnd ? endOfDay(parseISO(customEnd)) : endOfMonth(now)
            break
    }

    // Prendiamo tutti i venditori
    const venditori = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
    }).from(users).where(eq(users.role, 'VENDITORE'))

    // Prendiamo tutti gli esiti dei venditori nel periodo (usando salespersonOutcomeAt)
    const outcomes = await db.select({
        salespersonUserId: leads.salespersonUserId,
        outcome: leads.salespersonOutcome,
        amount: leads.closeAmountEur
    }).from(leads).where(
        and(
            isNotNull(leads.salespersonOutcome),
            isNotNull(leads.salespersonUserId),
            gte(leads.salespersonOutcomeAt, startDate),
            lte(leads.salespersonOutcomeAt, endDate)
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
            fatturato
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
