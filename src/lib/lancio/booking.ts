/**
 * Scritture della prenotazione del lancio (spec §4.2).
 *
 * Mattina (9-14 del giorno dopo): transazione con advisory lock sull'ORA, così
 * due lead che chiedono le 10:00 nello stesso istante non prendono lo stesso
 * venditore. Dentro il lock si rilegge la disponibilità (dichiarati − blocchi −
 * appuntamenti) e si sceglie con il round robin del turno GIORNO_DOPO.
 * L'appuntamento nasce GIÀ CONFERMATO (decisione 9): le Conferme non chiamano.
 *
 * Pomeriggio / dopodomani: appuntamento senza venditore, come un APPUNTAMENTO
 * del bot, e le Conferme ricevono la notifica.
 *
 * Google Calendar e webhook marketing NON stanno qui dentro: `mattinaSideEffects`
 * gira in `after()` dalla route, perché le API devono rispondere in < 3 s.
 */
import crypto from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { addHours } from 'date-fns'
import { db } from '@/db'
import { launchShifts, leadEvents, leads, notifications, users } from '@/db/schema'
import { CONFERME_DISCARD_RESET } from '@/lib/confermeReset'
import { createGoogleCalendarEvent } from '@/lib/googleCalendar'
import { enqueueMarketingWebhook } from '@/lib/marketing-webhooks/enqueue'
import { LANCIO_WEBDEV, type LancioBotInfo, type LancioConfig, type LancioScelta } from './config'
import { hourKey, sameInstant, type AtKind } from './rules'
import { isFreeAt, pickRoundRobin } from './slots'
import { dayFactsFor, getShiftMembers, type Db } from './shiftQueries'
import { FENICE, type LancioLeadRow } from './botGuard'

export type BookOutcome =
    | { ok: true; kind: 'mattina'; venditore: { id: string; nome: string }; deduped?: true }
    | { ok: true; kind: 'pomeriggio' | 'dopodomani'; deduped?: true }
    | { ok: false; motivo: 'ora_esaurita' }

type SceltaApp = Extract<LancioScelta, 'app_mattina' | 'app_pomeriggio' | 'app_dopodomani'>

/** L'unica traduzione fra la fascia decisa da `classifyAt` e il campo `leads.lancioScelta`. */
export const SCELTA_BY_KIND: Record<AtKind, SceltaApp> = {
    mattina: 'app_mattina', pomeriggio: 'app_pomeriggio', dopodomani: 'app_dopodomani',
}

/**
 * Stessa richiesta, non un secondo appuntamento: il bot ritenta la POST quando
 * la rete gli scade sotto (v. timeout intake 5s→15s) e il lead non deve
 * prenotare due volte. `sameInstant` tollera 60 s perché l'`at` viaggia come
 * ISO e può tornare arrotondato al secondo.
 */
export function isStessaPrenotazione(
    lead: Pick<LancioLeadRow, 'lancioScelta' | 'appointmentDate'>,
    kind: AtKind,
    at: Date,
): boolean {
    return lead.lancioScelta === SCELTA_BY_KIND[kind] && sameInstant(lead.appointmentDate, at)
}

function whenLabel(at: Date): string {
    return at.toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })
}

export async function notifyConfermeLancio(lead: { id: string; name: string }, at: Date, titolo: string): Promise<void> {
    const conferme = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, FENICE), eq(users.role, 'CONFERME'), eq(users.isActive, true),
    ))
    if (conferme.length === 0) return
    const now = new Date()
    await db.insert(notifications).values(conferme.map(u => ({
        id: crypto.randomUUID(),
        recipientUserId: u.id,
        type: 'lancio_appuntamento',
        title: titolo,
        body: `${lead.name}: ${whenLabel(at)}`,
        metadata: { leadId: lead.id },
        status: 'unread',
        createdAt: now,
        companyId: FENICE,
    }))).catch(e => console.error('[bot-lancio] notifica Conferme fallita', e))
}

function eventRows(lead: LancioLeadRow, botUserId: string, now: Date, at: Date, kind: string, extra: Record<string, unknown>) {
    return [
        { id: crypto.randomUUID(), leadId: lead.id, eventType: 'APPOINTMENT_SET', userId: botUserId, timestamp: now, metadata: { source: 'lancio', kind, at: at.toISOString() }, companyId: FENICE },
        { id: crypto.randomUUID(), leadId: lead.id, eventType: 'LANCIO_BOOKED', userId: botUserId, timestamp: now, metadata: { kind, at: at.toISOString(), ...extra }, companyId: FENICE },
    ]
}

