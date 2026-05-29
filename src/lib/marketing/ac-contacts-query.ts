// src/lib/marketing/ac-contacts-query.ts
// Centralised reads from the ac_contacts cache per i LEAD — Drizzle port.
//
// Le vendite/contratti sono migrati a crm_deals: vedi crm-deals-reader.ts.

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { acContacts } from '@/db/schema';

interface ContactRow {
    contact_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    cdate: string;
    funnel_id: string | null;
    provenienza_raw: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
}

type Range = { from: string; to: string };

/** Contacts whose lead (cdate) falls inside the range. */
export async function getLeadsInRange(
    companyId: string,
    { from, to }: Range,
): Promise<ContactRow[]> {
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const rows = await db
        .select({
            contactId: acContacts.contactId,
            email: acContacts.email,
            firstName: acContacts.firstName,
            lastName: acContacts.lastName,
            phone: acContacts.phone,
            cdate: acContacts.cdate,
            funnelId: acContacts.funnelId,
            provenienzaRaw: acContacts.provenienzaRaw,
            utmSource: acContacts.utmSource,
            utmMedium: acContacts.utmMedium,
            utmCampaign: acContacts.utmCampaign,
            utmTerm: acContacts.utmTerm,
            utmContent: acContacts.utmContent,
        })
        .from(acContacts)
        .where(and(
            eq(acContacts.companyId, companyId),
            eq(acContacts.manuallyExcluded, false),
            gte(acContacts.cdate, fromDate),
            lte(acContacts.cdate, toDate),
        ));

    return rows.map((r) => ({
        contact_id: r.contactId,
        email: r.email,
        first_name: r.firstName,
        last_name: r.lastName,
        phone: r.phone,
        cdate: r.cdate instanceof Date ? r.cdate.toISOString() : String(r.cdate),
        funnel_id: r.funnelId,
        provenienza_raw: r.provenienzaRaw,
        utm_source: r.utmSource,
        utm_medium: r.utmMedium,
        utm_campaign: r.utmCampaign,
        utm_term: r.utmTerm,
        utm_content: r.utmContent,
    }));
}

export interface LeadsByFunnel {
    total: Record<string, number>;
    byAd: Record<string, Record<string, number>>;
    // Lead counts keyed solo per utm_term (ad_name), aggregati su tutti i funnel.
    // Usato per gli ads "Altro" che non hanno un funnel assegnato.
    byAdGlobal: Record<string, number>;
}

export function aggregateLeadsByFunnel(rows: ContactRow[]): LeadsByFunnel {
    const total: Record<string, number> = {};
    const byAd: Record<string, Record<string, number>> = {};
    const byAdGlobal: Record<string, number> = {};
    for (const r of rows) {
        const ad = (r.utm_term ?? '').trim();
        if (ad) byAdGlobal[ad] = (byAdGlobal[ad] ?? 0) + 1;
        const fid = r.funnel_id;
        if (!fid) continue;
        total[fid] = (total[fid] ?? 0) + 1;
        if (!ad) continue;
        byAd[fid] ??= {};
        byAd[fid][ad] = (byAd[fid][ad] ?? 0) + 1;
    }
    return { total, byAd, byAdGlobal };
}
