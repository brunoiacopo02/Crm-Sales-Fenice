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
import { users, salesWeekPlans, salesLatePenalties, notifications } from '@/db/schema'
import { and, eq, inArray, gte } from 'drizzle-orm'
import { toRomeDateStr } from '../dateUtils'
import { weekStartFor, weeklyDeadline, romeHour, romeDow } from './calendarSlots'
import { selectMissingCalendarPenalties, calendarRuleState, type CalendarUserRow } from './calendarRules'

export interface CalendarRunnerResult {
    registered: number
    reminders: number
    skipped: string | null
}

/** Ore italiane in cui parte un promemoria del lunedì. */
const REMINDER_HOURS = [10, 13]

export async function runCalendarWeekly(now: Date = new Date()): Promise<CalendarRunnerResult> {
    const state = calendarRuleState()
    if (!state.active) {
        return { registered: 0, reminders: 0, skipped: state.reason }
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
    return { registered, reminders, skipped: null }
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
