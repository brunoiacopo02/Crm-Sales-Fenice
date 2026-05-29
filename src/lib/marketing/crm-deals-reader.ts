// src/lib/marketing/crm-deals-reader.ts
// Reader vendite da crmDeals — Drizzle port.

import { and, eq, gte, lte, inArray, desc } from 'drizzle-orm';
import { db } from '@/db';
import { crmDeals, crmEvents } from '@/db/schema';
import type { SalesAttribution, SalesResult } from './activecampaign';

interface FunnelLite { id: string }

export interface CrmSaleRow {
    contact_id: string;         // crmDeals.eventId (chiave opaca per il frontend)
    lead_id: string;            // crmDeals.leadId (CRM gestionale)
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    revenue: number;
    contract_date: string;      // closedAt ISO
    lead_date: string;          // payload.lead.createdAt ISO
    provenienza_raw: string;    // payload.lead.source
    funnel_id: string | null;
    ad_name: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
}

function emptyResult(): SalesResult {
    return { count: 0, revenue: 0 };
}

function emptyAttribution(funnels: FunnelLite[]): SalesAttribution {
    return {
        byFunnel: Object.fromEntries(funnels.map((f) => [f.id, emptyResult()])),
        byFunnelByAd: Object.fromEntries(
            funnels.map((f) => [f.id, {} as Record<string, SalesResult>]),
        ),
        byAdGlobal: {},
        unattributed: emptyResult(),
        total: emptyResult(),
    };
}

function round2(r: SalesResult): SalesResult {
    return { count: r.count, revenue: Math.round(r.revenue * 100) / 100 };
}

export async function getSalesAttributionFromDeals(
    companyId: string,
    funnels: FunnelLite[],
    from: string,
    to: string,
): Promise<SalesAttribution> {
    let rows: { funnel: string | null; utmTerm: string | null; amountEur: string | null; status: string; closedDate: unknown }[];
    try {
        rows = await db
            .select({
                funnel: crmDeals.funnel,
                utmTerm: crmDeals.utmTerm,
                amountEur: crmDeals.amountEur,
                status: crmDeals.status,
                closedDate: crmDeals.closedDate,
            })
            .from(crmDeals)
            .where(and(
                eq(crmDeals.companyId, companyId),
                eq(crmDeals.manuallyExcluded, false),
                eq(crmDeals.status, 'WON'),
                gte(crmDeals.closedDate, from),
                lte(crmDeals.closedDate, to),
            ));
    } catch (e) {
        console.error('[crm-deals-reader] select error', e);
        return emptyAttribution(funnels);
    }

    const funnelIds = new Set(funnels.map((f) => f.id));
    const out = emptyAttribution(funnels);
    const byAdGlobal = out.byAdGlobal!;

    for (const d of rows) {
        const amount = Number(d.amountEur ?? 0);
        const fid = d.funnel ?? null;
        const rawTerm = (d.utmTerm ?? '').trim();
        const term = rawTerm || '__unknown__';

        if (rawTerm) {
            if (!byAdGlobal[rawTerm]) byAdGlobal[rawTerm] = emptyResult();
            byAdGlobal[rawTerm].count += 1;
            byAdGlobal[rawTerm].revenue += amount;
        }

        if (fid && funnelIds.has(fid)) {
            out.byFunnel[fid].count += 1;
            out.byFunnel[fid].revenue += amount;
            const adMap = out.byFunnelByAd[fid];
            if (!adMap[term]) adMap[term] = emptyResult();
            adMap[term].count += 1;
            adMap[term].revenue += amount;
        } else {
            out.unattributed.count += 1;
            out.unattributed.revenue += amount;
        }
        out.total.count += 1;
        out.total.revenue += amount;
    }

    for (const fid of Object.keys(out.byFunnel)) out.byFunnel[fid] = round2(out.byFunnel[fid]);
    for (const fid of Object.keys(out.byFunnelByAd)) {
        for (const term of Object.keys(out.byFunnelByAd[fid])) {
            out.byFunnelByAd[fid][term] = round2(out.byFunnelByAd[fid][term]);
        }
    }
    for (const ad of Object.keys(byAdGlobal)) byAdGlobal[ad] = round2(byAdGlobal[ad]);
    out.unattributed = round2(out.unattributed);
    out.total = round2(out.total);
    return out;
}

export interface CrmSaleAggRow {
    contract_date: string;   // crmDeals.closedDate (YYYY-MM-DD)
    revenue: number;
    funnel_id: string | null;
    ad_name: string | null;  // utmTerm trimmed, null se vuoto
}

