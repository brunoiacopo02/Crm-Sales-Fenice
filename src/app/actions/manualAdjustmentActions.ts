'use server';

import { db } from "@/db";
import { manualAdjustments, users } from "@/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import crypto from "crypto";
import { currentTenant, assertSalesArea } from "@/lib/tenancy";

export async function addManualAdjustment(targetUserId: string, type: 'presenze' | 'chiusure' | 'fatturato', count: number, note?: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    if (!supabaseUser) throw new Error("Unauthorized");

    const adminUser = await db.select({ role: users.role }).from(users).where(and(eq(users.companyId, ctx.companyId), eq(users.id, supabaseUser.id)));
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
        companyId: ctx.companyId,
    });

    return { success: true };
}

export async function getManualAdjustments(weekStart: Date, weekEnd: Date) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
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
        eq(manualAdjustments.companyId, ctx.companyId),
        gte(manualAdjustments.createdAt, weekStart),
        lte(manualAdjustments.createdAt, weekEnd)
    ))
    .orderBy(desc(manualAdjustments.createdAt));

    return results;
}

export async function getGdoAndConfermeUsers() {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const result = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        role: users.role,
        gdoCode: users.gdoCode,
    }).from(users).where(and(eq(users.companyId, ctx.companyId), eq(users.isActive, true)));

    return result.filter(u => u.role === 'GDO' || u.role === 'CONFERME' || u.role === 'VENDITORE');
}
