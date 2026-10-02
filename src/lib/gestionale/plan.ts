import { DIREZIONE } from './types'

export type ExistingId = { id: string; deleted: boolean }
export type IdDiff = { insertIds: string[]; updateIds: string[]; restoreIds: string[]; deleteIds: string[] }

export function diffIds(existing: ExistingId[], incomingIds: string[]): IdDiff {
    const byId = new Map(existing.map(e => [e.id, e]))
    const incoming = new Set(incomingIds)
    const out: IdDiff = { insertIds: [], updateIds: [], restoreIds: [], deleteIds: [] }
    for (const id of incomingIds) {
        const e = byId.get(id)
        if (!e) out.insertIds.push(id)
        else if (e.deleted) out.restoreIds.push(id)
        else out.updateIds.push(id)
    }
    for (const e of existing) if (!e.deleted && !incoming.has(e.id)) out.deleteIds.push(e.id)
    return out
}

export class SyncGuardError extends Error {
    constructor(message: string) { super(message); this.name = 'SyncGuardError' }
}

export const MAX_DELETE_RATIO = 0.3
export const MIN_ROWS_FOR_RATIO = 10

/**
 * Una risposta sbagliata del gestionale (vuota, troncata) non deve poter
 * svuotare la copia: meglio un dato vecchio di un'ora che nessun dato.
 */
export function assertSafeToApply(table: string, liveCount: number, incomingCount: number, deleteCount: number): void {
    if (liveCount > 0 && incomingCount === 0) {
        throw new SyncGuardError(`${table}: snapshot vuoto ma ${liveCount} righe presenti, sync annullato`)
    }
    if (liveCount >= MIN_ROWS_FOR_RATIO && deleteCount / liveCount > MAX_DELETE_RATIO) {
        throw new SyncGuardError(`${table}: ${deleteCount} eliminazioni su ${liveCount} righe (oltre il 30%), sync annullato`)
    }
}

/** Chiave della riga commissioni (PK composta): `codice|mese`. */
export function commissionKeys(rows: { venditoreCode: string; mese: string }[]): string[] {
    return rows.map(r => `${r.venditoreCode}|${r.mese}`)
}

export type SellerMap = Map<string, string>

export function resolveSeller(code: string | null, sellers: SellerMap, warnings: Set<string>): string | null {
    if (!code || code === DIREZIONE) return null
    const id = sellers.get(code)
    if (!id) warnings.add(`Codice venditore sconosciuto: ${code}`)
    return id ?? null
}
