import { NextResponse } from 'next/server'
import { runGestionaleSync } from '@/lib/gestionale/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Copia oraria dello snapshot del gestionale (spec 2026-10-02).
 * Kill-switch: GESTIONALE_SYNC=off. Senza GESTIONALE_API_URL/KEY esce "skipped".
 */
export async function GET(req: Request) {
    // Prima il Bearer, poi la diagnosi sulla env (stesso ordine di sales-late-penalties).
    const secret = process.env.CRON_SECRET
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return new NextResponse('Unauthorized', { status: 401 })
    }
    if (!secret) {
        return NextResponse.json({ error: 'CRON_SECRET non impostata' }, { status: 500 })
    }
    const result = await runGestionaleSync('cron')
    return NextResponse.json(result, { status: result.status === 'error' ? 500 : 200 })
}
