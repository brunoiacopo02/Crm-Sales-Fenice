// Lettura dal DB delle note scritte dal bot, per toglierle ai GDO lato server
// (vedi noteBotPerGdo.ts). Una query sola per tutta la board, a blocchi di 1000.

import { db } from '@/db'
import { callLogs, users } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { leadPerGdo, type CampiTestoLead, type NoteDelBot } from './noteBotPerGdo'

const VUOTO: NoteDelBot = new Set()

/** Per ogni lead, i testi (nota e motivo di scarto) delle chiamate registrate da un utente bot. */
export async function noteDelBotPerLead(leadIds: readonly string[]): Promise<Map<string, Set<string>>> {
    const mappa = new Map<string, Set<string>>()
    const ids = [...new Set(leadIds.filter(Boolean))]
    for (let i = 0; i < ids.length; i += 1000) {
        const righe = await db.select({ leadId: callLogs.leadId, note: callLogs.note, discardReason: callLogs.discardReason })
            .from(callLogs)
            .innerJoin(users, eq(users.id, callLogs.userId))
            .where(and(eq(users.isBot, true), inArray(callLogs.leadId, ids.slice(i, i + 1000))))
        for (const r of righe) {
            for (const t of [r.note, r.discardReason]) {
                const testo = t?.trim()
                if (!testo) continue
                const set = mappa.get(r.leadId)
                if (set) set.add(testo)
                else mappa.set(r.leadId, new Set([testo]))
            }
        }
    }
    return mappa
}

/** Le note del bot su un lead solo. */
export async function noteDelBotSulLead(leadId: string): Promise<NoteDelBot> {
    return (await noteDelBotPerLead([leadId])).get(leadId) ?? VUOTO
}

/**
 * I lead come li deve ricevere il browser di un GDO. Se la lettura fallisce si
 * tolgono comunque report e info del bot, e le note si lasciano vuote: meglio
 * una nota in meno che una nota del bot in più.
 */
export async function leadsPerGdo<T extends CampiTestoLead & { id: string }>(lista: readonly T[]): Promise<T[]> {
    if (lista.length === 0) return []
    try {
        const mappa = await noteDelBotPerLead(lista.map(l => l.id))
        return lista.map(l => leadPerGdo(l, mappa.get(l.id) ?? VUOTO))
    } catch (e) {
        console.error('[note bot GDO] lettura note del bot fallita, note tolte', e)
        return lista.map(l => leadPerGdo({ ...l, lastCallNote: null, recallNote: null, appointmentNote: null }, VUOTO))
    }
}
