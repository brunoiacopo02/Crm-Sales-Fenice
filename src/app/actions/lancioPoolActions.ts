"use server"

// Pool del lancio "Web Developer AI" (spec 2026-09-14 §4.1). Clone del
// pattern Black Summer con due differenze: i lead importati dal sync nascono
// ASSEGNATI AL BOT (non nel pool), e c'e' un'azione di push a lotti verso il
// bot. Il pool (lead non assegnati) contiene solo i telefoni sospetti, i lead
// entrati senza account bot e — dal B5 — i lead che il bot restituisce.
// Solo async function ed export type qui: e' un file 'use server'.

import { db } from "@/db"
import { leads, leadEvents, acIntakeFailures, launchPools, users } from "@/db/schema"
import { and, eq, isNull, sql, like, or, inArray, asc } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"
import crypto from "crypto"
import { currentTenant, assertSalesArea, assertSingleCompany } from "@/lib/tenancy"
import { pickAndAssignBuckets, AC_KEY, acGet, findAcListIdsByName } from "@/lib/launchPoolShared"
import { pushLeadsToBotPaced } from "@/lib/bot-fissatore/push"
import { NO_REPUSH_RESULTS_SQL, DELIVERED_PUSH_RESULTS_SQL } from "@/lib/bot-fissatore/pushAudit"
import {
    LANCIO_BUCKET, LANCIO_COMPANY, LANCIO_LIST_NAME_NORMALIZED,
    isLancioIntakeEnabled, buildLancioLeadRow, buildLancioIntakeEventRows, lancioFieldForLead,
} from "@/lib/lancio/intake"
import { lancioContactId, readLancioAcContact } from "@/lib/lancio/acContact"

export type LancioPoolStatus = {
    /** Nel bucket, senza padrone: pescabili verso i GDO. */
    nelPool: number
    /** Assegnati al bot (consegnati o no). */
    alBot: number
    /** Con almeno un BOT_PUSHED consegnato (sent/duplicate). */
    spinti: number
    /** Eventi LANCIO_RETURNED_TO_POOL (scritti dal B5; qui vale 0 finche' non esiste). */
    restituiti: number
    /** Assegnati a un GDO umano. */
    aiGdo: number
    totale: number
    /** LANCIO_WEBDEV_INTAKE === 'on' sul server: la card lo mostra. */
    intakeAttivo: boolean
}

/** L'account del bot fissatore (GDO 201). null = non c'e' o e' disattivo. */
async function findBotId(): Promise<string | null> {
    const [bot] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, LANCIO_COMPANY),
        eq(users.role, 'GDO'),
        eq(users.isBot, true),
        eq(users.isActive, true),
    )).limit(1)
    return bot?.id ?? null
}

export async function getLancioPoolStatus(): Promise<LancioPoolStatus | null> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // La lista vive sull'account AC Fenice: con altra azienda attiva la card si nasconde.
    if (ctx.companyId !== LANCIO_COMPANY) return null

    // Pool rimosso dal TL (registro launchPools, spec 2026-07-20): card nascosta.
    const [poolRow] = await db.select({ archivedAt: launchPools.archivedAt })
        .from(launchPools)
        .where(and(eq(launchPools.companyId, ctx.companyId), eq(launchPools.bucket, LANCIO_BUCKET)))
        .limit(1)
    if (poolRow?.archivedAt) return null

    const botId = await findBotId()
    const [counts] = await db.select({
        totale: sql<number>`count(*)::int`,
        nelPool: sql<number>`count(*) filter (where ${leads.assignedToId} is null)::int`,
        alBot: botId
            ? sql<number>`count(*) filter (where ${leads.assignedToId} = ${botId})::int`
            : sql<number>`0`,
        aiGdo: botId
            ? sql<number>`count(*) filter (where ${leads.assignedToId} is not null and ${leads.assignedToId} <> ${botId})::int`
            : sql<number>`count(*) filter (where ${leads.assignedToId} is not null)::int`,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.launchBucket, LANCIO_BUCKET),
    ))

    const [spintiRow] = await db.select({
        n: sql<number>`count(distinct ${leadEvents.leadId})::int`,
    }).from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.launchBucket, LANCIO_BUCKET),
            eq(leadEvents.eventType, 'BOT_PUSHED'),
            sql`${leadEvents.metadata}->>'result' IN (${sql.raw(DELIVERED_PUSH_RESULTS_SQL)})`,
        ))

    const [restituitiRow] = await db.select({
        n: sql<number>`count(distinct ${leadEvents.leadId})::int`,
    }).from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.launchBucket, LANCIO_BUCKET),
            eq(leadEvents.eventType, 'LANCIO_RETURNED_TO_POOL'),
        ))

    return {
        nelPool: counts?.nelPool ?? 0,
        alBot: counts?.alBot ?? 0,
        spinti: spintiRow?.n ?? 0,
        restituiti: restituitiRow?.n ?? 0,
        aiGdo: counts?.aiGdo ?? 0,
        totale: counts?.totale ?? 0,
        intakeAttivo: isLancioIntakeEnabled(),
    }
}

