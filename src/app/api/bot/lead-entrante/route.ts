import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { normalizzaLeadEntrante, type LeadEntranteRaw } from '@/lib/bot-fissatore/leadEntranti';
import { adottaLead, FENICE } from '@/lib/bot-fissatore/adozione';

/**
 * Il bot ha appena adottato una chat di qualcuno che ha scritto per primo e ci
 * chiede l'id da usare per quel lead. Un lead per chiamata.
 *
 * Perché questa rotta esiste, invece di rileggere la loro lista con un cron: il
 * flusso accelera (23 aperture in tutto agosto, 20 nei primi quattro giorni di
 * settembre) e un cron è polling, tre giorni dopo aver tagliato $324 di overage
 * Vercel togliendo esattamente quello. Qui non si sveglia niente a vuoto e il
 * `leadId` torna in secondi invece che al giro dopo.
 *
 * `/api/admin/lead-entranti` resta, e non è ridondanza: il loro push parte dentro
 * il webhook di Twilio in fire-and-forget e non ritenta, quindi un push perso è
 * un caso reale. La lista è la rete che lo ripesca.
 *
 * NIENTE INTAKE DA QUI, ed è deliberato. L'intake serve a dire al bot che un lead
 * è suo; qui è già suo e gli manca solo l'id, che se lo prende dalla risposta.
 * Mandarglielo sarebbe anche pericoloso: arriverebbe PRIMA che il bot abbia
 * scritto in quella chat, cioè nella finestra in cui la loro `apreSopraChatViva`
 * non scatta e l'apertura "Ciao, sono Marta…" parte davvero (vedi `intakeSicuro`).
 * Non passando di lì, quel rischio non esiste per costruzione.
 *
 * Auth: `x-bot-signature` HMAC-SHA256 del corpo grezzo con BOT_WEBHOOK_SECRET,
 * identica a /api/bot/outcome. Il middleware lascia passare /api/bot/* senza
 * sessione Supabase.
 */
export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[lead-entrante] missing BOT_WEBHOOK_SECRET');
        return NextResponse.json({ ok: false, motivo: 'not_configured' }, { status: 503 });
    }

    const rawBody = await req.text();
    const check = verifySignature(rawBody, req.headers.get('x-bot-signature') ?? '', secret);
    if (!check.valid) {
        return NextResponse.json({ ok: false, motivo: 'invalid_signature', detail: check.reason }, { status: 401 });
    }

    let body: LeadEntranteRaw;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ ok: false, motivo: 'invalid_json' }, { status: 400 });
    }

    // Stessa funzione pura che gira sulla lista: i due canali non possono
    // divergere, e un campo aggiunto di là arriva gratis anche qui.
    const norm = normalizzaLeadEntrante(body);
    if (!norm.ok) {
        // 200 e non 400: per il bot non è un errore da ritentare — quel numero
        // non è utilizzabile e ritentare non lo renderà tale. Sa solo che non
        // deve scrivere `crm_lead_id`.
        return NextResponse.json({ ok: false, motivo: norm.motivo });
    }

    const [bot] = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.isBot, true), eq(users.companyId, FENICE)))
        .limit(1);
    if (!bot) {
        console.error('[lead-entrante] account bot Fenice non trovato');
        return NextResponse.json({ ok: false, motivo: 'bot_account_not_found' }, { status: 503 });
    }

    try {
        const res = await adottaLead(norm.lead, bot.id);

        if (res.esito === 'altra_azienda') {
            // Il numero è già lead di un'altra azienda (Serenamente): non ne
            // creiamo un doppione Fenice. Il fatto scomodo — che in questo
            // istante il bot di Fenice sta parlando con un cliente di un'altra
            // azienda — non lo risolve questa rotta, ed è portato al PO.
            console.warn(`[lead-entrante] numero di un'altra azienda (${res.companyId}), nessun lead creato`);
            return NextResponse.json({ ok: false, motivo: 'altra_azienda' });
        }

        return NextResponse.json({
            ok: true,
            leadId: res.leadId,
            creato: res.esito === 'creato',
            // `true` = questo push ha riempito un nome che mancava. Ripetere la
            // chiamata quando il lead dice come si chiama e' il modo previsto
            // per mandarcelo: non serve una rotta in piu'.
            nomeAggiornato: res.esito === 'esistente' ? res.nomeAggiornato : false,
        });
    } catch (e) {
        console.error('[lead-entrante] adozione fallita', e);
        // 500: qui ritentare ha senso, a differenza di un telefono impresentabile.
        return NextResponse.json({ ok: false, motivo: 'errore_interno' }, { status: 500 });
    }
}
