/**
 * Helper unificato per il conteggio "presenze GDO" usato da:
 *  - widget Tracker Bisettimanale (`getCurrentGdoGamificationState`)
 *  - tabella storico cicli (`getBiweeklyHistory`)
 *
 * Definizione canonica (PO 2026-07-17, latch `presentedAt`):
 *   - Lead `assignedToId = userId`
 *   - `presentedAt IS NOT NULL` ∈ [start, end)
 *   - + somma `manualAdjustments` (`type='presenze'`, `createdAt` nel range)
 *
 * `presentedAt` è il giorno dell'APPUNTAMENTO in cui il lead ha presenziato,
 * settato alla prima registrazione di un esito Chiuso/Non chiuso e mai più
 * sovrascritto: una presenza maturata non sparisce (nemmeno con "Sparito" a
 * un follow-up) e non migra mai di ciclo.
 *
 * Usare `gte(start) AND lt(end)` (end exclusive) per evitare off-by-one
 * ai bordi del ciclo bisettimanale.
 */

import { db } from "@/db";
import { leads, manualAdjustments } from "@/db/schema";
import { and, eq, gte, lt, isNotNull } from "drizzle-orm";

export interface PresenceCount {
    /** Presenze effettive (lead `Chiuso`/`Non chiuso` esitate nel range). */
    leadsPresences: number;
    /** Somma `count` degli aggiustamenti manuali admin nel range. */
    manualPresences: number;
    /** Totale = leadsPresences + manualPresences. */
    total: number;
}

/**
 * Conta presenze di un GDO nel range `[start, end)`.
 * `end` è exclusive. Scope: solo lead/aggiustamenti del tenant `companyId`.
 */
export async function countPresences(
    userId: string,
    start: Date,
    end: Date,
    companyId: string,
): Promise<PresenceCount> {
    const [leadsRows, adjustments] = await Promise.all([
        db.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, companyId),
            eq(leads.assignedToId, userId),
            isNotNull(leads.presentedAt),
            gte(leads.presentedAt, start),
            lt(leads.presentedAt, end),
        )),
        db.select({ count: manualAdjustments.count }).from(manualAdjustments).where(and(
            eq(manualAdjustments.companyId, companyId),
            eq(manualAdjustments.userId, userId),
            eq(manualAdjustments.type, 'presenze'),
            gte(manualAdjustments.createdAt, start),
            lt(manualAdjustments.createdAt, end),
        )).catch(() => [] as { count: number }[]),
    ]);

    const leadsPresences = leadsRows.length;
    const manualPresences = adjustments.reduce((s, a) => s + (a.count || 0), 0);
    return {
        leadsPresences,
        manualPresences,
        total: leadsPresences + manualPresences,
    };
}
