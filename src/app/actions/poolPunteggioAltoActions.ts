"use server"

// Pool "Lead database punteggio alto" su /import (PO 30/10/2026): i lead della
// coda marketing (MKT_CODA) rimasti senza nessuno da quando la coda al bot è
// spenta. Solo ADMIN, come la card "Lead accantonati": li vede e, se vuole, li
// dà ai GDO che sceglie, pareggiando le prime chiamate. Niente in automatico.
// Le regole pure sono in src/lib/marketingQueue/poolPunteggioAlto.ts.
//
// Assegnazione come gli altri pool di /import: assignedToId, assignedAt con
// COALESCE (regola 0027), stato, tentativi e storico invariati, evento
// ASSIGNED. Nessun webhook al marketing, nessuna chiamata al bot. Il cron della
// coda al bot e l'endpoint del marketing non si toccano.

import { db } from "@/db"
import { leads, leadEvents } from "@/db/schema"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import crypto from "crypto"
import { revalidatePath } from "next/cache"
import { currentTenant, assertSalesArea, assertSingleCompany } from "@/lib/tenancy"
import { toRomeDateStr } from "@/lib/dateUtils"
import { EVENTO_RIDATO_PARCHEGGIATO } from "@/lib/bot-fissatore/iaVocale"
import { MARKETING_QUEUE_BUCKET } from "@/lib/marketingQueue/applica"
import { gdoAssegnabili } from "@/lib/diretta/gdoAssegnabili"
import {
    MAX_PUNTEGGIO_ALTO_PER_VOLTA, FASCE_ETA, etichettaFunnel, haSegnale, mesiDiEta, fasciaEta, etaTesto,
    quantiDaAssegnare, pianificaPareggio, quantiATesta,
} from "@/lib/marketingQueue/poolPunteggioAlto"

/** Quanti se ne mostrano in elenco, nell'ordine in cui si assegnano. */
const QUANTI_IN_ELENCO = 50

export type GdoPerPunteggioAlto = { id: string; nome: string; primaChiamata: number }

export type PunteggioAltoStato = {
    totale: number
    nuoviOggi: number
    conSegnale: number
    perFunnel: Array<{ etichetta: string; n: number }>
    perEta: Array<{ etichetta: string; n: number }>
    elenco: Array<{
        id: string
        nome: string
        funnel: string
        inCodaDal: string | null
        ultimaCoda: string | null
        segnale: string | null
        eta: string
    }>
    gdo: GdoPerPunteggioAlto[]
    maxPerVolta: number
}

export type PunteggioAltoEsito = {
    ok: boolean
    errore?: string
    assegnati: number
    perGdo?: Array<{ nome: string; n: number }>
}

/*
 * Predicato del pool, uguale in lettura e sotto lock. Colonne di "leads"
 * scritte per esteso dentro le sottoquery: in una select a tabella singola
 * Drizzle toglie la qualificazione e `"phone"` o `"id"` finirebbero sulla
 * tabella della sottoquery (stessa trappola del cron della coda al bot).
 */
function nelPool(companyId: string) {
    return and(
        eq(leads.companyId, companyId),
        eq(leads.launchBucket, MARKETING_QUEUE_BUCKET),
        eq(leads.isTest, false),
        // Di nessuno: né del bot né di un GDO.
        isNull(leads.assignedToId),
        // Aperto: niente scartati, appuntamenti, clienti chiusi.
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.appointmentDate),
        isNull(leads.presentedAt),
        isNull(leads.reservedSalespersonId),
        // Già nel pool "Lead accantonati" (tornato dal bot e messo da parte): si dà da lì.
        sql`not exists (select 1 from "leadEvents" e where e."leadId" = "leads"."id" and e."eventType" = ${EVENTO_RIDATO_PARCHEGGIATO})`,
        // "Ti ha cercato" aperto: la richiesta si smista dalla sua coda.
        sql`not exists (select 1 from "botContactRequests" r where r."leadId" = "leads"."id" and r."status" <> 'closed')`,
        // Stessa persona già in mano a qualcuno (bot o GDO) o in appuntamento con un'altra scheda.
        sql`not exists (
            select 1 from leads d
            where d."companyId" = "leads"."companyId" and d.phone = "leads"."phone" and d.id <> "leads"."id"
              and d."assignedToId" is not null and d.status in ('NEW', 'IN_PROGRESS', 'APPOINTMENT')
        )`,
        // Clienti: la stessa persona ha già chiuso o ha un contratto nel gestionale.
        sql`not exists (
            select 1 from leads d
            where d."companyId" = "leads"."companyId" and d.phone = "leads"."phone" and d."salespersonOutcome" = 'Chiuso'
        )`,
        sql`not exists (
            select 1 from "gestionaleContratti" g
            where g."deletedAt" is null
              and length(regexp_replace(coalesce(g."clienteTelefono", ''), '\\D', '', 'g')) >= 9
              and right(regexp_replace(g."clienteTelefono", '\\D', '', 'g'), 10) = right(regexp_replace(coalesce("leads"."phone", ''), '\\D', '', 'g'), 10)
        )`,
    )
}

