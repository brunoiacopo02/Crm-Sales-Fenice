/**
 * Aritmetica degli slot del calendario venditori, sempre in Europe/Rome.
 *
 * Uno slot e' un'ora piena fra le 9 e le 21, dal lunedi al sabato: 78 a
 * settimana. Tutto cio' che sta fuori da questa griglia (domenica, notte)
 * semplicemente NON ha slot, e le regole a valle lo trattano come "non
 * misurabile": niente blocchi, niente multe, niente copertura.
 *
 * Nessun altro file del progetto fa aritmetica sulle ore del calendario:
 * il fuso e l'ora legale si sbagliano una volta sola, qui dentro.
 */

import { toRomeDateStr, romeOffset, weekBoundsRome } from '../dateUtils'

export const SLOT_FIRST_HOUR = 9
export const SLOT_LAST_HOUR = 21
export const SLOT_HOURS: number[] = Array.from(
    { length: SLOT_LAST_HOUR - SLOT_FIRST_HOUR + 1 },
    (_, i) => SLOT_FIRST_HOUR + i,
)
/** Lunedi..sabato. La domenica non e' compilabile (zero appuntamenti storici). */
export const SLOT_DAYS = 6
export const SLOTS_PER_WEEK = SLOT_HOURS.length * SLOT_DAYS
export const WEEKLY_DEADLINE_HOUR = 14

const HM = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
})

/** L'ora italiana (0-23) di un istante. */
export function romeHour(at: Date): number {
    return Number(HM.format(at).slice(0, 2))
}

/** Giorno della settimana italiano: 1 = lunedi ... 7 = domenica. */
export function romeDow(at: Date): number {
    const noon = new Date(`${toRomeDateStr(at)}T12:00:00${romeOffset(at)}`)
    const d = noon.getUTCDay() // 0 = domenica
    return d === 0 ? 7 : d
}

/**
 * L'istante corrispondente a una data italiana + ora piena.
 * L'offset si prende a mezzogiorno di quel giorno: i cambi di ora legale
 * avvengono alle 2-3 del mattino, quindi per le ore 9-21 e' sempre corretto.
 */
export function romeInstant(dateStr: string, hour: number): Date {
    const off = romeOffset(new Date(`${dateStr}T12:00:00Z`))
    return new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00${off}`)
}

/** Lo slot che contiene `at`, o null se `at` cade fuori dalla griglia. */
export function slotStartFor(at: Date): Date | null {
    if (romeDow(at) === 7) return null
    const hour = romeHour(at)
    if (hour < SLOT_FIRST_HOUR || hour > SLOT_LAST_HOUR) return null
    return romeInstant(toRomeDateStr(at), hour)
}

/** Chiave stabile per Map/Set, leggibile nei log: '2026-09-14@16'. */
export function slotKey(at: Date): string {
    return `${toRomeDateStr(at)}@${romeHour(at)}`
}

/** 'HH:00' italiane. */
export function slotLabel(at: Date): string {
    return `${String(romeHour(at)).padStart(2, '0')}:00`
}

/** Lunedi 00:00 italiane della settimana che contiene `at`. */
export function weekStartFor(at: Date): Date {
    // weekBoundsRome riusa l'offset di `at` anche per costruire il lunedi: nelle
    // due domeniche del cambio d'ora l'istante esce sfalsato di un'ora. La DATA
    // del lunedi che produce e' pero' sempre giusta, quindi ricostruiamo
    // l'istante da qui. Il lunedi non e' mai giorno di transizione in UE, percio'
    // il campionamento dell'offset a mezzogiorno di romeInstant e' sempre valido.
    return romeInstant(toRomeDateStr(weekBoundsRome(at).start), 0)
}

/** 'YYYY-MM-DD' del lunedi: e' la colonna `weekStart` sul DB. */
export function weekStartKey(at: Date): string {
    return toRomeDateStr(weekStartFor(at))
}

/** I 78 slot della settimana, in ordine: lunedi 9 -> sabato 21. */
export function weekSlots(weekStart: Date): Date[] {
    const out: Date[] = []
    // Mezzogiorno UTC: Roma e' +1/+2, quindi sommare 24h non attraversa mai
    // la mezzanotte italiana nemmeno nella settimana del cambio d'ora.
    const baseNoon = new Date(`${toRomeDateStr(weekStart)}T12:00:00Z`)
    for (let d = 0; d < SLOT_DAYS; d++) {
        const dateStr = toRomeDateStr(new Date(baseNoon.getTime() + d * 86_400_000))
        for (const h of SLOT_HOURS) out.push(romeInstant(dateStr, h))
    }
    return out
}

/**
 * Il lunedi di `delta` settimane dopo (o prima, con delta negativo).
 *
 * Sommare `delta * 7 * 86_400_000` a un istante NON funziona: nelle settimane
 * del cambio d'ora l'aritmetica in millisecondi sbaglia di un'ora e il lunedi
 * successivo cade alle 23:00 della domenica o all'1:00 del lunedi. Ricondotto
 * a lunedi da `weekStartFor`, il risultato e' la settimana sbagliata: partendo
 * dal 19/10/2026 "avanti" tornava di nuovo il 19/10 (freccia morta per tutta
 * quella settimana), e dal 30/03/2026 "indietro" saltava al 16/03 scavalcandone
 * una. Si naviga per DATA, con lo stesso mezzogiorno UTC di `weekSlots`.
 */
export function addWeeks(weekStart: Date, delta: number): Date {
    const noon = new Date(`${toRomeDateStr(weekStart)}T12:00:00Z`)
    const target = new Date(noon.getTime() + delta * 7 * 86_400_000)
    return romeInstant(toRomeDateStr(target), 0)
}

/** Lunedi 14:00 italiane: la scadenza della compilazione. */
export function weeklyDeadline(weekStart: Date): Date {
    return romeInstant(toRomeDateStr(weekStart), WEEKLY_DEADLINE_HOUR)
}
