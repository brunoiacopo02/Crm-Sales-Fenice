/**
 * Giro settimanale del calendario: multa chi non ha compilato e manda i due
 * promemoria del lunedì.
 *
 * Gira dentro il cron dei ritardi (ogni 30 minuti). Il controllo è "il lunedì
 * di questa settimana è già passato?", non "oggi è lunedì": così se il cron
 * salta il pomeriggio di lunedì la multa arriva comunque, sempre datata
 * lunedì 14:00.
 */

import { db } from '@/db'
import { users, salesWeekPlans, salesLatePenalties, notifications, salesAvailabilitySlots, salesWeekTemplateSlots } from '@/db/schema'
import { and, eq, inArray, gte } from 'drizzle-orm'
import { toRomeDateStr } from '../dateUtils'
import { weekStartFor, weeklyDeadline, romeHour, romeDow, addWeeks } from './calendarSlots'
import { slotsFromTemplate, type TemplateSlot } from './calendarTemplate'
import { selectMissingCalendarPenalties, calendarRuleState, type CalendarUserRow } from './calendarRules'

export interface CalendarRunnerResult {
    registered: number
    reminders: number
    skipped: string | null
    materialized: TemplateMaterializationResult
}

export interface TemplateMaterializationResult {
    weeks: number
    slots: number
    /** Iterazioni venditore×settimana fallite: DB in errore, non "niente da fare". */
    failed: number
}

/** Quante settimane in avanti copre la materializzazione: la corrente + tre. */
const TEMPLATE_LOOKAHEAD_WEEKS = 4

/**
 * Materializza la "settimana tipo" (`salesWeekTemplateSlots`) in ore vere
 * (`salesAvailabilitySlots` + riga `salesWeekPlans`) per la settimana corrente
 * e le tre successive, per ogni venditore attivo che ha impostato un modello.
 *
 * Tocca solo le settimane SENZA riga in `salesWeekPlans`: una settimana
 * compilata a mano (o già materializzata) non si riscrive mai. Idempotente per
 * costruzione — `onConflictDoNothing()` sugli slot e sul piano — così un
 * secondo giro dello stesso cron (ogni 30 minuti) non produce nulla di nuovo.
 *
 * Deve girare PRIMA del calcolo delle multe in `runCalendarWeekly`: altrimenti
 * il primo giro del lunedì dopo le 14:00 multerebbe qualcuno un istante prima
 * di compilargli la settimana dal suo stesso modello.
 *
 * `salesUserId`, se passato, restringe la scansione a un solo venditore: il
 * salvataggio del modello (Task 4) la richiama per la persona che ha appena
 * salvato, e senza questo filtro ogni salvataggio individuale scatenerebbe
 * una scansione dell'intero team. Il cron la chiama senza secondo argomento.
 */
