// Lettura della serie dal registro (solo server). Le regole sono in ./serie.ts.

import { and, eq, inArray, like, or } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, currencyLedger } from '@/db/schema'
import { toRomeDateStr } from '@/lib/dateUtils'
import { parseClosedDays, QUOTES_CLOSED_DAYS_KEY } from '@/lib/quotes/calendar'
import { calcolaSerie, scudiComprati, giorniFatti, type AcquistoScudo, type RigaSerie, type StatoSerie } from './serie'

/** db oppure una transazione: basta che sappia leggere. */
type Lettore = Pick<typeof db, 'select'>

/**
 * Le righe della persona che servono alla serie: primi scalini (e storni),
 * tappe (e storni), acquisti e rimborsi del negozio. Passa dall'indice
 * (userId, createdAt): sono poche righe al giorno.
 */
export async function leggiRigheSerie(l: Lettore, userId: string): Promise<RigaSerie[]> {
    return l.select({
        idemKey: currencyLedger.idemKey, reason: currencyLedger.reason, amount: currencyLedger.amount,
        createdAt: currencyLedger.createdAt, metadata: currencyLedger.metadata,
    }).from(currencyLedger).where(and(
        eq(currencyLedger.userId, userId),
        or(
            like(currencyLedger.idemKey, `S:scalino:${userId}:%`),
            like(currencyLedger.idemKey, `storno:S:scalino:${userId}:%`),
            like(currencyLedger.idemKey, `S:serie:${userId}:%`),
            like(currencyLedger.idemKey, `P:serie:${userId}:%`),
            like(currencyLedger.idemKey, `storno:S:serie:${userId}:%`),
            like(currencyLedger.idemKey, `storno:P:serie:${userId}:%`),
            inArray(currencyLedger.reason, ['negozio', 'negozio_rimborso']),
        ),
    ))
}

/** Chiusure dell'ufficio (le stesse della citazione del giorno): per la serie non sono giorni lavorativi. */
export async function leggiChiusure(l: Lettore): Promise<Set<string>> {
    try {
        const [row] = await l.select({ value: appSettings.value }).from(appSettings)
            .where(eq(appSettings.key, QUOTES_CLOSED_DAYS_KEY)).limit(1)
        return new Set(parseClosedDays(row?.value))
    } catch {
        return new Set()
    }
}

export interface SerieLetta {
    stato: StatoSerie
    scudi: AcquistoScudo[]
    righe: RigaSerie[]
    oggi: string
}

/** La serie della persona adesso, dal registro. */
export async function leggiSerie(l: Lettore, userId: string, now: Date = new Date()): Promise<SerieLetta> {
    const [righe, chiusi] = await Promise.all([leggiRigheSerie(l, userId), leggiChiusure(l)])
    const oggi = toRomeDateStr(now)
    const scudi = scudiComprati(righe, toRomeDateStr)
    const stato = calcolaSerie({ fatti: giorniFatti(righe, userId), scudi, oggi, chiusi })
    return { stato, scudi, righe, oggi }
}
