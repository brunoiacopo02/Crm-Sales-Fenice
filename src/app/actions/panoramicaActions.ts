'use server';

import { db } from "@/db";
import { leads, monthlyLeadTargets, monthlyFunnelBaselines } from "@/db/schema";
import { and, gte, lt, sql, eq, or } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import { currentTenant, assertSalesArea, assertSingleCompany, type TenantContext } from '@/lib/tenancy';
import { isConfermeTl } from "@/lib/confermeTl";
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

/**
 * Guard di sola lettura per la dashboard Sales Manager: oltre all'ADMIN,
 * consente l'accesso in lettura al TL del team Conferme (Alberto, gating per
 * email via isConfermeTl). NON usare per le mutation: i target restano ADMIN-only.
 */
async function requireSalesOverviewRead() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const role = user.user_metadata?.role;
    if (role === 'ADMIN') return { id: user.id, role };
    if (role === 'CONFERME' && isConfermeTl(user.email)) return { id: user.id, role };
    return null;
}

/**
 * Ctx "forzato" su una singola azienda, usato in modalità "Tutte le aziende"
 * per calcolare la panoramica per ciascuna azienda con la logica single-company
 * esistente (baseline/delta per-azienda preservati), prima di sommare i risultati.
 */
function singleCompanyCtx(ctx: TenantContext, companyId: string): TenantContext {
    return { ...ctx, companyId, isAllCompanies: false };
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
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        const admin = await requireSalesOverviewRead();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        const ym = yearMonth || currentYearMonthRome();
        if (ctx.isAllCompanies) {
            const parts = await Promise.all(
                ctx.allowedCompanies.map((c) => leadOverviewForCompany(singleCompanyCtx(ctx, c), ym)),
            );
            return mergeLeadOverviews(parts, ym);
        }
        return await leadOverviewForCompany(ctx, ym);
    } catch (error: any) {
        console.error('Errore getLeadOverview:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

async function leadOverviewForCompany(ctx: TenantContext, ym: string): Promise<LeadOverviewResult> {
    try {
        const { year, month } = parseYearMonth(ym);

        // Month boundaries — Europe/Rome interpreted via UTC-ish dates. We use UTC
        // midpoints to avoid DST off-by-one; the DB column is timestamptz.
        const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0));

        // Load config for this month
        const [cfg] = await db.select().from(monthlyLeadTargets)
            .where(and(
                eq(monthlyLeadTargets.companyId, ctx.companyId),
                eq(monthlyLeadTargets.yearMonth, ym),
            ));

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
                eq(leads.companyId, ctx.companyId),
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
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };
        assertSingleCompany(ctx); // scrittura: bloccata in modalità "Tutte le aziende"

        if (input.targetNuovi < 0 || input.targetDatabase < 0 || input.workingDays <= 0) {
            return { success: false, error: 'Valori non validi' };
        }
        if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) {
            return { success: false, error: 'yearMonth deve essere YYYY-MM' };
        }

        const [existing] = await db.select().from(monthlyLeadTargets)
            .where(and(
                eq(monthlyLeadTargets.companyId, ctx.companyId),
                eq(monthlyLeadTargets.yearMonth, input.yearMonth),
            ));

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
            }).where(and(
                eq(monthlyLeadTargets.companyId, ctx.companyId),
                eq(monthlyLeadTargets.id, existing.id),
            ));
        } else {
            await db.insert(monthlyLeadTargets).values({
                id: crypto.randomUUID(),
                companyId: ctx.companyId,
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
    targetAppPct: number;
    targetConfPct: number;
    targetPresPct: number;
    targetClosePct: number;
}) {
    try {
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };
        assertSingleCompany(ctx); // scrittura: bloccata in modalità "Tutte le aziende"

        if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) {
            return { success: false, error: 'yearMonth deve essere YYYY-MM' };
        }
        if ([input.targetAppMonthly, input.targetConfMonthly, input.targetPresMonthly,
             input.targetCloseMonthly, input.targetFatturatoMonthly].some(v => v < 0)) {
            return { success: false, error: 'I target non possono essere negativi' };
        }
        if ([input.targetAppPct, input.targetConfPct, input.targetPresPct, input.targetClosePct]
            .some(v => v < 0 || v > 100)) {
            return { success: false, error: 'Le percentuali devono essere tra 0 e 100' };
        }

        const [existing] = await db.select().from(monthlyLeadTargets)
            .where(and(
                eq(monthlyLeadTargets.companyId, ctx.companyId),
                eq(monthlyLeadTargets.yearMonth, input.yearMonth),
            ));

        const now = new Date();

        if (existing) {
            await db.update(monthlyLeadTargets).set({
                targetAppMonthly: input.targetAppMonthly,
                targetConfMonthly: input.targetConfMonthly,
                targetPresMonthly: input.targetPresMonthly,
                targetCloseMonthly: input.targetCloseMonthly,
                targetFatturatoMonthly: input.targetFatturatoMonthly,
                fatturatoExtraEur: input.fatturatoExtraEur,
                targetAppPct: input.targetAppPct,
                targetConfPct: input.targetConfPct,
                targetPresPct: input.targetPresPct,
                targetClosePct: input.targetClosePct,
                updatedAt: now,
            }).where(and(
                eq(monthlyLeadTargets.companyId, ctx.companyId),
                eq(monthlyLeadTargets.id, existing.id),
            ));
        } else {
            // No lead-target row yet → create a stub with zero lead targets.
            await db.insert(monthlyLeadTargets).values({
                id: crypto.randomUUID(),
                companyId: ctx.companyId,
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
                targetAppPct: input.targetAppPct,
                targetConfPct: input.targetConfPct,
                targetPresPct: input.targetPresPct,
                targetClosePct: input.targetClosePct,
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
              targetAppPct: number;
              targetConfPct: number;
              targetPresPct: number;
              targetClosePct: number;
          } | null;
          rows: MetricsOverviewRow[];
          trattativeSuLeadPct: number | null;
          aovEur: number | null;
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
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        const admin = await requireSalesOverviewRead();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        const ym = yearMonth || currentYearMonthRome();
        if (ctx.isAllCompanies) {
            const parts = await Promise.all(
                ctx.allowedCompanies.map((c) => metricsOverviewForCompany(singleCompanyCtx(ctx, c), ym)),
            );
            // Lead aggregato (già sommato) come denominatore per le % "su lead".
            const aggLead = await getLeadOverview(ym);
            const actLead = aggLead.success ? aggLead.totals.actCount : 0;
            return mergeMetricsOverviews(parts, ym, actLead);
        }
        return await metricsOverviewForCompany(ctx, ym);
    } catch (error: any) {
        console.error('Errore getMetricsOverview:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

async function metricsOverviewForCompany(ctx: TenantContext, ym: string): Promise<MetricsOverviewResult> {
    try {
        // 1) Re-use funnel overview to get APP/Conf/Trat/Close totals (per stage).
        const funnelOverview = await funnelOverviewForCompany(ctx, ym);
        if (!funnelOverview.success) {
            return { success: false, error: funnelOverview.error };
        }
        const { totals } = funnelOverview;

        // Il totale lead per la % ACT deve essere quello mostrato nella tabella
        // "Caricamento Lead" sopra (baseline + lead caricati nel mese), non il
        // conteggio funnel — così le due tabelle restano coerenti.
        const leadOverview = await leadOverviewForCompany(ctx, ym);
        const actLeadFromOverview = leadOverview.success ? leadOverview.totals.actCount : 0;

        // 2) Fetch target config
        const [cfg] = await db.select().from(monthlyLeadTargets)
            .where(and(
                eq(monthlyLeadTargets.companyId, ctx.companyId),
                eq(monthlyLeadTargets.yearMonth, ym),
            ));

        const isConfigured = !!cfg;

        // 3) Working days
        const { year, month } = parseYearMonth(ym);
        const workingDays = cfg?.workingDays || countWorkingDaysInMonth(year, month);
        const elapsed = countWorkingDaysElapsed(year, month, new Date());

        // 4) TODAY counts — live from leads table, Europe/Rome midnight bounds
        const { start: todayStart, end: todayEnd } = todayBoundsRome();

        // TODAY counts (semantica: "cosa stiamo facendo oggi"):
        //  - APP: appointmentCreatedAt = oggi (fissaggi GDO eseguiti oggi per giorni futuri)
        //  - Conferme: appointmentDate = oggi AND confirmationsOutcome = 'confermato'
        //    (gli appuntamenti che il team Conferme deve sciogliere oggi)
        //  - Presenziati: appointmentDate = oggi (il meeting è fisicamente di oggi)
        //  - Close/Valore: salespersonOutcomeAt = oggi (la chiusura è stata fatta
        //    oggi, indipendentemente da quando era l'appuntamento — il venditore
        //    può chiudere oggi un deal il cui meeting era ieri).
        const [appToday, confToday, presToday, closeToday, valoreTodayRows] = await Promise.all([
            db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
                eq(leads.companyId, ctx.companyId),
                gte(leads.appointmentCreatedAt, todayStart),
                lt(leads.appointmentCreatedAt, todayEnd),
            )),
            db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
                eq(leads.companyId, ctx.companyId),
                gte(leads.appointmentDate, todayStart),
                lt(leads.appointmentDate, todayEnd),
                eq(leads.confirmationsOutcome, 'confermato'),
            )),
            db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
                eq(leads.companyId, ctx.companyId),
                gte(leads.appointmentDate, todayStart),
                lt(leads.appointmentDate, todayEnd),
                sql`${leads.salespersonOutcome} IN ('Chiuso', 'Non chiuso')`,
            )),
            db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
                eq(leads.companyId, ctx.companyId),
                gte(leads.salespersonOutcomeAt, todayStart),
                lt(leads.salespersonOutcomeAt, todayEnd),
                eq(leads.salespersonOutcome, 'Chiuso'),
            )),
            db.select({
                s: sql<number>`COALESCE(SUM(${leads.closeAmountEur}), 0)::real`,
            }).from(leads).where(and(
                eq(leads.companyId, ctx.companyId),
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

        // 5) ACT — from funnel overview totals + revenue from live CRM.
        //    actLead = totale della tabella "Caricamento Lead" (baseline + live),
        //    NON totals.leadCount del funnel — così la % ACT Fissati matcha
        //    esattamente il numero che il manager vede nella tabella sopra.
        const actLead = actLeadFromOverview;
        // Funnel table totals + extra offsets (for when the Excel "Numeri Mensili"
        // totals don't match the per-funnel delta sums)
        const actApp = totals.appCount + (cfg?.appExtra || 0);
        const actConf = totals.confermeCount + (cfg?.confermeExtra || 0);
        const actPres = totals.trattativeCount + (cfg?.trattativeExtra || 0);
        const actClose = totals.closeCount + (cfg?.closeExtra || 0);

        // Fatturato ACT = somma closeAmountEur dei lead chiusi nel mese.
        // Campo data canonico = salespersonOutcomeAt (allineato a getMarketingStats
        // del Sales Manager e a getVenditoriKpi). Prima usavamo COALESCE su 3 campi
        // → divergeva dal Sales Manager / KPI Venditori per gli stessi mesi.
        const [valoreMeseRow] = await db.select({
            s: sql<number>`COALESCE(SUM(${leads.closeAmountEur}), 0)::real`,
        }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
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

        // Target percentages a cascata (fallback se non c'è valore manuale).
        const targetLeadMonthly = cfg ? cfg.targetNuovi + cfg.targetDatabase : 0;
        // Se il manager imposta una % manuale (> 0) la usiamo, altrimenti fallback
        // alla % a cascata calcolata dai target assoluti.
        const pickPct = (manual: number, cascadeN: number, cascadeD: number): number | null =>
            manual > 0 ? manual : safeDiv(cascadeN, cascadeD);

        const targetAppPct = cfg?.targetAppPct || 0;
        const targetConfPct = cfg?.targetConfPct || 0;
        const targetPresPct = cfg?.targetPresPct || 0;
        const targetClosePct = cfg?.targetClosePct || 0;

        const rows: MetricsOverviewRow[] = [
            {
                label: 'Appuntamenti fissati',
                actCount: actApp,
                actPct: safeDiv(actApp, actLead),
                targetPrevCount: Math.round(targetPrevApp),
                targetPrevPct: pickPct(targetAppPct, targetAppMonthly, targetLeadMonthly),
                targetPerDay: targetPerDayApp,
                today: todayApp,
            },
            {
                label: 'Appuntamenti Confermati',
                actCount: actConf,
                actPct: safeDiv(actConf, actApp),
                targetPrevCount: Math.round(targetPrevConf),
                targetPrevPct: pickPct(targetConfPct, targetConfMonthly, targetAppMonthly),
                targetPerDay: targetPerDayConf,
                today: todayConf,
            },
            {
                label: 'Trattative presenziati',
                actCount: actPres,
                actPct: safeDiv(actPres, actConf),
                targetPrevCount: Math.round(targetPrevPres),
                targetPrevPct: pickPct(targetPresPct, targetPresMonthly, targetConfMonthly),
                targetPerDay: targetPerDayPres,
                today: todayPres,
            },
            {
                label: 'Closed',
                actCount: actClose,
                actPct: safeDiv(actClose, actPres),
                targetPrevCount: Math.round(targetPrevClose),
                targetPrevPct: pickPct(targetClosePct, targetCloseMonthly, targetPresMonthly),
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
        const aovEur = actClose > 0 ? actValore / actClose : null;

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
                targetAppPct,
                targetConfPct,
                targetPresPct,
                targetClosePct,
            } : null,
            rows,
            trattativeSuLeadPct,
            aovEur,
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

type CrmCounts = { app: number; conferme: number; trattative: number; close: number; fatturato: number };

/**
 * Count CRM events per funnel for the given month.
 * Ogni metrica è attribuita al mese in cui è avvenuta l'azione corrispondente,
 * NON al mese di creazione del lead. Stesso pattern di marketingActions
 * (post-f8992e1): pesca i lead con OR su tutte le date evento, poi conta in
 * ogni bucket solo se la data evento corrispondente cade nel mese.
 */
async function getCrmFunnelCounts(yearMonth: string, companyId: string): Promise<Map<string, CrmCounts>> {
    const { year, month } = parseYearMonth(yearMonth);
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const inMonth = (d: Date | null | undefined): boolean =>
        !!d && d >= monthStart && d < monthEnd;

    const rows = await db.select().from(leads).where(and(
        eq(leads.companyId, companyId),
        sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('TEST', '')`,
        or(
            and(gte(leads.appointmentCreatedAt, monthStart), lt(leads.appointmentCreatedAt, monthEnd)),
            and(gte(leads.appointmentDate, monthStart), lt(leads.appointmentDate, monthEnd)),
            and(gte(leads.confirmationsTimestamp, monthStart), lt(leads.confirmationsTimestamp, monthEnd)),
            and(gte(leads.salespersonOutcomeAt, monthStart), lt(leads.salespersonOutcomeAt, monthEnd)),
        ),
    ));

    const map = new Map<string, CrmCounts>();
    for (const l of rows) {
        const funnel = (l.funnel ?? '').toUpperCase();
        if (!funnel || funnel === 'TEST') continue;
        let bucket = map.get(funnel);
        if (!bucket) {
            bucket = { app: 0, conferme: 0, trattative: 0, close: 0, fatturato: 0 };
            map.set(funnel, bucket);
        }

        // App fissati: data fissaggio = appointmentCreatedAt (fallback appointmentDate per dati legacy).
        const apptSetAt = l.appointmentCreatedAt || l.appointmentDate;
        if (l.appointmentDate && inMonth(apptSetAt)) {
            bucket.app++;
        }
        // Conferme: data esito Conferme nel mese.
        if (l.confirmationsOutcome === 'confermato' && inMonth(l.confirmationsTimestamp)) {
            bucket.conferme++;
        }
        // Trattative: presenziato nel mese (whitelist Chiuso/Non chiuso).
        if (
            (l.salespersonOutcome === 'Chiuso' || l.salespersonOutcome === 'Non chiuso')
            && inMonth(l.salespersonOutcomeAt)
        ) {
            bucket.trattative++;
        }
        // Chiusure + fatturato: chiuso nel mese.
        if (l.salespersonOutcome === 'Chiuso' && inMonth(l.salespersonOutcomeAt)) {
            bucket.close++;
            bucket.fatturato += l.closeAmountEur || 0;
        }
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
    companyId: string,
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
            }).where(and(
                eq(monthlyFunnelBaselines.companyId, companyId),
                eq(monthlyFunnelBaselines.id, row.id),
            ));
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
            }).where(and(
                eq(monthlyFunnelBaselines.companyId, companyId),
                eq(monthlyFunnelBaselines.id, row.id),
            ));
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
        }).where(and(
            eq(monthlyFunnelBaselines.companyId, companyId),
            eq(monthlyFunnelBaselines.id, row.id),
        ));
        return { dataPrimoSottoSoglia: now, statoSegnalazione: newState };
    }

    // Already below — escalate to ALLERT after 7 full days
    const daysElapsed = (now.getTime() - new Date(storedDate).getTime()) / (1000 * 60 * 60 * 24);
    const newState: FunnelStato = daysElapsed > 7 ? 'ALLERT' : 'PRE_RISK';
    if (newState !== row.statoSegnalazione) {
        await db.update(monthlyFunnelBaselines).set({
            statoSegnalazione: newState,
            updatedAt: now,
        }).where(and(
            eq(monthlyFunnelBaselines.companyId, companyId),
            eq(monthlyFunnelBaselines.id, row.id),
        ));
    }
    return { dataPrimoSottoSoglia: storedDate, statoSegnalazione: newState };
}

function pct(num: number, den: number): number | null {
    return den > 0 ? (num / den) * 100 : null;
}

export async function getFunnelOverview(yearMonth?: string): Promise<FunnelOverviewResult> {
    try {
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        const admin = await requireSalesOverviewRead();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };

        const ym = yearMonth || currentYearMonthRome();
        if (ctx.isAllCompanies) {
            const parts = await Promise.all(
                ctx.allowedCompanies.map((c) => funnelOverviewForCompany(singleCompanyCtx(ctx, c), ym)),
            );
            return mergeFunnelOverviews(parts, ym);
        }
        return await funnelOverviewForCompany(ctx, ym);
    } catch (error: any) {
        console.error('Errore getFunnelOverview:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

async function funnelOverviewForCompany(ctx: TenantContext, ym: string): Promise<FunnelOverviewResult> {
    try {
        // 1) Load baseline rows for the month
        const baselines = await db.select().from(monthlyFunnelBaselines)
            .where(and(
                eq(monthlyFunnelBaselines.companyId, ctx.companyId),
                eq(monthlyFunnelBaselines.yearMonth, ym),
            ));

        // 1b) Per ogni baseline con baselineSetAt valorizzato, conta quanti
        //     lead CRM sono stati CREATI dopo quel timestamp per quel funnel.
        //     Questo permette all'import automatico di sommare i nuovi lead
        //     al leadCount assoluto storico, senza doppi conteggi.
        const newLeadsByFunnel = new Map<string, number>();
        for (const b of baselines) {
            if (!b.baselineSetAt) continue;
            const [r] = await db.select({ c: sql<number>`count(*)::int` })
                .from(leads)
                .where(and(
                    eq(leads.companyId, ctx.companyId),
                    sql`UPPER(COALESCE(${leads.funnel}, '')) = ${b.funnelName}`,
                    sql`${leads.createdAt} > ${b.baselineSetAt}`,
                ));
            newLeadsByFunnel.set(b.funnelName, Number(r?.c ?? 0));
        }

        // 2) Live CRM counts per funnel (uppercased, excluding TEST/empty).
        //    Counts ALL April leads. The baseline delta is purely external (Excel)
        //    and gets summed on top — no double-counting filter.
        const crmMap = await getCrmFunnelCounts(ym, ctx.companyId);

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
            const crm = crmMap.get(funnelName) || { app: 0, conferme: 0, trattative: 0, close: 0, fatturato: 0 };

            // leadCount = baseline assoluto (quello inserito dall'admin) + lead
            // CRM importati DOPO baselineSetAt. Se non c'è baseline → 0.
            const leadCount = (baseline?.leadCount ?? 0) + (newLeadsByFunnel.get(funnelName) ?? 0);
            const appCount = crm.app + (baseline?.appDelta ?? 0);
            const confermeCount = crm.conferme + (baseline?.confermeDelta ?? 0);
            const trattativeCount = crm.trattative + (baseline?.trattativeDelta ?? 0);
            const closeCount = crm.close + (baseline?.closeDelta ?? 0);
            // Fatturato: live somma chiusure CRM + eventuale extra manuale dall'admin.
            // Stesso pattern dei count (CRM + delta). Se l'admin ha gia' inserito il
            // totale a mano e non vuole sommare i live, lasciare fatturatoEur a 0.
            const fatturatoEur = crm.fatturato + (baseline?.fatturatoEur ?? 0);
            const spesaEur = baseline?.spesaEur ?? 0;

            // Resolve alert state (side-effect: may update DB)
            let dataPrimoSottoSoglia: string | null = null;
            let statoSegnalazione: FunnelStato = 'OK';
            if (baseline) {
                const resolved = await resolveAlertState(baseline, closeCount, ctx.companyId);
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
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        const admin = await requireAdmin();
        if (!admin) return { success: false, error: 'UNAUTHORIZED' };
        assertSingleCompany(ctx); // scrittura: bloccata in modalità "Tutte le aziende"

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
        const crmMap = await getCrmFunnelCounts(input.yearMonth, ctx.companyId);
        const crm = crmMap.get(funnelName) || { app: 0, conferme: 0, trattative: 0, close: 0 };

        const appDelta = Math.round(input.appDisplay - crm.app);
        const confermeDelta = Math.round(input.confermeDisplay - crm.conferme);
        const trattativeDelta = Math.round(input.trattativeDisplay - crm.trattative);
        const closeDelta = Math.round(input.closeDisplay - crm.close);

        const [existing] = await db.select().from(monthlyFunnelBaselines).where(and(
            eq(monthlyFunnelBaselines.companyId, ctx.companyId),
            eq(monthlyFunnelBaselines.yearMonth, input.yearMonth),
            eq(monthlyFunnelBaselines.funnelName, funnelName),
        ));

        const now = new Date();

        // Il valore leadCount ricevuto è il display attuale (baseline + lead
        // CRM importati dopo baselineSetAt). Salvandolo, diventa il nuovo
        // assoluto e resettiamo baselineSetAt a now così da ricominciare
        // il conteggio solo sui lead creati dopo questo save.
        if (existing) {
            await db.update(monthlyFunnelBaselines).set({
                leadCount: Math.round(input.leadCount),
                appDelta,
                confermeDelta,
                trattativeDelta,
                closeDelta,
                fatturatoEur: input.fatturatoEur,
                spesaEur: input.spesaEur,
                baselineSetAt: now,
                updatedAt: now,
            }).where(and(
                eq(monthlyFunnelBaselines.companyId, ctx.companyId),
                eq(monthlyFunnelBaselines.id, existing.id),
            ));
        } else {
            await db.insert(monthlyFunnelBaselines).values({
                id: crypto.randomUUID(),
                companyId: ctx.companyId,
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
                baselineSetAt: now,
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

// ─────────────────────────────────────────────────────────────────────────
// Aggregazione "Tutte le aziende" — merge dei risultati per-azienda
// ─────────────────────────────────────────────────────────────────────────
// Le percentuali sono ricalcolate sui valori assoluti sommati (i conteggi si
// sommano in modo pulito; le % derivate vanno ricomputate). Config sommata solo
// per visualizzazione: l'editing dei target è disabilitato in modalità all.

type OkLead = Extract<LeadOverviewResult, { success: true }>;
type OkFunnel = Extract<FunnelOverviewResult, { success: true }>;
type OkMetrics = Extract<MetricsOverviewResult, { success: true }>;

function mergeLeadOverviews(parts: LeadOverviewResult[], ym: string): LeadOverviewResult {
    const ok = parts.filter((p): p is OkLead => p.success);
    if (ok.length === 0) return parts[0] ?? { success: false, error: 'NO_DATA' };

    const elapsed = ok[0].workingDaysElapsed;
    const sumRow = (label: string, key: 'actCount' | 'targetCount') =>
        ok.reduce((s, p) => s + (p.rows.find(r => r.label === label)?.[key] ?? 0), 0);

    const actNuovi = sumRow('Nuovi', 'actCount');
    const actDb = sumRow('DB', 'actCount');
    const actTotal = actNuovi + actDb;
    const targetNuovi = sumRow('Nuovi', 'targetCount');
    const targetDb = sumRow('DB', 'targetCount');
    const targetTotal = targetNuovi + targetDb;

    const share = (n: number, d: number): number | null => d > 0 ? (n / d) * 100 : null;
    const aggiungere = (current: number, total: number, targetShare: number): number => {
        if (targetShare >= 1 || targetShare <= 0) return 0;
        const currentShare = total > 0 ? current / total : 0;
        if (currentShare >= targetShare) return 0;
        const X = (targetShare * total - current) / (1 - targetShare);
        return Math.max(0, Math.round(X));
    };
    const targetShareNuovi = targetTotal > 0 ? targetNuovi / targetTotal : 0;
    const targetShareDb = targetTotal > 0 ? targetDb / targetTotal : 0;
    const isConfigured = ok.some(p => p.isConfigured);

    const rows: LeadOverviewRow[] = [
        { label: 'Nuovi', actCount: actNuovi, actPercent: actTotal > 0 ? share(actNuovi, actTotal) : null, targetCount: targetNuovi, targetPercent: targetTotal > 0 ? share(targetNuovi, targetTotal) : null, aggiungere: isConfigured ? aggiungere(actNuovi, actTotal, targetShareNuovi) : 0 },
        { label: 'DB', actCount: actDb, actPercent: actTotal > 0 ? share(actDb, actTotal) : null, targetCount: targetDb, targetPercent: targetTotal > 0 ? share(targetDb, targetTotal) : null, aggiungere: isConfigured ? aggiungere(actDb, actTotal, targetShareDb) : 0 },
        { label: 'Totale', actCount: actTotal, actPercent: null, targetCount: targetTotal, targetPercent: null, aggiungere: null },
    ];

    const anyCfg = ok.find(p => p.config)?.config ?? null;
    const config = anyCfg ? {
        targetNuovi: ok.reduce((s, p) => s + (p.config?.targetNuovi ?? 0), 0),
        targetDatabase: ok.reduce((s, p) => s + (p.config?.targetDatabase ?? 0), 0),
        workingDays: anyCfg.workingDays,
        baselineNuovi: ok.reduce((s, p) => s + (p.config?.baselineNuovi ?? 0), 0),
        baselineDatabase: ok.reduce((s, p) => s + (p.config?.baselineDatabase ?? 0), 0),
        baselineSetAt: null,
    } : null;

    return {
        success: true,
        yearMonth: ym,
        isConfigured,
        config,
        workingDaysElapsed: elapsed,
        rows,
        totals: {
            actCount: actTotal,
            actDailyAvg: elapsed > 0 ? Math.round(actTotal / elapsed) : 0,
            targetCount: targetTotal,
            targetDailyAvg: elapsed > 0 ? Math.round(targetTotal / elapsed) : 0,
        },
    };
}

function mergeFunnelOverviews(parts: FunnelOverviewResult[], ym: string): FunnelOverviewResult {
    const ok = parts.filter((p): p is OkFunnel => p.success);
    if (ok.length === 0) return parts[0] ?? { success: false, error: 'NO_DATA' };

    type Acc = { leadCount: number; appCount: number; confermeCount: number; trattativeCount: number; closeCount: number; fatturatoEur: number; spesaEur: number; dataPrimoSottoSoglia: string | null; statoSegnalazione: FunnelStato };
    const byFunnel = new Map<string, Acc>();
    const order: string[] = [];
    const sev = (s: FunnelStato): number => s === 'ALLERT' ? 2 : s === 'PRE_RISK' ? 1 : 0;

    for (const p of ok) {
        for (const r of p.rows) {
            let acc = byFunnel.get(r.funnelName);
            if (!acc) {
                acc = { leadCount: 0, appCount: 0, confermeCount: 0, trattativeCount: 0, closeCount: 0, fatturatoEur: 0, spesaEur: 0, dataPrimoSottoSoglia: null, statoSegnalazione: 'OK' };
                byFunnel.set(r.funnelName, acc);
                order.push(r.funnelName);
            }
            acc.leadCount += r.leadCount;
            acc.appCount += r.appCount;
            acc.confermeCount += r.confermeCount;
            acc.trattativeCount += r.trattativeCount;
            acc.closeCount += r.closeCount;
            acc.fatturatoEur += r.fatturatoEur;
            acc.spesaEur += r.spesaEur;
            if (sev(r.statoSegnalazione) > sev(acc.statoSegnalazione)) acc.statoSegnalazione = r.statoSegnalazione;
            if (r.dataPrimoSottoSoglia && (!acc.dataPrimoSottoSoglia || r.dataPrimoSottoSoglia < acc.dataPrimoSottoSoglia)) {
                acc.dataPrimoSottoSoglia = r.dataPrimoSottoSoglia;
            }
        }
    }

    const pctLocal = (n: number, d: number): number | null => d > 0 ? (n / d) * 100 : null;
    const rows: FunnelOverviewRow[] = order.map(name => {
        const a = byFunnel.get(name)!;
        return {
            funnelName: name,
            leadCount: a.leadCount,
            appCount: a.appCount,
            appPct: pctLocal(a.appCount, a.leadCount),
            confermeCount: a.confermeCount,
            confermePct: pctLocal(a.confermeCount, a.leadCount),
            trattativeCount: a.trattativeCount,
            trattativePct: pctLocal(a.trattativeCount, a.leadCount),
            closeCount: a.closeCount,
            closePct: pctLocal(a.closeCount, a.leadCount),
            fatturatoEur: a.fatturatoEur,
            spesaEur: a.spesaEur,
            roas: a.spesaEur > 0 ? a.fatturatoEur / a.spesaEur : null,
            dataPrimoSottoSoglia: a.dataPrimoSottoSoglia,
            statoSegnalazione: a.statoSegnalazione,
        };
    });

    let tLead = 0, tApp = 0, tConf = 0, tTratt = 0, tClose = 0, tFat = 0, tSpesa = 0;
    for (const r of rows) { tLead += r.leadCount; tApp += r.appCount; tConf += r.confermeCount; tTratt += r.trattativeCount; tClose += r.closeCount; tFat += r.fatturatoEur; tSpesa += r.spesaEur; }

    return {
        success: true,
        yearMonth: ym,
        rows,
        totals: { leadCount: tLead, appCount: tApp, confermeCount: tConf, trattativeCount: tTratt, closeCount: tClose, fatturatoEur: tFat, spesaEur: tSpesa, roas: tSpesa > 0 ? tFat / tSpesa : null },
    };
}

function mergeMetricsOverviews(parts: MetricsOverviewResult[], ym: string, actLead: number): MetricsOverviewResult {
    const ok = parts.filter((p): p is OkMetrics => p.success);
    if (ok.length === 0) return parts[0] ?? { success: false, error: 'NO_DATA' };

    const labels = ok[0].rows.map(r => r.label);
    const sumBy = (i: number, key: 'actCount' | 'targetPrevCount' | 'targetPerDay' | 'today') =>
        ok.reduce((s, p) => s + (p.rows[i]?.[key] ?? 0), 0);

    const a = labels.map((_, i) => sumBy(i, 'actCount'));
    const t = labels.map((_, i) => sumBy(i, 'targetPrevCount'));
    const safeDiv = (n: number, d: number): number | null => d > 0 ? (n / d) * 100 : null;

    // Denominatori a cascata: App su lead, Conf su App, Pres su Conf, Close su Pres.
    const actDenoms: (number | null)[] = [actLead, a[0], a[1], a[2], null];
    const targetDenoms: (number | null)[] = [null, t[0], t[1], t[2], null];

    const rows: MetricsOverviewRow[] = labels.map((label, i) => ({
        label,
        actCount: a[i],
        actPct: actDenoms[i] != null ? safeDiv(a[i], actDenoms[i] as number) : null,
        targetPrevCount: t[i],
        targetPrevPct: targetDenoms[i] != null ? safeDiv(t[i], targetDenoms[i] as number) : null,
        targetPerDay: sumBy(i, 'targetPerDay'),
        today: sumBy(i, 'today'),
        isCurrency: ok[0].rows[i]?.isCurrency,
    }));

    return {
        success: true,
        yearMonth: ym,
        workingDays: ok[0].workingDays,
        workingDaysElapsed: ok[0].workingDaysElapsed,
        isConfigured: ok.some(p => p.isConfigured),
        config: null, // editing target disabilitato in modalità "Tutte le aziende"
        rows,
        trattativeSuLeadPct: safeDiv(a[2], actLead),
        aovEur: a[3] > 0 ? a[4] / a[3] : null,
    };
}
