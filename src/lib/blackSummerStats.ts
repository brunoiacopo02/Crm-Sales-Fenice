import { db } from "@/db"
import { leads, callLogs } from "@/db/schema"
import { and, eq, gte, lte, sql } from "drizzle-orm"

const BS_FUNNEL = 'Black Summer'
const BS_COMPANY = 'fenice'

export type BlackSummerStageStats = {
    chiamati: number
    fissati: number
    confermati: number
    chiusi: number
}

export type BlackSummerLaunchStats = {
    totale: number
    assegnati: number
    poolResiduo: number
    oggi: BlackSummerStageStats
    totaleLancio: BlackSummerStageStats
}

/**
 * Statistiche del lancio Black Summer per il pannello di /appuntamenti-oggi.
 * Perimetro: funnel 'Black Summer' + company fenice (lead dal pool E caricati
 * a mano dal TL, bonificati 2026-07-13). Definizioni allineate al canon:
 * fissati = appointmentCreatedAt (stessa base della lista "Fissati Oggi"),
 * confermati = confirmationsOutcome 'confermato', chiusi = salespersonOutcome
 * 'Chiuso'. Sola lettura.
 */
export async function getBlackSummerLaunchStats(todayStart: Date, todayEnd: Date): Promise<BlackSummerLaunchStats> {
    const base = and(eq(leads.companyId, BS_COMPANY), eq(leads.funnel, BS_FUNNEL))

    const [agg] = await db
        .select({
            totale: sql<number>`count(*)::int`,
            assegnati: sql<number>`count(*) FILTER (WHERE ${leads.assignedToId} IS NOT NULL)::int`,
            poolResiduo: sql<number>`count(*) FILTER (WHERE ${leads.assignedToId} IS NULL)::int`,
            chiamatiTot: sql<number>`count(*) FILTER (WHERE ${leads.callCount} >= 1)::int`,
            fissatiTot: sql<number>`count(*) FILTER (WHERE ${leads.appointmentCreatedAt} IS NOT NULL)::int`,
            confermatiTot: sql<number>`count(*) FILTER (WHERE ${leads.confirmationsOutcome} = 'confermato')::int`,
            chiusiTot: sql<number>`count(*) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso')::int`,
            fissatiOggi: sql<number>`count(*) FILTER (WHERE ${leads.appointmentCreatedAt} >= ${todayStart} AND ${leads.appointmentCreatedAt} <= ${todayEnd})::int`,
            confermatiOggi: sql<number>`count(*) FILTER (WHERE ${leads.confirmationsOutcome} = 'confermato' AND ${leads.confirmationsTimestamp} >= ${todayStart} AND ${leads.confirmationsTimestamp} <= ${todayEnd})::int`,
            chiusiOggi: sql<number>`count(*) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso' AND ${leads.salespersonOutcomeAt} >= ${todayStart} AND ${leads.salespersonOutcomeAt} <= ${todayEnd})::int`,
        })
        .from(leads)
        .where(base)

    // Chiamati oggi: lead BS distinti con almeno un callLog odierno.
    const [chiamatiOggiRow] = await db
        .select({ n: sql<number>`count(DISTINCT ${callLogs.leadId})::int` })
        .from(callLogs)
        .innerJoin(leads, eq(callLogs.leadId, leads.id))
        .where(and(
            base,
            gte(callLogs.createdAt, todayStart),
            lte(callLogs.createdAt, todayEnd),
        ))

    return {
        totale: agg?.totale ?? 0,
        assegnati: agg?.assegnati ?? 0,
        poolResiduo: agg?.poolResiduo ?? 0,
        oggi: {
            chiamati: chiamatiOggiRow?.n ?? 0,
            fissati: agg?.fissatiOggi ?? 0,
            confermati: agg?.confermatiOggi ?? 0,
            chiusi: agg?.chiusiOggi ?? 0,
        },
        totaleLancio: {
            chiamati: agg?.chiamatiTot ?? 0,
            fissati: agg?.fissatiTot ?? 0,
            confermati: agg?.confermatiTot ?? 0,
            chiusi: agg?.chiusiTot ?? 0,
        },
    }
}
