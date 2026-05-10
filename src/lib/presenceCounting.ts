/**
 * Helper unificato per il conteggio "presenze GDO" usato da:
 *  - widget Tracker Bisettimanale (`getCurrentBiweeklyBonusState`)
 *  - tabella storico cicli (`getBiweeklyHistory`)
 *  - KPI `getGdoLeadOutcomeMetrics` (modalità 'outcome')
 *
 * Definizione canonica (Sprint 1.5 estesa):
 *   - Lead `assignedToId = userId`
 *   - `salespersonOutcome IN ('Chiuso','Non chiuso')` → `isPresenziato`
 *   - `salespersonOutcomeAt` ∈ [start, end)
 *   - + somma `manualAdjustments` (`type='presenze'`, `createdAt` nel range)
 *
 * Usare `gte(start) AND lt(end)` (end exclusive) per evitare off-by-one
 * ai bordi del ciclo bisettimanale.
 */

import { db } from "@/db";
import { leads, manualAdjustments } from "@/db/schema";
import { and, eq, gte, lt, inArray, isNotNull } from "drizzle-orm";

const PRESENCE_OUTCOMES = ['Chiuso', 'Non chiuso'] as const;

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
 * `end` è exclusive.
 */
export async function countPresences(
    userId: string,
    start: Date,
    end: Date,
): Promise<PresenceCount> {
    const [leadsRows, adjustments] = await Promise.all([
        db.select({ id: leads.id }).from(leads).where(and(
            eq(leads.assignedToId, userId),
            inArray(leads.salespersonOutcome, PRESENCE_OUTCOMES as unknown as string[]),
            isNotNull(leads.salespersonOutcomeAt),
            gte(leads.salespersonOutcomeAt, start),
            lt(leads.salespersonOutcomeAt, end),
        )),
        db.select({ count: manualAdjustments.count }).from(manualAdjustments).where(and(
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
