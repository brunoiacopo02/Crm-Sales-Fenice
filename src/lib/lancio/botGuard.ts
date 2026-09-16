/**
 * Pezzi comuni alle tre route /api/bot/lancio/*: firma HMAC (identica a
 * /api/bot/outcome), guardia di appartenenza del lead al lancio e calcolo
 * degli slot (serve sia a `slots` sia al 409 di `book`).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { leads, users } from '@/db/schema'
import { verifySignature } from '@/lib/marketing-webhooks/signing'
import { findLancioBotId } from './botAccount'
import { LANCIO_COMPANY, LANCIO_WEBDEV, type LancioConfig } from './config'
import { slotDateKind } from './rules'
import { mattinaSlots, orePrenotabili } from './slots'
import { dayFactsFor, getShiftMembers } from './shiftQueries'

/** Alias locale della company del lancio (intake.ts via config.ts): il lancio è solo Fenice. */
export const FENICE = LANCIO_COMPANY

/**
 * Firma + parse del body. Il corpo grezzo si legge UNA volta sola e serve sia
 * all'HMAC sia al JSON.parse: rileggerlo dopo `req.text()` darebbe stringa
 * vuota, e firmare un oggetto ri-serializzato non sarebbe più la stessa cosa
 * che il bot ha firmato. Il confronto è timing-safe dentro `verifySignature`.
 * Nessuna dipendenza dalla sessione: il middleware lascia passare /api/bot/*.
 */
export async function authBotRequest(req: NextRequest): Promise<{ ok: true; body: any } | { ok: false; res: NextResponse }> {
    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!secret) {
        console.error('[bot-lancio] missing BOT_WEBHOOK_SECRET')
        return { ok: false, res: NextResponse.json({ ok: false, motivo: 'not_configured' }, { status: 503 }) }
    }
    const rawBody = await req.text()
    const check = verifySignature(rawBody, req.headers.get('x-bot-signature') ?? '', secret)
    if (!check.valid) {
        return { ok: false, res: NextResponse.json({ ok: false, motivo: 'invalid_signature', detail: check.reason }, { status: 401 }) }
    }
    try {
        return { ok: true, body: rawBody ? JSON.parse(rawBody) : {} }
    } catch {
        return { ok: false, res: NextResponse.json({ ok: false, motivo: 'invalid_json' }, { status: 400 }) }
    }
}

export interface LancioLeadRow {
    id: string; name: string; phone: string; email: string | null; funnel: string | null
    companyId: string; assignedToId: string | null; status: string
    appointmentDate: Date | null; lancioScelta: string | null; lancioSceltaAt: Date | null
    lancioIngresso: string | null; salespersonUserId: string | null
    confirmationsOutcome: string | null; version: number
    /** Valorizzato = l'appuntamento è già stato presentato: il bot non lo tocca più. */
    presentedAt: Date | null
}

/** Il lead esiste, è del bucket lancio ed è in mano al bot (o è entrato dal pulsante). */
export async function loadLancioLead(leadId: string, cfg: LancioConfig = LANCIO_WEBDEV): Promise<{ ok: true; lead: LancioLeadRow; botUserId: string } | { ok: false; res: NextResponse }> {
    // Stessi quattro filtri di lancioPoolActions.findBotId: unica definizione in botAccount.
    const botId = await findLancioBotId()
    if (!botId) return { ok: false, res: NextResponse.json({ ok: false, motivo: 'bot_account_not_found' }, { status: 503 }) }

    const [lead] = await db.select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, funnel: leads.funnel,
        companyId: leads.companyId, assignedToId: leads.assignedToId, status: leads.status,
        appointmentDate: leads.appointmentDate, lancioScelta: leads.lancioScelta, lancioSceltaAt: leads.lancioSceltaAt,
        lancioIngresso: leads.lancioIngresso, salespersonUserId: leads.salespersonUserId,
        confirmationsOutcome: leads.confirmationsOutcome, version: leads.version,
        presentedAt: leads.presentedAt,
        launchBucket: leads.launchBucket,
    }).from(leads).where(eq(leads.id, leadId)).limit(1)

    if (!lead) return { ok: false, res: NextResponse.json({ ok: false, motivo: 'lead_not_found' }, { status: 404 }) }
    const delLancio = lead.companyId === FENICE && lead.launchBucket === cfg.bucket
    const inManoAlBot = lead.assignedToId === botId || lead.lancioIngresso === 'pulsante_webinar'
    if (!delLancio || !inManoAlBot) {
        return { ok: false, res: NextResponse.json({ ok: false, motivo: 'forbidden', detail: 'lead non del lancio o non in mano al bot' }, { status: 403 }) }
    }
    const { launchBucket: _b, ...row } = lead
    return { ok: true, lead: row, botUserId: botId }
}

export interface SlotsResponse {
    date: string
    mattina: Array<{ hour: number; liberi: number }> | 'conferme'
    pomeriggio: { aperto: boolean; ore: number[] }
    mattinaEsaurita: boolean
    /** Le ore tonde che `book` accetterà per questa data. */
    oreAmmesse: number[]
}

/**
 * null = data fuori dal lancio (il chiamante risponde 422).
 *
 * Ogni ora che esce di qui passa da `orePrenotabili`, cioè dalla STESSA soglia
 * di preavviso che `classifyAt` applica su `book` — pomeriggio compreso. Prima
 * il pomeriggio usciva intero: alle 19:30 il bot proponeva ancora le 20:00 e
 * `book` rispondeva `fuori_regole` a un lead a cui l'orario era già stato
 * detto. Quando non resta nessuna ora, il pomeriggio si chiude (`aperto:false`)
 * e il bot ripiega sul giorno dopo.
 */
export async function computeSlots(dateStr: string, now: Date, cfg: LancioConfig = LANCIO_WEBDEV): Promise<SlotsResponse | null> {
    const day = slotDateKind(dateStr, cfg)
    if (day === null) return null
    if (day === 'dopodomani') {
        return {
            date: dateStr, mattina: 'conferme', pomeriggio: { aperto: false, ore: [] }, mattinaEsaurita: false,
            oreAmmesse: orePrenotabili(dateStr, cfg.oreVenditori, now),
        }
    }
    const members = await getShiftMembers(db, 'GIORNO_DOPO', cfg)
    const facts = await dayFactsFor(db, members, dateStr, { cfg })
    const { mattina, mattinaEsaurita } = mattinaSlots({ dateStr, hours: cfg.oreVenditori, venditori: facts, now })
    const orePomeriggio = orePrenotabili(dateStr, cfg.orePomeriggio, now)
    return {
        date: dateStr,
        // `venditoriLiberi` resta dentro: sono id interni, al bot non escono mai.
        mattina: mattina.map(m => ({ hour: m.hour, liberi: m.liberi })),
        pomeriggio: { aperto: orePomeriggio.length > 0, ore: orePomeriggio },
        mattinaEsaurita,
        // Le ore della mattina sono già filtrate da `mattinaSlots`: qui si
        // riusano quelle, non la config, altrimenti `oreAmmesse` prometterebbe
        // ore che `mattina` non elenca più.
        oreAmmesse: [...mattina.map(m => m.hour), ...orePomeriggio],
    }
}
