// src/lib/marketing/ads-cache.ts
// Read-only cache for Meta Ads insights — Drizzle port.

import { and, eq, gte, lte, asc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { adsDailyInsights, adsDailyFetches } from '@/db/schema';
import {
    AdInsight,
    FunnelInsights,
    getAdInsights as fetchAdInsightsFromApi,
    getAdInsightsDaily,
} from './meta';
import { getMetaCredentials } from './meta-credentials';
import { getFunnelsForCompany } from './company-funnels';
import { dateRange } from './date-utils';

interface AdRow {
    ad_id: string;
    date: string;
    account_id: string;
    funnel_id: string;
    company_id: string;
    campaign_name: string | null;
    adset_name: string | null;
    ad_name: string | null;
    spend: number | string;
    impressions: number | string;
    clicks: number | string;
    cpm: number | string;
    ctr: number | string;
    cpc: number | string;
    leads_meta: number | string;
    effective_status: string | null;
    post_url: string | null;
}

async function resolveFunnelId(
    companyId: string,
    accountId: string,
    keyword: string,
): Promise<string | null> {
    const funnels = await getFunnelsForCompany(companyId);
    return funnels.find((f) => f.meta_account === accountId && f.meta_keyword === keyword)?.id ?? null;
}

function round(n: number, decimals = 2): number {
    return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

// Sum per-day rows back into one AdInsight per ad_id, recomputing rate metrics.
function aggregateRows(rows: AdRow[]): AdInsight[] {
    const byAd = new Map<string, AdInsight>();
    for (const r of rows) {
        const spend = Number(r.spend);
        const impressions = Number(r.impressions);
        const clicks = Number(r.clicks);
        const leadsMeta = Number(r.leads_meta);
        const cur = byAd.get(r.ad_id);
        if (!cur) {
            byAd.set(r.ad_id, {
                ad_id: r.ad_id,
                ad_name: r.ad_name ?? '',
                campaign_name: r.campaign_name ?? '',
                adset_name: r.adset_name ?? '',
                spend,
                impressions,
                clicks,
                cpm: 0,
                ctr: 0,
                cpc: 0,
                leads_meta: leadsMeta,
                effective_status: r.effective_status ?? 'UNKNOWN',
                post_url: r.post_url,
            });
        } else {
            cur.spend += spend;
            cur.impressions += impressions;
            cur.clicks += clicks;
            cur.leads_meta += leadsMeta;
            if (r.effective_status) cur.effective_status = r.effective_status;
            if (r.post_url) cur.post_url = r.post_url;
        }
    }
    const result: AdInsight[] = [];
    for (const a of byAd.values()) {
        const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
        const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
        const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
        result.push({
            ...a,
            spend: round(a.spend),
            cpm: round(cpm),
            ctr: round(ctr, 3),
            cpc: round(cpc),
        });
    }
    return result;
}

export async function getAdInsightsCached(
    companyId: string,
    accountId: string,
    keyword: string,
    dateFrom: string,
    dateTo: string,
): Promise<AdInsight[]> {
    const funnelId = await resolveFunnelId(companyId, accountId, keyword);
    if (!funnelId) {
        const creds = getMetaCredentials(companyId);
        if (!creds) return [];
        return fetchAdInsightsFromApi(creds, accountId, keyword, dateFrom, dateTo);
    }

    try {
        const rows = await db
            .select()
            .from(adsDailyInsights)
            .where(and(
                eq(adsDailyInsights.companyId, companyId),
                eq(adsDailyInsights.funnelId, funnelId),
                gte(adsDailyInsights.date, dateFrom),
                lte(adsDailyInsights.date, dateTo),
            ))
            .orderBy(asc(adsDailyInsights.date));

        const adRows: AdRow[] = rows.map((r) => ({
            ad_id: r.adId,
            date: r.date as unknown as string,
            account_id: r.accountId,
            funnel_id: r.funnelId,
            company_id: r.companyId,
            campaign_name: r.campaignName,
            adset_name: r.adsetName,
            ad_name: r.adName,
            spend: r.spend, // numeric → string (coerced via Number() in aggregateRows)
            impressions: r.impressions,
            clicks: r.clicks,
            cpm: r.cpm,
            ctr: r.ctr,
            cpc: r.cpc,
            leads_meta: r.leadsMeta,
            effective_status: r.effectiveStatus,
            post_url: r.postUrl,
        }));
        return aggregateRows(adRows);
    } catch (e) {
        console.error('ads cache read error', e);
        const creds = getMetaCredentials(companyId);
        if (!creds) return [];
        return fetchAdInsightsFromApi(creds, accountId, keyword, dateFrom, dateTo);
    }
}

/**
 * Refresh a date range for a funnel. Uses one batched insights call
 * (time_increment=1) + one `/ads` call.
 */
export async function refreshAdsCacheForRange(
    companyId: string,
    accountId: string,
    keyword: string,
    dateFrom: string,
    dateTo: string,
): Promise<{ daysProcessed: number; rowsUpserted: number }> {
    const funnelId = await resolveFunnelId(companyId, accountId, keyword);
    if (!funnelId) throw new Error(`Funnel not found for ${accountId}/${keyword} in ${companyId}`);
    const creds = getMetaCredentials(companyId);
    if (!creds) throw new Error(`Meta non configurato per azienda ${companyId}`);

    const daily = await getAdInsightsDaily(creds, accountId, keyword, dateFrom, dateTo);
    const allDays = [...dateRange(dateFrom, dateTo)];

    if (daily.length > 0) {
        const liveRows = daily.map((a) => ({
            companyId,
            adId: a.ad_id,
            date: a.date,
            accountId,
            funnelId,
            campaignName: a.campaign_name,
            adsetName: a.adset_name,
            adName: a.ad_name,
            // numeric columns: Drizzle expects strings for `numeric` typed columns
            spend: String(a.spend),
            impressions: a.impressions,
            clicks: a.clicks,
            cpm: String(a.cpm),
            ctr: String(a.ctr),
            cpc: String(a.cpc),
            leadsMeta: a.leads_meta,
            effectiveStatus: a.effective_status,
            postUrl: a.post_url,
        }));
        // Chunked upsert
        for (let i = 0; i < liveRows.length; i += 1000) {
            const slice = liveRows.slice(i, i + 1000);
            await db
                .insert(adsDailyInsights)
                .values(slice)
                .onConflictDoUpdate({
                    target: [adsDailyInsights.companyId, adsDailyInsights.adId, adsDailyInsights.date],
                    set: {
                        accountId: sql`excluded.account_id`,
                        funnelId: sql`excluded.funnel_id`,
                        campaignName: sql`excluded.campaign_name`,
                        adsetName: sql`excluded.adset_name`,
                        adName: sql`excluded.ad_name`,
                        spend: sql`excluded.spend`,
                        impressions: sql`excluded.impressions`,
                        clicks: sql`excluded.clicks`,
                        cpm: sql`excluded.cpm`,
                        ctr: sql`excluded.ctr`,
                        cpc: sql`excluded.cpc`,
                        leadsMeta: sql`excluded.leads_meta`,
                        effectiveStatus: sql`excluded.effective_status`,
                        postUrl: sql`excluded.post_url`,
                    },
                });
        }
    }

    // Mark all days as fetched, including those with zero ads
    const markers = allDays.map((d) => ({
        companyId,
        funnelId,
        date: d,
    }));
    for (let i = 0; i < markers.length; i += 1000) {
        const slice = markers.slice(i, i + 1000);
        await db
            .insert(adsDailyFetches)
            .values(slice)
            .onConflictDoUpdate({
                target: [adsDailyFetches.companyId, adsDailyFetches.funnelId, adsDailyFetches.date],
                set: { fetchedAt: sql`now()` },
            });
    }

    return { daysProcessed: allDays.length, rowsUpserted: daily.length };
}

export async function getFunnelInsightsCached(
    companyId: string,
    accountId: string,
    keyword: string,
    dateFrom: string,
    dateTo: string,
): Promise<FunnelInsights> {
    const ads = await getAdInsightsCached(companyId, accountId, keyword, dateFrom, dateTo);
    let spend = 0;
    let impressions = 0;
    let clicks = 0;
    let leadsMeta = 0;
    for (const a of ads) {
        spend += a.spend;
        impressions += a.impressions;
        clicks += a.clicks;
        leadsMeta += a.leads_meta;
    }
    return {
        spend: round(spend),
        impressions,
        clicks,
        cpm: impressions > 0 ? round((spend / impressions) * 1000) : 0,
        ctr: impressions > 0 ? round((clicks / impressions) * 100, 3) : 0,
        cpc: clicks > 0 ? round(spend / clicks) : 0,
        leads_meta: leadsMeta,
    };
}
