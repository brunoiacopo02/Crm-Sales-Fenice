"use server"

import { db } from "@/db"
import { leads, acIntakeFailures } from "@/db/schema"
import { and, eq, isNull, isNotNull, sql, like } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { users } from "@/db/schema"
import { inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { logLeadEvent } from "@/lib/eventLogger"
import { previewLeadDistribution } from "@/lib/distributionUtils"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import crypto from "crypto"
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize"

type BucketRequest = { bucket: string; count: number }
type PickAssignResult = {
    /** bucket → gdoId → n. lead assegnati */
    assigned: Record<string, Record<string, number>>
    totalAssigned: number
}

/**
 * Pesca atomica (FOR UPDATE SKIP LOCKED, FIFO su createdAt con tiebreaker id —
 * i lead da sync bulk hanno createdAt identico, stessa lezione del fix
 * pipeline sort 49a61b0) e split equo round-robin sui GDO selezionati.
 * Logga gli eventi ASSIGNED fuori dalla transazione. Condiviso tra pool
 * Videoeditor (WEBINAR/NO_WEBINAR) e Black Summer (BLACK_SUMMER).
 */
async function pickAndAssignBuckets(params: {
    companyId: string
    requests: BucketRequest[]
    selectedGdos: Array<{ id: string; displayName: string | null; name: string | null }>
    adminId?: string
}): Promise<PickAssignResult> {
    const { companyId, requests, selectedGdos, adminId } = params
    const result: PickAssignResult = { assigned: {}, totalAssigned: 0 }
    const pickedByBucket: Record<string, string[]> = {}

    await db.transaction(async (tx) => {
        for (const { bucket, count } of requests) {
            if (count <= 0) continue
            const picked = await tx.execute(sql`
                SELECT id FROM leads
                WHERE "launchBucket" = ${bucket}
                  AND "assignedToId" IS NULL
                  AND "companyId" = ${companyId}
                ORDER BY "createdAt" ASC, id ASC
                LIMIT ${count}
                FOR UPDATE SKIP LOCKED
            `)
            const ids: string[] = (picked as any).rows
                ? (picked as any).rows.map((r: any) => r.id)
                : (picked as any).map((r: any) => r.id)
            pickedByBucket[bucket] = ids
        }

        for (const [bucket, ids] of Object.entries(pickedByBucket)) {
            if (ids.length === 0) continue
            result.assigned[bucket] = {}

            const distr = previewLeadDistribution(ids.length, selectedGdos, 'equal', {})
            const assignPlan: string[] = []
            for (const gdoId in distr) {
                for (let i = 0; i < distr[gdoId].count; i++) assignPlan.push(gdoId)
            }

            const idsByGdo: Record<string, string[]> = {}
            for (let i = 0; i < ids.length; i++) {
                const gdo = assignPlan[i] || selectedGdos[0].id
                if (!idsByGdo[gdo]) idsByGdo[gdo] = []
                idsByGdo[gdo].push(ids[i])
            }
            for (const [gdoId, leadIds] of Object.entries(idsByGdo)) {
                await tx
                    .update(leads)
                    .set({ assignedToId: gdoId, updatedAt: new Date() })
                    .where(and(
                        eq(leads.companyId, companyId),
                        inArray(leads.id, leadIds),
                    ))
                result.assigned[bucket][gdoId] = leadIds.length
                result.totalAssigned += leadIds.length
            }
        }
    })

    // Log eventi ASSIGNED (fuori dalla tx per non bloccarla)
    for (const [bucket, ids] of Object.entries(pickedByBucket)) {
        if (ids.length === 0) continue
        const assignedRows = await db
            .select({ id: leads.id, assignedToId: leads.assignedToId })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                inArray(leads.id, ids),
            ))
        for (const row of assignedRows) {
            await logLeadEvent({
                leadId: row.id,
                eventType: 'ASSIGNED',
                userId: adminId,
                metadata: { source: 'launch_pool', bucket, assignedToUser: row.assignedToId },
                companyId,
            })
        }
    }

    return result
}