export async function getSalesRowsFromDeals(
    companyId: string,
    from: string,
    to: string,
): Promise<CrmSaleAggRow[]> {
    try {
        const rows = await db
            .select({
                funnel: crmDeals.funnel,
                utmTerm: crmDeals.utmTerm,
                amountEur: crmDeals.amountEur,
                closedDate: crmDeals.closedDate,
            })
            .from(crmDeals)
            .where(and(
                eq(crmDeals.companyId, companyId),
                eq(crmDeals.manuallyExcluded, false),
                eq(crmDeals.status, 'WON'),
                gte(crmDeals.closedDate, from),
                lte(crmDeals.closedDate, to),
            ));
        return rows.map((d) => ({
            contract_date: (d.closedDate as unknown as string) ?? '',
            revenue: Number(d.amountEur ?? 0),
            funnel_id: d.funnel ?? null,
            ad_name: (d.utmTerm ?? '').trim() || null,
        }));
    } catch (e) {
        console.error('[crm-deals-reader] rows select error', e);
        return [];
    }
}

// ─── Riga per riga (per /api/sales/list) ──────────────────────────────────────

function splitName(full: string): { first: string; last: string } {
    const trimmed = (full ?? '').trim();
    if (!trimmed) return { first: '', last: '' };
    const i = trimmed.indexOf(' ');
    if (i < 0) return { first: trimmed, last: '' };
    return { first: trimmed.slice(0, i), last: trimmed.slice(i + 1).trim() };
}

interface LeadPayload {
    name?: string;
    email?: string;
    phone?: string | null;
    source?: string | null;
    createdAt?: string;
    utm?: {
        source?: string | null;
        medium?: string | null;
        campaign?: string | null;
        content?: string | null;
        term?: string | null;
    };
}

export async function getSalesListFromDeals(
    companyId: string,
    from: string,
    to: string,
): Promise<CrmSaleRow[]> {
    let deals: {
        eventId: string;
        leadId: string;
        funnel: string | null;
        utmSource: string | null;
        utmMedium: string | null;
        utmCampaign: string | null;
        utmContent: string | null;
        utmTerm: string | null;
        amountEur: string | null;
        closedAt: Date;
        closedDate: unknown;
    }[];
    try {
        deals = await db
            .select({
                eventId: crmDeals.eventId,
                leadId: crmDeals.leadId,
                funnel: crmDeals.funnel,
                utmSource: crmDeals.utmSource,
                utmMedium: crmDeals.utmMedium,
                utmCampaign: crmDeals.utmCampaign,
                utmContent: crmDeals.utmContent,
                utmTerm: crmDeals.utmTerm,
                amountEur: crmDeals.amountEur,
                closedAt: crmDeals.closedAt,
                closedDate: crmDeals.closedDate,
            })
            .from(crmDeals)
            .where(and(
                eq(crmDeals.companyId, companyId),
                eq(crmDeals.status, 'WON'),
                eq(crmDeals.manuallyExcluded, false),
                gte(crmDeals.closedDate, from),
                lte(crmDeals.closedDate, to),
            ))
            .orderBy(desc(crmDeals.closedDate));
    } catch (e) {
        console.error('[crm-deals-reader] list deals error', e);
        return [];
    }
    if (deals.length === 0) return [];

    const eventIds = deals.map((d) => d.eventId);
    let events: { eventId: string; payload: unknown }[];
    try {
        events = await db
            .select({ eventId: crmEvents.eventId, payload: crmEvents.payload })
            .from(crmEvents)
            .where(inArray(crmEvents.eventId, eventIds));
    } catch (e) {
        console.error('[crm-deals-reader] list events error', e);
        return [];
    }

    const payloadByEvent = new Map<string, LeadPayload>();
    for (const e of events) {
        const lead = ((e.payload as { lead?: LeadPayload } | null)?.lead ?? {}) as LeadPayload;
        payloadByEvent.set(e.eventId, lead);
    }

    return deals.map((d) => {
        const lead = payloadByEvent.get(d.eventId) ?? ({} as LeadPayload);
        const { first, last } = splitName(lead.name ?? '');
        return {
            contact_id: d.eventId,
            lead_id: d.leadId,
            first_name: first,
            last_name: last,
            email: lead.email ?? '',
            phone: lead.phone ?? null,
            revenue: Number(d.amountEur ?? 0),
            contract_date: d.closedAt instanceof Date ? d.closedAt.toISOString() : String(d.closedAt ?? ''),
            lead_date: lead.createdAt ?? '',
            provenienza_raw: lead.source ?? '',
            funnel_id: d.funnel ?? null,
            ad_name: (d.utmTerm ?? '').trim() || null,
            utm_source: d.utmSource ?? lead.utm?.source ?? null,
            utm_medium: d.utmMedium ?? lead.utm?.medium ?? null,
            utm_campaign: d.utmCampaign ?? lead.utm?.campaign ?? null,
            utm_term: d.utmTerm ?? lead.utm?.term ?? null,
            utm_content: d.utmContent ?? lead.utm?.content ?? null,
        };
    });
}
