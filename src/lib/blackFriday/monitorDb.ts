// Letture della pagina /admin/diretta/black-friday (PO 09/11/2026).
// Non è un file "use server": non controlla il ruolo, lo fa la pagina.
//
// Costo: query aggregate o su poche decine/centinaia di righe (i lead BF, i loro
// eventi e chiamate, gli stadi degli altri funnel dal 7/11), nessun N+1, più una
// chiamata al bot (`/api/bot/statistiche-bf`, firma HMAC come il push, timeout
// breve). Il risultato sta in una cache di 45 secondi condivisa fra chi guarda:
// con la pagina aperta su più schede o persone il database e il bot vedono al
// massimo una lettura ogni 45 secondi. Se il bot non risponde, `bot` è null e la
// pagina resta in piedi coi dati del CRM.

import { unstable_cache } from 'next/cache'
import { and, eq, exists, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { callLogs, leadEvents, leads, users } from '@/db/schema'
import { dayBoundsRome } from '@/lib/dateUtils'
import { leadVero } from '@/lib/prova/sql'
import { contaNeiKpiSql } from '@/lib/intakeBatch'
import { readGamificationTargets } from '@/lib/diretta/settings'
import { signPayload } from '@/lib/marketing-webhooks/signing'
import {
    BF_FUNNEL, CAMBIO_FUNNEL_BF, EVENTO_BF_CONVERTITO, attribuisciChiusureAltrove, calcolaMonitorBf, chiavePersona, ingressoBf, personeGiaNelCrm, stadiSm,
    type AltriFunnelSm, type BotFunnelChat, type BotLeadBf, type DatiBotBf, type MonitorBf,
} from './monitor'

const FENICE = 'fenice'
/** Partenza dell'offerta: sabato 7/11/2026 00:00 di Roma. */
export const INIZIO_BF = new Date('2026-11-06T23:00:00Z')
export const CACHE_SECONDI = 45
export const TAG_MONITOR_BF = 'monitor-black-friday'
/** Il bot deve rispondere in fretta: la pagina non aspetta oltre. */
export const TIMEOUT_BOT_MS = 6000

function nomeGdo(u: { firstName: string | null; name: string | null; gdoCode: number | null }): string {
    return u.firstName?.trim() || u.name?.trim() || (u.gdoCode ? `GDO ${u.gdoCode}` : 'Senza nome')
}

type RispostaBot = {
    ok?: boolean
    letto_alle?: string
    leads?: {
        crm_lead_id: string; conversation_id: number | null; chat_nuova: boolean | null; con_chat: boolean
        consegnato: boolean; risposto: boolean; wa_number: string | null; mario_braccio: string | null; bot_outcome: string | null
    }[]
    riepilogo?: { funnel?: { funnel: string; chat: number; risposto: number; appuntamenti: number; eta_media_ore: number | null }[] }
}

/**
 * Stato delle chat dei lead BF e riepilogo per funnel, dal bot. null = non
 * leggibile (env mancanti, bot giù, timeout, risposta strana). Mai lancia.
 * Il telefono va al bot solo come ripiego per trovare la chat (il bot lo ha già).
 */
export async function leggiDatiBot(
    lead: { id: string; createdAt: Date; phone: string }[],
    timeoutMs: number = TIMEOUT_BOT_MS,
): Promise<DatiBotBf | null> {
    const intake = process.env.BOT_INTAKE_URL
    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!intake || !secret) return null
    let url: string
    try { url = new URL('/api/bot/statistiche-bf', intake).toString() } catch { return null }
    const body = JSON.stringify({
        ts: new Date().toISOString(),
        dal: INIZIO_BF.toISOString(),
        // `ingresso` = data di ingresso BF (la conversione per chi è diventato BF dopo).
        leads: lead.map(l => ({ id: l.id, ingresso: l.createdAt.toISOString(), telefono: l.phone })),
    })
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-bot-signature': signPayload(body, secret) },
            body,
            cache: 'no-store',
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) {
            console.error(`[monitor black friday] bot HTTP ${res.status}`)
            return null
        }
        const j = (await res.json()) as RispostaBot
        if (!j.ok || !Array.isArray(j.leads) || !Array.isArray(j.riepilogo?.funnel)) return null
        const leadsBot: BotLeadBf[] = j.leads.map(l => ({
            leadId: l.crm_lead_id, conversationId: l.conversation_id, chatNuova: l.chat_nuova, conChat: l.con_chat,
            consegnato: l.consegnato, risposto: l.risposto, waNumber: l.wa_number, braccio: l.mario_braccio, esitoBot: l.bot_outcome,
        }))
        const funnel: BotFunnelChat[] = j.riepilogo!.funnel!.map(f => ({
            funnel: f.funnel, chat: f.chat, risposto: f.risposto, appuntamenti: f.appuntamenti, etaMediaOre: f.eta_media_ore,
        }))
        return { lettoAlle: j.letto_alle ?? new Date().toISOString(), leads: leadsBot, funnel }
    } catch (e) {
        console.error('[monitor black friday] bot non raggiungibile', e)
        return null
    }
}

