"use server"

import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { eq, and, or, gte, lt, isNotNull } from "drizzle-orm"
import { dayBoundsRome, weekBoundsRome, monthBoundsRome } from "@/lib/dateUtils"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { currentTenant, assertSalesArea, companyScope } from '@/lib/tenancy';
import { cohortClosing } from "@/lib/kpi/salesCohort"

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

    // Una sola lettura per DUE metriche che vivono su date diverse (PO 2026-09-10):
    //
    //  - SOLDI (fatturato/chiusi/non chiusi/spariti/persi/totalEsitati): mese della
    //    FIRMA, cioè `salespersonOutcomeAt` nel periodo. È la base di target, bonus
    //    e riconciliazione col foglio: non si tocca.
    //  - CLOSING RATE: rapporto di COORTE sulle PRESENZE del periodo
    //    (`presentedAt`), regola canonica in `lib/kpi/salesCohort.ts`.
    //
    // Il closing rate calcolato sugli esiti del periodo era sbagliato perché
    // `salespersonOutcomeAt` si sposta a OGNI follow-up: la presenza di agosto
    // ricadeva nel denominatore di settembre appena il venditore registrava un
    // richiamo, e le presenze di settembre non ancora esitate non ci entravano
    // affatto (settembre 2026: 111 "esitati" contro 81 presenze reali).
    //
    // Per questo la WHERE prende i lead con presenza NEL periodo OPPURE esito NEL
    // periodo, e `isNotNull(salespersonOutcome)` NON sta più nel filtro generale:
    // altrimenti una presenza ancora in lavorazione (che nella coorte deve stare
    // al denominatore) verrebbe scartata dalla query. La condizione è riapplicata
    // sotto, solo sul sottoinsieme "firme del periodo".
    // Pattern bounds: gte(start) AND lt(end) — NO off-by-one ms.
    const rows = await db.select({
        salespersonUserId: leads.salespersonUserId,
        salespersonOutcome: leads.salespersonOutcome,
        outcomeAt: leads.salespersonOutcomeAt,
        presentedAt: leads.presentedAt,
        amount: leads.closeAmountEur,
        funnel: leads.funnel
    }).from(leads).where(
        and(
            companyScope(ctx, leads.companyId),
            isNotNull(leads.salespersonUserId),
            or(
                and(
                    gte(leads.presentedAt, startDate),
                    lt(leads.presentedAt, endDate)
                ),
                and(
                    isNotNull(leads.salespersonOutcome),
                    gte(leads.salespersonOutcomeAt, startDate),
                    lt(leads.salespersonOutcomeAt, endDate)
                )
            )
        )
    )

    // Filtro per funnel: se selezionato un funnel specifico, ricalcola tutta la
    // tabella (chiusi/non chiusi/spariti/CR/fatturato/posizioni) sul solo
    // sottoinsieme — coorte delle presenze inclusa.
    const wantFunnel = funnelFilter && funnelFilter !== ALL_FUNNELS ? funnelFilter : null
    const scopedRows = wantFunnel
        ? rows.filter(r => normFunnel(r.funnel) === wantFunnel)
        : rows

    // Un lead è una "firma del periodo" se l'esito corrente è stato registrato
    // nel periodo: è il sottoinsieme monetario di cui sopra.
    const isSignedInPeriod = (r: typeof scopedRows[number]) =>
        !!r.salespersonOutcome && !!r.outcomeAt && r.outcomeAt >= startDate && r.outcomeAt < endDate

    const results = venditori.map(v => {
        const vRows = scopedRows.filter(r => r.salespersonUserId === v.id)
        const vOutcomes = vRows.filter(isSignedInPeriod)

        const chiusi = vOutcomes.filter(o => o.salespersonOutcome === 'Chiuso').length
        const nonChiusi = vOutcomes.filter(o => o.salespersonOutcome === 'Non chiuso').length
        const sparito = vOutcomes.filter(o => o.salespersonOutcome === 'Sparito').length
        const perso = vOutcomes.filter(o => o.salespersonOutcome === 'Perso').length

        const totalEsitati = chiusi + nonChiusi + sparito + perso

        const fatturato = vOutcomes
            .filter(o => o.salespersonOutcome === 'Chiuso')
            .reduce((sum, o) => sum + (o.amount || 0), 0)

        // Closing rate di coorte: denominatore = presenze del periodo.
        const coorte = cohortClosing(vRows, startDate, endDate)

        return {
            id: v.id,
            name: v.displayName || v.name,
            chiusi,
            nonChiusi,
            sparito,
            perso,
            totalEsitati,
            presenze: coorte.presenze,
            chiusiCoorte: coorte.chiusi,
            closingRate: coorte.closingPct,
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
