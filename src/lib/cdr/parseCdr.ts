/**
 * Parser delle righe CSV esportate da FreePBX 17 (Reports -> CDR Reports,
 * Report Type = CSV File).
 *
 * Attenzione al fuso: `calldate` è già ora locale italiana perché il
 * centralino sta in ufficio. Va quindi interpretata come Europe/Rome e non
 * come UTC, altrimenti tutte le giornate slittano di 1-2 ore e le chiamate
 * serali finiscono nel giorno sbagliato.
 */

import { parseRomeDatetimeLocal, toRomeDateStr } from '@/lib/dateUtils'

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

    // Normalizza "2026-08-22 16:20:03" a "2026-08-22T16:20:03"
    const normalized = (rec.calldate || '').replace(' ', 'T')
    const calldate = parseRomeDatetimeLocal(normalized)
    if (!calldate) return null

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
