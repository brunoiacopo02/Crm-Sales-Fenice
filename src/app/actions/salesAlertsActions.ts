'use server';

/**
 * Sales Alerts — striscia "Stato Alert" su /panoramica-generale (Sales Manager).
 *
 * Replica la matematica del route marketing /api/marketing/alerts:
 * per ogni metrica si ricostruisce la serie giornaliera del mese corrente
 * (actual cumulato vs target proporzionale), si calcola lo scostamento % e la
 * streak di giorni consecutivi sotto soglia. Sotto soglia per >= 7 giorni
 * consecutivi → ALERT; sotto soglia oggi ma streak < 7 → PRE-ALERT; altrimenti OK.
 *
 * Definizioni actual identiche a panoramicaActions (stesse colonne/whitelist),
 * così le card tornano con i numeri già mostrati in pagina.
 * Spec: docs/superpowers/specs/2026-06-11-sales-alerts-design.md
 */

import { db } from "@/db";
import { leads, monthlyTargets, marketingTargets, metaAccountDaily, users, companies } from "@/db/schema";
import { and, eq, gte, lt, lte, inArray, isNull, isNotNull, or } from "drizzle-orm";
import { currentTenant, assertSalesArea, type TenantContext } from '@/lib/tenancy';
import {
    countWorkingDaysInMonth,
    countWorkingDaysElapsed,
    currentYearMonthRome,
    parseYearMonth,
} from "@/lib/workingDaysUtils";

const DEVIATION_THRESHOLD = -0.20;
const ROAS_THRESHOLD = -0.15;
const CONSECUTIVE_DAYS_FOR_ALERT = 7;

export type SalesAlertStatus = 'ok' | 'pre-alert' | 'alert' | 'no-target';

export type SalesAlertCard = {
    key: string;
    label: string;
    status: SalesAlertStatus;
    /** Scostamento % odierno vs target (es. -0.23 = -23%). null se no-target. */
    deviationToday: number | null;
    consecutiveDaysBelow: number;
    actualToday: number;
    targetToday: number;
    unit: 'eur' | 'count' | 'ratio' | 'avg';
    threshold: number;
};

export type SalesAlertsGroup = {
    companyId: string;
    companyLabel: string;
    cards: SalesAlertCard[];
};

export type SalesAlertsResult =
    | {
        success: true;
        month: string;            // 'YYYY-MM'
        daysSoFar: number;
        totalDays: number;
        thresholds: { metric: number; roas: number; consecutiveDays: number };
        groups: SalesAlertsGroup[];
    }
    | { success: false; error: string };

type DayPoint = { deviation: number | null; belowThreshold: boolean };

function trailingStreak(series: DayPoint[]): number {
    let streak = 0;
    for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].belowThreshold) streak += 1;
        else break;
    }
    return streak;
}

function classify(series: DayPoint[], hasTarget: boolean): { status: SalesAlertStatus; streak: number } {
    if (!hasTarget) return { status: 'no-target', streak: 0 };
    const streak = trailingStreak(series);
    const currentBelow = series[series.length - 1]?.belowThreshold ?? false;
    if (streak >= CONSECUTIVE_DAYS_FOR_ALERT) return { status: 'alert', streak };
    if (currentBelow) return { status: 'pre-alert', streak };
    return { status: 'ok', streak };
}

/** Data calendario Europe/Rome 'YYYY-MM-DD' di un timestamp. */
const romeDayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
});
function toRomeIso(d: Date): string {
    return romeDayFmt.format(d);
}

function singleCompanyCtx(ctx: TenantContext, companyId: string): TenantContext {
    return { ...ctx, companyId, isAllCompanies: false };
}