export async function materializeTemplates(now: Date = new Date(), salesUserId?: string): Promise<TemplateMaterializationResult> {
    // Nessun filtro companyId: tabella per-utente (vedi NOTA COMUNE in schema.ts).
    const templateRows = await db.select({
        salesUserId: salesWeekTemplateSlots.salesUserId,
        dow: salesWeekTemplateSlots.dow,
        hour: salesWeekTemplateSlots.hour,
    }).from(salesWeekTemplateSlots)
        .where(salesUserId ? eq(salesWeekTemplateSlots.salesUserId, salesUserId) : undefined)
    if (templateRows.length === 0) return { weeks: 0, slots: 0, failed: 0 }

    const templatesByUser = new Map<string, TemplateSlot[]>()
    for (const row of templateRows) {
        const arr = templatesByUser.get(row.salesUserId)
        if (arr) arr.push({ dow: row.dow, hour: row.hour })
        else templatesByUser.set(row.salesUserId, [{ dow: row.dow, hour: row.hour }])
    }

    // Solo isActive: gli esenti (calendarExempt) hanno comunque diritto al
    // modello se lo impostano, escluderli sarebbe un'altra regola non chiesta.
    const venditori = await db.select({
        id: users.id,
        companyId: users.companyId,
    }).from(users).where(and(
        eq(users.role, 'VENDITORE'),
        eq(users.isActive, true),
        inArray(users.id, [...templatesByUser.keys()]),
    ))
    if (venditori.length === 0) return { weeks: 0, slots: 0, failed: 0 }

    const weekStarts: Date[] = []
    for (let i = 0; i < TEMPLATE_LOOKAHEAD_WEEKS; i++) weekStarts.push(addWeeks(weekStartFor(now), i))
    const weekKeys = weekStarts.map(toRomeDateStr)

    // Nessun filtro companyId: tabella per-utente.
    const existingPlans = await db.select({
        salesUserId: salesWeekPlans.salesUserId,
        weekStart: salesWeekPlans.weekStart,
    }).from(salesWeekPlans).where(and(
        inArray(salesWeekPlans.salesUserId, venditori.map(v => v.id)),
        inArray(salesWeekPlans.weekStart, weekKeys),
    ))
    const already = new Set(existingPlans.map(p => `${p.salesUserId}@${p.weekStart}`))

    let weeks = 0
    let slots = 0
    let failed = 0

    for (const venditore of venditori) {
        const template = templatesByUser.get(venditore.id)
        if (!template) continue

        for (let i = 0; i < weekStarts.length; i++) {
            const weekStart = weekStarts[i]
            const weekKey = weekKeys[i]
            if (already.has(`${venditore.id}@${weekKey}`)) continue

            const wanted = slotsFromTemplate(template, weekStart, now)
            if (wanted.length === 0) continue

            try {
                // Una transazione per iterazione (venditore × settimana), non
                // una sola attorno a tutto: se un venditore fallisce, quelli
                // già scritti restano scritti. Slot e piano devono atterrare
                // insieme — altrimenti un'interruzione a metà lascia ore
                // materializzate senza la riga del piano, e quel venditore
                // verrebbe multato al giro dopo pur avendo già le disponibilità.
                await db.transaction(async (tx) => {
                    await tx.insert(salesAvailabilitySlots).values(wanted.map(slotStart => ({
                        id: crypto.randomUUID(),
                        companyId: venditore.companyId,
                        salesUserId: venditore.id,
                        slotStart,
                        weekStart: weekKey,
                    }))).onConflictDoNothing()

                    await tx.insert(salesWeekPlans).values({
                        id: crypto.randomUUID(),
                        companyId: venditore.companyId,
                        salesUserId: venditore.id,
                        weekStart: weekKey,
                        submittedAt: now,
                        updatedAt: now,
                        slotCount: wanted.length,
                        late: false,
                        fromTemplate: true,
                    }).onConflictDoNothing()
                })

                weeks++
                slots += wanted.length
            } catch (e) {
                // Un venditore in errore non deve fermare gli altri, né far
                // fallire l'intero giro del cron (multe e promemoria compresi).
                failed++
                console.error(`materializeTemplates: venditore ${venditore.id}, settimana ${weekKey}:`, e)
            }
        }
    }

    return { weeks, slots, failed }
}

/** Ore italiane in cui parte un promemoria del lunedì. */
const REMINDER_HOURS = [10, 13]

