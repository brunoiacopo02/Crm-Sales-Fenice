/**
 * Seconda chiamata visibile dal giorno dopo (titolare 19/11/2026).
 *
 * Un lead che il GDO chiama oggi per la prima volta e che passa in 2ª chiamata
 * non deve comparire subito nella colonna delle seconde: chi fa prima le prime
 * e poi le seconde se lo ritroverebbe davanti dopo pochi minuti e si confonde.
 * Compare dalle 10:00 (Europe/Rome) del giorno dopo la chiamata.
 *
 * Vale solo per la vista del GDO: admin e manager vedono sempre tutto.
 */

import { dayBoundsRome, romeOffset, toRomeDateStr } from '../dateUtils'

export const ORA_SECONDE_GIORNO_DOPO = 10

/** Le 10:00 di Roma del giorno dopo `ultimaChiamata`. */
export function secondaVisibileDa(ultimaChiamata: Date): Date {
    // Mezzanotte del giorno dopo + 12h: un istante sicuramente dentro quel
    // giorno e dopo l'eventuale cambio d'ora (che avviene tra le 2 e le 3),
    // quindi il suo offset è quello delle 10:00.
    const mezzogiorno = new Date(dayBoundsRome(ultimaChiamata).end.getTime() + 12 * 3_600_000)
    const ora = String(ORA_SECONDE_GIORNO_DOPO).padStart(2, '0')
    return new Date(`${toRomeDateStr(mezzogiorno)}T${ora}:00:00${romeOffset(mezzogiorno)}`)
}

/**
 * True se la seconda chiamata si può già mostrare al GDO.
 * Senza data dell'ultima chiamata non c'è niente da aspettare: si mostra.
 */
export function secondaGiaVisibile(ultimaChiamata: Date | string | null | undefined, adesso: Date): boolean {
    if (!ultimaChiamata) return true
    const d = new Date(ultimaChiamata)
    if (Number.isNaN(d.getTime())) return true
    return adesso.getTime() >= secondaVisibileDa(d).getTime()
}
