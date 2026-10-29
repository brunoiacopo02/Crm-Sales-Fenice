import { NextResponse } from 'next/server'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import crypto from 'node:crypto'
import { db } from '@/db'
import { leads, users, leadEvents } from '@/db/schema'
import { pushLeadToBot } from '@/lib/bot-fissatore/push'
import { MARKETING_QUEUE_BUCKET } from '@/lib/marketingQueue/applica'
import { leggiConfigCodaAlBot, pianificaCodaAlBot, funnelPerIlBot, finestraCodaAlBot, type CandidatoCoda } from '@/lib/marketingQueue/alBot'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FENICE = 'fenice'

/**
 * Coda marketing al bot (PO 29/10/2026): i lead MKT_CODA senza assegnatario
 * passano al bot, come un lead di ActiveCampaign. Da lì vale il giro di sempre:
 * timer 96h, restituzione ai GDO, parcheggio dei mai risposto.
 *
 * Ritmo (PO 29/10/2026, sessione qualita' numeri): 30 nella finestra della
 * mattina (09-13) e 30 in quella del pomeriggio (15-19), 10 per giro, anche i
 * vecchi. Il push porta `codaMarketing: true`: il bot li divide alla pari sui 3
 * numeri delle aperture a freddo (10 a numero per finestra), mai dal 3199.
 *
 * Interruttore `MKT_CODA_BOT` (acceso se assente, `off` lo spegne),
 * scaglione `MKT_CODA_BOT_BATCH` (10), tetto per finestra `MKT_CODA_BOT_FINESTRA` (30).
 * Le regole stanno in src/lib/marketingQueue/alBot.ts.
 */
/**
 * TEMPORANEO, SOLO 29/10/2026 (richiesta PO delle 16:25): 5 giri in piu' da 10
 * lead alle 17:00, 17:30, 18:00, 18:30 e 19:00 di Roma (UTC+1), oltre alle finestre
 * normali. Contati a parte (`via: coda_marketing_extra`) per non mangiare la
 * finestra del pomeriggio. Le date sono fisse: dal 30/10 non scatta piu' niente,
 * e il commit va comunque ritirato.
 */
const GIRI_EXTRA_29_10 = ['2026-10-29T16:00:00Z', '2026-10-29T16:30:00Z', '2026-10-29T17:00:00Z', '2026-10-29T17:30:00Z', '2026-10-29T18:00:00Z']
    .map((s) => new Date(s))
const LEAD_PER_GIRO_EXTRA = 10

function giroExtra(d: Date): Date | null {
    return GIRI_EXTRA_29_10.find((g) => d >= g && d.getTime() < g.getTime() + 10 * 60_000) ?? null
}

