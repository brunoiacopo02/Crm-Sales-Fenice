"use server"

// Monitor della scorta delle prime chiamate su /import (PO 29/10/2026), solo
// ADMIN: per ogni GDO della squadra quanti lead vede, quanti ne ha nella
// scorta, quanto consuma al giorno, quanti vergini riceve, quanti sblocchi e
// fra quanti giorni finisce la scorta. Regole in src/lib/diretta/scorta.ts,
// movimenti scritti da src/lib/diretta/scortaDb.ts.
//
// Comandi admin (PO 30/10/2026): per ogni GDO della squadra "Accendi scorta"
// (la stessa prima assegnazione dello script
// scripts/diretta/scorta-prima-assegnazione.ts, via accendiScorta), "Spegni
// scorta" (tutti i suoi lead tornano visibili) e "Sblocca 30 ora". Il ruolo
// ADMIN si verifica qui, lato server, a ogni comando; il GDO deve essere della
// squadra dell'azienda attiva. Tutto sotto il lock consultivo per GDO di scortaDb.

import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { isTeamMember } from "@/lib/diretta/config"
import { dayBoundsRome, toRomeDateStr } from "@/lib/dateUtils"
import { stimaGiorni } from "@/lib/diretta/scorta"
import { accendiScorta, movimentiDal, sbloccaManuale, spegniScorta } from "@/lib/diretta/scortaDb"

const GIORNI = 7

export type ScortaGdo = {
    id: string
    nome: string
    accesa: boolean
    visibili: number
    scorta: number
    consumoOggi: number
    /** Prime chiamate esitate negli ultimi 7 giorni, dal più vecchio a oggi. */
    consumoGiorni: number[]
    consumoMedio: number | null
    verginiOggi: number
    sblocchiOggi: number
    sblocchiSettimana: number
    giorniStimati: number | null
}

export type ScortaMonitor = {
    gdo: ScortaGdo[]
    /** Etichette dei 7 giorni (YYYY-MM-DD, giorno di Roma), dal più vecchio a oggi. */
    giorni: string[]
    lettoAlle: string
}

async function contestoAdmin() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== 'ADMIN') return null
    return ctx
}

