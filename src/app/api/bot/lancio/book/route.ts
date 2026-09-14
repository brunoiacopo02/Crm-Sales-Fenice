import { NextResponse, after, type NextRequest } from 'next/server'
import { authBotRequest, computeSlots, loadLancioLead } from '@/lib/lancio/botGuard'
import { classifyAt } from '@/lib/lancio/rules'
import { bookLancio, mattinaSideEffects } from '@/lib/lancio/booking'
import type { LancioBotInfo } from '@/lib/lancio/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bot/lancio/book  { leadId, at (ISO con offset), info?, note? }
 * 200 { ok, kind, venditore?, deduped? } · 409 ora_esaurita (+slots) · 422 fuori_regole · 403.
 */
export async function POST(req: NextRequest) {
    const auth = await authBotRequest(req)
    if (!auth.ok) return auth.res
    const body = auth.body as { leadId?: string; at?: string; info?: unknown; note?: string }

    if (!body.leadId || !body.at) {
        return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'leadId e at richiesti' }, { status: 400 })
    }
    // Senza offset l'ISO verrebbe letto come UTC e le 10:00 italiane
    // diventerebbero le 12:00: meglio rifiutare che prenotare l'ora sbagliata.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(body.at)) {
        return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'at deve includere il fuso orario (offset, es. +02:00)' }, { status: 400 })
    }
    const at = new Date(body.at)
    const now = new Date()
    const decision = classifyAt(at, now)
    if (!decision.ok) return NextResponse.json({ ok: false, motivo: 'fuori_regole' }, { status: 422 })

    const guard = await loadLancioLead(body.leadId)
    if (!guard.ok) return guard.res
    // Appuntamento già presentato: la trattativa è cominciata e il lead non è
    // più materia del bot. Riscriverlo cancellerebbe presenza e venditore.
    if (guard.lead.presentedAt) {
        return NextResponse.json({ ok: false, motivo: 'forbidden', detail: 'lead già presentato' }, { status: 403 })
    }

    const info = body.info && typeof body.info === 'object' && !Array.isArray(body.info) ? body.info as LancioBotInfo : undefined
    const out = await bookLancio({
        lead: guard.lead, botUserId: guard.botUserId, at,
        kind: decision.kind, dateStr: decision.dateStr, hour: decision.hour,
        info, note: typeof body.note === 'string' ? body.note : undefined, now,
    })

    if (!out.ok) {
        const slots = await computeSlots(decision.dateStr, now)
        return NextResponse.json({ ok: false, motivo: 'ora_esaurita', slots }, { status: 409 })
    }
    if (out.kind === 'mattina' && !out.deduped) {
        const lead = guard.lead, venditoreId = out.venditore.id, botUserId = guard.botUserId
        after(() => mattinaSideEffects({ lead, venditoreId, at, botUserId }))
    }
    return NextResponse.json(out)
}
