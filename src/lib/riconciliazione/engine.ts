/**
 * Il motore della riconciliazione: lettura, confronto e scrittura.
 *
 * Sta FUORI da `riconciliazioneActions.ts` di proposito. In un file marcato
 * `'use server'` ogni export diventa un endpoint raggiungibile dal browser:
 * esportare di lì il corpo non autenticato del confronto o dell'applicazione
 * significherebbe pubblicare la lettura del foglio e la scrittura del fatturato
 * a chiunque. Qui i controlli non ci sono per scelta — li fa il chiamante, e
 * l'unico chiamante dal browser è l'action, che parte dal gate admin.
 */
import crypto from 'node:crypto';
import { and, eq, gte, lt, inArray, desc, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { leads, salesAttempts, riconciliazioneRuns, riconciliazioneEntries, users } from '@/db/schema';
import { normalizePhoneStrict } from '@/lib/phoneNormalize';
import { monthBoundsRome } from '@/lib/dateUtils';
import { fetchDatabaseClientiRows } from '@/lib/riconciliazione/sheetsClient';
import { parseSheetRows, SheetUnavailableError, type SheetContract } from '@/lib/riconciliazione/sheetRows';
import { parseCsv } from '@/lib/riconciliazione/csv';
import { reconcile, type CrmClosure, type DiffEntry } from '@/lib/riconciliazione/match';
import type { ConfrontoResult, ApplyResult, AnnullaRunResult, RiconciliazioneRunSummary } from '@/lib/riconciliazione/types';
import { resolveAttemptWrite } from '@/lib/venditorePerformance/guard';
import { logLeadEvent } from '@/lib/eventLogger';
import { enqueueMarketingWebhook } from '@/lib/marketing-webhooks/enqueue';

export const COMPANY_ID = 'fenice'; // il foglio non contiene Serenamente

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
        confirmationsOutcome: leads.confirmationsOutcome,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
        createdAt: leads.createdAt,
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
    const attemptCounts = new Map<string, number>();
    for (const a of attempts) {
        if (a.outcome !== 'Chiuso') continue;
        attemptTotals.set(a.leadId, (attemptTotals.get(a.leadId) ?? 0) + (a.amountEur ?? 0));
        attemptCounts.set(a.leadId, (attemptCounts.get(a.leadId) ?? 0) + 1);
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
        attemptsCount: attemptCounts.get(r.id) ?? 0,
        status: r.status,
        confirmationsOutcome: r.confirmationsOutcome,
        appointmentDate: r.appointmentDate,
        presentedAt: r.presentedAt,
        createdAt: r.createdAt,
        isRejected: r.status === 'REJECTED',
        salespersonAssigned: r.salespersonAssigned,
    }));
}

/**
 * I lead che ESISTONO nel CRM ma non hanno un esito venditore nel mese: scartati
 * dai GDO, o in appuntamento e mai esitati. `loadCrmClosures` non può vederli
 * (filtra su `salespersonOutcomeAt`, che loro non hanno), quindi senza questa
 * seconda lettura ogni loro contratto risultava orfano e l'applicazione avrebbe
 * creato un doppione del lead già a sistema — 26 contratti per 54.498 EUR fra
 * aprile e maggio, misurati durante il collaudo del 31/08.
 *
 * Si cercano solo i contatti che il foglio nomina davvero: la ricerca è mirata
 * (indice su phone/email), non una scansione della tabella.
 */
async function loadCrmCandidates(sheet: SheetContract[], escludiLeadIds: Set<string>): Promise<CrmClosure[]> {
    const phones = [...new Set(sheet.map(s => s.phone).filter((p): p is string => !!p))];
    const emails = [...new Set(sheet.map(s => s.email).filter((e): e is string => !!e))];
    if (phones.length === 0 && emails.length === 0) return [];

    // Il CRM conserva i numeri in più forme (con e senza prefisso): il foglio è
    // normalizzato a E.164, la colonna no. Si cercano entrambe le scritture.
    const phoneVariants = [...new Set(phones.flatMap(p => [p, p.replace(/^\+39/, '')]))];

    const rows = await db.select({
        id: leads.id, phone: leads.phone, email: leads.email, name: leads.name,
        funnel: leads.funnel, outcome: leads.salespersonOutcome, outcomeAt: leads.salespersonOutcomeAt,
        amountEur: leads.closeAmountEur, status: leads.status,
        confirmationsOutcome: leads.confirmationsOutcome, appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt, createdAt: leads.createdAt,
        salespersonAssigned: leads.salespersonAssigned,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, COMPANY_ID),
            isNull(leads.salespersonOutcome),
            or(
                phoneVariants.length ? inArray(leads.phone, phoneVariants) : sql`false`,
                emails.length ? inArray(leads.email, emails) : sql`false`,
            ),
        ));

    return rows
        .filter(r => !escludiLeadIds.has(r.id))
        .map(r => ({
            leadId: r.id,
            phone: normalizePhoneStrict(r.phone),
            email: (r.email ?? '').trim().toLowerCase() || null,
            fullName: r.name ?? '',
            funnel: r.funnel,
            outcome: r.outcome,
            outcomeAt: r.outcomeAt,
            amountEur: r.amountEur,
            attemptsAmountEur: 0,
            attemptsCount: 0,
            status: r.status,
            confirmationsOutcome: r.confirmationsOutcome,
            appointmentDate: r.appointmentDate,
            presentedAt: r.presentedAt,
            createdAt: r.createdAt,
            isRejected: r.status === 'REJECTED',
            salespersonAssigned: r.salespersonAssigned,
        }));
}



