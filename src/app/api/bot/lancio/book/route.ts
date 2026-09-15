import { NextResponse, after, type NextRequest } from 'next/server'
import { romeIso } from '@/lib/dateUtils'
import { authBotRequest, computeSlots, loadLancioLead } from '@/lib/lancio/botGuard'
import { classifyAt } from '@/lib/lancio/rules'
import { bookLancio, confermeSideEffects, mattinaSideEffects } from '@/lib/lancio/booking'
import type { LancioBotInfo } from '@/lib/lancio/config'

export const dynamic = 'force-dynamic'

/** Quanto del racconto del bot accettiamo di scrivere su `leads.lancioBotInfo`. */
const MAX_RISPOSTE = 6
const MAX_RISPOSTA_CHARS = 300
const MAX_NOTE_CHARS = 1000

/**
 * `info` arriva da una chat: senza confine finirebbe in `lancioBotInfo` (jsonb)
 * qualunque cosa, di qualunque dimensione, e la pagina /lancio la renderizza.
 * Si tiene SOLO `risposte: string[]`, ripulita e limitata; le chiavi in più si
 * ignorano. Un tipo sbagliato non si salva a metà: 400, il bot è nostro e il
 * suo contratto lo correggiamo noi.
 */
function parseInfo(raw: unknown): { ok: true; info?: LancioBotInfo } | { ok: false; detail: string } {
    if (raw === undefined || raw === null) return { ok: true }
    if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, detail: 'info deve essere un oggetto' }
    const risposte = (raw as Record<string, unknown>).risposte
    if (risposte === undefined || risposte === null) return { ok: true }
    if (!Array.isArray(risposte)) return { ok: false, detail: 'info.risposte deve essere un array di stringhe' }
    if (!risposte.every(r => typeof r === 'string')) return { ok: false, detail: 'info.risposte deve contenere solo stringhe' }
    const pulite = (risposte as string[])
        .map(r => r.trim().slice(0, MAX_RISPOSTA_CHARS))
        .filter(r => r.length > 0)
        .slice(0, MAX_RISPOSTE)
    return { ok: true, info: { risposte: pulite } }
}

/**
 * POST /api/bot/lancio/book  { leadId, at (ISO con offset), info?, note? }
 * 200 { ok, kind, venditore?, deduped? }
 * 409 ora_esaurita (+slots) · 409 gia_prenotato (+appointmentAt, kind) · 409 conflitto
 * 422 fuori_regole · 403 forbidden · 400 bad_request | info_non_valida.
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

    const parsed = parseInfo(body.info)
    if (!parsed.ok) {
        return NextResponse.json({ ok: false, motivo: 'info_non_valida', detail: parsed.detail }, { status: 400 })
    }
    if (body.note !== undefined && typeof body.note !== 'string') {
        return NextResponse.json({ ok: false, motivo: 'info_non_valida', detail: 'note deve essere una stringa' }, { status: 400 })
    }
    if (typeof body.note === 'string' && body.note.length > MAX_NOTE_CHARS) {
        return NextResponse.json({ ok: false, motivo: 'info_non_valida', detail: `note oltre ${MAX_NOTE_CHARS} caratteri` }, { status: 400 })
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

    const out = await bookLancio({
        lead: guard.lead, botUserId: guard.botUserId, at,
        kind: decision.kind, dateStr: decision.dateStr, hour: decision.hour,
        info: parsed.info, note: body.note, now,
    })

    if (!out.ok) {
        if (out.motivo === 'gia_prenotato') {
            // L'ora che ha già, scritta con l'offset italiano: il bot la rilegge
            // al lead così com'è, senza doverla riconvertire da UTC.
            return NextResponse.json({ ok: false, motivo: 'gia_prenotato', appointmentAt: romeIso(out.at), kind: out.kind }, { status: 409 })
        }
        if (out.motivo === 'conflitto') {
            return NextResponse.json({ ok: false, motivo: 'conflitto' }, { status: 409 })
        }
        const slots = await computeSlots(decision.dateStr, now)
        return NextResponse.json({ ok: false, motivo: 'ora_esaurita', slots }, { status: 409 })
    }

    if (!out.deduped) {
        const lead = guard.lead, botUserId = guard.botUserId
        if (out.kind === 'mattina') {
            const venditoreId = out.venditore.id
            after(() => mattinaSideEffects({ lead, venditoreId, at, botUserId }))
        } else {
            after(() => confermeSideEffects({ leadId: lead.id, botUserId }))
        }
    }
    return NextResponse.json(out)
}
