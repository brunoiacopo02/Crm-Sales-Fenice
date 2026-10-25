// Moltiplicatore presenza (PO 25/10/2026): un GDO lo compra in negozio e ogni
// appuntamento che fissa da lì a fine giornata, se poi la persona si presenta
// davvero, gli rende Scintille in più. Premia la qualità, non il volume: paga
// solo sulle presenze verificate (le stesse delle Piume) e si storna se la
// presenza sparisce. Con i default (20 Scintille, +25 a presenza, al massimo 4)
// rende da -20 a +80, e va in pari con una presenza. Funzioni pure.

const isStorno = (k: string) => k.startsWith('storno:')

export const KIND_MOLTIPLICATORE = 'moltiplicatore'
export const CAUSALE_MOLTIPLICATORE = 'moltiplicatore'

export interface MoltiplicatoreRules {
    bonus: number           // Scintille in più per presenza
    maxPresenze: number     // presenze pagate al massimo per moltiplicatore
    perGiorno: number       // moltiplicatori comprabili al giorno a persona
}

export const DEFAULT_MOLTIPLICATORE: MoltiplicatoreRules = { bonus: 25, maxPresenze: 4, perGiorno: 1 }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface RigaNegozio {
    reason: string
    amount: number
    createdAt: Date
    metadata: unknown
}

/** Id dell'acquisto se la riga è l'addebito di un moltiplicatore. */
export function acquistoMoltiplicatore(r: RigaNegozio): string | null {
    if (r.reason !== 'negozio' || r.amount >= 0 || !isObj(r.metadata) || r.metadata.moltiplicatore !== true) return null
    return typeof r.metadata.purchaseId === 'string' ? r.metadata.purchaseId : null
}

/** Moltiplicatori comprati fra le righe date (di solito quelle del giorno di Roma). */
export function moltiplicatoriComprati(righe: readonly RigaNegozio[]): number {
    return righe.filter(r => acquistoMoltiplicatore(r) !== null).length
}

/**
 * Il moltiplicatore che copre un fissato: comprato lo stesso giorno di Roma
 * (le righe passate sono quelle di quel giorno) prima del fissato.
 */
export function moltiplicatoreCopre(righeGiorno: readonly RigaNegozio[], fissatoAt: Date): string | null {
    for (const r of righeGiorno) {
        const id = acquistoMoltiplicatore(r)
        if (id && r.createdAt.getTime() <= fissatoAt.getTime()) return id
    }
    return null
}

/** Riga del registro di un lead, come la legge la sincronizzazione dei premi. */
export interface RigaLead {
    idemKey: string
    amount: number
    createdAt?: Date
    userId?: string
}

/** Il fissato del lead ancora valido (non stornato), il più recente. */
export function fissatoValido(righe: readonly RigaLead[], leadId: string): { idemKey: string; userId: string; createdAt: Date } | null {
    const stornate = new Set(righe.filter(r => isStorno(r.idemKey)).map(r => r.idemKey.slice('storno:'.length)))
    let migliore: { idemKey: string; userId: string; createdAt: Date } | null = null
    for (const r of righe) {
        if (!r.idemKey.startsWith(`S:fissato:${leadId}:`) || r.amount <= 0 || stornate.has(r.idemKey)) continue
        if (!r.userId || !r.createdAt) continue
        if (!migliore || r.createdAt.getTime() > migliore.createdAt.getTime()) {
            migliore = { idemKey: r.idemKey, userId: r.userId, createdAt: r.createdAt }
        }
    }
    return migliore
}

/**
 * Chiave del premio: legata al fissato, così un appuntamento nuovo è un premio
 * nuovo. Dopo uno storno (presenza sparita e poi tornata) ':g2', ':g3'...
 */
export function moltIdemKey(fissatoIdemKey: string, generazione = 1): string {
    return generazione > 1 ? `molt:${fissatoIdemKey}:g${generazione}` : `molt:${fissatoIdemKey}`
}

/** Premi del moltiplicatore pagati (e non stornati) per un acquisto, dalle righe della persona. */
export function premiPerAcquisto(righe: readonly (RigaNegozio & { idemKey: string })[], purchaseId: string): number {
    const stornate = new Set(righe.filter(r => isStorno(r.idemKey)).map(r => r.idemKey.slice('storno:'.length)))
    return righe.filter(r => r.reason === CAUSALE_MOLTIPLICATORE && r.amount > 0 && !stornate.has(r.idemKey)
        && isObj(r.metadata) && r.metadata.purchaseId === purchaseId).length
}

