"use server"

import { db } from "@/db"
import { users } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import crypto from "crypto"

// Codici GDO richiesti da specifiche
const GDO_CODES = [105, 113, 114, 115, 116, 117, 118, 119]

export async function seedGdoAccounts() {
    // 1. Controlla quali esistono già per evitare duplicati ciecamente
    const existingUsers = await db.select({ gdoCode: users.gdoCode }).from(users).where(eq(users.role, 'GDO'))
    const existingCodes = new Set(existingUsers.map(u => u.gdoCode).filter(Boolean))

    const newAccounts = []

    // Password standard facilmente comunicabile (es. Cambiami123!)
    const defaultPasswordStr = "Fenice2026!"
    const hashedPassword = crypto.createHash('sha256').update(defaultPasswordStr).digest('hex')

    for (const code of GDO_CODES) {
        if (!existingCodes.has(code)) {
            const username = `gdo${code}`
            const newId = crypto.randomUUID()

            await db.insert(users).values({
                            id: newId,
                            name: `GDO ${code}`, // Display Name di default
                            email: `${username}@fenice.local`, // Fake internal email, usata come username nel login
                            password: hashedPassword,
                            role: 'GDO',
                            gdoCode: code,
                            displayName: `GDO ${code}`,
                            isActive: true,
                            createdAt: new Date(),
                        })

            newAccounts.push({
                username: `${username}@fenice.local`,
                password: defaultPasswordStr,
                gdoCode: code
            })
        }
    }

    return {
        success: true,
        createdCount: newAccounts.length,
        accounts: newAccounts, // Restituiti al client solo la prima volta per copia/incolla del Manager
        message: newAccounts.length > 0
            ? `Creati ${newAccounts.length} account GDO con successo.`
            : `Tutti gli account GDO (105-119) sono già presenti a sistema.`
    }
}

export async function getTeamAccounts() {
    return await db.select({
            id: users.id,
            name: users.name,
            email: users.email,
            gdoCode: users.gdoCode,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
            isActive: users.isActive,
            dailyApptTarget: users.dailyApptTarget,
            weeklyConfirmedTarget: users.weeklyConfirmedTarget,
            role: users.role,
        })
            .from(users)
            .where(inArray(users.role, ['GDO', 'VENDITORE']))
            .orderBy(users.role, users.gdoCode)
        
}

export async function updateGdoProfile(userId: string, data: { displayName?: string, avatarUrl?: string, isActive?: boolean }) {
    await db.update(users)
            .set({
                ...data,
            })
            .where(eq(users.id, userId))
        

    return { success: true }
}

export async function updateGdoTargets(dailyApptTarget: number, weeklyConfirmedTarget: number, scope: 'ALL' | string) {
    if (scope === 'ALL') {
        await db.update(users)
                    .set({ dailyApptTarget, weeklyConfirmedTarget })
                    .where(eq(users.role, 'GDO'))
            
    } else {
        await db.update(users)
                    .set({ dailyApptTarget, weeklyConfirmedTarget })
                    .where(eq(users.id, scope))
            
    }
    return { success: true }
}
