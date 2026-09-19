/**
 * Contatori "a imbuto" di un lancio per il pannello di /appuntamenti-oggi:
 * chiamati → fissati → confermati → chiusi, una riga per OGGI e una per il
 * TOTALE del lancio.
 *
 * Nasce dal monitor del lancio Black Summer (`src/lib/blackSummerStats.ts`,
 * commit 85498d7), rimosso il 27/08/2026 a lancio finito (commit 847ee0f).
 * Qui è lo stesso calcolo, ma PARAMETRICO sul perimetro del lancio: il
 * prossimo lancio si accende passando funnel e bucket, senza ricopiare il
 * modulo una terza volta.
 *
 * Attenzione a non confonderlo con `src/lib/lancio/monitor.ts`: quello misura
 * il FLUSSO del lancio Web Dev AI (spinte al bot, scelte del lead,
 * prenotazioni) sulla pagina /lancio. Questo misura la RESA commerciale.
 *
 * Definizioni allineate al canon e alla lista "Fissati Oggi" della stessa
 * pagina: fissati = appointmentCreatedAt, confermati = confirmationsOutcome
 * 'confermato' (data confirmationsTimestamp), chiusi = salespersonOutcome
 * 'Chiuso' (data salespersonOutcomeAt). Sola lettura.
 *
 * La finestra "oggi" arriva da `dayBoundsRome`: `dayEnd` è ESCLUSIVO
 * (mezzanotte del giorno dopo), come da convenzione di `@/lib/dateUtils`.
 */
import { db } from "@/db"
import { leads, callLogs } from "@/db/schema"
import { and, eq, gte, lt, or, sql, type SQL } from "drizzle-orm"

/** Perimetro di un lancio: azienda + funnel + (opzionale) bucket del pool. */
export type LaunchPerimeter = {
    companyId: string
    /** Grafia del funnel a DB, es. 'Lancio Web Dev AI'. */
    funnel: string
    /**
     * Bucket del pool, es. 'LANCIO_WEBDEV_2026'. Sta in OR col funnel: prende
     * sia i lead arrivati dal pool sia quelli caricati a mano col funnel del
     * lancio (è la stessa doppia prova di appartenenza usata dalla dedup in
     * lancioPoolActions).
     */
    bucket?: string | null
}

export type LaunchStageStats = {
    chiamati: number
    fissati: number
    confermati: number
    chiusi: number
    /** Somma closeAmountEur dei lead chiusi dello stadio (0 se nessuno). */
    fatturatoEur: number
}

export type LaunchPipelineStats = {
    totale: number
    assegnati: number
    poolResiduo: number
    oggi: LaunchStageStats
    totaleLancio: LaunchStageStats
}

export const EMPTY_LAUNCH_PIPELINE_STATS: LaunchPipelineStats = {
    totale: 0,
    assegnati: 0,
    poolResiduo: 0,
    oggi: { chiamati: 0, fissati: 0, confermati: 0, chiusi: 0, fatturatoEur: 0 },
    totaleLancio: { chiamati: 0, fissati: 0, confermati: 0, chiusi: 0, fatturatoEur: 0 },
}

function perimeterWhere(p: LaunchPerimeter): SQL | undefined {
    const appartenenza = p.bucket
        ? or(eq(leads.funnel, p.funnel), eq(leads.launchBucket, p.bucket))
        : eq(leads.funnel, p.funnel)
    return and(eq(leads.companyId, p.companyId), appartenenza)
}

export async function getLaunchPipelineStats(
    perimeter: LaunchPerimeter,
    dayStart: Date,
    /** Mezzanotte del giorno dopo: bound ESCLUSIVO. */
    dayEndExclusive: Date,
): Promise<LaunchPipelineStats> {
    const base = perimeterWhere(perimeter)

    const [agg] = await db
        .select({
            totale: sql<number>`count(*)::int`,
            assegnati: sql<number>`count(*) FILTER (WHERE ${leads.assignedToId} IS NOT NULL)::int`,
            poolResiduo: sql<number>`count(*) FILTER (WHERE ${leads.assignedToId} IS NULL)::int`,
            chiamatiTot: sql<number>`count(*) FILTER (WHERE ${leads.callCount} >= 1)::int`,
            fissatiTot: sql<number>`count(*) FILTER (WHERE ${leads.appointmentCreatedAt} IS NOT NULL)::int`,
            confermatiTot: sql<number>`count(*) FILTER (WHERE ${leads.confirmationsOutcome} = 'confermato')::int`,
            chiusiTot: sql<number>`count(*) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso')::int`,
            fissatiOggi: sql<number>`count(*) FILTER (WHERE ${leads.appointmentCreatedAt} >= ${dayStart} AND ${leads.appointmentCreatedAt} < ${dayEndExclusive})::int`,
            confermatiOggi: sql<number>`count(*) FILTER (WHERE ${leads.confirmationsOutcome} = 'confermato' AND ${leads.confirmationsTimestamp} >= ${dayStart} AND ${leads.confirmationsTimestamp} < ${dayEndExclusive})::int`,
            chiusiOggi: sql<number>`count(*) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso' AND ${leads.salespersonOutcomeAt} >= ${dayStart} AND ${leads.salespersonOutcomeAt} < ${dayEndExclusive})::int`,
            fatturatoTot: sql<number>`COALESCE(sum(${leads.closeAmountEur}) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso'), 0)::float`,
            fatturatoOggi: sql<number>`COALESCE(sum(${leads.closeAmountEur}) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso' AND ${leads.salespersonOutcomeAt} >= ${dayStart} AND ${leads.salespersonOutcomeAt} < ${dayEndExclusive}), 0)::float`,
        })
        .from(leads)
        .where(base)

    // Chiamati oggi: lead del lancio distinti con almeno un callLog odierno.
    const [chiamatiOggiRow] = await db
        .select({ n: sql<number>`count(DISTINCT ${callLogs.leadId})::int` })
        .from(callLogs)
        .innerJoin(leads, eq(callLogs.leadId, leads.id))
        .where(and(
            base,
            gte(callLogs.createdAt, dayStart),
            lt(callLogs.createdAt, dayEndExclusive),
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
            fatturatoEur: agg?.fatturatoOggi ?? 0,
        },
        totaleLancio: {
            chiamati: agg?.chiamatiTot ?? 0,
            fissati: agg?.fissatiTot ?? 0,
            confermati: agg?.confermatiTot ?? 0,
            chiusi: agg?.chiusiTot ?? 0,
            fatturatoEur: agg?.fatturatoTot ?? 0,
        },
    }
}
