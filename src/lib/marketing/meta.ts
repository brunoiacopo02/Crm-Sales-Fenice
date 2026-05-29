// src/lib/marketing/meta.ts
// Meta Marketing API client. Pure HTTP, no DB — porting da crm-marketing.

import type { MetaCredentials } from './meta-credentials';

const API_VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// Server-side in-memory cache: keyed by request params, TTL 10 minutes
const _cache = new Map<string, { ts: number; data: unknown }>();
const CACHE_TTL = 10 * 60 * 1000;

function fromCache<T>(key: string): T | null {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
    return entry.data as T;
}
function toCache(key: string, data: unknown) { _cache.set(key, { ts: Date.now(), data }); }

export interface FunnelInsights {
    spend: number;
    impressions: number;
    clicks: number;
    cpm: number;
    ctr: number;
    cpc: number;
    leads_meta: number;
}

export interface AdInsight {
    ad_id: string;
    ad_name: string;
    campaign_name: string;
    adset_name: string;
    spend: number;
    impressions: number;
    clicks: number;
    cpm: number;
    ctr: number;
    cpc: number;
    leads_meta: number;
    effective_status: string;
    post_url: string | null;
}

function extractLeads(actions: { action_type: string; value: string }[] = []): number {
    const leadAction = actions.find(
        (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped',
    );
    return leadAction ? parseInt(leadAction.value, 10) : 0;
}

// Un `meta_keyword` può contenere più alternative separate da `|`. Ogni
// alternativa viene mandata a Meta come singolo filtro CONTAIN; i risultati
// vengono uniti deduplicando per ad_id (e data, dove rilevante).
//
// Per ogni alternativa che contiene separatori (spazio, `-`, `_`, `.`) vengono
// auto-generate varianti con ciascun separatore (incluso "nessun separatore"),
// così "10 ore" pesca anche campagne tipo "10ore", "10-ore", "10_ore". Questo
// elimina il problema dei nomi campagna scritti senza spazio (causa principale
// dei buchi di spesa sul dashboard).
const SEPARATOR_RE = /[\s\-_.]+/g;
const SEPARATORS = ['', ' ', '-', '_', '.'];

function expandSeparators(alt: string): string[] {
    if (!SEPARATOR_RE.test(alt)) return [alt];
    SEPARATOR_RE.lastIndex = 0;
    return SEPARATORS.map((sep) => alt.replace(SEPARATOR_RE, sep));
}

export function parseKeywordAlternatives(keyword: string): string[] {
    if (!keyword) return [''];
    const parts = keyword.split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return [''];
    const expanded = new Set<string>();
    for (const p of parts) for (const v of expandSeparators(p)) expanded.add(v);
    return [...expanded];
}

// Matching lato app: normalizza tutti i separatori a stringa vuota su entrambi
// i lati, così "Corso 10 Ore" matcha keyword "10ore" e viceversa.
export function matchesAnyKeyword(text: string, keyword: string): boolean {
    const normalize = (s: string) => (s ?? '').toLowerCase().replace(SEPARATOR_RE, '');
    const normText = normalize(text);
    const alts = parseKeywordAlternatives(keyword);
    return alts.some((a) => a !== '' && normText.includes(normalize(a)));
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
    for (let attempt = 0; attempt < retries; attempt++) {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.status === 429 || (res.status === 400 && attempt < retries - 1)) {
            const body = await res.clone().json().catch(() => ({}));
            const code = body?.error?.code;
            if (code === 80004 || res.status === 429) {
                await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
                continue;
            }
        }
        return res;
    }
    return fetch(url, { cache: 'no-store' });
}

async function paginate<T>(
    creds: MetaCredentials,
    url: string,
    params: Record<string, string>,
): Promise<T[]> {
    const results: T[] = [];
    let currentUrl: string | null = url;
    let currentParams: Record<string, string> | null = { ...params, access_token: creds.accessToken };

    while (currentUrl) {
        const qs = currentParams
            ? '?' + new URLSearchParams(currentParams).toString()
            : '';
        const fetchRes = await fetchWithRetry(currentUrl + qs);
        if (!fetchRes.ok) {
            const err = await fetchRes.text();
            throw new Error(`Meta API error ${fetchRes.status}: ${err}`);
        }
        const data: { data?: T[]; paging?: { next?: string } } = await fetchRes.json();
        results.push(...(data.data ?? []));
        const next: string | undefined = data.paging?.next;
        currentUrl = next ?? null;
        currentParams = null;
    }
    return results;
}

