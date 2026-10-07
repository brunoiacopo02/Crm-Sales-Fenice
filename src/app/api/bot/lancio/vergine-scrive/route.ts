import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db';
import { leads, leadEvents } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { findLancioBotId } from '@/lib/lancio/botAccount';
import { LANCIO_BUCKET } from '@/lib/lancio/intake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bot/lancio/vergine-scrive — un lead del lancio con la chat ferma
 * (pool "mai contattati", ridato al pool, o di un GDO) ha scritto al bot.
 *
 * Regola PO 07/10/2026: chi scrive al bot lo gestisce il bot, in qualunque pool
 * sia. Qui il lead passa al bot nel CRM se è ancora da lavorare (NEW o
 * IN_PROGRESS, nel pool o di un GDO), così gli esiti del bot hanno dove tornare.
 * Restano dove sono: appuntamenti e lead chiusi (la chat la gestisce comunque il
 * bot) e il gruppo di prova "solo umani" del 106 e del 119.
 *
 * Body: { leadId }   Firma: `x-bot-signature` (BOT_WEBHOOK_SECRET)
 * Reply: { preso: boolean, motivo? }
 */
export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

    const rawBody = await req.text();
    const check = verifySignature(rawBody, req.headers.get('x-bot-signature') ?? '', secret);
    if (!check.valid) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });

    let leadId: string | undefined;
    try { leadId = JSON.parse(rawBody)?.leadId; } catch { /* sotto */ }
    if (typeof leadId !== 'string' || !leadId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

    const botId = await findLancioBotId();
    if (!botId) return NextResponse.json({ preso: false, motivo: 'bot_assente' });

    const [prima] = await db.select({ assignedToId: leads.assignedToId, status: leads.status, lancioPool: leads.lancioPool })
        .from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!prima) return NextResponse.json({ preso: false, motivo: 'lead_sconosciuto' });
    if (prima.assignedToId === botId) return NextResponse.json({ preso: true });

    const now = new Date();
    const presi = await db.update(leads).set({
        assignedToId: botId,
        assignedAt: now,
        lancioPool: null,
        recallDate: null,
        updatedAt: now,
    }).where(and(
        eq(leads.id, leadId),
        eq(leads.launchBucket, LANCIO_BUCKET),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.humanTestCohort),
    )).returning({ id: leads.id, companyId: leads.companyId });

    if (presi.length === 0) {
        return NextResponse.json({ preso: false, motivo: `stato_${String(prima.status).toLowerCase()}` });
    }
    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: 'REASSIGNED_TO_BOT',
        userId: null,
        fromSection: null,
        toSection: null,
        metadata: {
            source: 'lead_scrive_al_bot', bucket: LANCIO_BUCKET,
            fromAssigneeId: prima.assignedToId, lancioPool: prima.lancioPool, toAssigneeId: botId,
        },
        timestamp: now,
        companyId: presi[0].companyId,
    });
    return NextResponse.json({ preso: true });
}
