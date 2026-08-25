/**
 * Parser delle righe CSV esportate da FreePBX 17 (Reports -> CDR Reports,
 * Report Type = CSV File).
 *
 * Attenzione al fuso: `calldate` è già ora locale italiana perché il
 * centralino sta in ufficio. Va quindi interpretata come Europe/Rome e non
 * come UTC, altrimenti tutte le giornate slittano di 1-2 ore e le chiamate
 * serali finiscono nel giorno sbagliato.
 */

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

/** Giorno operativo italiano di un istante. */
export function romeDateKey(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

/**
 * "2026-08-22 16:20:03" (ora di Roma) -> Date corretta.
 * Si ricava l'offset confrontando l'istante interpretato come UTC con la
 * sua resa in Europe/Rome: funziona sia con l'ora solare sia con la legale.
 */
function parseRomeTimestamp(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s)
    if (!m) return null
    const [, y, mo, d, h, mi, se] = m
    const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)
    const probe = new Date(asUtc)
    const romeParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(probe).reduce<Record<string, string>>((a, p) => (a[p.type] = p.value, a), {})
    const romeAsUtc = Date.UTC(+romeParts.year, +romeParts.month - 1, +romeParts.day,
        +romeParts.hour % 24, +romeParts.minute, +romeParts.second)
    return new Date(asUtc - (romeAsUtc - asUtc))
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

    const calldate = parseRomeTimestamp(rec.calldate || '')
    if (!calldate) return null

    const direction: 'out' | 'in' = srcIsExt ? 'out' : 'in'
    return {
        id,
        calldate,
        dateLocal: romeDateKey(calldate),
        src,
        dstKey: direction === 'out' ? dstKeyOf(dst) : dstKeyOf(src),
        duration: Number(rec.duration) || 0,
        billsec: Number(rec.billsec) || 0,
        disposition: (rec.disposition || '').trim(),
        direction,
    }
}
