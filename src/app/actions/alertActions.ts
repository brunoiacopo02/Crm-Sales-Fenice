"use server"

import { db } from "@/db"
import { internalAlerts, users } from "@/db/schema"
import { eq, and, lt, or, desc, isNull } from "drizzle-orm"
import crypto from "crypto"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

// Cleanup function to clear old alerts (tenant-scoped)
export async function cleanOldAlerts() {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await db.delete(internalAlerts)
        .where(and(eq(internalAlerts.companyId, ctx.companyId), lt(internalAlerts.createdAt, yesterday)));
}

export async function sendInternalAlert(receiverId: string | null, message: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
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
        companyId: ctx.companyId,
    });

    return { success: true };
}

export async function markAlertAsRead(alertId: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Unauthorized" };

    await db.update(internalAlerts)
        .set({ isRead: true })
        .where(and(eq(internalAlerts.id, alertId), eq(internalAlerts.companyId, ctx.companyId)));

    return { success: true };
}

export async function getMyUnreadAlerts() {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
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
            eq(internalAlerts.companyId, ctx.companyId),
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
    const ctx = await currentTenant();
    assertSalesArea(ctx);
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
            eq(internalAlerts.companyId, ctx.companyId),
            eq(internalAlerts.isRead, false),
            isNull(internalAlerts.receiverId)
        ))
        .orderBy(desc(internalAlerts.createdAt));

    return alerts;
}
