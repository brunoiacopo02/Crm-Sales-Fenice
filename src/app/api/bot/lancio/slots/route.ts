import { NextResponse, type NextRequest } from 'next/server'
import { authBotRequest, cercaProssimi, computeSlots } from '@/lib/lancio/botGuard'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bot/lancio/slots  — due formati, POST e non GET: bot-hmac firma il body.
 *  1. { date: 'YYYY-MM-DD' }  formato di oggi, risposta SlotsResponse. Solo le due date
 *     del lancio; per il 7/10 risponde mattina:'conferme'. Il pomeriggio passa dal tetto.
 *  2. { from: 'YYYY-MM-DD' }  il primo giorno >= from con posto alle Conferme, risposta
 *     ProssimiResponse { mattina, conferme, saltati } (vedi cercaProssimi).
 */
export async function POST(req: NextRequest) {
    const auth = await authBotRequest(req)
    if (!auth.ok) return auth.res
    const from = typeof auth.body?.from === 'string' ? auth.body.from : ''
    if (from) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
            return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'from richiesta (YYYY-MM-DD)' }, { status: 400 })
        }
        return NextResponse.json({ ok: true, ...await cercaProssimi(from, new Date()) })
    }
    const date = typeof auth.body?.date === 'string' ? auth.body.date : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'date o from richiesta (YYYY-MM-DD)' }, { status: 400 })
    }
    const slots = await computeSlots(date, new Date())
    if (!slots) return NextResponse.json({ ok: false, motivo: 'fuori_regole' }, { status: 422 })
    return NextResponse.json({ ok: true, ...slots })
}
