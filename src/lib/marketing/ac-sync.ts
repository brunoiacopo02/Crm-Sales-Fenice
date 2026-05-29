// src/lib/marketing/ac-sync.ts
// Sync AC contacts into acContacts — Drizzle port.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { acContacts, acSyncState } from '@/db/schema';
import { type FunnelConfig, getFunnelsForCompany } from './company-funnels';
import { getAcCredentials, type AcCredentials } from './ac-credentials';

const PROVENIENZA_FIELD = '2';
const UTM_TERM_FIELD = '35';
const IMPORTO_CONTRATTO_FIELD = '43';

interface UtmFieldIds {
    source: string[];
    medium: string[];
    campaign: string[];
    content: string[];
}

const CLIENTE_TAG_ID = '35';
const SYNC_STATE_KEY = 'last_synced_at';
const BACKFILL_FROM_ISO = '2026-03-01T00:00:00Z';

async function acGet<T>(
    creds: AcCredentials,
    path: string,
    params: Record<string, string> = {},
): Promise<T> {
    const base = creds.url.replace(/\/$/, '');
    const url = new URL(`${base}/api/3${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
        headers: { 'Api-Token': creds.key },
        cache: 'no-store',
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`AC API error ${res.status}: ${err}`);
    }
    return res.json();
}

async function discoverUtmFieldIds(creds: AcCredentials): Promise<UtmFieldIds> {
    const priority: UtmFieldIds = { source: [], medium: [], campaign: [], content: [] };
    const fallback: UtmFieldIds = { source: [], medium: [], campaign: [], content: [] };
    const limit = 100;
    let offset = 0;
    const norm = (s: string | undefined) =>
        (s ?? '').toLowerCase().trim().replace(/\s+/g, '_');
    while (true) {
        const data = await acGet<{
            fields: { id: string; title: string; perstag?: string }[];
            meta?: { total: string };
        }>(creds, '/fields', { limit: String(limit), offset: String(offset) });
        for (const f of data.fields ?? []) {
            const t = norm(f.title);
            const p = norm(f.perstag);
            const push = (slug: 'source' | 'medium' | 'campaign' | 'content') => {
                if (t === `utm_${slug}` || p === `utm_${slug}`) priority[slug].push(f.id);
                else if (t === slug || p === slug) fallback[slug].push(f.id);
            };
            push('source');
            push('medium');
            push('campaign');
            push('content');
        }
        const total = parseInt(data.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) break;
    }
    return {
        source: [...priority.source, ...fallback.source],
        medium: [...priority.medium, ...fallback.medium],
        campaign: [...priority.campaign, ...fallback.campaign],
        content: [...priority.content, ...fallback.content],
    };
}

function pickFirstNonEmpty(fvs: AcFieldValue[], candidateIds: string[]): string | null {
    for (const id of candidateIds) {
        const v = fvs.find((fv) => fv.field === id)?.value;
        if (v && v.trim()) return v.trim();
    }
    return null;
}

interface AcContactRaw {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    cdate: string;
    udate?: string;
}

interface AcFieldValue {
    contact: string;
    field: string;
    value: string;
}

interface AcContactTag {
    id: string;
    contact: string;
    tag: string;
    cdate: string;
}

interface AcContactsPage {
    contacts: AcContactRaw[];
    fieldValues?: AcFieldValue[];
    contactTags?: AcContactTag[];
    meta: { total: string };
}

function resolveFunnel(provenienza: string, funnels: FunnelConfig[]): string | null {
    const prov = provenienza.toLowerCase().trim();
    if (!prov) return null;
    const match = funnels.find((f) =>
        f.ac_provenienza_patterns.some((p) => prov.includes(p.toLowerCase())),
    );
    return match?.id ?? null;
}

function parseImporto(raw: string): number | null {
    if (!raw) return null;
    const amount = parseFloat(raw.replace(',', '.').replace(/[€\s]/g, ''));
    if (isNaN(amount)) return null;
    return Math.round(amount * 100) / 100;
}

export interface SyncStats {
    pagesFetched: number;
    contactsSeen: number;
    contactsUpserted: number;
    sinceIso: string;
    untilIso: string;
    errors: string[];
}

interface ContactRow {
    companyId: string;
    contactId: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    cdate: Date;
    udate: Date | null;
    funnelId: string | null;
    provenienzaRaw: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
    isCliente: boolean;
    contractDate: string | null;     // date column → 'YYYY-MM-DD'
    contractValue: string | null;    // numeric → string for Drizzle
}

/**
 * Pulls AC contacts whose record was updated since `sinceIso` and upserts them into
 * acContacts. Multi-tenant: scoped per companyId. ac_sync_state PK is (companyId, key).
 */
export async function syncAcContacts(
    companyId: string,
    sinceIso?: string,
): Promise<SyncStats> {
    const creds = getAcCredentials(companyId);
    if (!creds) {
        throw new Error(`ActiveCampaign non configurato per azienda ${companyId}`);
    }

    const funnels = await getFunnelsForCompany(companyId);
    const since = sinceIso ?? (await readLastSyncedAt(companyId)) ?? BACKFILL_FROM_ISO;
    const until = new Date().toISOString();

    const stats: SyncStats = {
        pagesFetched: 0,
        contactsSeen: 0,
        contactsUpserted: 0,
        sinceIso: since,
        untilIso: until,
        errors: [],
    };

    let utmFields: UtmFieldIds = { source: [], medium: [], campaign: [], content: [] };
    try {
        utmFields = await discoverUtmFieldIds(creds);
    } catch (e) {
        stats.errors.push(`field discovery failed: ${String(e)}`);
    }

    const limit = 100;
    let offset = 0;
    const buffer: ContactRow[] = [];

    while (true) {
        let page: AcContactsPage;
        try {
            page = await acGet<AcContactsPage>(creds, '/contacts', {
                'filters[updated_after]': since,
                include: 'fieldValues,contactTags',
                limit: String(limit),
                offset: String(offset),
                orders: 'updated_timestamp ASC',
            });
        } catch (e) {
            stats.errors.push(`page offset=${offset}: ${String(e)}`);
            break;
        }
        stats.pagesFetched += 1;
        const contacts = page.contacts ?? [];
        stats.contactsSeen += contacts.length;

        for (const c of contacts) {
            const fvs = (page.fieldValues ?? []).filter((fv) => fv.contact === c.id);
            const provRaw = fvs.find((fv) => fv.field === PROVENIENZA_FIELD)?.value ?? '';
            const utmTerm = (fvs.find((fv) => fv.field === UTM_TERM_FIELD)?.value ?? '').trim() || null;
            const utmSource = pickFirstNonEmpty(fvs, utmFields.source);
            const utmMedium = pickFirstNonEmpty(fvs, utmFields.medium);
            const utmCampaign = pickFirstNonEmpty(fvs, utmFields.campaign);
            const utmContent = pickFirstNonEmpty(fvs, utmFields.content);
            const importoRaw = fvs.find((fv) => fv.field === IMPORTO_CONTRATTO_FIELD)?.value ?? '';

            const myTags = (page.contactTags ?? []).filter((ct) => ct.contact === c.id);
            const clienteTags = myTags.filter((ct) => String(ct.tag) === CLIENTE_TAG_ID);
            const isCliente = clienteTags.length > 0;
            const contractDate = isCliente
                ? clienteTags.reduce((earliest, ct) =>
                    new Date(ct.cdate) < new Date(earliest.cdate) ? ct : earliest,
                ).cdate.slice(0, 10)
                : null;

            const importoNum = isCliente ? parseImporto(importoRaw) : null;
            buffer.push({
                companyId,
                contactId: c.id,
                email: c.email ?? null,
                firstName: c.firstName ?? null,
                lastName: c.lastName ?? null,
                phone: c.phone || null,
                cdate: new Date(c.cdate),
                udate: c.udate ? new Date(c.udate) : null,
                funnelId: resolveFunnel(provRaw, funnels),
                provenienzaRaw: provRaw || null,
                utmTerm,
                utmSource,
                utmMedium,
                utmCampaign,
                utmContent,
                isCliente,
                contractDate,
                contractValue: importoNum == null ? null : String(importoNum),
            });
        }

        if (buffer.length >= 500) {
            const n = await flushBuffer(buffer.splice(0, buffer.length));
            stats.contactsUpserted += n;
        }

        const total = parseInt(page.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) break;
    }

    if (buffer.length > 0) {
        const n = await flushBuffer(buffer);
        stats.contactsUpserted += n;
    }

    if (stats.errors.length === 0) {
        await writeLastSyncedAt(companyId, until);
    }

    return stats;
}

async function flushBuffer(rows: ContactRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    await db
        .insert(acContacts)
        .values(rows)
        .onConflictDoUpdate({
            target: [acContacts.companyId, acContacts.contactId],
            set: {
                email: sql`excluded.email`,
                firstName: sql`excluded.first_name`,
                lastName: sql`excluded.last_name`,
                phone: sql`excluded.phone`,
                cdate: sql`excluded.cdate`,
                udate: sql`excluded.udate`,
                funnelId: sql`excluded.funnel_id`,
                provenienzaRaw: sql`excluded.provenienza_raw`,
                utmSource: sql`excluded.utm_source`,
                utmMedium: sql`excluded.utm_medium`,
                utmCampaign: sql`excluded.utm_campaign`,
                utmTerm: sql`excluded.utm_term`,
                utmContent: sql`excluded.utm_content`,
                isCliente: sql`excluded.is_cliente`,
                contractDate: sql`excluded.contract_date`,
                contractValue: sql`excluded.contract_value`,
                syncedAt: sql`now()`,
            },
        });
    return rows.length;
}

async function readLastSyncedAt(companyId: string): Promise<string | null> {
    const rows = await db
        .select({ value: acSyncState.value })
        .from(acSyncState)
        .where(and(
            eq(acSyncState.companyId, companyId),
            eq(acSyncState.key, SYNC_STATE_KEY),
        ))
        .limit(1);
    return rows[0]?.value ?? null;
}

async function writeLastSyncedAt(companyId: string, iso: string): Promise<void> {
    await db
        .insert(acSyncState)
        .values({ companyId, key: SYNC_STATE_KEY, value: iso })
        .onConflictDoUpdate({
            target: [acSyncState.companyId, acSyncState.key],
            set: { value: iso, updatedAt: sql`now()` },
        });
}
