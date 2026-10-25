// Calcoli della board Conferme condivisi dalla grafica classica e dalla Diretta
// (PO 25/10/2026): le due viste devono smistare i lead nello stesso identico
// modo, quindi la logica sta qui una volta sola. Funzioni pure, testate in
// boardView.test.ts. Riprendono alla lettera le espressioni che vivevano dentro
// ConfermeBoard.

import { personName } from '@/lib/diretta/config'

type DateLike = Date | string | number

/** Il minimo che serve dei campi del lead per smistarlo nella board. */
export interface BoardLead {
    id: string
    appointmentDate?: DateLike | null
    confNeedsReschedule?: boolean | null
    confCall1At?: DateLike | null
    confCall2At?: DateLike | null
    confCall3At?: DateLike | null
    confSnoozeAt?: DateLike | null
    confirmationsOutcome?: string | null
    recallDate?: DateLike | null
}

export interface BoardItem<L extends BoardLead = BoardLead> { lead: L }

export type NrFilterMode = 'tutti' | '0' | '1' | '2' | '3'

/** Ora (0-23) di Roma di un istante. */
export function romeHour(at: DateLike): number {
    return parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(new Date(at)), 10)
}

/** Lead con appuntamento nell'ora "HH:00" di Roma; i parcheggiati (richiami) restano fuori. */
export function leadsInHour<T extends BoardItem>(items: readonly T[], hourLabel: string): T[] {
    const hNum = parseInt(hourLabel.split(':')[0], 10)
    return items.filter(l => {
        if (!l.lead.appointmentDate) return false
        return romeHour(l.lead.appointmentDate) === hNum && !l.lead.confNeedsReschedule
    })
}

/** Quanti lead ci sono per numero di chiamate a vuoto (i bottoni filtro della fascia). */
export function nrCounts(items: readonly BoardItem[]): Record<NrFilterMode, number> {
    return {
        'tutti': items.length,
        '0': items.filter(l => !l.lead.confCall1At).length,
        '1': items.filter(l => l.lead.confCall1At && !l.lead.confCall2At && !l.lead.confCall3At).length,
        '2': items.filter(l => l.lead.confCall2At && !l.lead.confCall3At).length,
        '3': items.filter(l => l.lead.confCall3At).length,
    }
}

/**
 * Applica il filtro NR. "3" non filtra, come è sempre stato: al 3° NR il lead
 * viene scartato in automatico (recordConfermeNoAnswer) e lascia la board,
 * quindi quel gruppo è vuoto e il bottone mostra tutti i lead della fascia.
 */
export function applyNrFilter<T extends BoardItem>(items: readonly T[], filter: NrFilterMode): T[] {
    if (filter === '0') return items.filter(l => !l.lead.confCall1At)
    if (filter === '1') return items.filter(l => l.lead.confCall1At && !l.lead.confCall2At && !l.lead.confCall3At)
    if (filter === '2') return items.filter(l => l.lead.confCall2At && !l.lead.confCall3At)
    return [...items]
}

/** Lead "da risentire" in giornata (snooze) ancora senza esito, dal più vicino. */
export function snoozedOf<T extends BoardItem>(items: readonly T[]): T[] {
    return items
        .filter(l => l.lead.confSnoozeAt && !l.lead.confirmationsOutcome)
        .sort((a, b) => new Date(a.lead.confSnoozeAt as DateLike).getTime() - new Date(b.lead.confSnoozeAt as DateLike).getTime())
}

/** Richiami programmati (parcheggiati) per data del richiamo; quelli senza data in fondo. */
export function sortRichiami<T extends BoardItem>(items: readonly T[]): T[] {
    return [...items].sort((a, b) => {
        if (!a.lead.recallDate) return 1
        if (!b.lead.recallDate) return -1
        return new Date(a.lead.recallDate).getTime() - new Date(b.lead.recallDate).getTime()
    })
}

export type StoricoFilter = 'tutti' | 'confermati' | 'scartati'

export function filterStorico<T extends BoardItem>(items: readonly T[], filter: StoricoFilter): T[] {
    if (filter === 'tutti') return [...items]
    if (filter === 'confermati') return items.filter(i => i.lead.confirmationsOutcome === 'confermato')
    return items.filter(i => i.lead.confirmationsOutcome === 'scartato')
}

export function storicoCounts(items: readonly BoardItem[]): { confermati: number; scartati: number } {
    return {
        confermati: items.filter(i => i.lead.confirmationsOutcome === 'confermato').length,
        scartati: items.filter(i => i.lead.confirmationsOutcome === 'scartato').length,
    }
}

/** Chiamate a vuoto già fatte dalle Conferme sul lead (0-3). */
export function callsMade(lead: Pick<BoardLead, 'confCall1At' | 'confCall2At' | 'confCall3At'>): number {
    let n = 0
    if (lead.confCall1At) n = 1
    if (lead.confCall2At) n = 2
    if (lead.confCall3At) n = 3
    return n
}

/**
 * Nome di chi ha fissato, per la Diretta: il nome vero del GDO (firstName),
 * "Fissatore" per il bot, come lo chiamano già le note e il report che le
 * Conferme leggono. Senza firstName resta il nome storico.
 */
export function gdoName(gdo: { firstName?: string | null; displayName?: string | null; name?: string | null; isBot?: boolean | null } | null | undefined): string {
    if (!gdo) return 'Senza GDO'
    if (gdo.isBot) return 'Fissatore'
    return personName(gdo) || 'Senza GDO'
}

/**
 * Nome di un collega Conferme nella Diretta: gli account hanno displayName
 * "Alberto (Conferme)", la presence porta già "Alberto". Si toglie il suffisso
 * del reparto, che sulla board delle Conferme non dice niente.
 */
export function collegaName(name: string | null | undefined): string {
    return (name || '').replace(/\s*\(conferme\)\s*$/i, '').trim()
}
