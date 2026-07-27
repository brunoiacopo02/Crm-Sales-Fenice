'use server';

import { db } from "@/db";
import { leads, users, callLogs, leadEvents } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { currentTenant, assertSalesArea } from "@/lib/tenancy";
import { toRomeDateStr } from "@/lib/dateUtils";

/** Una riga per giorno di presa in carico: mostra come si smaltisce la coorte.
 *  Serve a leggere "in lavorazione" — che è un residuo, non un conteggio. */
export interface BotDailyCohortRow {
    day: string;           // YYYY-MM-DD (Europe/Rome)
    ricevuti: number;
    ridati: number;
    fissati: number;
    scartati: number;
    inLavorazione: number;
}

export interface BotFissatoreStats {
    botName: string;
    days: number;
    from: string; // ISO
    to: string;   // ISO
    // Flusso
    ricevuti: number;         // lead entrati in carico al bot nel periodo
    ridati: number;           // restituiti ai GDO umani (mai risposto / chat interrotta)
    ridatiMaiRisposto: number;
    ridatiChatInterrotta: number;
    tenuti: number;           // ricevuti - ridati
    fissati: number;          // fissati dal bot (call log APPUNTAMENTO del bot)
    fissatiTenuti: number;    // fissati su lead mai ridati
    scartati: number;         // scartati dal bot (obiezione ferrea) senza fissaggio né ridato
    inLavorazione: number;    // ricevuti - (fissati ∪ ridati ∪ scartati)
    // Riassegnati
    fissatiRidatiGdo: number; // ridati poi fissati da un GDO umano dopo la riassegnazione
    fissatiRidatiMaiRisposto: number;    // split dei ripresi: motivo mai_risposto
    fissatiRidatiChatInterrotta: number; // split dei ripresi: motivo chat_interrotta
    // Funnel dei ridati (lavorazione GDO post-riassegnazione)
    ridatiLavoratiGdo: number;   // ridati con almeno una chiamata umana dopo la riassegnazione
    ridatiChiamateGdo: number;   // chiamate umane totali spese sui ridati
    ridatiScartatiGdo: number;   // ridati scartati da un GDO umano
    ridatiConfermati: number;    // ridati fissati da GDO poi confermati dalle Conferme
    ridatiPresenziati: number;   // ridati fissati da GDO poi presenziati
    ridatiChiusi: number;        // ridati fissati da GDO poi chiusi dal venditore
    ridatiFatturatoEur: number;  // fatturato generato dai ridati chiusi
    // A valle dei fissati del bot
    confermati: number;
    presenziati: number;
    chiusi: number;
    // Percentuali (stringhe pronte per la UI, '-' se denominatore 0)
    percRidati: string;          // ridati / ricevuti
    percFissRicevuti: string;    // fissati / ricevuti
    percFissTenuti: string;      // fissatiTenuti / tenuti
    percScartati: string;        // scartati / ricevuti
    percRidatiFissati: string;   // fissatiRidatiGdo / ridati
    percConfermati: string;      // confermati / fissati
    percPresenziati: string;     // presenziati / fissati
    percChiusi: string;          // chiusi / fissati
    // Drill-down: la stessa coorte spaccata per giorno di presa in carico
    dailyCohort: BotDailyCohortRow[]; // ordine decrescente per data
}

const pct = (num: number, den: number) => den > 0 ? (num / den * 100).toFixed(1) + '%' : '-';

/**
 * Statistiche complete del Bot Fissatore su finestra mobile (ultimi N giorni).
 *
 * Coorte = lead il cui PRIMO contatto col bot cade nella finestra, dove
 * "contatto" è il primo tra: push riuscito (BOT_PUSHED result=sent),
 * riassegnazione dal bot (REASSIGNED_FROM_BOT), call log del bot. L'unione
 * copre anche backfill di lead vecchi e lead arrivati al bot senza audit di
 * push (esiste in prod). Tutti i numeri sono sottoinsiemi della stessa coorte.
 *
 * I fissati si contano dai call log APPUNTAMENTO del bot (event-based): un
 * fissato resta fissato anche se il lead viene poi scartato/riassegnato —
 * contare lo stato attuale del lead li faceva sparire.
 *
 * Ritorna null se l'azienda corrente non ha un account bot attivo.
 */
