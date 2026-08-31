'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import { fetchDatabaseClientiRows } from '@/lib/riconciliazione/sheetsClient';
import { parseCsv } from '@/lib/riconciliazione/csv';
import {
    confrontaMeseConValues,
    applicaCorrezioniCome,
    annullaRunCome,
    elencoRunPerMese,
    type ConfrontoResult,
    type ApplyResult,
    type AnnullaRunResult,
    type RiconciliazioneRunSummary,
} from '@/lib/riconciliazione/engine';

export type { ConfrontoResult, ApplyResult, AnnullaRunResult, RiconciliazioneRunSummary };

async function requireAdmin(): Promise<{ id: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') return null;
    return { id: user.id };
}

export async function confrontaMese(monthKey: string): Promise<ConfrontoResult> {
    if (!await requireAdmin()) return { success: false, error: 'Non autorizzato.' };
    return confrontaMeseConValues(monthKey, fetchDatabaseClientiRows);
}

export async function confrontaMeseDaCsv(monthKey: string, csv: string): Promise<ConfrontoResult> {
    if (!await requireAdmin()) return { success: false, error: 'Non autorizzato.' };
    return confrontaMeseConValues(monthKey, async () => parseCsv(csv));
}

export async function applicaCorrezioni(monthKey: string, keys: string[], csv?: string): Promise<ApplyResult> {
    const admin = await requireAdmin();
    if (!admin) return { success: false, error: 'Non autorizzato.' };

    const esito = await applicaCorrezioniCome(admin.id, monthKey, keys, csv);
    if (esito.success) revalidatePath('/riconciliazione');
    return esito;
}

export async function annullaRun(runId: string): Promise<AnnullaRunResult> {
    const admin = await requireAdmin();
    if (!admin) return { success: false, error: 'Non autorizzato.' };

    const esito = await annullaRunCome(admin.id, runId);
    if (esito.success) revalidatePath('/riconciliazione');
    return esito;
}

export async function elencoRun(monthKey: string): Promise<RiconciliazioneRunSummary[]> {
    // Lancia, non torna una lista vuota: su una feature di recupero il silenzio
    // sarebbe il fallimento peggiore, perché "niente da annullare qui" e
    // "permesso negato" si leggerebbero identici.
    if (!await requireAdmin()) throw new Error('Non autorizzato.');
    return elencoRunPerMese(monthKey);
}
