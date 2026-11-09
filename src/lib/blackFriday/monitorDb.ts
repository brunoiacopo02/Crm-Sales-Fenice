// Letture della pagina /admin/diretta/black-friday (PO 09/11/2026).
// Non è un file "use server": non controlla il ruolo, lo fa la pagina.
//
// Costo: 7 query aggregate o su poche decine di righe (i lead BF, i loro eventi
// e chiamate), nessun N+1. Il risultato sta in una cache di 45 secondi
// condivisa fra chi guarda: con la pagina aperta su più schede o persone il
// database vede al massimo una lettura ogni 45 secondi.

import { unstable_cache } from 'next/cache'
import { and, eq, exists, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { callLogs, leadEvents, leads, users } from '@/db/schema'
import { dayBoundsRome } from '@/lib/dateUtils'
import { leadVero } from '@/lib/prova/sql'
import { BF_FUNNEL, calcolaMonitorBf, type MonitorBf } from './monitor'

const FENICE = 'fenice'
/** Partenza dell'offerta: sabato 7/11/2026 00:00 di Roma. */
export const INIZIO_BF = new Date('2026-11-06T23:00:00Z')
export const CACHE_SECONDI = 45
export const TAG_MONITOR_BF = 'monitor-black-friday'

function nomeGdo(u: { firstName: string | null; name: string | null; gdoCode: number | null }): string {
    return u.firstName?.trim() || u.name?.trim() || (u.gdoCode ? `GDO ${u.gdoCode}` : 'Senza nome')
}

async function leggi(): Promise<MonitorBf> {
    const adesso = new Date()
    const oggi = dayBoundsRome(adesso)
    const leadBf = and(eq(leads.companyId, FENICE), eq(leads.funnel, BF_FUNNEL), gte(leads.createdAt, INIZIO_BF), leadVero())
    const idBf = db.select({ id: leads.id }).from(leads).where(leadBf)

    // I GDO prima: servono gli id per leggere le chiamate di oggi sull'indice (userId, createdAt).
    const gdo = await db.select({
        id: users.id, gdoCode: users.gdoCode, firstName: users.firstName, name: users.name,
        isActive: users.isActive, isBot: users.isBot,
    })
        .from(users)
        .where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isTest, false), isNotNull(users.gdoCode)))
    const idGdo = gdo.map(g => g.id)

    const [righeLead, eventi, chiamate, carichi, attivita, funnelBot] = await Promise.all([
        db.select({
            id: leads.id, createdAt: leads.createdAt, utmSource: leads.utmSource, status: leads.status,
            assignedToId: leads.assignedToId, appointmentDate: leads.appointmentDate,
            confirmationsOutcome: leads.confirmationsOutcome, confirmationsDiscardReason: leads.confirmationsDiscardReason,
            presentedAt: leads.presentedAt, salespersonOutcome: leads.salespersonOutcome,
            closeAmountEur: leads.closeAmountEur, closeProduct: leads.closeProduct,
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

        // Lead entrati dal 7/11 e passati dal bot, per funnel.
        db.select({
            funnel: sql<string>`coalesce(${leads.funnel}, 'SENZA FUNNEL')`,
            lead: sql<number>`count(*)::int`,
            appuntamenti: sql<number>`count(*) filter (where ${leads.appointmentDate} is not null or ${leads.status} = 'APPOINTMENT')::int`,
            etaMediaOre: sql<number>`coalesce(avg(extract(epoch from (${adesso}::timestamptz - ${leads.createdAt}))) / 3600, 0)::float8`,
        })
            .from(leads)
            .where(and(
                eq(leads.companyId, FENICE), gte(leads.createdAt, INIZIO_BF), leadVero(),
                exists(db.select({ x: sql`1` }).from(leadEvents).where(and(eq(leadEvents.leadId, leads.id), eq(leadEvents.eventType, 'BOT_PUSHED')))),
            ))
            .groupBy(sql`coalesce(${leads.funnel}, 'SENZA FUNNEL')`),
    ])

    return calcolaMonitorBf({
        adesso,
        inizio: INIZIO_BF,
        leads: righeLead,
        eventi: eventi.map(e => ({ ...e, manuale: Boolean(e.manuale) })),
        chiamate,
        gdo: gdo.map(g => ({ id: g.id, codice: g.gdoCode, nome: nomeGdo(g), attivo: g.isActive, bot: g.isBot })),
        carichi: carichi.flatMap(c => (c.userId ? [{ ...c, userId: c.userId }] : [])),
        attivita: attivita.flatMap(a => (a.userId ? [{ ...a, userId: a.userId }] : [])),
        funnelBot: funnelBot.map(f => ({ ...f, etaMediaOre: Number(f.etaMediaOre) })),
    })
}

const inCache = unstable_cache(leggi, ['monitor-black-friday-v1'], { revalidate: CACHE_SECONDI, tags: [TAG_MONITOR_BF] })

/** Numeri del monitor, in cache 45 secondi. null se la lettura non riesce. */
export async function leggiMonitorBf(): Promise<MonitorBf | null> {
    try {
        return await inCache()
    } catch (e) {
        console.error('[monitor black friday] lettura', e)
        return null
    }
}