export async function getBotFissatoreStats(days: number): Promise<BotFissatoreStats | null> {
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const safeDays = Math.min(Math.max(Math.round(days) || 30, 1), 365);
    const to = new Date();
    const from = new Date(to.getTime() - safeDays * 24 * 60 * 60 * 1000);

    const bot = await findBot(ctx.companyId);
    if (!bot) return null;

    return computeWindowStats(ctx.companyId, bot, from, to, safeDays);
}

/** Mezzanotte Europe/Rome del 2026-07-24: go-live delle modifiche del fornitore bot
 *  (sequenza estesa 12gg, scarto numeri mai consegnati, riaggancio chat interrotte). */
const BOT_CUTOVER = new Date('2026-07-23T22:00:00Z');

export interface BotCutoverComparison {
    cutoverIso: string;
    postDays: number;         // età in giorni della coorte post (per il caveat maturazione)
    pre: BotFissatoreStats;   // coorte: 30 giorni prima del cutover
    post: BotFissatoreStats;  // coorte: dal cutover a ora
}

/**
 * Confronto coorti pre/post modifiche del fornitore (24/07) per il report
 * quindicinale concordato: target ridati ≤50% e fissati ≥8% senza cali.
 * NB: con le sequenze da 12 giorni la coorte post matura in ~14 giorni —
 * i numeri sono indicativi finché postDays < 14 (la UI mostra il caveat).
 */
export async function getBotFissatoreCutoverComparison(): Promise<BotCutoverComparison | null> {
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const bot = await findBot(ctx.companyId);
    if (!bot) return null;

    const now = new Date();
    if (now.getTime() <= BOT_CUTOVER.getTime()) return null;
    const postDays = Math.max(1, Math.ceil((now.getTime() - BOT_CUTOVER.getTime()) / 86400000));
    const preFrom = new Date(BOT_CUTOVER.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [pre, post] = await Promise.all([
        computeWindowStats(ctx.companyId, bot, preFrom, BOT_CUTOVER, 30),
        computeWindowStats(ctx.companyId, bot, BOT_CUTOVER, now, postDays),
    ]);

    return { cutoverIso: BOT_CUTOVER.toISOString(), postDays, pre, post };
}

async function findBot(companyId: string): Promise<{ id: string; displayName: string | null } | null> {
    const [bot] = await db.select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.companyId, companyId), eq(users.isBot, true)))
        .limit(1);
    return bot ?? null;
}

