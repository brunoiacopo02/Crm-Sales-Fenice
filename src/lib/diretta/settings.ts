// Lettura e scrittura lato server delle impostazioni della Diretta (appSettings).
// Gli interruttori permettono di spegnere la nuova UI senza deploy.

import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings } from '@/db/schema'
import {
    DIRETTA_FLAG_KEYS, GAMIFICATION_SETTINGS_KEY, RUOLI_DIRETTA, chiaveInterruttore, parseTargets,
    type GamificationTargets, type RuoloDiretta,
} from './config'

/** true se la UI Diretta è accesa per quel ruolo (GDO, Conferme, admin). Spenta di default e per ogni errore. */
export async function isDirettaOn(role: string | null | undefined): Promise<boolean> {
    const key = chiaveInterruttore(role)
    if (!key) return false
    try {
        const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1)
        return row?.value === 'on'
    } catch {
        return false
    }
}

export async function readDirettaFlags(): Promise<Record<RuoloDiretta, boolean>> {
    const spenti = { GDO: false, CONFERME: false, ADMIN: false }
    try {
        const rows = await db.select().from(appSettings)
            .where(inArray(appSettings.key, RUOLI_DIRETTA.map(r => DIRETTA_FLAG_KEYS[r])))
        const on = (r: RuoloDiretta) => rows.find(x => x.key === DIRETTA_FLAG_KEYS[r])?.value === 'on'
        return { GDO: on('GDO'), CONFERME: on('CONFERME'), ADMIN: on('ADMIN') }
    } catch {
        return spenti
    }
}

export async function readGamificationTargets(): Promise<GamificationTargets> {
    try {
        const [row] = await db.select({ value: appSettings.value }).from(appSettings)
            .where(eq(appSettings.key, GAMIFICATION_SETTINGS_KEY)).limit(1)
        return parseTargets(row?.value)
    } catch {
        return parseTargets(null)
    }
}

export async function writeSetting(key: string, value: string, updatedBy: string): Promise<void> {
    await db.insert(appSettings).values({ key, value, updatedBy, updatedAt: new Date() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy, updatedAt: new Date() } })
}