/**
 * Gli altri funnel (non BF) nello stesso periodo, con le regole del Sales
 * Manager (panoramicaActions): lead = COALESCE(assignedAt, createdAt) nel
 * periodo, lead dei pool solo se assegnati, contaNeiKpiSql, funnel non TEST né
 * vuoto (getLeadSplitByFunnel / leadOverviewForCompany); stadi = stageHits sui
 * lead con almeno una data di stadio nel periodo (getCrmFunnelCounts).
 * Torna una funzione: `chiusureAlBf` = schede la cui chiusura è contata nel
 * Black Friday (vendite per persona, PO 12/11/2026), che qui non si conta due volte.
 */
async function leggiAltriFunnel(inizio: Date, adesso: Date): Promise<(chiusureAlBf: Set<string>) => AltriFunnelSm> {
    const nonBf = and(
        sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('TEST', '')`,
        sql`UPPER(COALESCE(${leads.funnel}, '')) <> ${BF_FUNNEL}`,
    )
    const [conteggio, righe] = await Promise.all([
        db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(
            eq(leads.companyId, FENICE), leadVero(), nonBf,
            sql`COALESCE(${leads.assignedAt}, ${leads.createdAt}) >= ${inizio}`,
            sql`COALESCE(${leads.assignedAt}, ${leads.createdAt}) < ${adesso}`,
            or(isNull(leads.launchBucket), isNotNull(leads.assignedToId)),
            contaNeiKpiSql(),
        )),
        db.select({
            id: leads.id,
            appointmentDate: leads.appointmentDate, appointmentCreatedAt: leads.appointmentCreatedAt,
            confirmationsOutcome: leads.confirmationsOutcome, confirmationsTimestamp: leads.confirmationsTimestamp,
            salespersonOutcome: leads.salespersonOutcome, salespersonOutcomeAt: leads.salespersonOutcomeAt,
            presentedAt: leads.presentedAt, closeAmountEur: leads.closeAmountEur,
        }).from(leads).where(and(
            eq(leads.companyId, FENICE), leadVero(), nonBf,
            or(
                gte(leads.appointmentCreatedAt, inizio),
                gte(leads.appointmentDate, inizio),
                gte(leads.confirmationsTimestamp, inizio),
                gte(leads.salespersonOutcomeAt, inizio),
                gte(leads.presentedAt, inizio),
            ),
        )),
    ])
    return chiusureAlBf => ({
        lead: Number(conteggio[0]?.c ?? 0),
        stadi: stadiSm(righe.map(r => (chiusureAlBf.has(r.id) ? { ...r, salespersonOutcome: null } : r)), inizio, adesso),
    })
}

/**
 * Prima conversione a BLACK FRIDAY del lead dal 7/11 (null se mai convertito):
 * BF_CONVERTITO di /api/admin/bf-converti o AC_UPDATED del webhook AC con
 * 'funnel → BLACK FRIDAY' nei changes (vedi eConversioneBf in monitor.ts).
 * Nomi qualificati a mano: nella lista del SELECT drizzle scrive le colonne
 * senza tabella e `"leadId" = "id"` finirebbe tutto dentro leadEvents.
 */
const conversioneBfAt = sql<string | Date | null>`(
    select min(ce."timestamp") from "leadEvents" ce
    where ce."leadId" = "leads"."id"
      and ce."timestamp" >= ${INIZIO_BF}
      and (ce."eventType" = ${EVENTO_BF_CONVERTITO}
        or (ce."eventType" = 'AC_UPDATED' and ce."metadata"->'changes' @> ${JSON.stringify([CAMBIO_FUNNEL_BF])}::jsonb))
)`

const comeData = (v: string | Date | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v))

/** Chiave persona in SQL: stessa espressione dell'indice leads_company_phonekey_idx. */
const chiavePersonaSql = sql<string>`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10)`

/**
 * Le schede delle persone dei lead BF (stesse ultime 10 cifre), per "già nel CRM
 * prima dell'iscrizione" (PO 14/11/2026). Passa dall'indice leads_company_phonekey_idx:
 * qualche centinaio di chiavi, nessuna scansione dei telefoni.
 */
async function leggiSchedePersone(persone: string[]): Promise<{ leadId: string; persona: string | null; createdAt: Date }[]> {
    if (persone.length === 0) return []
    const righe = await db.select({ id: leads.id, phone: leads.phone, createdAt: leads.createdAt })
        .from(leads)
        .where(and(eq(leads.companyId, FENICE), leadVero(), inArray(chiavePersonaSql, persone)))
    return righe.map(r => ({ leadId: r.id, persona: chiavePersona(r.phone), createdAt: r.createdAt }))
}

async function leggi(): Promise<MonitorBf> {
    const adesso = new Date()
    const oggi = dayBoundsRome(adesso)
    // Perimetro (PO 09/11/2026): funnel BF e (nato dal 7/11 oppure diventato BF dal 7/11).
    const leadBf = and(
        eq(leads.companyId, FENICE), eq(leads.funnel, BF_FUNNEL), leadVero(),
        or(gte(leads.createdAt, INIZIO_BF), sql`${conversioneBfAt} is not null`),
    )
    const idBf = db.select({ id: leads.id }).from(leads).where(leadBf)

    // I GDO prima: servono gli id per leggere le chiamate di oggi sull'indice (userId, createdAt).
    const gdo = await db.select({
        id: users.id, gdoCode: users.gdoCode, firstName: users.firstName, name: users.name,
        isActive: users.isActive, isBot: users.isBot,
    })
        .from(users)
        .where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isTest, false), isNotNull(users.gdoCode)))
    const idGdo = gdo.map(g => g.id)

    const [righeLead, eventi, chiamate, carichi, attivita, funnelBot, turni, altriFunnel, chiusiDal] = await Promise.all([
        db.select({
            id: leads.id, createdAt: leads.createdAt, utmSource: leads.utmSource, utmMedium: leads.utmMedium, status: leads.status,
            assignedToId: leads.assignedToId, appointmentDate: leads.appointmentDate,
            confirmationsOutcome: leads.confirmationsOutcome, confirmationsDiscardReason: leads.confirmationsDiscardReason,
            presentedAt: leads.presentedAt, salespersonOutcome: leads.salespersonOutcome,
            closeAmountEur: leads.closeAmountEur, closeProduct: leads.closeProduct,
            appointmentCreatedAt: leads.appointmentCreatedAt, confirmationsTimestamp: leads.confirmationsTimestamp,
            salespersonOutcomeAt: leads.salespersonOutcomeAt, phone: leads.phone,
            convertitoAt: conversioneBfAt,
        }).from(leads).where(leadBf),

        db.select({
            leadId: leadEvents.leadId, eventType: leadEvents.eventType, at: leadEvents.timestamp,
            reason: sql<string | null>`${leadEvents.metadata}->>'reason'`,
            manuale: sql<boolean>`(${leadEvents.metadata}->>'motivo') is not null`,
        })
            .from(leadEvents)
            .where(and(inArray(leadEvents.leadId, idBf), eq(leadEvents.eventType, 'REASSIGNED_FROM_BOT'))),

        db.select({ leadId: callLogs.leadId, userId: callLogs.userId, outcome: callLogs.outcome, at: callLogs.createdAt })
            .from(callLogs)
            .where(inArray(callLogs.leadId, idBf)),

        // Lead aperti di ogni GDO, su tutti i funnel (indice assignedToId, status).
        idGdo.length === 0 ? Promise.resolve([]) : db.select({
            userId: leads.assignedToId,
            aperti: sql<number>`count(*)::int`,
            maiChiamati: sql<number>`count(*) filter (where ${leads.callCount} = 0)::int`,
            richiamiOggi: sql<number>`count(*) filter (where ${leads.recallDate} >= ${oggi.start} and ${leads.recallDate} < ${oggi.end})::int`,
            richiamiScaduti: sql<number>`count(*) filter (where ${leads.recallDate} >= ${oggi.start} and ${leads.recallDate} < ${adesso})::int`,
        })
            .from(leads)
            .where(and(inArray(leads.assignedToId, idGdo), inArray(leads.status, ['NEW', 'IN_PROGRESS']), leadVero()))
            .groupBy(leads.assignedToId),

        idGdo.length === 0 ? Promise.resolve([]) : db.select({
            userId: callLogs.userId,
            chiamate: sql<number>`count(*)::int`,
            appuntamenti: sql<number>`count(*) filter (where ${callLogs.outcome} = 'APPUNTAMENTO')::int`,
        })
            .from(callLogs)
            .where(and(inArray(callLogs.userId, idGdo), gte(callLogs.createdAt, oggi.start)))
            .groupBy(callLogs.userId),

        // Lead entrati dal 7/11 e passati dal bot, per funnel (ripiego se il bot non risponde).
        db.select({
            funnel: sql<string>`coalesce(${leads.funnel}, 'SENZA FUNNEL')`,
            lead: sql<number>`count(*)::int`,
            appuntamenti: sql<number>`count(*) filter (where ${leads.appointmentDate} is not null or ${leads.status} = 'APPOINTMENT')::int`,
            etaMediaOre: sql<number>`coalesce(avg(extract(epoch from (${adesso}::timestamptz - greatest(${leads.createdAt}, coalesce(${conversioneBfAt}, ${leads.createdAt}))))) / 3600, 0)::float8`,
        })
            .from(leads)
            .where(and(
                eq(leads.companyId, FENICE), leadVero(),
                or(gte(leads.createdAt, INIZIO_BF), and(eq(leads.funnel, BF_FUNNEL), sql`${conversioneBfAt} is not null`)),
                exists(db.select({ x: sql`1` }).from(leadEvents).where(and(eq(leadEvents.leadId, leads.id), eq(leadEvents.eventType, 'BOT_PUSHED')))),
            ))
            .groupBy(sql`coalesce(${leads.funnel}, 'SENZA FUNNEL')`),

        readGamificationTargets(),

        leggiAltriFunnel(INIZIO_BF, adesso).catch(e => {
            console.error('[monitor black friday] altri funnel', e)
            return null
        }),

        // Vendite per persona (PO 12/11/2026): tutte le chiusure dal 7/11, poche decine
        // di righe. Il confronto dei telefoni si fa dopo, in memoria, sulle ultime 10
        // cifre: nessuna regexp sui telefoni in SQL (già andata in timeout altrove).
        db.select({
            id: leads.id, phone: leads.phone, at: leads.salespersonOutcomeAt,
            closeAmountEur: leads.closeAmountEur, closeProduct: leads.closeProduct,
        }).from(leads).where(and(
            eq(leads.companyId, FENICE), leadVero(),
            eq(leads.salespersonOutcome, 'Chiuso'), gte(leads.salespersonOutcomeAt, INIZIO_BF),
        )),
    ])

    // Data di ingresso BF: la conversione per chi è diventato BF dopo (ingressoBf).
    // Il filtro SQL garantisce che ogni riga sia nel perimetro; il ripiego su
    // createdAt copre solo una riga sfuggita fra le due letture.
    const leadIn = righeLead.map(l => ({
        ...l, createdAt: ingressoBf(l.createdAt, comeData(l.convertitoAt), INIZIO_BF) ?? l.createdAt,
    }))
    const personeBf = [...new Set(righeLead.map(l => chiavePersona(l.phone)).filter((p): p is string => !!p))]
    const [bot, schedePersone] = await Promise.all([
        leggiDatiBot(leadIn),
        // Se non riesce, la riga "già nel CRM" resta a zero ma la pagina sta in piedi.
        leggiSchedePersone(personeBf).catch(e => {
            console.error('[monitor black friday] schede delle persone', e)
            return null
        }),
    ])
    const giaNelCrm = schedePersone
        ? personeGiaNelCrm(
            righeLead.map((l, i) => ({ id: l.id, createdAt: leadIn[i].createdAt, natoAt: l.createdAt, persona: chiavePersona(l.phone) })),
            schedePersone,
        )
        : new Set<string>()

    // Il telefono serve solo al bot per trovare la chat e, ridotto a chiave persona,
    // ad agganciare le chiusure su altre schede: non entra nella cache della pagina.
    const leadsBf = leadIn.map(l => ({
        id: l.id, createdAt: l.createdAt, utmSource: l.utmSource, utmMedium: l.utmMedium, status: l.status, assignedToId: l.assignedToId,
        appointmentDate: l.appointmentDate, confirmationsOutcome: l.confirmationsOutcome,
        confirmationsDiscardReason: l.confirmationsDiscardReason, presentedAt: l.presentedAt,
        salespersonOutcome: l.salespersonOutcome, closeAmountEur: l.closeAmountEur, closeProduct: l.closeProduct,
        appointmentCreatedAt: l.appointmentCreatedAt, confirmationsTimestamp: l.confirmationsTimestamp,
        salespersonOutcomeAt: l.salespersonOutcomeAt, persona: chiavePersona(l.phone), giaNelCrm: giaNelCrm.has(l.id),
    }))
    const chiusureAltrove = chiusiDal.flatMap(c => (c.at ? [{
        leadId: c.id, persona: chiavePersona(c.phone), at: c.at, closeAmountEur: c.closeAmountEur, closeProduct: c.closeProduct,
    }] : []))
    // Le chiusure passate al Black Friday escono dagli altri funnel: una vendita, un posto solo.
    const alBf = new Set(attribuisciChiusureAltrove(leadsBf, chiusureAltrove).attribuite.map(a => a.leadChiusuraId))

    return calcolaMonitorBf({
        adesso,
        inizio: INIZIO_BF,
        leads: leadsBf,
        chiusureAltrove,
        eventi: eventi.map(e => ({ ...e, manuale: Boolean(e.manuale) })),
        chiamate,
        gdo: gdo.map(g => ({ id: g.id, codice: g.gdoCode, nome: nomeGdo(g), attivo: g.isActive, bot: g.isBot })),
        carichi: carichi.flatMap(c => (c.userId ? [{ ...c, userId: c.userId }] : [])),
        attivita: attivita.flatMap(a => (a.userId ? [{ ...a, userId: a.userId }] : [])),
        funnelBot: funnelBot.map(f => ({ ...f, etaMediaOre: Number(f.etaMediaOre) })),
        bot,
        turni,
        altriSm: altriFunnel ? altriFunnel(alBf) : null,
    })
}

const inCache = unstable_cache(leggi, ['monitor-black-friday-v4'], { revalidate: CACHE_SECONDI, tags: [TAG_MONITOR_BF] })

/** Numeri del monitor, in cache 45 secondi. null se la lettura non riesce. */
export async function leggiMonitorBf(): Promise<MonitorBf | null> {
    try {
        return await inCache()
    } catch (e) {
        console.error('[monitor black friday] lettura', e)
        return null
    }
}
