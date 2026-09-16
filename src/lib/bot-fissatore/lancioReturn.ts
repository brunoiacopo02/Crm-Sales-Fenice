import { db } from '@/db';
import { leads, leadEvents } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { LANCIO_WEBDEV_BUCKET, checkLancioReturnToPool, type LancioReturnMotivo } from './lancioReturnRules';

const FENICE = 'fenice';

export type LancioReturnResult =
    | { ok: true; returned: true }
    | { ok: true; returned: false; note: string };

/**
 * Rimette nel pool di /import un lead del lancio che il bot restituisce (spec §4.6):
 * `assignedToId=null`, `status='NEW'`, `callCount=0`, richiami azzerati; `assignedAt`
 * NON si tocca (il lead conta dal giorno in cui è entrato al bot; la distribuzione
 * ai GDO fa COALESCE e non lo riscrive). Le guardie stanno in lancioReturnRules.ts e
 * si rileggono DENTRO la transazione: fra la risposta del bot e questa scrittura una
 * Conferma può aver fissato qualcosa.
 */
export async function returnLancioLeadToPool(params: {
    leadId: string;
    motivo: LancioReturnMotivo;
    outcome: 'NON_RISPOSTO' | 'INTERROTTO';
    botUserId: string;
    botNote: string | null;
    assigneeIsBot: boolean;
}): Promise<LancioReturnResult> {
    const { leadId, motivo, outcome, botUserId, botNote, assigneeIsBot } = params;
    return await db.transaction(async (tx) => {
        const [cur] = await tx.select({
            status: leads.status,
            presentedAt: leads.presentedAt,
            appointmentDate: leads.appointmentDate,
            launchBucket: leads.launchBucket,
            lancioScelta: leads.lancioScelta,
        }).from(leads).where(eq(leads.id, leadId)).limit(1);
        if (!cur) return { ok: true, returned: false, note: 'lead_not_found' };

        const check = checkLancioReturnToPool({ ...cur, assigneeIsBot });
        if (!check.ok) return { ok: true, returned: false, note: check.reason };

        const now = new Date();
        await tx.update(leads)
            .set({
                assignedToId: null,
                status: 'NEW',
                callCount: 0,
                recallDate: null,
                recallNote: null,
                recallMissedAt: null,
                updatedAt: now,
                version: sql`${leads.version} + 1`,
            })
            .where(eq(leads.id, leadId));

        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'LANCIO_RETURNED_TO_POOL',
            userId: null,
            timestamp: now,
            metadata: { motivo, outcome, botNote, fromBot: botUserId, bucket: LANCIO_WEBDEV_BUCKET },
            companyId: FENICE,
        });

        return { ok: true, returned: true };
    });
}
