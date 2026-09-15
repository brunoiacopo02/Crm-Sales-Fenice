import { NextResponse, after, type NextRequest } from 'next/server'
import { romeIso } from '@/lib/dateUtils'
import { authBotRequest, loadLancioLead } from '@/lib/lancio/botGuard'
import { assignCallNow, callNowSideEffects } from '@/lib/lancio/booking'
import { parseInfo, parseNote } from '@/lib/lancio/payload'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bot/lancio/call-now  { leadId, info?, note? }
 *
 * Il lead ha scelto "chiamami adesso": round robin sul turno SERA, appuntamento
 * "adesso" già confermato e notifica realtime al venditore.
 *
 * 200 { ok, venditore:{id,nome} } · 200 { …, deduped:true }
 * 409 nessun_venditore (turno SERA vuoto: il bot ripiega sulla prenotazione)
 * 409 gia_prenotato (+appointmentAt, kind) · 409 conflitto
 * 403 forbidden · 400 bad_request | info_non_valida · 401 · 503.
 */
export async function POST(req: NextRequest) {
    const auth = await authBotRequest(req)
    if (!auth.ok) return auth.res
    const body = auth.body as { leadId?: string; info?: unknown; note?: unknown }

    if (!body.leadId || typeof body.leadId !== 'string') {
        return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'leadId richiesto' }, { status: 400 })
    }
    const parsed = parseInfo(body.info)
    if (!parsed.ok) return NextResponse.json({ ok: false, motivo: 'info_non_valida', detail: parsed.detail }, { status: 400 })
    const nota = parseNote(body.note)
    if (!nota.ok) return NextResponse.json({ ok: false, motivo: 'info_non_valida', detail: nota.detail }, { status: 400 })

    const guard = await loadLancioLead(body.leadId)
    if (!guard.ok) return guard.res
    // Appuntamento già presentato: la trattativa è cominciata e il lead non è
    // più materia del bot (stessa guardia di /book).
    if (guard.lead.presentedAt) {
        return NextResponse.json({ ok: false, motivo: 'forbidden', detail: 'lead già presentato' }, { status: 403 })
    }

    const out = await assignCallNow({
        lead: guard.lead, botUserId: guard.botUserId,
        info: parsed.info, note: nota.note, now: new Date(),
    })

    if (!out.ok) {
        if (out.motivo === 'gia_prenotato') {
            // L'ora che ha già, con l'offset italiano: il bot la rilegge al lead
            // così com'è, senza doverla riconvertire da UTC.
            return NextResponse.json({ ok: false, motivo: 'gia_prenotato', appointmentAt: romeIso(out.at), kind: out.kind }, { status: 409 })
        }
        return NextResponse.json(out, { status: 409 })
    }

    if (!out.deduped) {
        const leadId = guard.lead.id, botUserId = guard.botUserId
        after(() => callNowSideEffects({ leadId, botUserId }))
    }
    return NextResponse.json(out)
}
