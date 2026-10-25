"use server"

// Forzieri di squadra visti dal GDO (nuova economia, PO 25/10/2026).
//
// Il contenuto del forziere è deciso e accreditato lato server quando il
// forziere viene consegnato (src/lib/economy/awards.ts): queste action non
// muovono nessun saldo. `openChest` segna soltanto l'apertura, che serve alla
// UI per l'animazione, e restituisce cosa c'era dentro. La persona è sempre
// quella in sessione: nessun id utente arriva dal client.

import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { teamChestAwards, teamChests } from "@/db/schema"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import type { ChestKind, ChestTier } from "@/lib/economy/rules"

export interface ForziereChiuso {
    chestId: string
    kind: ChestKind
    tier: ChestTier
    /** Giorno di Roma 'YYYY-MM-DD' in cui la squadra l'ha sbloccato. */
    giorno: string
    consegnatoAt: string
}

export type AperturaForziere =
    | { success: true; chestId: string; kind: ChestKind; tier: ChestTier; currency: 'S' | 'P'; amount: number; giaAperto: boolean }
    | { success: false; error: string }

const asKind = (k: string): ChestKind =>
    (k === 'giorno_2' || k === 'punta_1' || k === 'punta_2' ? k : 'giorno_1')
const asTier = (t: string): ChestTier => (t === 'leggendario' ? 'leggendario' : 'raro')

/** I miei forzieri consegnati e non ancora aperti, dal più vecchio. Il contenuto si scopre aprendoli. */
export async function getMyUnopenedChests(): Promise<ForziereChiuso[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const rows = await db.select({
        chestId: teamChestAwards.chestId,
        kind: teamChests.kind,
        tier: teamChests.tier,
        day: teamChests.day,
        createdAt: teamChestAwards.createdAt,
    })
        .from(teamChestAwards)
        .innerJoin(teamChests, eq(teamChests.id, teamChestAwards.chestId))
        .where(and(
            eq(teamChestAwards.userId, ctx.userId),
            isNull(teamChestAwards.openedAt),
        ))
        .orderBy(asc(teamChestAwards.createdAt))
        .limit(20)

    return rows.map(r => ({
        chestId: r.chestId,
        kind: asKind(r.kind),
        tier: asTier(r.tier),
        giorno: r.day,
        consegnatoAt: r.createdAt.toISOString(),
    }))
}

/**
 * Apre un mio forziere: segna openedAt (una volta sola) e restituisce il
 * contenuto. Le Scintille o la Piuma sono già nel saldo dalla consegna; aprirlo
 * due volte restituisce lo stesso contenuto con giaAperto = true.
 */
export async function openChest(chestId: string): Promise<AperturaForziere> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (typeof chestId !== 'string' || !chestId) return { success: false, error: 'Forziere non valido' }

    const [row] = await db.select({
        awardId: teamChestAwards.id,
        currency: teamChestAwards.currency,
        amount: teamChestAwards.amount,
        openedAt: teamChestAwards.openedAt,
        kind: teamChests.kind,
        tier: teamChests.tier,
    })
        .from(teamChestAwards)
        .innerJoin(teamChests, eq(teamChests.id, teamChestAwards.chestId))
        .where(and(
            eq(teamChestAwards.chestId, chestId),
            eq(teamChestAwards.userId, ctx.userId),
        ))
        .limit(1)
    if (!row) return { success: false, error: 'Forziere non trovato' }

    if (!row.openedAt) {
        await db.update(teamChestAwards)
            .set({ openedAt: new Date() })
            .where(and(eq(teamChestAwards.id, row.awardId), isNull(teamChestAwards.openedAt)))
    }

    return {
        success: true,
        chestId,
        kind: asKind(row.kind),
        tier: asTier(row.tier),
        currency: row.currency === 'P' ? 'P' : 'S',
        amount: row.amount,
        giaAperto: !!row.openedAt,
    }
}
