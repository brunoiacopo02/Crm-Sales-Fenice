// Vista "da una data" per account GDO passati a una persona nuova (PO 27/10/2026).
//
// Il 118 era di Lorenzo: chi lo usa adesso non deve vedere il suo archivio, gli
// appuntamenti da rifissare né i lead vecchi, ma i dati restano dove sono
// (KPI, presenze e vendite dei mesi passati non cambiano). In appSettings
// `gdo_vista_da` c'è una mappa { userId: ISO }: per quell'account pipeline,
// richiami e appuntamenti mostrano solo i lead presi in carico, o fissati,
// da quella data in poi. Togliere la voce riporta tutto com'era.

import { eq, gte, or, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, leads } from '@/db/schema'

export const VISTA_DA_KEY = 'gdo_vista_da'

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
