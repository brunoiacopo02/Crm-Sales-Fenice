import { NextResponse } from 'next/server'
import { eseguiGiroSimGdo } from '@/lib/simGdo/run'
import { eOraDelGiroSim } from '@/lib/simGdo/orario'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Giro orario SIM GDO (PO 14/11/2026): scrive nel foglio delle SIM il tasso
 * di risposta di oggi di ogni GDO e colora la cella. Lun-sab, 9-20 di Roma:
 * vercel.json lo lancia dalle 7 alle 19 UTC, la guardia tiene le ore giuste
 * con ora solare e legale. `?force=1` salta la guardia (sempre col CRON_SECRET).
 * Interruttore: SIM_GDO_SYNC=off.
 */
export async function GET(req: Request) {
    // Prima il Bearer, poi la diagnosi sulla env (stesso ordine delle altre cron).
    const secret = process.env.CRON_SECRET
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return new NextResponse('Unauthorized', { status: 401 })
    }
    if (!secret) {
        return NextResponse.json({ error: 'CRON_SECRET non impostata' }, { status: 500 })
    }
    if ((process.env.SIM_GDO_SYNC || '').trim().toLowerCase() === 'off') {
        return NextResponse.json({ ok: true, skipped: 'disabled' })
    }
    const force = new URL(req.url).searchParams.get('force') === '1'
    if (!force && !eOraDelGiroSim(new Date())) {
        return NextResponse.json({ ok: true, skipped: 'fuori_orario' })
    }

    const esito = await eseguiGiroSimGdo()
    return NextResponse.json({
        ok: esito.ok,
        errore: esito.errore,
        celleScritte: esito.celleScritte,
        cambiati: esito.cambiati,
        mediaTasso: esito.mediaTasso,
        righe: esito.righe.map(r => ({ riga: r.riga, interno: r.interno, esito: r.esito, chiamate: r.chiamate, tasso: r.tasso, colore: r.colore })),
    }, { status: esito.ok ? 200 : 500 })
}