/** GDO della squadra nell'azienda attiva: attivi, umani, con nome vero. */
async function squadraDi(companyId: string) {
    return (await db.select({
        id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, isTest: users.isTest,
        firstName: users.firstName, scortaAttiva: users.scortaAttiva,
    }).from(users).where(and(
        eq(users.role, 'GDO'),
        eq(users.isActive, true),
        or(
            sql`${companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, companyId)),
        ),
    ))).filter(u => isTeamMember({ ...u, isActive: !!u.isActive }))
}

/** Stato letto adesso. null = non ADMIN (la card non compare). */
export async function getScortaMonitor(): Promise<ScortaMonitor | null> {
    const ctx = await contestoAdmin()
    if (!ctx) return null

    const ora = new Date()
    const squadra = await squadraDi(ctx.companyId)

    const ids = squadra.map(u => u.id)
    if (ids.length === 0) return { gdo: [], giorni: [], lettoAlle: ora.toISOString() }

    // Prima chiamata come in getPipelineLeads: mai chiamati o con un "Ti ha
    // cercato" aperto, senza richiamo, né scartati né in appuntamento. Un
    // "Ti ha cercato" si vede sempre, anche se era in scorta.
    const cercato = sql`exists (select 1 from "botContactRequests" r where r."leadId" = ${leads.id} and r."status" <> 'closed')`
    const nascosto = sql`(${leads.scortaStato} = 'scorta' and not ${cercato})`
    const conteggi = await db.select({
        gdoId: leads.assignedToId,
        visibili: sql<number>`count(*) filter (where not ${nascosto})::int`,
        scorta: sql<number>`count(*) filter (where ${nascosto})::int`,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        inArray(leads.assignedToId, ids),
        eq(leads.isTest, false),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNull(leads.recallDate),
        or(eq(leads.callCount, 0), cercato),
    )).groupBy(leads.assignedToId)
    const perGdo = new Map(conteggi.map(c => [c.gdoId, c]))

    // Giorni di Roma, dal più vecchio a oggi.
    const giorni: string[] = []
    for (let i = GIORNI - 1; i >= 0; i--) giorni.push(toRomeDateStr(new Date(ora.getTime() - i * 86_400_000)))
    const oggi = giorni[giorni.length - 1]
    const dal = dayBoundsRome(new Date(ora.getTime() - (GIORNI - 1) * 86_400_000)).start
    const movimenti = await movimentiDal(ctx.companyId, ids, dal)

    type Giorno = { consumati: number; arrivi: number; vergini: number; sblocchi: number }
    const vuoto = (): Giorno => ({ consumati: 0, arrivi: 0, vergini: 0, sblocchi: 0 })
    const tabella = new Map<string, Map<string, Giorno>>()
    for (const m of movimenti) {
        const g = toRomeDateStr(m.createdAt)
        const perGiorno = tabella.get(m.userId) ?? new Map<string, Giorno>()
        tabella.set(m.userId, perGiorno)
        const d = perGiorno.get(g) ?? vuoto()
        perGiorno.set(g, d)
        if (m.tipo === 'consumato') d.consumati += m.quanti
        else if (m.tipo === 'vergini') { d.vergini += m.quanti; d.arrivi += m.quanti }
        else if (m.tipo === 'caldi' || m.tipo === 'nascosti') d.arrivi += m.quanti
        else if (m.tipo === 'sblocco' || m.tipo === 'sblocco_manuale') d.sblocchi += 1
    }

    const righe: ScortaGdo[] = squadra.map(u => {
        const c = perGdo.get(u.id)
        const perGiorno = tabella.get(u.id) ?? new Map<string, Giorno>()
        const serie = giorni.map(g => perGiorno.get(g) ?? vuoto())
        const lavorati = serie.filter(d => d.consumati > 0)
        const scorta = Number(c?.scorta ?? 0)
        const oggiD = perGiorno.get(oggi) ?? vuoto()
        return {
            id: u.id,
            nome: u.firstName!.trim(),
            accesa: !!u.scortaAttiva,
            visibili: Number(c?.visibili ?? 0),
            scorta,
            consumoOggi: oggiD.consumati,
            consumoGiorni: serie.map(d => d.consumati),
            consumoMedio: lavorati.length ? lavorati.reduce((s, d) => s + d.consumati, 0) / lavorati.length : null,
            verginiOggi: oggiD.vergini,
            sblocchiOggi: oggiD.sblocchi,
            sblocchiSettimana: serie.reduce((s, d) => s + d.sblocchi, 0),
            giorniStimati: u.scortaAttiva ? stimaGiorni(scorta, serie) : null,
        }
    }).sort((a, b) => Number(b.accesa) - Number(a.accesa) || a.nome.localeCompare(b.nome, 'it'))

    return { gdo: righe, giorni, lettoAlle: ora.toISOString() }
}

export type ComandoScorta = 'accendi' | 'spegni' | 'sblocca'
export type EsitoComandoScorta = { ok: true; messaggio: string } | { ok: false; errore: string }

/**
 * Comando admin sulla scorta di un GDO: accendi (prima assegnazione: sempre
 * visibili + i migliori 40, il resto in scorta), spegni (tutto torna visibile)
 * o sblocca 30 adesso. Solo ADMIN, solo GDO della squadra dell'azienda attiva.
 */
export async function comandoScorta(gdoId: string, comando: ComandoScorta): Promise<EsitoComandoScorta> {
    const ctx = await contestoAdmin()
    if (!ctx) return { ok: false, errore: "Solo un admin può farlo." }
    if (comando !== 'accendi' && comando !== 'spegni' && comando !== 'sblocca') return { ok: false, errore: "Comando sconosciuto." }
    const gdo = (await squadraDi(ctx.companyId)).find(u => u.id === gdoId)
    if (!gdo) return { ok: false, errore: "GDO non trovato nella squadra." }
    const nome = gdo.firstName!.trim()
    const ora = new Date()

    try {
        if (comando === 'accendi') {
            const r = await accendiScorta(ctx.companyId, gdo.id, ora, undefined, { soloSeSpenta: true })
            if (!r) return { ok: false, errore: `La scorta di ${nome} è già accesa.` }
            return { ok: true, messaggio: `Scorta accesa per ${nome}: ${r.visibili.length} lead visibili, ${r.scorta.length} nella scorta.` }
        }
        if (comando === 'spegni') {
            const n = await spegniScorta(ctx.companyId, gdo.id, ora)
            return { ok: true, messaggio: `Scorta spenta per ${nome}: ${n} lead tornati come prima, vede tutta la prima chiamata.` }
        }
        const ids = await sbloccaManuale(ctx.companyId, gdo.id, ora)
        if (ids.length === 0) return { ok: false, errore: `Niente da sbloccare per ${nome}: scorta spenta o vuota.` }
        return { ok: true, messaggio: `Sbloccati ${ids.length} lead per ${nome}.` }
    } catch (e) {
        console.error('[scorta] comando admin', comando, e)
        return { ok: false, errore: "Comando non riuscito. Riprova." }
    }
}
