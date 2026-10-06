/**
 * Il flusso dietro POST /api/webhooks/mario-agenda (PO 06/10/2026).
 *
 * Il Mario vocale di Federico ha fissato un appuntamento al telefono. Noi:
 *  1. troviamo il lead per telefono (chiave persona, ultime 10 cifre);
 *  2. lo diamo al GDO 108 — l'account con cui gli appuntamenti dell'IA vocale si
 *     segnavano a mano — e lo esitiamo APPUNTAMENTO con il riassunto in nota, col
 *     riuso totale di updateLeadOutcome (Conferme, call log, webhook marketing);
 *  3. chiediamo al bot di mandare l'agenda GDO e poi il video giusto, come quando un
 *     GDO preme "Agenda";
 *  4. passiamo al bot data e ora, come fa updateLeadOutcome per i GDO umani.
 *
 * Mai due volte: Federico rimanda lo stesso `id_invio` se la nostra risposta non gli
 * arriva. L'evento MARIO_VOCALE_APPUNTAMENTO si scrive solo a giro completo, e un
 * id_invio gia' visto risponde 200 senza toccare niente. Un giro a meta' (esito
 * scritto, agenda fallita) risponde 502: al ritentativo il lead e' gia' nostro alla
 * stessa ora, l'esito non si riscrive e riparte solo l'agenda.
 *
 * serviceCtx.isBot = true: niente gamification sul 108 (e' un account di servizio,
 * non una persona in gara) e niente notifica automatica della data, che mandiamo noi
 * DOPO l'agenda — il bot la aggancia alla chat che l'agenda ha appena aperto.
 */
import crypto from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leads, leadEvents, users } from '@/db/schema'
import { updateLeadOutcome } from '@/app/actions/pipelineActions'
import { sendAgendaViaBot, notifyAppointmentToBot } from '@/lib/agendaBot'
import { logLeadEvent } from '@/lib/eventLogger'
import { EVENTO_IA_VOCALE } from '@/lib/bot-fissatore/iaVocale'
import { notaAppuntamento, sceltaLead, type AgendaMario } from './payload'

export const EVENTO_MARIO_VOCALE = 'MARIO_VOCALE_APPUNTAMENTO' as const
export const EVENTO_MARIO_VOCALE_IGNORATO = 'MARIO_VOCALE_IGNORATO' as const
export const GDO_MARIO_VOCALE = 108
const COMPANY = 'fenice'

export type RispostaApplica = { http: number; body: Record<string, unknown> }

