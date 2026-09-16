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
import { dayFactsFor, getShiftMembers, venditoreLabel, type Db } from './shiftQueries'
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

/**
 * Notifica alle Conferme: NON rilancia mai, nemmeno se il DB cade sulla SELECT
 * dei destinatari. Gira sempre DOPO la scrittura dell'appuntamento (fuori dalla
 * transazione), e una campanella mancata non deve far tornare al bot un errore
 * su un appuntamento che è già a posto sul lead: il chiamante può quindi darla
 * per acquisita senza avvolgerla in un try/catch suo.
 */
export async function notifyConfermeLancio(lead: { id: string; name: string }, at: Date, titolo: string): Promise<void> {
    try {
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
        })))
    } catch (e) {
        console.error('[bot-lancio] notifica Conferme fallita', e)
    }
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
            return { ok: true, kind: 'mattina', venditore: { id: lead.salespersonUserId, nome: await venditoreNome(db, lead.salespersonUserId) }, deduped: true }
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
        // Appuntamento ed eventi in UNA transazione: niente advisory lock (il
        // pomeriggio non ha venditore da spartire, il controllo di `version`
        // basta a serializzare i doppi invii), ma se l'insert degli eventi
        // fallisce deve saltare anche la scrittura sul lead. Altrimenti resta
        // un appuntamento senza APPOINTMENT_SET: la Timeline non lo racconta e
        // i webhook marketing di `appointment.set` non hanno l'evento dietro.
        const kind = input.kind
        const esito = await db.transaction(async (tx: Db) => {
            const updated = await tx.update(leads)
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
            // "ora esaurita" — il pomeriggio non si esaurisce — ed è il bot a
            // dover ritentare una volta.
            if (updated.length === 0) return { ok: false as const, motivo: 'conflitto' as const }
            await tx.insert(leadEvents).values(eventRows(lead, botUserId, now, at, kind, { info: input.info ?? null }))
            return { ok: true as const, kind }
        })
        if (!esito.ok) return esito
        // La campanella sta FUORI dalla transazione: è un effetto collaterale,
        // e tenerla dentro allungherebbe la transazione con una scrittura che
        // non deve poter far rollback dell'appuntamento (`notifyConfermeLancio`
        // non rilancia).
        await notifyConfermeLancio(lead, at, '🚀 Lancio: appuntamento dal bot')
        return esito
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

export type CallNowOutcome =
    | { ok: true; venditore: { id: string; nome: string }; deduped?: true }
    /** Turno SERA vuoto: il bot ripiega sulla prenotazione. */
    | { ok: false; motivo: 'nessun_venditore' }
    /** Il lead è cambiato sotto i piedi fra la lettura e la scrittura: il bot ritenta. */
    | { ok: false; motivo: 'conflitto' }
    /** Ha già un appuntamento del lancio: non glielo togliamo per una chiamata. */
    | { ok: false; motivo: 'gia_prenotato'; kind: AtKind; at: Date }

export type CallNowDecision =
    | { azione: 'assegna' }
    | { azione: 'dedup' }
    | { azione: 'gia_prenotato'; kind: AtKind; at: Date }

/**
 * Cosa fare della richiesta "chiamami adesso", guardando solo il lead.
 *
 * - `dedup`: ha già la chiamata subito E un venditore. È il re-invio della
 *   stessa POST (il bot ritenta quando la rete gli scade sotto): un secondo
 *   giro sposterebbe il lead a un altro venditore e suonerebbe due campanelle.
 * - `gia_prenotato`: ha già un appuntamento del lancio. Stessa regola di
 *   `decideBooking` (ruling R-rebook): riscrivere `salespersonUserId` qui
 *   toglierebbe il lead al venditore che ce l'ha in agenda. Il bot lo dice al
 *   lead, le Conferme rifissano.
 * - `assegna`: nessuna delle due (anche `followup`, o una chiamata subito
 *   rimasta senza venditore perché il giro precedente è morto a metà).
 */
