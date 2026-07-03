'use server';

import { db } from "@/db";
import { leads, users, callLogs, leadEvents } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { currentTenant, assertSalesArea } from "@/lib/tenancy";

function isPresenziato(outcome: string | null) {
    // Definizione canonica (Sprint 1.5): whitelist 'Chiuso' / 'Non chiuso'.
    return outcome === 'Chiuso' || outcome === 'Non chiuso';
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

    const [bot] = await db.select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(users.isBot, true)))
        .limit(1);
    if (!bot) return null;

    const [pushRows, reassignRows, botCallRows] = await Promise.all([
        db.select({ leadId: leadEvents.leadId, first: sql<string>`min(${leadEvents.timestamp})` })
            .from(leadEvents)
            .where(and(
                eq(leadEvents.companyId, ctx.companyId),
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
                eq(leadEvents.companyId, ctx.companyId),
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
                eq(callLogs.companyId, ctx.companyId),
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
    let ridatiMaiRisposto = 0, ridatiChatInterrotta = 0;
    for (const r of reassignRows) {
        if (!r.leadId || !cohort.has(r.leadId)) continue;
        reassignFirst.set(r.leadId, new Date(r.first).getTime());
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

    // Ridati poi fissati da un GDO umano: call log APPUNTAMENTO di un altro
    // utente successivo alla riassegnazione (il fissaggio pre-bot non conta).
    let fissatiRidatiGdo = 0;
    const ridatiIds = [...reassignFirst.keys()];
    if (ridatiIds.length > 0) {
        const humanFixRows = await db.select({
            leadId: callLogs.leadId,
            userId: callLogs.userId,
            at: callLogs.createdAt,
        }).from(callLogs).where(and(
            eq(callLogs.companyId, ctx.companyId),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            inArray(callLogs.leadId, ridatiIds),
        ));
        const fixedAfterReassign = new Set<string>();
        for (const r of humanFixRows) {
            if (!r.leadId || r.userId === bot.id) continue;
            const reassignedAt = reassignFirst.get(r.leadId);
            if (reassignedAt !== undefined && r.at && r.at.getTime() >= reassignedAt) {
                fixedAfterReassign.add(r.leadId);
            }
        }
        fissatiRidatiGdo = fixedAfterReassign.size;
    }

    // Esiti a valle dei fissati del bot: conferme, presenze e chiusure.
    let confermati = 0, presenziati = 0, chiusi = 0;
    if (fissatiSet.size > 0) {
        const fissatiLeads = await db.select({
            confirmationsOutcome: leads.confirmationsOutcome,
            salespersonOutcome: leads.salespersonOutcome,
        }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            inArray(leads.id, [...fissatiSet]),
        ));
        for (const l of fissatiLeads) {
            if (l.confirmationsOutcome === 'confermato') confermati++;
            if (isPresenziato(l.salespersonOutcome)) presenziati++;
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

    return {
        botName: bot.displayName || 'Fissatore',
        days: safeDays,
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
    };
}
