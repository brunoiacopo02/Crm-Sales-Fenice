// Numeri e date della Diretta scritti a mano, identici sul server e nel
// browser (collaudo del 25/10/2026).
//
// Intl.NumberFormat('it-IT') dipende dalla versione di ICU: Node (ICU 78)
// scrive 3030 senza separatore, Chrome scrive 3.030. Il testo del server e
// quello del browser non coincidono e React segnala l'errore di idratazione
// #418 su negozio e profilo. Qui il punto delle migliaia e la virgola dei
// decimali si mettono da soli; delle date si chiedono a Intl solo le cifre
// (formatToParts), che sono uguali ovunque, e il testo si compone qui.

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const MESI_LUNGHI = [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
]

/**
 * Numero all'italiana: 3.030, 1.234.567, 12,5 con `decimali` = 1. Il meno è
 * il trattino. Un valore non finito diventa "0", mai "NaN" a schermo.
 */
export function numeroIt(n: number, decimali = 0): string {
    if (!Number.isFinite(n)) return '0'
    const segno = n < 0 ? '-' : ''
    const fisso = Math.abs(n).toFixed(Math.max(0, Math.min(6, decimali)))
    const [intero, parteDecimale] = fisso.split('.')
    const conPunti = intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    // -0 e gli arrotondamenti a zero non portano il segno.
    const tuttoZero = /^0(\.0+)?$/.test(fisso)
    return `${tuttoZero ? '' : segno}${conPunti}${parteDecimale ? `,${parteDecimale}` : ''}`
}

/**
 * Come numeroIt, ma i decimali solo se servono e al massimo `maxDecimali`:
 * 12,5 e 12 con maxDecimali 1 (l'equivalente di maximumFractionDigits).
 */
export function numeroItFino(n: number, maxDecimali: number): string {
    if (!Number.isFinite(n)) return '0'
    const d = Math.max(0, Math.min(6, maxDecimali))
    const arrotondato = Number(n.toFixed(d))
    const decimali = (String(Math.abs(arrotondato)).split('.')[1] ?? '').length
    return numeroIt(arrotondato, Math.min(d, decimali))
}

/** Importo del registro col segno: "+10", "-2", "0". */
export function numeroConSegno(n: number): string {
    return n > 0 ? `+${numeroIt(n)}` : numeroIt(n)
}

/** Euro col simbolo dopo il numero: "12 €", "1.234 €", "12,50 €" (i centesimi solo se ci sono). */
export function euroIt(n: number): string {
    const intero = Math.abs(n - Math.round(n)) < 0.005
    return `${numeroIt(n, intero ? 0 : 2)} €`
}

export interface PartiRoma {
    anno: number
    mese: number      // 1-12
    giorno: number
    ora: number
    minuto: number
}

const PARTI = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
})

/** Le cifre di un istante nel calendario di Roma (ora legale e solare comprese). */
export function partiRoma(d: Date): PartiRoma {
    const p: Record<string, number> = {}
    for (const x of PARTI.formatToParts(d)) {
        if (x.type !== 'literal') p[x.type] = Number(x.value)
    }
    return { anno: p.year, mese: p.month, giorno: p.day, ora: p.hour % 24, minuto: p.minute }
}

const due = (n: number) => String(n).padStart(2, '0')

/** "17:10" in ora di Roma. */
export function oraRoma(d: Date): string {
    const p = partiRoma(d)
    return `${due(p.ora)}:${due(p.minuto)}`
}

/** "24/10" in ora di Roma. */
export function giornoMeseRoma(d: Date): string {
    const p = partiRoma(d)
    return `${due(p.giorno)}/${due(p.mese)}`
}

/** "24/10, 17:10" in ora di Roma: il formato corto delle card. */
export function dataOraRoma(d: Date): string {
    return `${giornoMeseRoma(d)}, ${oraRoma(d)}`
}

/** "25 ott" in ora di Roma. */
export function dataBreveRoma(d: Date): string {
    const p = partiRoma(d)
    return `${p.giorno} ${MESI_BREVI[p.mese - 1]}`
}

/** "25 ott, 17:10" in ora di Roma. */
export function dataOraBreveRoma(d: Date): string {
    return `${dataBreveRoma(d)}, ${oraRoma(d)}`
}

/** "12 ottobre" da un giorno 'YYYY-MM-DD' (senza fuso: è già un giorno del calendario). */
export function giornoMeseLungo(giornoIso: string): string {
    const [, m, g] = giornoIso.split('-').map(Number)
    return `${g} ${MESI_LUNGHI[(m || 1) - 1]}`
}

/** Il nome del mese, 1-12. */
export function meseLungo(mese: number): string {
    return MESI_LUNGHI[Math.min(12, Math.max(1, mese)) - 1]
}
