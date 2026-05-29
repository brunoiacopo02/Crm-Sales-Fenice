// src/lib/marketing/ac-cache.ts
// Lazy on-read cache for ActiveCampaign metrics — Drizzle port.

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { acDailyMetrics } from '@/db/schema';
import {
    getLeadCount as fetchLeadCount,
    getLeadsByUtmTerm as fetchLeadsByUtmTerm,
    SalesAttribution,
} from './activecampaign';
import { getFunnelsForCompany, type FunnelConfig } from './company-funnels';
import { getAcCredentials } from './ac-credentials';
import { todayInRome, dateRange } from './date-utils';
import { getSalesAttributionFromDeals } from './crm-deals-reader';

type Metric = 'leads' | 'leads_by_ad';

async function readMetricRows(
    companyId: string,
    funnelId: string,
    metric: Metric,
    from: string,
    to: string,
): Promise<Map<string, unknown>> {
    try {
        const rows = await db
            .select({ date: acDailyMetrics.date, payload: acDailyMetrics.payload })
            .from(acDailyMetrics)
            .where(and(
                eq(acDailyMetrics.companyId, companyId),
                eq(acDailyMetrics.funnelId, funnelId),
                eq(acDailyMetrics.metric, metric),
                gte(acDailyMetrics.date, from),
                lte(acDailyMetrics.date, to),
            ));
        const m = new Map<string, unknown>();
        for (const r of rows) m.set(r.date as unknown as string, r.payload);
        return m;
    } catch (e) {
        console.error('ac_daily_metrics select error', e);
        return new Map();
    }
}

async function writeMetric(
    companyId: string,
    funnelId: string,
    date: string,
    metric: Metric,
    payload: unknown,
): Promise<void> {
    try {
        await db
            .insert(acDailyMetrics)
            .values({
                companyId,
                funnelId,
                date,
                metric,
                payload: payload as object,
            })
            .onConflictDoUpdate({
                target: [acDailyMetrics.companyId, acDailyMetrics.funnelId, acDailyMetrics.date, acDailyMetrics.metric],
                set: {
                    payload: sql`excluded.payload`,
                    fetchedAt: sql`now()`,
                },
            });
    } catch (e) {
        console.error('ac_daily_metrics upsert error', e);
    }
}

async function findFunnelByList(companyId: string, listName: string): Promise<FunnelConfig | undefined> {
    const funnels = await getFunnelsForCompany(companyId);
    return funnels.find((f) => f.ac_list && f.ac_list.toLowerCase() === listName.toLowerCase());
}

// ─── Lead count ────────────────────────────────────────────────────────────────

export async function getLeadCountCached(
    companyId: string,
    listName: string,
    from: string,
    to: string,
): Promise<number> {
    const creds = getAcCredentials(companyId);
    if (!creds) return 0;
    const funnel = await findFunnelByList(companyId, listName);
    if (!funnel) return fetchLeadCount(creds, listName, from, to);

    const today = todayInRome();
    const cached = await readMetricRows(companyId, funnel.id, 'leads', from, to);

    let total = 0;
    for (const d of dateRange(from, to)) {
        if (d >= today) {
            total += await fetchLeadCount(creds, listName, d, d);
            continue;
        }
        const hit = cached.get(d) as { count: number } | undefined;
        if (hit) {
            total += hit.count;
            continue;
        }
        const count = await fetchLeadCount(creds, listName, d, d);
        await writeMetric(companyId, funnel.id, d, 'leads', { count });
        total += count;
    }
    return total;
}

// ─── Leads by utm_term breakdown ───────────────────────────────────────────────

export async function getLeadsByUtmTermCached(
    companyId: string,
    listName: string,
    utmTermFieldId: string,
    from: string,
    to: string,
): Promise<Record<string, number>> {
    const creds = getAcCredentials(companyId);
    if (!creds) return {};
    const funnel = await findFunnelByList(companyId, listName);
    if (!funnel) return fetchLeadsByUtmTerm(creds, listName, utmTermFieldId, from, to);

    const today = todayInRome();
    const cached = await readMetricRows(companyId, funnel.id, 'leads_by_ad', from, to);

    const merged: Record<string, number> = {};
    for (const d of dateRange(from, to)) {
        let dayBreakdown: Record<string, number>;
        if (d >= today) {
            dayBreakdown = await fetchLeadsByUtmTerm(creds, listName, utmTermFieldId, d, d);
        } else {
            const hit = cached.get(d) as Record<string, number> | undefined;
            if (hit) {
                dayBreakdown = hit;
            } else {
                dayBreakdown = await fetchLeadsByUtmTerm(creds, listName, utmTermFieldId, d, d);
                await writeMetric(companyId, funnel.id, d, 'leads_by_ad', dayBreakdown);
            }
        }
        for (const [ad, n] of Object.entries(dayBreakdown)) {
            merged[ad] = (merged[ad] ?? 0) + n;
        }
    }
    return merged;
}

// ─── Sales attribution ────────────────────────────────────────────────────────
//
// I dati di vendita ora vivono in `crm_deals` (popolato dai webhook del CRM
// gestionale + backfill). Le firme con `tagId` e `ac_provenienza_patterns`
// restano per compatibilità coi chiamanti ma vengono ignorate.

export async function getSalesAttributionCached(
    companyId: string,
    _tagId: string,
    funnels: { id: string; ac_provenienza_patterns: string[] }[],
    from: string,
    to: string,
): Promise<SalesAttribution> {
    return getSalesAttributionFromDeals(companyId, funnels, from, to);
}

export async function getSalesAttributionByContractDateCached(
    companyId: string,
    _tagId: string,
    funnels: { id: string; ac_provenienza_patterns: string[] }[],
    from: string,
    to: string,
): Promise<SalesAttribution> {
    return getSalesAttributionFromDeals(companyId, funnels, from, to);
}