export type LancioSyncReport = {
    ok: boolean
    imported: number
    skippedExisting: number
    skippedNoPhone: number
    totalOnList: number
    /** Importati senza account bot: sono nel pool, non al bot. */
    senzaBot: number
    errors: string[]
}

/**
 * Sync di recupero dalla lista AC del lancio. Idempotente (dedup bucket +
 * telefono nel bucket, indice unico parziale sul re-check). I lead nuovi
 * nascono assegnati al bot; il push e' un'azione separata (pushLancioPoolToBot),
 * perche' il download AC puo' durare un minuto e il push a 30/min altri
 * quattro: insieme sforerebbero i 300 s della pagina.
 */
export async function syncLancioPool(): Promise<LancioSyncReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: LancioSyncReport = {
        ok: false, imported: 0, skippedExisting: 0, skippedNoPhone: 0, totalOnList: 0, senzaBot: 0, errors: [],
    }
    try {
        assertSingleCompany(ctx)
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== LANCIO_COMPANY) {
        report.errors.push("Il sync del lancio è disponibile solo con azienda attiva Fenice.")
        return report
    }
    if (!AC_KEY) {
        report.errors.push("ACTIVECAMPAIGN_API_KEY non configurata sul server.")
        return report
    }

    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const adminId = supabaseUser?.id ?? null

    // Liste omonime: su AC possono essercene due con lo stesso nome e valgono
    // tutte (stessa regola del webhook, Task 4). Si scaricano tutte.
    let listIds: string[] = []
    try {
        listIds = await findAcListIdsByName(LANCIO_LIST_NAME_NORMALIZED)
    } catch (e: any) {
        report.errors.push(`Errore AC durante la ricerca della lista: ${e?.message || e}`)
        return report
    }
    if (listIds.length === 0) {
        report.errors.push(`Lista "Lancio Web Developer AI" non trovata su ActiveCampaign.`)
        return report
    }

    const botId = await findBotId()

    // Dedup SOLO dentro il bucket (acContactId e telefono): i duplicati
    // cross-funnel sono voluti (decisione 14/09 n.1).
    const existingRows = await db
        .select({ acContactId: leads.acContactId, phone: leads.phone })
        .from(leads)
        .where(and(eq(leads.companyId, ctx.companyId), eq(leads.launchBucket, LANCIO_BUCKET)))
    const existingIds = new Set(existingRows.map(r => r.acContactId).filter((x): x is string => !!x))
    const existingPhones = new Set(existingRows.map(r => r.phone))

    const now = new Date()
    let toInsert: ReturnType<typeof buildLancioLeadRow>[] = []
    /** leadId → id della lista AC da cui e' arrivato (per l'evento LANCIO_INTAKE). */
    const listIdByLead = new Map<string, string>()

    try {
        // status=-1 = qualunque stato di iscrizione, unsubscribed inclusi (come
        // Black Summer). Hard-cap 20.000 contatti per lista.
        for (const listId of listIds) {
            let hitPaginationCap = true
            for (let offset = 0; offset < 20000; offset += 100) {
                const page = await acGet(`/contacts?listid=${listId}&status=-1&limit=100&offset=${offset}`)
                const contacts = Array.isArray(page.contacts) ? page.contacts : []
                if (offset === 0) report.totalOnList += Number(page?.meta?.total ?? contacts.length) || contacts.length
                if (contacts.length === 0) { hitPaginationCap = false; break }

                for (const c of contacts) {
                    const contactId = lancioContactId(c)
                    if (!contactId) continue
                    if (existingIds.has(contactId)) { report.skippedExisting++; continue }

                    const letto = readLancioAcContact(c)
                    if (!letto) { report.skippedNoPhone++; continue }
                    if (existingPhones.has(letto.phone)) { report.skippedExisting++; continue }

                    // Anche intra-sync: lo stesso contatto puo' stare su due
                    // liste omonime, e nel lotto ci deve entrare una volta sola.
                    existingIds.add(contactId)
                    existingPhones.add(letto.phone)
                    const row = buildLancioLeadRow({
                        id: crypto.randomUUID(),
                        name: letto.name,
                        phone: letto.phone,
                        email: letto.email,
                        acContactId: contactId,
                        phoneSuspicious: letto.phoneSuspicious,
                        botId,
                        now,
                    })
                    listIdByLead.set(row.id, listId)
                    toInsert.push(row)
                }
                if (contacts.length < 100) { hitPaginationCap = false; break }
            }
            if (hitPaginationCap) {
                report.errors.push(`Attenzione: raggiunto il limite di sicurezza di 20.000 contatti sulla lista ${listId} — non scaricata per intero, riclicca per verificare.`)
            }
        }
    } catch (e: any) {
        report.errors.push(`Errore AC durante il download dei contatti: ${e?.message || e} — importati quelli scaricati finora, riclicca per riprendere.`)
    }

    // Re-check pre-insert: `existingIds`/`existingPhones` sono uno snapshot di
    // inizio funzione, e nel frattempo il download AC (15-60 s) puo' aver fatto
    // correre un webhook o un secondo sync che questo non vede. L'indice unico
    // parziale copre l'acContactId; il telefono no, e un doppione di telefono
    // sono due aperture WhatsApp alla stessa persona.
    if (toInsert.length > 0) {
        const adessoRows = await db
            .select({ acContactId: leads.acContactId, phone: leads.phone })
            .from(leads)
            .where(and(eq(leads.companyId, ctx.companyId), eq(leads.launchBucket, LANCIO_BUCKET)))
        const adessoIds = new Set(adessoRows.map(r => r.acContactId).filter((x): x is string => !!x))
        const adessoPhones = new Set(adessoRows.map(r => r.phone))
        const prima = toInsert.length
        toInsert = toInsert.filter(row =>
            !(row.acContactId && adessoIds.has(row.acContactId)) && !adessoPhones.has(row.phone))
        report.skippedExisting += prima - toInsert.length
    }

    // Insert a chunk da 500 con ON CONFLICT DO NOTHING sull'indice parziale
    // leads_company_bucket_accontact_uq: un webhook o un secondo sync che ha
    // vinto la corsa non fa fallire questo. Gli eventi si scrivono SOLO per le
    // righe davvero inserite (returning).
    const insertedIds = new Set<string>()
    for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500)
        const inserted = await db.insert(leads).values(chunk)
            .onConflictDoNothing()
            .returning({ id: leads.id })
        for (const r of inserted) insertedIds.add(r.id)
        report.imported += inserted.length
        report.skippedExisting += chunk.length - inserted.length
    }
    const righeInserite = toInsert.filter(row => insertedIds.has(row.id))

    // Eventi IMPORTED + ASSIGNED + LANCIO_INTAKE, bulk a chunk di 500 righe.
    const eventRows = righeInserite.flatMap(row => buildLancioIntakeEventRows({
        leadId: row.id,
        botId: row.assignedToId,
        adminId,
        acContactId: row.acContactId,
        source: 'lancio_sync',
        via: 'sync',
        listId: listIdByLead.get(row.id) ?? null,
        now,
    }))
    for (let i = 0; i < eventRows.length; i += 500) {
        await db.insert(leadEvents).values(eventRows.slice(i, i + 500))
    }

    report.senzaBot = righeInserite.filter(row => !row.assignedToId && !row.phoneSuspicious).length
    if (report.senzaBot > 0) {
        report.errors.push(`${report.senzaBot} lead importati nel pool senza assegnazione: account bot (GDO 201) non trovato o disattivo.`)
    }

    // Il bot ha preso in carico questi lead adesso: allinea il round-robin.
    if (botId && report.imported > 0) {
        await db.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, botId))
    }

    // Risolvi le failure dei contatti ora importati (spariscono dal tab
    // Bloccati di /lead-automatici): sia le blocked_list del flusso di oggi,
    // sia le lancio_list_unresolved scritte dal webhook quando la lista non si
    // risolveva — sono esattamente i contatti che questo sync ha appena ripescato.
    const importedContactIds = righeInserite
        .map(row => row.acContactId)
        .filter((x): x is string => !!x)
    if (importedContactIds.length > 0) {
        for (let i = 0; i < importedContactIds.length; i += 500) {
            await db.update(acIntakeFailures)
                .set({ resolvedAt: new Date(), resolvedBy: adminId })
                .where(and(
                    eq(acIntakeFailures.companyId, ctx.companyId),
                    or(
                        like(acIntakeFailures.reason, 'blocked_list:%'),
                        like(acIntakeFailures.reason, 'lancio_list_unresolved%'),
                    ),
                    isNull(acIntakeFailures.resolvedAt),
                    inArray(acIntakeFailures.acContactId, importedContactIds.slice(i, i + 500)),
                ))
        }
    }

    revalidatePath('/', 'layout')
    report.ok = report.errors.length === 0
    return report
}

