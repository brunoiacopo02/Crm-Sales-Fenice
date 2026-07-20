// Helper condivisi dei pool di /import (Videoeditor, Black Summer, Database
// mensili). Estratti da launchPoolActions.ts (spec 2026-07-20): i file
// actions/ sono "use server" e possono esportare solo async function per il
// client — le utility condivise vivono qui.
import { db } from "@/db"
import { leads, leadEvents } from "@/db/schema"
import { and, eq, sql, inArray } from "drizzle-orm"
import { previewLeadDistribution } from "@/lib/distributionUtils"
import crypto from "crypto"

export type BucketRequest = { bucket: string; count: number }
export type PickAssignResult = {
    /** bucket → gdoId → n. lead assegnati */
    assigned: Record<string, Record<string, number>>
    totalAssigned: number
}

/**
 * Pesca atomica (FOR UPDATE SKIP LOCKED, FIFO su createdAt con tiebreaker id —
 * i lead da sync bulk hanno createdAt identico, stessa lezione del fix
 * pipeline sort 49a61b0) e split equo round-robin sui GDO selezionati.
 * Logga gli eventi ASSIGNED fuori dalla transazione. Condiviso tra pool
 * Videoeditor (WEBINAR/NO_WEBINAR), Black Summer (BLACK_SUMMER) e Database
 * mensili (DB_*).
 */
export async function pickAndAssignBuckets(params: {
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

    // Log eventi ASSIGNED (fuori dalla tx per non bloccarla). Bulk a chunk: 3000
    // insert sequenziali post-tx morivano a metà — lezione review finale. Righe
    // costruite a mano per replicare ESATTAMENTE la shape di logLeadEvent
    // (che qui fa solo un insert singolo su leadEvents, nessun side-effect).
    for (const [bucket, ids] of Object.entries(pickedByBucket)) {
        if (ids.length === 0) continue
        const assignedRows = await db
            .select({ id: leads.id, assignedToId: leads.assignedToId })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                inArray(leads.id, ids),
            ))
        const eventRows = assignedRows.map((row) => ({
            id: crypto.randomUUID(),
            leadId: row.id,
            eventType: 'ASSIGNED' as const,
            userId: adminId || null,
            fromSection: null,
            toSection: null,
            metadata: { source: 'launch_pool', bucket, assignedToUser: row.assignedToId },
            timestamp: new Date(),
            companyId,
        }))
        for (let i = 0; i < eventRows.length; i += 500) {
            await db.insert(leadEvents).values(eventRows.slice(i, i + 500))
        }
    }

    return result
}

// Client AC minimale con retry/backoff anti-429 — stessa logica dell'acGet
// del webhook Fenice (non esportato da lì: route handler). ~5 req/s per
// account, il backoff rispetta Retry-After.
const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com'
export const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || ''
const AC_MAX_RETRIES = 4

export async function acGet(path: string, attempt = 0): Promise<any> {
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
