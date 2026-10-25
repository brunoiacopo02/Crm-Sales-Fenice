'use server'

// Citazione del giorno e consiglio di vendita (PO 25/10/2026).
// - getTodayQuotes: quello che vede chi lavora oggi, filtrato per ruolo (in cache).
// - Il resto è solo ADMIN: calendario dei prossimi giorni, approvazione delle
//   riflessioni e dei consigli, cambio della citazione assegnata a un giorno.
// Ogni modifica invalida la cache del giorno, così le schermate la vedono subito.

import { revalidatePath, updateTag } from 'next/cache'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, dailyQuotes, dailyQuoteSchedule } from '@/db/schema'
import { createClient } from '@/utils/supabase/server'
import { toRomeDateStr } from '@/lib/dateUtils'
import { readTodayQuotes, QUOTES_CACHE_TAG } from '@/lib/quotes/today'
import { countLines, emptyToday, REFLECTION_MAX_LINES, type TodayQuotes } from '@/lib/quotes/display'
import { addDays, isValidDay, parseClosedDays, workingDaysInRange, QUOTES_CLOSED_DAYS_KEY } from '@/lib/quotes/calendar'
import type { ActionResult, AdminCalendarDay, AdminDayEntry, AdminQuote, QuoteChoice } from '@/lib/quotes/adminTypes'

type Kind = 'citazione' | 'vendita'
const isKind = (k: unknown): k is Kind => k === 'citazione' || k === 'vendita'
const REFLECTION_MAX_CHARS = 2000

async function sessionUser() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user
}

async function requireAdmin(): Promise<{ id: string } | null> {
    const user = await sessionUser()
    if (!user || user.user_metadata?.role !== 'ADMIN') return null
    return { id: user.id }
}

function invalidate() {
    updateTag(QUOTES_CACHE_TAG)
    revalidatePath('/admin/citazioni')
}

/**
 * Citazione e consiglio di oggi (giorno di Roma) per il ruolo di chi guarda.
 * Il ruolo arriva dalla sessione; solo l'admin può chiedere la vista di un altro ruolo.
 */
export async function getTodayQuotes(role?: string | null): Promise<TodayQuotes> {
    const user = await sessionUser()
    if (!user) return emptyToday(toRomeDateStr(new Date()))
    const own = typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : null
    return readTodayQuotes(own === 'ADMIN' && role ? role : own)
}

async function readClosedDays(): Promise<string[]> {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings)
        .where(eq(appSettings.key, QUOTES_CLOSED_DAYS_KEY)).limit(1)
    return parseClosedDays(row?.value)
}

const dayLabel = (day: string) =>
    new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
        .format(new Date(`${day}T12:00:00Z`))

type QuoteRow = typeof dailyQuotes.$inferSelect

function toAdminQuote(q: QuoteRow): AdminQuote {
    return {
        id: q.id, kind: q.kind, text: q.text, author: q.author, work: q.work, reference: q.reference,
        translationUrl: q.translationUrl, translator: q.translator, theme: q.theme, occasions: q.occasions,
        roles: q.roles, suggestedReflection: q.suggestedReflection, reflectionSource: q.reflectionSource,
        technique: q.technique, usage: q.usage, originalText: q.originalText, isActive: q.isActive,
    }
}

const emptyEntry = (): AdminDayEntry => ({ quote: null, reflection: null, approved: false, approvedAt: null })

/** Prossimi giorni lavorativi (da oggi) con citazione e consiglio assegnati. */
export async function getQuoteCalendar(count = 14): Promise<
    { ok: true; days: AdminCalendarDay[]; closedDays: string[] } | { ok: false; error: string }
> {
    const admin = await requireAdmin()
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    try {
        const today = toRomeDateStr(new Date())
        const closedDays = await readClosedDays()
        const n = Math.min(Math.max(Math.floor(count), 1), 40)
        const days = workingDaysInRange(today, addDays(today, 90), new Set(closedDays)).slice(0, n)
        const rows = days.length === 0 ? [] : await db
            .select({ s: dailyQuoteSchedule, q: dailyQuotes })
            .from(dailyQuoteSchedule)
            .innerJoin(dailyQuotes, eq(dailyQuotes.id, dailyQuoteSchedule.quoteId))
            .where(inArray(dailyQuoteSchedule.day, days))

        const calendar: AdminCalendarDay[] = days.map(day => ({
            day, label: dayLabel(day), isToday: day === today, citazione: emptyEntry(), vendita: emptyEntry(),
        }))
        const byDay = new Map(calendar.map(d => [d.day, d]))
        for (const { s, q } of rows) {
            const target = byDay.get(s.day)
            if (!target || !isKind(s.kind)) continue
            target[s.kind] = {
                quote: toAdminQuote(q),
                reflection: s.reflection,
                approved: s.approved,
                approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
            }
        }
        return { ok: true, days: calendar, closedDays }
    } catch (e) {
        console.error('[citazioni] calendario admin', e)
        return { ok: false, error: 'Calendario non disponibile.' }
    }
}