export async function runCalendarWeekly(now: Date = new Date()): Promise<CalendarRunnerResult> {
    // Fuori dal gate delle multe di proposito: gli slot materializzati alimentano
    // anche il muro sul fissaggio e la copertura, che hanno un interruttore loro
    // (BOOKING_WALL). Se spegnere le multe smettesse di materializzare, le
    // disponibilita' sparirebbero e il muro comincerebbe a bloccare tutto.
    const materialized = await materializeTemplates(now)

    const state = calendarRuleState()
    if (!state.active) {
        return { registered: 0, reminders: 0, skipped: state.reason, materialized }
    }

    const weekStart = weekStartFor(now)
    const weekKey = toRomeDateStr(weekStart)

    const venditori: CalendarUserRow[] = (await db.select({
        id: users.id,
        companyId: users.companyId,
        isActive: users.isActive,
        calendarExempt: users.calendarExempt,
        // Serve a `selectMissingCalendarPenalties`: chi è entrato dopo la
        // scadenza non viene multato per una settimana in cui non esisteva.
        createdAt: users.createdAt,
    }).from(users).where(eq(users.role, 'VENDITORE')))

    // La materializzazione (sopra, fuori dal gate) resta comunque prima del
    // calcolo delle multe: chi ha un modello risulta compilato in automatico, e
    // la query di `plans` qui sotto (da cui nasce `submitted`) deve già vederlo
    // — altrimenti lo si multerebbe un istante prima di materializzarlo.
    const plans = await db.select({ salesUserId: salesWeekPlans.salesUserId })
        .from(salesWeekPlans)
        .where(eq(salesWeekPlans.weekStart, weekKey))
    const submitted = new Set(plans.map(p => p.salesUserId))

    const pending = selectMissingCalendarPenalties(venditori, submitted, weekStart, now, state.from)

    let registered = 0
    if (pending.length > 0) {
        // onConflictDoNothing + unique parziale (salesUserId, kind, dueAt):
        // il cron può girare venti volte, la multa resta una.
        const inserted = await db.insert(salesLatePenalties).values(pending.map(p => ({
            id: crypto.randomUUID(),
            companyId: p.companyId,
            salesUserId: p.salesUserId,
            leadId: null,
            kind: p.kind,
            dueAt: p.dueAt,
            detectedAt: now,
            amountEur: p.amountEur,
            monthKey: p.monthKey,
            note: `Calendario della settimana del ${weekKey} non compilato entro lunedì 14:00.`,
        }))).onConflictDoNothing().returning({ id: salesLatePenalties.id, salesUserId: salesLatePenalties.salesUserId })
        registered = inserted.length

        for (const row of inserted) {
            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: row.salesUserId,
                type: 'calendar_penalty',
                title: 'Multa: calendario non compilato',
                body: `Non hai compilato le disponibilità entro lunedì 14:00: trattenuta di 50 €. Puoi compilare comunque.`,
                metadata: { weekStart: weekKey },
                companyId: venditori.find(v => v.id === row.salesUserId)?.companyId ?? 'fenice',
            })
        }
    }

    const reminders = await sendMondayReminders(now, weekStart, weekKey, venditori, submitted)
    return { registered, reminders, skipped: null, materialized }
}

/**
 * Promemoria delle 10 e delle 13 del lunedì a chi non ha ancora compilato.
 * Idempotenti: si guarda se esiste già una notifica dello stesso tipo per quella
 * settimana e quella fascia.
 */
async function sendMondayReminders(
    now: Date,
    weekStart: Date,
    weekKey: string,
    venditori: CalendarUserRow[],
    submitted: Set<string>,
): Promise<number> {
    if (romeDow(now) !== 1) return 0
    const hour = romeHour(now)
    const slot = REMINDER_HOURS.find(h => hour === h)
    if (slot === undefined) return 0
    if (now >= weeklyDeadline(weekStart)) return 0

    const target = venditori.filter(v => v.isActive && !v.calendarExempt && !submitted.has(v.id))
    if (target.length === 0) return 0

    const already = await db.select({
        recipientUserId: notifications.recipientUserId,
        metadata: notifications.metadata,
    }).from(notifications).where(and(
        eq(notifications.type, 'calendar_reminder'),
        inArray(notifications.recipientUserId, target.map(t => t.id)),
        gte(notifications.createdAt, weekStart),
    ))
    const done = new Set(
        already
            .filter(a => (a.metadata as any)?.slot === slot && (a.metadata as any)?.weekStart === weekKey)
            .map(a => a.recipientUserId),
    )

    const da = target.filter(t => !done.has(t.id))
    if (da.length === 0) return 0

    await db.insert(notifications).values(da.map(t => ({
        id: crypto.randomUUID(),
        recipientUserId: t.id,
        type: 'calendar_reminder',
        title: 'Calendario da compilare',
        body: slot === 10
            ? 'Ricordati di dichiarare le tue disponibilità della settimana: scadenza oggi alle 14:00.'
            : 'Ultimo avviso: mancano meno di due ore alla scadenza delle 14:00. Senza calendario scatta la multa da 50 €.',
        metadata: { weekStart: weekKey, slot },
        companyId: t.companyId,
    })))

    return da.length
}
