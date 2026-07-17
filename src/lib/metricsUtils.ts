/**
 * Metrics — fonte unica di verità per le 6 metriche primarie del CRM.
 *
 * PROBLEMA risolto: prima c'erano 18 funzioni in 7 file che calcolavano
 * le stesse metriche con definizioni divergenti (campo data, predicato
 * stato, timezone). Risultato: numeri diversi nelle pagine diverse.
 *
 * REGOLA D'ORO: ogni pagina che mostra una metrica DEVE consumare
 * `getMetric(...)` per quel valore canonico. Se serve un breakdown
 * (per funnel, per GDO, per venditore), usare `getMetricGrouped`.
 *
 * MAPPING CANONICO:
 *   M1 LEAD_NUOVI    → leads.createdAt              + funnel NOT IN ('TEST','BLT','')
 *   M2 APP_FISSATI   → COALESCE(appointmentCreatedAt, appointmentDate) + appointmentDate NOT NULL
 *   M3 CONFERMATI    → confirmationsTimestamp       + confirmationsOutcome='confermato'
 *   M4 PRESENZIATI   → presentedAt (latch, giorno appuntamento — PO 2026-07-17) + presentedAt NOT NULL
 *   M5 CHIUSURE      → salespersonOutcomeAt         + salespersonOutcome='Chiuso'
 *   M6 FATTURATO     → salespersonOutcomeAt         + salespersonOutcome='Chiuso' → SUM(closeAmountEur)
 *
 * TIMEZONE: tutti i bounds sono Europe/Rome (vedi `lib/dateUtils.ts`).
 */

import { db } from "@/db";
import { leads } from "@/db/schema";
import { and, eq, gte, lt, sql, isNotNull } from "drizzle-orm";
import { monthBoundsRome, dayBoundsRome, weekBoundsRome } from "./dateUtils";

// =====================================================================
// Types
// =====================================================================

export type MetricId =
    | 'M1_LEAD_NUOVI'
    | 'M2_APP_FISSATI'
    | 'M3_CONFERMATI'
    | 'M4_PRESENZIATI'
    | 'M5_CHIUSURE'
    | 'M6_FATTURATO';

export type MetricPeriod =
    | { kind: 'month'; yearMonth: string }            // "YYYY-MM" Europe/Rome
    | { kind: 'week'; date: Date }                    // ISO Mon-Sun contenente date
    | { kind: 'day'; date: Date }                     // singolo giorno Europe/Rome
    | { kind: 'range'; start: Date; end: Date };      // range arbitrario (end exclusive)

export type MetricScope = {
    /** Filtra per funnel uppercase. Default: esclude TEST/BLT/empty. */
    funnel?: string | string[];
    /** Filtra per GDO assegnato (leads.assignedToId). */
    gdoId?: string;
    /** Filtra per venditore (leads.salespersonUserId). */
    venditoreId?: string;
    /** Filtra per Conferme user (leads.confirmationsUserId). */
    confermeUserId?: string;
};

export type MetricResult = {
    count: number;
    /** Popolato solo per M6_FATTURATO. */
    amountEur?: number;
};

// =====================================================================
// Internal helpers
// =====================================================================

function periodToBounds(period: MetricPeriod): { start: Date; end: Date } {
    switch (period.kind) {
        case 'month': return monthBoundsRome(period.yearMonth);
        case 'day':   return dayBoundsRome(period.date);
        case 'week':  return weekBoundsRome(period.date);
        case 'range': return { start: period.start, end: period.end };
    }
}

