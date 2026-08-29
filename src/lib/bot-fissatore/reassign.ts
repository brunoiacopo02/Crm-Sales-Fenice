import { db } from '@/db';
import { leads, users, leadEvents } from '@/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { isLeadLocked } from './contactRequests';

const FENICE = 'fenice';

export type ReassignReason = 'mai_risposto' | 'chat_interrotta';

type ReassignResult =
    | { ok: true; assignedToId: string }
    | { ok: true; assignedToId: null; note: 'no_eligible_gdo' | 'locked_appointment' | 'already_rejected' | 'lead_not_found' };

/**
 * Restituisce al pool umano un lead che il bot non ha convertito (mai risposto /
 * chat interrotta senza obiezione ferrea). Riassegna a un GDO umano con lo STESSO
 * round-robin dei lead nuovi AC (pool: role=GDO, isActive, acAutoIntake, isBot=false;
 * ordine: acLastAssignedAt asc, id asc), così i ritorni si intervallano equamente
 * con i nuovi lead. Il lead riparte come nuovo (status=NEW, callCount=0).
 *
 * Se non c'è nessun GDO eleggibile: lead lasciato non assegnato (recuperabile da admin).
 */
export async function reassignBotLeadToHumanPool(
    leadId: string,
    reason: ReassignReason,
    botUserId: string,
    botNote?: string | null,
): Promise<ReassignResult> {
    return await db.transaction(async (tx) => {
        // Un lead che ha già un appuntamento o una presenza non torna nel pool:
        // riportarlo a NEW lo fa sparire dalla board Conferme con la data ancora
        // addosso, e la call passa senza che nessuno la faccia. È successo
        // davvero (lead 0f90aa98, 25/06). La guardia sta QUI e non nel route
        // perché così copre anche i chiamanti futuri.
        const [cur] = await tx.select({ status: leads.status, presentedAt: leads.presentedAt })
            .from(leads).where(eq(leads.id, leadId)).limit(1);
        if (!cur) return { ok: true, assignedToId: null, note: 'lead_not_found' as const };
        if (isLeadLocked(cur.status, cur.presentedAt)) {
            return { ok: true, assignedToId: null, note: 'locked_appointment' as const };
        }
        // Uno scarto è una decisione presa: un INTERROTTO che arriva dopo non la
        // annulla. Quattro lead già REJECTED sono stati resuscitati a NEW così
        // (12/07, 27/07, 13/08, 17/08) e sono tornati in pipeline a chiamare
        // gente che qualcuno aveva deciso di non chiamare più.
        //
        // Guardia SEPARATA da isLeadLocked di proposito: quella protegge storico
        // e attribuzione, questa protegge una decisione. In assignContactRequest
        // la resurrezione di un REJECTED è VOLUTA — un lead scartato che chiede
        // di essere richiamato torna in pipeline apposta. Fonderle romperebbe
        // quel flusso.
        if (cur.status === 'REJECTED') {
            return { ok: true, assignedToId: null, note: 'already_rejected' as const };
        }

        const eligible = await tx.select({ id: users.id })
            .from(users)
            .where(and(
                eq(users.companyId, FENICE),
                eq(users.role, 'GDO'),
                eq(users.isActive, true),
                eq(users.acAutoIntake, true),
                eq(users.isBot, false),
            ))
            .orderBy(asc(sql`coalesce(${users.acLastAssignedAt}, 'epoch'::timestamptz)`), asc(users.id))
            .limit(1);

        const now = new Date();

        // Reset comune: il lead riparte come nuovo, senza storico richiami del bot.
        const resetFields = {
            status: 'NEW',
            callCount: 0,
            recallDate: null,
            recallNote: null,
            recallMissedAt: null,
            updatedAt: now,
            version: sql`${leads.version} + 1`,
        };

        if (eligible.length === 0) {
            await tx.update(leads)
                .set({ ...resetFields, assignedToId: null })
                .where(eq(leads.id, leadId));

            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId,
                eventType: 'REASSIGNED_FROM_BOT',
                userId: null,
                timestamp: now,
                metadata: { reason, botNote: botNote ?? null, fromBot: botUserId, toGdo: null, note: 'no_eligible_gdo' },
                companyId: FENICE,
            });

            return { ok: true, assignedToId: null, note: 'no_eligible_gdo' };
        }

        const gdoId = eligible[0].id;

        await tx.update(leads)
            // Latch su assignedAt: il lead che il bot restituisce era già stato
            // contato quando è entrato in circolo, non è un lead nuovo di oggi.
            .set({ ...resetFields, assignedToId: gdoId, assignedAt: sql`COALESCE(${leads.assignedAt}, ${now})` })
            .where(eq(leads.id, leadId));

        await tx.update(users)
            .set({ acLastAssignedAt: now })
            .where(eq(users.id, gdoId));

        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'REASSIGNED_FROM_BOT',
            userId: gdoId,
            timestamp: now,
            metadata: { reason, botNote: botNote ?? null, fromBot: botUserId, toGdo: gdoId },
            companyId: FENICE,
        });

        return { ok: true, assignedToId: gdoId };
    });
}