export type LancioPushReport = {
    ok: boolean
    /** Lead al bot, NEW, mai consegnati ne' in network_error: quelli da spingere. */
    candidati: number
    inviati: number
    /** Candidati non inviati per budget o rate limit: ricliccare. */
    remaining: number
    summary: Record<string, number>
    errors: string[]
}

/**
 * Spinge al bot, a 30/min, i lead del lancio assegnati al bot che non gli
 * sono mai arrivati. Ripetibile: ogni click riparte dai mancanti. Un lead
 * con BOT_PUSHED in sent/duplicate/network_error NON si rispinge
 * (NO_REPUSH_RESULTS); un http_error/rate_limited/skipped_disabled si'.
 * Massimo 500 candidati per click: con budget 240 s ne partono ~120.
 */
export async function pushLancioPoolToBot(): Promise<LancioPushReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: LancioPushReport = { ok: false, candidati: 0, inviati: 0, remaining: 0, summary: {}, errors: [] }
    try {
        assertSingleCompany(ctx)
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== LANCIO_COMPANY) {
        report.errors.push("Il push del lancio è disponibile solo con azienda attiva Fenice.")
        return report
    }
    const botId = await findBotId()
    if (!botId) {
        report.errors.push("Account bot (GDO 201) non trovato o disattivo.")
        return report
    }

    const candidates = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        companyId: leads.companyId,
        launchBucket: leads.launchBucket,
        lancioIngresso: leads.lancioIngresso,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.launchBucket, LANCIO_BUCKET),
        eq(leads.assignedToId, botId),
        eq(leads.status, 'NEW'),
        eq(leads.phoneSuspicious, false),
        sql`NOT EXISTS (
            SELECT 1 FROM "leadEvents" e
            WHERE e."leadId" = ${leads.id}
              AND e."eventType" = 'BOT_PUSHED'
              AND e.metadata->>'result' IN (${sql.raw(NO_REPUSH_RESULTS_SQL)})
        )`,
    )).orderBy(asc(leads.createdAt), asc(leads.id)).limit(500)

    report.candidati = candidates.length
    if (candidates.length === 0) { report.ok = true; return report }

    const { results, remaining } = await pushLeadsToBotPaced(candidates.map(c => ({
        leadId: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        funnel: c.funnel,
        companyId: c.companyId,
        lancio: lancioFieldForLead(c),
    })), { budgetMs: 240_000 })

    report.inviati = results.length
    report.remaining = remaining.length
    for (const r of results) report.summary[r.result] = (report.summary[r.result] ?? 0) + 1
    if (report.summary.skipped_disabled) {
        report.errors.push(`BOT_INTAKE_ENABLED non è 'true' sul server: ${report.summary.skipped_disabled} push saltati.`)
    }
    if (report.summary.rate_limited) {
        report.errors.push(`Il bot ha risposto 429 su ${report.summary.rate_limited} lead: aspetta un minuto e riclicca.`)
    }

    revalidatePath('/', 'layout')
    report.ok = report.errors.length === 0
    return report
}

