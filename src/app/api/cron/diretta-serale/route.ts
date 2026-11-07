import { NextResponse } from 'next/server'
import { eOraSerale, pianoSerale, riepilogoPerGdo } from '@/lib/diretta/automatico'
import { applicaSerale, leggiGiro } from '@/lib/diretta/automaticoDb'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ON = new Set(['1', 'on', 'true'])

/**
 * Giro serale automatico dei GDO (PO 07/11/2026): accantonamento dei ridati
 * oltre 8 giorni per chi ha più di 60 lead in prima chiamata, poi riequilibrio
 * (assenti e chi ha molti più lead degli altri → ai più scarichi, priorità
 * Antony). Regole in src/lib/diretta/automatico.ts.
 *
 * Interruttore: env DIRETTA_SERALE_ENABLED ('1'/'on'). Assente = spento: il
 * giro sposta lead altrui, lo accende Bruno.
 *
 * ORARIO: vercel.json lo chiama alle 18:45 e 19:45 UTC; lavora solo quella
 * che a Roma cade fra le 20:30 e le 21:30 (eOraSerale), così con l'ora legale
 * e senza gira una volta, fuori turno. `?force=1` salta la guardia.
 *
 * PROVA A VUOTO: `?dryRun=1` calcola e restituisce il piano per GDO senza
 * scrivere niente, anche a interruttore spento e a qualunque ora.
 * Sempre dietro CRON_SECRET (Bearer).
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
        return new NextResponse('Unauthorized', { status: 401 })
    }
    const url = new URL(req.url)
    const dryRun = url.searchParams.get('dryRun') === '1'
    const force = url.searchParams.get('force') === '1'
    const acceso = ON.has((process.env.DIRETTA_SERALE_ENABLED ?? '').trim().toLowerCase())

    if (!dryRun && !acceso) return NextResponse.json({ ok: true, skipped: 'disabled' })
    const ora = new Date()
    if (!dryRun && !force && !eOraSerale(ora)) return NextResponse.json({ ok: true, skipped: 'fuori_orario' })

    const { gdos, lista } = await leggiGiro(ora)
    const piano = pianoSerale(gdos, lista, ora)
    const perGdo = riepilogoPerGdo(gdos, piano, ora)

    if (dryRun) {
        return NextResponse.json({
            ok: true, dryRun: true, acceso,
            accantonati: piano.accantonati.length, spostamenti: piano.riequilibrio.spostamenti.length, perGdo,
        })
    }
    const esito = await applicaSerale(piano, lista, ora)
    console.log('[diretta-serale]', JSON.stringify({ esito, perGdo }))
    return NextResponse.json({ ok: true, ...esito, perGdo })
}
