// Accesso al foglio Google delle SIM dei GDO (PO 14/11/2026). Lo stesso
// service account della riconciliazione (GOOGLE_SHEETS_SA_EMAIL /
// GOOGLE_SHEETS_SA_PRIVATE_KEY), condiviso sul foglio come Editor.

import { sheetsServiceAccount } from '@/lib/riconciliazione/sheetsClient'
import type { CellaFoglio } from './intestazioni'

export const SIM_GDO_SPREADSHEET_ID = '1TqURIgSnan9O5VGanNtIM4hfWnUuFnwe808K4P4YBJs'
export const SIM_GDO_SCHEDA = 'Foglio2'

export class FoglioSimError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'FoglioSimError'
    }
}

function spiega(e: unknown, cosa: string): FoglioSimError {
    if (e instanceof FoglioSimError) return e
    const err = e as { code?: number; response?: { status?: number }; message?: string }
    const code = err?.code ?? err?.response?.status
    if (code === 403) return new FoglioSimError(`${cosa}: il service account non ha accesso al foglio (va condiviso come Editor).`)
    if (code === 404) return new FoglioSimError(`${cosa}: foglio o scheda "${SIM_GDO_SCHEDA}" non trovati.`)
    return new FoglioSimError(`${cosa} fallita (${code ?? err?.message ?? 'errore ignoto'}).`)
}

/**
 * Legge la scheda intera. I numeri arrivano come numeri (niente "3,52E+09"),
 * le date come le mostra il foglio (es. "14/11/2026").
 */
export async function leggiFoglioSim(accesso: 'lettura' | 'scrittura' = 'lettura'): Promise<{ sheetId: number; valori: CellaFoglio[][] }> {
    try {
        const sheets = sheetsServiceAccount(accesso)
        const meta = await sheets.spreadsheets.get({
            spreadsheetId: SIM_GDO_SPREADSHEET_ID,
            fields: 'sheets.properties(sheetId,title)',
        })
        const scheda = meta.data.sheets?.find(s => s.properties?.title === SIM_GDO_SCHEDA)
        const sheetId = scheda?.properties?.sheetId
        if (sheetId === undefined || sheetId === null) throw new FoglioSimError(`Nel foglio non c'è la scheda "${SIM_GDO_SCHEDA}".`)
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SIM_GDO_SPREADSHEET_ID,
            range: SIM_GDO_SCHEDA,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING',
        })
        return { sheetId, valori: (res.data.values ?? []) as CellaFoglio[][] }
    } catch (e) {
        throw spiega(e, 'Lettura del foglio')
    }
}

/** Un solo batchUpdate: o passano tutte le celle o nessuna. */
export async function scriviFoglioSim(requests: object[]): Promise<void> {
    if (requests.length === 0) return
    try {
        await sheetsServiceAccount('scrittura').spreadsheets.batchUpdate({
            spreadsheetId: SIM_GDO_SPREADSHEET_ID,
            requestBody: { requests },
        })
    } catch (e) {
        throw spiega(e, 'Scrittura sul foglio')
    }
}