export type LaunchPoolStatus = {
    webinarAvailable: number
    noWebinarAvailable: number
}

export async function getLaunchPoolStatus(): Promise<LaunchPoolStatus> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const rows = await db
        .select({
            bucket: leads.launchBucket,
            count: sql<number>`count(*)::int`
        })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.launchBucket),
            isNull(leads.assignedToId),
        ))
        .groupBy(leads.launchBucket)

    let webinar = 0
    let noWebinar = 0
    for (const r of rows) {
        if (r.bucket === 'WEBINAR') webinar = r.count
        else if (r.bucket === 'NO_WEBINAR') noWebinar = r.count
    }

    return { webinarAvailable: webinar, noWebinarAvailable: noWebinar }
}

export type AssignFromPoolInput = {
    webinarCount: number
    noWebinarCount: number
    gdoIds: string[]
}

export type AssignFromPoolReport = {
    ok: boolean
    errors: string[]
    /** Mappa gdoId → { webinar, noWebinar } effettivamente assegnati, con nome del GDO */
    perGdo: Record<string, { webinar: number, noWebinar: number, name: string }>
    totalAssigned: number
}

export async function assignFromLaunchPool(input: AssignFromPoolInput): Promise<AssignFromPoolReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: AssignFromPoolReport = {
        ok: false,
        errors: [],
        perGdo: {},
        totalAssigned: 0,
    }

    const webinarCount   = Math.max(0, Math.floor(input.webinarCount || 0))
    const noWebinarCount = Math.max(0, Math.floor(input.noWebinarCount || 0))

    if (webinarCount + noWebinarCount === 0) {
        report.errors.push("Devi specificare almeno 1 lead da pescare.")
        return report
    }
    if (!input.gdoIds || input.gdoIds.length === 0) {
        report.errors.push("Devi selezionare almeno 1 GDO destinatario.")
        return report
    }

    // Verifica GDO selezionati attivi
    const selectedGdos = (await db.select().from(users).where(and(
        eq(users.companyId, ctx.companyId),
        inArray(users.id, input.gdoIds),
    )))
        .filter((u: any) => u.role === 'GDO' && u.isActive === true)
    if (selectedGdos.length === 0) {
        report.errors.push("Nessuno dei GDO selezionati è attivo.")
        return report
    }
    if (selectedGdos.length !== input.gdoIds.length) {
        report.errors.push(`${input.gdoIds.length - selectedGdos.length} GDO selezionati ignorati perché non attivi.`)
    }

    // Identifica admin chiamante per log evento
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const adminId = supabaseUser?.id

    // Inizializza perGdo
    for (const g of selectedGdos) {
        report.perGdo[g.id] = { webinar: 0, noWebinar: 0, name: g.displayName || g.name || g.id }
    }

    const result = await pickAndAssignBuckets({
        companyId: ctx.companyId,
        requests: [
            { bucket: 'WEBINAR', count: webinarCount },
            { bucket: 'NO_WEBINAR', count: noWebinarCount },
        ],
        selectedGdos,
        adminId,
    })

    for (const [gdoId, n] of Object.entries(result.assigned['WEBINAR'] ?? {})) {
        report.perGdo[gdoId].webinar += n
    }
    for (const [gdoId, n] of Object.entries(result.assigned['NO_WEBINAR'] ?? {})) {
        report.perGdo[gdoId].noWebinar += n
    }
    report.totalAssigned = result.totalAssigned

    revalidatePath('/', 'layout')

    report.ok = report.totalAssigned > 0
    if (report.totalAssigned === 0 && report.errors.length === 0) {
        report.errors.push("Nessun lead pescato (il pool del bucket richiesto potrebbe essere vuoto).")
    }
    return report
}

// --- POOL LANCIO BLACK SUMMER (luglio 2026) ---
// La lista AC "Lead Lancio Black Summer 2026" è bloccata nel webhook
// (BLOCKED_LIST_NAMES_NORMALIZED): i lead entrano nel CRM SOLO via
// syncBlackSummerPool e vengono distribuiti da qui. Bucket unico,
// nessuna distinzione webinar (tutti da lista d'attesa).

