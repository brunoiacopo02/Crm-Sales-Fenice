"use server"

// Lead accantonati su /import (PO 25/10/2026): i ridati messi da parte senza
// GDO (RIDATO_PARCHEGGIATO) che l'admin assegna a mano, N alla volta, a un GDO
// della squadra. Le regole sono in src/lib/diretta/accantonati.ts.
//
// Lo stato si legge sempre al momento: il pool può cambiare mentre la pagina è
// aperta (script e giri del bot), quindi l'assegnazione ripesca i lead sotto
// lock con lo stesso predicato e prende solo quelli ancora accantonati.
//
// Assegnazione come gli altri pool di /import: assignedToId, assignedAt con
// COALESCE (la prima presa in carico non si riscrive, regola 0027), stato,
// tentativi e storico invariati, evento ASSIGNED. Nessun webhook al marketing,
// nessuna chiamata al bot.

import { db } from "@/db"
import { leads, leadEvents } from "@/db/schema"
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import crypto from "crypto"
import { revalidatePath } from "next/cache"
import { currentTenant, assertSalesArea, assertSingleCompany } from "@/lib/tenancy"
import { contaNeiKpiSql } from "@/lib/intakeBatch"
import { gdoAssegnabili, type GdoAssegnabile } from "@/lib/diretta/gdoAssegnabili"
import { EVENTO_RIDATO_PARCHEGGIATO } from "@/lib/bot-fissatore/iaVocale"
import { LANCIO_BUCKET, LANCIO_FUNNEL } from "@/lib/lancio/intake"
import { MAX_ACCANTONATI_PER_VOLTA, quantiDaAssegnare, raggruppaMotivi } from "@/lib/diretta/accantonati"

/** Quanti dei più recenti si mostrano nella card. */
const QUANTI_IN_ELENCO = 10

export type GdoPerAccantonati = GdoAssegnabile

export type AccantonatiStato = {
    totale: number
    perMotivo: Array<{ etichetta: string; n: number }>
    recenti: Array<{ id: string; nome: string; ridatoIl: string | null; tentativi: number; motivo: string }>
    gdo: GdoPerAccantonati[]
    maxPerVolta: number
}

export type AccantonatiEsito = {
    ok: boolean
    errore?: string
    assegnati: number
    nomeGdo?: string
}

/** Predicato "accantonato", uguale in lettura e sotto lock. */
function accantonato(companyId: string) {
    return and(
        eq(leads.companyId, companyId),
        isNull(leads.assignedToId),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.appointmentDate),
        isNull(leads.presentedAt),
        isNull(leads.reservedSalespersonId),
        // Il lancio è stato tolto ai GDO il 24/10 (eLeadDelLancio).
        or(isNull(leads.launchBucket), ne(leads.launchBucket, LANCIO_BUCKET)),
        or(isNull(leads.funnel), ne(leads.funnel, LANCIO_FUNNEL)),
        isNull(leads.lancioPool),
        isNull(leads.humanTestCohort),
        contaNeiKpiSql(),
        sql`exists (select 1 from "leadEvents" e where e."leadId" = ${leads.id} and e."eventType" = ${EVENTO_RIDATO_PARCHEGGIATO})`,
        // "Ti ha cercato" aperto: la richiesta si smista dalla sua coda.
        sql`not exists (select 1 from "botContactRequests" r where r."leadId" = ${leads.id} and r."status" <> 'closed')`,
    )
}

/** Ultima volta che il lead è tornato indietro (dal bot o accantonato): i più recenti in cima. */
const ridatoIl = sql<Date | string | null>`coalesce(
    (select max(e."timestamp") from "leadEvents" e where e."leadId" = ${leads.id} and e."eventType" = 'REASSIGNED_FROM_BOT'),
    (select max(e."timestamp") from "leadEvents" e where e."leadId" = ${leads.id} and e."eventType" = ${EVENTO_RIDATO_PARCHEGGIATO})
)`

/** Motivo dell'ultimo accantonamento. */
const ultimoMotivo = sql<string | null>`(
    select e."metadata"->>'motivo' from "leadEvents" e
    where e."leadId" = ${leads.id} and e."eventType" = ${EVENTO_RIDATO_PARCHEGGIATO}
    order by e."timestamp" desc limit 1
)`

async function contestoAdmin() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== 'ADMIN') return null
    return ctx
}

