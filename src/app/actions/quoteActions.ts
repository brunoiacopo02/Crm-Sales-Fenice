'use server'

// Citazione del giorno e consiglio di vendita (PO 25/10/2026).
// - getTodayQuotes: quello che vede chi lavora oggi, filtrato per ruolo (in cache).
// - Il resto è solo ADMIN: calendario dei prossimi giorni, approvazione delle
//   riflessioni e dei consigli (con la spiegazione online o no), cambio della
//   citazione assegnata a un giorno, a mano o estraendone un'altra a caso, e
//   frasi scritte dall'admin.
// Ogni modifica invalida la cache del giorno, così le schermate la vedono subito.

import { randomInt, randomUUID } from 'node:crypto'
import { revalidatePath, updateTag } from 'next/cache'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, dailyQuotes, dailyQuoteSchedule } from '@/db/schema'
import { conRuoloDb, ruoloDb } from '@/lib/auth/ruoloDb'
import { toRomeDateStr } from '@/lib/dateUtils'
import { readTodayQuotes, QUOTES_CACHE_TAG } from '@/lib/quotes/today'
import { countLines, emptyToday, REFLECTION_MAX_LINES, type TodayQuotes } from '@/lib/quotes/display'
import { addDays, isValidDay, parseClosedDays, workingDaysInRange, QUOTES_CLOSED_DAYS_KEY } from '@/lib/quotes/calendar'
import type { ActionResult, AdminCalendarDay, AdminDayEntry, AdminQuote, OwnQuoteInput, QuoteChoice } from '@/lib/quotes/adminTypes'

type Kind = 'citazione' | 'vendita'
const isKind = (k: unknown): k is Kind => k === 'citazione' || k === 'vendita'
const REFLECTION_MAX_CHARS = 2000
/** La frase sta in 2 righe, l'autore in una. */
const PHRASE_MAX_LINES = 2
const AUTHOR_MAX_CHARS = 80
/** Nell'estrazione si evitano le frasi già in calendario a meno di 120 giorni. */
const DRAW_GAP_DAYS = 120

/** ADMIN letto dalla tabella users, non dai metadati della sessione. */
function requireAdmin(): Promise<{ id: string } | null> {
    return conRuoloDb(['ADMIN'])
}

function invalidate() {
    updateTag(QUOTES_CACHE_TAG)
    revalidatePath('/admin/citazioni')
}

/**
 * Citazione e consiglio di oggi (giorno di Roma) per il ruolo di chi guarda.
 * Il ruolo arriva dalla tabella users; solo l'admin può chiedere la vista di un altro ruolo.
 */
