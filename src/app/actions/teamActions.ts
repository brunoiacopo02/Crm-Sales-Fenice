"use server"

import { db } from "@/db"
import { users } from "@/db/schema"
import { and, eq, inArray, or, sql } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

// La generazione massiva degli account GDO (seedGdoAccounts) è stata tolta il
// 25/10/2026 (PO): creava utenti con una password fissa uguale per tutti e
// fuori da Supabase Auth. Gli account nuovi si creano da Supabase.

export async function getTeamAccounts() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
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
        confermeTargetTier1: users.confermeTargetTier1,
        confermeTargetTier2: users.confermeTargetTier2,
        role: users.role,
    })
        .from(users)
        .where(and(
            inArray(users.role, ['GDO', 'VENDITORE', 'CONFERME']),
            // staff condiviso: membro accessibile se l'azienda attiva è tra le sue
            // allowedCompanies, con fallback al companyId per utenti legacy (null).
            or(
                sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
                and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
            ),
        ))
        .orderBy(users.role, users.gdoCode)

}

/**
 * Profili e obiettivi del team li modificano solo ADMIN e MANAGER, le stesse
 * persone a cui /team è aperta. Il ruolo si legge dal DB e non dai metadata
 * della sessione, che l'utente può cambiarsi da solo. Fino al 25/10/2026
 * queste action non controllavano nessun ruolo e updateGdoProfile scriveva
 * qualunque campo arrivasse dal client, compresi saldi e ruolo (anti-imbroglio
 * della nuova economia).
 */
async function requireTeamEditor(userId: string) {
    const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
    if (!me || (me.role !== 'ADMIN' && me.role !== 'MANAGER')) throw new Error("Unauthorized")
}

export async function updateGdoProfile(userId: string, data: { displayName?: string, avatarUrl?: string, isActive?: boolean }) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await requireTeamEditor(ctx.userId)
    // Solo i campi previsti: il resto del payload si ignora.
    const patch: { displayName?: string, avatarUrl?: string, isActive?: boolean } = {}
    if (typeof data?.displayName === 'string') patch.displayName = data.displayName
    if (typeof data?.avatarUrl === 'string') patch.avatarUrl = data.avatarUrl
    if (typeof data?.isActive === 'boolean') patch.isActive = data.isActive
    if (Object.keys(patch).length === 0) return { success: true }
    await db.update(users)
        .set(patch)
        .where(and(eq(users.id, userId), eq(users.companyId, ctx.companyId)))


    return { success: true }
}

export async function updateGdoTargets(dailyApptTarget: number, weeklyConfirmedTarget: number, scope: 'ALL' | string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await requireTeamEditor(ctx.userId)
    if (scope === 'ALL') {
        await db.update(users)
            .set({ dailyApptTarget, weeklyConfirmedTarget })
            .where(and(eq(users.role, 'GDO'), eq(users.companyId, ctx.companyId)))

    } else {
        await db.update(users)
            .set({ dailyApptTarget, weeklyConfirmedTarget })
            .where(and(eq(users.id, scope), eq(users.companyId, ctx.companyId)))

    }
    return { success: true }
}

export async function updateConfermeTargets(confermeTargetTier1: number, confermeTargetTier2: number, confermeExtraTier1: number, confermeExtraTier2: number, scope: 'ALL' | string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await requireTeamEditor(ctx.userId)
    if (scope === 'ALL') {
        await db.update(users)
            .set({ confermeTargetTier1, confermeTargetTier2, confermeExtraTier1, confermeExtraTier2 })
            .where(and(eq(users.role, 'CONFERME'), eq(users.companyId, ctx.companyId)))
    } else {
        await db.update(users)
            .set({ confermeTargetTier1, confermeTargetTier2, confermeExtraTier1, confermeExtraTier2 })
            .where(and(eq(users.id, scope), eq(users.companyId, ctx.companyId)))
    }
    return { success: true }
}
