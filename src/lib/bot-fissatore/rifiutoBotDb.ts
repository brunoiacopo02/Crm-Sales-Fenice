import crypto from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { leadEvents, leads, users } from '@/db/schema';
import { reassignBotLeadToHumanPool } from './reassign';
import { notaRifiuto, numeroNonChiamabile, rifiutoDaRidare } from './rifiutoBot';

export type EsitoRifiuto =
    | 'ridato_ai_gdo'
    | 'chiuso_numero_non_valido'
    | 'nessun_gdo'
    | 'lasciato'; // motivo che il bot riprova da solo, lead non del bot, già chiuso

/**
 * Il bot ha risposto `accettato:false`: il lead non resta sul bot (PO 29/10/2026).
 * Si tocca SOLO un lead aperto e ancora assegnato a un account bot: un push di
 * riscaldamento su un lead del GDO, o un lead già spostato da qualcun altro, resta
 * dov'è. Best-effort: un errore qui non deve far fallire il push.
 */
export async function gestisciRifiutoBot(leadId: string, motivo: string): Promise<EsitoRifiuto> {
    if (!rifiutoDaRidare(motivo)) return 'lasciato';
    const [l] = await db.select({
        status: leads.status, phone: leads.phone, assignedToId: leads.assignedToId, companyId: leads.companyId,
    }).from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!l?.assignedToId || !['NEW', 'IN_PROGRESS'].includes(l.status)) return 'lasciato';
    const [assegnatario] = await db.select({ isBot: users.isBot }).from(users).where(eq(users.id, l.assignedToId)).limit(1);
    if (!assegnatario?.isBot) return 'lasciato';
    const botUserId = l.assignedToId;

    if (numeroNonChiamabile(l.phone)) {
        const now = new Date();
        const chiusi = await db.update(leads).set({
            status: 'REJECTED', discardReason: 'numero non valido', assignedToId: null,
            recallDate: null, recallNote: null, recallMissedAt: null, updatedAt: now,
        }).where(and(eq(leads.id, leadId), eq(leads.assignedToId, botUserId), inArray(leads.status, ['NEW', 'IN_PROGRESS'])))
            .returning({ id: leads.id });
        if (!chiusi.length) return 'lasciato';
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(), leadId, eventType: 'BOT_RIFIUTATO', userId: null, timestamp: now,
            metadata: { motivo, esito: 'chiuso_numero_non_valido', fromBot: botUserId },
            companyId: l.companyId,
        });
        return 'chiuso_numero_non_valido';
    }

    const r = await reassignBotLeadToHumanPool(leadId, 'rifiutato_dal_bot', botUserId, notaRifiuto(motivo));
    if (r.assignedToId) return 'ridato_ai_gdo';
    return 'note' in r && r.note === 'no_eligible_gdo' ? 'nessun_gdo' : 'lasciato';
}