export async function getTodayQuotes(role?: string | null): Promise<TodayQuotes> {
    const io = await ruoloDb()
    if (!io) return emptyToday(toRomeDateStr(new Date()))
    return readTodayQuotes(io.role === 'ADMIN' && role ? role : io.role)
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

const emptyEntry = (): AdminDayEntry => ({ quote: null, reflection: null, approved: false, approvedAt: null, showReflection: true })

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
                showReflection: s.showReflection,
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

/** Testo della spiegazione ripulito, o l'errore da mostrare. */
function cleanReflection(reflection: string): { text: string } | { error: string } {
    const text = (reflection ?? '').replace(/\r\n/g, '\n').trim()
    if (text.length > REFLECTION_MAX_CHARS) return { error: 'Testo troppo lungo.' }
    if (countLines(text) > REFLECTION_MAX_LINES) return { error: `Al massimo ${REFLECTION_MAX_LINES} righe.` }
    return { text }
}

/**
 * Approva il testo così com'è, modificato o riscritto (vuoto = giorno confermato senza approfondimento).
 * Con showReflection false il testo resta salvato ma online va la sola frase.
 */
export async function approveQuoteDay(day: string, kind: string, reflection: string, showReflection = true): Promise<ActionResult> {
    const admin = await requireAdmin()
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    const invalid = checkDay(day, kind)
    if (invalid) return { ok: false, error: invalid }
    const clean = cleanReflection(reflection)
    if ('error' in clean) return { ok: false, error: clean.error }
    const text = clean.text
    try {
        const updated = await db.update(dailyQuoteSchedule)
            .set({ reflection: text || null, approved: true, approvedBy: admin.id, approvedAt: new Date(), showReflection: showReflection !== false })
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
                set: { quoteId, reflection: null, approved: false, approvedBy: null, approvedAt: null, showReflection: true },
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

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T12:00:00Z`) / 86_400_000)

/**
 * Salta la frase del giorno e ne estrae un'altra a caso, da approvare come le
 * altre (la spiegazione suggerita arriva nel campo). Prima quelle con frase e
 * spiegazione mai in calendario a meno di 120 giorni, poi quelle con la sola
 * frase, poi qualsiasi frase diversa da quella del giorno.
 */
export async function drawAnotherQuote(day: string, kind: string): Promise<ActionResult> {
    const admin = await requireAdmin()
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    const invalid = checkDay(day, kind)
    if (invalid) return { ok: false, error: invalid }
    try {
        const [quotes, scheduled] = await Promise.all([
            db.select({ id: dailyQuotes.id, text: dailyQuotes.text, suggestedReflection: dailyQuotes.suggestedReflection })
                .from(dailyQuotes).where(and(eq(dailyQuotes.kind, kind), eq(dailyQuotes.isActive, true))),
            db.select({ day: dailyQuoteSchedule.day, quoteId: dailyQuoteSchedule.quoteId })
                .from(dailyQuoteSchedule).where(eq(dailyQuoteSchedule.kind, kind)),
        ])
        const current = scheduled.find(s => s.day === day)?.quoteId ?? null
        const target = dayNumber(day)
        const nearby = new Set(scheduled
            .filter(s => s.day !== day && Math.abs(dayNumber(s.day) - target) <= DRAW_GAP_DAYS)
            .map(s => s.quoteId))
        const others = quotes.filter(q => q.id !== current && q.text.trim())
        const tiers = [
            others.filter(q => !nearby.has(q.id) && q.suggestedReflection?.trim()),
            others.filter(q => !nearby.has(q.id)),
            others,
        ]
        const pool = tiers.find(t => t.length > 0)
        if (!pool) return { ok: false, error: 'Non ci sono altre frasi da estrarre.' }
        const quoteId = pool[randomInt(pool.length)].id
        await db.insert(dailyQuoteSchedule)
            .values({ day, kind, quoteId, reflection: null, approved: false })
            .onConflictDoUpdate({
                target: [dailyQuoteSchedule.day, dailyQuoteSchedule.kind],
                set: { quoteId, reflection: null, approved: false, approvedBy: null, approvedAt: null, showReflection: true },
            })
    } catch (e) {
        console.error('[citazioni] estrazione', e)
        return { ok: false, error: 'Estrazione non riuscita.' }
    }
    invalidate()
    return { ok: true }
}

/**
 * Frase scritta dall'admin per quel giorno: entra fra le frasi (fonte 'admin')
 * e il giorno risulta già approvato, con la spiegazione online o no.
 */
export async function writeOwnQuote(day: string, kind: string, input: OwnQuoteInput): Promise<ActionResult> {
    const admin = await requireAdmin()
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    const invalid = checkDay(day, kind)
    if (invalid) return { ok: false, error: invalid }
    const text = (input?.text ?? '').replace(/\r\n/g, '\n').trim()
    const author = (input?.author ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return { ok: false, error: 'Scrivi la frase.' }
    if (countLines(text) > PHRASE_MAX_LINES) return { ok: false, error: `La frase sta al massimo in ${PHRASE_MAX_LINES} righe.` }
    if (!author) return { ok: false, error: "Scrivi l'autore." }
    if (author.length > AUTHOR_MAX_CHARS) return { ok: false, error: 'Autore troppo lungo.' }
    const clean = cleanReflection(input?.reflection ?? '')
    if ('error' in clean) return { ok: false, error: clean.error }
    const reflection = clean.text || null
    const showReflection = input?.showReflection !== false
    const quoteId = `admin-${randomUUID()}`
    const now = new Date()
    const approval = { quoteId, reflection, approved: true, approvedBy: admin.id, approvedAt: now, showReflection }
    try {
        await db.transaction(async tx => {
            await tx.insert(dailyQuotes).values({
                id: quoteId, kind, text, author, suggestedReflection: reflection,
                reflectionSource: 'admin', verified: true, isActive: true,
            })
            await tx.insert(dailyQuoteSchedule)
                .values({ day, kind, ...approval })
                .onConflictDoUpdate({ target: [dailyQuoteSchedule.day, dailyQuoteSchedule.kind], set: approval })
        })
    } catch (e) {
        console.error("[citazioni] frase scritta dall'admin", e)
        return { ok: false, error: 'Salvataggio non riuscito.' }
    }
    invalidate()
    return { ok: true }
}
