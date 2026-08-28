import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, gt, or, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { leadEvents, leads } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bot/lead-status — cosa succede DOPO l'appuntamento.
 *
 * Il database del bot si ferma al momento in cui l'appuntamento viene preso:
 * senza sapere chi si presenta e chi compra, il bot ottimizza sul numero di
 * appuntamenti e non sulla loro qualità — può migliorare il conteggio e
 * peggiorare il risultato senza che nessuno se ne accorga.
 *
 * È un canale in LETTURA e in PULL, non un webhook: niente coda di consegna,
 * niente retry da mantenere, nessun evento che si perde se il ricevente è giù.
 * Il bot chiede "cosa è cambiato da questo istante in poi" e riceve le righe in
 * ordine di aggiornamento; quando ha finito rilancia dall'ultimo `nextSince`.
 *
 * Body:  { since: ISO 8601, limit?: number }   Firma: `x-bot-signature` (BOT_WEBHOOK_SECRET)
 * Reply: { leads: LeadStatus[], nextSince: string, hasMore: boolean }
 *
 * PERIMETRO (non allargare senza una ragione): escono SOLO i lead che il bot ha
 * davvero lavorato — quelli che gli abbiamo pushato o di cui ha recapitato
 * l'agenda. Non è un export del CRM.
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[bot-lead-status] missing BOT_WEBHOOK_SECRET');
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const rawBody = await req.text();
    const check = verifySignature(rawBody, req.headers.get('x-bot-signature') ?? '', secret);
    if (!check.valid) {
        return NextResponse.json({ error: 'invalid_signature', reason: check.reason }, { status: 401 });
    }

    let body: { since?: string; limit?: number };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const since = body.since ? new Date(body.since) : null;
    if (!since || isNaN(since.getTime())) {
        return NextResponse.json({ error: 'bad_request', detail: 'since richiesto (ISO 8601)' }, { status: 400 });
    }
    const limit = Math.min(Math.max(Math.floor(body.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

    // Prova di appartenenza: stessa nozione larga usata da /api/bot/outcome per
    // NOTA — push consegnato oppure agenda recapitata. Sottoquery e non join,
    // così un lead con dieci eventi non esce dieci volte.
    const workedByBot = or(
        isNotNull(leads.agendaStatus),
        sql`EXISTS (
            SELECT 1 FROM ${leadEvents} e
            WHERE e."leadId" = ${leads.id}
              AND e."eventType" = 'BOT_PUSHED'
              AND e.metadata->>'result' = 'sent'
        )`,
    );

    const rows = await db.select({
        leadId: leads.id,
        status: leads.status,
        appointmentDate: leads.appointmentDate,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        confermeOutcome: leads.confirmationsOutcome,
        confermeOutcomeAt: leads.confirmationsTimestamp,
        confermeDiscardReason: leads.confirmationsDiscardReason,
        needsReschedule: leads.confNeedsReschedule,
        presentedAt: leads.presentedAt,
        salesOutcome: leads.salespersonOutcome,
        salesOutcomeAt: leads.salespersonOutcomeAt,
        soldProduct: leads.closeProduct,
        soldAmountEur: leads.closeAmountEur,
        discardReason: leads.discardReason,
        agendaStatus: leads.agendaStatus,
        updatedAt: leads.updatedAt,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, 'fenice'),
            gt(leads.updatedAt, since),
            workedByBot,
        ))
        .orderBy(asc(leads.updatedAt))
        .limit(limit + 1); // una in più: dice se c'è altro senza un secondo count

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const payload = page.map(r => ({
        leadId: r.leadId,
        status: r.status,
        appointmentDate: iso(r.appointmentDate),
        appointmentCreatedAt: iso(r.appointmentCreatedAt),
        // 'confermato' | 'scartato' | 'da_rifissare' | null — più la causale.
        confermeOutcome: r.needsReschedule ? 'da_rifissare' : r.confermeOutcome,
        confermeOutcomeAt: iso(r.confermeOutcomeAt),
        confermeDiscardReason: r.confermeDiscardReason,
        // La presenza è latchata: una volta vera non torna falsa.
        presented: r.presentedAt !== null,
        presentedAt: iso(r.presentedAt),
        salesOutcome: r.salesOutcome,          // 'Chiuso' | 'Non chiuso' | 'Sparito' | null
        salesOutcomeAt: iso(r.salesOutcomeAt),
        sold: r.salesOutcome === 'Chiuso',
        soldProduct: r.soldProduct,
        soldAmountEur: r.soldAmountEur,
        discardReason: r.discardReason,
        agendaStatus: r.agendaStatus,          // 'inviato' | 'consegnato' | 'fallito' | null
        updatedAt: iso(r.updatedAt),
    }));

    // `nextSince` è l'updatedAt dell'ultima riga servita, non "adesso": ripartire
    // da adesso salterebbe tutto ciò che cambia mentre si scorrono le pagine.
    const nextSince = page.length > 0
        ? page[page.length - 1].updatedAt.toISOString()
        : since.toISOString();

    return NextResponse.json({ leads: payload, nextSince, hasMore });
}
