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
export async function POST() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const esito = await eseguiRiscaldamento();
    return NextResponse.json(esito);
}
