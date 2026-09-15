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
 * UNA prenotazione per lead (ruling R-rebook): chi ha già prenotato e chiede
 * un'ora diversa riceve `gia_prenotato` e lo spostamento passa dalle Conferme.
 * Così questa route non riassegna mai un venditore, non deve cancellare
 * l'evento Google Calendar del precedente e non eredita lo stato di una
 * trattativa altrui.
 *
 * Google Calendar e webhook marketing NON stanno qui dentro: `mattinaSideEffects`
 * e `confermeSideEffects` girano in `after()` dalla route, perché le API devono
 * rispondere in < 3 s.
 */
import crypto from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
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
    /** Nessun venditore libero in quell'ora (solo mattina). */
    | { ok: false; motivo: 'ora_esaurita' }
    /** Il lead è cambiato sotto i piedi fra la lettura e la scrittura: il bot ritenta. */
    | { ok: false; motivo: 'conflitto' }
    /** Ha già prenotato un'altra ora: lo spostamento lo fanno le Conferme. */
    | { ok: false; motivo: 'gia_prenotato'; kind: AtKind; at: Date }

type SceltaApp = Extract<LancioScelta, 'app_mattina' | 'app_pomeriggio' | 'app_dopodomani'>

/** L'unica traduzione fra la fascia decisa da `classifyAt` e il campo `leads.lancioScelta`. */
export const SCELTA_BY_KIND: Record<AtKind, SceltaApp> = {
    mattina: 'app_mattina', pomeriggio: 'app_pomeriggio', dopodomani: 'app_dopodomani',
}

const KIND_BY_SCELTA: Record<SceltaApp, AtKind> = {
    app_mattina: 'mattina', app_pomeriggio: 'pomeriggio', app_dopodomani: 'dopodomani',
}

export type BookDecision =
    | { azione: 'prenota' }
    | { azione: 'dedup' }
    | { azione: 'gia_prenotato'; kind: AtKind; at: Date }

/**
 * Cosa fare della richiesta, guardando solo il lead (niente DB, niente turni).
 *
 * - `dedup`: stesso istante entro 60 s. È il re-invio della stessa POST — il bot
 *   ritenta quando la rete gli scade sotto (v. timeout intake 5s→15s) — e non
 *   deve produrre un secondo appuntamento né un secondo evento Calendar.
 * - `gia_prenotato`: ha già una prenotazione del lancio e ne chiede un'altra.
 *   Non si sposta da qui: `lancioScelta` è la scelta della sera, e cambiarla
 *   significherebbe togliere il lead a un venditore che ha già l'appuntamento
 *   in agenda. Il bot lo dice al lead, le Conferme rifissano.
 * - `prenota`: nessuna prenotazione in corso (o una monca, senza data).
 */
export function decideBooking(
    lead: Pick<LancioLeadRow, 'lancioScelta' | 'appointmentDate'>,
    kind: AtKind,
    at: Date,
): BookDecision {
    const scelta = lead.lancioScelta as SceltaApp | null
    const esistente = scelta && scelta in KIND_BY_SCELTA ? KIND_BY_SCELTA[scelta] : null
    // `chiamata_subito` e `followup` non sono prenotazioni: dopo si può prenotare.
    if (!esistente || !lead.appointmentDate) return { azione: 'prenota' }
    if (sameInstant(lead.appointmentDate, at)) return { azione: 'dedup' }
    return { azione: 'gia_prenotato', kind: esistente, at: lead.appointmentDate }
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

    const decisione = decideBooking(lead, input.kind, at)
    if (decisione.azione === 'gia_prenotato') {
        return { ok: false, motivo: 'gia_prenotato', kind: decisione.kind, at: decisione.at }
    }
    if (decisione.azione === 'dedup') {
        if (input.kind === 'mattina' && lead.salespersonUserId) {
            const [v] = await db.select({ name: users.name, displayName: users.displayName }).from(users).where(eq(users.id, lead.salespersonUserId))
            return { ok: true, kind: 'mattina', venditore: { id: lead.salespersonUserId, nome: v?.displayName || v?.name || 'Venditore' }, deduped: true }
        }
        if (input.kind !== 'mattina') return { ok: true, kind: input.kind, deduped: true }
        // Mattina già prenotata ma senza venditore: il giro precedente è morto a
        // metà. Non è un doppione, è una prenotazione da finire: si prosegue.
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
        // Il lead deve finire sulla board Conferme, che filtra
        // `confirmationsOutcome IS NULL` + `status='APPOINTMENT'`: l'azzeramento
        // è INCONDIZIONATO, non solo su un vecchio scarto. Un residuo di
        // conferma o di venditore da un giro precedente lo terrebbe fuori dalla
        // board (o peggio: appuntamento pomeridiano intestato a un venditore che
        // non è di turno) e nessuno lo chiamerebbe.
        const updated = await db.update(leads)
            .set({
                ...CONFERME_DISCARD_RESET,
                salespersonUserId: null,
                salespersonAssigned: null,
                salespersonAssignedAt: null,
                ...comune,
            })
            .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version)))
            .returning({ id: leads.id })
        // Versione cambiata sotto i piedi (doppio invio concorrente): non è
        // "ora esaurita" — il pomeriggio non si esaurisce — ed è il bot a dover
        // ritentare una volta.
        if (updated.length === 0) return { ok: false, motivo: 'conflitto' }
        await db.insert(leadEvents).values(eventRows(lead, botUserId, now, at, input.kind, { info: input.info ?? null }))
        await notifyConfermeLancio(lead, at, '🚀 Lancio: appuntamento dal bot')
        return { ok: true, kind: input.kind }
    }

    const key = hourKey(input.dateStr, input.hour)
    return await db.transaction(async (tx: Db) => {
        // Lock per ORA: serializza le prenotazioni della stessa ora, non tutte.
        // Seed 3 = lancio (0 telefono, 1 contatto AC, 2 push del lancio).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'lancio:' + key}, 3))`)

        // La disponibilità si rilegge QUI DENTRO, dopo il lock: quella vista da
        // /slots un minuto fa non è una promessa. `excludeLeadId` evita che una
        // prenotazione monca dello stesso lead si scontri con sé stessa.
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
        if (updated.length === 0) return { ok: false as const, motivo: 'conflitto' as const }

        await tx.update(launchShifts).set({ lastAssignedAt: now }).where(and(
            eq(launchShifts.companyId, FENICE),
            eq(launchShifts.bucket, cfg.bucket),
            eq(launchShifts.kind, 'GIORNO_DOPO'),
            eq(launchShifts.salesUserId, chosen.salesUserId),
            isNull(launchShifts.removedAt),
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

/**
 * Marketing per le fasce senza venditore. `appointment.set` è lo stesso evento
 * che emette `updateLeadOutcome` quando il bot fissa un APPUNTAMENTO: senza,
 * Marketing Analytics conterebbe solo le mattine e il lancio sembrerebbe metà.
 */
export async function confermeSideEffects(input: { leadId: string; botUserId: string }): Promise<void> {
    await enqueueMarketingWebhook({ eventType: 'appointment.set', leadId: input.leadId, actorUserId: input.botUserId })
        .catch((e: unknown) => console.error('[bot-lancio] webhook appointment.set err:', e))
}
