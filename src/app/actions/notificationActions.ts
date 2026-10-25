"use server"

import { db } from "@/db"
import { notifications } from "@/db/schema"
import { and, eq, desc, inArray } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

// Le notifiche sono di chi è in sessione: l'id che arriva dal browser non
// conta (prima bastava passare l'id di un collega per leggere le sue, anche
// da un account di prova). Il parametro resta per i chiamanti esistenti.
export async function getUnreadNotifications(_userId?: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return await db.select()
            .from(notifications)
            .where(and(eq(notifications.recipientUserId, ctx.userId), eq(notifications.companyId, ctx.companyId)))
            .orderBy(desc(notifications.createdAt))
            .limit(20)

}

export async function markNotificationsAsRead(notificationIds: string[]) {
    if (notificationIds.length === 0) return
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    await db.update(notifications)
            .set({
                status: 'read',
                readAt: new Date()
            })
            // Solo le non lette: evita di riscrivere righe già 'read' (write-IO sprecato).
            // Solo le proprie: gli id arrivano dal browser.
            .where(and(inArray(notifications.id, notificationIds), eq(notifications.recipientUserId, ctx.userId), eq(notifications.companyId, ctx.companyId), eq(notifications.status, 'unread')))


    return true
}

export async function markAllNotificationsAsRead(_userId?: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await db.update(notifications)
            .set({
                status: 'read',
                readAt: new Date()
            })
            // Solo le non lette: "segna tutte come lette" non deve riscrivere l'intero storico
            .where(and(eq(notifications.recipientUserId, ctx.userId), eq(notifications.companyId, ctx.companyId), eq(notifications.status, 'unread')))


    return true
}
