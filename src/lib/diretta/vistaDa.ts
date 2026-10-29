// Vista "da una data" per account GDO passati a una persona nuova (PO 27/10/2026).
//
// Il 118 era di Fabio (fino al 19/10/2026) e dalla settimana del 2/11 è di
// Lorenzo. In appSettings `gdo_vista_da` c'è una mappa { userId: ISO }:
//   - appuntamenti/archivio del GDO mostrano solo i lead presi in carico, o
//     fissati, da quella data in poi (filtroVistaDa);
//   - le statistiche contano l'account solo da quella data
//     (leggiInizioAccount + ./inizioAccount.ts, PO 29/10/2026).
// Pipeline e richiami non filtrano: i lead aperti di chi c'era prima sono
// stati tolti all'account il 29/10. I dati restano dove sono (storia dei
// lead, totali aziendali). Togliere la voce riporta tutto com'era.

import { eq, gte, or, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, leads } from '@/db/schema'
import { NESSUN_INIZIO, parseInizioAccount, type InizioAccount } from './inizioAccount'

export const VISTA_DA_KEY = 'gdo_vista_da'

/**
 * Tutti gli account ripartiti, { userId → data }: la usano le statistiche
 * (./inizioAccount.ts) per contare l'account solo da quella data. Su errore
 * di lettura nessun filtro, come prima.
 */
let memo: { at: number; valore: InizioAccount } | null = null
const MEMO_MS = 30_000

export async function leggiInizioAccount(): Promise<InizioAccount> {
    // Cambia una volta ogni tanto e la leggono molte query per pagina: 30 secondi di memoria.
    if (memo && Date.now() - memo.at < MEMO_MS) return memo.valore
    try {
        const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, VISTA_DA_KEY)).limit(1)
        const valore = parseInizioAccount(row?.value)
        memo = { at: Date.now(), valore }
        return valore
    } catch {
        return NESSUN_INIZIO
    }
}

/** La data da cui l'account vede i suoi lead, o null se vede tutto. */
export async function leggiVistaDa(userId: string): Promise<Date | null> {
    try {
        const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, VISTA_DA_KEY)).limit(1)
        if (!row?.value) return null
        const mappa = JSON.parse(row.value) as Record<string, unknown>
        const v = mappa?.[userId]
        if (typeof v !== 'string') return null
        const d = new Date(v)
        return Number.isNaN(d.getTime()) ? null : d
    } catch {
        return null
    }
}

/** Lead presi in carico o fissati dalla data `da` in poi. */
export function leadDaQuando(da: Date): SQL {
    return or(gte(leads.assignedAt, da), gte(leads.appointmentCreatedAt, da))!
}

/** Condizione da aggiungere alle query del GDO: undefined se l'account vede tutto. */
export async function filtroVistaDa(userId: string): Promise<SQL | undefined> {
    const da = await leggiVistaDa(userId)
    return da ? leadDaQuando(da) : undefined
}
