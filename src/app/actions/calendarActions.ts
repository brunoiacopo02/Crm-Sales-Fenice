"use server"

import { getAuthUrl } from "@/lib/googleCalendar"
import { db } from "@/db"
import { calendarConnections } from "@/db/schema"
import { eq } from "drizzle-orm"

export async function getGoogleAuthUrl(userId: string) {
    return getAuthUrl(userId)
}

export async function checkGoogleCalendarConnection(userId: string) {
    const connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId)
    })

    return !!connection
}

export async function disconnectGoogleCalendar(userId: string) {
    await db.delete(calendarConnections).where(eq(calendarConnections.userId, userId))
    return true
}