/** Primo giorno in coda (YYYY-MM-DD). */
const inCodaDal = sql<string | null>`(
    select min(q."queueDate")::text from "marketingQueueEntries" q where q."leadId" = "leads"."id"
)`
/** Ultimo giorno in coda (YYYY-MM-DD): l'ordine di assegnazione parte da qui. */
const ultimaCoda = sql<string | null>`(
    select max(q."queueDate")::text from "marketingQueueEntries" q where q."leadId" = "leads"."id"
)`
/** La riga più recente della coda per il lead: motivo, funnel e data di ingresso più freschi. */
const ultimaRiga = (campo: 'motivoChiamata' | 'funnelOrigine' | 'dataIngresso' | 'posizione') => sql<string | null>`(
    select q.${sql.raw(`"${campo}"`)}::text from "marketingQueueEntries" q where q."leadId" = "leads"."id"
    order by q."queueDate" desc, q."createdAt" desc limit 1
)`

/** Ordine di assegnazione: ultimi arrivati in coda in cima, poi l'ordine del marketing. */
const ordine = [
    sql`${ultimaCoda} desc nulls last`,
    sql`(${ultimaRiga('posizione')})::int asc nulls last`,
    sql`"leads"."id" asc`,
]

async function contestoAdmin() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== 'ADMIN') return null
    return ctx
}

/**
 * Lead in prima chiamata per GDO, con lo stesso perimetro della board
 * (leggiPrimeChiamate): suoi, né scartati né in appuntamento, senza richiamo,
 * mai chiamati oppure con un "Ti ha cercato" aperto.
 */
async function primeChiamate(companyId: string, gdoIds: string[]): Promise<Map<string, number>> {
    const out = new Map(gdoIds.map(id => [id, 0]))
    if (gdoIds.length === 0) return out
    const righe = await db.select({ gdo: leads.assignedToId, n: sql<number>`count(*)::int` }).from(leads).where(and(
        eq(leads.companyId, companyId),
        inArray(leads.assignedToId, gdoIds),
        eq(leads.isTest, false),
        sql`"leads"."status" not in ('REJECTED', 'APPOINTMENT')`,
        isNull(leads.recallDate),
        sql`("leads"."callCount" = 0 or exists (select 1 from "botContactRequests" r where r."leadId" = "leads"."id" and r."status" <> 'closed'))`,
    )).groupBy(leads.assignedToId)
    for (const r of righe) if (r.gdo) out.set(r.gdo, Number(r.n) || 0)
    return out
}

function conta(valori: string[]): Array<{ etichetta: string; n: number }> {
    const m = new Map<string, number>()
    for (const v of valori) m.set(v, (m.get(v) ?? 0) + 1)
    return [...m.entries()].map(([etichetta, n]) => ({ etichetta, n }))
}

/** Stato del pool letto adesso. null = non ADMIN (la card non compare). */
export async function getPunteggioAltoStato(): Promise<PunteggioAltoStato | null> {
    const ctx = await contestoAdmin()
    if (!ctx) return null

    const [righe, gdo] = await Promise.all([
        db.select({
            id: leads.id, nome: leads.name, funnelLead: leads.funnel,
            inCodaDal, ultimaCoda,
            motivo: ultimaRiga('motivoChiamata'),
            funnelOrigine: ultimaRiga('funnelOrigine'),
            dataIngresso: ultimaRiga('dataIngresso'),
        }).from(leads).where(nelPool(ctx.companyId)).orderBy(...ordine),
        gdoAssegnabili(ctx.companyId),
    ])
    const carichi = await primeChiamate(ctx.companyId, gdo.map(g => g.id))

    const oggi = toRomeDateStr(new Date())
    const lista = righe.map(r => {
        const mesi = mesiDiEta(r.dataIngresso, oggi)
        return {
            id: r.id,
            nome: r.nome?.trim() || 'Senza nome',
            funnel: etichettaFunnel(r.funnelOrigine ?? r.funnelLead),
            inCodaDal: r.inCodaDal,
            ultimaCoda: r.ultimaCoda,
            segnale: haSegnale(r.motivo) ? r.motivo!.trim() : null,
            eta: etaTesto(mesi),
            fascia: fasciaEta(mesi),
        }
    })

    const perEta = conta(lista.map(l => l.fascia))
    return {
        totale: lista.length,
        nuoviOggi: lista.filter(l => l.inCodaDal === oggi).length,
        conSegnale: lista.filter(l => l.segnale).length,
        perFunnel: conta(lista.map(l => l.funnel)).sort((a, b) => b.n - a.n || a.etichetta.localeCompare(b.etichetta, 'it')),
        perEta: FASCE_ETA.map(f => perEta.find(e => e.etichetta === f)).filter((e): e is { etichetta: string; n: number } => !!e),
        elenco: lista.slice(0, QUANTI_IN_ELENCO).map(l => ({ id: l.id, nome: l.nome, funnel: l.funnel, inCodaDal: l.inCodaDal, ultimaCoda: l.ultimaCoda, segnale: l.segnale, eta: l.eta })),
        gdo: gdo.map(g => ({ ...g, primaChiamata: carichi.get(g.id) ?? 0 })),
        maxPerVolta: MAX_PUNTEGGIO_ALTO_PER_VOLTA,
    }
}

