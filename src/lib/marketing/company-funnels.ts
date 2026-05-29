// src/lib/marketing/company-funnels.ts
// Sostituisce l'array statico in src/lib/funnels.ts leggendo i funnel dal DB.
//
// I funnel sono scoped per company. Pattern di matching (substring) e
// ordinamento (sort_order ASC) replicano l'ordine in FUNNELS originale,
// dove i pattern più specifici (es. 'telegram-tk') vengono PRIMA dei più
// generici (es. 'telegram').

import { eq, asc } from 'drizzle-orm';
import { db } from '@/db';
import { companyFunnels } from '@/db/schema';

export interface FunnelConfig {
    id: string;
    name: string;
    // Meta-specific fields: present only for funnel alimentati da campagne Meta.
    // I funnel non-Meta (es. Telegram-TK, Google) hanno solo attribuzione AC via Provenienza.
    meta_account?: string;
    meta_keyword?: string;
    ac_list?: string;
    ac_sales_tag_id?: string;
    ac_provenienza_patterns: string[];
    color: string;
}

interface CacheEntry {
    data: FunnelConfig[];
    expiresAt: number;
}
const CACHE_TTL_MS = 60 * 1000;
const _cache = new Map<string, CacheEntry>();

function applyEnvFallback(f: FunnelConfig): FunnelConfig {
    // Compatibilità con env vars storiche di Fenice. Le env hanno la priorità
    // più alta quando la colonna DB è null/vuota, così la migrazione iniziale
    // non rompe le AC sync tag (verrà rimosso in fase di cleanup).
    if (f.ac_sales_tag_id) return f;
    const envKey =
        f.id === 'telegram' ? process.env.AC_SALES_TAG_ID_TELEGRAM :
        f.id === 'corso10ore' ? process.env.AC_SALES_TAG_ID_CORSO :
        f.id === 'jobsimulator' ? process.env.AC_SALES_TAG_ID_JOB : undefined;
    return envKey ? { ...f, ac_sales_tag_id: envKey } : f;
}

async function loadFromDb(companyId: string): Promise<FunnelConfig[]> {
    try {
        const rows = await db
            .select({
                id: companyFunnels.id,
                name: companyFunnels.name,
                metaAccount: companyFunnels.metaAccount,
                metaKeyword: companyFunnels.metaKeyword,
                acList: companyFunnels.acList,
                acSalesTagId: companyFunnels.acSalesTagId,
                acProvenienzaPatterns: companyFunnels.acProvenienzaPatterns,
                color: companyFunnels.color,
                sortOrder: companyFunnels.sortOrder,
            })
            .from(companyFunnels)
            .where(eq(companyFunnels.companyId, companyId))
            .orderBy(asc(companyFunnels.sortOrder));
        return rows.map((r) => applyEnvFallback({
            id: r.id,
            name: r.name,
            meta_account: r.metaAccount ?? undefined,
            meta_keyword: r.metaKeyword ?? undefined,
            ac_list: r.acList ?? undefined,
            ac_sales_tag_id: r.acSalesTagId ?? undefined,
            ac_provenienza_patterns: Array.isArray(r.acProvenienzaPatterns)
                ? (r.acProvenienzaPatterns as string[]) : [],
            color: r.color,
        }));
    } catch (e) {
        console.error('company_funnels load error', e);
        return [];
    }
}

export async function getFunnelsForCompany(companyId: string): Promise<FunnelConfig[]> {
    const now = Date.now();
    const cached = _cache.get(companyId);
    if (cached && cached.expiresAt > now) return cached.data;
    const data = await loadFromDb(companyId);
    _cache.set(companyId, { data, expiresAt: now + CACHE_TTL_MS });
    return data;
}

export async function getFunnelsForCompanies(
    companyIds: string[],
): Promise<Record<string, FunnelConfig[]>> {
    const entries = await Promise.all(
        companyIds.map(async (id) => [id, await getFunnelsForCompany(id)] as const),
    );
    return Object.fromEntries(entries);
}

export async function metaFunnelsForCompany(companyId: string): Promise<FunnelConfig[]> {
    const all = await getFunnelsForCompany(companyId);
    return all.filter((f) => f.meta_account && f.meta_keyword);
}

export function invalidateCompanyFunnelsCache(companyId?: string): void {
    if (companyId) _cache.delete(companyId);
    else _cache.clear();
}
