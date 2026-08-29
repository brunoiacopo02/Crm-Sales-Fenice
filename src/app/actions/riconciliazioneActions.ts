'use server';

import crypto from 'node:crypto';
import { and, eq, gte, lt, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { leads, salesAttempts, riconciliazioneRuns, riconciliazioneEntries } from '@/db/schema';
import { createClient } from '@/utils/supabase/server';
import { normalizePhoneStrict } from '@/lib/phoneNormalize';
import { monthBoundsRome } from '@/lib/dateUtils';
import { fetchDatabaseClientiRows } from '@/lib/riconciliazione/sheetsClient';
import { parseSheetRows, SheetUnavailableError } from '@/lib/riconciliazione/sheetRows';
import { reconcile, type CrmClosure, type DiffEntry } from '@/lib/riconciliazione/match';
import { resolveAttemptWrite } from '@/lib/venditorePerformance/guard';
import { logLeadEvent } from '@/lib/eventLogger';

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

export type ApplyResult = { success: true; runId: string; applied: number } | { success: false; error: string };

// Colonne di `leads` NOT NULL senza default (verificate su src/db/schema.ts, def.
// pgTable 'leads'): id, name, phone. Tutte le altre o hanno un default (status,
// version, callCount, phoneSuspicious, isSelfBooked, createdAt, updatedAt,
// companyId) o sono nullable. L'insert della famiglia lead-assente valorizza
// id/name/phone esplicitamente e lascia `status` al suo default ('NEW') come
// richiesto: questo lead non passa dal funnel, ma resta comunque un lead valido.
function requirePhoneForLeadAssente(s: NonNullable<DiffEntry['sheet']>): string {
    if (!s.phone) {
        // leads.phone è NOT NULL. Il foglio a volte ha solo la mail: meglio
        // abortire (l'intera run va in rollback) che inventare un numero
        // fittizio che finirebbe scambiato per un contatto reale.
        throw new Error(
            `Impossibile creare il lead per "${s.fullName}" (riga/e foglio ${s.sourceRows.join(',')}): il foglio non riporta un telefono e leads.phone è obbligatorio. Correggilo nel foglio o gestiscilo a mano.`,
        );
    }
    return s.phone;
}

export async function applicaCorrezioni(monthKey: string, keys: string[]): Promise<ApplyResult> {
    const admin = await requireAdmin();
    if (!admin) return { success: false, error: 'Non autorizzato.' };
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return { success: false, error: 'Mese non valido.' };

    // Il client manda SOLO le chiavi: le differenze si ricalcolano qui. Fidarsi
    // delle entry mandate dal browser significherebbe accettare importi, famiglie
    // o lead id scelti da chi apre i devtools — su un'azione che scrive fatturato
    // non è negoziabile.
    const fresh = await confrontaMese(monthKey);
    if (!fresh.success) return { success: false, error: fresh.error };

    const wanted = new Set(keys);
    // appliable === false viene ignorata anche se la chiave arriva spuntata:
    // il client non è la fonte di verità sui permessi di applicazione.
    const todo = fresh.entries.filter(e => wanted.has(e.key) && e.appliable);
    if (todo.length === 0) return { success: false, error: 'Nessuna correzione applicabile fra quelle selezionate.' };

    const runId = crypto.randomUUID();
    const touched: Array<{ leadId: string; family: string }> = [];

    try {
        await db.transaction(async (tx) => {
            await tx.insert(riconciliazioneRuns).values({
                id: runId,
                companyId: COMPANY_ID,
                monthKey,
                source: 'sheet',
                appliedBy: admin.id,
                entryCount: todo.length,
            });

            for (const e of todo) {
                if (e.family === 'lead-assente') {
                    const sheet = e.sheet!;
                    const phone = requirePhoneForLeadAssente(sheet);

                    const leadId = crypto.randomUUID();
                    const after = {
                        name: sheet.fullName,
                        phone,
                        email: sheet.email,
                        funnel: 'FUORI FUNNEL',
                        salespersonOutcome: 'Chiuso',
                        salespersonOutcomeAt: sheet.signedAt,
                        closeAmountEur: sheet.amountEur,
                        salespersonAssigned: sheet.salesCode,
                    };
                    await tx.insert(leads).values({
                        id: leadId,
                        companyId: COMPANY_ID,
                        name: after.name,
                        phone: after.phone,
                        email: after.email,
                        // Origine dedicata: il contratto entra nel fatturato totale ma
                        // resta distinguibile nelle statistiche per funnel. `status`
                        // resta al suo default ('NEW'): non va indovinato.
                        funnel: after.funnel,
                        salespersonOutcome: after.salespersonOutcome,
                        salespersonOutcomeAt: after.salespersonOutcomeAt,
                        closeAmountEur: after.closeAmountEur,
                        salespersonAssigned: after.salespersonAssigned,
                        // Nessun presentedAt, nessun appointmentDate, nessuna presenza:
                        // questo contratto non è passato dal funnel GDO/Conferme e non
                        // deve gonfiare i tassi di nessuno dei due team.
                    });
                    await tx.insert(riconciliazioneEntries).values({
                        id: crypto.randomUUID(),
                        runId,
                        leadId,
                        family: e.family,
                        createdLead: true,
                        before: {},
                        after,
                    });

                    // Nessuna scrittura su salesAttempts per questa famiglia: il lead
                    // creato qui non ha mai attraversato un ciclo di trattativa (niente
                    // check-in, niente tentativi) — non c'è nulla da correggere lì.
                    touched.push({ leadId, family: e.family });
                    continue;
                }

                const leadId = e.crm!.leadId;

                // Stato letto DENTRO la transazione: prima/dopo devono riflettere lo
                // stato reale al momento della scrittura (non lo snapshot pre-tx di
                // confrontaMese, che può essere di qualche istante più vecchio), e
                // serve per calcolare `version + 1` senza WHERE version-guarded (la
                // transazione stessa è la rete di sicurezza, per decisione del
                // controller: un conflitto a metà batch non deve far sparire in
                // silenzio una correzione).
                const [currentLead] = await tx.select({
                    version: leads.version,
                    salespersonOutcome: leads.salespersonOutcome,
                    salespersonOutcomeAt: leads.salespersonOutcomeAt,
                    closeAmountEur: leads.closeAmountEur,
                    closeProduct: leads.closeProduct,
                    salespersonOutcomeNotes: leads.salespersonOutcomeNotes,
                    salespersonAssigned: leads.salespersonAssigned,
                    salespersonUserId: leads.salespersonUserId,
                    salesCycleStartAt: leads.salesCycleStartAt,
                }).from(leads).where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, leadId)));

                if (!currentLead) {
                    throw new Error(`Lead ${leadId} non trovato durante l'applicazione (famiglia ${e.family}).`);
                }

                // Ogni famiglia tocca SOLO i campi che la sua regola elenca alla
                // lettera — 'importo' in particolare corregge solo l'importo, non
                // l'esito né l'assegnatario, che sono già corretti a monte.
                const leadSet: Record<string, unknown> = { version: currentLead.version + 1 };
                if (e.family === 'importo') {
                    leadSet.closeAmountEur = e.sheet!.amountEur;
                } else if (e.family === 'solo-crm') {
                    leadSet.salespersonOutcome = 'Non chiuso';
                    leadSet.closeAmountEur = null;
                    leadSet.closeProduct = null;
                    // notClosedReason resta null di proposito: i suoi valori sono
                    // motivazioni comportamentali (Non ha soldi, Deve parlare con
                    // terzi, ...) e nessuna descrive "assente dal foglio".
                    leadSet.salespersonOutcomeNotes = `Riconciliazione ${monthKey}: assente dal foglio o Stand-by`;
                } else {
                    // esito-mancante | lead-scartato: il foglio dice che ha firmato,
                    // il CRM no. Non tocca status/presentedAt/appointmentDate/
                    // confirmationsOutcome/funnel: la chiusura resta attribuita al
                    // funnel che il lead ha già.
                    leadSet.salespersonOutcome = 'Chiuso';
                    leadSet.salespersonOutcomeAt = e.sheet!.signedAt;
                    leadSet.closeAmountEur = e.sheet!.amountEur;
                    leadSet.salespersonAssigned = e.sheet!.salesCode ?? currentLead.salespersonAssigned;
                }

                const before: Record<string, unknown> = {};
                const after: Record<string, unknown> = {};
                for (const key of Object.keys(leadSet)) {
                    if (key === 'version') continue;
                    before[key] = (currentLead as Record<string, unknown>)[key];
                    after[key] = leadSet[key];
                }

                // La riga di storico va scritta PRIMA della modifica reale: senza
                // questa riga, nella stessa transazione della scrittura, la run non
                // sarebbe annullabile (compito del Task 7).
                await tx.insert(riconciliazioneEntries).values({
                    id: crypto.randomUUID(),
                    runId,
                    leadId,
                    family: e.family,
                    createdLead: false,
                    before,
                    after,
                });

                await tx.update(leads).set(leadSet)
                    .where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, leadId)));

                // La storia passa SEMPRE da resolveAttemptWrite: è l'unica cosa che
                // impedisce a una correzione di duplicare il tentativo e contare due
                // volte il fatturato (il bug chiuso dalla guardia dopo l'incidente di
                // luglio: ogni ri-registrazione inseriva un nuovo salesAttempts).
                const attempts = await tx.select({
                    id: salesAttempts.id,
                    outcome: salesAttempts.outcome,
                    outcomeAt: salesAttempts.outcomeAt,
                    attemptNumber: salesAttempts.attemptNumber,
                })
                    .from(salesAttempts)
                    .where(and(eq(salesAttempts.companyId, COMPANY_ID), eq(salesAttempts.leadId, leadId)));

                const attemptOutcome = e.family === 'solo-crm' ? 'Non chiuso' : 'Chiuso';
                const write = resolveAttemptWrite({
                    attempts,
                    outcome: attemptOutcome,
                    cycleStartAt: currentLead.salesCycleStartAt ?? null,
                    leadHasOutcome: !!currentLead.salespersonOutcome,
                    occasion: 'current',
                });

                if (write.mode === 'update') {
                    const attemptSet: Record<string, unknown> = {};
                    if (e.family === 'importo') {
                        attemptSet.closeAmountEur = e.sheet!.amountEur;
                    } else if (e.family === 'solo-crm') {
                        attemptSet.outcome = 'Non chiuso';
                        attemptSet.closeAmountEur = null;
                        attemptSet.closeProduct = null;
                    } else {
                        attemptSet.outcome = 'Chiuso';
                        attemptSet.outcomeAt = e.sheet!.signedAt;
                        attemptSet.closeAmountEur = e.sheet!.amountEur;
                    }
                    await tx.update(salesAttempts).set(attemptSet)
                        .where(and(eq(salesAttempts.companyId, COMPANY_ID), eq(salesAttempts.id, write.id)));
                } else {
                    // Ramo raro: nessun attempt esisteva ancora per questo lead (tipico
                    // di esito-mancante/lead-scartato, mai chiusi prima). Attribuito al
                    // venditore reale del lead se noto, altrimenti a chi applica la
                    // riconciliazione — mai lasciato NOT NULL vuoto.
                    await tx.insert(salesAttempts).values({
                        id: crypto.randomUUID(),
                        leadId,
                        companyId: COMPANY_ID,
                        salesUserId: currentLead.salespersonUserId ?? admin.id,
                        attemptNumber: write.attemptNumber,
                        outcome: attemptOutcome,
                        outcomeAt: e.family === 'solo-crm' ? (currentLead.salespersonOutcomeAt ?? new Date()) : e.sheet!.signedAt,
                        closeAmountEur: e.family === 'solo-crm' ? null : e.sheet!.amountEur,
                    });
                }

                touched.push({ leadId, family: e.family });
            }
        });
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Applicazione fallita, nessuna modifica salvata.' };
    }

    // Fuori dalla transazione: la scrittura finanziaria è già al sicuro (o
    // completamente annullata sopra). Il log evento è un audit trail
    // aggiuntivo, non la fonte di verità (quella è riconciliazioneEntries).
    for (const t of touched) {
        await logLeadEvent({
            leadId: t.leadId,
            eventType: 'RECONCILED',
            userId: admin.id,
            companyId: COMPANY_ID,
            metadata: { monthKey, family: t.family, runId },
        });
    }

    revalidatePath('/riconciliazione');
    return { success: true, runId, applied: touched.length };
}