const iso = (v: Date | string | null): string | null => {
    if (!v) return null
    const d = v instanceof Date ? v : new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Stato del pool letto adesso. null = non ADMIN (la card non compare). */
export async function getAccantonatiStato(): Promise<AccantonatiStato | null> {
    const ctx = await contestoAdmin()
    if (!ctx) return null

    const [motivi, recenti, gdo] = await Promise.all([
        db.select({ motivo: ultimoMotivo, n: sql<number>`count(*)::int` })
            .from(leads).where(accantonato(ctx.companyId)).groupBy(sql`1`),
        db.select({
            id: leads.id, nome: leads.name, tentativi: leads.callCount, ridatoIl, motivo: ultimoMotivo,
        }).from(leads).where(accantonato(ctx.companyId))
            .orderBy(sql`${ridatoIl} desc nulls last`, desc(leads.id))
            .limit(QUANTI_IN_ELENCO),
        gdoAssegnabili(ctx.companyId),
    ])

    const perMotivo = raggruppaMotivi(motivi.map(m => ({ motivo: m.motivo, n: Number(m.n) || 0 })))
    return {
        totale: perMotivo.reduce((s, m) => s + m.n, 0),
        perMotivo,
        recenti: recenti.map(r => ({
            id: r.id,
            nome: r.nome?.trim() || 'Senza nome',
            ridatoIl: iso(r.ridatoIl),
            tentativi: r.tentativi ?? 0,
            motivo: raggruppaMotivi([{ motivo: r.motivo, n: 1 }])[0]?.etichetta ?? 'Altro',
        })),
        gdo,
        maxPerVolta: MAX_ACCANTONATI_PER_VOLTA,
    }
}

/** Assegna al GDO scelto gli N accantonati ridati più di recente. */
export async function assegnaAccantonati(input: { quanti: number; gdoId: string }): Promise<AccantonatiEsito> {
    const ctx = await contestoAdmin()
    if (!ctx) return { ok: false, errore: 'Solo un amministratore può assegnare questi lead.', assegnati: 0 }
    try {
        assertSingleCompany(ctx)
    } catch {
        return { ok: false, errore: 'Scegli prima una sola azienda.', assegnati: 0 }
    }

    const richiesti = quantiDaAssegnare(input.quanti, MAX_ACCANTONATI_PER_VOLTA)
    if (richiesti === 0) return { ok: false, errore: 'Scrivi quanti lead assegnare.', assegnati: 0 }

    const gdo = (await gdoAssegnabili(ctx.companyId)).find(g => g.id === input.gdoId)
    if (!gdo) return { ok: false, errore: 'Questa persona non può ricevere lead: scegli un GDO della squadra.', assegnati: 0 }

    const base = Date.now()
    const assegnati = await db.transaction(async (tx) => {
        // Sotto lock, con lo stesso predicato: chi nel frattempo è stato
        // assegnato altrove (script, bot, un altro admin) resta fuori.
        const presi = await tx.select({ id: leads.id }).from(leads)
            .where(accantonato(ctx.companyId))
            .orderBy(sql`${ridatoIl} desc nulls last`, desc(leads.id))
            .limit(richiesti)
            .for('update', { of: leads, skipLocked: true })
        if (presi.length === 0) return 0

        const eventi: Array<typeof leadEvents.$inferInsert> = []
        for (let i = 0; i < presi.length; i++) {
            const id = presi[i].id
            // updatedAt sfalsato di 1 ms per lead: il feed /api/bot/lead-status
            // ha il cursore solo su updatedAt e si blocca con tante righe allo
            // stesso istante.
            const quando = new Date(base + i)
            const fatto = await tx.update(leads)
                .set({
                    assignedToId: gdo.id,
                    assignedAt: sql`coalesce(${leads.assignedAt}, ${quando})`,
                    updatedAt: quando,
                    version: sql`${leads.version} + 1`,
                })
                .where(and(eq(leads.id, id), isNull(leads.assignedToId)))
                .returning({ id: leads.id })
            if (fatto.length === 0) continue
            eventi.push({
                id: crypto.randomUUID(),
                leadId: id,
                eventType: 'ASSIGNED',
                userId: ctx.userId,
                fromSection: null,
                toSection: null,
                metadata: { source: 'accantonati', assignedToUser: gdo.id },
                timestamp: quando,
                companyId: ctx.companyId,
            })
        }
        for (let i = 0; i < eventi.length; i += 500) {
            await tx.insert(leadEvents).values(eventi.slice(i, i + 500))
        }
        return eventi.length
    })

    revalidatePath('/', 'layout')
    if (assegnati === 0) return { ok: false, errore: 'Non ci sono più lead accantonati da assegnare.', assegnati: 0 }
    return { ok: true, assegnati, nomeGdo: gdo.nome }
}
