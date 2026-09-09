import { NextResponse } from 'next/server';
import { runLatePenalties, activationDate } from '@/lib/venditore/latePenaltiesRunner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Malus ritardi venditori: registra un ritardo per ogni scadenza
 * (appuntamento o follow-up) non esitata entro 2 ore.
 *
 * Kill-switch: SALES_LATE_PENALTIES=off spegne il giro senza deploy.
 * Attivazione: SALES_LATE_PENALTIES_FROM (ISO) — senza questa env non
 * viene registrato nulla, così non può partire una multa retroattiva.
 */
export async function GET(req: Request) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (process.env.SALES_LATE_PENALTIES === 'off') {
        return NextResponse.json({ skipped: true, reason: 'kill_switch_off' });
    }

    if (!activationDate()) {
        return NextResponse.json({ skipped: true, reason: 'missing_activation_date' });
    }

    const result = await runLatePenalties();
    return NextResponse.json(result);
}