function checkDay(day: string, kind: string): string | null {
    if (!isValidDay(day) || !isKind(kind)) return 'Giorno o tipo non valido.'
    if (day < toRomeDateStr(new Date())) return 'I giorni passati non si cambiano.'
    return null
}

/** Approva il testo così com'è, modificato o riscritto (vuoto = giorno confermato senza approfondimento). */
export async function approveQuoteDay(day: string, kind: string, reflection: string): Promise<ActionResult> {
    const admin = await requireAdmin()
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    const invalid = checkDay(day, kind)
    if (invalid) return { ok: false, error: invalid }
    const text = (reflection ?? '').replace(/\r\n/g, '\n').trim()
    if (text.length > REFLECTION_MAX_CHARS) return { ok: false, error: 'Testo troppo lungo.' }
    if (countLines(text) > REFLECTION_MAX_LINES) return { ok: false, error: `Al massimo ${REFLECTION_MAX_LINES} righe.` }
    try {
        const updated = await db.update(dailyQuoteSchedule)
            .set({ reflection: text || null, approved: true, approvedBy: admin.id, approvedAt: new Date() })
            .where(and(eq(dailyQuoteSchedule.day, day), eq(dailyQuoteSchedule.kind, kind)))
            .returning({ day: dailyQuoteSchedule.day })
        if (updated.length === 0) return { ok: false, error: 'Quel giorno non ha una citazione assegnata.' }
    } catch (e) {
        console.error('[citazioni] approvazione', e)
        return { ok: false, error: 'Salvataggio non riuscito.' }
    }
    invalidate()
    return { ok: true }
}

/** Toglie l'approvazione: il testo resta come bozza, ma non si vede più. */
export async function unapproveQuoteDay(day: string, kind: string): Promise<ActionResult> {
    const admin = await requireAdmin()
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    const invalid = checkDay(day, kind)
    if (invalid) return { ok: false, error: invalid }
    try {
        await db.update(dailyQuoteSchedule)
            .set({ approved: false, approvedBy: null, approvedAt: null })
            .where(and(eq(dailyQuoteSchedule.day, day), eq(dailyQuoteSchedule.kind, kind)))
    } catch (e) {
        console.error('[citazioni] rimozione approvazione', e)
        return { ok: false, error: 'Salvataggio non riuscito.' }
    }
    invalidate()
    return { ok: true }
}

/** Mette un'altra citazione su quel giorno: testo e approvazione ripartono da zero. */
export async function assignQuoteToDay(day: string, kind: string, quoteId: string): Promise<ActionResult> {
    const admin = await requireAdmin()
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    const invalid = checkDay(day, kind)
    if (invalid) return { ok: false, error: invalid }
    if (!isKind(kind)) return { ok: false, error: 'Tipo non valido.' }
    try {
        const [quote] = await db.select({ kind: dailyQuotes.kind, isActive: dailyQuotes.isActive })
            .from(dailyQuotes).where(eq(dailyQuotes.id, quoteId)).limit(1)
        if (!quote || quote.kind !== kind || !quote.isActive) return { ok: false, error: 'Citazione non disponibile.' }
        await db.insert(dailyQuoteSchedule)
            .values({ day, kind, quoteId, reflection: null, approved: false })
            .onConflictDoUpdate({
                target: [dailyQuoteSchedule.day, dailyQuoteSchedule.kind],
                set: { quoteId, reflection: null, approved: false, approvedBy: null, approvedAt: null },
            })
    } catch (e) {
        console.error('[citazioni] cambio citazione', e)
        return { ok: false, error: 'Salvataggio non riuscito.' }
    }
    invalidate()
    return { ok: true }
}

/** Elenco per scegliere un'altra citazione, con i giorni in cui ciascuna è già in calendario. */
export async function listQuoteChoices(kind: string): Promise<{ ok: true; items: QuoteChoice[] } | { ok: false; error: string }> {
    const admin = await requireAdmin()
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    if (!isKind(kind)) return { ok: false, error: 'Tipo non valido.' }
    try {
        const [quotes, scheduled] = await Promise.all([
            db.select({
                id: dailyQuotes.id, text: dailyQuotes.text, author: dailyQuotes.author, work: dailyQuotes.work,
                theme: dailyQuotes.theme, technique: dailyQuotes.technique, occasions: dailyQuotes.occasions,
            }).from(dailyQuotes)
                .where(and(eq(dailyQuotes.kind, kind), eq(dailyQuotes.isActive, true)))
                .orderBy(asc(dailyQuotes.author), asc(dailyQuotes.text)),
            db.select({ day: dailyQuoteSchedule.day, quoteId: dailyQuoteSchedule.quoteId })
                .from(dailyQuoteSchedule).where(eq(dailyQuoteSchedule.kind, kind)),
        ])
        const usedOn = new Map<string, string[]>()
        for (const s of scheduled) usedOn.set(s.quoteId, [...(usedOn.get(s.quoteId) ?? []), s.day])
        return {
            ok: true,
            items: quotes.map(q => ({ ...q, usedOn: (usedOn.get(q.id) ?? []).sort() })),
        }
    } catch (e) {
        console.error('[citazioni] elenco citazioni', e)
        return { ok: false, error: 'Elenco non disponibile.' }
    }
}
