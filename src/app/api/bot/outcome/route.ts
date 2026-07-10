import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db';
import { leads, users, leadEvents } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { updateLeadOutcome } from '@/app/actions/pipelineActions';
import { reassignBotLeadToHumanPool } from '@/lib/bot-fissatore/reassign';
import type { BotReport } from '@/lib/bot-fissatore/types';

// INTERROTTO: chat avviata ma interrotta senza obiezione ferrea → ritorno al pool umano.
// NON_RISPOSTO: mai risposto → ritorno al pool umano. DA_SCARTARE: solo obiezione ferrea → scarto.
const VALID_OUTCOMES = ['APPUNTAMENTO', 'DA_SCARTARE', 'RICHIAMO', 'NON_RISPOSTO', 'INTERROTTO'] as const;
type BotOutcome = typeof VALID_OUTCOMES[number];

interface BotOutcomeBody {
    leadId?: string;
    outcome?: string;
    date?: string;        // ISO 8601 con offset, es. 2026-06-20T15:00:00+02:00
    note?: string;
    discardReason?: string;
    report?: BotReport;
}

export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[bot-fissatore] missing BOT_WEBHOOK_SECRET');
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const rawBody = await req.text();
    const sig = req.headers.get('x-bot-signature') ?? '';
    const check = verifySignature(rawBody, sig, secret);
    if (!check.valid) {
        return NextResponse.json({ error: 'invalid_signature', reason: check.reason }, { status: 401 });
    }

    let body: BotOutcomeBody;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const { leadId, outcome, note, discardReason, report } = body;
    if (!leadId || !outcome || !VALID_OUTCOMES.includes(outcome as BotOutcome)) {
        return NextResponse.json({ error: 'bad_request', detail: 'leadId e outcome validi richiesti' }, { status: 400 });
    }
    const typedOutcome = outcome as BotOutcome;

    // Data richiesta per APPUNTAMENTO e RICHIAMO.
    let date: Date | undefined;
    if (typedOutcome === 'APPUNTAMENTO' || typedOutcome === 'RICHIAMO') {
        if (!body.date) {
            return NextResponse.json({ error: 'bad_request', detail: 'date richiesta per APPUNTAMENTO/RICHIAMO' }, { status: 400 });
        }
        date = new Date(body.date);
        if (isNaN(date.getTime())) {
            return NextResponse.json({ error: 'bad_request', detail: 'date non valida (atteso ISO 8601)' }, { status: 400 });
        }
        // Richiedi un fuso esplicito: senza offset la data è ambigua e l'appuntamento
        // risulterebbe sfalsato. Es. valido: 2026-06-20T15:00:00+02:00
        if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(body.date)) {
            return NextResponse.json({ error: 'bad_request', detail: 'date deve includere il fuso orario (offset, es. +02:00)' }, { status: 400 });
        }
    }

    // Carica il lead + verifica che appartenga a un account bot Fenice.
    const [lead] = await db.select({
        id: leads.id,
        companyId: leads.companyId,
        assignedToId: leads.assignedToId,
        status: leads.status,
        confNeedsReschedule: leads.confNeedsReschedule,
    }).from(leads).where(eq(leads.id, leadId)).limit(1);

    if (!lead) {
        return NextResponse.json({ error: 'lead_not_found' }, { status: 404 });
    }
    if (lead.companyId !== 'fenice') {
        return NextResponse.json({ error: 'forbidden', detail: 'lead non Fenice' }, { status: 403 });
    }

    const [assignee] = lead.assignedToId
        ? await db.select({ id: users.id, isBot: users.isBot }).from(users).where(eq(users.id, lead.assignedToId)).limit(1)
        : [undefined];
    if (!assignee || !assignee.isBot) {
        return NextResponse.json({ error: 'forbidden', detail: 'lead non assegnato a un account bot' }, { status: 403 });
    }

    // Idempotenza anti ri-fissaggio. Il bot esterno ri-notifica lo stesso
    // APPUNTAMENTO ~ogni ora per lead già appuntati: senza guardia, updateLeadOutcome
    // ri-timbra appointmentCreatedAt=now (inquina "app fissati oggi") e gonfia
    // callCount (visti valori fino a 298). Un lead già in APPOINTMENT e non in
    // attesa di rifissaggio (i rifissaggi legittimi passano dalle Conferme, che
    // settano confNeedsReschedule) NON va ri-processato: no-op senza scritture DB.
    if (typedOutcome === 'APPUNTAMENTO' && lead.status === 'APPOINTMENT' && !lead.confNeedsReschedule) {
        return NextResponse.json({ ok: true, deduped: true });
    }

    // Persisti il report (se presente) e logga un evento di audit.
    if (report) {
        await db.update(leads).set({ botReport: report }).where(eq(leads.id, leadId));
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'BOT_REPORT',
            userId: assignee.id,
            timestamp: new Date(),
            metadata: report as Record<string, unknown>,
            companyId: 'fenice',
        }).catch((e) => console.error('[bot-fissatore] BOT_REPORT event err', e));
    }

    // Ritorno al pool umano: il bot non ha convertito ma non c'è obiezione ferrea
    // (mai risposto / chat interrotta) → riassegna a un GDO umano via round-robin AC.
    // Il lead riparte come nuovo (status=NEW, callCount=0). updateLeadOutcome NON è
    // coinvolto: i flussi dei GDO umani restano intatti.
    if (typedOutcome === 'NON_RISPOSTO' || typedOutcome === 'INTERROTTO') {
        const reason = typedOutcome === 'NON_RISPOSTO' ? 'mai_risposto' : 'chat_interrotta';
        const r = await reassignBotLeadToHumanPool(leadId, reason, assignee.id, note);
        return NextResponse.json({ ok: true, reassigned: r.assignedToId });
    }

    // Transizione di stato via riuso totale di updateLeadOutcome (handoff Conferme,
    // call log, marketing webhook). serviceCtx bypassa sessione/tenant e spegne la gamification.
    const result = await updateLeadOutcome(
        leadId,
        typedOutcome,
        note ?? '',
        date,
        undefined,            // userId (non usato: passiamo serviceCtx)
        discardReason,
        undefined,            // currentVersion (no optimistic lock dal bot)
        undefined,            // scriptCompleted
        { companyId: 'fenice', actorUserId: assignee.id, isBot: true },
    );

    if (!result || result.success !== true) {
        return NextResponse.json({ error: 'update_failed', detail: result?.error ?? 'unknown' }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
}
