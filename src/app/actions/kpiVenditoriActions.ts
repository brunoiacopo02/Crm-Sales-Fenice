"use server"

import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { eq, and, gte, lt, isNotNull } from "drizzle-orm"
import { dayBoundsRome, weekBoundsRome, monthBoundsRome } from "@/lib/dateUtils"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { currentTenant, assertSalesArea, companyScope } from '@/lib/tenancy';

// Normalizza il funnel come nel resto del codebase: trim + UPPER, vuoto/null → SCONOSCIUTO
const normFunnel = (f: string | null | undefined) => (f ?? '').trim().toUpperCase() || 'SCONOSCIUTO'

// Sentinella per "Tutti i funnel" (mai presente nel DB, come __all__ per le aziende)
const ALL_FUNNELS = '__all__'

export async function getVenditoriKpi(period: 'oggi' | 'settimana' | 'mese' | 'custom', customStart?: string, customEnd?: string, funnelFilter?: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
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
    }).from(users).where(and(eq(users.role, 'VENDITORE'), companyScope(ctx, users.companyId)))

    // Prendiamo tutti gli esiti dei venditori nel periodo (salespersonOutcomeAt
    // come campo data canonico — vedi lib/metricsUtils mapping M5/M6).
    // Pattern bounds: gte(start) AND lt(end) — NO off-by-one ms.
    const outcomes = await db.select({
        salespersonUserId: leads.salespersonUserId,
        outcome: leads.salespersonOutcome,
        amount: leads.closeAmountEur,
        funnel: leads.funnel
    }).from(leads).where(
        and(
            companyScope(ctx, leads.companyId),
            isNotNull(leads.salespersonOutcome),
            isNotNull(leads.salespersonUserId),
            gte(leads.salespersonOutcomeAt, startDate),
            lt(leads.salespersonOutcomeAt, endDate)
        )
    )

    // Filtro per funnel: se selezionato un funnel specifico, ricalcola tutta la
    // tabella (chiusi/non chiusi/spariti/CR/fatturato/posizioni) sul solo sottoinsieme.
    const wantFunnel = funnelFilter && funnelFilter !== ALL_FUNNELS ? funnelFilter : null
    const scopedOutcomes = wantFunnel
        ? outcomes.filter(o => normFunnel(o.funnel) === wantFunnel)
        : outcomes

    const results = venditori.map(v => {
        const vOutcomes = scopedOutcomes.filter(o => o.salespersonUserId === v.id)

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

// Elenco dei funnel presenti tra i lead esitati dai venditori (company-scoped,
// non vincolato al periodo così il dropdown resta stabile cambiando periodo/funnel).
export async function getVenditoriFunnels(): Promise<string[]> {
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const rows = await db.select({ funnel: leads.funnel }).from(leads).where(
        and(
            companyScope(ctx, leads.companyId),
            isNotNull(leads.salespersonOutcome),
            isNotNull(leads.salespersonUserId)
        )
    )

    const set = new Set<string>()
    for (const r of rows) set.add(normFunnel(r.funnel))
    return [...set].sort((a, b) => a.localeCompare(b, 'it'))
}