export async function getFunnelInsights(
    creds: MetaCredentials,
    accountId: string,
    keyword: string,
    dateFrom: string,
    dateTo: string,
): Promise<FunnelInsights> {
    const cacheKey = `insights:${accountId}:${keyword}:${dateFrom}:${dateTo}`;
    const cached = fromCache<FunnelInsights>(cacheKey);
    if (cached) return cached;

    const rows = await paginate<{
        spend: string;
        impressions: string;
        outbound_clicks?: { action_type: string; value: string }[];
        cpm: string;
        ctr: string;
        cpc: string;
        actions?: { action_type: string; value: string }[];
    }>(creds, `${BASE}/${accountId}/insights`, {
        level: 'campaign',
        fields: 'spend,impressions,outbound_clicks,cpm,ctr,cpc,actions',
        time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
        filtering: JSON.stringify([
            { field: 'campaign.name', operator: 'CONTAIN', value: keyword },
        ]),
        limit: '500',
    });

    let spend = 0, impressions = 0, clicks = 0, leadsFromMeta = 0;

    for (const row of rows) {
        spend += parseFloat(row.spend ?? '0');
        impressions += parseInt(row.impressions ?? '0', 10);
        for (const oc of row.outbound_clicks ?? []) {
            if (oc.action_type === 'outbound_click') clicks += parseInt(oc.value, 10);
        }
        leadsFromMeta += extractLeads(row.actions);
    }

    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;

    const result: FunnelInsights = {
        spend: round(spend),
        impressions,
        clicks,
        cpm: round(cpm),
        ctr: round(ctr, 3),
        cpc: round(cpc),
        leads_meta: leadsFromMeta,
    };
    toCache(cacheKey, result);
    return result;
}

export async function getAdInsights(
    creds: MetaCredentials,
    accountId: string,
    keyword: string,
    dateFrom: string,
    dateTo: string,
): Promise<AdInsight[]> {
    const cacheKey = `ad-insights:${accountId}:${keyword}:${dateFrom}:${dateTo}`;
    const cached = fromCache<AdInsight[]>(cacheKey);
    if (cached) return cached;

    type RowShape = {
        ad_id: string;
        ad_name: string;
        campaign_name: string;
        adset_name: string;
        spend: string;
        impressions: string;
        outbound_clicks?: { action_type: string; value: string }[];
        cpm: string;
        ctr: string;
        cpc: string;
        actions?: { action_type: string; value: string }[];
    };
    type AdShape = { id: string; effective_status: string; creative?: { object_story_id?: string; instagram_permalink_url?: string } };

    const alternatives = parseKeywordAlternatives(keyword);
    const perAlt = await Promise.all(
        alternatives.map(async (alt) => {
            const filtering = JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: alt }]);
            const [r, a] = await Promise.all([
                paginate<RowShape>(creds, `${BASE}/${accountId}/insights`, {
                    level: 'ad',
                    fields: 'ad_id,ad_name,campaign_name,adset_name,spend,impressions,outbound_clicks,cpm,ctr,cpc,actions',
                    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
                    filtering,
                    limit: '500',
                }),
                paginate<AdShape>(creds, `${BASE}/${accountId}/ads`, {
                    fields: 'id,effective_status,creative{object_story_id,instagram_permalink_url}',
                    filtering,
                    limit: '500',
                }),
            ]);
            return { rows: r, adsData: a };
        }),
    );

    const rowMap = new Map<string, RowShape>();
    const adsMap = new Map<string, AdShape>();
    for (const p of perAlt) {
        for (const row of p.rows) rowMap.set(row.ad_id, row);
        for (const ad of p.adsData) adsMap.set(ad.id, ad);
    }
    const rows = [...rowMap.values()];
    const adsData = [...adsMap.values()];

    const statusMap = Object.fromEntries(adsData.map((a) => [a.id, a.effective_status]));
    const postUrlMap = Object.fromEntries(
        adsData.map((a) => {
            if (a.creative?.instagram_permalink_url) return [a.id, a.creative.instagram_permalink_url];
            const storyId = a.creative?.object_story_id;
            if (storyId) {
                const [pageId, postId] = storyId.split('_');
                if (pageId && postId) return [a.id, `https://www.facebook.com/${pageId}/posts/${postId}/`];
            }
            return [a.id, `https://www.facebook.com/ads/library/?id=${a.id}`];
        }),
    );

    const result: AdInsight[] = rows.map((row) => {
        const spend = parseFloat(row.spend ?? '0');
        const impressions = parseInt(row.impressions ?? '0', 10);
        let clicks = 0;
        for (const oc of row.outbound_clicks ?? []) {
            if (oc.action_type === 'outbound_click') clicks += parseInt(oc.value, 10);
        }
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;

        return {
            ad_id: row.ad_id,
            ad_name: row.ad_name,
            campaign_name: row.campaign_name,
            adset_name: row.adset_name,
            spend: round(spend),
            impressions,
            clicks,
            cpm: round(cpm),
            ctr: round(ctr, 3),
            cpc: round(cpc),
            leads_meta: extractLeads(row.actions),
            effective_status: statusMap[row.ad_id] ?? 'UNKNOWN',
            post_url: postUrlMap[row.ad_id] ?? null,
        };
    });
    toCache(cacheKey, result);
    return result;
}