export async function bookLancio(input: {
    lead: LancioLeadRow; botUserId: string; at: Date; kind: AtKind; dateStr: string; hour: number
    info?: LancioBotInfo; note?: string; now: Date; cfg?: LancioConfig
}): Promise<BookOutcome> {
    const cfg = input.cfg ?? LANCIO_WEBDEV
    const { lead, at, now, botUserId } = input
    const scelta = SCELTA_BY_KIND[input.kind]

    // Idempotenza: stesso `at` (±60 s) su un lead già prenotato = stessa richiesta.
    if (isStessaPrenotazione(lead, input.kind, at)) {
        if (input.kind === 'mattina' && lead.salespersonUserId) {
            const [v] = await db.select({ name: users.name, displayName: users.displayName }).from(users).where(eq(users.id, lead.salespersonUserId))
            return { ok: true, kind: 'mattina', venditore: { id: lead.salespersonUserId, nome: v?.displayName || v?.name || 'Venditore' }, deduped: true }
        }
        if (input.kind !== 'mattina') return { ok: true, kind: input.kind, deduped: true }
    }

    const comune = {
        status: 'APPOINTMENT',
        appointmentDate: at,
        appointmentCreatedAt: now,
        appointmentNote: input.note?.trim() || null,
        lancioScelta: scelta,
        lancioSceltaAt: now,
        ...(input.info ? { lancioBotInfo: input.info } : {}),
        confNeedsReschedule: false,
        confSnoozeAt: null,
        version: lead.version + 1,
        updatedAt: now,
    }

    if (input.kind !== 'mattina') {
        // Senza venditore: le Conferme lo lavorano. Uno scarto Conferme
        // precedente si azzera come fa updateLeadOutcome su un nuovo appuntamento.
        const reset = lead.confirmationsOutcome === 'scartato' ? CONFERME_DISCARD_RESET : {}
        const updated = await db.update(leads)
            .set({ ...reset, ...comune })
            .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version)))
            .returning({ id: leads.id })
        // Versione cambiata sotto i piedi (doppio invio concorrente): il bot
        // ripropone gli slot e al secondo giro la dedup lo chiude.
        if (updated.length === 0) return { ok: false, motivo: 'ora_esaurita' }
        await db.insert(leadEvents).values(eventRows(lead, botUserId, now, at, input.kind, { info: input.info ?? null }))
        await notifyConfermeLancio(lead, at, '🚀 Lancio: appuntamento dal bot')
        return { ok: true, kind: input.kind }
    }

    const key = hourKey(input.dateStr, input.hour)
    return await db.transaction(async (tx: Db) => {
        // Lock per ORA: serializza le prenotazioni della stessa ora, non tutte.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'lancio:' + key}))`)

        // La disponibilità si rilegge QUI DENTRO, dopo il lock: quella vista da
        // /slots un minuto fa non è una promessa. `excludeLeadId` evita che un
        // cambio d'ora dello stesso lead si scontri col proprio appuntamento.
        const members = await getShiftMembers(tx, 'GIORNO_DOPO', cfg)
        const facts = await dayFactsFor(tx, members, input.dateStr, { excludeLeadId: lead.id, cfg })
        const chosen = pickRoundRobin(facts.filter(v => isFreeAt(v, key)))
        if (!chosen) return { ok: false as const, motivo: 'ora_esaurita' as const }
        const nome = members.find(m => m.salesUserId === chosen.salesUserId)?.name ?? 'Venditore'

        const updated = await tx.update(leads)
            .set({
                ...comune,
                confirmationsOutcome: 'confermato',
                confirmationsUserId: botUserId,
                confirmationsTimestamp: now,
                confirmationsDiscardReason: null,
                salespersonUserId: chosen.salesUserId,
                salespersonAssigned: nome,
                salespersonAssignedAt: now,
            })
            .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version)))
            .returning({ id: leads.id })
        if (updated.length === 0) return { ok: false as const, motivo: 'ora_esaurita' as const }

        await tx.update(launchShifts).set({ lastAssignedAt: now }).where(and(
            eq(launchShifts.bucket, cfg.bucket), eq(launchShifts.kind, 'GIORNO_DOPO'), eq(launchShifts.salesUserId, chosen.salesUserId),
        ))
        await tx.insert(leadEvents).values(eventRows(lead, botUserId, now, at, 'mattina', { salesUserId: chosen.salesUserId, info: input.info ?? null }))
        return { ok: true as const, kind: 'mattina' as const, venditore: { id: chosen.salesUserId, nome } }
    })
}

/** Calendar + marketing, fuori dalla risposta HTTP: la route la passa ad `after()`. */
export async function mattinaSideEffects(input: { lead: LancioLeadRow; venditoreId: string; at: Date; botUserId: string }): Promise<void> {
    const { lead, at } = input
    await createGoogleCalendarEvent(
        input.venditoreId,
        {
            summary: `Appuntamento CRM: ${lead.name}`,
            description: `Lead: ${lead.name}\nTelefono: ${lead.phone}\nEmail: ${lead.email || 'N/A'}\nFunnel: ${lead.funnel || 'N/A'}\nOrigine: lancio Web Dev AI (prenotato dal bot)\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
            startTime: at,
            endTime: addHours(at, 1),
            attendees: lead.email ? [{ email: lead.email }] : [],
        },
        lead.id,
        'appointment',
    ).catch((err: any) => console.error('[bot-lancio] Google Calendar fallito:', err?.message ?? err))

    for (const eventType of ['appointment.set', 'appointment.outcome', 'deal.assigned'] as const) {
        await enqueueMarketingWebhook({ eventType, leadId: lead.id, actorUserId: input.botUserId })
            .catch((e: unknown) => console.error(`[bot-lancio] webhook ${eventType} err:`, e))
    }
}
