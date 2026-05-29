// src/lib/marketing/activecampaign.ts
// ActiveCampaign API client (pure HTTP, no DB).

import type { AcCredentials } from './ac-credentials';

async function acGet<T>(
    creds: AcCredentials,
    path: string,
    params: Record<string, string> = {},
): Promise<T> {
    const url = new URL(`${creds.url}/api/3${path}`);
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

export async function getListId(creds: AcCredentials, listName: string): Promise<string | null> {
    let offset = 0;
    const limit = 100;
    while (true) {
        const data = await acGet<{ lists: { id: string; name: string }[]; meta: { total: string } }>(
            creds,
            '/lists',
            { limit: String(limit), offset: String(offset) },
        );
        const found = data.lists.find((l) => l.name.toLowerCase() === listName.toLowerCase());
        if (found) return found.id;
        const total = parseInt(data.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) return null;
    }
}

export async function getLeadCount(
    creds: AcCredentials,
    listName: string,
    dateFrom: string,
    dateTo: string,
): Promise<number> {
    const listId = await getListId(creds, listName);
    if (!listId) return 0;

    const start = `${dateFrom}T00:00:00`;
    const endDate = new Date(dateTo);
    endDate.setDate(endDate.getDate() + 1);
    const end = endDate.toISOString().slice(0, 10) + 'T00:00:00';

    const data = await acGet<{ meta: { total: string } }>(creds, '/contacts', {
        listid: listId,
        'filters[created_after]': start,
        'filters[created_before]': end,
        limit: '1',
    });
    return parseInt(data.meta?.total ?? '0', 10);
}

export interface SalesResult {
    count: number;
    revenue: number;
}

const IMPORTO_CONTRATTO_FIELD = '43';
const PROVENIENZA_FIELD = '2';
const UTM_TERM_FIELD = '35';

export interface SalesAttribution {
    byFunnel: Record<string, SalesResult>;
    byFunnelByAd: Record<string, Record<string, SalesResult>>; // funnelId → adName → result
    // Vendite per ad_name aggregate cross-funnel. Popolato solo dal reader CRM
    // (crm-deals-reader). Il reader AC legacy non lo popola.
    byAdGlobal?: Record<string, SalesResult>;
    unattributed: SalesResult;
    total: SalesResult;
}

/**
 * Single AC pagination loop: attributes clients to funnels (via Provenienza) AND to
 * individual ads (via utm_term). Returns both breakdowns so callers need only one query.
 */
export async function getSalesAttribution(
    creds: AcCredentials,
    tagId: string,
    funnels: { id: string; ac_provenienza_patterns: string[] }[],
    dateFrom: string,
    dateTo: string,
): Promise<SalesAttribution> {
    const empty = (): SalesResult => ({ count: 0, revenue: 0 });
    const result: SalesAttribution = {
        byFunnel: Object.fromEntries(funnels.map((f) => [f.id, empty()])),
        byFunnelByAd: Object.fromEntries(funnels.map((f) => [f.id, {}])),
        unattributed: empty(),
        total: empty(),
    };
    if (!tagId) return result;

    const start = `${dateFrom}T00:00:00`;
    const endDate = new Date(dateTo);
    endDate.setDate(endDate.getDate() + 1);
    const end = endDate.toISOString().slice(0, 10) + 'T00:00:00';

    const limit = 100;
    let offset = 0;

    while (true) {
        const data = await acGet<{
            contacts: { id: string }[];
            fieldValues?: { contact: string; field: string; value: string }[];
            meta: { total: string };
        }>(creds, '/contacts', {
            tagid: tagId,
            'filters[created_after]': start,
            'filters[created_before]': end,
            include: 'fieldValues',
            limit: String(limit),
            offset: String(offset),
        });

        for (const c of data.contacts ?? []) {
            const myFields = (data.fieldValues ?? []).filter((fv) => fv.contact === c.id);
            const provRaw = myFields.find((fv) => fv.field === PROVENIENZA_FIELD)?.value ?? '';
            const prov = provRaw.toLowerCase().trim();
            const importoRaw = myFields.find((fv) => fv.field === IMPORTO_CONTRATTO_FIELD)?.value ?? '';
            const amount = importoRaw ? parseFloat(importoRaw.replace(',', '.').replace(/[€\s]/g, '')) : 0;
            const revenue = isNaN(amount) ? 0 : amount;
            const adName = myFields.find((fv) => fv.field === UTM_TERM_FIELD)?.value?.trim() ?? '';

            const match = funnels.find((f) =>
                f.ac_provenienza_patterns.some((p) => prov.includes(p.toLowerCase())),
            );
            const bucket = match ? result.byFunnel[match.id] : result.unattributed;
            bucket.count += 1;
            bucket.revenue += revenue;
            result.total.count += 1;
            result.total.revenue += revenue;

            if (match && adName) {
                const adKey = adName;
                if (!result.byFunnelByAd[match.id][adKey]) result.byFunnelByAd[match.id][adKey] = empty();
                result.byFunnelByAd[match.id][adKey].count += 1;
                result.byFunnelByAd[match.id][adKey].revenue += revenue;
            }
        }

        const total = parseInt(data.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) break;
    }

    const round = (r: SalesResult) => ({ count: r.count, revenue: Math.round(r.revenue * 100) / 100 });
    for (const id of Object.keys(result.byFunnel)) {
        result.byFunnel[id] = round(result.byFunnel[id]);
        for (const ad of Object.keys(result.byFunnelByAd[id]))
            result.byFunnelByAd[id][ad] = round(result.byFunnelByAd[id][ad]);
    }
    result.unattributed = round(result.unattributed);
    result.total = round(result.total);

    return result;
}

export async function getSalesByTag(
    creds: AcCredentials,
    tagId: string,
    dateFrom: string,
    dateTo: string,
): Promise<SalesResult> {
    if (!tagId) return { count: 0, revenue: 0 };

    const start = `${dateFrom}T00:00:00`;
    const endDate = new Date(dateTo);
    endDate.setDate(endDate.getDate() + 1);
    const end = endDate.toISOString().slice(0, 10) + 'T00:00:00';

    const limit = 100;
    let offset = 0;
    const contactIds: string[] = [];

    while (true) {
        const data = await acGet<{ contacts: { id: string }[]; meta: { total: string } }>(
            creds,
            '/contacts',
            {
                tagid: tagId,
                'filters[created_after]': start,
                'filters[created_before]': end,
                limit: String(limit),
                offset: String(offset),
            },
        );
        contactIds.push(...(data.contacts ?? []).map((c) => c.id));
        const total = parseInt(data.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) break;
    }

    if (contactIds.length === 0) return { count: 0, revenue: 0 };

    const revenues = await Promise.all(
        contactIds.map(async (id) => {
            try {
                const data = await acGet<{ fieldValues: { field: string; value: string }[] }>(
                    creds,
                    `/contacts/${id}/fieldValues`,
                );
                const fv = (data.fieldValues ?? []).find((f) => f.field === IMPORTO_CONTRATTO_FIELD);
                if (!fv?.value) return 0;
                const amount = parseFloat(fv.value.replace(',', '.').replace(/[€\s]/g, ''));
                return isNaN(amount) ? 0 : amount;
            } catch {
                return 0;
            }
        }),
    );

    const revenue = revenues.reduce((a, b) => a + b, 0);
    return { count: contactIds.length, revenue: Math.round(revenue * 100) / 100 };
}

export async function getClientAttributionByFunnel(
    creds: AcCredentials,
    tagId: string,
    funnels: { id: string; ac_provenienza_patterns: string[] }[],
    dateFrom: string,
    dateTo: string,
): Promise<{
    perFunnel: Record<string, Record<string, { count: number; revenue: number }>>;
    all: Record<string, { count: number; revenue: number }>;
}> {
    const empty = () => ({ count: 0, revenue: 0 });
    const perFunnel: Record<string, Record<string, { count: number; revenue: number }>> =
        Object.fromEntries(funnels.map((f) => [f.id, {}]));
    const all: Record<string, { count: number; revenue: number }> = {};

    if (!tagId) return { perFunnel, all };

    const start = `${dateFrom}T00:00:00`;
    const endDate = new Date(dateTo);
    endDate.setDate(endDate.getDate() + 1);
    const end = endDate.toISOString().slice(0, 10) + 'T00:00:00';

    const limit = 100;
    let offset = 0;

    const add = (
        bucket: Record<string, { count: number; revenue: number }>,
        key: string,
        revenue: number,
    ) => {
        if (!bucket[key]) bucket[key] = empty();
        bucket[key].count += 1;
        bucket[key].revenue += revenue;
    };

    while (true) {
        const data = await acGet<{
            contacts: { id: string }[];
            fieldValues?: { contact: string; field: string; value: string }[];
            meta: { total: string };
        }>(creds, '/contacts', {
            tagid: tagId,
            'filters[created_after]': start,
            'filters[created_before]': end,
            include: 'fieldValues',
            limit: String(limit),
            offset: String(offset),
        });

        for (const c of data.contacts ?? []) {
            const myFields = (data.fieldValues ?? []).filter((fv) => fv.contact === c.id);
            const adName = myFields.find((fv) => fv.field === UTM_TERM_FIELD)?.value?.trim() ?? '';
            const provRaw = myFields.find((fv) => fv.field === PROVENIENZA_FIELD)?.value ?? '';
            const prov = provRaw.toLowerCase().trim();
            const importoRaw = myFields.find((fv) => fv.field === IMPORTO_CONTRATTO_FIELD)?.value ?? '';
            const amount = importoRaw ? parseFloat(importoRaw.replace(',', '.').replace(/[€\s]/g, '')) : 0;
            const revenue = isNaN(amount) ? 0 : amount;

            const key = adName || '__unattributed__';

            const matchedFunnel = funnels.find((f) =>
                f.ac_provenienza_patterns.some((p) => prov.includes(p.toLowerCase())),
            );
            if (matchedFunnel) add(perFunnel[matchedFunnel.id], key, revenue);

            add(all, key, revenue);
        }

        const total = parseInt(data.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) break;
    }

    const round = (bucket: Record<string, { count: number; revenue: number }>) => {
        for (const k of Object.keys(bucket))
            bucket[k].revenue = Math.round(bucket[k].revenue * 100) / 100;
    };
    for (const f of Object.keys(perFunnel)) round(perFunnel[f]);
    round(all);

    return { perFunnel, all };
}

export async function getSalesAttributionByContractDate(
    creds: AcCredentials,
    tagId: string,
    funnels: { id: string; ac_provenienza_patterns: string[] }[],
    dateFrom: string,
    dateTo: string,
): Promise<SalesAttribution> {
    const empty = (): SalesResult => ({ count: 0, revenue: 0 });
    const result: SalesAttribution = {
        byFunnel: Object.fromEntries(funnels.map((f) => [f.id, empty()])),
        byFunnelByAd: Object.fromEntries(funnels.map((f) => [f.id, {}])),
        unattributed: empty(),
        total: empty(),
    };
    if (!tagId) return result;

    const fromDate = new Date(`${dateFrom}T00:00:00`);
    const toDate = new Date(`${dateTo}T23:59:59`);

    const limit = 100;
    let offset = 0;

    while (true) {
        const data = await acGet<{
            contacts: { id: string }[];
            fieldValues?: { contact: string; field: string; value: string }[];
            contactTags?: { id: string; contact: string; tag: string; cdate: string }[];
            meta: { total: string };
        }>(creds, '/contacts', {
            tagid: tagId,
            include: 'fieldValues,contactTags',
            limit: String(limit),
            offset: String(offset),
        });

        for (const c of data.contacts ?? []) {
            const myContactTags = (data.contactTags ?? []).filter(
                (ct) => ct.contact === c.id && String(ct.tag) === String(tagId),
            );
            if (myContactTags.length === 0) continue;

            const tagAppliedDate = myContactTags.reduce((latest, ct) =>
                new Date(ct.cdate) > new Date(latest.cdate) ? ct : latest,
            ).cdate;
            const tagDate = new Date(tagAppliedDate);

            if (tagDate < fromDate || tagDate > toDate) continue;

            const myFields = (data.fieldValues ?? []).filter((fv) => fv.contact === c.id);
            const provRaw = myFields.find((fv) => fv.field === PROVENIENZA_FIELD)?.value ?? '';
            const prov = provRaw.toLowerCase().trim();
            const importoRaw = myFields.find((fv) => fv.field === IMPORTO_CONTRATTO_FIELD)?.value ?? '';
            const amount = importoRaw ? parseFloat(importoRaw.replace(',', '.').replace(/[€\s]/g, '')) : 0;
            const revenue = isNaN(amount) ? 0 : amount;
            const adName = myFields.find((fv) => fv.field === UTM_TERM_FIELD)?.value?.trim() ?? '';

            const match = funnels.find((f) =>
                f.ac_provenienza_patterns.some((p) => prov.includes(p.toLowerCase())),
            );
            const bucket = match ? result.byFunnel[match.id] : result.unattributed;
            bucket.count += 1;
            bucket.revenue += revenue;
            result.total.count += 1;
            result.total.revenue += revenue;

            if (match && adName) {
                if (!result.byFunnelByAd[match.id][adName]) result.byFunnelByAd[match.id][adName] = empty();
                result.byFunnelByAd[match.id][adName].count += 1;
                result.byFunnelByAd[match.id][adName].revenue += revenue;
            }
        }

        const total = parseInt(data.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) break;
    }

    const round = (r: SalesResult) => ({ count: r.count, revenue: Math.round(r.revenue * 100) / 100 });
    for (const id of Object.keys(result.byFunnel)) {
        result.byFunnel[id] = round(result.byFunnel[id]);
        for (const ad of Object.keys(result.byFunnelByAd[id]))
            result.byFunnelByAd[id][ad] = round(result.byFunnelByAd[id][ad]);
    }
    result.unattributed = round(result.unattributed);
    result.total = round(result.total);

    return result;
}

export interface SaleRecord {
    contact_id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    revenue: number;
    contract_date: string;
    lead_date: string;
    provenienza_raw: string;
    funnel_id: string | null;
    ad_name: string | null;
}

export async function getSalesDetails(
    creds: AcCredentials,
    tagId: string,
    funnels: { id: string; ac_provenienza_patterns: string[] }[],
    dateFrom: string,
    dateTo: string,
): Promise<SaleRecord[]> {
    if (!tagId) return [];

    const fromDate = new Date(`${dateFrom}T00:00:00`);
    const toDate = new Date(`${dateTo}T23:59:59`);

    const limit = 100;
    let offset = 0;
    const out: SaleRecord[] = [];

    while (true) {
        const data = await acGet<{
            contacts: {
                id: string;
                email: string;
                firstName?: string;
                lastName?: string;
                phone?: string;
                cdate: string;
            }[];
            fieldValues?: { contact: string; field: string; value: string }[];
            contactTags?: { id: string; contact: string; tag: string; cdate: string }[];
            meta: { total: string };
        }>(creds, '/contacts', {
            tagid: tagId,
            include: 'fieldValues,contactTags',
            limit: String(limit),
            offset: String(offset),
        });

        for (const c of data.contacts ?? []) {
            const myContactTags = (data.contactTags ?? []).filter(
                (ct) => ct.contact === c.id && String(ct.tag) === String(tagId),
            );
            if (myContactTags.length === 0) continue;

            const tagAppliedDate = myContactTags.reduce((latest, ct) =>
                new Date(ct.cdate) > new Date(latest.cdate) ? ct : latest,
            ).cdate;
            const tagDate = new Date(tagAppliedDate);
            if (tagDate < fromDate || tagDate > toDate) continue;

            const myFields = (data.fieldValues ?? []).filter((fv) => fv.contact === c.id);
            const provRaw = myFields.find((fv) => fv.field === PROVENIENZA_FIELD)?.value ?? '';
            const importoRaw = myFields.find((fv) => fv.field === IMPORTO_CONTRATTO_FIELD)?.value ?? '';
            const amount = importoRaw
                ? parseFloat(importoRaw.replace(',', '.').replace(/[€\s]/g, ''))
                : 0;
            const revenue = isNaN(amount) ? 0 : Math.round(amount * 100) / 100;
            const adName = myFields.find((fv) => fv.field === UTM_TERM_FIELD)?.value?.trim() || null;

            const prov = provRaw.toLowerCase().trim();
            const matchedFunnel = funnels.find((f) =>
                f.ac_provenienza_patterns.some((p) => prov.includes(p.toLowerCase())),
            );

            out.push({
                contact_id: c.id,
                first_name: c.firstName ?? '',
                last_name: c.lastName ?? '',
                email: c.email,
                phone: c.phone || null,
                revenue,
                contract_date: tagAppliedDate,
                lead_date: c.cdate,
                provenienza_raw: provRaw,
                funnel_id: matchedFunnel?.id ?? null,
                ad_name: adName,
            });
        }

        const total = parseInt(data.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) break;
    }

    return out;
}

export async function getLeadsByUtmTerm(
    creds: AcCredentials,
    listName: string,
    utmTermFieldId: string,
    dateFrom: string,
    dateTo: string,
): Promise<Record<string, number>> {
    if (!utmTermFieldId) return {};

    const listId = await getListId(creds, listName);
    if (!listId) return {};

    const start = `${dateFrom}T00:00:00`;
    const endDate = new Date(dateTo);
    endDate.setDate(endDate.getDate() + 1);
    const end = endDate.toISOString().slice(0, 10) + 'T00:00:00';

    const limit = 100;
    let offset = 0;
    const countByAdName: Record<string, number> = {};

    while (true) {
        const data = await acGet<{
            contacts: { id: string; fieldValues: { field: string; value: string }[] }[];
            meta: { total: string };
        }>(creds, '/contacts', {
            listid: listId,
            'filters[created_after]': start,
            'filters[created_before]': end,
            include: 'fieldValues',
            limit: String(limit),
            offset: String(offset),
        });

        for (const contact of data.contacts) {
            const utmField = (contact.fieldValues ?? []).find((fv) => fv.field === utmTermFieldId);
            if (utmField?.value) {
                countByAdName[utmField.value] = (countByAdName[utmField.value] ?? 0) + 1;
            }
        }

        const total = parseInt(data.meta?.total ?? '0', 10);
        offset += limit;
        if (offset >= total) break;
    }

    return countByAdName;
}
