'use server';

import { db } from "@/db";
import { manualAdjustments, users } from "@/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import crypto from "crypto";

export async function addManualAdjustment(targetUserId: string, type: 'presenze' | 'chiusure', count: number, note?: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    if (!supabaseUser) throw new Error("Unauthorized");

    const adminUser = await db.select({ role: users.role }).from(users).where(eq(users.id, supabaseUser.id));
    if (!adminUser[0] || (adminUser[0].role !== 'ADMIN' && adminUser[0].role !== 'MANAGER')) {
        throw new Error("Solo Admin/Manager possono aggiungere aggiustamenti manuali");
    }

    await db.insert(manualAdjustments).values({
        id: crypto.randomUUID(),
        userId: targetUserId,
        type,
        count,
        note: note || null,
        addedByUserId: supabaseUser.id,
    });

    return { success: true };
}

export async function getManualAdjustments(weekStart: Date, weekEnd: Date) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    if (!supabaseUser) throw new Error("Unauthorized");

    const results = await db.select({
        adjustment: manualAdjustments,
        user: { name: users.name, displayName: users.displayName, role: users.role, gdoCode: users.gdoCode },
    })
    .from(manualAdjustments)
    .leftJoin(users, eq(manualAdjustments.userId, users.id))
    .where(and(
        gte(manualAdjustments.createdAt, weekStart),
        lte(manualAdjustments.createdAt, weekEnd)
    ))
    .orderBy(desc(manualAdjustments.createdAt));

    return results;
}

export async function getGdoAndConfermeUsers() {
    const result = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        role: users.role,
        gdoCode: users.gdoCode,
    }).from(users).where(eq(users.isActive, true));

    return result.filter(u => u.role === 'GDO' || u.role === 'CONFERME');
}
