import { NextResponse } from 'next/server';
import { runLatePenalties, activationDate } from '@/lib/venditore/latePenaltiesRunner';
import { runCalendarWeekly } from '@/lib/venditore/calendarRunner';

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
    // PRIMA il Bearer, POI la diagnosi sulla env. Con l'ordine opposto un
    // anonimo che chiamava l'URL senza header riceveva "CRON_SECRET non
    // impostata": un 500 che racconta a chi passa qual è il buco.
    //
    // Il confronto regge anche senza la env: `Bearer undefined` resta una
    // password valida solo per chi la indovina, e chi la indovina si ferma
    // comunque al 500 qui sotto senza far girare multe e notifiche. Il 500 è
    // voluto rumoroso — si vede nei log di Vercel — perché una env mancante è
    // un guasto di configurazione, non un tentativo di intrusione.
    const secret = process.env.CRON_SECRET;
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!secret) {
        return NextResponse.json({ error: 'CRON_SECRET non impostata' }, { status: 500 });
    }

    // Il giro del calendario ha kill-switch e attivazione propri: gira anche
    // quando i ritardi sono sospesi, e viceversa — nessuno dei due return
    // anticipati qui sotto lo deve tenere in ostaggio.
    //
    // In `try/catch` perché i due giri sono indipendenti: un errore del
    // calendario (una multa, una notifica) non deve saltare il giro dei
    // ritardi, che è l'altra metà di questo cron.
    let calendar: Awaited<ReturnType<typeof runCalendarWeekly>> | { error: string };
    try {
        calendar = await runCalendarWeekly();
    } catch (e) {
        console.error('cron sales-late-penalties: runCalendarWeekly:', e);
        calendar = { error: 'calendar_failed' };
    }

    if (process.env.SALES_LATE_PENALTIES === 'off') {
        return NextResponse.json({ skipped: true, reason: 'kill_switch_off', calendar });
    }

    if (!activationDate()) {
        return NextResponse.json({ skipped: true, reason: 'missing_activation_date', calendar });
    }

    const result = await runLatePenalties();
    return NextResponse.json({ ...result, calendar });
}