export function decideCallNow(
    lead: Pick<LancioLeadRow, 'lancioScelta' | 'appointmentDate' | 'salespersonUserId'>,
): CallNowDecision {
    if (lead.lancioScelta === 'chiamata_subito' && lead.salespersonUserId) return { azione: 'dedup' }
    const scelta = lead.lancioScelta as SceltaApp | null
    const esistente = scelta && scelta in KIND_BY_SCELTA ? KIND_BY_SCELTA[scelta] : null
    if (esistente && lead.appointmentDate) return { azione: 'gia_prenotato', kind: esistente, at: lead.appointmentDate }
    return { azione: 'assegna' }
}

async function venditoreNome(tx: Db, id: string): Promise<string> {
    const [v] = await tx.select({ name: users.name, displayName: users.displayName }).from(users).where(eq(users.id, id))
    return v ? venditoreLabel(v) : 'Venditore'
}

/**
 * Chiamata subito (spec §4.2): round robin sul turno SERA, nessun controllo di
 * calendario (il venditore di turno è lì apposta, e la sera del webinar non ha
 * disponibilità dichiarate). Il lead nasce APPOINTMENT "adesso", già
 * confermato — le Conferme non lo devono chiamare — con il contatore NR a
 * zero: è la scheda venditore (`recordLancioCallNowNoAnswer`, Task 10) a farlo
 * scalare. Nessun evento Google Calendar: la chiamata è adesso, non domani.
 */
