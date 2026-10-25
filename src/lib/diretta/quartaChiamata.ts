// "4ª Recupero" (la quarta chiamata) del GDO: quando la sezione si vede e da
// quando pesca i lead. Niente database qui: la pipeline legge i due numeri,
// questo decide (PO 25/10/2026, go-live 26/10).
//
// La sezione rimette in board i lead auto-scartati al terzo tentativo vuoto
// ("irreperibile (3 tentativi vuoti)") per un ultimo tentativo. Appare solo a
// chi fissa poco: fissaggio sui lead chiamati sotto SOGLIA, misurato come in
// "I miei risultati" (appuntamenti fissati / lead chiamati, intero arrotondato),
// sugli ultimi GIORNI lavorativi (lun-sab, oggi compreso). Con meno di
// MIN_LEAD_CHIAMATI lead chiamati il numero non dice niente e la sezione non c'è.

import { dayBoundsRome, toRomeDateStr } from '@/lib/dateUtils'

/** Sotto questa percentuale di fissaggio la quarta chiamata appare. Si cambia solo qui. */
export const SOGLIA_FISSAGGIO_QUARTA = 12

/** Lead chiamati minimi nella finestra perché la percentuale valga qualcosa. */
export const MIN_LEAD_CHIAMATI_QUARTA = 30

/** Giorni lavorativi (lunedì-sabato, oggi compreso) su cui si misura il fissaggio. */
export const GIORNI_LAVORATIVI_QUARTA = 7

/**
 * Ripartenza del 26/10/2026 (mezzanotte di Roma, primo lunedì di ora solare):
 * entrano solo i lead scartati da qui in poi. Quelli di prima sono stati
 * tolti a tutti con scripts/diretta/quarta-chiamata-svuota.ts.
 */
export const RIPARTENZA_QUARTA = new Date('2026-10-25T23:00:00Z')

/** Giorni di anzianità massima di uno scarto per tornare in quarta chiamata (regola di sempre). */
export const GIORNI_RECUPERO_QUARTA = 30

/** Giorno della settimana (0 = domenica) di una data "YYYY-MM-DD" di Roma. */
function giornoSettimana(ymd: string): number {
    return new Date(`${ymd}T12:00:00Z`).getUTCDay()
}

/**
 * La finestra di misura: dall'inizio del settimo giorno lavorativo indietro
 * (oggi compreso, domeniche saltate) alla fine di oggi, in ora di Roma.
 */
export function finestraFissaggioQuarta(now: Date): { start: Date; end: Date } {
    const end = dayBoundsRome(now).end
    let contati = 0
    let giorno = toRomeDateStr(now)
    let start = dayBoundsRome(now).start
    // Si cammina a mezzogiorno di Roma di ogni giorno: niente salti di ora legale.
    let cursore = new Date(`${giorno}T12:00:00Z`)
    for (;;) {
        if (giornoSettimana(giorno) !== 0) {
            contati++
            start = dayBoundsRome(cursore).start
            if (contati === GIORNI_LAVORATIVI_QUARTA) break
        }
        cursore = new Date(cursore.getTime() - 86_400_000)
        giorno = toRomeDateStr(cursore)
    }
    return { start, end }
}

/** Fissaggio come in "I miei risultati": percentuale intera, null senza lead chiamati. */
export function fissaggioQuarta(leadChiamati: number, appuntamenti: number): number | null {
    return leadChiamati > 0 ? Math.round((appuntamenti / leadChiamati) * 100) : null
}

/** La sezione si vede solo con abbastanza lead chiamati e un fissaggio sotto la soglia. */
export function mostraQuartaChiamata(n: { leadChiamati: number; appuntamenti: number }): boolean {
    if (n.leadChiamati < MIN_LEAD_CHIAMATI_QUARTA) return false
    const f = fissaggioQuarta(n.leadChiamati, n.appuntamenti)
    return f !== null && f < SOGLIA_FISSAGGIO_QUARTA
}

/** Da quando uno scarto può tornare in quarta chiamata: 30 giorni fa, mai prima della ripartenza. */
export function scartiDalQuarta(now: Date): Date {
    const trenta = new Date(now.getTime() - GIORNI_RECUPERO_QUARTA * 86_400_000)
    return trenta > RIPARTENZA_QUARTA ? trenta : RIPARTENZA_QUARTA
}
