'use server';

import { db } from "@/db";
import { leads, monthlyLeadTargets } from "@/db/schema";
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

/** Utility: suggest working days for a given month (for the modal prefill). */
export async function getSuggestedWorkingDays(yearMonth: string): Promise<number> {
    try {
        const { year, month } = parseYearMonth(yearMonth);
        return countWorkingDaysInMonth(year, month);
    } catch {
        return 22;
    }
}
