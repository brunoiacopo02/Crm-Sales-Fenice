// src/lib/marketing/meta-sync.ts
// Sync Meta data into adsDailyInsights + metaAccountDaily — Drizzle port.

import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { metaAccountDaily } from '@/db/schema';
import { getAccountInsightsDaily } from './meta';
import { getMetaCredentials } from './meta-credentials';
import { refreshAdsCacheForRange } from './ads-cache';
import { metaFunnelsForCompany } from './company-funnels';

// Default cron window: today + last 6 days.
const DEFAULT_DAYS_BACK = 6;

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
}

export interface MetaSyncStats {
    rangeFrom: string;
    rangeTo: string;
    funnels: Array<{ id: string; daysProcessed: number; rowsUpserted: number; error?: string }>;
    accounts: Array<{ id: string; daysProcessed: number; error?: string }>;
}

export async function syncMetaInsights(opts: {
    companyId: string;
    daysBack?: number;
    from?: string;
    to?: string;
}): Promise<MetaSyncStats> {
    const creds = getMetaCredentials(opts.companyId);
    if (!creds) {
        throw new Error(`Meta non configurato per azienda ${opts.companyId}`);
    }

    const to = opts.to ?? todayIso();
    const from = opts.from ?? daysAgoIso(opts.daysBack ?? DEFAULT_DAYS_BACK);

    const stats: MetaSyncStats = {
        rangeFrom: from,
        rangeTo: to,
        funnels: [],
        accounts: [],
    };

    const metaFunnels = await metaFunnelsForCompany(opts.companyId);

    for (const f of metaFunnels) {
        try {
            const r = await refreshAdsCacheForRange(
                opts.companyId,
                f.meta_account!,
                f.meta_keyword!,
                from,
                to,
            );
            stats.funnels.push({ id: f.id, ...r });
        } catch (e) {
            stats.funnels.push({ id: f.id, daysProcessed: 0, rowsUpserted: 0, error: String(e) });
        }
    }

    // Account-level refresh
    const accountIds = [...new Set(metaFunnels.map((f) => f.meta_account!).filter(Boolean))];
    for (const accountId of accountIds) {
        try {
            const daily = await getAccountInsightsDaily(creds, accountId, from, to);
            if (daily.length > 0) {
                const rows = daily.map((d) => ({
                    companyId: opts.companyId,
                    accountId,
                    date: d.date,
                    spend: String(d.spend),
                    impressions: d.impressions,
                    clicks: d.clicks,
                }));
                await db
                    .insert(metaAccountDaily)
                    .values(rows)
                    .onConflictDoUpdate({
                        target: [metaAccountDaily.companyId, metaAccountDaily.accountId, metaAccountDaily.date],
                        set: {
                            spend: sql`excluded.spend`,
                            impressions: sql`excluded.impressions`,
                            clicks: sql`excluded.clicks`,
                            fetchedAt: sql`now()`,
                        },
                    });
            }
            stats.accounts.push({ id: accountId, daysProcessed: daily.length });
        } catch (e) {
            stats.accounts.push({ id: accountId, daysProcessed: 0, error: String(e) });
        }
    }

    return stats;
}

/**
 * Total spend across all configured Meta ad accounts for a company in the
 * given range — includes ads that don't match any funnel keyword.
 */
export async function getAccountTotalSpend(
    companyId: string,
    from: string,
    to: string,
): Promise<number> {
    const metaFunnels = await metaFunnelsForCompany(companyId);
    const accountIds = [...new Set(metaFunnels.map((f) => f.meta_account!).filter(Boolean))];
    if (accountIds.length === 0) return 0;

    const rows = await db
        .select({ spend: metaAccountDaily.spend })
        .from(metaAccountDaily)
        .where(and(
            eq(metaAccountDaily.companyId, companyId),
            inArray(metaAccountDaily.accountId, accountIds),
            gte(metaAccountDaily.date, from),
            lte(metaAccountDaily.date, to),
        ));
    // numeric -> string from Drizzle; wrap with Number()
    const total = rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
    return Math.round(total * 100) / 100;
}
