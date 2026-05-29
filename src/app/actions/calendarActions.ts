"use server"

import { getAuthUrl } from "@/lib/googleCalendar"
import { db } from "@/db"
import { calendarConnections } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

export async function getGoogleAuthUrl(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return getAuthUrl(userId)
}

export async function checkGoogleCalendarConnection(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const connection = await db.query.calendarConnections.findFirst({
        where: and(eq(calendarConnections.userId, userId), eq(calendarConnections.companyId, ctx.companyId))
    })

    return !!connection
}

export async function disconnectGoogleCalendar(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await db.delete(calendarConnections).where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.companyId, ctx.companyId)))
    return true
}
