"use server"

import { db } from "@/db"
import { leads } from "@/db/schema"
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { users } from "@/db/schema"
import { inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { logLeadEvent } from "@/lib/eventLogger"
import { previewLeadDistribution } from "@/lib/distributionUtils"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

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