// Corpo condiviso dai due ingressi (foglio live e CSV caricato a mano): la
// SOLA differenza fra i due percorsi è come si ottengono le `values` grezze
// (string[][]). Da qui in poi — parseSheetRows, il calcolo dei totali, il
// reconcile — è lo STESSO codice per entrambi, per costruzione: se questa
// funzione dovesse mai biforcarsi per sorgente, le regole di business
// (status escluso, somma contratti spezzati, lettura importi/date) potrebbero
// divergere fra sheet e CSV, che è esattamente ciò che il design vuole evitare.

export async function confrontaMeseConValues(monthKey: string, getValues: () => Promise<string[][]>): Promise<ConfrontoResult> {
    try {
        const values = await getValues();
        const sheet = parseSheetRows(values, monthKey);
        const crm = await loadCrmClosures(monthKey);
        const candidates = await loadCrmCandidates(sheet, new Set(crm.map(c => c.leadId)));
        const entries = reconcile(sheet, crm, candidates);
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

// Snapshot completo (non solo i campi toccati) di una riga salesAttempts: a
// differenza di leads, qui prima/dopo devono bastare al Task 7 per ricreare o
// cancellare l'intera riga, non solo per rimettere a posto un valore.
type AttemptSnapshot = {
    id: string;
    outcome: string;
    outcomeAt: Date | null;
    closeAmountEur: number | null;
    closeProduct: string | null;
    attemptNumber: number;
};

// Risolve il codice venditore del foglio ("Sales 00X") a un users.id reale.
// Verificato in sola lettura su prod il 2026-08-29: gli account VENDITORE di
// fenice hanno name IDENTICO al codice ("Sales 001".."Sales 010", 6 account,
// stessa cardinalità di TUTOR_TO_SALES) — leads.salespersonAssigned mostra gli
// stessi valori, altri path (getSalespersonName) sono legacy o su altre tabelle.
// Se non risolve NÉ dal foglio NÉ dal lead esistente, abortiamo: attribuire il
// fatturato a chi ha cliccato il bottone (l'admin) sarebbe peggio che rifiutare
// la scrittura.
function resolveSalesUserId(
    salesCode: string | null,
    salesCodeToUserId: Map<string, string>,
    fallbackUserId: string | null,
): string {
    const fromSheet = salesCode ? salesCodeToUserId.get(salesCode) : undefined;
    if (fromSheet) return fromSheet;
    if (fallbackUserId) return fallbackUserId;
    throw new Error(
        `Codice venditore "${salesCode ?? '(nessuno)'}" non corrisponde a nessun account VENDITORE (users.name) e il lead non ha già un salespersonUserId. Correggi l'account o la mappatura prima di riprovare.`,
    );
}



/**
 * Avvisa il CRM marketing delle chiusure che questa riconciliazione ha creato o
 * tolto.
 *
 * Serve perché `deal.closed_won`/`closed_lost` nascono da `saveVenditoreOutcome`,
 * e la riconciliazione scrive fatturato senza passare di lì: il 31/08 quattro
 * vendite applicate dallo script e una applicata dalla pagina non sono mai
 * arrivate al marketing, e nessuno se ne sarebbe accorto senza guardare a mano.
 * Il resync (`scripts/resyncMarketingClosures.ts`) resta la rete di sicurezza,
 * non può essere il meccanismo.
 *
 * L'evento si sceglie dallo stato del lead DOPO la scrittura, così la stessa
 * funzione serve sia l'applicazione sia l'annullamento (che riporta indietro lo
 * stato e deve rimandarlo: un undo silenzioso lascerebbe al marketing una
 * vendita che non esiste più — peggio del buco di partenza).
 *
 * La famiglia `importo` è ESCLUSA di proposito: lì la vendita al marketing c'è
 * già e cambia solo la cifra. Finché non è chiarito se il loro receiver fa
 * upsert per lead o accoda, un secondo `closed_won` sommerebbe invece di
 * correggere — decisione del 26/08, quegli importi si sistemano a mano.
 */
async function notificaMarketing(touched: Array<{ leadId: string; family: string }>, adminUserId: string) {
    for (const t of touched) {
        if (t.family === 'importo') continue;
        try {
            const [l] = await db.select({ outcome: leads.salespersonOutcome })
                .from(leads)
                .where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, t.leadId)));
            if (!l?.outcome) continue; // nessun esito da comunicare
            await enqueueMarketingWebhook({
                eventType: l.outcome === 'Chiuso' ? 'deal.closed_won' : 'deal.closed_lost',
                leadId: t.leadId,
                actorUserId: adminUserId,
            });
        } catch (e) {
            // Come per logLeadEvent: la run è già committata, un problema qui non
            // deve far sembrare fallita una scrittura andata a buon fine.
            console.error('[riconciliazione] enqueueMarketingWebhook fallito per', t.leadId, e);
        }
    }
}