export async function eseguiCodaAlBot(adesso: Date = new Date()) {
    const configBase = leggiConfigCodaAlBot()
    if (!configBase.attivo) return { ok: true as const, spostati: 0, motivo: 'spento' as const }
    const extra = giroExtra(adesso)
    const config = extra ? { ...configBase, scaglione: LEAD_PER_GIRO_EXTRA, tettoFinestra: LEAD_PER_GIRO_EXTRA } : configBase
    const via = extra ? 'coda_marketing_extra' : 'coda_marketing'
    const finestra = extra ? { nome: 'extra_29_10', inizio: 0 } : finestraCodaAlBot(adesso)
    if (!finestra) return { ok: true as const, spostati: 0, motivo: 'fuori_finestra' as const }

    const [bot] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isBot, true), eq(users.isActive, true),
    )).limit(1)
    if (!bot) return { ok: false as const, error: 'account bot non trovato' }

    const righe = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        status: leads.status,
        callCount: leads.callCount,
        assignedToId: leads.assignedToId,
        appointmentDate: leads.appointmentDate,
        phoneSuspicious: leads.phoneSuspicious,
        // `"leads"."phone"` per esteso e NON `${leads.phone}`: in una select a
        // tabella singola Drizzle toglie la qualificazione e dentro la
        // sottoquery `"phone"` si risolverebbe su `al.phone` (sempre vero).
        // Stessa trappola del riscaldamento (bot-warmup) e di gestionePoolActions.
        toccatoDalBot: sql<boolean>`EXISTS (
            SELECT 1 FROM leads al
            JOIN "leadEvents" ae ON ae."leadId" = al.id
            WHERE al.phone = "leads"."phone"
              AND ae."eventType" IN ('BOT_PUSHED','REASSIGNED_FROM_BOT','BOT_CALL_ATTEMPT','BOT_NOTE','BOT_REPORT')
        )`,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        eq(leads.launchBucket, MARKETING_QUEUE_BUCKET),
        // Anche i vecchi (PO 29/10/2026): il ritmo li protegge, 60 al giorno
        // divisi sui 3 numeri delle aperture a freddo.
        eq(leads.isTest, false),
        isNull(leads.assignedToId),
        eq(leads.status, 'NEW'),
    ))
        // I più recenti per primi: il segnale del marketing è più fresco.
        .orderBy(sql`${leads.createdAt} DESC`, asc(leads.id))
        .limit(300)

    const candidati: CandidatoCoda[] = righe.map((r) => ({
        id: r.id,
        toccatoDalBot: Boolean(r.toccatoDalBot),
        status: r.status,
        callCount: r.callCount ?? 0,
        assignedToId: r.assignedToId,
        appointmentDate: r.appointmentDate,
        phoneSuspicious: Boolean(r.phoneSuspicious),
    }))

    // Quanti ne ha già spostati questa finestra: si contano gli eventi, non i
    // lead del bot (che arrivano anche dal webhook AC). Inizio finestra = oggi
    // alle `finestra.inizio` di Roma.
    const [{ n: giaNellaFinestra }] = await db.select({ n: sql<number>`COUNT(*)::int` }).from(leadEvents).where(and(
        eq(leadEvents.companyId, FENICE),
        eq(leadEvents.eventType, 'ASSIGNED'),
        sql`${leadEvents.metadata}->>'via' = ${via}`,
        extra
            ? sql`${leadEvents.timestamp} >= ${extra.toISOString()}::timestamptz`
            : sql`${leadEvents.timestamp} >= ((date_trunc('day', now() AT TIME ZONE 'Europe/Rome') + make_interval(hours => ${finestra.inizio}::int)) AT TIME ZONE 'Europe/Rome')`,
    ))

    const piano = pianificaCodaAlBot({ candidati, config, giaNellaFinestra })
    console.log(`[coda-marketing-bot] finestra=${finestra.nome} pescati=${righe.length} gia=${giaNellaFinestra}/${config.tettoFinestra} daSpostare=${piano.daSpostare.length} residui=${piano.residui} motivo=${piano.motivo}`)
    if (piano.daSpostare.length === 0) {
        return { ok: true as const, spostati: 0, residui: piano.residui, motivo: piano.motivo, finestra: finestra.nome, giaNellaFinestra }
    }

    const now = new Date()
    // Assegnazione ed evento insieme; il guardiano `assignedToId IS NULL` nel
    // WHERE fa sì che un lead preso a mano nel frattempo non venga rubato.
    const spostati = await db.transaction(async (tx) => {
        const aggiornati = await tx.update(leads)
            .set({
                assignedToId: bot.id,
                assignedAt: sql`COALESCE(${leads.assignedAt}, ${now})`,
                updatedAt: now,
                version: sql`${leads.version} + 1`,
            })
            .where(and(inArray(leads.id, piano.daSpostare), isNull(leads.assignedToId), eq(leads.status, 'NEW')))
            .returning({ id: leads.id })
        if (aggiornati.length) {
            await tx.insert(leadEvents).values(aggiornati.map(({ id }) => ({
                id: crypto.randomUUID(),
                leadId: id,
                eventType: 'ASSIGNED' as const,
                userId: bot.id,
                timestamp: now,
                metadata: { via, source: 'marketing', assignedToUser: bot.id, finestra: finestra.nome, motivo: 'PO 29/10/2026: coda marketing al bot, 10 a numero per finestra' },
                companyId: FENICE,
            })))
        }
        return aggiornati.map((a) => a.id)
    })

    // Il push fuori dalla transazione (chiamata di rete). Uno alla volta: lo
    // scaglione è piccolo, ben sotto i 30/min concordati col fornitore.
    const perId = new Map(righe.map((r) => [r.id, r]))
    let inviati = 0
    const falliti: string[] = []
    for (const id of spostati) {
        const r = perId.get(id)
        if (!r) continue
        try {
            const esito = await pushLeadToBot({
                leadId: r.id, name: r.name, phone: r.phone, email: r.email,
                funnel: funnelPerIlBot(r.funnel), companyId: FENICE,
                codaMarketing: true,
            })
            if (esito.result === 'sent' || esito.result === 'duplicate') inviati++
            else falliti.push(`${id}:${esito.result}`)
        } catch (e) {
            console.error(`[coda-marketing-bot] push fallito per ${id}:`, e)
            falliti.push(`${id}:exception`)
        }
    }

    return {
        ok: true as const, spostati: spostati.length, inviatiAlBot: inviati, falliti: falliti.length,
        dettaglioFalliti: falliti.slice(0, 10), residui: piano.residui, finestra: finestra.nome,
        giaNellaFinestra: giaNellaFinestra + spostati.length, tettoFinestra: config.tettoFinestra,
    }
}

export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return new NextResponse('Unauthorized', { status: 401 })
    }
    if (!secret) return NextResponse.json({ error: 'CRON_SECRET non impostata' }, { status: 500 })
    const esito = await eseguiCodaAlBot()
    return NextResponse.json(esito, { status: esito.ok ? 200 : 500 })
}
