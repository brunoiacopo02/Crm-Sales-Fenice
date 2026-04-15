'use server';

import { db } from "@/db";
import { leads, monthlyLeadTargets, monthlyFunnelBaselines } from "@/db/schema";
import { and, gte, lt, sql, eq } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import {
    countWorkingDaysInMonth,
    countWorkingDaysElapsed,
    currentYearMonthRome,
    parseYearMonth,
} from "@/lib/workingDaysUtils";
import crypto from "crypto";

async function requireAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const role = user.user_metadata?.role;
    if (role !== 'ADMIN') return null;
    return { id: user.id, role };
}

export type LeadOverviewRow = {
    label: string;            // 'Nuovi' | 'DB' | 'Totale'
    actCount: number;
    actPercent: number | null;
    targetCount: number;
    targetPercent: number | null;
    aggiungere: number | null; // null for Totale row
};

export type LeadOverviewResult = {
    success: true;
    yearMonth: string;
    isConfigured: boolean;
    config: {
        targetNuovi: number;
        targetDatabase: number;
        workingDays: number;
        baselineNuovi: number;
        baselineDatabase: number;
        baselineSetAt: string | null;
    } | null;
    workingDaysElapsed: number;
    rows: LeadOverviewRow[];
    totals: {
        actCount: number;
        actDailyAvg: number;
        targetCount: number;
        targetDailyAvg: number;
    };
} | { success: false; error: string };

/**
 * Fetch the panoramica overview for a given month (defaults to current).
 */
