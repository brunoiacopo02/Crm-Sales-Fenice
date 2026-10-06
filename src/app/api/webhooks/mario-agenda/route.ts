import { NextRequest, NextResponse } from 'next/server'
import { parseAgendaMario, segretoValido } from '@/lib/marioVocale/payload'
import { applicaAgendaMario } from '@/lib/marioVocale/applica'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Il sito di Federico aspetta 10 s; l'agenda del bot ne usa fino a ~8.
export const maxDuration = 30

// Il Mario vocale di Federico (IA che chiama la coda /ia-vocale) ci avvisa quando
// fissa un appuntamento. Contratto e flusso: src/lib/marioVocale/.
// Qualsiasi risposta non 2xx lo fa ritentare (1, 5, 15, 60... minuti) con lo stesso
// id_invio: per questo gli errori che un ritentativo non sana (lead inesistente,
// appuntamento gia' preso) rispondono 200 con il motivo nel corpo.

export async function POST(req: NextRequest) {
    if (!process.env.MARIO_WEBHOOK_SEGRETO) {
        return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
    }
    if (!segretoValido(req.headers.get('x-mario-segreto'), process.env.MARIO_WEBHOOK_SEGRETO)) {
        return NextResponse.json({ ok: false, error: 'segreto_non_valido' }, { status: 401 })
    }

    let json: unknown
    try {
        json = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const parsed = parseAgendaMario(json, Date.now())
    if (!parsed.ok) {
        // Un appuntamento passato non si manda piu': 200, cosi' smette di ritentare.
        const status = parsed.reason === 'appuntamento_passato' ? 200 : 400
        console.warn(`[mario-vocale] payload rifiutato (${parsed.reason})`)
        return NextResponse.json({ ok: false, error: parsed.reason }, { status })
    }

    try {
        const r = await applicaAgendaMario(parsed.value)
        return NextResponse.json(r.body, { status: r.http })
    } catch (e) {
        console.error(`[mario-vocale] errore su id_invio ${parsed.value.idInvio}`, e)
        return NextResponse.json({ ok: false, error: 'errore_interno' }, { status: 500 })
    }
}