export async function getSalesAlerts(): Promise<SalesAlertsResult> {
    try {
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        if (ctx.role !== 'ADMIN' && ctx.role !== 'MANAGER') {
            return { success: false, error: 'Non autorizzato' };
        }

        const ym = currentYearMonthRome();
        const { year, month } = parseYearMonth(ym);
        const now = new Date();
        const todayIso = toRomeIso(now);
        const daysSoFar = parseInt(todayIso.slice(8, 10), 10);
        const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

        const companyIds = ctx.isAllCompanies ? ctx.allowedCompanies : [ctx.companyId];
        const companyRows = companyIds.length
            ? await db.select({ id: companies.id, name: companies.displayName }).from(companies)
                .where(inArray(companies.id, companyIds))
            : [];
        const companyNames = new Map(companyRows.map((c) => [c.id, c.name]));

        const groups = await Promise.all(
            companyIds.map(async (c) => ({
                companyId: c,
                companyLabel: companyNames.get(c) || c,
                cards: await cardsForCompany(singleCompanyCtx(ctx, c), ym, daysSoFar, totalDays),
            })),
        );

        return {
            success: true,
            month: ym,
            daysSoFar,
            totalDays,
            thresholds: {
                metric: DEVIATION_THRESHOLD,
                roas: ROAS_THRESHOLD,
                consecutiveDays: CONSECUTIVE_DAYS_FOR_ALERT,
            },
            groups,
        };
    } catch (error) {
        console.error('Errore getSalesAlerts:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

async function cardsForCompany(
    ctx: TenantContext,
    ym: string,
    daysSoFar: number,
    totalDays: number,
): Promise<SalesAlertCard[]> {
    const { year, month } = parseYearMonth(ym);

    // Range query in UTC, allargato di 3h a sinistra per coprire i timestamp con
    // giorno Rome = 1 del mese ma UTC ancora nel mese precedente. Il bucketing
    // per giorno Rome (dayIndex) scarta comunque tutto ciò che cade fuori mese.
    const monthStartUtc = new Date(Date.UTC(year, month - 1, 1) - 3 * 60 * 60 * 1000);
    const monthEndUtc = new Date(Date.UTC(year, month, 1));
    const pad = (n: number) => String(n).padStart(2, '0');
    const dayIso = (d: number) => `${ym}-${pad(d)}`;

    // Indice giorno-del-mese (1-based) di un timestamp, o null se fuori mese/futuro.
    const dayIndex = (d: Date | null): number | null => {
        if (!d) return null;
        const iso = toRomeIso(d);
        if (!iso.startsWith(ym)) return null;
        const day = parseInt(iso.slice(8, 10), 10);
        return day >= 1 && day <= daysSoFar ? day : null;
    };

    // ── Target ────────────────────────────────────────────────────────────────
    const [targetRow] = await db
        .select({
            targetAppFissati: monthlyTargets.targetAppFissati,
            targetTrattative: monthlyTargets.targetTrattative,
            targetClosed: monthlyTargets.targetClosed,
            targetValoreContratti: monthlyTargets.targetValoreContratti,
            workingDaysOverride: monthlyTargets.workingDaysOverride,
        })
        .from(monthlyTargets)
        .where(and(eq(monthlyTargets.companyId, ctx.companyId), eq(monthlyTargets.month, ym)))
        .limit(1);

    const [roasTargetRow] = await db
        .select({ roasTarget: marketingTargets.roasTarget })
        .from(marketingTargets)
        .where(and(eq(marketingTargets.companyId, ctx.companyId), eq(marketingTargets.id, 1)))
        .limit(1);
    const roasTarget = Number(roasTargetRow?.roasTarget ?? 0);

    // ── Actual giornalieri ───────────────────────────────────────────────────
    // App fissati: lead con appuntamento, datati per appointmentCreatedAt || appointmentDate
    // (stessa definizione di panoramicaActions).
    const apptRows = await db
        .select({
            appointmentCreatedAt: leads.appointmentCreatedAt,
            appointmentDate: leads.appointmentDate,
        })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.appointmentDate),
            or(
                and(isNotNull(leads.appointmentCreatedAt), gte(leads.appointmentCreatedAt, monthStartUtc), lt(leads.appointmentCreatedAt, monthEndUtc)),
                and(isNull(leads.appointmentCreatedAt), gte(leads.appointmentDate, monthStartUtc), lt(leads.appointmentDate, monthEndUtc)),
            ),
        ));

    // Esiti venditore del mese: trattative (Chiuso/Non chiuso), chiusure, valore contratti.
    const outcomeRows = await db
        .select({
            salespersonOutcome: leads.salespersonOutcome,
            salespersonOutcomeAt: leads.salespersonOutcomeAt,
            closeAmountEur: leads.closeAmountEur,
        })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.salespersonOutcomeAt),
            gte(leads.salespersonOutcomeAt, monthStartUtc),
            lt(leads.salespersonOutcomeAt, monthEndUtc),
            inArray(leads.salespersonOutcome, ['Chiuso', 'Non chiuso']),
        ));

    const apptByDay = new Array<number>(daysSoFar + 1).fill(0);
    for (const r of apptRows) {
        const d = dayIndex(r.appointmentCreatedAt || r.appointmentDate);
        if (d !== null) apptByDay[d] += 1;
    }

    const trattByDay = new Array<number>(daysSoFar + 1).fill(0);
    const closeByDay = new Array<number>(daysSoFar + 1).fill(0);
    const valoreByDay = new Array<number>(daysSoFar + 1).fill(0);
    for (const r of outcomeRows) {
        const d = dayIndex(r.salespersonOutcomeAt);
        if (d === null) continue;
        trattByDay[d] += 1;
        if (r.salespersonOutcome === 'Chiuso') {
            closeByDay[d] += 1;
            valoreByDay[d] += r.closeAmountEur || 0;
        }
    }

    // Spesa Meta giornaliera (per ROAS) — stessi account del route marketing.
    const spendByDay = new Array<number>(daysSoFar + 1).fill(0);
    try {
        const { metaFunnelsForCompany } = await import('@/lib/marketing/company-funnels');
        const funnels = await metaFunnelsForCompany(ctx.companyId);
        const accountIds = [...new Set(funnels.map((f) => f.meta_account).filter((x): x is string => !!x))];
        if (accountIds.length > 0) {
            const spendRows = await db
                .select({ date: metaAccountDaily.date, spend: metaAccountDaily.spend })
                .from(metaAccountDaily)
                .where(and(
                    eq(metaAccountDaily.companyId, ctx.companyId),
                    inArray(metaAccountDaily.accountId, accountIds),
                    gte(metaAccountDaily.date, dayIso(1)),
                    lte(metaAccountDaily.date, dayIso(daysSoFar)),
                ));
            for (const r of spendRows) {
                const d = parseInt(String(r.date).slice(8, 10), 10);
                if (d >= 1 && d <= daysSoFar) spendByDay[d] += Number(r.spend ?? 0);
            }
        }
    } catch (e) {
        console.error('getSalesAlerts: spesa Meta non disponibile', e);
    }

    // GDO attivi (per le medie per-GDO).
    const gdoRows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'GDO'), eq(users.isActive, true)));
    const nGdo = gdoRows.length;

    const workingDaysTotal = targetRow?.workingDaysOverride ?? countWorkingDaysInMonth(year, month);
    const workingDaysElapsedByDay = new Array<number>(daysSoFar + 1).fill(0);
    for (let d = 1; d <= daysSoFar; d++) {
        workingDaysElapsedByDay[d] = countWorkingDaysElapsed(year, month, new Date(Date.UTC(year, month - 1, d, 12)));
    }

    // ── Costruzione card ─────────────────────────────────────────────────────
    const cards: SalesAlertCard[] = [];

    // Card cumulative vs target proporzionale (calendario): valore, fissati, trattative, chiusure.
    function cumulativeCard(
        key: string,
        label: string,
        byDay: number[],
        monthlyTarget: number,
        unit: SalesAlertCard['unit'],
    ): SalesAlertCard {
        const hasTarget = monthlyTarget > 0;
        let cum = 0;
        const series: DayPoint[] = [];
        let actualToday = 0;
        let targetToday = 0;
        for (let d = 1; d <= daysSoFar; d++) {
            cum += byDay[d];
            const proportionalTarget = hasTarget ? (monthlyTarget * d) / totalDays : 0;
            const deviation = proportionalTarget > 0 ? (cum - proportionalTarget) / proportionalTarget : null;
            series.push({ deviation, belowThreshold: hasTarget && deviation !== null && deviation < DEVIATION_THRESHOLD });
            if (d === daysSoFar) { actualToday = cum; targetToday = proportionalTarget; }
        }
        const { status, streak } = classify(series, hasTarget);
        return {
            key, label, status, unit,
            deviationToday: hasTarget ? (series[series.length - 1]?.deviation ?? null) : null,
            consecutiveDaysBelow: streak,
            actualToday,
            targetToday,
            threshold: DEVIATION_THRESHOLD,
        };
    }

    cards.push(cumulativeCard('valore', 'Valore Contratti', valoreByDay, Number(targetRow?.targetValoreContratti ?? 0), 'eur'));
    cards.push(cumulativeCard('fissati', 'App Fissati', apptByDay, targetRow?.targetAppFissati ?? 0, 'count'));
    cards.push(cumulativeCard('trattative', 'Trattative', trattByDay, targetRow?.targetTrattative ?? 0, 'count'));
    cards.push(cumulativeCard('chiusure', 'Chiusure', closeByDay, targetRow?.targetClosed ?? 0, 'count'));

    // ROAS: fatturato cumulato / spesa cumulata vs roasTarget (target non proporzionale).
    {
        const hasTarget = roasTarget > 0;
        let cumSpend = 0;
        let cumRevenue = 0;
        const series: DayPoint[] = [];
        let roasToday: number | null = null;
        for (let d = 1; d <= daysSoFar; d++) {
            cumSpend += spendByDay[d];
            cumRevenue += valoreByDay[d];
            const roas = cumSpend > 0 ? cumRevenue / cumSpend : null;
            const deviation = hasTarget && roas !== null ? (roas - roasTarget) / roasTarget : null;
            series.push({ deviation, belowThreshold: hasTarget && deviation !== null && deviation < ROAS_THRESHOLD });
            if (d === daysSoFar) roasToday = roas;
        }
        const { status, streak } = classify(series, hasTarget);
        cards.push({
            key: 'roas', label: 'ROAS', status, unit: 'ratio',
            deviationToday: hasTarget ? (series[series.length - 1]?.deviation ?? null) : null,
            consecutiveDaysBelow: streak,
            actualToday: roasToday ?? 0,
            targetToday: roasTarget,
            threshold: ROAS_THRESHOLD,
        });
    }

    // Medie per-GDO su giorni lavorativi: app/gg/GDO e chiusure/gg/GDO.
    function perGdoCard(key: string, label: string, byDay: number[], monthlyTarget: number): SalesAlertCard {
        const hasTarget = monthlyTarget > 0 && nGdo > 0 && workingDaysTotal > 0;
        const targetAvg = hasTarget ? monthlyTarget / workingDaysTotal / nGdo : 0;
        let cum = 0;
        const series: DayPoint[] = [];
        let actualToday = 0;
        for (let d = 1; d <= daysSoFar; d++) {
            cum += byDay[d];
            const wdElapsed = workingDaysElapsedByDay[d];
            const avg = wdElapsed > 0 && nGdo > 0 ? cum / wdElapsed / nGdo : null;
            const deviation = hasTarget && avg !== null && targetAvg > 0 ? (avg - targetAvg) / targetAvg : null;
            series.push({ deviation, belowThreshold: hasTarget && deviation !== null && deviation < DEVIATION_THRESHOLD });
            if (d === daysSoFar) actualToday = avg ?? 0;
        }
        const { status, streak } = classify(series, hasTarget);
        return {
            key, label, status, unit: 'avg',
            deviationToday: hasTarget ? (series[series.length - 1]?.deviation ?? null) : null,
            consecutiveDaysBelow: streak,
            actualToday,
            targetToday: targetAvg,
            threshold: DEVIATION_THRESHOLD,
        };
    }

    cards.push(perGdoCard('appPerGdo', 'Media App/gg/GDO', apptByDay, targetRow?.targetAppFissati ?? 0));
    cards.push(perGdoCard('closePerGdo', 'Media Chiusure/gg/GDO', closeByDay, targetRow?.targetClosed ?? 0));

    return cards;
}