/** Dà ai GDO scelti i primi N del pool, pareggiando le prime chiamate. */
export async function assegnaPunteggioAlto(input: { quanti: number; gdoIds: string[] }): Promise<PunteggioAltoEsito> {
    const ctx = await contestoAdmin()
    if (!ctx) return { ok: false, errore: 'Solo un amministratore può assegnare questi lead.', assegnati: 0 }
    try {
        assertSingleCompany(ctx)
    } catch {
        return { ok: false, errore: 'Scegli prima una sola azienda.', assegnati: 0 }
    }

    const richiesti = quantiDaAssegnare(input.quanti, MAX_PUNTEGGIO_ALTO_PER_VOLTA)
    if (richiesti === 0) return { ok: false, errore: 'Scrivi quanti lead assegnare.', assegnati: 0 }

    const scelti = new Set(input.gdoIds ?? [])
    const gdo = (await gdoAssegnabili(ctx.companyId)).filter(g => scelti.has(g.id))
    if (gdo.length === 0) return { ok: false, errore: 'Scegli almeno un GDO della squadra.', assegnati: 0 }
    if (gdo.length !== scelti.size) return { ok: false, errore: 'Qualcuno dei GDO scelti non può ricevere lead: aggiorna e riprova.', assegnati: 0 }

    const base = Date.now()
    const fatti = await db.transaction(async (tx) => {
        // Sotto lock, con lo stesso predicato: chi nel frattempo è stato preso
        // altrove (script, un altro admin) resta fuori.
        const presi = await tx.select({ id: leads.id }).from(leads)
            .where(nelPool(ctx.companyId))
            .orderBy(...ordine)
            .limit(richiesti)
            .for('update', { of: leads, skipLocked: true })
        if (presi.length === 0) return []

        // Carichi letti dentro la transazione, subito prima di dividere.
        const carichi = await primeChiamate(ctx.companyId, gdo.map(g => g.id))
        const piano = pianificaPareggio(presi.map(p => p.id), gdo.map(g => ({ id: g.id, carico: carichi.get(g.id) ?? 0 })))

        const eventi: Array<typeof leadEvents.$inferInsert> = []
        const riusciti: Array<{ gdoId: string }> = []
        for (let i = 0; i < piano.length; i++) {
            const { leadId, gdoId } = piano[i]
            // updatedAt sfalsato di 1 ms per lead: il feed /api/bot/lead-status
            // ha il cursore solo su updatedAt e si blocca con tante righe allo
            // stesso istante.
            const quando = new Date(base + i)
            const fatto = await tx.update(leads)
                .set({
                    assignedToId: gdoId,
                    assignedAt: sql`coalesce(${leads.assignedAt}, ${quando})`,
                    updatedAt: quando,
                    version: sql`${leads.version} + 1`,
                })
                .where(and(eq(leads.id, leadId), isNull(leads.assignedToId)))
                .returning({ id: leads.id })
            if (fatto.length === 0) continue
            riusciti.push({ gdoId })
            eventi.push({
                id: crypto.randomUUID(),
                leadId,
                eventType: 'ASSIGNED',
                userId: ctx.userId,
                fromSection: null,
                toSection: null,
                metadata: { source: 'database_punteggio_alto', bucket: MARKETING_QUEUE_BUCKET, assignedToUser: gdoId },
                timestamp: quando,
                companyId: ctx.companyId,
            })
        }
        for (let i = 0; i < eventi.length; i += 500) {
            await tx.insert(leadEvents).values(eventi.slice(i, i + 500))
        }
        return riusciti
    })

    revalidatePath('/', 'layout')
    if (fatti.length === 0) return { ok: false, errore: 'Non ci sono più lead da assegnare in questo pool.', assegnati: 0 }
    const aTesta = quantiATesta(fatti)
    return {
        ok: true,
        assegnati: fatti.length,
        perGdo: gdo.map(g => ({ nome: g.nome, n: aTesta.get(g.id) ?? 0 })).filter(g => g.n > 0),
    }
}
