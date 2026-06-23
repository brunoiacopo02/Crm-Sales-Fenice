import { db } from '@/db';
import { leads, users, leadEvents } from '@/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import crypto from 'node:crypto';

const FENICE = 'fenice';

export type ReassignReason = 'mai_risposto' | 'chat_interrotta';

type ReassignResult =
    | { ok: true; assignedToId: string }
    | { ok: true; assignedToId: null; note: 'no_eligible_gdo' };

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
            .set({ ...resetFields, assignedToId: gdoId })
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
