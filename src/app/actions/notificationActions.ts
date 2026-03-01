"use server"

import { db } from "@/db"
import { notifications } from "@/db/schema"
import { eq, desc, inArray } from "drizzle-orm"

export async function getUnreadNotifications(userId: string) {
    return await db.select()
            .from(notifications)
            .where(eq(notifications.recipientUserId, userId))
            .orderBy(desc(notifications.createdAt))
            .limit(20)
        
}

export async function markNotificationsAsRead(notificationIds: string[]) {
    if (notificationIds.length === 0) return

    await db.update(notifications)
            .set({
                status: 'read',
                readAt: new Date()
            })
            .where(inArray(notifications.id, notificationIds))
        

    return true
}

export async function markAllNotificationsAsRead(userId: string) {
    await db.update(notifications)
            .set({
                status: 'read',
                readAt: new Date()
            })
            .where(eq(notifications.recipientUserId, userId))
        

    return true
}
