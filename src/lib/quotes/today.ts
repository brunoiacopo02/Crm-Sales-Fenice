// Lettura lato server della citazione del giorno e del consiglio di vendita
// (PO 25/10/2026). Una sola query per giorno di Roma, in cache: la vedono
// tutti i GDO, le Conferme, i venditori e l'admin, ma il database la legge
// una volta ogni quarto d'ora al massimo. Il filtro per ruolo è fatto dopo,
// in memoria. Le modifiche dell'admin invalidano la cache (QUOTES_CACHE_TAG).

import { unstable_cache } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { dailyQuotes, dailyQuoteSchedule } from '@/db/schema'
import { toRomeDateStr } from '@/lib/dateUtils'
import { buildTodayQuotes, emptyToday, type DisplayRow, type TodayQuotes } from './display'

export const QUOTES_CACHE_TAG = 'daily-quotes'

async function loadDayRows(day: string): Promise<DisplayRow[]> {
    return db
        .select({
            kind: dailyQuoteSchedule.kind,
            approved: dailyQuoteSchedule.approved,
            reflection: dailyQuoteSchedule.reflection,
            text: dailyQuotes.text,
            author: dailyQuotes.author,
            work: dailyQuotes.work,
            technique: dailyQuotes.technique,
            roles: dailyQuotes.roles,
            isActive: dailyQuotes.isActive,
        })
        .from(dailyQuoteSchedule)
        .innerJoin(dailyQuotes, eq(dailyQuotes.id, dailyQuoteSchedule.quoteId))
        .where(eq(dailyQuoteSchedule.day, day))
}

// La chiave include il giorno (argomento): a mezzanotte di Roma si legge una riga nuova.
const cachedDayRows = unstable_cache(loadDayRows, ['daily-quotes-day-v1'], {
    revalidate: 900,
    tags: [QUOTES_CACHE_TAG],
})

/** Citazione e consiglio di oggi per quel ruolo. Non lancia mai: in caso di errore, niente. */
export async function readTodayQuotes(role: string | null | undefined, now: Date = new Date()): Promise<TodayQuotes> {
    const day = toRomeDateStr(now)
    try {
        return buildTodayQuotes(day, await cachedDayRows(day), role)
    } catch (e) {
        console.error('[citazioni] lettura del giorno non riuscita', e)
        return emptyToday(day)
    }
}
