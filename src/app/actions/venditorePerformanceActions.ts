"use server"

import { db } from "@/db"
import { salesAttempts } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { monthBoundsRome } from "@/lib/dateUtils"
import {
    reasonDistribution, topReason, followUpFunnel, closingStats,
    attemptsToClose, monthlyTrend, type AttemptInput,
} from "@/lib/venditorePerformance/aggregate"

// Ultimi N mesi (incluso quello passato) come 'YYYY-MM', ordine cronologico.
function lastMonths(yearMonth: string, n: number): string[] {
    const [y, m] = yearMonth.split('-').map(Number)
    const out: string[] = []
    for (let i = n - 1; i >= 0; i--) {
        const dt = new Date(Date.UTC(y, m - 1 - i, 1))
        out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    return out
}

export interface VenditorePerformanceData {
    yearMonth: string;
    reasonDistribution: { reason: string; count: number; pct: number }[];
    topReason: { reason: string; pct: number } | null;
    followUpFunnel: { enteredFollowUp: number; closed: number; conversionPct: number };
    closing: { chiusi: number; nonChiusi: number; perso: number; sparito: number; totalEsitati: number; closingPct: number; fatturato: number; ticketMedio: number; topProduct: string | null };
    attemptsToClose: { avgAttempts: number; firstShotPct: number };
    overdueFollowUps: number;
    trend: { yearMonth: string; closingPct: number; followUpConversionPct: number }[];
}

export async function getVenditorePerformance(input: { salesUserId: string; yearMonth: string }): Promise<VenditorePerformanceData> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const rows = await db.select({
        leadId: salesAttempts.leadId,
        attemptNumber: salesAttempts.attemptNumber,
        outcome: salesAttempts.outcome,
        notClosedReason: salesAttempts.notClosedReason,
        nextFollowUpDate: salesAttempts.nextFollowUpDate,
        closeProduct: salesAttempts.closeProduct,
        closeAmountEur: salesAttempts.closeAmountEur,
        outcomeAt: salesAttempts.outcomeAt,
    }).from(salesAttempts).where(and(
        companyScope(ctx, salesAttempts.companyId),
        eq(salesAttempts.salesUserId, input.salesUserId),
    ))

    const attempts: AttemptInput[] = rows.map(r => ({
        leadId: r.leadId,
        attemptNumber: r.attemptNumber,
        outcome: r.outcome,
        notClosedReason: r.notClosedReason,
        nextFollowUpDate: r.nextFollowUpDate ? new Date(r.nextFollowUpDate) : null,
        closeProduct: r.closeProduct,
        closeAmountEur: r.closeAmountEur,
        outcomeAt: new Date(r.outcomeAt),
    }))

    const { start, end } = monthBoundsRome(input.yearMonth)
    const dist = reasonDistribution(attempts, start, end)

    // Follow-up scaduti "adesso": ultimo attempt del lead è 'Non chiuso' con data < now.
    const now = new Date()
    const lastByLead = new Map<string, AttemptInput>()
    for (const a of attempts) {
        const cur = lastByLead.get(a.leadId)
        if (!cur || a.outcomeAt >= cur.outcomeAt) lastByLead.set(a.leadId, a)
    }
    let overdueFollowUps = 0
    for (const a of lastByLead.values()) {
        if (a.outcome === 'Non chiuso' && a.nextFollowUpDate && a.nextFollowUpDate < now) overdueFollowUps++
    }

    return {
        yearMonth: input.yearMonth,
        reasonDistribution: dist,
        topReason: topReason(dist),
        followUpFunnel: followUpFunnel(attempts, start, end),
        closing: closingStats(attempts, start, end),
        attemptsToClose: attemptsToClose(attempts, start, end),
        overdueFollowUps,
        trend: monthlyTrend(attempts, lastMonths(input.yearMonth, 6)),
    }
}
