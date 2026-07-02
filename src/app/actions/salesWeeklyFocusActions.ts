"use server"

import { createClient } from "@/utils/supabase/server"
import { db } from "@/db"
import { salesWeeklyFocus, users } from "@/db/schema"
import { and, eq, or, sql } from "drizzle-orm"
import crypto from "crypto"
import { currentTenant, assertSalesArea, assertSingleCompany } from "@/lib/tenancy"
import { currentWeekStartRome } from "@/lib/workingDaysUtils"

export async function getSalesWeeklyFocus(salesUserId: string, weekStart?: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const wk = weekStart || currentWeekStartRome()
    const row = (await db.select({
        objection: salesWeeklyFocus.objection,
        taskNote: salesWeeklyFocus.taskNote,
        weekStart: salesWeeklyFocus.weekStart,
    }).from(salesWeeklyFocus).where(and(
        eq(salesWeeklyFocus.companyId, ctx.companyId),
        eq(salesWeeklyFocus.salesUserId, salesUserId),
        eq(salesWeeklyFocus.weekStart, wk),
    )))[0]
    return row ?? null
}

export async function setSalesWeeklyFocus(input: { salesUserId: string; weekStart: string; objection: string | null; taskNote: string }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role
    if (!user || !['MANAGER', 'ADMIN'].includes(role)) return { success: false, error: 'Unauthorized' }

    const ctx = await currentTenant()
    assertSalesArea(ctx)
    assertSingleCompany(ctx)

    const existing = (await db.select({ id: salesWeeklyFocus.id }).from(salesWeeklyFocus).where(and(
        eq(salesWeeklyFocus.companyId, ctx.companyId),
        eq(salesWeeklyFocus.salesUserId, input.salesUserId),
        eq(salesWeeklyFocus.weekStart, input.weekStart),
    )))[0]

    if (existing) {
        await db.update(salesWeeklyFocus).set({
            objection: input.objection || null,
            taskNote: input.taskNote || '',
            updatedAt: new Date(),
        }).where(eq(salesWeeklyFocus.id, existing.id))
    } else {
        await db.insert(salesWeeklyFocus).values({
            id: crypto.randomUUID(),
            salesUserId: input.salesUserId,
            weekStart: input.weekStart,
            objection: input.objection || null,
            taskNote: input.taskNote || '',
            createdBy: user.id,
            companyId: ctx.companyId,
        })
    }
    return { success: true }
}

export async function listVenditori() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const rows = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users).where(and(
            or(
                sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
                and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
            ),
            eq(users.role, 'VENDITORE'),
            eq(users.isActive, true),
        ))
    return rows.map(r => ({ id: r.id, name: r.displayName || r.name || '' })).sort((a, b) => a.name.localeCompare(b.name, 'it'))
}
