import { NextRequest, NextResponse } from 'next/server';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { leggiOreOccupate } from '@/lib/conferme/oreOccupateDb';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bot/ore-occupate — quante call ci sono già in ogni ora (PO 09/11/2026).
 *
 * Il bot, quando propone lui un orario, sceglie fra le ore meno piene: martedì 10/11
 * alle 10:00 c'erano 19 appuntamenti su 89 e le Conferme non reggono picchi così.
 * Contano tutti gli appuntamenti vivi del CRM, di bot e GDO (regole in
 * src/lib/conferme/oreOccupate.ts). Sola lettura, nessun dato di lead: solo numeri.
 *
 * Body:  { giorni: ['YYYY-MM-DD', ...] }  da 1 a 3 giorni di Roma.
 * Firma: `x-bot-signature`, stesso BOT_WEBHOOK_SECRET delle altre direzioni.
 * Reply: { soglia: number, giorni: { 'YYYY-MM-DD': { '9': n, ..., '21': n } } }
 *   `soglia` = appSettings `ora_affollata_soglia` (default 8): un'ora con almeno
 *   tanti appuntamenti è affollata.
 */
export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[ore-occupate] missing BOT_WEBHOOK_SECRET');
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const rawBody = await req.text();
    const check = verifySignature(rawBody, req.headers.get('x-bot-signature') ?? '', secret);
    if (!check.valid) {
        return NextResponse.json({ error: 'invalid_signature', reason: check.reason }, { status: 401 });
    }

    let giorni: unknown;
    try {
        giorni = (JSON.parse(rawBody) as { giorni?: unknown })?.giorni;
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (!Array.isArray(giorni) || !giorni.every((g) => typeof g === 'string')) {
        return NextResponse.json({ error: 'bad_request', detail: 'giorni: da 1 a 3 date YYYY-MM-DD' }, { status: 400 });
    }

    const ore = await leggiOreOccupate(giorni as string[]);
    if (!ore) {
        return NextResponse.json({ error: 'bad_request', detail: 'giorni: da 1 a 3 date YYYY-MM-DD, o lettura non riuscita' }, { status: 400 });
    }
    // Una riga per chiamata: e' l'unica traccia che il bot sta davvero leggendo le ore
    // (i log di Vercel registrano solo l'output delle funzioni). Niente dati di lead.
    console.info(`[ore-occupate] ${Object.keys(ore.giorni).join(',')} soglia ${ore.soglia}`);
    return NextResponse.json(ore);
}
