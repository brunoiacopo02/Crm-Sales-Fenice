"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { appointmentPresence, users } from "@/db/schema"
import { eq, and, gt, ne } from "drizzle-orm"
import crypto from "crypto"

// Threshold in milliseconds for a heartbeat to be considered valid (e.g., 20 seconds)
const HEARTBEAT_TIMEOUT_MS = 20 * 1000

export async function setPresence(leadId: string, status: string = "viewing") {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) return { success: false }

    const userId = session.user.id
    const now = new Date()

    // Check if user already has presence for this lead
    const existing = (await db.select().from(appointmentPresence)
        .where(and(
            eq(appointmentPresence.leadId, leadId),
            eq(appointmentPresence.userId, userId)
        )))[0]

    if (existing) {
        // Update heartbeat and status
        await db.update(appointmentPresence).set({
            status,
            lastHeartbeatAt: now,
        }).where(eq(appointmentPresence.id, existing.id))
    } else {
        // Create new presence
        await db.insert(appointmentPresence).values({
            id: crypto.randomUUID(),
            leadId,
            userId,
            status,
            startedAt: now,
            lastHeartbeatAt: now,
        })
    }

    return { success: true }
}

export async function removePresence(leadId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) return { success: false }

    const userId = session.user.id

    await db.delete(appointmentPresence)
        .where(and(
            eq(appointmentPresence.leadId, leadId),
            eq(appointmentPresence.userId, userId)
        ))

    return { success: true }
}

export async function getLeadPresence(leadId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) return []

    const validTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS)

    return await db.select({
        user: {
            id: users.id,
            name: users.name,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl
        },
        presence: {
            status: appointmentPresence.status,
            startedAt: appointmentPresence.startedAt,
            lastHeartbeatAt: appointmentPresence.lastHeartbeatAt
        }
    }).from(appointmentPresence)
        .innerJoin(users, eq(appointmentPresence.userId, users.id))
        .where(and(
            eq(appointmentPresence.leadId, leadId),
            gt(appointmentPresence.lastHeartbeatAt, validTime),
            ne(appointmentPresence.userId, session.user.id) // Escludiamo noi stessi
        ))

}

export async function getGlobalPresence() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) return []

    const validTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS)

    return await db.select({
        leadId: appointmentPresence.leadId,
        user: {
            id: users.id,
            name: users.name,
            displayName: users.displayName,
        }
    }).from(appointmentPresence)
        .innerJoin(users, eq(appointmentPresence.userId, users.id))
        .where(and(
            gt(appointmentPresence.lastHeartbeatAt, validTime),
            ne(appointmentPresence.userId, session.user.id)
        ))

}
