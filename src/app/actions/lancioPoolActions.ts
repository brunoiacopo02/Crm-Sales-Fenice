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
import { currentTenant, assertSalesArea, assertSingleCompany, type TenantContext } from "@/lib/tenancy"
import { pickAndAssignBuckets, AC_KEY, acGet, findAcListIdsByName } from "@/lib/launchPoolShared"
import { pushLeadsToBotPaced } from "@/lib/bot-fissatore/push"
import { NO_REPUSH_RESULTS_SQL, DELIVERED_PUSH_RESULTS_SQL, avvisoPushFalliti } from "@/lib/bot-fissatore/pushAudit"
import {
    LANCIO_BUCKET, LANCIO_COMPANY, LANCIO_FUNNEL, LANCIO_LIST_NAME_NORMALIZED, LANCIO_POOL_LABEL,
    isLancioIntakeEnabled, buildLancioLeadRow, buildLancioIntakeEventRows, lancioFieldForLead,
} from "@/lib/lancio/intake"
import { findLancioBotId } from "@/lib/lancio/botAccount"
import { lancioContactId, readLancioAcContact } from "@/lib/lancio/acContact"
import { LANCIO_PUSH_LOCK_KEY, lockPreso } from "@/lib/lancio/pushLock"

// Chi può muovere il pool del lancio. Identico ai pool database
// (databasePoolActions): scaricare la lista, aprire 500 chat WhatsApp o
// ridistribuire i lead non sono gesti da GDO o venditore, che pure stanno
// nell'area sales. La sola lettura dello stato resta a tutta l'area.
const LANCIO_ROLES = ['ADMIN', 'MANAGER', 'TL']

/** Contesto validato per le action di scrittura del lancio. Lancia se non autorizzato. */
async function requireLancioCtx(): Promise<TenantContext> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!LANCIO_ROLES.includes(ctx.role)) {
        throw new Error(`Forbidden: ruolo ${ctx.role} non autorizzato sul pool del lancio`)
    }
    assertSingleCompany(ctx) // scrittura: bloccata in modalità "Tutte le aziende"
    return ctx
}

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
    // Definizione unica in botAccount: la stessa che usano le API /api/bot/lancio/*.
    return await findLancioBotId()
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

/**
 * Cosa c'e' gia' dentro, per la dedup del sync.
 * - `ids`: gli acContactId SOLO del bucket. I duplicati cross-funnel sono
 *   voluti (decisione 14/09 n.1): lo stesso contatto AC puo' stare nel lancio
 *   e in un altro funnel.
 * - `phones`: i telefoni del bucket E quelli del funnel del lancio, come fa
 *   syncBlackSummerPool. Il funnel senza bucket oggi non esiste, ma un import
 *   manuale della stessa lista lo creerebbe, e un doppione di numero sono due
 *   aperture WhatsApp alla stessa persona.
 */
