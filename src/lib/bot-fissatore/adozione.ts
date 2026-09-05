/**
 * Adozione di un lead che ha scritto per primo: dal contratto normalizzato alla
 * riga nel CRM.
 *
 * Vive qui, e non dentro una rotta, perché i canali sono due e devono comportarsi
 * identici: la lettura della lista (`/api/admin/lead-entranti`, per il recupero
 * dei 29 e come rete) e il push firmato che arriva dal bot nel momento in cui
 * adotta la chat (`/api/bot/lead-entrante`). Due copie di questa funzione
 * divergerebbero, ed è il modo esatto in cui a giugno un lead ha perso
 * l'appuntamento (vedi `isLeadLocked` in contactRequests.ts).
 */

import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { leads, leadEvents } from '@/db/schema';
import { logLeadEvent } from '@/lib/eventLogger';
import { SOURCE_INBOUND, type LeadEntranteNormalizzato } from './leadEntranti';

export const FENICE = 'fenice';

export type EsitoAdozione =
    | { esito: 'creato'; leadId: string; bloccato: false }
    | { esito: 'esistente'; leadId: string; bloccato: boolean }
    | { esito: 'altra_azienda'; companyId: string };

/**
 * Crea il lead, o restituisce quello che c'è già sullo stesso numero.
 *
 * Dedup sulle ultime 10 cifre — la stessa `personKey` che mandiamo nell'intake e
 * con cui il bot riconosce la chat — sotto advisory lock sul telefono. Il lock
 * non è teorico: senza, un webhook AC in arrivo sullo stesso numero nello stesso
 * istante crea un secondo lead, e la stessa persona finisce a due GDO diversi.
 * Rende anche il push ripetibile: due chiamate sullo stesso numero danno lo
 * stesso `leadId`.
 *
 * `bloccato` = ha già un appuntamento o una presenza latchata. Chi chiama lo usa
 * per NON scriverci sopra l'appuntamento che il bot aveva già fissato.
 */
export async function adottaLead(
    lead: LeadEntranteNormalizzato,
    botId: string,
): Promise<EsitoAdozione> {
    const adesso = new Date();
    const nuovoId = crypto.randomUUID();

    const risultato = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lead.phone}, 0))`);

        // Volutamente senza filtro azienda: serve a riconoscere anche i contatti
        // di un'altra azienda, che non devono generare un doppione Fenice
        // (stessa guardia cross-tenant del webhook AC).
        const esistenti = await tx.select({
            id: leads.id,
            status: leads.status,
            presentedAt: leads.presentedAt,
            createdAt: leads.createdAt,
            companyId: leads.companyId,
        }).from(leads)
            .where(sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10) = ${lead.personKey}`);

        const fenice = esistenti.filter((e) => e.companyId === FENICE);

        if (fenice.length === 0 && esistenti.length > 0) {
            return { esito: 'altra_azienda' as const, companyId: esistenti[0].companyId };
        }

        if (fenice.length > 0) {
            // Il più recente: è quello su cui la persona sta lavorando adesso.
            const piuRecente = fenice.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
            return {
                esito: 'esistente' as const,
                leadId: piuRecente.id,
                bloccato: piuRecente.status === 'APPOINTMENT' || piuRecente.presentedAt !== null,
            };
        }

        await tx.insert(leads).values({
            id: nuovoId,
            name: lead.name,
            phone: lead.phone,
            email: null,
            funnel: lead.funnel,
            source: SOURCE_INBOUND,
            status: 'NEW',
            callCount: 0,
            // La chat è già del bot: darla a un GDO umano gli toglierebbe una
            // conversazione che sta conducendo lui, e romperebbe la prova di
            // appartenenza che /api/bot/outcome pretende per un appuntamento.
            assignedToId: botId,
            // `createdAt` = quando ha scritto: è lì che questa persona è entrata,
            // ed è lì che le analisi di funnel devono vederla. `assignedAt` =
            // adesso, perché è adesso che entra in circolo (migr. 0027).
            createdAt: lead.scrittoIl ?? adesso,
            assignedAt: adesso,
            updatedAt: adesso,
            companyId: FENICE,
        });
        return { esito: 'creato' as const, leadId: nuovoId, bloccato: false as const };
    });

    if (risultato.esito === 'creato') {
        await logLeadEvent({
            leadId: risultato.leadId,
            eventType: 'IMPORTED',
            toSection: 'Prima Chiamata',
            metadata: {
                source: SOURCE_INBOUND,
                provenienza: lead.funnel,
                conversationId: lead.conversationId,
                statoBot: lead.statoBot,
                scrittoIl: lead.scrittoIl?.toISOString() ?? null,
            },
            companyId: FENICE,
        });
        await logLeadEvent({
            leadId: risultato.leadId,
            eventType: 'ASSIGNED',
            metadata: { assignedToUser: botId, source: SOURCE_INBOUND, adozioneChatEntrante: true },
            companyId: FENICE,
        });
    }

    if (risultato.esito !== 'altra_azienda') {
        await annotaPrimoMessaggio(risultato.leadId, lead);
    }

    return risultato;
}

/**
 * Mette sulla timeline del lead il messaggio con cui la persona si è presentata.
 * È l'unico contesto che ha dato, e va lì qualunque cosa si decida su intake e
 * appuntamenti.
 *
 * Idempotente: su un lead che ha già la sua annotazione non si riscrive. Serve
 * perché lo stesso lead può arrivare due volte — una dal push e una dalla lista,
 * che resta come rete quando un push si perde.
 */
async function annotaPrimoMessaggio(leadId: string, lead: LeadEntranteNormalizzato): Promise<void> {
    if (!lead.primoMessaggio) return;
    const [gia] = await db.select({ id: leadEvents.id })
        .from(leadEvents)
        .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.eventType, 'INBOUND_MESSAGE')))
        .limit(1);
    if (gia) return;

    await logLeadEvent({
        leadId,
        eventType: 'INBOUND_MESSAGE',
        metadata: {
            primoMessaggio: lead.primoMessaggio,
            scrittoIl: lead.scrittoIl?.toISOString() ?? null,
            provenienza: lead.funnel,
            conversationId: lead.conversationId,
            statoBot: lead.statoBot,
        },
        companyId: FENICE,
    });
}
