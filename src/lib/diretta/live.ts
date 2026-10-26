// Numeri della home "Diretta" (PO 25/10/2026), lato server.
//
// I dati di squadra sono uguali per tutti i GDO: si calcolano al massimo una
// volta ogni 15 secondi per azienda e giorno di Roma (unstable_cache), così
// dieci schede aperte non moltiplicano le query. I dati personali sono pochi
// e passano dagli indici (calllogs_company_user_created_idx,
// leads_presented_at_idx): si leggono freschi, tranne le settimane passate
// della miglior settimana, che non cambiano più e restano in cache un'ora.
//
// "Fissato" = fissato valido (./fissati.ts): lead distinto con callLog
// APPUNTAMENTO del GDO nel periodo che è ancora in appuntamento. È la stessa
// definizione degli scalini personali e dei forzieri: numeri e premi coincidono.

import { unstable_cache } from 'next/cache'
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { db } from '@/db'
import { leads, manualAdjustments, users } from '@/db/schema'
import { dayBoundsRome, toRomeDateStr, weekBoundsRome } from '@/lib/dateUtils'
import { countPresences } from '@/lib/presenceCounting'
import { euroFromPresences, peakWindow, personName, type GamificationTargets } from './config'
import { readGamificationTargets } from './settings'
import { readEconomyRules } from '@/lib/economy/awards'
import { prossimaTappa, type TappaSerie } from '@/lib/economy/serie'
import { leggiSerie } from '@/lib/economy/serieDb'
import { contaFissati } from './fissati'
import { leggiFissati, leggiMembriSquadra } from './fissatiDb'
import {
    FISSATI_DAL, PRESENZE_DAL, distintiPerSettimana, etichettaGiorno,
    migliorSettimana, sommaPerSettimana, ultimiPerLead,
} from './home'

export const TAG_DIRETTA_SQUADRA = 'diretta-squadra'
export const TAG_DIRETTA_OBIETTIVI = 'diretta-obiettivi'

export interface CronacaVoce {
    id: string
    at: string
    userId: string
    nome: string
    /** Giorno dell'appuntamento in chiaro (oggi, domani, martedì), se c'è. */
    giorno: string | null
}

export interface DirettaSquadra {
    giorno: string
    calcolatoAlle: string
    obiettivi: GamificationTargets
    fissati: number
    punta: number
    puntaInizio: string | null
    puntaFine: string | null
    cronaca: CronacaVoce[]
    membri: string[]
}

export interface DirettaMia {
    fissatiOggi: number
    fissatiSettimana: number
    presenzeSettimana: number
    /**
     * Conferme della settimana (PO 26/10/2026): appuntamenti del GDO che le
     * Conferme hanno esitato "confermato" questa settimana, presenti o no.
     */
    confermeSettimana: number
    /** Confermati con l'appuntamento da oggi in poi, non ancora esitati dal venditore: possibili presenze. */
    confermeInAttesa: number
    euroSettimana: number
    migliorePresenze: { valore: number; settimana: string | null }
    miglioreFissati: { valore: number; settimana: string | null }
    scintille: number
    piume: number
    /** Serie dei giorni al primo scalino (src/lib/economy/serie.ts). */
    serie: SerieMia
}

export interface SerieMia {
    giorni: number
    oggiFatto: boolean
    oggiLavorativo: boolean
    /** Primo scalino del giorno (fissati validi). */
    soglia: number
    prossima: TappaSerie | null
    scudiInTasca: number
}

async function calcolaSquadra(companyId: string, giorno: string): Promise<DirettaSquadra> {
    const now = new Date()
    const obiettivi = await readGamificationTargets()
    const { start, end } = dayBoundsRome(now)
    const membri = await leggiMembriSquadra(companyId)
    const ids = membri.map(m => m.id)
    const punta = peakWindow(now, obiettivi)

    // Fissati validi di oggi, dal più recente: anche la cronaca mostra solo
    // gli appuntamenti che ci sono ancora.
    const righe = await leggiFissati({ companyId, userIds: ids, start, end })
    const ultimi = ultimiPerLead(righe, 8)
    const appuntamenti = ultimi.length === 0 ? [] : await db.select({ id: leads.id, appointmentDate: leads.appointmentDate })
        .from(leads)
        .where(and(eq(leads.companyId, companyId), inArray(leads.id, ultimi.map(u => u.leadId))))
    const quando = new Map(appuntamenti.map(a => [a.id, a.appointmentDate]))
    const nomi = new Map(membri.map(m => [m.id, personName(m)]))

    return {
        giorno,
        calcolatoAlle: now.toISOString(),
        obiettivi,
        fissati: contaFissati(righe).totale,
        punta: punta ? contaFissati(righe, punta.start, punta.end).totale : 0,
        puntaInizio: punta?.start.toISOString() ?? null,
        puntaFine: punta?.end.toISOString() ?? null,
        cronaca: ultimi.map(r => {
            const appuntamento = quando.get(r.leadId) ?? null
            return {
                id: r.id,
                at: r.createdAt.toISOString(),
                userId: r.userId ?? '',
                nome: nomi.get(r.userId ?? '') ?? '',
                giorno: appuntamento ? etichettaGiorno(appuntamento, now) : null,
            }
        }),
        membri: ids,
    }
}

const squadraInCache = unstable_cache(calcolaSquadra, ['diretta-squadra-v1'], {
    revalidate: 15,
    tags: [TAG_DIRETTA_SQUADRA],
})

/** Dati di squadra di oggi, in cache 15 secondi per azienda e giorno di Roma. */
export function leggiSquadra(companyId: string): Promise<DirettaSquadra> {
    return squadraInCache(companyId, toRomeDateStr(new Date()))
}

