import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { sendAgendaToLead } from '@/app/actions/activeCampaignActions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/send-agenda — manda l'agenda a un lead, da account ADMIN.
 *
 * Esiste per una lacuna trovata il 15/09/2026: il pulsante "Agenda" vive solo
 * dentro la scheda del lead, e quella si apre solo dalla ricerca in topbar, che
 * il CRM mostra **solo al ruolo GDO**. Quindi un admin non aveva materialmente
 * modo di mandare un'agenda a nessuno.
 *
 * Il giorno in cui serviva, serviva davvero: durante la saturazione del
 * database sono rimasti 6 appuntamenti senza agenda, con la call il giorno dopo,
 * e l'unico modo di rimediare sarebbe stato chiedere a ogni GDO di rifarla a
 * mano dal proprio account.
 *
 * Passa dalla stessa `sendAgendaToLead` del pulsante: stesso canale, stessi
 * controlli, stessi eventi. Qui non si duplica logica, si apre solo una porta.
 *
 * Body: { leadId: string, lavora?: boolean, haFamiglia?: boolean, offertaDelMese?: boolean }
 *
 * Le varianti scelgono QUALE video partirà dopo l'agenda. Il default e'
 * `lavora: true, haFamiglia: false` perche' e' la combinazione piu' usata dai
 * GDO: negli ultimi 7 giorni 76 agende su 183, e l'80% ha `lavora` acceso.
 */
export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    let body: { leadId?: string; lavora?: boolean; haFamiglia?: boolean; offertaDelMese?: boolean };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    if (!body.leadId || typeof body.leadId !== 'string') {
        return NextResponse.json({ ok: false, error: 'leadId richiesto' }, { status: 400 });
    }

    const res = await sendAgendaToLead(body.leadId, {
        lavora: body.lavora ?? true,
        haFamiglia: body.haFamiglia ?? false,
        offertaDelMese: body.offertaDelMese ?? false,
    });

    // Sempre 200 quando la richiesta è valida: l'esito sta nel corpo, come fa
    // l'endpoint del bot. Un 4xx qui vorrebbe dire "richiesta sbagliata", non
    // "il telefono del lead è spento".
    return NextResponse.json({ ok: res.success, ...res });
}
