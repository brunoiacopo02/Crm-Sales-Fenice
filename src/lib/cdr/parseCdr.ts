/**
 * Parser delle righe CSV esportate da FreePBX 17 (Reports -> CDR Reports,
 * Report Type = CSV File).
 *
 * Attenzione al fuso: `calldate` è scritta dal centralino in UTC, non in
 * ora locale italiana. Verificato incrociando gli orari col turno reale
 * degli operatori (13:30-20:00) su due stagioni diverse: interpretando il
 * campo come UTC e convertendo in Europe/Rome, gli orari tornano corretti
 * sia in ora solare che in ora legale. `dateLocal` resta calcolato in
 * Europe/Rome perché la giornata operativa è quella italiana.
 */

import { toRomeDateStr } from '@/lib/dateUtils'

export type CdrRow = {
    id: string
    calldate: Date
    dateLocal: string
    src: string
    dstKey: string | null
    duration: number
    billsec: number
    disposition: string
    direction: 'out' | 'in'
}

/** Un interno del centralino: 3 o 4 cifre (1005..1023, 102, 103, 999). */
function isExtension(s: string): boolean {
    return /^\d{3,4}$/.test(s)
}

/** Ultime 10 cifre del numero: la chiave di aggancio con leads.phone. */
export function dstKeyOf(raw: string): string | null {
    const digits = (raw || '').replace(/\D/g, '')
    return digits.length >= 10 ? digits.slice(-10) : null
}

export function parseCdrLine(rec: Record<string, string>): CdrRow | null {
    const id = (rec.uniqueid || '').trim()
    if (!id) return null

    const src = (rec.src || '').trim()
    const dst = (rec.dst || '').trim()
    if (!src || !dst) return null

    const srcIsExt = isExtension(src)
    const dstIsExt = isExtension(dst)
    // interno->interno: chiamate interne, non ci interessano
    if (srcIsExt && dstIsExt) return null
    if (!srcIsExt && !dstIsExt) return null

    // "2026-08-22 16:20:03" è UTC: aggiungendo "Z" il costruttore Date la
    // interpreta correttamente senza passare per l'ora locale italiana.
    const normalized = (rec.calldate || '').replace(' ', 'T')
    if (!normalized) return null
    const calldate = new Date(`${normalized}Z`)
    if (isNaN(calldate.getTime())) return null

    const direction: 'out' | 'in' = srcIsExt ? 'out' : 'in'
    return {
        id,
        calldate,
        dateLocal: toRomeDateStr(calldate),
        src,
        dstKey: direction === 'out' ? dstKeyOf(dst) : dstKeyOf(src),
        duration: Number(rec.duration) || 0,
        billsec: Number(rec.billsec) || 0,
        disposition: (rec.disposition || '').trim(),
        direction,
    }
}