export async function applicaCorrezioniCome(adminUserId: string, monthKey: string, keys: string[], csv?: string): Promise<ApplyResult> {
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return { success: false, error: 'Mese non valido.' };

    // Il client manda SOLO le chiavi (più il testo del CSV quando la sorgente è
    // quella: mai le entry già calcolate) — le differenze si ricalcolano SEMPRE
    // qui. Fidarsi delle entry mandate dal browser significherebbe accettare
    // importi, famiglie o lead id scelti da chi apre i devtools — su un'azione
    // che scrive fatturato non è negoziabile, e vale ugualmente per il percorso
    // CSV: il server ri-analizza il testo con lo stesso parseSheetRows, non fa
    // rieseguire al client il match e poi si fida del risultato.
    const source: 'sheet' | 'csv' = csv !== undefined ? 'csv' : 'sheet';
    // Si passa dal corpo interno, non dalle due action pubbliche: quelle
    // rifarebbero il gate di autenticazione, che qui è già stato fatto dal
    // chiamante (ed è assente quando la chiamata non nasce da una richiesta).
    const fresh = source === 'csv'
        ? await confrontaMeseConValues(monthKey, async () => parseCsv(csv!))
        : await confrontaMeseConValues(monthKey, fetchDatabaseClientiRows);
    if (!fresh.success) return { success: false, error: fresh.error };

    const wanted = new Set(keys);
    // appliable === false viene ignorata anche se la chiave arriva spuntata:
    // il client non è la fonte di verità sui permessi di applicazione.
    const todo = fresh.entries.filter(e => wanted.has(e.key) && e.appliable);
    if (todo.length === 0) return { success: false, error: 'Nessuna correzione applicabile fra quelle selezionate.' };

    // Mappa codice foglio → users.id, risolta UNA volta per l'intero batch
    // (non per riga) interrogando solo i codici che compaiono davvero nella
    // selezione corrente.
    const distinctCodes = Array.from(new Set(
        todo.map(e => e.sheet?.salesCode).filter((c): c is string => !!c),
    ));
    const salesCodeToUserId = new Map<string, string>();
    if (distinctCodes.length > 0) {
        const matches = await db.select({ id: users.id, name: users.name })
            .from(users)
            .where(and(eq(users.companyId, COMPANY_ID), inArray(users.name, distinctCodes)));
        for (const m of matches) {
            if (m.name) salesCodeToUserId.set(m.name, m.id);
        }
    }

    const runId = crypto.randomUUID();
    const touched: Array<{ leadId: string; family: string }> = [];

    try {
        await db.transaction(async (tx) => {
            await tx.insert(riconciliazioneRuns).values({
                id: runId,
                companyId: COMPANY_ID,
                monthKey,
                source,
                appliedBy: adminUserId,
                entryCount: todo.length,
            });

            for (const e of todo) {
                if (e.family === 'lead-assente') {
                    const sheet = e.sheet!;
                    const phone = requirePhoneForLeadAssente(sheet);
                    // Nessun lead preesistente da cui ereditare un venditore: deve
                    // risolvere dal codice del foglio, altrimenti abort (vedi
                    // resolveSalesUserId).
                    const salesUserId = resolveSalesUserId(sheet.salesCode, salesCodeToUserId, null);

                    const leadId = crypto.randomUUID();
                    const leadAfter = {
                        name: sheet.fullName,
                        phone,
                        email: sheet.email,
                        funnel: 'FUORI FUNNEL',
                        salespersonOutcome: 'Chiuso',
                        salespersonOutcomeAt: sheet.signedAt,
                        closeAmountEur: sheet.amountEur,
                        salespersonAssigned: sheet.salesCode,
                    };

                    // Ruling D: anche questa famiglia deve passare da
                    // resolveAttemptWrite e produrre una riga salesAttempts reale.
                    // Senza, il lead risulta Chiuso su `leads` ma con
                    // attemptsAmountEur=0 su salesAttempts: al giro successivo di
                    // confrontaMese ri-matcha per telefono e finisce bloccato per
                    // sempre come "leads e salesAttempts non concordano"
                    // (match.ts:62-63) — un blocco permanente autoinflitto.
                    const attemptWrite = resolveAttemptWrite({
                        attempts: [],
                        outcome: 'Chiuso',
                        cycleStartAt: null,
                        leadHasOutcome: false,
                        occasion: 'current',
                    });
                    const attemptId = crypto.randomUUID();
                    const attemptAfter: AttemptSnapshot = {
                        id: attemptId,
                        outcome: 'Chiuso',
                        outcomeAt: sheet.signedAt,
                        closeAmountEur: sheet.amountEur,
                        closeProduct: null,
                        attemptNumber: attemptWrite.mode === 'insert' ? attemptWrite.attemptNumber : 0,
                    };

                    // La riga di storico precede le scritture reali: prima/dopo
                    // coprono ENTRAMBE le tabelle toccate (Ruling A), altrimenti
                    // il Task 7 non saprebbe quale riga salesAttempts cancellare.
                    await tx.insert(riconciliazioneEntries).values({
                        id: crypto.randomUUID(),
                        runId,
                        leadId,
                        family: e.family,
                        createdLead: true,
                        before: { lead: {}, attempt: null },
                        after: { lead: leadAfter, attempt: attemptAfter },
                    });

                    await tx.insert(leads).values({
                        id: leadId,
                        companyId: COMPANY_ID,
                        name: leadAfter.name,
                        phone: leadAfter.phone,
                        email: leadAfter.email,
                        // Origine dedicata: il contratto entra nel fatturato totale ma
                        // resta distinguibile nelle statistiche per funnel. `status`
                        // resta al suo default ('NEW'): non va indovinato.
                        funnel: leadAfter.funnel,
                        salespersonOutcome: leadAfter.salespersonOutcome,
                        salespersonOutcomeAt: leadAfter.salespersonOutcomeAt,
                        closeAmountEur: leadAfter.closeAmountEur,
                        salespersonAssigned: leadAfter.salespersonAssigned,
                        // Nessun presentedAt, nessun appointmentDate, nessuna presenza:
                        // questo contratto non è passato dal funnel GDO/Conferme e non
                        // deve gonfiare i tassi di nessuno dei due team.
                    });
                    await tx.insert(salesAttempts).values({
                        id: attemptId,
                        leadId,
                        companyId: COMPANY_ID,
                        salesUserId,
                        attemptNumber: attemptAfter.attemptNumber,
                        outcome: attemptAfter.outcome,
                        outcomeAt: attemptAfter.outcomeAt!,
                        closeAmountEur: attemptAfter.closeAmountEur,
                    });

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

                const leadBefore: Record<string, unknown> = {};
                const leadAfter: Record<string, unknown> = {};
                for (const key of Object.keys(leadSet)) {
                    if (key === 'version') continue;
                    leadBefore[key] = (currentLead as Record<string, unknown>)[key];
                    leadAfter[key] = leadSet[key];
                }

                // La storia passa SEMPRE da resolveAttemptWrite: è l'unica cosa che
                // impedisce a una correzione di duplicare il tentativo e contare due
                // volte il fatturato (il bug chiuso dalla guardia dopo l'incidente di
                // luglio: ogni ri-registrazione inseriva un nuovo salesAttempts).
                const attempts = await tx.select({
                    id: salesAttempts.id,
                    outcome: salesAttempts.outcome,
                    outcomeAt: salesAttempts.outcomeAt,
                    attemptNumber: salesAttempts.attemptNumber,
                    closeAmountEur: salesAttempts.closeAmountEur,
                    closeProduct: salesAttempts.closeProduct,
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

                // Ruling A: prima/dopo dell'attempt sono uno SNAPSHOT COMPLETO
                // della riga (non solo i campi toccati) — al Task 7 serve poter
                // ricreare o cancellare l'intera riga, non solo un valore.
                let attemptBefore: AttemptSnapshot | null = null;
                let attemptAfter: AttemptSnapshot | null;
                let attemptDbSet: Record<string, unknown> = {};
                let attemptInsertValues: { id: string; salesUserId: string; attemptNumber: number; outcome: string; outcomeAt: Date; closeAmountEur: number | null } | null = null;

                if (write.mode === 'update') {
                    const found = attempts.find(a => a.id === write.id)!;
                    attemptBefore = {
                        id: found.id,
                        outcome: found.outcome,
                        outcomeAt: found.outcomeAt,
                        closeAmountEur: found.closeAmountEur,
                        closeProduct: found.closeProduct,
                        attemptNumber: found.attemptNumber,
                    };
                    if (e.family === 'importo') {
                        attemptDbSet = { closeAmountEur: e.sheet!.amountEur };
                        attemptAfter = { ...attemptBefore, closeAmountEur: e.sheet!.amountEur };
                    } else if (e.family === 'solo-crm') {
                        attemptDbSet = { outcome: 'Non chiuso', closeAmountEur: null, closeProduct: null };
                        attemptAfter = { ...attemptBefore, outcome: 'Non chiuso', closeAmountEur: null, closeProduct: null };
                    } else {
                        attemptDbSet = { outcome: 'Chiuso', outcomeAt: e.sheet!.signedAt, closeAmountEur: e.sheet!.amountEur };
                        attemptAfter = { ...attemptBefore, outcome: 'Chiuso', outcomeAt: e.sheet!.signedAt, closeAmountEur: e.sheet!.amountEur };
                    }
                } else if (e.family === 'solo-crm' && !currentLead.salespersonUserId) {
                    // Toglie fatturato a una chiusura che non ha né un tentativo
                    // registrato né un venditore: tipico delle chiusure vecchie,
                    // scritte prima che `salesAttempts` esistesse o da una
                    // bonifica SQL. Qui NON si inventa un tentativo: non c'è
                    // nessuno a cui attribuirlo con verità, e il compito della
                    // famiglia è togliere una riga di fatturato, non aggiungere
                    // una trattativa mai avvenuta. Nessun rischio di blocco
                    // permanente: la guardia leads-vs-salesAttempts scatta solo
                    // sulle chiusure, e questo lead smette di esserlo.
                    attemptAfter = null as unknown as AttemptSnapshot;
                    attemptInsertValues = null;
                } else {
                    // Ramo raro: nessun attempt esisteva ancora per questo lead
                    // (tipico di esito-mancante/lead-scartato, mai chiusi prima).
                    // Ruling B: l'attribuzione segue il venditore del FOGLIO
                    // (risolto sopra), poi quello già assegnato sul lead; MAI
                    // l'admin che applica la riconciliazione. Su `solo-crm` il
                    // foglio non ha una riga da cui leggere il codice, quindi
                    // l'unica fonte lecita è il venditore già sul lead.
                    const salesUserId = e.family === 'solo-crm'
                        ? currentLead.salespersonUserId!
                        : resolveSalesUserId(
                            e.sheet?.salesCode ?? null,
                            salesCodeToUserId,
                            currentLead.salespersonUserId ?? null,
                        );
                    const outcomeAt = e.family === 'solo-crm' ? (currentLead.salespersonOutcomeAt ?? new Date()) : e.sheet!.signedAt;
                    const closeAmountEur = e.family === 'solo-crm' ? null : e.sheet!.amountEur;
                    attemptInsertValues = {
                        id: crypto.randomUUID(),
                        salesUserId,
                        attemptNumber: write.attemptNumber,
                        outcome: attemptOutcome,
                        outcomeAt,
                        closeAmountEur,
                    };
                    attemptAfter = {
                        id: attemptInsertValues.id,
                        outcome: attemptInsertValues.outcome,
                        outcomeAt: attemptInsertValues.outcomeAt,
                        closeAmountEur: attemptInsertValues.closeAmountEur,
                        closeProduct: null,
                        attemptNumber: attemptInsertValues.attemptNumber,
                    };
                }

                // La riga di storico va scritta PRIMA delle modifiche reali: senza
                // questa riga, nella stessa transazione della scrittura, la run non
                // sarebbe annullabile (compito del Task 7) — e ora copre ANCHE
                // salesAttempts (Ruling A), non solo leads.
                await tx.insert(riconciliazioneEntries).values({
                    id: crypto.randomUUID(),
                    runId,
                    leadId,
                    family: e.family,
                    createdLead: false,
                    before: { lead: leadBefore, attempt: attemptBefore },
                    after: { lead: leadAfter, attempt: attemptAfter },
                });

                await tx.update(leads).set(leadSet)
                    .where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, leadId)));

                if (write.mode === 'update') {
                    await tx.update(salesAttempts).set(attemptDbSet)
                        .where(and(eq(salesAttempts.companyId, COMPANY_ID), eq(salesAttempts.id, write.id)));
                } else if (attemptInsertValues) {
                    await tx.insert(salesAttempts).values({
                        id: attemptInsertValues!.id,
                        leadId,
                        companyId: COMPANY_ID,
                        salesUserId: attemptInsertValues!.salesUserId,
                        attemptNumber: attemptInsertValues!.attemptNumber,
                        outcome: attemptInsertValues!.outcome,
                        outcomeAt: attemptInsertValues!.outcomeAt,
                        closeAmountEur: attemptInsertValues!.closeAmountEur,
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
    // aggiuntivo, non la fonte di verità (quella è riconciliazioneEntries) — un
    // suo fallimento non deve MAI far sembrare fallita una run già committata:
    // per questo ogni chiamata è isolata nel proprio try/catch.
    for (const t of touched) {
        try {
            await logLeadEvent({
                leadId: t.leadId,
                eventType: 'RECONCILED',
                userId: adminUserId,
                companyId: COMPANY_ID,
                metadata: { monthKey, family: t.family, runId },
            });
        } catch (logErr) {
            console.error('[applicaCorrezioni] logLeadEvent fallito (run già committata, non blocca la risposta):', logErr);
        }
    }

    await notificaMarketing(touched, adminUserId);

    return { success: true, runId, applied: touched.length };
}

// Forma condivisa con `applicaCorrezioni`: ogni riga di riconciliazioneEntries
// porta lo stato (dei soli campi toccati) prima e dopo la scrittura. `lead` è
// tipizzato largo perché arriva da una colonna jsonb senza `$type<>` — le
// chiavi presenti sono decise a monte da `applicaCorrezioni`, qui vanno solo
// riapplicate così come sono.

type ReconciliationSnapshot = { lead: Record<string, unknown>; attempt: AttemptSnapshot | null };

// Un valore Date scritto in una colonna jsonb (before/after) esce dal DB come
// stringa ISO, non come Date: JSON non ha un tipo Date e Date.prototype.toJSON
// lo trasforma in stringa alla serializzazione. Le colonne timestamp di Drizzle
// però in scrittura chiamano value.toISOString() (vedi
// node_modules/drizzle-orm/pg-core/columns/timestamp.js:mapToDriverValue) e
// una stringa non ha quel metodo: passarla così com'è farebbe fallire ogni
// UPDATE che tocca un campo data. Vanno "resuscitate" a Date prima di riusarle.
function reviveDateOrNull(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string') return new Date(value);
    throw new Error(`Valore data non valido nello storico riconciliazione: ${JSON.stringify(value)}`);
}

function reviveDate(value: unknown): Date {
    const d = reviveDateOrNull(value);
    if (!d) throw new Error('Valore data mancante nello storico riconciliazione (atteso non-null).');
    return d;
}

// Uniche colonne timestamp di `leads` che le famiglie di riconciliazione
// toccano oggi (vedi applicaCorrezioni: ramo esito-mancante/lead-scartato).
// Se una futura famiglia tocca un altro campo data, va aggiunto qui.
const LEAD_TIMESTAMP_FIELDS = ['salespersonOutcomeAt'] as const;

function reviveLeadSnapshot(lead: Record<string, unknown>): Record<string, unknown> {
    const revived: Record<string, unknown> = { ...lead };
    for (const key of LEAD_TIMESTAMP_FIELDS) {
        if (key in revived) revived[key] = reviveDateOrNull(revived[key]);
    }
    return revived;
}

// Unico campo numerico che le famiglie di riconciliazione toccano su `leads`.
// `closeAmountEur` è una colonna `real` (float32 Postgres): un valore scritto
// e riletto NON torna bit-identico a quello calcolato in JS (float64) — es.
// 1234.56 diventa 1234.56005859375. Senza tolleranza, il controllo "nessuno
// ha toccato il lead" fallirebbe SEMPRE su questo campo anche a zero
// modifiche esterne.
const LEAD_AMOUNT_FIELDS = new Set(['closeAmountEur']);

// Tolleranza per il confronto su `closeAmountEur`. Deve stare in una forbice
// stretta: SOPRA il rumore di arrotondamento float32 misurato in review
// (~1e-4..2e-3 fino a €50.000 di importo), altrimenti il controllo scambia
// per "modificato" un lead che nessuno ha toccato; SOTTO 0,01 (un centesimo),
// altrimenti inghiotte silenziosamente la più piccola correzione reale
// possibile su un importo in euro. 0,01 esatto (round 1) non lasciava
// margine: un'importo arrotondato a 2 decimali e poi ri-arrotondato da
// Postgres può produrre una differenza leggermente SOTTO 0,01 anche per una
// vera modifica di un centesimo. 0,005 sta ~2,5x sopra il rumore peggiore
// osservato e lascia margine pieno sotto un centesimo vero: NON alzarlo "per
// arrotondare a un numero più comodo", romperebbe esattamente la garanzia
// per cui esiste.
const CLOSE_AMOUNT_TOLERANCE_EUR = 0.005;

// Confronta un campo di `leads` così come letto ORA dal DB (`live`) con lo
// stesso campo così come l'ha scritto `applicaCorrezioni` (`snapshot`, uscito
// da una colonna jsonb quindi eventualmente una stringa per le date). Serve a
// Ruling B: se un venditore/admin ha modificato il lead dopo l'applicazione,
// questo confronto deve accorgersene PRIMA che l'undo lo sovrascriva.
function leadFieldMatches(key: string, live: unknown, snapshot: unknown): boolean {
    if ((LEAD_TIMESTAMP_FIELDS as readonly string[]).includes(key)) {
        const liveDate = reviveDateOrNull(live);
        const snapDate = reviveDateOrNull(snapshot);
        if (liveDate === null || snapDate === null) return liveDate === null && snapDate === null;
        return liveDate.getTime() === snapDate.getTime();
    }
    if (LEAD_AMOUNT_FIELDS.has(key)) {
        const liveNum = live === null || live === undefined ? null : Number(live);
        const snapNum = snapshot === null || snapshot === undefined ? null : Number(snapshot);
        if (liveNum === null || snapNum === null) return liveNum === null && snapNum === null;
        return Math.abs(liveNum - snapNum) < CLOSE_AMOUNT_TOLERANCE_EUR;
    }
    // Testo/enum: confronto diretto, null e undefined trattati come equivalenti.
    if (live === null || live === undefined) return snapshot === null || snapshot === undefined;
    return live === snapshot;
}


// Annulla una run già applicata: per ogni entry riporta `leads` (e
// `salesAttempts`) esattamente allo stato salvato in `before`. È il rollback
// che finora veniva scritto a mano in chat (luglio/agosto) — qui deve essere
// un ripristino LETTERALE di uno stato noto, mai una nuova decisione di
// business (per questo non passa da `resolveAttemptWrite`, che serve solo a
// decidere insert-vs-update per esiti nuovi in fase di applicazione).
export async function annullaRunCome(adminUserId: string, runId: string): Promise<AnnullaRunResult> {

    const [run] = await db.select().from(riconciliazioneRuns)
        .where(and(eq(riconciliazioneRuns.id, runId), eq(riconciliazioneRuns.companyId, COMPANY_ID)));
    if (!run) return { success: false, error: 'Riconciliazione non trovata.' };
    if (run.revertedAt) return { success: false, error: 'Questa riconciliazione è già stata annullata.' };

    const entries = await db.select().from(riconciliazioneEntries)
        .where(eq(riconciliazioneEntries.runId, runId));

    const touched: Array<{ leadId: string; family: string }> = [];

    try {
        await db.transaction(async (tx) => {
            // La riga della run stessa è il lock: la marchiamo PER PRIMA con una
            // UPDATE condizionata su revertedAt IS NULL, invece di un SELECT-poi-
            // decidi. Sotto READ COMMITTED (isolamento di default di Postgres,
            // nessun isolationLevel impostato altrove nel progetto) due
            // annullaRun(runId) concorrenti passerebbero entrambi un plain SELECT
            // prima che l'altro faccia commit; una UPDATE con WHERE ... IS NULL
            // no: Postgres serializza le UPDATE concorrenti sulla stessa riga, la
            // seconda vede già revertedAt valorizzato e non affetta nessuna riga.
            // Si procede alle entry SOLO se questa claim ha vinto.
            const claimed = await tx.update(riconciliazioneRuns)
                .set({ revertedAt: new Date(), revertedBy: adminUserId })
                .where(and(eq(riconciliazioneRuns.id, runId), isNull(riconciliazioneRuns.revertedAt)))
                .returning({ id: riconciliazioneRuns.id });
            if (claimed.length === 0) {
                throw new Error('Questa riconciliazione è già stata annullata.');
            }

            for (const entry of entries) {
                const before = entry.before as ReconciliationSnapshot;
                const after = entry.after as ReconciliationSnapshot;

                if (entry.createdLead) {
                    // Famiglia lead-assente: il lead non esisteva prima della
                    // riconciliazione, quindi non c'è "prima" a cui tornare — va
                    // eliminato. salesAttempts.leadId ha onDelete:'cascade' (schema.ts
                    // riga 942, verificato in sola lettura), quindi la riga di
                    // tentativo collegata sparisce da sola senza una DELETE separata.
                    if (entry.leadId) {
                        // Stessa guardia di Ruling B, applicata al ramo che crea il
                        // lead invece di ripristinarlo: `after.lead` è esattamente ciò
                        // che applicaCorrezioni ha scritto alla creazione (name, phone,
                        // email, funnel, salespersonOutcome, salespersonOutcomeAt,
                        // closeAmountEur, salespersonAssigned). Se un admin/venditore ha
                        // corretto uno di questi campi dopo la creazione, cancellare il
                        // lead in silenzio distruggerebbe quel lavoro — stesso danno di
                        // Finding B, sul ramo che il giro precedente non copriva.
                        const [currentCreatedLead] = await tx.select({
                            name: leads.name,
                            phone: leads.phone,
                            email: leads.email,
                            funnel: leads.funnel,
                            salespersonOutcome: leads.salespersonOutcome,
                            salespersonOutcomeAt: leads.salespersonOutcomeAt,
                            closeAmountEur: leads.closeAmountEur,
                            salespersonAssigned: leads.salespersonAssigned,
                        })
                            .from(leads)
                            .where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, entry.leadId)));

                        if (currentCreatedLead) {
                            const currentCreatedLeadRecord = currentCreatedLead as unknown as Record<string, unknown>;
                            for (const [key, snapshotValue] of Object.entries(after.lead)) {
                                const liveValue = currentCreatedLeadRecord[key];
                                if (!leadFieldMatches(key, liveValue, snapshotValue)) {
                                    throw new Error(
                                        `Annullamento bloccato: il lead "${currentCreatedLead.name}" (${entry.leadId}) ha il campo "${key}" cambiato dopo la riconciliazione ` +
                                        `(la riconciliazione l'aveva creato con ${JSON.stringify(snapshotValue)}, ora è ${JSON.stringify(liveValue)}). ` +
                                        `Qualcuno ci ha lavorato sopra nel frattempo: verifica a mano prima di riprovare l'annullamento.`,
                                    );
                                }
                            }
                            await tx.delete(leads)
                                .where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, entry.leadId)));
                            touched.push({ leadId: entry.leadId, family: entry.family });
                        }
                        // currentCreatedLead assente: il lead è già sparito per un'altra
                        // via (stesso caso, poco sotto, delle entry con leadId nullo) —
                        // niente da cancellare, niente evento da loggare.
                    }
                    continue;
                }

                if (!entry.leadId) {
                    // leadId è nullable con onDelete:'set null': il lead è già stato
                    // cancellato per un'altra via nel frattempo. Non c'è più nulla su
                    // cui riscrivere prima/dopo: si salta, non si fa fallire l'intero
                    // annullamento per una riga ormai orfana.
                    continue;
                }

                // Selezioniamo `version` + il superset dei campi che qualche
                // famiglia può aver toccato: serve sia per riscrivere `before.lead`
                // sia per il controllo di Ruling B qui sotto (confrontare lo stato
                // ATTUALE con `after.lead`, cioè con ciò che applicaCorrezioni ha
                // scritto, PRIMA di sovrascriverlo).
                const [currentLead] = await tx.select({
                    version: leads.version,
                    name: leads.name,
                    salespersonOutcome: leads.salespersonOutcome,
                    salespersonOutcomeAt: leads.salespersonOutcomeAt,
                    closeAmountEur: leads.closeAmountEur,
                    closeProduct: leads.closeProduct,
                    salespersonOutcomeNotes: leads.salespersonOutcomeNotes,
                    salespersonAssigned: leads.salespersonAssigned,
                })
                    .from(leads)
                    .where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, entry.leadId)));
                if (!currentLead) {
                    continue; // stesso caso di sopra, lead sparito nel frattempo
                }

                // Ruling B: prima di sovrascrivere, verifichiamo che nessuno abbia
                // toccato il lead dopo l'applicazione. `after.lead` è esattamente
                // ciò che applicaCorrezioni ha scritto: se lo stato attuale combacia
                // campo per campo, nessuno l'ha modificato nel frattempo e possiamo
                // procedere. Se anche un solo campo diverge, un venditore/admin ha
                // legittimamente cambiato quel lead dopo la riconciliazione — l'undo
                // lo cancellerebbe in silenzio, quindi si abortisce TUTTA la
                // transazione (compresa la claim sulla run, che torna non annullata)
                // e si nomina lead e campo perché l'admin decida a mano.
                const currentLeadRecord = currentLead as unknown as Record<string, unknown>;
                for (const [key, snapshotValue] of Object.entries(after.lead)) {
                    const liveValue = currentLeadRecord[key];
                    if (!leadFieldMatches(key, liveValue, snapshotValue)) {
                        throw new Error(
                            `Annullamento bloccato: il lead "${currentLead.name}" (${entry.leadId}) ha il campo "${key}" cambiato dopo la riconciliazione ` +
                            `(la riconciliazione aveva scritto ${JSON.stringify(snapshotValue)}, ora è ${JSON.stringify(liveValue)}). ` +
                            `Qualcuno ci ha lavorato sopra nel frattempo: verifica a mano prima di riprovare l'annullamento.`,
                        );
                    }
                }

                // Riscrive SOLO i campi presenti in `before.lead` (gli stessi toccati
                // da applicaCorrezioni, mai l'intera riga) + bump di version, come da
                // convenzione di ogni write path su `leads`.
                await tx.update(leads)
                    .set({ ...reviveLeadSnapshot(before.lead), version: currentLead.version + 1 })
                    .where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, entry.leadId)));

                // Ripristino letterale di salesAttempts: before.attempt/after.attempt
                // sono uno SNAPSHOT COMPLETO della riga (Ruling A del Task 6), quindi
                // qui basta un UPDATE o una DELETE per id, mai un nuovo insert deciso
                // da resolveAttemptWrite.
                if (after.attempt) {
                    if (before.attempt) {
                        await tx.update(salesAttempts).set({
                            outcome: before.attempt.outcome,
                            // salesAttempts.outcomeAt è NOT NULL: applicaCorrezioni valorizza
                            // sempre una Date reale prima di scriverci uno snapshot. Va
                            // "resuscitata" da stringa ISO (round-trip via jsonb, vedi
                            // reviveDate) prima di riscriverla su una colonna timestamp.
                            outcomeAt: reviveDate(before.attempt.outcomeAt),
                            closeAmountEur: before.attempt.closeAmountEur,
                            closeProduct: before.attempt.closeProduct,
                            attemptNumber: before.attempt.attemptNumber,
                        }).where(and(eq(salesAttempts.companyId, COMPANY_ID), eq(salesAttempts.id, after.attempt.id)));
                    } else {
                        // before.attempt === null → applicaCorrezioni aveva INSERITO
                        // questa riga (nessun tentativo preesistente): annullare vuol
                        // dire cancellarla, non svuotarla.
                        await tx.delete(salesAttempts)
                            .where(and(eq(salesAttempts.companyId, COMPANY_ID), eq(salesAttempts.id, after.attempt.id)));
                    }
                }

                touched.push({ leadId: entry.leadId, family: entry.family });
            }
            // Il timbro revertedAt/revertedBy è già stato scritto come PRIMA
            // istruzione della transazione (la claim più sopra): non va ripetuto
            // qui, altrimenti si perderebbe la garanzia "la entries si processano
            // solo se la claim ha vinto" di Ruling A.
        });
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Annullamento fallito, nessuna modifica salvata.' };
    }

    // Fuori dalla transazione, stesso motivo di applicaCorrezioni: l'annullamento
    // è già al sicuro (committato o del tutto annullato sopra), il log evento è
    // un audit trail aggiuntivo che non deve mai far sembrare fallito un
    // annullamento già scritto — ogni chiamata isolata nel proprio try/catch.
    for (const t of touched) {
        try {
            await logLeadEvent({
                leadId: t.leadId,
                eventType: 'RECONCILED',
                userId: adminUserId,
                companyId: COMPANY_ID,
                metadata: { runId, family: t.family, undo: true },
            });
        } catch (logErr) {
            console.error('[annullaRun] logLeadEvent fallito (annullamento già committato, non blocca la risposta):', logErr);
        }
    }

    await notificaMarketing(touched, adminUserId);

    return { success: true, reverted: touched.length };
}