const BLACK_SUMMER_BUCKET = 'BLACK_SUMMER'
const BLACK_SUMMER_COMPANY = 'fenice'

export async function getBlackSummerPoolStatus(): Promise<{ available: number } | null> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // La lista vive sull'account AC Fenice: con altra azienda attiva la card si nasconde.
    if (ctx.companyId !== BLACK_SUMMER_COMPANY) return null

    const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.launchBucket, BLACK_SUMMER_BUCKET),
            isNull(leads.assignedToId),
        ))
    return { available: rows[0]?.count ?? 0 }
}

export type BlackSummerAssignReport = {
    ok: boolean
    errors: string[]
    perGdo: Record<string, { count: number, name: string }>
    totalAssigned: number
}

export async function assignFromBlackSummerPool(input: { count: number; gdoIds: string[] }): Promise<BlackSummerAssignReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: BlackSummerAssignReport = { ok: false, errors: [], perGdo: {}, totalAssigned: 0 }

    if (ctx.companyId !== BLACK_SUMMER_COMPANY) {
        report.errors.push("Il pool Black Summer è disponibile solo con azienda attiva Fenice.")
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
    )))
        .filter((u: any) => u.role === 'GDO' && u.isActive === true)
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
        requests: [{ bucket: BLACK_SUMMER_BUCKET, count }],
        selectedGdos,
        adminId,
    })
    for (const [gdoId, n] of Object.entries(result.assigned[BLACK_SUMMER_BUCKET] ?? {})) {
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

// Client AC minimale con retry/backoff anti-429 — stessa logica dell'acGet
// del webhook Fenice (non esportato da lì: route handler). ~5 req/s per
// account, il backoff rispetta Retry-After.
const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com'
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || ''
const AC_MAX_RETRIES = 4
const BLACK_SUMMER_LIST_NAME_NORMALIZED = 'lead lancio black summer 2026'

async function acGet(path: string, attempt = 0): Promise<any> {
    const res = await fetch(`${AC_URL}/api/3${path}`, {
        headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
    })
    if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < AC_MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10000)
            : Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
        await new Promise((r) => setTimeout(r, backoffMs))
        return acGet(path, attempt + 1)
    }
    if (!res.ok) throw new Error(`AC API ${res.status}: ${await res.text()}`)
    return res.json()
}

async function findBlackSummerListId(): Promise<string | null> {
    for (let offset = 0; offset < 500; offset += 100) {
        const res = await acGet(`/lists?limit=100&offset=${offset}`)
        const lists = Array.isArray(res.lists) ? res.lists : []
        if (lists.length === 0) break
        for (const l of lists) {
            const nameNorm = String(l?.name ?? '').trim().toLowerCase()
            if (nameNorm === BLACK_SUMMER_LIST_NAME_NORMALIZED && l?.id != null) return String(l.id)
        }
        if (lists.length < 100) break
    }
    return null
}

export type BlackSummerSyncReport = {
    ok: boolean
    imported: number
    skippedExisting: number
    skippedNoPhone: number
    totalOnList: number
    errors: string[]
}

