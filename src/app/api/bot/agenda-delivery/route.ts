import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { logLeadEvent } from '@/lib/eventLogger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bot/agenda-delivery — avviso a posteriori di consegna.
 *
 * Un'agenda che esce con esito `inviato` (accettata da Twilio ma senza conferma
 * entro ~8s, tipicamente telefono spento) resterebbe in quello stato per sempre,
 * e con essa il blocco del reinvio nella UI del GDO. Il fornitore ci avvisa
 * quando quel messaggio viene poi consegnato davvero, e qui chiudiamo il cerchio.
 *
 * Body: { leadId, esito: 'consegnato', sid?, at? }
 * Firma: `x-bot-signature`, stesso BOT_WEBHOOK_SECRET delle altre direzioni.
 *
 * Idempotente: agisce solo sulla transizione inviato → consegnato. Una seconda
 * chiamata, o una che arriva su un lead in altro stato, risponde 200 senza
 * scrivere — così un retry del fornitore non è mai un problema.
 */
export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[agenda-delivery] missing BOT_WEBHOOK_SECRET');
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const rawBody = await req.text();
    const check = verifySignature(rawBody, req.headers.get('x-bot-signature') ?? '', secret);
    if (!check.valid) {
        return NextResponse.json({ error: 'invalid_signature', reason: check.reason }, { status: 401 });
    }

    let body: { leadId?: string; esito?: string; sid?: string; at?: string };
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const { leadId, esito, sid, at } = body;
    if (!leadId || esito !== 'consegnato') {
        return NextResponse.json(
            { error: 'bad_request', detail: 'leadId richiesto ed esito deve valere "consegnato"' },
            { status: 400 },
        );
    }

    const [lead] = await db.select({
        id: leads.id,
        companyId: leads.companyId,
        agendaStatus: leads.agendaStatus,
    }).from(leads).where(eq(leads.id, leadId)).limit(1);

    if (!lead) return NextResponse.json({ error: 'lead_not_found' }, { status: 404 });
    if (lead.companyId !== 'fenice') {
        return NextResponse.json({ error: 'forbidden', detail: 'lead non Fenice' }, { status: 403 });
    }

    // Solo la transizione attesa. Qualsiasi altro stato (già consegnato, fallito,
    // mai inviato) non è un errore: è un avviso fuori tempo o ripetuto.
    if (lead.agendaStatus !== 'inviato') {
        return NextResponse.json({ ok: true, ignored: true, agendaStatus: lead.agendaStatus });
    }

    await db.update(leads)
        .set({ agendaStatus: 'consegnato' })
        .where(and(eq(leads.id, leadId), eq(leads.companyId, 'fenice')));

    await logLeadEvent({
        leadId,
        eventType: 'AGENDA_DELIVERED',
        metadata: { sid: sid ?? null, at: at ?? null, from: 'inviato' },
        companyId: 'fenice',
    }).catch((e) => console.error('[agenda-delivery] log evento fallito', e));

    return NextResponse.json({ ok: true, updated: true });
}
