/**
 * Lead "tolti e basta": aperti, senza assegnatario, ma che per decisione PO non
 * devono tornare a nessun GDO.
 *
 *  - evento `TOLTO_AL_BOT` (30/10/2026, persi inutili e flood lista 133 tolti al
 *    bot: scripts/diretta/togli-inutili-bot-30-10.ts);
 *  - `lancioPool = 'ARCHIVIATO'` (lancio tolto ai GDO il 24/10 e i 44 rimasti sul
 *    bot tolti il 30/10).
 *
 * Restano NEW/IN_PROGRESS con assignedToId nullo, quindi senza questo predicato
 * ricompaiono fra i "non assegnati" della Panoramica e nella ridistribuzione
 * manuale "Da assegnare" di /import, da cui qualcuno potrebbe ridarli ai GDO.
 *
 * `"leads"."id"` è scritto per esteso: in una select a tabella singola Drizzle
 * toglie la qualificazione a `${leads.id}` e dentro la sottoquery `"id"` finirebbe
 * su "leadEvents" (stessa trappola del cron della coda al bot). L'indice
 * lead_events_lead_id_idx copre la sonda.
 */
import { sql, type SQL } from 'drizzle-orm'

export const EVENTO_TOLTO_AL_BOT = 'TOLTO_AL_BOT'
export const LANCIO_POOL_ARCHIVIATO = 'ARCHIVIATO'

/** Vero se il lead NON è stato tolto ai GDO: da mettere su ogni elenco di non assegnati da assegnare. */
export function nonToltoAlBotSql(): SQL {
    return sql`("leads"."lancioPool" IS DISTINCT FROM ${LANCIO_POOL_ARCHIVIATO} AND NOT EXISTS (
        SELECT 1 FROM "leadEvents" tb
        WHERE tb."leadId" = "leads"."id" AND tb."eventType" = ${EVENTO_TOLTO_AL_BOT}
    ))`
}

