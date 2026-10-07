import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db';
import { leads, leadEvents } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { findLancioBotId } from '@/lib/lancio/botAccount';
import { LANCIO_BUCKET } from '@/lib/lancio/intake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bot/lancio/vergine-scrive — un lead del pool "mai contattati dal
 * bot" (lancioPool = 'VERGINI', PO 07/10/2026) ha scritto al bot.
 *
 * Chi scrive lo gestisce il bot: se il lead è ancora nel pool (nessuno lo ha
 * assegnato) passa al bot qui, così gli esiti del bot hanno dove tornare. Se il
 * TL lo ha già dato a un GDO resta al GDO e il bot non risponde.
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

    const now = new Date();
    const presi = await db.update(leads).set({
        assignedToId: botId,
        assignedAt: now,
        lancioPool: null,
        updatedAt: now,
    }).where(and(
        eq(leads.id, leadId),
        eq(leads.launchBucket, LANCIO_BUCKET),
        eq(leads.lancioPool, 'VERGINI'),
        isNull(leads.assignedToId),
    )).returning({ id: leads.id, companyId: leads.companyId });

    if (presi.length > 0) {
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'REASSIGNED_TO_BOT',
            userId: null,
            fromSection: null,
            toSection: null,
            metadata: { source: 'lancio_vergine_scrive', bucket: LANCIO_BUCKET, lancioPool: 'VERGINI', toAssigneeId: botId },
            timestamp: now,
            companyId: presi[0].companyId,
        });
        return NextResponse.json({ preso: true });
    }

    // Già del bot (un secondo messaggio, o il TL glielo aveva ridato): va bene uguale.
    const [lead] = await db.select({ assignedToId: leads.assignedToId }).from(leads).where(eq(leads.id, leadId)).limit(1);
    if (lead?.assignedToId === botId) return NextResponse.json({ preso: true });
    return NextResponse.json({ preso: false, motivo: lead ? 'di_un_gdo' : 'lead_sconosciuto' });
}
