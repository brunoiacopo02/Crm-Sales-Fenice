import { NextResponse } from 'next/server';
import { and, asc, eq, isNull, sql, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db';
import { leads, users, leadEvents } from '@/db/schema';
import {
    leggiConfigRiscaldamento, pianificaRiscaldamento, type LeadCandidato,
} from '@/lib/bot-fissatore/riscaldamento';
import { pushLeadToBot } from '@/lib/bot-fissatore/push';
import { BATCH_ESCLUSI_DAI_KPI } from '@/lib/intakeBatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FENICE = 'fenice';

/**
 * Riscaldamento del numero WhatsApp nuovo: uno scaglione di lead immacolati
 * passa da un GDO al bot, una volta all'ora.
 *
 * Perche' a scaglioni e non tutti insieme: consegnare 142 aperture in un colpo
 * e' un picco indistinguibile da un blast, e su un numero senza storico e' il
 * modo piu' rapido per bruciarlo. Il 15/09 un picco simile e' costato 3,7% di
 * messaggi falliti e la qualita' a LOW.
 *
 * Perche' un cron e non un pulsante: il PO non deve tenere il PC acceso, e uno
 * scaglione ogni ora e' proprio il genere di cosa che a mano non si fa.
 *
 * Interruttore: BOT_WARMUP. **Spento se assente** — questo giro toglie lead a
 * una persona per darli al bot, e non deve poter partire per dimenticanza.
 * Dimensione dello scaglione: BOT_WARMUP_BATCH (default 50).
 * Sorgente: BOT_WARMUP_SOURCE (default 'GDO 114', che e' la scorta).
 */
export async function GET(req: Request) {
    // PRIMA il Bearer, POI la diagnosi sulla env: con l'ordine opposto un
    // anonimo che chiama l'URL senza header scopre quale env manca.
    const secret = process.env.CRON_SECRET;
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }
    if (!secret) {
        return NextResponse.json({ error: 'CRON_SECRET non impostata' }, { status: 500 });
    }

    const config = leggiConfigRiscaldamento();
    if (!config.attivo) return NextResponse.json({ ok: true, skipped: 'disabled' });

    const [sorgente] = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.companyId, FENICE), eq(users.name, config.sorgente)))
        .limit(1);
    if (!sorgente) {
        return NextResponse.json({ ok: false, error: `sorgente "${config.sorgente}" non trovata` }, { status: 404 });
    }

    const [bot] = await db.select({ id: users.id })
        .from(users)
        .where(and(
            eq(users.companyId, FENICE), eq(users.role, 'GDO'),
            eq(users.isBot, true), eq(users.isActive, true),
        ))
        .limit(1);
    if (!bot) {
        return NextResponse.json({ ok: false, error: 'account bot non trovato' }, { status: 404 });
    }

    // Si pesca largo e si filtra nel modulo puro: le condizioni di
    // "immacolato" sono cinque e stanno scritte in un posto solo, testabile.
    // Qui in SQL restano le due che tagliano il grosso (assegnatario e stato) e
    // le due guardie sulle date, che non devono dipendere da un `filter` in
    // memoria se un domani la query cambia.
    const righe = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        status: leads.status,
        callCount: leads.callCount,
        intakeBatch: leads.intakeBatch,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
        toccatoDalBot: sql<boolean>`EXISTS (
            SELECT 1 FROM "leadEvents" e
            WHERE e."leadId" = ${leads.id}
              AND e."eventType" IN ('BOT_PUSHED','REASSIGNED_FROM_BOT','BOT_CALL_ATTEMPT','BOT_NOTE','BOT_REPORT')
        )`,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        eq(leads.assignedToId, sorgente.id),
        eq(leads.status, 'NEW'),
        eq(leads.callCount, 0),
        isNull(leads.appointmentDate),
        isNull(leads.presentedAt),
    ))
        // I piu' recenti per primi: sono i lead appena entrati, quelli su cui
        // una prima chiamata rende di piu'. Id come spareggio, cosi' due giri
        // ravvicinati non si contendono gli stessi lead.
        .orderBy(sql`${leads.createdAt} DESC`, asc(leads.id))
        .limit(500);

    const candidati: LeadCandidato[] = righe.map((r) => ({
        id: r.id,
        toccatoDalBot: Boolean(r.toccatoDalBot),
        infornata: r.intakeBatch,
        status: r.status,
        callCount: r.callCount,
        appointmentDate: r.appointmentDate,
        presentedAt: r.presentedAt,
    }));

    const piano = pianificaRiscaldamento({ candidati, config });
    if (piano.daSpostare.length === 0) {
        return NextResponse.json({
            ok: true, spostati: 0, residui: piano.residui, motivo: piano.motivo,
        });
    }

    const perId = new Map(righe.map((r) => [r.id, r]));
    const now = new Date();

    // Assegnazione ed evento nella stessa transazione: un lead che cambia mano
    // senza una riga che dica quando e perche' e' la domanda che arriva il
    // giorno dopo, e a cui non si sa rispondere.
    await db.transaction(async (tx) => {
        await tx.update(leads)
            .set({ assignedToId: bot.id, updatedAt: now, version: sql`${leads.version} + 1` })
            .where(inArray(leads.id, piano.daSpostare));

        await tx.insert(leadEvents).values(piano.daSpostare.map((leadId) => ({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'ASSIGNED' as const,
            userId: bot.id,
            timestamp: now,
            metadata: {
                via: 'riscaldamento_numero',
                da: sorgente.id,
                daNome: sorgente.name,
                a: bot.id,
                motivo: 'riscaldamento del numero WhatsApp nuovo',
            },
            companyId: FENICE,
        })));
    });

    // Il push al bot sta FUORI dalla transazione: e' una chiamata di rete, e
    // tenerla dentro significherebbe una transazione aperta per decine di
    // secondi su una tabella calda. Se un push fallisce il lead resta comunque
    // assegnato al bot, che e' lo stato giusto: lo riprendera' il suo flusso.
    let inviati = 0;
    const falliti: string[] = [];
    for (const id of piano.daSpostare) {
        const r = perId.get(id);
        if (!r) continue;
        try {
            const esito = await pushLeadToBot({
                leadId: r.id,
                name: r.name,
                phone: r.phone,
                email: r.email,
                funnel: r.funnel,
                companyId: FENICE,
            });
            if (esito.result === 'sent' || esito.result === 'duplicate') inviati++;
            else falliti.push(`${id}:${esito.result}`);
        } catch (e) {
            console.error(`[riscaldamento] push fallito per ${id}:`, e);
            falliti.push(`${id}:exception`);
        }
    }

    return NextResponse.json({
        ok: true,
        spostati: piano.daSpostare.length,
        inviatiAlBot: inviati,
        falliti: falliti.length,
        dettaglioFalliti: falliti.slice(0, 10),
        residui: piano.residui,
        sorgente: sorgente.name,
    });
}
