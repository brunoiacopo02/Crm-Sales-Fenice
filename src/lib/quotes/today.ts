// Lettura lato server della citazione del giorno e del consiglio di vendita
// (PO 25/10/2026). Una sola query per giorno di Roma, in cache: la vedono
// tutti i GDO, le Conferme, i venditori e l'admin, ma il database la legge
// una volta ogni quarto d'ora al massimo. Il filtro per ruolo è fatto dopo,
// in memoria. Le modifiche dell'admin invalidano la cache (QUOTES_CACHE_TAG).
//
// Non dipende dalla migrazione 0048: se la colonna technique non c'è ancora,
// si legge senza (la tecnica serve solo al titolo di alcuni consigli). E un
// errore qualsiasi ferma le letture per qualche minuto: unstable_cache non
// salva le eccezioni, e senza freno ogni render rifarebbe la query che fallisce.

import { unstable_cache } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { dailyQuotes, dailyQuoteSchedule } from '@/db/schema'
import { toRomeDateStr } from '@/lib/dateUtils'
import { buildTodayQuotes, emptyToday, type DisplayRow, type TodayQuotes } from './display'
import { colonnaMancante, creaFreno } from './resilienza'

export const QUOTES_CACHE_TAG = 'daily-quotes'

/** Dopo un errore di lettura, per 5 minuti niente citazione e niente query. */
const frenoErrori = creaFreno(5 * 60_000)
/** Colonne della 0048 assenti: per 10 minuti si legge senza, poi si riprova la query completa. */
const senzaColonne0048 = creaFreno(10 * 60_000)

const campiBase = {
    kind: dailyQuoteSchedule.kind,
    approved: dailyQuoteSchedule.approved,
    reflection: dailyQuoteSchedule.reflection,
    text: dailyQuotes.text,
    author: dailyQuotes.author,
    work: dailyQuotes.work,
    roles: dailyQuotes.roles,
    isActive: dailyQuotes.isActive,
}

async function loadDayRows(day: string): Promise<DisplayRow[]> {
    if (!senzaColonne0048.fermo()) {
        try {
            return await db
                .select({ ...campiBase, technique: dailyQuotes.technique })
                .from(dailyQuoteSchedule)
                .innerJoin(dailyQuotes, eq(dailyQuotes.id, dailyQuoteSchedule.quoteId))
                .where(eq(dailyQuoteSchedule.day, day))
        } catch (e) {
            if (!colonnaMancante(e)) throw e
            senzaColonne0048.segnaErrore()
            console.warn('[citazioni] migrazione 0048 non applicata: leggo senza la tecnica del consiglio')
        }
    }
    const righe = await db
        .select(campiBase)
        .from(dailyQuoteSchedule)
        .innerJoin(dailyQuotes, eq(dailyQuotes.id, dailyQuoteSchedule.quoteId))
        .where(eq(dailyQuoteSchedule.day, day))
    return righe.map(r => ({ ...r, technique: null }))
}

// La chiave include il giorno (argomento): a mezzanotte di Roma si legge una riga nuova.
const cachedDayRows = unstable_cache(loadDayRows, ['daily-quotes-day-v1'], {
    revalidate: 900,
    tags: [QUOTES_CACHE_TAG],
})

/** Citazione e consiglio di oggi per quel ruolo. Non lancia mai: in caso di errore, niente. */
export async function readTodayQuotes(role: string | null | undefined, now: Date = new Date()): Promise<TodayQuotes> {
    const day = toRomeDateStr(now)
    if (frenoErrori.fermo()) return emptyToday(day)
    try {
        return buildTodayQuotes(day, await cachedDayRows(day), role)
    } catch (e) {
        frenoErrori.segnaErrore()
        console.error('[citazioni] lettura del giorno non riuscita, riprovo fra 5 minuti', e)
        return emptyToday(day)
    }
}