/**
 * Cosa fare sul registro del lead per il moltiplicatore, dato lo stato:
 * - presenza non (più) valida, o fissato sparito: si stornano tutti i premi attivi;
 * - presenza valida: resta solo il premio del fissato valido; se non c'è, si
 *   accredita quando la presenza è pagabile (stessa condizione delle Piume), il
 *   fissato è del destinatario e un moltiplicatore lo copre con posto libero.
 * `copertura` = il moltiplicatore che copre il fissato e quanti premi ha già pagato.
 */
export function pianoMoltiplicatore(i: {
    righeLead: readonly RigaLead[]
    leadId: string
    presenzaValida: boolean
    presenzaPagabile: boolean
    destinatarioId: string | null
    copertura: { purchaseId: string; usati: number } | null
    rules: MoltiplicatoreRules
}): { accredita: { idemKey: string; purchaseId: string; fissatoIdemKey: string } | null; storna: string[] } {
    const validi = premiMoltiplicatoreValidi(i.righeLead)
    const fissato = fissatoValido(i.righeLead, i.leadId)
    if (!i.presenzaValida || !fissato) return { accredita: null, storna: validi }
    const base = moltIdemKey(fissato.idemKey)
    const diQuesto = (k: string) => k === base || k.startsWith(`${base}:g`)
    const storna = validi.filter(k => !diQuesto(k))
    if (validi.some(diQuesto)) return { accredita: null, storna }
    const c = i.copertura
    if (!i.presenzaPagabile || fissato.userId !== i.destinatarioId || !c || c.usati >= i.rules.maxPresenze || i.rules.bonus <= 0) {
        return { accredita: null, storna }
    }
    const generazione = i.righeLead.filter(r => r.amount > 0 && diQuesto(r.idemKey)).length + 1
    return { accredita: { idemKey: moltIdemKey(fissato.idemKey, generazione), purchaseId: c.purchaseId, fissatoIdemKey: fissato.idemKey }, storna }
}

/** Premi del moltiplicatore sul lead ancora validi (non stornati). */
export function premiMoltiplicatoreValidi(righe: readonly RigaLead[]): string[] {
    const stornate = new Set(righe.filter(r => isStorno(r.idemKey)).map(r => r.idemKey.slice('storno:'.length)))
    return righe.filter(r => r.idemKey.startsWith('molt:') && r.amount > 0 && !stornate.has(r.idemKey)).map(r => r.idemKey)
}

export type MoltiplicatoreNo = 'moltiplicatore_turno' | 'moltiplicatore_oggi'

/** Si può comprare un moltiplicatore adesso? Solo in turno, al massimo perGiorno al giorno. */
export function puoComprareMoltiplicatore(i: {
    righeOggi: readonly RigaNegozio[]
    now: Date
    turno: { start: Date; end: Date } | null
    rules: MoltiplicatoreRules
}): { ok: true } | { ok: false; error: MoltiplicatoreNo } {
    const { righeOggi, now, turno, rules } = i
    if (!turno || now.getTime() < turno.start.getTime() || now.getTime() >= turno.end.getTime()) {
        return { ok: false, error: 'moltiplicatore_turno' }
    }
    if (moltiplicatoriComprati(righeOggi) >= rules.perGiorno) return { ok: false, error: 'moltiplicatore_oggi' }
    return { ok: true }
}

/** Regole dal JSON: valori assenti o assurdi restano ai default. */
export function parseMoltiplicatore(v: unknown): MoltiplicatoreRules {
    const o = isObj(v) ? v : {}
    const intero = (x: unknown, d: number, min: number) => (Number.isInteger(x) && (x as number) >= min ? (x as number) : d)
    return {
        bonus: intero(o.bonus, DEFAULT_MOLTIPLICATORE.bonus, 0),
        maxPresenze: intero(o.maxPresenze, DEFAULT_MOLTIPLICATORE.maxPresenze, 0),
        perGiorno: intero(o.perGiorno, DEFAULT_MOLTIPLICATORE.perGiorno, 0),
    }
}
