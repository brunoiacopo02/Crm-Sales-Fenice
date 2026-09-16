/**
 * Contatori del Monitor lancio (spec §4.3), dagli eventi e dalle colonne del
 * CRM. Modello: la card Black Summer di /import. Una query sui lead del bucket
 * con `count(*) filter (...)` + una sugli eventi.
 *
 * Quello che il CRM NON ha non si inventa: i quattro contatori del bot
 * (benvenuto consegnato, hanno risposto, posto bloccato, link inviato) vivono
 * nel suo database e qui escono solo come etichette in `soloBot`.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leadEvents, leads } from '@/db/schema'
import { DELIVERED_PUSH_RESULTS_SQL } from '@/lib/bot-fissatore/pushAudit'
import { LANCIO_WEBDEV, CALL_NOW_MAX_ATTEMPTS, type LancioConfig } from './config'

export interface LancioMonitor {
    inLista: number
    spintiAlBot: number
    pulsantePremuto: number
    chiamateSubito: { assegnate: number; esitate: number; chiuse: number; euro: number; passateAlleConferme: number }
    prenotati: { mattina: number; pomeriggio: number; dopodomani: number }
    followupRisposti: number
    restituitiAlPool: number
    distribuitiAiGdo: number
    /** Contatori che vivono nel DB del bot: il CRM non li ha. */
    soloBot: string[]
}

export async function getLancioMonitor(
    companyId: string,
    botUserId: string | null,
    cfg: LancioConfig = LANCIO_WEBDEV,
): Promise<LancioMonitor> {
    const inBucket = and(eq(leads.companyId, companyId), eq(leads.launchBucket, cfg.bucket))

    const [c] = await db.select({
        inLista: sql<number>`count(*)::int`,
        pulsantePremuto: sql<number>`count(*) filter (where ${leads.lancioIngresso} = 'pulsante_webinar' or ${leads.lancioScelta} is not null)::int`,
        csAssegnate: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'chiamata_subito')::int`,
        csEsitate: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'chiamata_subito' and ${leads.salespersonOutcome} is not null)::int`,
        csChiuse: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'chiamata_subito' and ${leads.salespersonOutcome} = 'Chiuso')::int`,
        csEuro: sql<number>`coalesce(sum(${leads.closeAmountEur}) filter (where ${leads.lancioScelta} = 'chiamata_subito' and ${leads.salespersonOutcome} = 'Chiuso'), 0)::float`,
        csConferme: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'chiamata_subito' and ${leads.lancioCallNowAttempts} >= ${CALL_NOW_MAX_ATTEMPTS} and ${leads.salespersonUserId} is null)::int`,
        mattina: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'app_mattina')::int`,
        pomeriggio: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'app_pomeriggio')::int`,
        dopodomani: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'app_dopodomani')::int`,
        followup: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'followup')::int`,
        aiGdo: botUserId
            ? sql<number>`count(*) filter (where ${leads.assignedToId} is not null and ${leads.assignedToId} <> ${botUserId})::int`
            : sql<number>`count(*) filter (where ${leads.assignedToId} is not null)::int`,
    }).from(leads).where(inBucket)

    // Consegnati = 'sent' o 'duplicate' (pushAudit): un duplicate e' comunque
    // arrivato al bot. `count(distinct leadId)`: i retry non gonfiano il numero.
    const [ev] = await db.select({
        spinti: sql<number>`count(distinct ${leadEvents.leadId}) filter (where ${leadEvents.eventType} = 'BOT_PUSHED' and ${leadEvents.metadata}->>'result' in (${sql.raw(DELIVERED_PUSH_RESULTS_SQL)}))::int`,
        restituiti: sql<number>`count(distinct ${leadEvents.leadId}) filter (where ${leadEvents.eventType} = 'LANCIO_RETURNED_TO_POOL')::int`,
    }).from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(inBucket)

    return {
        inLista: c?.inLista ?? 0,
        spintiAlBot: ev?.spinti ?? 0,
        pulsantePremuto: c?.pulsantePremuto ?? 0,
        chiamateSubito: {
            assegnate: c?.csAssegnate ?? 0,
            esitate: c?.csEsitate ?? 0,
            chiuse: c?.csChiuse ?? 0,
            euro: c?.csEuro ?? 0,
            passateAlleConferme: c?.csConferme ?? 0,
        },
        prenotati: { mattina: c?.mattina ?? 0, pomeriggio: c?.pomeriggio ?? 0, dopodomani: c?.dopodomani ?? 0 },
        followupRisposti: c?.followup ?? 0,
        restituitiAlPool: ev?.restituiti ?? 0,
        distribuitiAiGdo: c?.aiGdo ?? 0,
        soloBot: ['Benvenuto consegnato', 'Hanno risposto', 'Posto bloccato', 'Link Zoom inviato'],
    }
}
