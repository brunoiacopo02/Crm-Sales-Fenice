import { db } from '@/db';
import { leads, users, leadEvents } from '@/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { isLeadLocked } from './contactRequests';

const FENICE = 'fenice';

/**
 * Infornate di lead a SENSO UNICO: il bot le lavora, ma i lead che non
 * convertono NON tornano ai GDO umani.
 *
 * `DB_LISTA133_20260915` sono i lead database entrati per errore il 15/09/2026.
 * Il bot ha scritto a ~1.150 di loro; chi non ha risposto a un messaggio
 * WhatsApp non vale una chiamata a mano, e restituirli riempirebbe la pipeline
 * dei GDO di gente gia' dimostratasi fredda (decisione del PO, 16/09/2026).
 *
 * Aggiungere un batch qui e' una decisione che si prende per quella specifica
 * infornata: NON vale per `intakeBatch` in generale, che marca le infornate di
 * ingresso e un domani potrebbe marcare lead buoni.
 */
const BATCH_SENSO_UNICO = new Set(['DB_LISTA133_20260915']);

export type ReassignReason = 'mai_risposto' | 'chat_interrotta';

type ReassignResult =
    | { ok: true; assignedToId: string }
    | { ok: true; assignedToId: null; note: 'no_eligible_gdo' | 'locked_appointment' | 'already_rejected' | 'lead_not_found' | 'batch_senso_unico' };

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
        const [cur] = await tx.select({
            status: leads.status,
            presentedAt: leads.presentedAt,
            intakeBatch: leads.intakeBatch,
        })
            .from(leads).where(eq(leads.id, leadId)).limit(1);
        if (!cur) return { ok: true, assignedToId: null, note: 'lead_not_found' as const };
        if (isLeadLocked(cur.status, cur.presentedAt)) {
            return { ok: true, assignedToId: null, note: 'locked_appointment' as const };
        }

        // Le infornate a SENSO UNICO: il bot le lavora, ma quello che non
        // converte non torna ai GDO. Decisione del PO il 16/09/2026 sui ~1.150
        // lead della lista 133 a cui il bot ha scritto: se una persona non
        // risponde a un messaggio, farla richiamare a mano è tempo speso su
        // qualcuno che si è già dimostrato freddo. Erano già passati 3 lead
        // prima che mettessimo questa guardia.
        //
        // Il lead non sparisce: resta scartato e riconoscibile da `intakeBatch`,
        // quindi si può ripescare in blocco se un domani si decide altrimenti.
        if (cur.intakeBatch && BATCH_SENSO_UNICO.has(cur.intakeBatch)) {
            await tx.update(leads)
                .set({ status: 'REJECTED', assignedToId: null, updatedAt: new Date() })
                .where(eq(leads.id, leadId));
            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId,
                eventType: 'REASSIGNED_FROM_BOT',
                userId: null,
                timestamp: new Date(),
                metadata: {
                    reason, botNote: botNote ?? null, fromBot: botUserId, toGdo: null,
                    note: 'batch_senso_unico', intakeBatch: cur.intakeBatch,
                },
                companyId: FENICE,
            });
            return { ok: true, assignedToId: null, note: 'batch_senso_unico' as const };
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

        // Pool dei RIDATI, separato da quello dei freschi dal 15/09/2026: i GDO
        // che lavorano lead freschi non devono trovarsi la pipeline piena di
        // scarti del bot. Round-robin sul proprio contatore
        // (`botReturnLastAssignedAt`) e non su `acLastAssignedAt`, altrimenti i
        // due flussi si sposterebbero il turno a vicenda.
        const eligible = await tx.select({ id: users.id })
            .from(users)
            .where(and(
                eq(users.companyId, FENICE),
                eq(users.role, 'GDO'),
                eq(users.isActive, true),
                eq(users.botReturnIntake, true),
                eq(users.isBot, false),
            ))
            .orderBy(asc(sql`coalesce(${users.botReturnLastAssignedAt}, 'epoch'::timestamptz)`), asc(users.id))
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
            .set({ botReturnLastAssignedAt: now })
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
