'use server';

import { and, eq, gte, lt, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { leads, salesAttempts } from '@/db/schema';
import { createClient } from '@/utils/supabase/server';
import { normalizePhoneStrict } from '@/lib/phoneNormalize';
import { monthBoundsRome } from '@/lib/dateUtils';
import { fetchDatabaseClientiRows } from '@/lib/riconciliazione/sheetsClient';
import { parseSheetRows, SheetUnavailableError } from '@/lib/riconciliazione/sheetRows';
import { reconcile, type CrmClosure, type DiffEntry } from '@/lib/riconciliazione/match';

const COMPANY_ID = 'fenice'; // il foglio non contiene Serenamente

async function requireAdmin(): Promise<{ id: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') return null;
    return { id: user.id };
}

async function loadCrmClosures(monthKey: string): Promise<CrmClosure[]> {
    // salespersonOutcomeAt è un timestamptz: i bounds vanno calcolati in Europe/Rome
    // (helper condiviso), non con Date.UTC — altrimenti le chiusure della prima/ultima
    // ora del mese finiscono nel mese sbagliato (già successo in questo progetto).
    const { start, end } = monthBoundsRome(monthKey);

    const rows = await db.select({
        id: leads.id,
        phone: leads.phone,
        email: leads.email,
        name: leads.name,
        funnel: leads.funnel,
        outcome: leads.salespersonOutcome,
        outcomeAt: leads.salespersonOutcomeAt,
        amountEur: leads.closeAmountEur,
        status: leads.status,
        salespersonAssigned: leads.salespersonAssigned,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, COMPANY_ID),
            gte(leads.salespersonOutcomeAt, start),
            lt(leads.salespersonOutcomeAt, end),
        ));

    const attempts = rows.length === 0 ? [] : await db.select({
        leadId: salesAttempts.leadId,
        amountEur: salesAttempts.closeAmountEur,
        outcome: salesAttempts.outcome,
    })
        .from(salesAttempts)
        .where(and(
            eq(salesAttempts.companyId, COMPANY_ID),
            gte(salesAttempts.outcomeAt, start),
            lt(salesAttempts.outcomeAt, end),
            inArray(salesAttempts.leadId, rows.map(r => r.id)),
        ));

    const attemptTotals = new Map<string, number>();
    for (const a of attempts) {
        if (a.outcome !== 'Chiuso') continue;
        attemptTotals.set(a.leadId, (attemptTotals.get(a.leadId) ?? 0) + (a.amountEur ?? 0));
    }

    return rows.map(r => ({
        leadId: r.id,
        phone: normalizePhoneStrict(r.phone),
        email: (r.email ?? '').trim().toLowerCase() || null,
        fullName: r.name ?? '',
        funnel: r.funnel,
        outcome: r.outcome,
        outcomeAt: r.outcomeAt,
        amountEur: r.amountEur,
        attemptsAmountEur: attemptTotals.get(r.id) ?? 0,
        isRejected: r.status === 'REJECTED',
        salespersonAssigned: r.salespersonAssigned,
    }));
}

export type ConfrontoResult =
    | { success: true; entries: DiffEntry[]; sheetContracts: number; sheetTotalEur: number; crmTotalEur: number }
    | { success: false; error: string };

export async function confrontaMese(monthKey: string): Promise<ConfrontoResult> {
    if (!await requireAdmin()) return { success: false, error: 'Non autorizzato.' };
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return { success: false, error: 'Mese non valido.' };

    try {
        const values = await fetchDatabaseClientiRows();
        const sheet = parseSheetRows(values, monthKey);
        const crm = await loadCrmClosures(monthKey);
        const entries = reconcile(sheet, crm);
        return {
            success: true,
            entries,
            sheetContracts: sheet.length,
            sheetTotalEur: sheet.reduce((s, c) => s + c.amountEur, 0),
            crmTotalEur: crm.filter(c => c.outcome === 'Chiuso').reduce((s, c) => s + (c.amountEur ?? 0), 0),
        };
    } catch (e) {
        if (e instanceof SheetUnavailableError) return { success: false, error: e.message };
        return { success: false, error: 'Confronto fallito: ' + (e instanceof Error ? e.message : 'errore ignoto') };
    }
}
