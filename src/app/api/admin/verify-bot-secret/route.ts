import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { signPayload } from '@/lib/marketing-webhooks/signing';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/verify-bot-secret — ADMIN only, apribile dal browser.
 *
 * Verifica che BOT_WEBHOOK_SECRET sia allineato col fornitore, col metodo che
 * hanno proposto loro: una richiesta firmata con `companyId` diverso da "fenice".
 * La firma viene controllata prima del parse del body, quindi:
 *   403 → firma accettata, segreti allineati
 *   401 → firma rifiutata, segreti diversi
 * In nessuno dei due casi parte un messaggio a un lead.
 *
 * Perché serve una rotta e non uno script locale: il segreto è marcato *sensitive*
 * su Vercel e non è più leggibile né da `vercel env pull` né dalla dashboard —
 * restituisce il placeholder `[ENCRYPTED]`. L'unico posto dove il valore vero
 * esiste è il runtime della funzione deployata, cioè qui.
 */
export async function GET() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (user.user_metadata?.role !== 'ADMIN') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        return NextResponse.json({ ok: false, detail: 'BOT_WEBHOOK_SECRET non impostato' }, { status: 503 });
    }

    const url = process.env.AGENDA_BOT_URL
        ?? 'https://web-app-messaggistica.vercel.app/api/send-agenda';

    // companyId volutamente diverso da "fenice": se la firma passa, il fornitore
    // si ferma al controllo del tenant e non spedisce nulla.
    const body = JSON.stringify({
        leadId: '00000000-0000-0000-0000-000000000000',
        phone: '000',
        companyId: 'verifica',
        variant: { lavora: false, haFamiglia: false, offertaDelMese: false },
    });

    let status: number;
    let responseBody: string;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-bot-signature': signPayload(body, secret) },
            body,
            signal: AbortSignal.timeout(15000),
        });
        status = res.status;
        responseBody = (await res.text().catch(() => '')).slice(0, 300);
    } catch (e) {
        return NextResponse.json({
            ok: false,
            esito: 'irraggiungibile',
            detail: `Endpoint non raggiungibile: ${String(e)}`,
        }, { status: 200 });
    }

    const esito =
        status === 403 ? 'allineati'
            : status === 401 ? 'disallineati'
                : 'inatteso';

    const detail =
        status === 403 ? 'Firma accettata: il segreto coincide con quello del fornitore.'
            : status === 401 ? 'Firma rifiutata: i segreti NON coincidono. Va rigenerato e coordinato, perché lo stesso valore regge anche il push dei lead.'
                : `Risposta inattesa (${status}): non è né 401 né 403, va chiarito col fornitore.`;

    return NextResponse.json({ ok: status === 403, esito, status, detail, responseBody });
}