function round(n: number, decimals = 2) {
    return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

export interface AdDailyInsight extends AdInsight {
    date: string;
}

export async function getAccountAdInsights(
    creds: MetaCredentials,
    accountId: string,
    dateFrom: string,
    dateTo: string,
): Promise<AdInsight[]> {
    const cacheKey = `account-ad-insights:${accountId}:${dateFrom}:${dateTo}`;
    const cached = fromCache<AdInsight[]>(cacheKey);
    if (cached) return cached;

    const [rows, adsData] = await Promise.all([
        paginate<{
            ad_id: string;
            ad_name: string;
            campaign_name: string;
            adset_name: string;
            spend: string;
            impressions: string;
            outbound_clicks?: { action_type: string; value: string }[];
            cpm: string;
            ctr: string;
            cpc: string;
            actions?: { action_type: string; value: string }[];
        }>(creds, `${BASE}/${accountId}/insights`, {
            level: 'ad',
            fields: 'ad_id,ad_name,campaign_name,adset_name,spend,impressions,outbound_clicks,cpm,ctr,cpc,actions',
            time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
            limit: '500',
        }),
        paginate<{ id: string; effective_status: string; creative?: { object_story_id?: string; instagram_permalink_url?: string } }>(
            creds,
            `${BASE}/${accountId}/ads`,
            {
                fields: 'id,effective_status,creative{object_story_id,instagram_permalink_url}',
                limit: '500',
            },
        ),
    ]);

    const statusMap = Object.fromEntries(adsData.map((a) => [a.id, a.effective_status]));
    const postUrlMap = Object.fromEntries(
        adsData.map((a) => {
            if (a.creative?.instagram_permalink_url) return [a.id, a.creative.instagram_permalink_url];
            const storyId = a.creative?.object_story_id;
            if (storyId) {
                const [pageId, postId] = storyId.split('_');
                if (pageId && postId) return [a.id, `https://www.facebook.com/${pageId}/posts/${postId}/`];
            }
            return [a.id, `https://www.facebook.com/ads/library/?id=${a.id}`];
        }),
    );

    const result: AdInsight[] = rows.map((row) => {
        const spend = parseFloat(row.spend ?? '0');
        const impressions = parseInt(row.impressions ?? '0', 10);
        let clicks = 0;
        for (const oc of row.outbound_clicks ?? []) {
            if (oc.action_type === 'outbound_click') clicks += parseInt(oc.value, 10);
        }
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;
        return {
            ad_id: row.ad_id,
            ad_name: row.ad_name,
            campaign_name: row.campaign_name,
            adset_name: row.adset_name,
            spend: round(spend),
            impressions,
            clicks,
            cpm: round(cpm),
            ctr: round(ctr, 3),
            cpc: round(cpc),
            leads_meta: extractLeads(row.actions),
            effective_status: statusMap[row.ad_id] ?? 'UNKNOWN',
            post_url: postUrlMap[row.ad_id] ?? null,
        };
    });
    toCache(cacheKey, result);
    return result;
}

export async function getAdInsightsDaily(
    creds: MetaCredentials,
    accountId: string,
    keyword: string,
    dateFrom: string,
    dateTo: string,
): Promise<AdDailyInsight[]> {
    type RowShape = {
        ad_id: string;
        ad_name: string;
        campaign_name: string;
        adset_name: string;
        date_start: string;
        spend?: string;
        impressions?: string;
        outbound_clicks?: { action_type: string; value: string }[];
        actions?: { action_type: string; value: string }[];
    };
    type AdShape = { id: string; effective_status: string; creative?: { object_story_id?: string; instagram_permalink_url?: string } };

    const alternatives = parseKeywordAlternatives(keyword);
    const perAlt = await Promise.all(
        alternatives.map(async (alt) => {
            const filtering = JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: alt }]);
            const [r, a] = await Promise.all([
                paginate<RowShape>(creds, `${BASE}/${accountId}/insights`, {
                    level: 'ad',
                    fields: 'ad_id,ad_name,campaign_name,adset_name,spend,impressions,outbound_clicks,actions',
                    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
                    time_increment: '1',
                    filtering,
                    limit: '500',
                }),
                paginate<AdShape>(creds, `${BASE}/${accountId}/ads`, {
                    fields: 'id,effective_status,creative{object_story_id,instagram_permalink_url}',
                    filtering,
                    limit: '500',
                }),
            ]);
            return { rows: r, adsData: a };
        }),
    );

    const rowMap = new Map<string, RowShape>();
    const adsMap = new Map<string, AdShape>();
    for (const p of perAlt) {
        for (const row of p.rows) rowMap.set(`${row.ad_id}|${row.date_start}`, row);
        for (const ad of p.adsData) adsMap.set(ad.id, ad);
    }
    const rows = [...rowMap.values()];
    const adsData = [...adsMap.values()];

    const statusMap = Object.fromEntries(adsData.map((a) => [a.id, a.effective_status]));
    const postUrlMap = Object.fromEntries(
        adsData.map((a) => {
            if (a.creative?.instagram_permalink_url) return [a.id, a.creative.instagram_permalink_url];
            const storyId = a.creative?.object_story_id;
            if (storyId) {
                const [pageId, postId] = storyId.split('_');
                if (pageId && postId) return [a.id, `https://www.facebook.com/${pageId}/posts/${postId}/`];
            }
            return [a.id, `https://www.facebook.com/ads/library/?id=${a.id}`];
        }),
    );

    return rows.map((row) => {
        const spend = parseFloat(row.spend ?? '0');
        const impressions = parseInt(row.impressions ?? '0', 10);
        let clicks = 0;
        for (const oc of row.outbound_clicks ?? []) {
            if (oc.action_type === 'outbound_click') clicks += parseInt(oc.value, 10);
        }
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;

        return {
            ad_id: row.ad_id,
            ad_name: row.ad_name,
            campaign_name: row.campaign_name,
            adset_name: row.adset_name,
            date: row.date_start,
            spend: round(spend),
            impressions,
            clicks,
            cpm: round(cpm),
            ctr: round(ctr, 3),
            cpc: round(cpc),
            leads_meta: extractLeads(row.actions),
            effective_status: statusMap[row.ad_id] ?? 'UNKNOWN',
            post_url: postUrlMap[row.ad_id] ?? null,
        };
    });
}

export interface AccountDailyInsight {
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
}

export async function getAccountInsightsDaily(
    creds: MetaCredentials,
    accountId: string,
    dateFrom: string,
    dateTo: string,
): Promise<AccountDailyInsight[]> {
    const rows = await paginate<{
        date_start: string;
        spend?: string;
        impressions?: string;
        outbound_clicks?: { action_type: string; value: string }[];
    }>(creds, `${BASE}/${accountId}/insights`, {
        level: 'account',
        fields: 'spend,impressions,outbound_clicks',
        time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
        time_increment: '1',
        limit: '500',
    });

    return rows.map((row) => {
        let clicks = 0;
        for (const oc of row.outbound_clicks ?? []) {
            if (oc.action_type === 'outbound_click') clicks += parseInt(oc.value, 10);
        }
        return {
            date: row.date_start,
            spend: round(parseFloat(row.spend ?? '0')),
            impressions: parseInt(row.impressions ?? '0', 10),
            clicks,
        };
    });
}
