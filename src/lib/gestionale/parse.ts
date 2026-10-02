import { normalizePhoneStrict } from '../phoneNormalize'
import type { CommissioneRow, ContrattoRow, IncassoRow, RataRow, SnapshotRows } from './types'

/** Errore di formato: `path` dice quale record e quale campo, es. `contratti[1].incassi[0].id`. */
export class SnapshotParseError extends Error {
    constructor(public path: string, message: string) {
        super(`${path}: ${message}`)
        this.name = 'SnapshotParseError'
    }
}

const EUR_RE = /^-?\d+(\.\d{1,2})?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

/** "1250.00" → 125000. Niente float: si lavora sulle cifre della stringa. */
export function eurToCents(value: unknown, path: string): number {
    if (typeof value !== 'string' || !EUR_RE.test(value.trim())) {
        throw new SnapshotParseError(path, `importo non valido (${JSON.stringify(value)})`)
    }
    const v = value.trim()
    const neg = v.startsWith('-')
    const [int, dec = ''] = (neg ? v.slice(1) : v).split('.')
    const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'))
    return neg ? -cents : cents
}

function obj(v: unknown, path: string): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SnapshotParseError(path, 'oggetto atteso')
    return v as Record<string, unknown>
}
function arr(v: unknown, path: string): unknown[] {
    if (!Array.isArray(v)) throw new SnapshotParseError(path, 'array atteso')
    return v
}
function reqId(v: unknown, path: string): string {
    if (typeof v !== 'string' || !v.trim()) throw new SnapshotParseError(path, 'id mancante')
    return v.trim()
}
function optStr(v: unknown, path: string): string | null {
    if (v === null || v === undefined) return null
    if (typeof v !== 'string') throw new SnapshotParseError(path, 'stringa attesa')
    const t = v.trim()
    return t ? t : null
}
function optDate(v: unknown, path: string): string | null {
    const s = optStr(v, path)
    if (s !== null && !DATE_RE.test(s)) throw new SnapshotParseError(path, `data non valida (${s})`)
    return s
}
function optMonth(v: unknown, path: string): string | null {
    const s = optStr(v, path)
    if (s !== null && !MONTH_RE.test(s)) throw new SnapshotParseError(path, `mese non valido (${s})`)
    return s
}
function optInt(v: unknown, path: string): number | null {
    if (v === null || v === undefined) return null
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new SnapshotParseError(path, 'intero atteso')
    return v
}
function phone(v: unknown, path: string): string | null {
    const s = optStr(v, path)
    if (s === null || s.toUpperCase() === 'N/A') return null
    return normalizePhoneStrict(s)
}

/**
 * Valida e appiattisce lo snapshot. Un solo record malformato fa fallire
 * TUTTO: una copia parziale è peggio della copia di un'ora fa.
 */
export function parseSnapshot(json: unknown): SnapshotRows {
    const root = obj(json, '$')
    const contratti: ContrattoRow[] = []
    const rate: RataRow[] = []
    const incassi: IncassoRow[] = []
    const seen = { c: new Set<string>(), r: new Set<string>(), i: new Set<string>() }
    const unique = (set: Set<string>, id: string, path: string) => {
        if (set.has(id)) throw new SnapshotParseError(path, `id duplicato (${id})`)
        set.add(id)
    }

    arr(root.contratti, 'contratti').forEach((raw, ci) => {
        const p = `contratti[${ci}]`
        const c = obj(raw, p)
        const id = reqId(c.id, `${p}.id`)
        unique(seen.c, id, `${p}.id`)
        const cliente = c.cliente === null || c.cliente === undefined ? {} : obj(c.cliente, `${p}.cliente`)
        contratti.push({
            id,
            dataFirma: optDate(c.data_firma, `${p}.data_firma`),
            pacchetto: optStr(c.pacchetto, `${p}.pacchetto`),
            importoTotaleCents: eurToCents(c.importo_totale, `${p}.importo_totale`),
            statoPagamento: optStr(c.stato_pagamento, `${p}.stato_pagamento`),
            venditoreCode: optStr(c.venditore, `${p}.venditore`),
            note: optStr(c.note, `${p}.note`),
            clienteNome: optStr(cliente.nome, `${p}.cliente.nome`),
            clienteCognome: optStr(cliente.cognome, `${p}.cliente.cognome`),
            clienteTelefono: phone(cliente.telefono, `${p}.cliente.telefono`),
            clienteEmail: optStr(cliente.email, `${p}.cliente.email`),
        })
        arr(c.rate ?? [], `${p}.rate`).forEach((rr, ri) => {
            const rp = `${p}.rate[${ri}]`
            const r = obj(rr, rp)
            const rid = reqId(r.id, `${rp}.id`)
            unique(seen.r, rid, `${rp}.id`)
            rate.push({
                id: rid, contrattoId: id,
                numero: optInt(r.numero, `${rp}.numero`),
                tipo: optStr(r.tipo, `${rp}.tipo`),
                scadenza: optDate(r.scadenza, `${rp}.scadenza`),
                importoCents: eurToCents(r.importo, `${rp}.importo`),
                stato: optStr(r.stato, `${rp}.stato`),
                incassoId: optStr(r.incasso_id, `${rp}.incasso_id`),
            })
        })
        arr(c.incassi ?? [], `${p}.incassi`).forEach((ir, ii) => {
            const ip = `${p}.incassi[${ii}]`
            const i = obj(ir, ip)
            const iid = reqId(i.id, `${ip}.id`)
            unique(seen.i, iid, `${ip}.id`)
            incassi.push({
                id: iid, contrattoId: id,
                data: optDate(i.data, `${ip}.data`),
                importoCents: eurToCents(i.importo, `${ip}.importo`),
                metodo: optStr(i.metodo, `${ip}.metodo`),
                voce: optStr(i.voce, `${ip}.voce`),
                stato: optStr(i.stato, `${ip}.stato`),
                stornoDi: optStr(i.storno_di, `${ip}.storno_di`),
                rataId: optStr(i.rata_id, `${ip}.rata_id`),
                venditoreCode: optStr(i.venditore, `${ip}.venditore`),
                contaCommissione: i.conta_commissione === true,
                meseCommissione: optMonth(i.mese_commissione, `${ip}.mese_commissione`),
            })
        })
    })

    const commissioni: CommissioneRow[] = arr(root.commissioni, 'commissioni').map((raw, k) => {
        const p = `commissioni[${k}]`
        const c = obj(raw, p)
        const venditoreCode = optStr(c.venditore, `${p}.venditore`)
        if (!venditoreCode) throw new SnapshotParseError(`${p}.venditore`, 'venditore mancante')
        const mese = optMonth(c.mese, `${p}.mese`)
        if (!mese) throw new SnapshotParseError(`${p}.mese`, 'mese mancante')
        return {
            venditoreCode, mese,
            totaleIncassatoCents: eurToCents(c.totale_incassato, `${p}.totale_incassato`),
            commissioneLordaCents: eurToCents(c.commissione_lorda, `${p}.commissione_lorda`),
            commissioneImponibileCents: eurToCents(c.commissione_imponibile, `${p}.commissione_imponibile`),
        }
    })

    return { generatoIl: optStr(root.generato_il, 'generato_il'), contratti, rate, incassi, commissioni }
}
