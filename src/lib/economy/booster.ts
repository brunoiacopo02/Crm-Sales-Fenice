// Booster dei fissati (PO 25/10/2026): un GDO lo compra in negozio con le
// Scintille e per un'ora i suoi fissati pagano il doppio. Costa poco ma va
// guadagnato: con i default (15 Scintille, 60 minuti, al massimo 3 fissati
// raddoppiati, uno al giorno) rende fra -5 e +15 Scintille nette, e solo se
// in quell'ora si fissa davvero. Non tocca il tetto del giorno né gli scalini:
// raddoppia solo i fissati che pagano, e se il fissato si storna si storna
// anche il raddoppio. Funzioni pure: le usano negozio e premi del fissato.

/** Tipo di articolo del negozio che attiva il booster. */
export const KIND_BOOSTER = 'booster'
/** Causale del registro per le Scintille in più del booster. */
export const CAUSALE_BOOSTER = 'booster'

export interface BoosterRules {
    minuti: number          // durata dall'acquisto
    maxFissati: number      // fissati raddoppiati al massimo per booster
    perGiorno: number       // booster comprabili al giorno a persona
}

export const DEFAULT_BOOSTER: BoosterRules = { minuti: 60, maxFissati: 3, perGiorno: 1 }

/** Riga del registro della persona, quanto basta al booster. */
export interface RigaBooster {
    reason: string
    amount: number
    createdAt: Date
    metadata: unknown
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** L'acquisto di un booster: l'addebito del negozio con metadata.booster. */
function acquistoBooster(r: RigaBooster): { purchaseId: string; minuti: number } | null {
    if (r.reason !== 'negozio' || r.amount >= 0 || !isObj(r.metadata) || r.metadata.booster !== true) return null
    const purchaseId = typeof r.metadata.purchaseId === 'string' ? r.metadata.purchaseId : null
    const minuti = typeof r.metadata.minuti === 'number' && r.metadata.minuti > 0 ? r.metadata.minuti : null
    return purchaseId && minuti ? { purchaseId, minuti } : null
}

export interface BoosterAttivo {
    purchaseId: string
    fino: Date
    /** Fissati già raddoppiati da questo booster. */
    usati: number
}

/** Il booster in corso all'istante `at`, se c'è (la durata è quella scritta all'acquisto). */
export function boosterAttivo(righe: readonly RigaBooster[], at: Date): BoosterAttivo | null {
    for (const r of righe) {
        const b = acquistoBooster(r)
        if (!b) continue
        const fino = new Date(r.createdAt.getTime() + b.minuti * 60_000)
        if (r.createdAt.getTime() <= at.getTime() && at.getTime() < fino.getTime()) {
            const usati = righe.filter(x => x.reason === CAUSALE_BOOSTER && x.amount > 0
                && isObj(x.metadata) && x.metadata.purchaseId === b.purchaseId).length
            return { purchaseId: b.purchaseId, fino, usati }
        }
    }
    return null
}

/** Booster comprati fra le righe date (di solito quelle del giorno di Roma). */
export function boosterComprati(righe: readonly RigaBooster[]): number {
    return righe.filter(r => acquistoBooster(r) !== null).length
}

export type BoosterNo = 'booster_turno' | 'booster_attivo' | 'booster_oggi'

/** Si può comprare un booster adesso? `turno` è il turno di oggi (null = giorno senza turno). */
export function puoComprareBooster(i: {
    righeOggi: readonly RigaBooster[]
    now: Date
    turno: { start: Date; end: Date } | null
    rules: BoosterRules
}): { ok: true } | { ok: false; error: BoosterNo } {
    const { righeOggi, now, turno, rules } = i
    if (!turno || now.getTime() < turno.start.getTime() || now.getTime() >= turno.end.getTime()) {
        return { ok: false, error: 'booster_turno' }
    }
    if (boosterAttivo(righeOggi, now)) return { ok: false, error: 'booster_attivo' }
    if (boosterComprati(righeOggi) >= rules.perGiorno) return { ok: false, error: 'booster_oggi' }
    return { ok: true }
}

/** Il fissato appena pagato va raddoppiato? */
export function raddoppia(attivo: BoosterAttivo | null, rules: BoosterRules): boolean {
    return !!attivo && attivo.usati < rules.maxFissati
}

/** Chiave del raddoppio: segue quella del fissato, così si storna con lui. */
export function boostIdemKey(fissatoIdemKey: string): string {
    return `boost:${fissatoIdemKey}`
}

/** Regole del booster dal JSON delle regole: valori assenti o assurdi restano ai default. */
export function parseBooster(v: unknown): BoosterRules {
    const o = isObj(v) ? v : {}
    const intero = (x: unknown, d: number, min: number) => (Number.isInteger(x) && (x as number) >= min ? (x as number) : d)
    return {
        minuti: intero(o.minuti, DEFAULT_BOOSTER.minuti, 1),
        maxFissati: intero(o.maxFissati, DEFAULT_BOOSTER.maxFissati, 0),
        perGiorno: intero(o.perGiorno, DEFAULT_BOOSTER.perGiorno, 0),
    }
}
