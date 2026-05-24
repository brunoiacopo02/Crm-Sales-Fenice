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

    // Pesca atomica per ciascun bucket richiesto
    const pickedByBucket: Record<'WEBINAR' | 'NO_WEBINAR', string[]> = { WEBINAR: [], NO_WEBINAR: [] }

    await db.transaction(async (tx) => {
        for (const [bucket, n] of [['WEBINAR', webinarCount], ['NO_WEBINAR', noWebinarCount]] as const) {
            if (n === 0) continue
            const picked = await tx.execute(sql`
                SELECT id FROM leads
                WHERE "launchBucket" = ${bucket}
                  AND "assignedToId" IS NULL
                  AND "companyId" = ${ctx.companyId}
                ORDER BY "createdAt" ASC
                LIMIT ${n}
                FOR UPDATE SKIP LOCKED
            `)
            // drizzle-orm node-postgres restituisce { rows: [{id: ...}, ...] }
            const ids: string[] = (picked as any).rows
                ? (picked as any).rows.map((r: any) => r.id)
                : (picked as any).map((r: any) => r.id)
            pickedByBucket[bucket] = ids
        }

        // Split round-robin equo per ciascun bucket sui GDO selezionati
        for (const bucket of ['WEBINAR', 'NO_WEBINAR'] as const) {
            const ids = pickedByBucket[bucket]
            if (ids.length === 0) continue

            const distr = previewLeadDistribution(ids.length, selectedGdos, 'equal', {})
            const assignPlan: string[] = []
            for (const gdoId in distr) {
                for (let i = 0; i < distr[gdoId].count; i++) assignPlan.push(gdoId)
            }

            // UPDATE in batch: un update per ciascun GDO con gli id che gli toccano
            const idsByGdo: Record<string, string[]> = {}
            for (let i = 0; i < ids.length; i++) {
                const gdo = assignPlan[i] || selectedGdos[0].id
                if (!idsByGdo[gdo]) idsByGdo[gdo] = []
                idsByGdo[gdo].push(ids[i])
            }
            for (const [gdoId, leadIds] of Object.entries(idsByGdo)) {
                // Usa il query builder: il template sql`${arr}::text[]` esplode l'array
                // in N placeholder distinti (record), non in un array PG → cast fallisce.
                await tx
                    .update(leads)
                    .set({ assignedToId: gdoId, updatedAt: new Date() })
                    .where(and(
                        eq(leads.companyId, ctx.companyId),
                        inArray(leads.id, leadIds),
                    ))
                if (bucket === 'WEBINAR') report.perGdo[gdoId].webinar += leadIds.length
                else report.perGdo[gdoId].noWebinar += leadIds.length
                report.totalAssigned += leadIds.length
            }
        }
    })

    // Log eventi ASSIGNED (fuori dalla tx per non bloccarla)
    for (const bucket of ['WEBINAR', 'NO_WEBINAR'] as const) {
        const ids = pickedByBucket[bucket]
        if (ids.length === 0) continue
        const assignedRows = await db
            .select({ id: leads.id, assignedToId: leads.assignedToId })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                inArray(leads.id, ids),
            ))

        for (const row of assignedRows) {
            await logLeadEvent({
                leadId: row.id,
                eventType: 'ASSIGNED',
                userId: adminId,
                metadata: { source: 'launch_pool', bucket, assignedToUser: row.assignedToId },
                companyId: ctx.companyId,
            })
        }
    }

    revalidatePath('/', 'layout')

    report.ok = report.totalAssigned > 0
    if (report.totalAssigned === 0 && report.errors.length === 0) {
        report.errors.push("Nessun lead pescato (il pool del bucket richiesto potrebbe essere vuoto).")
    }
    return report
}
