import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { eseguiRiscaldamento } from '@/app/api/cron/bot-warmup/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/admin/bot-warmup-run — fa girare SUBITO uno scaglione di
 * riscaldamento, senza aspettare lo scoccare dell'ora.
 *
 * Il cron gira al minuto :20; per provare una modifica servirebbe aspettare
 * fino a un'ora, e il `CRON_SECRET` non e' leggibile (env "Sensitive": si
 * scrive, non si rilegge). Questo endpoint chiama la stessa identica funzione
 * del cron — non una copia — autenticando con la sessione ADMIN, come
 * `/api/admin/send-agenda`.
 *
 * Vale tutto quello che vale per il cron: se `BOT_WARMUP` non e' acceso non fa
 * niente, e le guardie sui lead sono le stesse (mai scritto a quel numero,
 * fuori dalle infornate anomale, mai chiamato, senza appuntamento).
 */
export async function POST(req: Request) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    // `forza` scavalca il tetto giornaliero, `scaglione` cambia la dimensione
    // del giro per questa volta sola. Il tetto serve a impedire che i giri
    // automatici svuotino la scorta in un pomeriggio; qui la decisione la sta
    // prendendo una persona, e deve poter passare. Corpo assente = giro normale.
    let forza = false;
    let scaglione: number | undefined;
    try {
        const b = await req.json() as { forza?: unknown; scaglione?: unknown };
        forza = b?.forza === true;
        const n = Number(b?.scaglione);
        if (Number.isInteger(n) && n > 0 && n <= 500) scaglione = n;
    } catch {
        // Nessun corpo JSON: e' il caso normale del pulsante senza opzioni.
    }

    const esito = await eseguiRiscaldamento({ forza, scaglione });
    return NextResponse.json(esito);
}
