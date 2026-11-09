// Scrittura della notifica "lead Black Friday arrivato" (vedi notificaBf.ts).
// Idempotente sull'id (lead, GDO, ora di arrivo) e mai bloccante: se non
// riesce lo dice nei log, il lead è comunque in cima alla prima chiamata.
// La notifica entra in `notifications`: il trigger Broadcast esistente
// (migr. 0019, topic user:<id>) la porta alla campanella e al toast della
// Topbar. Nessun canale nuovo.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leadEvents, leads, notifications, users } from '@/db/schema'
import { oraArrivo, type EventoLead } from './arrivo'
import { daNotificareBf, notificaBf, type ArrivoBf } from './notificaBf'

/** Scrive le notifiche degli arrivi BF da notificare. Mai lancia. */
export async function scriviNotificheBf(arrivi: readonly ArrivoBf[], ora: Date = new Date()): Promise<number> {
    const righe = arrivi.filter(a => daNotificareBf(a, ora)).map(notificaBf)
    if (righe.length === 0) return 0
    try {
        const res = await db.insert(notifications).values(righe)
            .onConflictDoNothing({ target: notifications.id })
            .returning({ id: notifications.id })
        return res.length
    } catch (e) {
        console.error(`[notifica BF] ${righe.length} notifiche non scritte`, e)
        return 0
    }
}

/**
 * Dopo un'assegnazione: per i lead dati, se sono BF aperti in mano a un GDO
 * umano, notifica il GDO. L'ora di arrivo si ricostruisce dagli eventi come
 * nella pipeline, così la rete di sicurezza della pipeline trova la stessa
 * chiave e non duplica. Mai lancia.
 */
export async function notificaBfArrivati(leadIds: readonly string[], ora: Date = new Date()): Promise<number> {
    if (leadIds.length === 0) return 0
    try {
        const righe = await db.select({
            id: leads.id, name: leads.name, funnel: leads.funnel, status: leads.status,
            assignedToId: leads.assignedToId, assignedAt: leads.assignedAt, createdAt: leads.createdAt, companyId: leads.companyId,
        })
            .from(leads)
            .innerJoin(users, eq(users.id, leads.assignedToId))
            .where(and(
                inArray(leads.id, [...leadIds]),
                eq(users.role, 'GDO'), eq(users.isBot, false),
                sql`upper(trim(coalesce(${leads.funnel}, ''))) = 'BLACK FRIDAY'`,
            ))
        if (righe.length === 0) return 0
        const eventi = await db.select({
            leadId: leadEvents.leadId, eventType: leadEvents.eventType, userId: leadEvents.userId, timestamp: leadEvents.timestamp,
            toAssigneeId: sql<string | null>`${leadEvents.metadata}->>'toAssigneeId'`,
            assignedToUser: sql<string | null>`${leadEvents.metadata}->>'assignedToUser'`,
        })
            .from(leadEvents)
            .where(and(
                inArray(leadEvents.eventType, ['REASSIGNED_FROM_BOT', 'REASSIGNED_ADMIN', 'ASSIGNED']),
                inArray(leadEvents.leadId, righe.map(r => r.id)),
            ))
        const perLead = new Map<string, EventoLead[]>()
        for (const e of eventi) perLead.set(e.leadId, [...(perLead.get(e.leadId) ?? []), e])
        return await scriviNotificheBf(righe.map(r => ({
            leadId: r.id, gdoId: r.assignedToId!, nome: r.name, funnel: r.funnel, status: r.status, companyId: r.companyId,
            arrivo: oraArrivo({ eventi: perLead.get(r.id) ?? [], proprietario: r.assignedToId, assignedAt: r.assignedAt, createdAt: r.createdAt }),
        })), ora)
    } catch (e) {
        console.error('[notifica BF] lettura arrivi', e)
        return 0
    }
}