export async function applicaAgendaMario(p: AgendaMario): Promise<RispostaApplica> {
    // 1. Doppione: stesso id_invio gia' andato a buon fine.
    const [gia] = await db.select({ leadId: leadEvents.leadId }).from(leadEvents)
        .where(and(
            eq(leadEvents.eventType, EVENTO_MARIO_VOCALE),
            sql`${leadEvents.metadata}->>'idInvio' = ${p.idInvio}`,
        ))
        .limit(1)
    if (gia) return { http: 200, body: { ok: true, duplicato: true, leadId: gia.leadId } }

    const [gdo] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.gdoCode, GDO_MARIO_VOCALE), eq(users.companyId, COMPANY)))
        .limit(1)
    if (!gdo) {
        console.error(`[mario-vocale] account GDO ${GDO_MARIO_VOCALE} assente`)
        return { http: 503, body: { ok: false, error: 'not_configured' } }
    }

    // 2. Il lead.
    const chiave = sql<string>`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10)`
    const candidati = await db.select({
        id: leads.id,
        createdAt: leads.createdAt,
        status: leads.status,
        presentedAt: leads.presentedAt,
        appointmentDate: leads.appointmentDate,
        assignedToId: leads.assignedToId,
        phone: leads.phone,
        name: leads.name,
        email: leads.email,
        funnel: leads.funnel,
        agendaSentAt: leads.agendaSentAt,
        inCodaIaVocale: sql<boolean>`exists (select 1 from ${leadEvents} e where e."leadId" = ${leads.id} and e."eventType" = ${EVENTO_IA_VOCALE})`,
    }).from(leads)
        .where(and(eq(leads.companyId, COMPANY), sql`${chiave} = ${p.chiaveTelefono}`))
    const lead = sceltaLead(candidati)
    if (!lead) {
        // Ritentare non lo fa comparire: 200, e il motivo nel corpo per chi legge i log.
        console.error(`[mario-vocale] nessun lead col numero ${p.telefono} (id_invio ${p.idInvio})`)
        return { http: 200, body: { ok: false, motivo: 'lead_non_trovato' } }
    }

    // 3. L'esito. Un appuntamento gia' nostro alla stessa ora e' il giro precedente
    // di questo stesso invio, rimasto a meta': si salta e si riprova solo l'agenda.
    const stessaOra = !!lead.appointmentDate
        && Math.abs(lead.appointmentDate.getTime() - p.inizio.getTime()) < 60_000
    const giroPrecedente = lead.status === 'APPOINTMENT' && lead.assignedToId === gdo.id && stessaOra

    if (!giroPrecedente) {
        if (lead.status === 'APPOINTMENT' || lead.presentedAt) {
            // Un appuntamento di qualcun altro, o un lead gia' presentato: non si
            // sovrascrive. Resta traccia nella timeline per chi deve capire.
            await logLeadEvent({
                leadId: lead.id,
                eventType: EVENTO_MARIO_VOCALE_IGNORATO,
                userId: gdo.id,
                metadata: {
                    idInvio: p.idInvio,
                    motivo: 'gia_appuntamento',
                    inizioProposto: p.inizio.toISOString(),
                    riassunto: p.riassunto,
                },
                companyId: COMPANY,
            })
            return { http: 200, body: { ok: false, motivo: 'gia_appuntamento', leadId: lead.id } }
        }

        if (lead.assignedToId !== gdo.id) {
            await db.update(leads).set({ assignedToId: gdo.id, assignedAt: sql`COALESCE(${leads.assignedAt}, now())` })
                .where(and(eq(leads.id, lead.id), eq(leads.companyId, COMPANY)))
            await db.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId: lead.id,
                eventType: 'ASSIGNED',
                userId: gdo.id,
                timestamp: new Date(),
                metadata: { fromUserId: lead.assignedToId, reason: 'mario_vocale', idInvio: p.idInvio },
                companyId: COMPANY,
            })
        }

        const esito = await updateLeadOutcome(
            lead.id,
            'APPUNTAMENTO',
            notaAppuntamento(p.riassunto),
            p.inizio,
            undefined,
            undefined,
            undefined,
            undefined,
            { companyId: COMPANY, actorUserId: gdo.id, isBot: true },
        )
        if (!esito || esito.success !== true) {
            // Tipicamente CONCURRENCY_ERROR: il ritentativo di Federico lo sana.
            return { http: 409, body: { ok: false, error: 'update_failed', detail: esito?.error ?? 'unknown' } }
        }
    }

    // 4. Agenda e video dal bot.
    const r = await sendAgendaViaBot({
        leadId: lead.id,
        phone: lead.phone,
        name: p.nome ?? lead.name,
        email: lead.email ?? p.email,
        funnel: lead.funnel,
        variant: { lavora: p.lavora, haFamiglia: p.figli, offertaDelMese: false },
        appointmentAt: p.inizio,
    })
    if (!r.ok || r.esito === 'fallito') {
        if (r.ok) {
            await db.update(leads).set({ agendaStatus: 'fallito' })
                .where(and(eq(leads.id, lead.id), eq(leads.companyId, COMPANY)))
        }
        const error = r.ok ? 'agenda_fallita' : r.error
        console.error(`[mario-vocale] agenda non partita per lead ${lead.id}: ${error}`)
        // L'appuntamento e' registrato: il ritentativo rimanda solo l'agenda.
        return { http: 502, body: { ok: false, error: 'agenda_non_inviata', leadId: lead.id } }
    }

    await db.update(leads).set({ agendaSentAt: new Date(), agendaStatus: r.esito })
        .where(and(eq(leads.id, lead.id), eq(leads.companyId, COMPANY)))
    await logLeadEvent({
        leadId: lead.id,
        eventType: 'AGENDA_SENT',
        userId: gdo.id,
        metadata: {
            channel: 'bot',
            origine: 'mario_vocale',
            esito: r.esito,
            deduplicato: r.deduplicato,
            conversationId: r.conversationId,
            sid: r.sid,
            lavora: p.lavora,
            haFamiglia: p.figli,
            resend: lead.agendaSentAt !== null,
        },
        companyId: COMPANY,
    })

    await notifyAppointmentToBot({
        lead: { id: lead.id, phone: lead.phone, name: lead.name, funnel: lead.funnel, companyId: COMPANY },
        appointmentAt: p.inizio,
        trigger: 'fissato',
    })

    // 5. Giro completo: da qui lo stesso id_invio e' un doppione.
    await logLeadEvent({
        leadId: lead.id,
        eventType: EVENTO_MARIO_VOCALE,
        userId: gdo.id,
        metadata: {
            idInvio: p.idInvio,
            tentativo: p.tentativo,
            richiestaId: p.richiestaId,
            chiamataId: p.chiamataId,
            inizio: p.inizio.toISOString(),
            agenda: r.esito,
        },
        companyId: COMPANY,
    })

    return { http: 200, body: { ok: true, leadId: lead.id, agenda: r.esito } }
}
