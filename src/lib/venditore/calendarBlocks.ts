/**
 * Blocchi automatici del calendario a partire dai follow-up.
 *
 * Un follow-up fissato alle 18:00 occupa lo slot delle 18: le Conferme lo
 * vedono occupato e nessuno ci fissa sopra un appuntamento. Quando il follow-up
 * si sposta, il blocco si sposta; quando il lead va "In lavorazione" o riceve un
 * esito, il blocco cade.
 *
 * Il blocco si crea anche su uno slot che il venditore non aveva dichiarato:
 * disponibilità e occupazione sono due fatti distinti.
 */

import { salesSlotBlocks } from '@/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { slotStartFor } from './calendarSlots'

type Db = { insert: any; update: any; delete: any; select: any }

/**
 * Allinea il blocco FOLLOWUP di un lead alla sua data di follow-up.
 * `followUpAt` null, o fuori dalla griglia oraria, significa nessun blocco.
 */
export async function syncFollowUpBlock(tx: Db, params: {
    companyId: string
    /** Null = il lead non ha un venditore: non c'e' nessun calendario da occupare. */
    salesUserId: string | null
    leadId: string
    followUpAt: Date | null
    actorId: string
}): Promise<void> {
    // Senza venditore non si blocca il calendario di nessuno — men che meno
    // quello di chi sta agendo, che con questo lead non c'entra. L'eventuale
    // blocco rimasto da un'assegnazione precedente si libera.
    if (!params.salesUserId) {
        await releaseFollowUpBlock(tx, { leadId: params.leadId })
        return
    }
    const slot = params.followUpAt ? slotStartFor(params.followUpAt) : null
    if (!slot) {
        await releaseFollowUpBlock(tx, { leadId: params.leadId })
        return
    }
    // Righe dello stesso lead rimaste su ALTRI venditori (riassegnazioni o
    // percorsi che in passato non liberavano): vanno tolte prima dell'UPDATE.
    // L'unique parziale è (salesUserId, leadId): due orfane su due venditori
    // diversi convivono a DB, ma l'UPDATE qui sotto le porterebbe entrambe
    // sullo stesso salesUserId violando l'indice e facendo fallire il
    // salvataggio di un esito. Un lead tiene un solo slot, per definizione.
    await tx.delete(salesSlotBlocks).where(and(
        eq(salesSlotBlocks.leadId, params.leadId),
        eq(salesSlotBlocks.kind, 'FOLLOWUP'),
        ne(salesSlotBlocks.salesUserId, params.salesUserId),
    ))

    // L'unique parziale (salesUserId, leadId) where kind='FOLLOWUP' garantisce
    // che un lead tenga un solo slot: qui si aggiorna, non si accumula.
    const updated = await tx.update(salesSlotBlocks)
        .set({ slotStart: slot, salesUserId: params.salesUserId })
        .where(and(
            eq(salesSlotBlocks.leadId, params.leadId),
            eq(salesSlotBlocks.kind, 'FOLLOWUP'),
        ))
        .returning({ id: salesSlotBlocks.id })

    if (updated.length === 0) {
        await tx.insert(salesSlotBlocks).values({
            id: crypto.randomUUID(),
            companyId: params.companyId,
            salesUserId: params.salesUserId,
            slotStart: slot,
            kind: 'FOLLOWUP',
            leadId: params.leadId,
            createdBy: params.actorId,
        }).onConflictDoNothing()
    }
}

/** Toglie il blocco follow-up di un lead (esito registrato, park, riassegnazione). */
export async function releaseFollowUpBlock(tx: Db, params: {
    leadId: string
    salesUserId?: string
}): Promise<void> {
    const conds = [
        eq(salesSlotBlocks.leadId, params.leadId),
        eq(salesSlotBlocks.kind, 'FOLLOWUP'),
    ]
    if (params.salesUserId) conds.push(eq(salesSlotBlocks.salesUserId, params.salesUserId))
    await tx.delete(salesSlotBlocks).where(and(...conds))
}