async function leggiEsistenti(companyId: string): Promise<{ ids: Set<string>; phones: Set<string> }> {
    const rows = await db
        .select({ acContactId: leads.acContactId, phone: leads.phone, bucket: leads.launchBucket })
        .from(leads)
        .where(and(
            eq(leads.companyId, companyId),
            or(eq(leads.launchBucket, LANCIO_BUCKET), eq(leads.funnel, LANCIO_FUNNEL)),
        ))
    const ids = new Set<string>()
    const phones = new Set<string>()
    for (const r of rows) {
        if (r.bucket === LANCIO_BUCKET && r.acContactId) ids.add(r.acContactId)
        phones.add(r.phone)
    }
    return { ids, phones }
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
    const report: LancioSyncReport = {
        ok: false, imported: 0, skippedExisting: 0, skippedNoPhone: 0, totalOnList: 0, senzaBot: 0, errors: [],
    }
    let ctx: TenantContext
    try {
        ctx = await requireLancioCtx()
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

    const { ids: existingIds, phones: existingPhones } = await leggiEsistenti(ctx.companyId)

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
        const { ids: adessoIds, phones: adessoPhones } = await leggiEsistenti(ctx.companyId)
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
    // Solo se gliene e' arrivato almeno uno davvero: un lotto tutto di telefoni
    // sospetti finisce nel pool, non a lui, e non deve spostargli il turno.
    const assegnatiAlBot = righeInserite.filter(row => !!row.assignedToId).length
    if (botId && assegnatiAlBot > 0) {
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

    // La riga di registro esiste dalla migrazione 0036, ma "Rimuovi pool" la
    // archivia e da archiviata getLancioPoolStatus torna null: la card sparisce
    // e con lei sync, push e distribuzione. Per il lancio non e' una porta a
    // senso unico — la precondizione dell'archiviazione (zero lead non
    // assegnati) qui e' lo stato NORMALE, perche' i lead nascono al bot. Quindi
    // un sync riuscito la de-archivia: rifare il sync e' come riaprire la card.
    if (report.imported > 0 || report.totalOnList > 0) {
        await db.insert(launchPools).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            bucket: LANCIO_BUCKET,
            kind: 'LAUNCH',
            label: LANCIO_POOL_LABEL,
            monthKey: null,
            createdBy: ctx.userId,
        }).onConflictDoUpdate({
            target: [launchPools.companyId, launchPools.bucket],
            set: { archivedAt: null, archivedBy: null },
        })
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
    /** true = c'era gia' un push in corso e questo non ha fatto niente. */
    giaInCorso?: boolean
}

/**
 * Spinge al bot, a 30/min, i lead del lancio assegnati al bot che non gli
 * sono mai arrivati. Ripetibile: ogni click riparte dai mancanti. Un lead
 * con BOT_PUSHED in sent/duplicate/network_error NON si rispinge
 * (NO_REPUSH_RESULTS); un http_error/rate_limited/skipped_disabled si'.
 * Massimo 500 candidati per click: con budget 240 s ne partono ~120.
 *
 * Uno alla volta, garantito da un advisory lock. La prova "questo lead non e'
 * mai arrivato al bot" e' l'evento BOT_PUSHED, che viene scritto lead per lead
 * lungo i 240 s del lotto: senza lock un doppio click, una seconda scheda o un
 * secondo admin rileggerebbero gli stessi <=500 candidati e aprirebbero due
 * volte la stessa chat WhatsApp (e' la forma esatta dell'incidente del 09/09).
 */
export async function pushLancioPoolToBot(): Promise<LancioPushReport> {
    const report: LancioPushReport = { ok: false, candidati: 0, inviati: 0, remaining: 0, summary: {}, errors: [] }
    let ctx: TenantContext
    try {
        ctx = await requireLancioCtx()
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== LANCIO_COMPANY) {
        report.errors.push("Il push del lancio è disponibile solo con azienda attiva Fenice.")
        return report
    }
    // Interruttore spento = il lancio non è in aria: nessuna chat WhatsApp deve
    // partire. Si esce PRIMA del lock e PRIMA di leggere i candidati, così un
    // click per sbaglio a lancio spento non prende il lucchetto e non tocca
    // niente. Sync e distribuzione ai GDO restano disponibili: servono proprio
    // a preparare il pool mentre l'interruttore è ancora giù.
    if (!isLancioIntakeEnabled()) {
        report.errors.push("Il lancio è spento (LANCIO_WEBDEV_INTAKE): accendi l'interruttore prima di spingere")
        return report
    }
    const botId = await findBotId()
    if (!botId) {
        report.errors.push("Account bot (GDO 201) non trovato o disattivo.")
        return report
    }

    // Lock di TRANSAZIONE, non di sessione: in produzione il DB si raggiunge
    // dal pooler Supabase in transaction mode, dove la connessione non resta
    // la stessa tra una query e l'altra e un pg_advisory_lock di sessione
    // finirebbe su una connessione qualsiasi (o non si rilascerebbe mai). Il
    // lock di transazione vive dentro il BEGIN/COMMIT — che tiene la
    // connessione agganciata — e si rilascia da solo anche se crepa tutto.
    // Il prezzo e' una transazione lunga quanto il lotto (<=240 s): la si paga
    // volentieri per non aprire due volte la stessa chat.
    // La selezione dei candidati sta DENTRO il lock: e' proprio la lettura che
    // due esecuzioni sovrapposte farebbero uguale.
    const preso = await db.transaction(async (tx) => {
        const res = await tx.execute(
            sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${LANCIO_PUSH_LOCK_KEY}, 2)) AS preso`,
        )
        if (!lockPreso(res)) return false

        const candidates = await tx.select({
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
        if (candidates.length === 0) return true

        // Gli eventi BOT_PUSHED li scrive pushLeadToBot sulla connessione
        // normale (`db`), non su questa: restano scritti anche se la
        // transazione del lock finisse in rollback. E' voluto — sono l'audit
        // di una chat gia' aperta, non devono sparire.
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
        return true
    })

    if (!preso) {
        report.giaInCorso = true
        report.errors.push("Push già in corso (un'altra scheda o un altro admin): aspetta che finisca e ricontrolla lo stato.")
        return report
    }

    if (report.candidati === 0) { report.ok = true; return report }

    if (report.summary.skipped_disabled) {
        report.errors.push(`BOT_INTAKE_ENABLED non è 'true' sul server: ${report.summary.skipped_disabled} push saltati.`)
    }
    if (report.summary.rate_limited) {
        report.errors.push(`Il bot ha risposto 429 su ${report.summary.rate_limited} lead: aspetta un minuto e riclicca.`)
    }
    // Push andati male per colpa del bot o della rete: l'errore rende ok=false,
    // e la card si ferma al giro corrente invece di rilanciare altre nove volte
    // contro un bot che sta rispondendo male (i network_error, per giunta, non
    // si rispingono mai più da soli).
    const avvisoFalliti = avvisoPushFalliti(report.summary)
    if (avvisoFalliti) report.errors.push(avvisoFalliti)

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
    const report: LancioAssignReport = { ok: false, errors: [], perGdo: {}, totalAssigned: 0 }
    let ctx: TenantContext
    try {
        ctx = await requireLancioCtx()
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
