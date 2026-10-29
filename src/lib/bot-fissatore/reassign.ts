import { db } from '@/db';
import { leads, users, leadEvents } from '@/db/schema';
import { and, eq, asc, isNull, or, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { isLeadLocked } from './contactRequests';
import { BATCH_SENSO_UNICO } from '@/lib/intakeBatch';
import { dayBoundsRome } from '@/lib/dateUtils';
import { EVENTO_RIDATO_PARCHEGGIATO } from './iaVocale';
import { instradamentoRidato } from './maiConsegnato';

const FENICE = 'fenice';



/** `rifiutato_dal_bot` (PO 29/10/2026): il bot ha risposto `accettato:false` al push
 *  (fisso, numero scritto male): non ha mai avuto il lead, va al giro dei ridati. */
export type ReassignReason = 'mai_risposto' | 'chat_interrotta' | 'rifiutato_dal_bot';

type ReassignResult =
    | { ok: true; assignedToId: string }
    | { ok: true; assignedToId: null; note: 'no_eligible_gdo' | 'parcheggiato' | 'locked_appointment' | 'already_rejected' | 'lead_not_found' | 'batch_senso_unico' };

/**
 * Restituisce al pool umano un lead che il bot non ha convertito (mai risposto /
 * chat interrotta senza obiezione ferrea). La chat interrotta va a un GDO della
 * squadra col flag Ridati (`botReturnIntake`) e sotto il suo tetto giornaliero
 * se ne ha uno (`dailyReturnCap`), a turno su `botReturnLastAssignedAt`; il mai
 * risposto resta parcheggiato (PO 19/10), tranne il WhatsApp mai consegnato
 * che va al giro come la chat interrotta (PO 28/10).
 * Il lead riparte come nuovo (status=NEW, callCount=0).
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
        if (cur.intakeBatch && BATCH_SENSO_UNICO.includes(cur.intakeBatch)) {
            await tx.update(leads)
                .set({
                    status: 'REJECTED',
                    assignedToId: null,
                    // Come in `resetFields`: un lead che esce dal bot non porta con sé
                    // il richiamo del bot. Senza questo, un lead di questo ramo ripescato
                    // dalla coda /richieste-contatto arriva al GDO con la data addosso
                    // (Adelmo Anselmo, 22/09/2026).
                    recallDate: null,
                    recallNote: null,
                    recallMissedAt: null,
                    updatedAt: new Date(),
                })
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

        // Chi non ha mai risposto al bot non va ai GDO (PO 19/10/2026): con tre GDO
        // presenti il loro tempo va al lancio e ai ridati con chat interrotta. Il
        // lead resta NEW e non assegnato, ripescabile in blocco.
        //
        // Eccezione (PO 28/10/2026): se il WhatsApp non è mai stato consegnato
        // (numero senza WhatsApp, nota del bot "WhatsApp mai consegnato ...
        // chiamare a voce") il lead non ha mai potuto rispondere e va chiamato:
        // segue il giro dei ridati come la chat interrotta, stessi filtri e
        // tetti. Nell'evento `reason` resta 'mai_risposto' (statistiche del bot
        // e stella "Chiama per primo" non cambiano) e `instradato` ne dice il perché.
        const instradamento = instradamentoRidato(reason, botNote);
        const extraMeta = reason === 'mai_risposto' && instradamento === 'giro_gdo'
            ? { instradato: 'mai_consegnato' as const }
            : {};
        if (instradamento === 'parcheggia') {
            await tx.update(leads)
                .set({ ...resetFields, assignedToId: null })
                .where(eq(leads.id, leadId));

            await tx.insert(leadEvents).values([
                {
                    id: crypto.randomUUID(),
                    leadId,
                    eventType: 'REASSIGNED_FROM_BOT',
                    userId: null,
                    timestamp: now,
                    metadata: { reason, botNote: botNote ?? null, fromBot: botUserId, toGdo: null, note: 'parcheggiato' },
                    companyId: FENICE,
                },
                {
                    id: crypto.randomUUID(),
                    leadId,
                    eventType: EVENTO_RIDATO_PARCHEGGIATO,
                    userId: null,
                    timestamp: now,
                    metadata: { motivo: 'mai_risposto_al_bot', botNote: botNote ?? null },
                    companyId: FENICE,
                },
            ]);

            return { ok: true, assignedToId: null, note: 'parcheggiato' };
        }

        // Pool dei RIDATI, separato da quello dei freschi dal 15/09/2026: i GDO
        // che lavorano lead freschi non devono trovarsi la pipeline piena di
        // scarti del bot. Round-robin sul proprio contatore
        // (`botReturnLastAssignedAt`) e non su `acLastAssignedAt`, altrimenti i
        // due flussi si sposterebbero il turno a vicenda.
        // Senza tetto giornaliero dal 19/10/2026 (PO): i ridati con chat
        // interrotta vanno tutti, a turno, ai GDO del giro.
        // Dal 25/10/2026 (PO) il giro è tutta la squadra: chi ha il flag Ridati
        // acceso in /gestione ed è della squadra, cioè ha un nome vero. 108 e
        // gli account senza nome non ricevono nemmeno col flag acceso; chi è
        // assente si spegne da /gestione. Stessa regola di `riceveRidati`.
        //
        // Tetto per GDO facoltativo (`dailyReturnCap`, /gestione, PO 25/10
        // mattina: Lorenzo a 30 al giorno quando Bruno lo accende). Si contano
        // i ridati ricevuti oggi, giorno di Roma; chi è a tetto esce dal giro
        // fino a domani. Senza tetto (null) il giro è quello di sempre. Il
        // conteggio passa dall'indice (companyId, userId, eventType, timestamp).
        // Stessa regola di `sottoTetto` in instradamento.ts.
        const inizioGiorno = dayBoundsRome(now).start;
        const eligible = await tx.select({ id: users.id })
            .from(users)
            .where(and(
                eq(users.companyId, FENICE),
                eq(users.role, 'GDO'),
                eq(users.isActive, true),
                eq(users.botReturnIntake, true),
                eq(users.isBot, false),
                // L'account di prova (migr. 0050) non riceve mai ridati veri.
                eq(users.isTest, false),
                sql`btrim(coalesce(${users.firstName}, '')) <> ''`,
                or(
                    isNull(users.dailyReturnCap),
                    sql`(
                        select count(*) from ${leadEvents} e
                        where e."companyId" = ${FENICE}
                          and e."userId" = ${users.id}
                          and e."eventType" = 'REASSIGNED_FROM_BOT'
                          and e."timestamp" >= ${inizioGiorno}
                    ) < ${users.dailyReturnCap}`,
                ),
            ))
            .orderBy(asc(sql`coalesce(${users.botReturnLastAssignedAt}, 'epoch'::timestamptz)`), asc(users.id))
            .limit(1);

        if (eligible.length === 0) {
            // Nessun GDO nel giro: il lead resta non assegnato (recuperabile da admin).
            await tx.update(leads)
                .set({ ...resetFields, assignedToId: null })
                .where(eq(leads.id, leadId));

            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId,
                eventType: 'REASSIGNED_FROM_BOT',
                userId: null,
                timestamp: now,
                metadata: { reason, ...extraMeta, botNote: botNote ?? null, fromBot: botUserId, toGdo: null, note: 'no_eligible_gdo' },
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
            metadata: { reason, ...extraMeta, botNote: botNote ?? null, fromBot: botUserId, toGdo: gdoId },
            companyId: FENICE,
        });

        return { ok: true, assignedToId: gdoId };
    });
}