// Elenca le run del mese, più recenti prima. `appliedBy` è già risolto a un
// nome mostrabile (stessa convenzione displayName||name||id usata in tutto il
// resto del CRM, es. confermeActions.ts:542): la UI non deve mai mostrare un
// users.id crudo.
//
// Ruling C: questa è la schermata da cui un admin TROVA la run da annullare —
// [] deve significare SOLO "mese autorizzato, zero run", mai "non sei admin"
// o "monthKey malformato". Per questo qui si LANCIA un errore vero (la
// firma non ha una variante di errore, ma un throw arriva comunque al server
// component chiamante) invece di appiattire tutto su un array vuoto, che su
// una feature di recupero sarebbe il fallimento peggiore possibile: sembra
// "niente da annullare qui" quando in realtà è un bug o un permesso negato.
export async function elencoRunPerMese(monthKey: string): Promise<RiconciliazioneRunSummary[]> {
    if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error('Mese non valido.');

    const rows = await db.select({
        id: riconciliazioneRuns.id,
        appliedAt: riconciliazioneRuns.appliedAt,
        appliedById: riconciliazioneRuns.appliedBy,
        entryCount: riconciliazioneRuns.entryCount,
        revertedAt: riconciliazioneRuns.revertedAt,
    })
        .from(riconciliazioneRuns)
        .where(and(eq(riconciliazioneRuns.companyId, COMPANY_ID), eq(riconciliazioneRuns.monthKey, monthKey)))
        .orderBy(desc(riconciliazioneRuns.appliedAt));

    if (rows.length === 0) return [];

    const userIds = Array.from(new Set(rows.map(r => r.appliedById)));
    const people = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, userIds));
    const nameOf = new Map(people.map(p => [p.id, p.displayName || p.name || p.id]));

    return rows.map(r => ({
        id: r.id,
        appliedAt: r.appliedAt,
        appliedBy: nameOf.get(r.appliedById) ?? r.appliedById,
        entryCount: r.entryCount,
        revertedAt: r.revertedAt,
    }));
}