export async function syncBlackSummerPool(): Promise<BlackSummerSyncReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: BlackSummerSyncReport = {
        ok: false, imported: 0, skippedExisting: 0, skippedNoPhone: 0, totalOnList: 0, errors: [],
    }
    if (ctx.companyId !== BLACK_SUMMER_COMPANY) {
        report.errors.push("Il sync Black Summer è disponibile solo con azienda attiva Fenice.")
        return report
    }
    if (!AC_KEY) {
        report.errors.push("ACTIVECAMPAIGN_API_KEY non configurata sul server.")
        return report
    }

    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const adminId = supabaseUser?.id ?? null

    let listId: string | null = null
    try {
        listId = await findBlackSummerListId()
    } catch (e: any) {
        report.errors.push(`Errore AC durante la ricerca della lista: ${e?.message || e}`)
        return report
    }
    if (!listId) {
        report.errors.push(`Lista "Lead Lancio Black Summer 2026" non trovata su ActiveCampaign.`)
        return report
    }

    // acContactId già presenti (qualunque bucket/stato: mai due lead dallo
    // stesso contatto AC via sync). Solo la colonna, per non caricare righe intere.
    const existingRows = await db
        .select({ acContactId: leads.acContactId })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.acContactId),
        ))
    const existingIds = new Set(existingRows.map(r => r.acContactId as string))

    type NewLeadRow = typeof leads.$inferInsert
    const toInsert: NewLeadRow[] = []
    const importedContactIds: string[] = []

    try {
        // status=1 = iscrizione attiva alla lista. Paginazione difensiva:
        // hard-cap 20.000 contatti (200 pagine) per evitare loop su risposte anomale.
        for (let offset = 0; offset < 20000; offset += 100) {
            const page = await acGet(`/contacts?listid=${listId}&status=1&limit=100&offset=${offset}`)
            const contacts = Array.isArray(page.contacts) ? page.contacts : []
            if (offset === 0) report.totalOnList = Number(page?.meta?.total ?? contacts.length) || contacts.length
            if (contacts.length === 0) break

            for (const c of contacts) {
                const contactId = String(c?.id ?? '')
                if (!contactId) continue
                if (existingIds.has(contactId)) { report.skippedExisting++; continue }

                const rawPhone = String(c?.phone || '').trim()
                const phoneStrict = normalizePhoneStrict(rawPhone)
                const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone)
                const phoneFinal = phoneFinalNormalized?.startsWith('+39')
                    ? phoneFinalNormalized.slice(3)
                    : phoneFinalNormalized
                if (!rawPhone || !phoneFinal) { report.skippedNoPhone++; continue }

                const firstName = String(c?.firstName || '').trim()
                const lastName = String(c?.lastName || '').trim()
                const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome'
                const email = String(c?.email || '').trim() || null

                existingIds.add(contactId) // dedup anche intra-sync
                importedContactIds.push(contactId)
                toInsert.push({
                    id: crypto.randomUUID(),
                    name: fullName,
                    email,
                    phone: phoneFinal,
                    phoneSuspicious: !isPlausiblePhone(phoneStrict),
                    funnel: 'Black Summer',
                    source: 'activecampaign',
                    acContactId: contactId,
                    launchBucket: BLACK_SUMMER_BUCKET,
                    status: 'NEW',
                    assignedToId: null,
                    companyId: ctx.companyId,
                })
            }
            if (contacts.length < 100) break
        }
    } catch (e: any) {
        // Fallimento a metà: inseriamo comunque quanto raccolto (idempotente:
        // ri-cliccare riprende dai mancanti) e riportiamo l'errore.
        report.errors.push(`Errore AC durante il download dei contatti: ${e?.message || e} — importati quelli scaricati finora, riclicca per riprendere.`)
    }

    // Insert a chunk da 500 (niente eventi per-lead: vedi Global Constraints)
    for (let i = 0; i < toInsert.length; i += 500) {
        await db.insert(leads).values(toInsert.slice(i, i + 500))
        report.imported += Math.min(500, toInsert.length - i)
    }

    // Risolvi le failure "blocked_list" dei contatti ora importati, così
    // spariscono dal tab Bloccati di /lead-automatici.
    if (importedContactIds.length > 0) {
        for (let i = 0; i < importedContactIds.length; i += 500) {
            await db.update(acIntakeFailures)
                .set({ resolvedAt: new Date(), resolvedBy: adminId })
                .where(and(
                    eq(acIntakeFailures.companyId, ctx.companyId),
                    like(acIntakeFailures.reason, 'blocked_list:%'),
                    sql`${acIntakeFailures.resolvedAt} IS NULL`,
                    inArray(acIntakeFailures.acContactId, importedContactIds.slice(i, i + 500)),
                ))
        }
    }

    revalidatePath('/', 'layout')
    report.ok = report.errors.length === 0
    return report
}
