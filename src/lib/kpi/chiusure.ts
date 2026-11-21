// Chiusure e upsell (titolare 21/11/2026). Funzioni pure, nessun import dal DB.
//
// REGOLA: una scheda "upsell" (`leads.closeIsUpsell = true`, migr. 0064) è un
// esito 'Chiuso' che porta EURO nel fatturato del mese del venditore ma NON conta
// come chiusura: non entra nel numero di chiusure, nel closing rate, nelle
// classifiche a numero, nei bonus/premi/piume a numero di contratti, nel ticket
// medio come denominatore. Negli euro (somma di closeAmountEur) resta.
//
// Ogni punto che CONTA le chiusure deve passare da `contaComeChiusura` (qui) o da
// `chiusuraContataSql` (./chiusureSql per le query Drizzle). Ogni punto che SOMMA
// gli euro continua a usare `isChiuso` / l'esito 'Chiuso' come prima.

export interface RigaUpsell {
    /** `leads.closeIsUpsell`. Obbligatorio nel tipo: chi conta deve leggerlo dal DB. */
    closeIsUpsell: boolean | null
}

/** true se la scheda è un upsell di un già cliente. */
export function isUpsell(r: { closeIsUpsell?: boolean | null }): boolean {
    return r.closeIsUpsell === true
}

/** Esito venditore 'Chiuso' (qualunque grafia di maiuscole). Base dei SOLDI. */
export function isChiuso(outcome: string | null | undefined): boolean {
    return (outcome ?? '').trim().toLowerCase() === 'chiuso'
}

/** La riga conta nel NUMERO di chiusure: 'Chiuso' e non upsell. */
export function contaComeChiusura(r: { salespersonOutcome: string | null } & RigaUpsell): boolean {
    return isChiuso(r.salespersonOutcome) && !isUpsell(r)
}

/** Stessa regola per righe di `salesAttempts` (campo `outcome`) unite al lead. */
export function tentativoContaComeChiusura(a: { outcome: string | null } & RigaUpsell): boolean {
    return isChiuso(a.outcome) && !isUpsell(a)
}

/** Euro della riga nel fatturato: closeAmountEur se 'Chiuso' (upsell compreso), altrimenti 0. */
export function euroFatturato(r: { salespersonOutcome: string | null; closeAmountEur: number | null }): number {
    return isChiuso(r.salespersonOutcome) ? (r.closeAmountEur ?? 0) : 0
}

export interface RigaFirma extends RigaUpsell {
    salespersonOutcome: string | null
    /** closeAmountEur */
    amount: number | null
}

export interface RiepilogoFirme {
    /** Chiusure vere (upsell esclusi). */
    chiusi: number
    /** Schede upsell del periodo (non sono chiusure). */
    upsell: number
    nonChiusi: number
    sparito: number
    perso: number
    /** Trattative esitate: chiusi + non chiusi + spariti + persi (upsell esclusi). */
    totalEsitati: number
    /** Somma degli euro dei 'Chiuso', upsell COMPRESI. */
    fatturato: number
}

/**
 * Riepilogo delle firme del periodo di un venditore (KPI venditori / Team
 * Classifica): le righe sono già filtrate su "esito registrato nel periodo".
 */
export function riepilogoFirme(rows: readonly RigaFirma[]): RiepilogoFirme {
    let chiusi = 0, upsell = 0, nonChiusi = 0, sparito = 0, perso = 0, fatturato = 0
    for (const r of rows) {
        if (isChiuso(r.salespersonOutcome)) {
            fatturato += r.amount || 0
            if (isUpsell(r)) upsell++
            else chiusi++
        } else if (r.salespersonOutcome === 'Non chiuso') nonChiusi++
        else if (r.salespersonOutcome === 'Sparito') sparito++
        else if (r.salespersonOutcome === 'Perso') perso++
    }
    return { chiusi, upsell, nonChiusi, sparito, perso, totalEsitati: chiusi + nonChiusi + sparito + perso, fatturato }
}
