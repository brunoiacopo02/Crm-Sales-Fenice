"use server"

import { db } from "@/db"
import { internalAlerts, users } from "@/db/schema"
import { eq, and, lt, or, desc, isNull } from "drizzle-orm"
import crypto from "crypto"
import { createClient } from "@/utils/supabase/server"

// Cleanup function to clear old alerts
export async function cleanOldAlerts() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await db.delete(internalAlerts)
        .where(lt(internalAlerts.createdAt, yesterday));
}

export async function sendInternalAlert(receiverId: string | null, message: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Unauthorized" };

    // Before sending a new alert, let's trigger a cleanup of old alerts to maintain DB hygiene
    await cleanOldAlerts();

    await db.insert(internalAlerts).values({
        id: crypto.randomUUID(),
        senderId: user.id,
        receiverId: receiverId,
        message: message,
    });

    return { success: true };
}

export async function markAlertAsRead(alertId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Unauthorized" };

    await db.update(internalAlerts)
        .set({ isRead: true })
        .where(eq(internalAlerts.id, alertId));

    return { success: true };
}

export async function getMyUnreadAlerts() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Cleanup old alerts on fetch as a fallback
    await cleanOldAlerts();

    const alerts = await db.select({
        id: internalAlerts.id,
        message: internalAlerts.message,
        createdAt: internalAlerts.createdAt,
        senderId: internalAlerts.senderId,
        senderName: users.displayName,
        senderEmail: users.email
    })
        .from(internalAlerts)
        .leftJoin(users, eq(internalAlerts.senderId, users.id))
        .where(and(
            eq(internalAlerts.isRead, false),
            or(
                eq(internalAlerts.receiverId, user.id),
                isNull(internalAlerts.receiverId)
            )
        ))
        .orderBy(desc(internalAlerts.createdAt));

    return alerts;
}

export async function getMyBroadcastAlerts() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Cleanup old alerts on fetch as a fallback
    await cleanOldAlerts();

    const alerts = await db.select({
        id: internalAlerts.id,
        message: internalAlerts.message,
        createdAt: internalAlerts.createdAt,
        senderId: internalAlerts.senderId,
        senderName: users.displayName,
        senderEmail: users.email,
        receiverId: internalAlerts.receiverId
    })
        .from(internalAlerts)
        .leftJoin(users, eq(internalAlerts.senderId, users.id))
        .where(and(
            eq(internalAlerts.isRead, false),
            isNull(internalAlerts.receiverId)
        ))
        .orderBy(desc(internalAlerts.createdAt));

    return alerts;
}
