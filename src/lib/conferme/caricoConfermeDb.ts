// Letture della pagina /admin/carico-conferme (PO 09/11/2026).
// Non è un file "use server": non controlla il ruolo, lo fa la pagina.
//
// Costo: una sola query sui lead in APPOINTMENT di Fenice con una call, un
// parcheggio o un richiamo nei prossimi tre giorni lavorativi (qualche
// centinaio di righe al massimo), due join per chiave primaria sui nomi di
// venditore e Conferme. I conti li fa caricoConferme.ts. Il risultato sta in
// una cache di 45 secondi condivisa fra chi guarda.

import { unstable_cache } from 'next/cache'
import { and, eq, isNull, ne, or, gte, lt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import { leads, users } from '@/db/schema'
import { dayBoundsRome } from '@/lib/dateUtils'
import { personName } from '@/lib/diretta/config'
import { leadVero } from '@/lib/prova/sql'
import { SELF_BOOKED_OUTCOME } from '@/lib/salesPipeline/sentinel'
import { calcolaCarico, finestraDaLeggere, type CaricoConferme, type LeadCarico } from './caricoConferme'

const FENICE = 'fenice'
export const CACHE_SECONDI = 45
export const TAG_CARICO_CONFERME = 'carico-conferme'

const venditoreU = alias(users, 'venditore_u')
const confermeU = alias(users, 'conferme_u')

async function leggi(): Promise<CaricoConferme> {
    const now = new Date()
    const { dal, al } = finestraDaLeggere(now)
    const inizio = dayBoundsRome(new Date(`${dal}T12:00:00Z`)).start
    const fine = dayBoundsRome(new Date(`${al}T12:00:00Z`)).end
    const inFinestra = (col: typeof leads.appointmentDate | typeof leads.recallDate | typeof leads.confSnoozeAt) => and(gte(col, inizio), lt(col, fine))

    const righe = await db.select({
        id: leads.id,
        funnel: leads.funnel,
        appointmentDate: leads.appointmentDate,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        appointmentMovedAt: leads.appointmentMovedAt,
        confirmationsOutcome: leads.confirmationsOutcome,
        confNeedsReschedule: leads.confNeedsReschedule,
        recallDate: leads.recallDate,
        confSnoozeAt: leads.confSnoozeAt,
        salespersonAssigned: leads.salespersonAssigned,
        venditoreFirst: venditoreU.firstName,
        venditoreDisplay: venditoreU.displayName,
        venditoreName: venditoreU.name,
        confermeFirst: confermeU.firstName,
        confermeDisplay: confermeU.displayName,
        confermeName: confermeU.name,
    }).from(leads)
        .leftJoin(venditoreU, eq(leads.salespersonUserId, venditoreU.id))
        .leftJoin(confermeU, eq(leads.confirmationsUserId, confermeU.id))
        .where(and(
            eq(leads.companyId, FENICE),
            eq(leads.status, 'APPOINTMENT'),
            leadVero(),
            // Gli autofissati del venditore non passano dalle Conferme.
            or(isNull(leads.confirmationsOutcome), ne(leads.confirmationsOutcome, SELF_BOOKED_OUTCOME)),
            or(
                inFinestra(leads.appointmentDate),
                and(eq(leads.confNeedsReschedule, true), inFinestra(leads.recallDate)),
                inFinestra(leads.confSnoozeAt),
            ),
        ))

    const rows: LeadCarico[] = righe.map(r => ({
        id: r.id,
        funnel: r.funnel,
        appointmentDate: r.appointmentDate,
        appointmentCreatedAt: r.appointmentCreatedAt,
        appointmentMovedAt: r.appointmentMovedAt,
        confirmationsOutcome: r.confirmationsOutcome,
        confNeedsReschedule: r.confNeedsReschedule,
        recallDate: r.recallDate,
        confSnoozeAt: r.confSnoozeAt,
        venditore: (r.venditoreFirst || r.venditoreDisplay || r.venditoreName)
            ? personName({ firstName: r.venditoreFirst, displayName: r.venditoreDisplay, name: r.venditoreName })
            : r.salespersonAssigned,
        conferme: (r.confermeFirst || r.confermeDisplay || r.confermeName)
            ? personName({ firstName: r.confermeFirst, displayName: r.confermeDisplay, name: r.confermeName })
            : null,
    }))
    return calcolaCarico(rows, now)
}

const inCache = unstable_cache(leggi, ['carico-conferme-v2'], { revalidate: CACHE_SECONDI, tags: [TAG_CARICO_CONFERME] })

/** Carico delle Conferme, in cache 45 secondi. null se la lettura non riesce. */
export async function leggiCaricoConferme(): Promise<CaricoConferme | null> {
    try {
        return await inCache()
    } catch (e) {
        console.error('[carico conferme] lettura', e)
        return null
    }
}