const obiettiviInCache = unstable_cache(() => readGamificationTargets(), ['diretta-obiettivi-v1'], {
    revalidate: 60,
    tags: [TAG_DIRETTA_OBIETTIVI],
})

/** Obiettivi per la barra in alto (turno): cambiano di rado, cache di un minuto. */
export function leggiObiettivi(): Promise<GamificationTargets> {
    return obiettiviInCache()
}

/**
 * Miglior settimana nelle settimane CHIUSE (prima di quella corrente): non
 * cambiano più, quindi stanno in cache un'ora. La settimana corrente si
 * confronta a parte, con i numeri freschi.
 */
async function calcolaMiglioriPassate(userId: string, companyId: string, inizioSettimanaIso: string) {
    const inizio = new Date(inizioSettimanaIso)
    const [presentati, aggiustamenti, fissati] = await Promise.all([
        inizio > PRESENZE_DAL ? db.select({ at: leads.presentedAt })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                eq(leads.assignedToId, userId),
                eq(leads.confirmationsOutcome, 'confermato'),
                isNotNull(leads.presentedAt),
                gte(leads.presentedAt, PRESENZE_DAL),
                lt(leads.presentedAt, inizio),
            )) : Promise.resolve([]),
        inizio > PRESENZE_DAL ? db.select({ at: manualAdjustments.createdAt, n: manualAdjustments.count })
            .from(manualAdjustments)
            .where(and(
                eq(manualAdjustments.companyId, companyId),
                eq(manualAdjustments.userId, userId),
                eq(manualAdjustments.type, 'presenze'),
                gte(manualAdjustments.createdAt, PRESENZE_DAL),
                lt(manualAdjustments.createdAt, inizio),
            )).catch(() => [] as { at: Date; n: number }[]) : Promise.resolve([]),
        inizio > FISSATI_DAL
            ? leggiFissati({ companyId, userIds: [userId], start: FISSATI_DAL, end: inizio })
            : Promise.resolve([]),
    ])
    const presenze = sommaPerSettimana([
        ...presentati.filter(p => p.at).map(p => ({ at: p.at as Date, n: 1 })),
        ...aggiustamenti.map(a => ({ at: a.at, n: a.n || 0 })),
    ])
    return {
        presenze: migliorSettimana(presenze),
        fissati: migliorSettimana(distintiPerSettimana(fissati.map(f => ({ at: f.createdAt, leadId: f.leadId })))),
    }
}

const miglioriInCache = unstable_cache(calcolaMiglioriPassate, ['diretta-migliori-v1'], { revalidate: 3600 })

/** Dati personali del GDO: fissati di oggi e della settimana, presenze, euro, saldo. */
export async function leggiMia(userId: string, companyId: string, obiettivi: GamificationTargets): Promise<DirettaMia> {
    const now = new Date()
    const giorno = dayBoundsRome(now)
    const settimana = weekBoundsRome(now)
    const daFissati = settimana.start > FISSATI_DAL ? settimana.start : FISSATI_DAL

    const [righeSettimana, presenze, conferme, saldo, passate, serie, regole] = await Promise.all([
        leggiFissati({ companyId, userIds: [userId], start: settimana.start, end: settimana.end }),
        countPresences(userId, settimana.start, settimana.end, companyId),
        db.select({ at: leads.confirmationsTimestamp, appuntamento: leads.appointmentDate, presentato: leads.presentedAt, esito: leads.salespersonOutcome })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                eq(leads.assignedToId, userId),
                eq(leads.confirmationsOutcome, 'confermato'),
                gte(leads.confirmationsTimestamp, new Date(Math.min(settimana.start.getTime(), giorno.start.getTime() - 7 * 86_400_000))),
            )),
        db.select({ scintille: users.scintille, piume: users.piume }).from(users).where(eq(users.id, userId)).limit(1),
        miglioriInCache(userId, companyId, settimana.start.toISOString()),
        leggiSerie(db, userId, now),
        readEconomyRules(),
    ])

    const fissatiSettimana = contaFissati(righeSettimana, daFissati, settimana.end).totale
    const presenzeSettimana = presenze.total
    const settimanaCorrente = toRomeDateStr(settimana.start)
    const migliorePresenze = presenzeSettimana > passate.presenze.valore
        ? { valore: presenzeSettimana, settimana: settimanaCorrente }
        : passate.presenze
    const miglioreFissati = fissatiSettimana > passate.fissati.valore
        ? { valore: fissatiSettimana, settimana: settimanaCorrente }
        : passate.fissati

    return {
        fissatiOggi: contaFissati(righeSettimana, giorno.start, giorno.end).totale,
        fissatiSettimana,
        presenzeSettimana,
        confermeSettimana: conferme.filter(c => c.at && c.at >= settimana.start && c.at < settimana.end).length,
        confermeInAttesa: conferme.filter(c => !c.presentato && !c.esito && c.appuntamento && c.appuntamento >= giorno.start).length,
        euroSettimana: euroFromPresences(presenzeSettimana, obiettivi),
        migliorePresenze,
        miglioreFissati,
        scintille: saldo[0]?.scintille ?? 0,
        piume: saldo[0]?.piume ?? 0,
        serie: {
            giorni: serie.stato.giorni,
            oggiFatto: serie.stato.oggiFatto,
            oggiLavorativo: serie.stato.oggiLavorativo,
            soglia: obiettivi.personale[0],
            prossima: prossimaTappa(serie.stato.giorni, regole.serie),
            scudiInTasca: serie.stato.scudiInTasca,
        },
    }
}
