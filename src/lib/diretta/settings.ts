// Lettura e scrittura lato server delle impostazioni della Diretta (appSettings).
// Gli interruttori permettono di spegnere la nuova UI senza deploy.

import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings } from '@/db/schema'
import { DIRETTA_FLAG_KEYS, GAMIFICATION_SETTINGS_KEY, parseTargets, type GamificationTargets } from './config'

/** true se la UI Diretta è accesa per quel ruolo. Spenta di default e per ogni errore. */
export async function isDirettaOn(role: string | null | undefined): Promise<boolean> {
    const key = role === 'GDO' ? DIRETTA_FLAG_KEYS.GDO : role === 'CONFERME' ? DIRETTA_FLAG_KEYS.CONFERME : null
    if (!key) return false
    try {
        const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1)
        return row?.value === 'on'
    } catch {
        return false
    }
}

export async function readDirettaFlags(): Promise<{ GDO: boolean; CONFERME: boolean }> {
    try {
        const rows = await db.select().from(appSettings)
            .where(inArray(appSettings.key, [DIRETTA_FLAG_KEYS.GDO, DIRETTA_FLAG_KEYS.CONFERME]))
        const on = (k: string) => rows.find(r => r.key === k)?.value === 'on'
        return { GDO: on(DIRETTA_FLAG_KEYS.GDO), CONFERME: on(DIRETTA_FLAG_KEYS.CONFERME) }
    } catch {
        return { GDO: false, CONFERME: false }
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
