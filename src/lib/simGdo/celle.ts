// Richieste di scrittura sul foglio SIM: SOLO la cella della colonna
// "TASSO DI RSP." di ogni riga con un interno, mai altre celle. Valore,
// sfondo e formato percentuale in un unico batchUpdate.

import type { Colore } from './tasso'

const rgb = (hex: string) => ({
    red: parseInt(hex.slice(1, 3), 16) / 255,
    green: parseInt(hex.slice(3, 5), 16) / 255,
    blue: parseInt(hex.slice(5, 7), 16) / 255,
})

/** Colori della tavolozza di Google Fogli: grigio chiaro 2, rosso chiaro 1, verde chiaro 3. */
export const COLORI_HEX: Record<Colore, string> = {
    grigio: '#D9D9D9',
    rosso: '#E06666',
    verde: '#D9EAD3',
}

export const COLORI_CELLA: Record<Colore, { red: number; green: number; blue: number }> = {
    grigio: rgb(COLORI_HEX.grigio),
    rosso: rgb(COLORI_HEX.rosso),
    verde: rgb(COLORI_HEX.verde),
}

const CAMPI = 'userEnteredValue,userEnteredFormat.backgroundColor,userEnteredFormat.numberFormat'

export interface CellaDaScrivere {
    /** Riga del foglio, da 1. */
    riga: number
    tasso: number | null
    colore: Colore | null
}

interface Cella {
    userEnteredValue?: { numberValue: number }
    userEnteredFormat?: {
        numberFormat?: { type: 'PERCENT'; pattern: string }
        backgroundColor?: { red: number; green: number; blue: number }
    }
}

export function richiesteScrittura(input: { sheetId: number; colonnaTasso: number; righe: CellaDaScrivere[] }) {
    return input.righe.map(r => {
        // Cella vuota: valore e formato assenti ma nella maschera dei campi,
        // quindi Google li cancella (niente numero, niente colore).
        const cella: Cella = r.tasso === null ? {} : {
            userEnteredValue: { numberValue: r.tasso },
            userEnteredFormat: {
                numberFormat: { type: 'PERCENT', pattern: '0.0%' },
                ...(r.colore ? { backgroundColor: COLORI_CELLA[r.colore] } : {}),
            },
        }
        return {
            updateCells: {
                range: {
                    sheetId: input.sheetId,
                    startRowIndex: r.riga - 1,
                    endRowIndex: r.riga,
                    startColumnIndex: input.colonnaTasso,
                    endColumnIndex: input.colonnaTasso + 1,
                },
                rows: [{ values: [cella] }],
                fields: CAMPI,
            },
        }
    })
}