async function computeWindowStats(
    companyId: string,
    bot: { id: string; displayName: string | null },
    from: Date,
    to: Date,
    days: number,
): Promise<BotFissatoreStats> {
    const [pushRows, reassignRows, botCallRows] = await Promise.all([
        db.select({ leadId: leadEvents.leadId, first: sql<string>`min(${leadEvents.timestamp})` })
            .from(leadEvents)
            .where(and(
                eq(leadEvents.companyId, companyId),
                eq(leadEvents.eventType, 'BOT_PUSHED'),
                sql`${leadEvents.metadata}->>'result' = 'sent'`,
            ))
            .groupBy(leadEvents.leadId),
        db.select({
            leadId: leadEvents.leadId,
            first: sql<string>`min(${leadEvents.timestamp})`,
            reason: sql<string | null>`min(${leadEvents.metadata}->>'reason')`,
        })
            .from(leadEvents)
            .where(and(
                eq(leadEvents.companyId, companyId),
                eq(leadEvents.eventType, 'REASSIGNED_FROM_BOT'),
            ))
            .groupBy(leadEvents.leadId),
        db.select({
            leadId: callLogs.leadId,
            first: sql<string>`min(${callLogs.createdAt})`,
            hasAppt: sql<boolean>`bool_or(${callLogs.outcome} = 'APPUNTAMENTO')`,
            hasScarto: sql<boolean>`bool_or(${callLogs.outcome} = 'DA_SCARTARE')`,
        })
            .from(callLogs)
            .where(and(
                eq(callLogs.companyId, companyId),
                eq(callLogs.userId, bot.id),
            ))
            .groupBy(callLogs.leadId),
    ]);

    // Primo contatto col bot per lead (ms epoch), su tutte e tre le sorgenti.
    const firstTouch = new Map<string, number>();
    const touch = (leadId: string | null, ts: string | Date) => {
        if (!leadId) return;
        const ms = new Date(ts).getTime();
        const prev = firstTouch.get(leadId);
        if (prev === undefined || ms < prev) firstTouch.set(leadId, ms);
    };
    pushRows.forEach(r => touch(r.leadId, r.first));
    reassignRows.forEach(r => touch(r.leadId, r.first));
    botCallRows.forEach(r => touch(r.leadId, r.first));

    const fromMs = from.getTime();
    const toMs = to.getTime();
    const cohort = new Set<string>();
    for (const [leadId, ms] of firstTouch) {
        if (ms >= fromMs && ms <= toMs) cohort.add(leadId);
    }

    const reassignFirst = new Map<string, number>();
    const reassignReason = new Map<string, string | null>();
    let ridatiMaiRisposto = 0, ridatiChatInterrotta = 0;
    for (const r of reassignRows) {
        if (!r.leadId || !cohort.has(r.leadId)) continue;
        reassignFirst.set(r.leadId, new Date(r.first).getTime());
        reassignReason.set(r.leadId, r.reason);
        if (r.reason === 'mai_risposto') ridatiMaiRisposto++;
        else if (r.reason === 'chat_interrotta') ridatiChatInterrotta++;
    }

    const fissatiSet = new Set<string>();
    const scartatiSet = new Set<string>();
    for (const r of botCallRows) {
        if (!r.leadId || !cohort.has(r.leadId)) continue;
        if (r.hasAppt) fissatiSet.add(r.leadId);
        // Scartato "puro": obiezione ferrea senza fissaggio né ridato.
        else if (r.hasScarto && !reassignFirst.has(r.leadId)) scartatiSet.add(r.leadId);
    }

    // Funnel dei ridati: tutti i call log umani successivi alla riassegnazione
    // (il fissaggio pre-bot non conta). Da qui: lead lavorati, chiamate spese,
    // fissati (con split per motivo di ritorno), scartati, ed esiti a valle
    // dei fissati (conferme, presenze, chiusure con fatturato).
    let fissatiRidatiGdo = 0;
    let fissatiRidatiMaiRisposto = 0, fissatiRidatiChatInterrotta = 0;
    let ridatiLavoratiGdo = 0, ridatiChiamateGdo = 0, ridatiScartatiGdo = 0;
    let ridatiConfermati = 0, ridatiPresenziati = 0, ridatiChiusi = 0, ridatiFatturatoEur = 0;
    const ridatiIds = [...reassignFirst.keys()];
    if (ridatiIds.length > 0) {
        const humanCallRows = await db.select({
            leadId: callLogs.leadId,
            userId: callLogs.userId,
            outcome: callLogs.outcome,
            at: callLogs.createdAt,
        }).from(callLogs).where(and(
            eq(callLogs.companyId, companyId),
            inArray(callLogs.leadId, ridatiIds),
        ));
        const workedLeads = new Set<string>();
        const fixedAfterReassign = new Set<string>();
        const discardedByGdo = new Set<string>();
        for (const r of humanCallRows) {
            if (!r.leadId || r.userId === bot.id) continue;
            const reassignedAt = reassignFirst.get(r.leadId);
            if (reassignedAt === undefined || !r.at || r.at.getTime() < reassignedAt) continue;
            workedLeads.add(r.leadId);
            ridatiChiamateGdo++;
            if (r.outcome === 'APPUNTAMENTO') fixedAfterReassign.add(r.leadId);
            else if (r.outcome === 'DA_SCARTARE') discardedByGdo.add(r.leadId);
        }
        ridatiLavoratiGdo = workedLeads.size;
        ridatiScartatiGdo = discardedByGdo.size;
        fissatiRidatiGdo = fixedAfterReassign.size;
        for (const id of fixedAfterReassign) {
            const reason = reassignReason.get(id);
            if (reason === 'mai_risposto') fissatiRidatiMaiRisposto++;
            else if (reason === 'chat_interrotta') fissatiRidatiChatInterrotta++;
        }

        if (fixedAfterReassign.size > 0) {
            const ridatiFissatiLeads = await db.select({
                confirmationsOutcome: leads.confirmationsOutcome,
                salespersonOutcome: leads.salespersonOutcome,
                presentedAt: leads.presentedAt,
                closeAmountEur: leads.closeAmountEur,
            }).from(leads).where(and(
                eq(leads.companyId, companyId),
                inArray(leads.id, [...fixedAfterReassign]),
            ));
            for (const l of ridatiFissatiLeads) {
                if (l.confirmationsOutcome === 'confermato') ridatiConfermati++;
                if (l.presentedAt !== null) ridatiPresenziati++;
                if (l.salespersonOutcome?.toLowerCase() === 'chiuso') {
                    ridatiChiusi++;
                    ridatiFatturatoEur += l.closeAmountEur ?? 0;
                }
            }
        }
    }

    // Esiti a valle dei fissati del bot: conferme, presenze e chiusure.
    let confermati = 0, presenziati = 0, chiusi = 0;
    if (fissatiSet.size > 0) {
        const fissatiLeads = await db.select({
            confirmationsOutcome: leads.confirmationsOutcome,
            salespersonOutcome: leads.salespersonOutcome,
            presentedAt: leads.presentedAt,
        }).from(leads).where(and(
            eq(leads.companyId, companyId),
            inArray(leads.id, [...fissatiSet]),
        ));
        for (const l of fissatiLeads) {
            if (l.confirmationsOutcome === 'confermato') confermati++;
            // Latch presentedAt (PO 2026-07-17): la presenza non sparisce con esiti successivi.
            if (l.presentedAt !== null) presenziati++;
            if (l.salespersonOutcome?.toLowerCase() === 'chiuso') chiusi++;
        }
    }

    const ricevuti = cohort.size;
    const ridati = reassignFirst.size;
    const tenuti = ricevuti - ridati;
    const fissati = fissatiSet.size;
    const scartati = scartatiSet.size;
    const fissatiTenuti = [...fissatiSet].filter(id => !reassignFirst.has(id)).length;
    // Union esplicita: un lead può essere sia fissato che ridato (visto in prod).
    const lavorati = new Set<string>([...fissatiSet, ...reassignFirst.keys(), ...scartatiSet]).size;

    // Spaccatura per giorno di presa in carico. Stessi criteri degli aggregati,
    // così le colonne sommano esattamente alle card del flusso: un lead conta in
    // "in lavorazione" solo se non è né fissato, né ridato, né scartato.
    const dailyMap = new Map<string, BotDailyCohortRow>();
    for (const leadId of cohort) {
        const day = toRomeDateStr(new Date(firstTouch.get(leadId)!));
        let row = dailyMap.get(day);
        if (!row) {
            row = { day, ricevuti: 0, ridati: 0, fissati: 0, scartati: 0, inLavorazione: 0 };
            dailyMap.set(day, row);
        }
        row.ricevuti++;
        const isFissato = fissatiSet.has(leadId);
        const isRidato = reassignFirst.has(leadId);
        const isScartato = scartatiSet.has(leadId);
        if (isRidato) row.ridati++;
        if (isFissato) row.fissati++;
        if (isScartato) row.scartati++;
        if (!isFissato && !isRidato && !isScartato) row.inLavorazione++;
    }
    const dailyCohort = [...dailyMap.values()].sort((a, b) => b.day.localeCompare(a.day));

    return {
        botName: bot.displayName || 'Fissatore',
        days,
        from: from.toISOString(),
        to: to.toISOString(),
        ricevuti,
        ridati,
        ridatiMaiRisposto,
        ridatiChatInterrotta,
        tenuti,
        fissati,
        fissatiTenuti,
        scartati,
        inLavorazione: ricevuti - lavorati,
        fissatiRidatiGdo,
        fissatiRidatiMaiRisposto,
        fissatiRidatiChatInterrotta,
        ridatiLavoratiGdo,
        ridatiChiamateGdo,
        ridatiScartatiGdo,
        ridatiConfermati,
        ridatiPresenziati,
        ridatiChiusi,
        ridatiFatturatoEur,
        confermati,
        presenziati,
        chiusi,
        percRidati: pct(ridati, ricevuti),
        percFissRicevuti: pct(fissati, ricevuti),
        percFissTenuti: pct(fissatiTenuti, tenuti),
        percScartati: pct(scartati, ricevuti),
        percRidatiFissati: pct(fissatiRidatiGdo, ridati),
        percConfermati: pct(confermati, fissati),
        percPresenziati: pct(presenziati, fissati),
        percChiusi: pct(chiusi, fissati),
        dailyCohort,
    };
}