export async function assignCallNow(input: {
    lead: LancioLeadRow; botUserId: string; info?: LancioBotInfo; note?: string; now: Date; cfg?: LancioConfig
}): Promise<CallNowOutcome> {
    const cfg = input.cfg ?? LANCIO_WEBDEV
    const { lead, now, botUserId } = input
    // L'appuntamento è "adesso" al minuto tondo: i secondi non dicono niente a
    // chi legge l'agenda e `slotKey` ragiona comunque per ora.
    const at = new Date(Math.floor(now.getTime() / 60_000) * 60_000)

    // Via breve: il re-invio non deve nemmeno mettersi in fila per il lock.
    const subito = decideCallNow(lead)
    if (subito.azione === 'gia_prenotato') return { ok: false, motivo: 'gia_prenotato', kind: subito.kind, at: subito.at }
    if (subito.azione === 'dedup' && lead.salespersonUserId) {
        return { ok: true, venditore: { id: lead.salespersonUserId, nome: await venditoreNome(db, lead.salespersonUserId) }, deduped: true }
    }

    return await db.transaction(async (tx: Db) => {
        // Lock UNICO per tutta la chiamata subito (non per ora, come la
        // mattina): il round robin del turno SERA è una risorsa sola, e due
        // richieste in parallelo leggerebbero lo stesso `lastAssignedAt`
        // mandando due lead allo stesso venditore. Seed 3 = lancio.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'lancio:call-now'}, 3))`)

        // Il lead si rilegge QUI DENTRO: la riga arrivata dalla route è di
        // prima del lock. Senza, il secondo di due invii concorrenti scriveva
        // con una `version` vecchia e il bot si sentiva dire "nessun venditore"
        // mentre il venditore stava già chiamando.
        const [fresh] = await tx.select({
            lancioScelta: leads.lancioScelta, appointmentDate: leads.appointmentDate,
            salespersonUserId: leads.salespersonUserId, version: leads.version,
        }).from(leads).where(eq(leads.id, lead.id)).limit(1)
        if (!fresh) return { ok: false as const, motivo: 'conflitto' as const }

        const decisione = decideCallNow(fresh)
        if (decisione.azione === 'gia_prenotato') {
            return { ok: false as const, motivo: 'gia_prenotato' as const, kind: decisione.kind, at: decisione.at }
        }
        if (decisione.azione === 'dedup' && fresh.salespersonUserId) {
            return { ok: true as const, venditore: { id: fresh.salespersonUserId, nome: await venditoreNome(tx, fresh.salespersonUserId) }, deduped: true as const }
        }

        const members = await getShiftMembers(tx, 'SERA', cfg)
        const chosen = pickRoundRobin(members)
        if (!chosen) return { ok: false as const, motivo: 'nessun_venditore' as const }
        const nome = members.find(m => m.salesUserId === chosen.salesUserId)?.name ?? 'Venditore'

        const updated = await tx.update(leads).set({
            status: 'APPOINTMENT',
            appointmentDate: at,
            appointmentCreatedAt: now,
            appointmentNote: input.note?.trim() || null,
            // Confermato dal bot: il lead non deve comparire sulla board
            // Conferme (filtra `confirmationsOutcome IS NULL`), è del venditore.
            confirmationsOutcome: 'confermato',
            confirmationsUserId: botUserId,
            confirmationsTimestamp: now,
            confirmationsDiscardReason: null,
            confNeedsReschedule: false,
            confSnoozeAt: null,
            salespersonUserId: chosen.salesUserId,
            salespersonAssigned: nome,
            salespersonAssignedAt: now,
            lancioScelta: 'chiamata_subito',
            lancioSceltaAt: now,
            lancioCallNowAttempts: 0,
            lancioCallNowNextAt: null,
            ...(input.info ? { lancioBotInfo: input.info } : {}),
            version: fresh.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, lead.id), eq(leads.version, fresh.version))).returning({ id: leads.id })
        if (updated.length === 0) return { ok: false as const, motivo: 'conflitto' as const }

        await tx.update(launchShifts).set({ lastAssignedAt: now }).where(and(
            eq(launchShifts.companyId, FENICE),
            eq(launchShifts.bucket, cfg.bucket),
            eq(launchShifts.kind, 'SERA'),
            eq(launchShifts.salesUserId, chosen.salesUserId),
            isNull(launchShifts.removedAt),
        ))
        await tx.insert(leadEvents).values([
            { id: crypto.randomUUID(), leadId: lead.id, eventType: 'APPOINTMENT_SET', userId: botUserId, timestamp: now, metadata: { source: 'lancio', kind: 'chiamata_subito', at: at.toISOString() }, companyId: FENICE },
            { id: crypto.randomUUID(), leadId: lead.id, eventType: 'LANCIO_CALL_NOW_ASSIGNED', userId: botUserId, timestamp: now, metadata: { salesUserId: chosen.salesUserId, info: input.info ?? null }, companyId: FENICE },
        ])
        // Il trigger 0019 la spinge sul topic `user:<venditore>` del bus: la
        // campanella suona da sola, nessun canale realtime nuovo.
        await tx.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: chosen.salesUserId,
            type: 'lancio_call_now',
            title: '🚀 Lancio: chiama subito',
            body: `${lead.name} ha chiesto di essere chiamato adesso`,
            metadata: { leadId: lead.id },
            status: 'unread',
            createdAt: now,
            companyId: FENICE,
        })
        return { ok: true as const, venditore: { id: chosen.salesUserId, nome } }
    })
}

/**
 * Marketing della chiamata subito, in `after()`: è un appuntamento fissato,
 * confermato e assegnato a un venditore — gli stessi tre eventi della mattina.
 * `appointment.outcome` non è un di più: la scrittura mette
 * `confirmationsOutcome='confermato'`, e senza l'evento Marketing Analytics
 * conterebbe ogni chiamata subito come "fissata e mai confermata".
 * Nessun Google Calendar: la chiamata è adesso, non domani.
 */
export async function callNowSideEffects(input: { leadId: string; botUserId: string }): Promise<void> {
    for (const eventType of ['appointment.set', 'appointment.outcome', 'deal.assigned'] as const) {
        await enqueueMarketingWebhook({ eventType, leadId: input.leadId, actorUserId: input.botUserId })
            .catch((e: unknown) => console.error(`[bot-lancio] webhook ${eventType} err:`, e))
    }
}
