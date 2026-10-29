// Obiettivi di fatturato e guadagno dei venditori (PO 29/10/2026). Funzioni pure.
//
// - Gli obiettivi sono INDIVIDUALI e per MESE (tabella salesMonthlyTargets).
//   Un mese senza valore prende quello dell'ultimo mese precedente che ce l'ha.
// - L'obiettivo si misura sul FIRMATO del mese nel CRM: somma di closeAmountEur
//   dei lead "Chiuso" con salespersonOutcomeAt nel mese (la stessa base della
//   barra in KPI venditori / Team Classifica).
// - Il guadagno si calcola sull'INCASSATO del mese secondo il gestionale
//   (mese commissione dell'amministrazione), senza IVA al 22%:
//   10% di base, 11% con il 1° obiettivo, 12% con il 2°, su tutto l'incasso.

export const IVA = 1.22
export const PCT_BASE = 10
export const PCT_PRIMO = 11
export const PCT_SECONDO = 12

export type ObiettiviRow = { salesUserId: string; yearMonth: string; target1Eur: number | null; target2Eur: number | null }
export type Obiettivi = { target1Eur: number | null; target2Eur: number | null; daMese: string | null }

/** Obiettivi validi nel mese `ym` per un venditore: il mese stesso o l'ultimo prima. */
export function obiettiviDelMese(rows: ObiettiviRow[], salesUserId: string, ym: string): Obiettivi {
    let best: ObiettiviRow | null = null
    for (const r of rows) {
        if (r.salesUserId !== salesUserId || r.yearMonth > ym) continue
        if (!best || r.yearMonth > best.yearMonth) best = r
    }
    return best
        ? { target1Eur: best.target1Eur, target2Eur: best.target2Eur, daMese: best.yearMonth }
        : { target1Eur: null, target2Eur: null, daMese: null }
}

/** Percentuale raggiunta col firmato del mese. */
export function percentualeGuadagno(firmatoEur: number, o: Pick<Obiettivi, 'target1Eur' | 'target2Eur'>): number {
    if (o.target2Eur != null && o.target2Eur > 0 && firmatoEur >= o.target2Eur) return PCT_SECONDO
    if (o.target1Eur != null && o.target1Eur > 0 && firmatoEur >= o.target1Eur) return PCT_PRIMO
    return PCT_BASE
}

/** Guadagno in centesimi: incassato / 1,22 × pct%. */
export function guadagnoCents(incassatoCents: number, pct: number): number {
    return Math.round((incassatoCents / IVA) * pct / 100)
}

export type Guadagno = {
    pct: number
    baseCents: number          // al 10%
    attualeCents: number       // alla percentuale raggiunta
    bonusCents: number         // attuale - base
    prossimo: { numero: 1 | 2; obiettivoEur: number; mancaEur: number; pct: number; guadagnoCents: number } | null
    /** Incassato senza IVA (÷ 1,22), in centesimi. */
    senzaIvaCents: number
    /** Obiettivo raggiunto sul firmato: 0 nessuno, 1 o 2. */
    raggiunto: 0 | 1 | 2
    /** Commissione se raggiunge il 1° / 2° obiettivo, con il firmato che manca (0 se gia' preso). Null se l'obiettivo non c'e'. */
    se1: { cents: number; mancaEur: number } | null
    se2: { cents: number; mancaEur: number } | null
}

export function calcolaGuadagno(input: { incassatoCents: number; firmatoEur: number; obiettivi: Pick<Obiettivi, 'target1Eur' | 'target2Eur'> }): Guadagno {
    const { incassatoCents, firmatoEur, obiettivi: o } = input
    const pct = percentualeGuadagno(firmatoEur, o)
    const baseCents = guadagnoCents(incassatoCents, PCT_BASE)
    const attualeCents = guadagnoCents(incassatoCents, pct)
    let prossimo: Guadagno['prossimo'] = null
    if (pct < PCT_PRIMO && o.target1Eur != null && o.target1Eur > 0) {
        prossimo = { numero: 1, obiettivoEur: o.target1Eur, mancaEur: o.target1Eur - firmatoEur, pct: PCT_PRIMO, guadagnoCents: guadagnoCents(incassatoCents, PCT_PRIMO) }
    } else if (pct < PCT_SECONDO && o.target2Eur != null && o.target2Eur > 0) {
        prossimo = { numero: 2, obiettivoEur: o.target2Eur, mancaEur: o.target2Eur - firmatoEur, pct: PCT_SECONDO, guadagnoCents: guadagnoCents(incassatoCents, PCT_SECONDO) }
    }
    const se = (t: number | null, p: number) => (t != null && t > 0 ? { cents: guadagnoCents(incassatoCents, p), mancaEur: Math.max(0, t - firmatoEur) } : null)
    return {
        pct, baseCents, attualeCents, bonusCents: attualeCents - baseCents, prossimo,
        senzaIvaCents: Math.round(incassatoCents / IVA),
        raggiunto: pct === PCT_SECONDO ? 2 : pct === PCT_PRIMO ? 1 : 0,
        se1: se(o.target1Eur, PCT_PRIMO),
        se2: se(o.target2Eur, PCT_SECONDO),
    }
}

/** Validazione dell'input della schermata obiettivi. */
export function validaObiettivi(t1: number | null, t2: number | null): string | null {
    for (const v of [t1, t2]) {
        if (v != null && (!Number.isFinite(v) || v < 0)) return 'Gli obiettivi devono essere numeri positivi.'
    }
    if (t1 == null && t2 != null) return 'Il secondo obiettivo richiede il primo.'
    if (t1 != null && t2 != null && t2 <= t1) return 'Il secondo obiettivo deve essere più alto del primo.'
    return null
}
