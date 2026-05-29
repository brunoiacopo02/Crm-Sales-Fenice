"use server"

import { db } from "@/db"
import { notifications } from "@/db/schema"
import { and, eq, desc, inArray } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

export async function getUnreadNotifications(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return await db.select()
            .from(notifications)
            .where(and(eq(notifications.recipientUserId, userId), eq(notifications.companyId, ctx.companyId)))
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
            .where(and(inArray(notifications.id, notificationIds), eq(notifications.companyId, ctx.companyId)))


    return true
}

export async function markAllNotificationsAsRead(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await db.update(notifications)
            .set({
                status: 'read',
                readAt: new Date()
            })
            .where(and(eq(notifications.recipientUserId, userId), eq(notifications.companyId, ctx.companyId)))


    return true
}
