"use server"

/**
 * Heartbeat DB della presence Conferme (Task P1, 2026-07-05).
 *
 * Problema: la presence via Supabase Realtime (channel `conferme_realtime_board`,
 * vedi src/lib/confermePresence.ts) e' il segnale "instant" ma e' inaffidabile
 * su reti/tab instabili — gli operatori a volte non si vedono online a vicenda
 * o non vedono su che lead sta lavorando il collega.
 *
 * Soluzione: il client fa upsert di un heartbeat su DB ogni 45s + a ogni
 * cambio di attivita' (agganciato al singleton esistente in confermePresence.ts,
 * NON un secondo canale realtime). Il Radar considera "presente" chi ha un
 * heartbeat fresco (< 90s) qui OPPURE e' visibile via Realtime.
 *
 * Scritture trascurabili: ~4 operatori Conferme x 1 upsert/45s.
 */

import { db } from "@/db"
import { presenceHeartbeats, users } from "@/db/schema"
import { eq, and, gte } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"

/** Heartbeat considerato "fresco" se aggiornato entro questa finestra.
 *  Non esportata: un file "use server" può esportare solo funzioni async
 *  (i valori/const runtime rompono la compilazione delle server action). */
const HEARTBEAT_FRESH_MS = 90_000

export type ConfermeHeartbeat = {
    userId: string
    name: string | null
    activity: string
    leadId: string | null
    updatedAt: Date
}

/**
 * Upsert dell'heartbeat dell'utente corrente. Chiamata dal client ogni 45s
 * e a ogni cambio di attivita' (setConfermeActivity in confermePresence.ts).
 */
export async function upsertHeartbeat(activity: string, leadId: string | null): Promise<void> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    await db.insert(presenceHeartbeats)
        .values({
            userId: ctx.userId,
            companyId: ctx.companyId,
            activity,
            leadId,
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: presenceHeartbeats.userId,
            set: {
                companyId: ctx.companyId,
                activity,
                leadId,
                updatedAt: new Date(),
            },
        })
}

/**
 * Heartbeat freschi (< 90s) dell'azienda corrente, con nome utente per il
 * Radar. Usata come fallback/merge rispetto alla presence Realtime.
 */
export async function getConfermeHeartbeats(): Promise<ConfermeHeartbeat[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const freshSince = new Date(Date.now() - HEARTBEAT_FRESH_MS)
    const rows = await db.select({
        userId: presenceHeartbeats.userId,
        displayName: users.displayName,
        name: users.name,
        activity: presenceHeartbeats.activity,
        leadId: presenceHeartbeats.leadId,
        updatedAt: presenceHeartbeats.updatedAt,
    })
        .from(presenceHeartbeats)
        .innerJoin(users, eq(users.id, presenceHeartbeats.userId))
        .where(and(
            companyScope(ctx, presenceHeartbeats.companyId),
            gte(presenceHeartbeats.updatedAt, freshSince),
        ))

    return rows.map(r => ({
        userId: r.userId,
        name: r.displayName || r.name,
        activity: r.activity,
        leadId: r.leadId,
        updatedAt: r.updatedAt,
    }))
}
