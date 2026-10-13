import { NextRequest, NextResponse } from 'next/server'
import { segretoValido } from '@/lib/marioVocale/payload'
import { parseMarketingQueue } from '@/lib/marketingQueue/payload'
import { applicaCodaMarketing, CompanySconosciuta } from '@/lib/marketingQueue/applica'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Coda lead del giorno spinta dal CRM marketing (~06:30, lun-sab, max ~150 lead).
// Contratto: src/lib/marketingQueue/. Il marketing ritenta SOLO sui 5xx: tutto
// quello che un ritentativo non sana (token, body, singoli lead sporchi) risponde
// 4xx o 200 con il motivo negli `scartati`.

export async function POST(req: NextRequest) {
    const atteso = process.env.MARKETING_INGEST_TOKEN
    if (!atteso) {
        console.error('[marketing-leads] MARKETING_INGEST_TOKEN non impostato')
        return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
    }
    if (!segretoValido(req.headers.get('x-marketing-token'), atteso)) {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    let json: unknown
    try {
        json = await req.json()
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }

    const parsed = parseMarketingQueue(json)
    if (!parsed.ok) {
        return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
    }

    try {
        const r = await applicaCodaMarketing({
            company: parsed.company,
            queueDate: parsed.queueDate,
            leads: parsed.leads,
            scartati: parsed.scartati,
            ricevuti: (json as { leads: unknown[] }).leads.length,
        })
        console.log(`[marketing-leads] ${parsed.company} ${parsed.queueDate}: ricevuti=${r.ricevuti} creati=${r.creati} aggiornati=${r.aggiornati} scartati=${r.scartati.length}`)
        return NextResponse.json(r)
    } catch (e) {
        if (e instanceof CompanySconosciuta) {
            return NextResponse.json({ ok: false, error: `company sconosciuta: ${parsed.company}` }, { status: 400 })
        }
        console.error(`[marketing-leads] errore su ${parsed.company} ${parsed.queueDate}`, e)
        return NextResponse.json({ ok: false, error: 'errore_interno' }, { status: 500 })
    }
}
