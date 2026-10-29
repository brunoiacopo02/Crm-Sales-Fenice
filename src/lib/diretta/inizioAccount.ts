// Inizio account (PO 29/10/2026): un account GDO passato a una persona nuova
// conta nelle statistiche solo da quando la usa lei.
//
// Il 118 era di Fabio (fino al 19/10/2026) e passa a Lorenzo, che non ha mai
// lavorato: chiamate, fissati, presenze e premi di Fabio NON sono suoi. I dati
// restano nel DB (storia dei lead, totali aziendali): si toglie solo
// l'attribuzione all'account prima della data. La data è la stessa della
// vista (`gdo_vista_da` in appSettings, src/lib/diretta/vistaDa.ts).
//
// Due regole, una per tipo di dato:
//   - riga con persona e momento (chiamata, evento, pausa, tabulato,
//     movimento di monete): conta per l'account solo dal momento in poi;
//   - lead (fissato, presenza, conferma, chiusura): è dell'account nuovo se
//     preso in carico o fissato dalla data in poi (stessa regola della vista).
//
// Qui solo funzioni pure, senza DB: la lettura sta in ./vistaDa.ts.

import { and, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/** userId → data da cui l'account conta. Vuota = nessun account ripartito. */
export type InizioAccount = ReadonlyMap<string, Date>

export const NESSUN_INIZIO: InizioAccount = new Map()

/** Legge il valore JSON di `gdo_vista_da` ({ userId: ISO }); ignora le voci rotte. */
export function parseInizioAccount(raw: string | null | undefined): InizioAccount {
    const mappa = new Map<string, Date>()
    if (!raw) return mappa
    try {
        const obj = JSON.parse(raw) as Record<string, unknown>
        if (!obj || typeof obj !== 'object') return mappa
        for (const [userId, v] of Object.entries(obj)) {
            if (typeof v !== 'string') continue
            const d = new Date(v)
            if (!Number.isNaN(d.getTime())) mappa.set(userId, d)
        }
    } catch {
        // JSON rotto: nessun filtro, come prima
    }
    return mappa
}

function aData(v: Date | string | null | undefined): Date | null {
    if (v == null) return null
    const d = v instanceof Date ? v : new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Una riga (chiamata, evento, pausa...) conta per `userId`? Sì se l'account non
 * è ripartito, o se il momento è dalla data di inizio in poi. Senza momento,
 * per un account ripartito, non conta.
 */
export function rigaConta(inizio: InizioAccount, userId: string | null | undefined, quando: Date | string | null | undefined): boolean {
    if (!userId) return true
    const da = inizio.get(userId)
    if (!da) return true
    const q = aData(quando)
    return q !== null && q.getTime() >= da.getTime()
}

/**
 * Un lead conta per il GDO a cui è assegnato? Sì se l'account non è ripartito,
 * o se il lead è stato preso in carico o fissato dalla data di inizio in poi.
 */
export function leadConta(
    inizio: InizioAccount,
    l: { assignedToId: string | null | undefined; assignedAt?: Date | string | null; appointmentCreatedAt?: Date | string | null },
): boolean {
    if (!l.assignedToId) return true
    const da = inizio.get(l.assignedToId)
    if (!da) return true
    const presa = aData(l.assignedAt)
    const fissato = aData(l.appointmentCreatedAt)
    return (presa !== null && presa.getTime() >= da.getTime())
        || (fissato !== null && fissato.getTime() >= da.getTime())
}

/** `col >= da` (NULL non passa). La data va come ISO con cast: niente sorprese di fuso. */
function dalle(col: SQLWrapper, da: Date): SQL {
    return sql`${col} >= ${da.toISOString()}::timestamptz`
}

/**
 * Condizione SQL per le righe con persona e momento: per ogni account ripartito
 * tiene la riga solo se è di un altro o dal momento di inizio in poi.
 * undefined se nessun account è ripartito (and() la ignora).
 */
export function sqlRigaConta(inizio: InizioAccount, colUtente: SQLWrapper, colQuando: SQLWrapper): SQL | undefined {
    if (inizio.size === 0) return undefined
    const parti = [...inizio].map(([userId, da]) =>
        or(sql`${colUtente} IS DISTINCT FROM ${userId}`, dalle(colQuando, da))!,
    )
    return and(...parti)
}

/**
 * Condizione SQL per i lead: per ogni account ripartito tiene il lead solo se è
 * di un altro, o preso in carico / fissato dal momento di inizio in poi.
 */
export function sqlLeadConta(
    inizio: InizioAccount,
    col: { assignedToId: SQLWrapper; assignedAt: SQLWrapper; appointmentCreatedAt: SQLWrapper },
): SQL | undefined {
    if (inizio.size === 0) return undefined
    const parti = [...inizio].map(([userId, da]) =>
        or(
            sql`${col.assignedToId} IS DISTINCT FROM ${userId}`,
            dalle(col.assignedAt, da),
            dalle(col.appointmentCreatedAt, da),
        )!,
    )
    return and(...parti)
}

/** Inizio di un periodo per un account: il più tardo fra l'inizio del periodo e l'inizio dell'account. */
export function inizioPeriodo(inizio: InizioAccount, userId: string, start: Date): Date {
    const da = inizio.get(userId)
    return da && da.getTime() > start.getTime() ? da : start
}