export type LancioAssignReport = {
    ok: boolean
    errors: string[]
    perGdo: Record<string, { count: number, name: string }>
    totalAssigned: number
}

/** Distribuzione FIFO dei lead del pool (non assegnati) ai GDO scelti — come Black Summer. */
export async function assignFromLancioPool(input: { count: number; gdoIds: string[] }): Promise<LancioAssignReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: LancioAssignReport = { ok: false, errors: [], perGdo: {}, totalAssigned: 0 }
    try {
        assertSingleCompany(ctx)
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== LANCIO_COMPANY) {
        report.errors.push("Il pool del lancio è disponibile solo con azienda attiva Fenice.")
        return report
    }
    const count = Math.max(0, Math.floor(input.count || 0))
    if (count === 0) {
        report.errors.push("Devi specificare almeno 1 lead da pescare.")
        return report
    }
    if (!input.gdoIds || input.gdoIds.length === 0) {
        report.errors.push("Devi selezionare almeno 1 GDO destinatario.")
        return report
    }

    const selectedGdos = (await db.select().from(users).where(and(
        eq(users.companyId, ctx.companyId),
        inArray(users.id, input.gdoIds),
        eq(users.role, 'GDO'),
        eq(users.isActive, true),
        // Mai il bot: dal pool si distribuisce agli umani.
        eq(users.isBot, false),
    )))
    if (selectedGdos.length === 0) {
        report.errors.push("Nessuno dei GDO selezionati è attivo.")
        return report
    }
    if (selectedGdos.length !== input.gdoIds.length) {
        report.errors.push(`${input.gdoIds.length - selectedGdos.length} GDO selezionati ignorati perché non attivi.`)
    }

    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const adminId = supabaseUser?.id

    for (const g of selectedGdos) {
        report.perGdo[g.id] = { count: 0, name: g.displayName || g.name || g.id }
    }

    const result = await pickAndAssignBuckets({
        companyId: ctx.companyId,
        requests: [{ bucket: LANCIO_BUCKET, count }],
        selectedGdos,
        adminId,
    })
    for (const [gdoId, n] of Object.entries(result.assigned[LANCIO_BUCKET] ?? {})) {
        report.perGdo[gdoId].count += n
    }
    report.totalAssigned = result.totalAssigned

    revalidatePath('/', 'layout')
    report.ok = report.totalAssigned > 0
    if (report.totalAssigned === 0 && report.errors.length === 0) {
        report.errors.push("Nessun lead pescato (il pool potrebbe essere vuoto).")
    }
    return report
}
