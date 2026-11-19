/**
 * Chiamata successiva visibile dal giorno dopo (titolare 19/11/2026).
 *
 * Un lead che il GDO chiama oggi e che avanza di colonna (1ª→2ª, 2ª→3ª,
 * 3ª→4ª "Recupero") non deve comparire subito nella colonna successiva: chi
 * lavora le colonne in ordine se lo ritroverebbe davanti dopo pochi minuti e
 * si confonde. Compare dalle 10:00 (Europe/Rome) del giorno dopo l'ultima
 * chiamata.
 *
 * Vale solo per la vista del GDO: admin e manager vedono sempre tutto.
 */

import { dayBoundsRome, romeOffset, toRomeDateStr } from '../dateUtils'

export const ORA_CHIAMATA_GIORNO_DOPO = 10

/** Le 10:00 di Roma del giorno dopo `ultimaChiamata`. */
export function chiamataSuccessivaVisibileDa(ultimaChiamata: Date): Date {
    // Mezzanotte del giorno dopo + 12h: un istante sicuramente dentro quel
    // giorno e dopo l'eventuale cambio d'ora (che avviene tra le 2 e le 3),
    // quindi il suo offset è quello delle 10:00.
    const mezzogiorno = new Date(dayBoundsRome(ultimaChiamata).end.getTime() + 12 * 3_600_000)
    const ora = String(ORA_CHIAMATA_GIORNO_DOPO).padStart(2, '0')
    return new Date(`${toRomeDateStr(mezzogiorno)}T${ora}:00:00${romeOffset(mezzogiorno)}`)
}

/**
 * True se la chiamata successiva si può già mostrare al GDO.
 * Senza data dell'ultima chiamata non c'è niente da aspettare: si mostra.
 */
export function chiamataSuccessivaGiaVisibile(ultimaChiamata: Date | string | null | undefined, adesso: Date): boolean {
    if (!ultimaChiamata) return true
    const d = new Date(ultimaChiamata)
    if (Number.isNaN(d.getTime())) return true
    return adesso.getTime() >= chiamataSuccessivaVisibileDa(d).getTime()
}

/**
 * La colonna di un lead già chiamato come la vede chi apre la pipeline:
 * il GDO solo i lead la cui attesa è finita, admin e manager tutti.
 */
export function visibiliNellaColonnaSuccessiva<T extends { lastCallDate: Date | string | null | undefined }>(
    lead: T[],
    opts: { isGdo: boolean; adesso: Date },
): T[] {
    if (!opts.isGdo) return lead
    return lead.filter(l => chiamataSuccessivaGiaVisibile(l.lastCallDate, opts.adesso))
}
