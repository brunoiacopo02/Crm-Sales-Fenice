// Lettura del foglio Google delle SIM dei GDO (PO 14/11/2026).
//
// Il foglio lo tiene a mano il titolare: le colonne si cercano per nome nella
// riga 1, mai per posizione. Le note scritte a destra della tabella (es. "SIM
// RIMASTE") non hanno intestazione e restano fuori.

export type CellaFoglio = string | number | boolean | null | undefined

export interface ColonneFoglio {
    gdo: number
    numero: number
    tasso: number
    nome: number | null
    stato: number | null
    dataCambio: number | null
}

export interface RigaFoglio {
    /** Numero di riga nel foglio, da 1 (la riga 1 è l'intestazione). */
    riga: number
    /** Interno del centralino (colonna GDO), es. "1020". */
    interno: string
    nome: string
    /** Come è scritto: può essere vuoto, "/" o "da ins". */
    numero: string
    stato: string
    dataCambio: string
}

export type LetturaFoglio =
    | { ok: true; colonne: ColonneFoglio; righe: RigaFoglio[] }
    | { ok: false; errore: string }

/** Nomi delle colonne, già normalizzati. */
export const INTESTAZIONI = {
    gdo: 'GDO',
    nome: 'NOME',
    numero: 'NUMERO',
    stato: 'STATO',
    dataCambio: 'DATA ULTIMO CAMBIO',
    tasso: 'TASSO DI RSP',
} as const

/** Maiuscolo, senza accenti, senza punti, spazi singoli: "Tasso di rsp." → "TASSO DI RSP". */
export function normalizzaIntestazione(v: CellaFoglio): string {
    return testo(v)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/\./g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function testo(v: CellaFoglio): string {
    if (v === null || v === undefined) return ''
    return String(v).trim()
}

/** Indice 0 → "A", 26 → "AA". */
export function lettereColonna(indice: number): string {
    let n = indice + 1
    let s = ''
    while (n > 0) {
        const r = (n - 1) % 26
        s = String.fromCharCode(65 + r) + s
        n = Math.floor((n - 1) / 26)
    }
    return s
}

export function leggiFoglio(valori: CellaFoglio[][]): LetturaFoglio {
    const intestazione = (valori[0] ?? []).map(normalizzaIntestazione)
    const trova = (nome: string): number | null | 'doppia' => {
        const posti = intestazione.flatMap((h, i) => (h === nome ? [i] : []))
        if (posti.length > 1) return 'doppia'
        return posti[0] ?? null
    }

    const trovate: Partial<Record<keyof typeof INTESTAZIONI, number | null>> = {}
    for (const [chiave, nome] of Object.entries(INTESTAZIONI) as [keyof typeof INTESTAZIONI, string][]) {
        const i = trova(nome)
        if (i === 'doppia') return { ok: false, errore: `La colonna "${nome}" compare due volte nell'intestazione: non so quale usare.` }
        trovate[chiave] = i
    }
    const mancanti = (['gdo', 'numero', 'tasso'] as const).filter(k => trovate[k] === null || trovate[k] === undefined)
    if (mancanti.length > 0) {
        return { ok: false, errore: `Nell'intestazione mancano le colonne ${mancanti.map(k => `"${INTESTAZIONI[k]}"`).join(', ')}.` }
    }

    const colonne: ColonneFoglio = {
        gdo: trovate.gdo as number,
        numero: trovate.numero as number,
        tasso: trovate.tasso as number,
        nome: trovate.nome ?? null,
        stato: trovate.stato ?? null,
        dataCambio: trovate.dataCambio ?? null,
    }
    const cella = (r: CellaFoglio[], i: number | null) => (i === null ? '' : testo(r[i]))

    const righe: RigaFoglio[] = []
    valori.slice(1).forEach((r, i) => {
        const interno = cella(r, colonne.gdo)
        if (!interno) return
        righe.push({
            riga: i + 2,
            interno,
            nome: cella(r, colonne.nome),
            numero: cella(r, colonne.numero),
            stato: cella(r, colonne.stato),
            dataCambio: cella(r, colonne.dataCambio),
        })
    })
    return { ok: true, colonne, righe }
}
