"use server"

import { db } from "@/db"
import { salesAttempts, leads, users } from "@/db/schema"
import { and, eq, gte, lt, desc, sql } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { monthBoundsRome } from "@/lib/dateUtils"
import { createClient } from "@/utils/supabase/server"
import { isConfermeTl } from "@/lib/confermeTl"
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

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role
    const email = user?.user_metadata?.email ?? user?.email
    const isStaff = role === 'MANAGER' || role === 'ADMIN' || (role === 'CONFERME' && isConfermeTl(email))
    if (!isStaff && input.salesUserId !== ctx.userId) throw new Error('Forbidden')

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
        if (!cur || a.outcomeAt > cur.outcomeAt || (a.outcomeAt.getTime() === cur.outcomeAt.getTime() && a.attemptNumber > cur.attemptNumber)) {
            lastByLead.set(a.leadId, a)
        }
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

export interface VenditoreRispostaRow {
    id: string; outcomeAt: string;            // ISO
    venditoreName: string | null;
    leadId: string; leadName: string | null; leadPhone: string | null; funnel: string | null;
    attemptNumber: number;                     // 0 = esito app, 1-3 = FU #n
    outcome: string;                           // 'Chiuso' | 'Non chiuso' | 'Perso' | 'Sparito'
    notClosedReason: string | null;
    nextFollowUpDate: string | null;           // ISO
    closeProduct: string | null; closeAmountEur: number | null;
    notes: string | null;                      // leads.salespersonOutcomeNotes
}

const PAGE_SIZE = 50

// Tutte le righe di esito venditore (salesAttempts), staff-only, filtrabili e paginate.
export async function getVenditoriRisposte(input: { yearMonth: string; salesUserId?: string; outcome?: string; notClosedReason?: string; page?: number }): Promise<{ rows: VenditoreRispostaRow[]; total: number; pageSize: number }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role
    const email = user?.user_metadata?.email ?? user?.email
    const isStaff = role === 'MANAGER' || role === 'ADMIN' || (role === 'CONFERME' && isConfermeTl(email))
    if (!isStaff) throw new Error('Forbidden')

    const { start, end } = monthBoundsRome(input.yearMonth)
    const conds = [
        companyScope(ctx, salesAttempts.companyId),
        gte(salesAttempts.outcomeAt, start),
        lt(salesAttempts.outcomeAt, end),
        ...(input.salesUserId ? [eq(salesAttempts.salesUserId, input.salesUserId)] : []),
        ...(input.outcome ? [eq(salesAttempts.outcome, input.outcome)] : []),
        ...(input.notClosedReason ? [eq(salesAttempts.notClosedReason, input.notClosedReason)] : []),
    ]
    const page = Math.max(1, input.page ?? 1)
    const [rows, totalRes] = await Promise.all([
        db.select({
            id: salesAttempts.id, outcomeAt: salesAttempts.outcomeAt,
            venditoreName: users.name,
            leadId: salesAttempts.leadId, leadName: leads.name, leadPhone: leads.phone, funnel: leads.funnel,
            attemptNumber: salesAttempts.attemptNumber, outcome: salesAttempts.outcome,
            notClosedReason: salesAttempts.notClosedReason, nextFollowUpDate: salesAttempts.nextFollowUpDate,
            closeProduct: salesAttempts.closeProduct, closeAmountEur: salesAttempts.closeAmountEur,
            notes: leads.salespersonOutcomeNotes,
        }).from(salesAttempts)
          .innerJoin(leads, eq(leads.id, salesAttempts.leadId))
          .innerJoin(users, eq(users.id, salesAttempts.salesUserId))
          .where(and(...conds))
          .orderBy(desc(salesAttempts.outcomeAt), desc(salesAttempts.id))
          .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
        db.select({ count: sql<number>`count(*)::integer` }).from(salesAttempts).where(and(...conds)),
    ])
    return {
        rows: rows.map(r => ({ ...r, outcomeAt: r.outcomeAt.toISOString(), nextFollowUpDate: r.nextFollowUpDate?.toISOString() ?? null })),
        total: totalRes[0]?.count ?? 0,
        pageSize: PAGE_SIZE,
    }
}
