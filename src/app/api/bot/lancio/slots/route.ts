import { NextResponse, type NextRequest } from 'next/server'
import { authBotRequest, computeSlots } from '@/lib/lancio/botGuard'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bot/lancio/slots  { date: 'YYYY-MM-DD' }
 * POST e non GET: bot-hmac firma il body. Risposta: vedi SlotsResponse.
 * Solo le due date del lancio; per il 7/10 risponde mattina:'conferme'.
 */
export async function POST(req: NextRequest) {
    const auth = await authBotRequest(req)
    if (!auth.ok) return auth.res
    const date = typeof auth.body?.date === 'string' ? auth.body.date : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'date richiesta (YYYY-MM-DD)' }, { status: 400 })
    }
    const slots = await computeSlots(date, new Date())
    if (!slots) return NextResponse.json({ ok: false, motivo: 'fuori_regole' }, { status: 422 })
    return NextResponse.json({ ok: true, ...slots })
}