/** Predicato stato + scope per ogni metrica. Ritorna gli SQL conditions. */
function buildConditions(metric: MetricId, scope: MetricScope | undefined, start: Date, end: Date) {
    const conds: any[] = [];

    // Funnel filter (default: esclude TEST/BLT/empty).
    if (scope?.funnel === undefined) {
        conds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('TEST', 'BLT', '')`);
    } else if (Array.isArray(scope.funnel)) {
        conds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) IN (${sql.join(scope.funnel.map(f => sql`${f.toUpperCase()}`), sql`, `)})`);
    } else {
        conds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) = ${scope.funnel.toUpperCase()}`);
    }

    if (scope?.gdoId) conds.push(eq(leads.assignedToId, scope.gdoId));
    if (scope?.venditoreId) conds.push(eq(leads.salespersonUserId, scope.venditoreId));
    if (scope?.confermeUserId) conds.push(eq(leads.confirmationsUserId, scope.confermeUserId));

    // Date field + state filter per metrica.
    switch (metric) {
        case 'M1_LEAD_NUOVI':
            conds.push(gte(leads.createdAt, start), lt(leads.createdAt, end));
            break;

        case 'M2_APP_FISSATI':
            // Data canonica = appointmentCreatedAt; fallback appointmentDate (legacy).
            conds.push(isNotNull(leads.appointmentDate));
            conds.push(sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) >= ${start}`);
            conds.push(sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) <  ${end}`);
            break;

        case 'M3_CONFERMATI':
            conds.push(eq(leads.confirmationsOutcome, 'confermato'));
            conds.push(gte(leads.confirmationsTimestamp, start), lt(leads.confirmationsTimestamp, end));
            break;

        case 'M4_PRESENZIATI':
            // Latch presentedAt (PO 2026-07-17): presenza al giorno dell'appuntamento,
            // immutabile — "Sparito" a un follow-up non la toglie.
            conds.push(isNotNull(leads.presentedAt));
            conds.push(gte(leads.presentedAt, start), lt(leads.presentedAt, end));
            break;

        case 'M5_CHIUSURE':
        case 'M6_FATTURATO':
            conds.push(eq(leads.salespersonOutcome, 'Chiuso'));
            conds.push(gte(leads.salespersonOutcomeAt, start), lt(leads.salespersonOutcomeAt, end));
            break;
    }

    return conds;
}

// =====================================================================
// Public API
// =====================================================================

/**
 * Ritorna il valore canonico di una metrica per un periodo (Europe/Rome).
 *
 * @example
 * const closures = await getMetric('M5_CHIUSURE', { kind: 'month', yearMonth: '2026-05' });
 * console.log(closures.count); // 5
 *
 * const revenue = await getMetric('M6_FATTURATO', { kind: 'month', yearMonth: '2026-05' });
 * console.log(revenue.count, revenue.amountEur); // 5, 13217
 *
 * const myConferme = await getMetric(
 *   'M3_CONFERMATI',
 *   { kind: 'week', date: new Date() },
 *   { confermeUserId: userId }
 * );
 */
export async function getMetric(
    metric: MetricId,
    period: MetricPeriod,
    scope?: MetricScope,
): Promise<MetricResult> {
    const { start, end } = periodToBounds(period);
    const conditions = buildConditions(metric, scope, start, end);

    if (metric === 'M6_FATTURATO') {
        const [row] = await db.select({
            c: sql<number>`count(*)::int`,
            s: sql<number>`COALESCE(SUM(${leads.closeAmountEur}), 0)::real`,
        }).from(leads).where(and(...conditions));
        return { count: Number(row?.c ?? 0), amountEur: Number(row?.s ?? 0) };
    }

    const [row] = await db.select({
        c: sql<number>`count(*)::int`,
    }).from(leads).where(and(...conditions));
    return { count: Number(row?.c ?? 0) };
}

export type GroupKey = 'funnel' | 'gdoId' | 'venditoreId' | 'confermeUserId';

/**
 * Versione GROUP BY: ritorna `Map<key, MetricResult>` per breakdown
 * per funnel / per utente. Utile per ranking e dashboard.
 */
export async function getMetricGrouped(
    metric: MetricId,
    period: MetricPeriod,
    groupBy: GroupKey,
    scope?: MetricScope,
): Promise<Map<string, MetricResult>> {
    const { start, end } = periodToBounds(period);
    const conditions = buildConditions(metric, scope, start, end);

    const groupCol =
        groupBy === 'funnel' ? sql<string>`UPPER(COALESCE(${leads.funnel}, ''))` :
        groupBy === 'gdoId' ? sql<string>`COALESCE(${leads.assignedToId}, '')` :
        groupBy === 'venditoreId' ? sql<string>`COALESCE(${leads.salespersonUserId}, '')` :
        sql<string>`COALESCE(${leads.confirmationsUserId}, '')`;

    if (metric === 'M6_FATTURATO') {
        const rows = await db.select({
            k: groupCol,
            c: sql<number>`count(*)::int`,
            s: sql<number>`COALESCE(SUM(${leads.closeAmountEur}), 0)::real`,
        }).from(leads).where(and(...conditions)).groupBy(groupCol);

        const map = new Map<string, MetricResult>();
        for (const r of rows) map.set(r.k, { count: Number(r.c), amountEur: Number(r.s) });
        return map;
    }

    const rows = await db.select({
        k: groupCol,
        c: sql<number>`count(*)::int`,
    }).from(leads).where(and(...conditions)).groupBy(groupCol);

    const map = new Map<string, MetricResult>();
    for (const r of rows) map.set(r.k, { count: Number(r.c) });
    return map;
}
