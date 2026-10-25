// Numeri della colonna arancione delle Conferme nella Diretta (PO 25/10/2026).
// Funzioni pure: le righe arrivano già filtrate dal server (lead confermati da
// un account CONFERME), qui si contano per finestra di Roma. Testabile senza
// database.
//
// Attribuzione canonica, la stessa del TL Conferme (getConfermeTlOverview,
// perOperator): ogni metrica conta nel giorno della SUA azione e va a chi ha
// confermato il lead (`confirmationsUserId`).
//   Conferme  → confirmationsTimestamp, esito 'confermato'
//   Presenze  → presentedAt (latch del giorno dell'appuntamento, PO 2026-07-17)
//   Chiusure  → salespersonOutcomeAt con esito 'Chiuso'

import { dayBoundsRome, monthBoundsRome, toRomeDateStr, weekBoundsRome } from '@/lib/dateUtils'
import {
    periodoBonusBounds, progressoSquadra,
    type BonusPeriodo, type BonusUnita, type ConfermeBonusConfig, type ObiettiviConferme, type ProgressoSquadra,
} from './bonus'

/** Riga minima di un lead confermato dalle Conferme. Date in millisecondi (serializzabili in cache). */
export interface ConfermeLeadRow {
    id: string
    /** confirmationsUserId: chi l'ha confermato. */
    userId: string | null
    confirmedAt: number | null
    presentedAt: number | null
    /** salespersonOutcomeAt quando l'esito è 'Chiuso', altrimenti null. */
    chiusoAt: number | null
}

export interface Finestra { start: number; end: number }

export interface DirettaBounds {
    giorno: Finestra
    settimana: Finestra
    mese: Finestra
    /** Finestra del bonus di squadra (settimana o mese, da configurazione). */
    squadra: Finestra
    /** Da quando servono le righe: copre settimana, mese e periodo di squadra. */
    since: number
}

const toFinestra = (b: { start: Date; end: Date }): Finestra => ({ start: b.start.getTime(), end: b.end.getTime() })

export function direttaBounds(now: Date, periodo: BonusPeriodo): DirettaBounds {
    const giorno = toFinestra(dayBoundsRome(now))
    const settimana = toFinestra(weekBoundsRome(now))
    const mese = toFinestra(monthBoundsRome(toRomeDateStr(now).slice(0, 7)))
    const squadra = toFinestra(periodoBonusBounds(now, periodo))
    return { giorno, settimana, mese, squadra, since: Math.min(settimana.start, mese.start, squadra.start) }
}

const dentro = (ms: number | null, f: Finestra): boolean => ms !== null && ms >= f.start && ms < f.end

export interface NumeriPersonali {
    confermeOggi: number
    /** Lead confermati oggi: servono al client per non contare due volte un'aggiunta ottimistica. */
    confermeOggiIds: string[]
    presenzeOggi: number
    chiusureOggi: number
    presenzeSettimana: number
    chiusureMese: number
}

export interface NumeriSquadra extends ProgressoSquadra {
    unita: BonusUnita
    periodo: BonusPeriodo
    euroPerUnita: number
    /** Inizio del periodo del bonus (ms), per l'etichetta "a ottobre" / "questa settimana". */
    periodoInizio: number
}

export interface ConfermeDirettaNumeri {
    personali: NumeriPersonali
    squadra: NumeriSquadra
    /** Obiettivi individuali dell'utente, null se nessuno è impostato. */
    obiettivi: ObiettiviConferme | null
}

export function aggregateConfermeDiretta(
    rows: readonly ConfermeLeadRow[],
    opts: { userId: string; bounds: DirettaBounds; cfg: ConfermeBonusConfig },
): ConfermeDirettaNumeri {
    const { userId, bounds, cfg } = opts
    const personali: NumeriPersonali = {
        confermeOggi: 0, confermeOggiIds: [], presenzeOggi: 0, chiusureOggi: 0, presenzeSettimana: 0, chiusureMese: 0,
    }
    let squadra = 0

    for (const r of rows) {
        const dataSquadra = cfg.unita === 'presenze' ? r.presentedAt : r.chiusoAt
        if (dentro(dataSquadra, bounds.squadra)) squadra++

        if (r.userId !== userId) continue
        if (dentro(r.confirmedAt, bounds.giorno)) {
            personali.confermeOggi++
            personali.confermeOggiIds.push(r.id)
        }
        if (dentro(r.presentedAt, bounds.giorno)) personali.presenzeOggi++
        if (dentro(r.chiusoAt, bounds.giorno)) personali.chiusureOggi++
        if (dentro(r.presentedAt, bounds.settimana)) personali.presenzeSettimana++
        if (dentro(r.chiusoAt, bounds.mese)) personali.chiusureMese++
    }

    return {
        personali,
        squadra: {
            ...progressoSquadra(squadra, cfg),
            unita: cfg.unita,
            periodo: cfg.periodo,
            euroPerUnita: cfg.euroPerUnita,
            periodoInizio: bounds.squadra.start,
        },
        obiettivi: cfg.obiettivi[userId] ?? null,
    }
}

/**
 * Squadra contata in tutte e quattro le combinazioni di unità e periodo: serve
 * alla pagina admin per far vedere dove sarebbe oggi la squadra con ciascuna
 * regola, finché unità e periodo non sono confermati.
 */
export function conteggiSquadra(
    rows: readonly ConfermeLeadRow[],
    bounds: Pick<DirettaBounds, 'settimana' | 'mese'>,
): Record<BonusUnita, Record<BonusPeriodo, number>> {
    const out = { presenze: { settimana: 0, mese: 0 }, chiusure: { settimana: 0, mese: 0 } }
    for (const r of rows) {
        if (dentro(r.presentedAt, bounds.settimana)) out.presenze.settimana++
        if (dentro(r.presentedAt, bounds.mese)) out.presenze.mese++
        if (dentro(r.chiusoAt, bounds.settimana)) out.chiusure.settimana++
        if (dentro(r.chiusoAt, bounds.mese)) out.chiusure.mese++
    }
    return out
}

/**
 * Evento del browser che il drawer manda quando una conferma va a buon fine:
 * la colonna lo conta subito, senza aspettare la cache dei numeri.
 */
export const CONFERMATO_EVENT = 'conferme:confermato'

/**
 * Conferme di oggi con le aggiunte ottimistiche del client (lead appena
 * confermati dal drawer, non ancora nei dati del server per via della cache):
 * l'unione degli id evita di contarne uno due volte quando il server lo vede.
 */
export function confermeOggiConOttimistiche(serverIds: readonly string[], ottimistiche: Iterable<string>): number {
    const tutti = new Set(serverIds)
    for (const id of ottimistiche) tutti.add(id)
    return tutti.size
}
