import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { leads } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { logLeadEvent } from '@/lib/eventLogger';
import { ESITI_VERIFICA, inCoorteVerifica, type EsitoVerificaBot } from '@/lib/conferme/verificaBot';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bot/verifica-presenza — "App da verificare" (contratto v1.13, Direzione 7).
 *
 * Un'ora prima della call il bot chiede la conferma della presenza ai lead confermati
 * dalle Conferme il giorno prima, e ci avvisa due volte:
 *   { evento: 'inviata',  leadId, appuntamentoAt, at, canale }
 *   { evento: 'risposta', leadId, appuntamentoAt, at, esito, testo }
 *     esito: 'confermato' | 'non_conferma' | 'risposta'
 * Il "nessuna risposta in 30 minuti" non arriva: lo calcoliamo noi dall'istante
 * dell'invio (src/lib/conferme/verificaBot.ts), così non dipende da un altro giro del bot.
 *
 * Firma: `x-bot-signature`, stesso BOT_WEBHOOK_SECRET delle altre direzioni.
 * Idempotente: un avviso ripetuto, fuori tempo o per una call spostata risponde 200
 * `ignored` senza scrivere. Le scritture non toccano `version` né `updatedAt` (come le
 * colonne dell'avviso bloccante): sono metadati, non una modifica del lead.
 */
export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[verifica-presenza] missing BOT_WEBHOOK_SECRET');
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const rawBody = await req.text();
    const check = verifySignature(rawBody, req.headers.get('x-bot-signature') ?? '', secret);
    if (!check.valid) {
        return NextResponse.json({ error: 'invalid_signature', reason: check.reason }, { status: 401 });
    }

    let body: { evento?: string; leadId?: string; appuntamentoAt?: string; at?: string; canale?: string; esito?: string; testo?: string };
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const { evento, leadId } = body;
    const appt = body.appuntamentoAt ? new Date(body.appuntamentoAt) : null;
    if (!leadId || (evento !== 'inviata' && evento !== 'risposta') || !appt || isNaN(appt.getTime())) {
        return NextResponse.json({ error: 'bad_request', detail: 'leadId, evento (inviata|risposta) e appuntamentoAt ISO richiesti' }, { status: 400 });
    }
    const esito = body.esito as EsitoVerificaBot | undefined;
    if (evento === 'risposta' && (!esito || esito === 'in_attesa' || !ESITI_VERIFICA.includes(esito))) {
        return NextResponse.json({ error: 'bad_request', detail: 'esito (confermato|non_conferma|risposta) richiesto per evento risposta' }, { status: 400 });
    }
    const atRaw = body.at ? new Date(body.at) : null;
    const now = new Date();
    // Un orologio del bot nel futuro non deve far scadere prima i 30 minuti.
    const at = atRaw && !isNaN(atRaw.getTime()) && atRaw.getTime() <= now.getTime() ? atRaw : now;

    const [lead] = await db.select({
        id: leads.id,
        companyId: leads.companyId,
        appointmentDate: leads.appointmentDate,
        confirmationsOutcome: leads.confirmationsOutcome,
        confirmationsTimestamp: leads.confirmationsTimestamp,
        botVerificaApptAt: leads.botVerificaApptAt,
        botVerificaSentAt: leads.botVerificaSentAt,
        botVerificaEsito: leads.botVerificaEsito,
    }).from(leads).where(eq(leads.id, leadId)).limit(1);

    if (!lead) return NextResponse.json({ error: 'lead_not_found' }, { status: 404 });
    if (lead.companyId !== 'fenice') {
        return NextResponse.json({ error: 'forbidden', detail: 'lead non Fenice' }, { status: 403 });
    }

    // La call di cui parla il bot deve essere quella di adesso, e il lead ancora nella
    // coorte: se nel frattempo è stato scartato o spostato, l'avviso non vale più.
    const stessaCall = !!lead.appointmentDate && lead.appointmentDate.getTime() === appt.getTime();
    if (!stessaCall) return NextResponse.json({ ok: true, ignored: true, motivo: 'appuntamento_cambiato' });
    if (!inCoorteVerifica(lead)) return NextResponse.json({ ok: true, ignored: true, motivo: 'fuori_coorte' });

    const giaInviata = !!lead.botVerificaSentAt && !!lead.botVerificaApptAt
        && lead.botVerificaApptAt.getTime() === appt.getTime();

    if (evento === 'inviata') {
        if (giaInviata) return NextResponse.json({ ok: true, ignored: true, motivo: 'gia_inviata' });
        await db.update(leads).set({
            botVerificaApptAt: appt,
            botVerificaSentAt: at,
            botVerificaEsito: 'in_attesa',
            botVerificaEsitoAt: null,
            botVerificaRisposta: null,
            botVerificaGestitaAt: null,
            botVerificaSparitoAt: null,
            botVerificaSparitoById: null,
        }).where(and(eq(leads.id, leadId), eq(leads.companyId, 'fenice')));
        await logLeadEvent({
            leadId,
            eventType: 'BOT_VERIFICA_INVIATA',
            metadata: { appuntamentoAt: appt.toISOString(), at: at.toISOString(), canale: body.canale ?? null },
            companyId: 'fenice',
        }).catch((e) => console.error('[verifica-presenza] log evento fallito', e));
        return NextResponse.json({ ok: true, updated: true });
    }

    // evento === 'risposta'
    if (!giaInviata) return NextResponse.json({ ok: true, ignored: true, motivo: 'verifica_non_inviata' });
    if (lead.botVerificaEsito === esito) return NextResponse.json({ ok: true, ignored: true, motivo: 'stesso_esito' });
    const testo = (body.testo ?? '').slice(0, 500) || null;
    await db.update(leads).set({
        botVerificaEsito: esito,
        botVerificaEsitoAt: at,
        botVerificaRisposta: testo,
    }).where(and(eq(leads.id, leadId), eq(leads.companyId, 'fenice')));
    await logLeadEvent({
        leadId,
        eventType: 'BOT_VERIFICA_RISPOSTA',
        metadata: { appuntamentoAt: appt.toISOString(), at: at.toISOString(), esito, testo },
        companyId: 'fenice',
    }).catch((e) => console.error('[verifica-presenza] log evento fallito', e));
    return NextResponse.json({ ok: true, updated: true });
}
