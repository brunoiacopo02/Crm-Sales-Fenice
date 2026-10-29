import { NextResponse } from 'next/server'
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import crypto from 'node:crypto'
import { db } from '@/db'
import { leads, users, leadEvents } from '@/db/schema'
import { pushLeadToBot } from '@/lib/bot-fissatore/push'
import { MARKETING_QUEUE_BUCKET } from '@/lib/marketingQueue/applica'
import { leggiConfigCodaAlBot, pianificaCodaAlBot, funnelPerIlBot, type CandidatoCoda } from '@/lib/marketingQueue/alBot'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FENICE = 'fenice'

/** Solo i lead della coda arrivati da qui in poi (mezzanotte di Roma del 29/10/2026). */
const CODA_AL_BOT_DAL = new Date('2026-10-28T23:00:00Z')

/**
 * Coda marketing al bot (PO 29/10/2026): uno scaglione all'ora dei lead MKT_CODA
 * senza assegnatario passa al bot, come un lead di ActiveCampaign. Da lì vale
 * il giro di sempre: timer 96h, restituzione ai GDO, parcheggio dei mai risposto.
 *
 * Interruttore `MKT_CODA_BOT` (acceso se assente, `off` lo spegne),
 * scaglione `MKT_CODA_BOT_BATCH` (5), tetto al giorno `MKT_CODA_BOT_DAILY` (30).
 * Le regole stanno in src/lib/marketingQueue/alBot.ts.
 */
export async function eseguiCodaAlBot() {
    const config = leggiConfigCodaAlBot()
    if (!config.attivo) return { ok: true as const, spostati: 0, motivo: 'spento' as const }

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
        // STOP sui vecchi (29/10/2026, sessione qualita' numeri): il 3199 e' di
        // nuovo LOW per troppe aperture a freddo. Entrano solo i lead arrivati
        // dalla coda da oggi in poi; i ~154 vecchi restano nel pool finche'
        // Bruno non decide (lotti da 30/g con numeri HIGH, oppure ai GDO).
        gte(leads.createdAt, CODA_AL_BOT_DAL),
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

    // Quanti ne ha già spostati oggi questo giro: si contano gli eventi, non i
    // lead del bot (che arrivano anche dal webhook AC).
    const [{ n: giaOggi }] = await db.select({ n: sql<number>`COUNT(*)::int` }).from(leadEvents).where(and(
        eq(leadEvents.companyId, FENICE),
        eq(leadEvents.eventType, 'ASSIGNED'),
        sql`${leadEvents.metadata}->>'via' = 'coda_marketing'`,
        sql`${leadEvents.timestamp} >= (date_trunc('day', now() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome')`,
    ))

    const piano = pianificaCodaAlBot({ candidati, config, giaOggi })
    console.log(`[coda-marketing-bot] pescati=${righe.length} giaOggi=${giaOggi}/${config.tettoGiornaliero} daSpostare=${piano.daSpostare.length} residui=${piano.residui} motivo=${piano.motivo}`)
    if (piano.daSpostare.length === 0) {
        return { ok: true as const, spostati: 0, residui: piano.residui, motivo: piano.motivo, giaOggi }
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
                metadata: { via: 'coda_marketing', source: 'marketing', assignedToUser: bot.id, motivo: 'PO 29/10/2026: coda marketing al bot come i lead AC' },
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
        dettaglioFalliti: falliti.slice(0, 10), residui: piano.residui, giaOggi: giaOggi + spostati.length,
        tettoGiornaliero: config.tettoGiornaliero,
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