export async function getLeadOverview(yearMonth?: string): Promise<LeadOverviewResult> {
    try {
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        const ym = yearMonth || currentYearMonthRome();
        const { year, month } = parseYearMonth(ym);

        // Month boundaries — Europe/Rome interpreted via UTC-ish dates. We use UTC
        // midpoints to avoid DST off-by-one; the DB column is timestamptz.
        const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0));

        // Load config for this month
        const [cfg] = await db.select().from(monthlyLeadTargets)
            .where(eq(monthlyLeadTargets.yearMonth, ym));

        // Count leads added in this month, by category.
        // Category = 'DB' if funnel (lowercased) = 'database', else 'Nuovi'.
        // ACT = baseline + every lead created in the current month. If that causes
        // double-counting, the admin adjusts the baseline via the modal.
        const grouped = await db
            .select({
                isDb: sql<boolean>`LOWER(COALESCE(${leads.funnel}, '')) = 'database'`,
                c: sql<number>`count(*)::int`,
            })
            .from(leads)
            .where(and(
                gte(leads.createdAt, monthStart),
                lt(leads.createdAt, monthEnd)
            ))
            .groupBy(sql`LOWER(COALESCE(${leads.funnel}, '')) = 'database'`);

        let liveNuovi = 0;
        let liveDb = 0;
        for (const r of grouped) {
            if (r.isDb) liveDb = r.c;
            else liveNuovi = r.c;
        }

        const baselineNuovi = cfg?.baselineNuovi || 0;
        const baselineDb = cfg?.baselineDatabase || 0;

        const actNuovi = baselineNuovi + liveNuovi;
        const actDb = baselineDb + liveDb;
        const actTotal = actNuovi + actDb;

        // Target proportional to working days elapsed
        const workingDays = cfg?.workingDays || countWorkingDaysInMonth(year, month);
        const elapsed = countWorkingDaysElapsed(year, month, new Date());
        const dailyTargetNuovi = cfg ? cfg.targetNuovi / workingDays : 0;
        const dailyTargetDb = cfg ? cfg.targetDatabase / workingDays : 0;
        const targetNuoviProportional = cfg ? Math.round(dailyTargetNuovi * elapsed) : 0;
        const targetDbProportional = cfg ? Math.round(dailyTargetDb * elapsed) : 0;
        const targetTotal = targetNuoviProportional + targetDbProportional;

        // Percentages
        const actPercentNuovi = actTotal > 0 ? (actNuovi / actTotal) * 100 : 0;
        const actPercentDb = actTotal > 0 ? (actDb / actTotal) * 100 : 0;
        const targetPercentNuovi = targetTotal > 0 ? (targetNuoviProportional / targetTotal) * 100 : 0;
        const targetPercentDb = targetTotal > 0 ? (targetDbProportional / targetTotal) * 100 : 0;

        // "Aggiungere" — how many of each category to add now so that the split
        // matches the target percentage. If the current share is above the target
        // share, return 0 (can't remove leads).
        // Formula: X = (target_share * total - current) / (1 - target_share)
        function aggiungere(current: number, total: number, targetShare: number): number {
            if (targetShare >= 1 || targetShare <= 0) return 0;
            const currentShare = total > 0 ? current / total : 0;
            if (currentShare >= targetShare) return 0;
            const X = (targetShare * total - current) / (1 - targetShare);
            return Math.max(0, Math.round(X));
        }

        const targetShareNuovi = targetTotal > 0 ? targetNuoviProportional / targetTotal : 0;
        const targetShareDb = targetTotal > 0 ? targetDbProportional / targetTotal : 0;
        const aggiungereNuovi = cfg ? aggiungere(actNuovi, actTotal, targetShareNuovi) : 0;
        const aggiungereDb = cfg ? aggiungere(actDb, actTotal, targetShareDb) : 0;

        const rows: LeadOverviewRow[] = [
            {
                label: 'Nuovi',
                actCount: actNuovi,
                actPercent: actTotal > 0 ? actPercentNuovi : null,
                targetCount: targetNuoviProportional,
                targetPercent: targetTotal > 0 ? targetPercentNuovi : null,
                aggiungere: aggiungereNuovi,
            },
            {
                label: 'DB',
                actCount: actDb,
                actPercent: actTotal > 0 ? actPercentDb : null,
                targetCount: targetDbProportional,
                targetPercent: targetTotal > 0 ? targetPercentDb : null,
                aggiungere: aggiungereDb,
            },
            {
                label: 'Totale',
                actCount: actTotal,
                actPercent: null,
                targetCount: targetTotal,
                targetPercent: null,
                aggiungere: null, // intentionally empty (as per screenshot)
            },
        ];

        const actDailyAvg = elapsed > 0 ? Math.round(actTotal / elapsed) : 0;
        const targetDailyAvg = elapsed > 0 ? Math.round(targetTotal / elapsed) : 0;

        return {
            success: true,
            yearMonth: ym,
            isConfigured: !!cfg,
            config: cfg ? {
                targetNuovi: cfg.targetNuovi,
                targetDatabase: cfg.targetDatabase,
                workingDays: cfg.workingDays,
                baselineNuovi: cfg.baselineNuovi,
                baselineDatabase: cfg.baselineDatabase,
                baselineSetAt: cfg.baselineSetAt ? cfg.baselineSetAt.toISOString() : null,
            } : null,
            workingDaysElapsed: elapsed,
            rows,
            totals: {
                actCount: actTotal,
                actDailyAvg,
                targetCount: targetTotal,
                targetDailyAvg,
            },
        };
    } catch (error: any) {
        console.error('Errore getLeadOverview:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

/**
 * Upsert the monthly lead target config. Admin-only.
 * On each save, baselineSetAt is updated to NOW so future CRM lead uploads
 * are summed on top of the freshly-entered baseline.
 */
export async function setLeadMonthlyTarget(input: {
    yearMonth: string;
    targetNuovi: number;
    targetDatabase: number;
    workingDays: number;
    baselineNuovi: number;
    baselineDatabase: number;
}) {
    try {
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        if (input.targetNuovi < 0 || input.targetDatabase < 0 || input.workingDays <= 0) {
            return { success: false, error: 'Valori non validi' };
        }
        if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) {
            return { success: false, error: 'yearMonth deve essere YYYY-MM' };
        }

        const [existing] = await db.select().from(monthlyLeadTargets)
            .where(eq(monthlyLeadTargets.yearMonth, input.yearMonth));

        const now = new Date();

        if (existing) {
            await db.update(monthlyLeadTargets).set({
                targetNuovi: input.targetNuovi,
                targetDatabase: input.targetDatabase,
                workingDays: input.workingDays,
                baselineNuovi: input.baselineNuovi,
                baselineDatabase: input.baselineDatabase,
                baselineSetAt: now,
                updatedAt: now,
            }).where(eq(monthlyLeadTargets.id, existing.id));
        } else {
            await db.insert(monthlyLeadTargets).values({
                id: crypto.randomUUID(),
                yearMonth: input.yearMonth,
                targetNuovi: input.targetNuovi,
                targetDatabase: input.targetDatabase,
                workingDays: input.workingDays,
                baselineNuovi: input.baselineNuovi,
                baselineDatabase: input.baselineDatabase,
                baselineSetAt: now,
                createdAt: now,
                updatedAt: now,
            });
        }

        return { success: true };
    } catch (error: any) {
        console.error('Errore setLeadMonthlyTarget:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

/**
 * Upsert ONLY the monthly metric targets (Fissati/Conf/Pres/Close/Fatturato)
 * + fatturatoExtraEur override. Does not touch lead targets or baselines.
 */
export async function setMonthlyMetricTargets(input: {
    yearMonth: string;
    targetAppMonthly: number;
    targetConfMonthly: number;
    targetPresMonthly: number;
    targetCloseMonthly: number;
    targetFatturatoMonthly: number;
    fatturatoExtraEur: number;
}) {
    try {
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) {
            return { success: false, error: 'yearMonth deve essere YYYY-MM' };
        }
        if ([input.targetAppMonthly, input.targetConfMonthly, input.targetPresMonthly,
             input.targetCloseMonthly, input.targetFatturatoMonthly].some(v => v < 0)) {
            return { success: false, error: 'I target non possono essere negativi' };
        }

        const [existing] = await db.select().from(monthlyLeadTargets)
            .where(eq(monthlyLeadTargets.yearMonth, input.yearMonth));

        const now = new Date();

        if (existing) {
            await db.update(monthlyLeadTargets).set({
                targetAppMonthly: input.targetAppMonthly,
                targetConfMonthly: input.targetConfMonthly,
                targetPresMonthly: input.targetPresMonthly,
                targetCloseMonthly: input.targetCloseMonthly,
                targetFatturatoMonthly: input.targetFatturatoMonthly,
                fatturatoExtraEur: input.fatturatoExtraEur,
                updatedAt: now,
            }).where(eq(monthlyLeadTargets.id, existing.id));
        } else {
            // No lead-target row yet → create a stub with zero lead targets.
            await db.insert(monthlyLeadTargets).values({
                id: crypto.randomUUID(),
                yearMonth: input.yearMonth,
                targetNuovi: 0,
                targetDatabase: 0,
                workingDays: 22,
                baselineNuovi: 0,
                baselineDatabase: 0,
                targetAppMonthly: input.targetAppMonthly,
                targetConfMonthly: input.targetConfMonthly,
                targetPresMonthly: input.targetPresMonthly,
                targetCloseMonthly: input.targetCloseMonthly,
                targetFatturatoMonthly: input.targetFatturatoMonthly,
                fatturatoExtraEur: input.fatturatoExtraEur,
                createdAt: now,
                updatedAt: now,
            });
        }

        return { success: true };
    } catch (error: any) {
        console.error('Errore setMonthlyMetricTargets:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

/** Utility: suggest working days for a given month (for the modal prefill). */
export async function getSuggestedWorkingDays(yearMonth: string): Promise<number> {
    try {
        const { year, month } = parseYearMonth(yearMonth);
        return countWorkingDaysInMonth(year, month);
    } catch {
        return 22;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Metrics Overview ("Numeri mensili") — roll-up of APP/Conf/Pres/Close + revenue
// ─────────────────────────────────────────────────────────────────────────

export type MetricsOverviewRow = {
    label: string;
    actCount: number;
    actPct: number | null;
    targetPrevCount: number;
    targetPrevPct: number | null;
    targetPerDay: number;
    today: number;
    isCurrency?: boolean;
};

export type MetricsOverviewResult =
    | {
          success: true;
          yearMonth: string;
          workingDays: number;
          workingDaysElapsed: number;
          isConfigured: boolean;
          config: {
              targetAppMonthly: number;
              targetConfMonthly: number;
              targetPresMonthly: number;
              targetCloseMonthly: number;
              targetFatturatoMonthly: number;
              fatturatoExtraEur: number;
          } | null;
          rows: MetricsOverviewRow[];
          trattativeSuLeadPct: number | null;
      }
    | { success: false; error: string };

/** Start/end of "today" in Europe/Rome as UTC-aligned Dates. */
function todayBoundsRome(): { start: Date; end: Date } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
    const y = parseInt(parts.year, 10);
    const m = parseInt(parts.month, 10);
    const d = parseInt(parts.day, 10);
    // Rome is UTC+1 or UTC+2. We bracket generously to avoid DST issues.
    const offsetParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Rome', timeZoneName: 'longOffset'
    }).formatToParts(new Date());
    const offsetLabel = offsetParts.find(p => p.type === 'timeZoneName')?.value || 'GMT+01:00';
    const offset = offsetLabel.replace('GMT', '') || '+01:00';
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00${offset}`);
    const end = new Date(`${y}-${pad(m)}-${pad(d)}T23:59:59.999${offset}`);
    return { start, end };
}

export async function getMetricsOverview(yearMonth?: string): Promise<MetricsOverviewResult> {
    try {
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        const ym = yearMonth || currentYearMonthRome();

        // 1) Re-use funnel overview to get totals — keeps the new table perfectly
        //    coherent with the "Funnel Overview" table above it (Bruno's requirement).
        const funnelOverview = await getFunnelOverview(ym);
        if (!funnelOverview.success) {
            return { success: false, error: funnelOverview.error };
        }
        const { totals } = funnelOverview;

        // 2) Fetch target config
        const [cfg] = await db.select().from(monthlyLeadTargets)
            .where(eq(monthlyLeadTargets.yearMonth, ym));

        const isConfigured = !!cfg;

        // 3) Working days
        const { year, month } = parseYearMonth(ym);
        const workingDays = cfg?.workingDays || countWorkingDaysInMonth(year, month);
        const elapsed = countWorkingDaysElapsed(year, month, new Date());

        // 4) TODAY counts — live from leads table, Europe/Rome midnight bounds
        const { start: todayStart, end: todayEnd } = todayBoundsRome();

        const [appToday, confToday, presToday, closeToday, valoreTodayRows] = await Promise.all([
            db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
                gte(leads.appointmentCreatedAt, todayStart),
                lt(leads.appointmentCreatedAt, todayEnd),
            )),
            db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
                gte(leads.confirmationsTimestamp, todayStart),
                lt(leads.confirmationsTimestamp, todayEnd),
                eq(leads.confirmationsOutcome, 'confermato'),
            )),
            db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
                gte(leads.salespersonOutcomeAt, todayStart),
                lt(leads.salespersonOutcomeAt, todayEnd),
                sql`${leads.salespersonOutcome} IN ('Chiuso', 'Non chiuso')`,
            )),
            db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
                gte(leads.salespersonOutcomeAt, todayStart),
                lt(leads.salespersonOutcomeAt, todayEnd),
                eq(leads.salespersonOutcome, 'Chiuso'),
            )),
            db.select({
                s: sql<number>`COALESCE(SUM(${leads.closeAmountEur}), 0)::real`,
            }).from(leads).where(and(
                gte(leads.salespersonOutcomeAt, todayStart),
                lt(leads.salespersonOutcomeAt, todayEnd),
                eq(leads.salespersonOutcome, 'Chiuso'),
            )),
        ]);

        const todayApp = appToday[0]?.c || 0;
        const todayConf = confToday[0]?.c || 0;
        const todayPres = presToday[0]?.c || 0;
        const todayClose = closeToday[0]?.c || 0;
        const todayValore = Number(valoreTodayRows[0]?.s || 0);

        // 5) ACT — from funnel overview totals + revenue from live CRM
        const actLead = totals.leadCount;
        const actApp = totals.appCount;
        const actConf = totals.confermeCount;
        const actPres = totals.trattativeCount;
        const actClose = totals.closeCount;

        // Fatturato ACT = live sum of closeAmountEur for closed leads in the month + manual extra
        const [valoreMeseRow] = await db.select({
            s: sql<number>`COALESCE(SUM(${leads.closeAmountEur}), 0)::real`,
        }).from(leads).where(and(
            gte(leads.salespersonOutcomeAt, new Date(Date.UTC(year, month - 1, 1))),
            lt(leads.salespersonOutcomeAt, new Date(Date.UTC(year, month, 1))),
            eq(leads.salespersonOutcome, 'Chiuso'),
        ));
        const actValore = Number(valoreMeseRow?.s || 0) + (cfg?.fatturatoExtraEur || 0);

        // 6) Target monthly values (from config). Target proportional = monthly / workingDays * elapsed.
        const targetAppMonthly = cfg?.targetAppMonthly || 0;
        const targetConfMonthly = cfg?.targetConfMonthly || 0;
        const targetPresMonthly = cfg?.targetPresMonthly || 0;
        const targetCloseMonthly = cfg?.targetCloseMonthly || 0;
        const targetFatturatoMonthly = cfg?.targetFatturatoMonthly || 0;

        const dayFactor = workingDays > 0 ? elapsed / workingDays : 0;

        const targetPrevApp = targetAppMonthly * dayFactor;
        const targetPrevConf = targetConfMonthly * dayFactor;
        const targetPrevPres = targetPresMonthly * dayFactor;
        const targetPrevClose = targetCloseMonthly * dayFactor;
        const targetPrevFatturato = targetFatturatoMonthly * dayFactor;

        const targetPerDayApp = workingDays > 0 ? targetAppMonthly / workingDays : 0;
        const targetPerDayConf = workingDays > 0 ? targetConfMonthly / workingDays : 0;
        const targetPerDayPres = workingDays > 0 ? targetPresMonthly / workingDays : 0;
        const targetPerDayClose = workingDays > 0 ? targetCloseMonthly / workingDays : 0;
        const targetPerDayFatturato = workingDays > 0 ? targetFatturatoMonthly / workingDays : 0;

        // Percentages (funnel cascade) — both for ACT and TARGET
        function safeDiv(n: number, d: number): number | null {
            return d > 0 ? (n / d) * 100 : null;
        }

        const rows: MetricsOverviewRow[] = [
            {
                label: 'Appuntamenti fissati',
                actCount: actApp,
                actPct: safeDiv(actApp, actLead),
                targetPrevCount: Math.round(targetPrevApp),
                targetPrevPct: safeDiv(targetPrevApp, actLead),
                targetPerDay: targetPerDayApp,
                today: todayApp,
            },
            {
                label: 'Appuntamenti Confermati',
                actCount: actConf,
                actPct: safeDiv(actConf, actApp),
                targetPrevCount: Math.round(targetPrevConf),
                targetPrevPct: safeDiv(targetPrevConf, targetPrevApp),
                targetPerDay: targetPerDayConf,
                today: todayConf,
            },
            {
                label: 'Trattative presenziati',
                actCount: actPres,
                actPct: safeDiv(actPres, actConf),
                targetPrevCount: Math.round(targetPrevPres),
                targetPrevPct: safeDiv(targetPrevPres, targetPrevConf),
                targetPerDay: targetPerDayPres,
                today: todayPres,
            },
            {
                label: 'Closed',
                actCount: actClose,
                actPct: safeDiv(actClose, actPres),
                targetPrevCount: Math.round(targetPrevClose),
                targetPrevPct: safeDiv(targetPrevClose, targetPrevPres),
                targetPerDay: targetPerDayClose,
                today: todayClose,
            },
            {
                label: 'Valore Contratti firmati',
                actCount: actValore,
                actPct: null,
                targetPrevCount: Math.round(targetPrevFatturato),
                targetPrevPct: null,
                targetPerDay: targetPerDayFatturato,
                today: todayValore,
                isCurrency: true,
            },
        ];

        const trattativeSuLeadPct = safeDiv(actPres, actLead);

        return {
            success: true,
            yearMonth: ym,
            workingDays,
            workingDaysElapsed: elapsed,
            isConfigured,
            config: cfg ? {
                targetAppMonthly,
                targetConfMonthly,
                targetPresMonthly,
                targetCloseMonthly,
                targetFatturatoMonthly,
                fatturatoExtraEur: cfg.fatturatoExtraEur || 0,
            } : null,
            rows,
            trattativeSuLeadPct,
        };
    } catch (error: any) {
        console.error('Errore getMetricsOverview:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Funnel Overview table — per-funnel APP/CONFERME/TRATTATIVE/CLOSE + ROAS
// ─────────────────────────────────────────────────────────────────────────

export type FunnelStato = 'OK' | 'PRE_RISK' | 'ALLERT';

export type FunnelOverviewRow = {
    funnelName: string;
    leadCount: number;
    appCount: number;
    appPct: number | null;
    confermeCount: number;
    confermePct: number | null;
    trattativeCount: number;
    trattativePct: number | null;
    closeCount: number;
    closePct: number | null;
    fatturatoEur: number;
    spesaEur: number;
    roas: number | null;
    dataPrimoSottoSoglia: string | null;
    statoSegnalazione: FunnelStato;
};

export type FunnelOverviewResult =
    | {
          success: true;
          yearMonth: string;
          rows: FunnelOverviewRow[];
          totals: {
              leadCount: number;
              appCount: number;
              confermeCount: number;
              trattativeCount: number;
              closeCount: number;
              fatturatoEur: number;
              spesaEur: number;
              roas: number | null;
          };
      }
    | { success: false; error: string };

type CrmCounts = { app: number; conferme: number; trattative: number; close: number };

async function getCrmFunnelCounts(yearMonth: string): Promise<Map<string, CrmCounts>> {
    const { year, month } = parseYearMonth(yearMonth);
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const rows = await db
        .select({
            funnel: sql<string>`UPPER(COALESCE(${leads.funnel}, ''))`,
            app: sql<number>`(count(*) FILTER (WHERE ${leads.status} = 'APPOINTMENT' OR ${leads.appointmentDate} IS NOT NULL))::int`,
            conferme: sql<number>`(count(*) FILTER (WHERE ${leads.confirmationsOutcome} = 'confermato'))::int`,
            trattative: sql<number>`(count(*) FILTER (WHERE ${leads.salespersonOutcome} IN ('Chiuso', 'Non chiuso')))::int`,
            close: sql<number>`(count(*) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso'))::int`,
        })
        .from(leads)
        .where(and(
            gte(leads.createdAt, monthStart),
            lt(leads.createdAt, monthEnd),
            sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('TEST', '')`,
        ))
        .groupBy(sql`UPPER(COALESCE(${leads.funnel}, ''))`);

    const map = new Map<string, CrmCounts>();
    for (const r of rows) {
        map.set(r.funnel, {
            app: r.app,
            conferme: r.conferme,
            trattative: r.trattative,
            close: r.close,
        });
    }
    return map;
}

/**
 * Apply the PRE_RISK / ALLERT state machine based on current close percentage
 * vs. 1% threshold (strictly). Side-effect: writes the updated state back to
 * the DB when it transitions. Returns the resolved state.
 */
async function resolveAlertState(
    row: typeof monthlyFunnelBaselines.$inferSelect,
    closeCount: number,
): Promise<{ dataPrimoSottoSoglia: Date | null; statoSegnalazione: FunnelStato }> {
    const now = new Date();
    // Close% denominator = leadCount (the absolute "fixed" value per Bruno)
    const closePct = row.leadCount > 0 ? (closeCount / row.leadCount) * 100 : null;

    // If leadCount is 0 → no basis for percentage → OK + null date
    if (closePct === null) {
        if (row.dataPrimoSottoSoglia || row.statoSegnalazione !== 'OK') {
            await db.update(monthlyFunnelBaselines).set({
                dataPrimoSottoSoglia: null,
                statoSegnalazione: 'OK',
                updatedAt: now,
            }).where(eq(monthlyFunnelBaselines.id, row.id));
        }
        return { dataPrimoSottoSoglia: null, statoSegnalazione: 'OK' };
    }

    // Above 1% (strictly) → OK + reset
    if (closePct > 1) {
        if (row.dataPrimoSottoSoglia || row.statoSegnalazione !== 'OK') {
            await db.update(monthlyFunnelBaselines).set({
                dataPrimoSottoSoglia: null,
                statoSegnalazione: 'OK',
                updatedAt: now,
            }).where(eq(monthlyFunnelBaselines.id, row.id));
        }
        return { dataPrimoSottoSoglia: null, statoSegnalazione: 'OK' };
    }

    // Below or equal to 1% → trouble
    const storedDate = row.dataPrimoSottoSoglia;
    if (!storedDate) {
        // Just dropped below — record today as the reference
        const newState: FunnelStato = 'PRE_RISK';
        await db.update(monthlyFunnelBaselines).set({
            dataPrimoSottoSoglia: now,
            statoSegnalazione: newState,
            updatedAt: now,
        }).where(eq(monthlyFunnelBaselines.id, row.id));
        return { dataPrimoSottoSoglia: now, statoSegnalazione: newState };
    }

    // Already below — escalate to ALLERT after 7 full days
    const daysElapsed = (now.getTime() - new Date(storedDate).getTime()) / (1000 * 60 * 60 * 24);
    const newState: FunnelStato = daysElapsed > 7 ? 'ALLERT' : 'PRE_RISK';
    if (newState !== row.statoSegnalazione) {
        await db.update(monthlyFunnelBaselines).set({
            statoSegnalazione: newState,
            updatedAt: now,
        }).where(eq(monthlyFunnelBaselines.id, row.id));
    }
    return { dataPrimoSottoSoglia: storedDate, statoSegnalazione: newState };
}

function pct(num: number, den: number): number | null {
    return den > 0 ? (num / den) * 100 : null;
}

export async function getFunnelOverview(yearMonth?: string): Promise<FunnelOverviewResult> {
    try {
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        const ym = yearMonth || currentYearMonthRome();

        // 1) Load baseline rows for the month
        const baselines = await db.select().from(monthlyFunnelBaselines)
            .where(eq(monthlyFunnelBaselines.yearMonth, ym));

        // 2) Live CRM counts per funnel (uppercased, excluding TEST/empty)
        const crmMap = await getCrmFunnelCounts(ym);

        // 3) Merge: include all baseline funnels, plus any CRM funnel that isn't in the baseline yet
        const allFunnels = new Set<string>();
        for (const b of baselines) allFunnels.add(b.funnelName);
        for (const f of crmMap.keys()) allFunnels.add(f);

        // Preserve a stable display order matching the Excel layout, then append any extras alphabetically
        const CANONICAL_ORDER = ['TELEGRAM', 'JOB SIMULATOR', 'CORSO 10 ORE', 'ORG', 'DATABASE', 'GOOGLE', 'SOCIAL', 'TELEGRAM-TK'];
        const extras = [...allFunnels].filter(f => !CANONICAL_ORDER.includes(f)).sort();
        const ordered = [...CANONICAL_ORDER.filter(f => allFunnels.has(f)), ...extras];

        const rows: FunnelOverviewRow[] = [];
        let totalLead = 0, totalApp = 0, totalConf = 0, totalTratt = 0, totalClose = 0, totalFat = 0, totalSpesa = 0;

        for (const funnelName of ordered) {
            const baseline = baselines.find(b => b.funnelName === funnelName);
            const crm = crmMap.get(funnelName) || { app: 0, conferme: 0, trattative: 0, close: 0 };

            // If no baseline row exists yet, create an empty one in memory (not persisted until the admin edits).
            // leadCount default = CRM count of the "Nuovi" category (not tracked here), so use 0 — admin must set it.
            const leadCount = baseline?.leadCount ?? 0;
            const appCount = crm.app + (baseline?.appDelta ?? 0);
            const confermeCount = crm.conferme + (baseline?.confermeDelta ?? 0);
            const trattativeCount = crm.trattative + (baseline?.trattativeDelta ?? 0);
            const closeCount = crm.close + (baseline?.closeDelta ?? 0);
            const fatturatoEur = baseline?.fatturatoEur ?? 0;
            const spesaEur = baseline?.spesaEur ?? 0;

            // Resolve alert state (side-effect: may update DB)
            let dataPrimoSottoSoglia: string | null = null;
            let statoSegnalazione: FunnelStato = 'OK';
            if (baseline) {
                const resolved = await resolveAlertState(baseline, closeCount);
                dataPrimoSottoSoglia = resolved.dataPrimoSottoSoglia ? resolved.dataPrimoSottoSoglia.toISOString() : null;
                statoSegnalazione = resolved.statoSegnalazione;
            }

            rows.push({
                funnelName,
                leadCount,
                appCount,
                appPct: pct(appCount, leadCount),
                confermeCount,
                confermePct: pct(confermeCount, leadCount),
                trattativeCount,
                trattativePct: pct(trattativeCount, leadCount),
                closeCount,
                closePct: pct(closeCount, leadCount),
                fatturatoEur,
                spesaEur,
                roas: spesaEur > 0 ? fatturatoEur / spesaEur : null,
                dataPrimoSottoSoglia,
                statoSegnalazione,
            });

            totalLead += leadCount;
            totalApp += appCount;
            totalConf += confermeCount;
            totalTratt += trattativeCount;
            totalClose += closeCount;
            totalFat += fatturatoEur;
            totalSpesa += spesaEur;
        }

        return {
            success: true,
            yearMonth: ym,
            rows,
            totals: {
                leadCount: totalLead,
                appCount: totalApp,
                confermeCount: totalConf,
                trattativeCount: totalTratt,
                closeCount: totalClose,
                fatturatoEur: totalFat,
                spesaEur: totalSpesa,
                roas: totalSpesa > 0 ? totalFat / totalSpesa : null,
            },
        };
    } catch (error: any) {
        console.error('Errore getFunnelOverview:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

/**
 * Upsert a funnel baseline row. Admin-only.
 *
 * Inputs are the DISPLAYED values (what the admin types into the modal).
 * For the delta fields (app/conferme/trattative/close), we re-query the live
 * CRM count for that funnel and store `new_delta = displayed - crm_count`,
 * so future CRM changes keep updating the counter on top of the edit.
 * Lead / fatturato / spesa are stored as absolute values.
 */
export async function setFunnelRow(input: {
    yearMonth: string;
    funnelName: string;
    leadCount: number;
    appDisplay: number;
    confermeDisplay: number;
    trattativeDisplay: number;
    closeDisplay: number;
    fatturatoEur: number;
    spesaEur: number;
}) {
    try {
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) {
            return { success: false, error: 'yearMonth deve essere YYYY-MM' };
        }
        if (!input.funnelName || input.funnelName.trim() === '') {
            return { success: false, error: 'funnelName obbligatorio' };
        }

        const funnelName = input.funnelName.trim().toUpperCase();
        if (funnelName === 'TEST') {
            return { success: false, error: 'Il funnel TEST è ignorato' };
        }

        // Re-query current CRM count to compute deltas
        const crmMap = await getCrmFunnelCounts(input.yearMonth);
        const crm = crmMap.get(funnelName) || { app: 0, conferme: 0, trattative: 0, close: 0 };

        const appDelta = Math.round(input.appDisplay - crm.app);
        const confermeDelta = Math.round(input.confermeDisplay - crm.conferme);
        const trattativeDelta = Math.round(input.trattativeDisplay - crm.trattative);
        const closeDelta = Math.round(input.closeDisplay - crm.close);

        const [existing] = await db.select().from(monthlyFunnelBaselines).where(and(
            eq(monthlyFunnelBaselines.yearMonth, input.yearMonth),
            eq(monthlyFunnelBaselines.funnelName, funnelName),
        ));

        const now = new Date();

        if (existing) {
            await db.update(monthlyFunnelBaselines).set({
                leadCount: Math.round(input.leadCount),
                appDelta,
                confermeDelta,
                trattativeDelta,
                closeDelta,
                fatturatoEur: input.fatturatoEur,
                spesaEur: input.spesaEur,
                updatedAt: now,
            }).where(eq(monthlyFunnelBaselines.id, existing.id));
        } else {
            await db.insert(monthlyFunnelBaselines).values({
                id: crypto.randomUUID(),
                yearMonth: input.yearMonth,
                funnelName,
                leadCount: Math.round(input.leadCount),
                appDelta,
                confermeDelta,
                trattativeDelta,
                closeDelta,
                fatturatoEur: input.fatturatoEur,
                spesaEur: input.spesaEur,
                statoSegnalazione: 'OK',
                createdAt: now,
                updatedAt: now,
            });
        }

        return { success: true };
    } catch (error: any) {
        console.error('Errore setFunnelRow:', error);
        return { success: false, error: error?.message || String(error) };
    }
}
