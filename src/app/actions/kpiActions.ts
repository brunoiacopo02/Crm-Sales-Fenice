"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { callLogs, leads } from "@/db/schema"
import { eq, gte, lte, and, sql } from "drizzle-orm"
export type KpiData = {
    totalCalls: number
    totalAnswers: number
    totalAppointments: number
    totalRejected: number
    conversionRate: string
    hoursWorked: string
}

export async function getDailyKpi(dateStr?: string): Promise<KpiData> {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    // Use provided date or today
    const targetDate = dateStr ? new Date(dateStr) : new Date()

    // Create start and end of the day bounds
    const startOfDay = new Date(targetDate)
    startOfDay.setHours(0, 0, 0, 0)

    const endOfDay = new Date(targetDate)
    endOfDay.setHours(23, 59, 59, 999)

    const conditions = [
        gte(callLogs.createdAt, startOfDay),
        lte(callLogs.createdAt, endOfDay)
    ]

    if (isGdo) conditions.push(eq(callLogs.userId, userId))

    // Fetch all logs for the given day
    const logs = await db.select()
            .from(callLogs)
            .where(and(...conditions))
            .orderBy(callLogs.createdAt)
        

    const totalCalls = logs.length

    // "Answers" -> Usually considering RICHIAMO and APPUNTAMENTO, sometimes DA_SCARTARE if they answered to say "not interested".
    // Let's assume NON_RISPOSTO is the only true "No Answer".
    const answers = logs.filter(l => l.outcome !== 'NON_RISPOSTO')
    const totalAnswers = answers.length

    const appointments = logs.filter(l => l.outcome === 'APPUNTAMENTO').length
    const rejected = logs.filter(l => l.outcome === 'DA_SCARTARE').length

    const conversionRate = totalCalls > 0
        ? ((appointments / totalCalls) * 100).toFixed(1) + '%'
        : '0%'

    // Approximate hours worked = Time diff between first and last call of the day
    let hoursWorked = "0h 0m"
    if (logs.length > 1) {
        const firstCallTime = logs[0].createdAt.getTime()
        const lastCallTime = logs[logs.length - 1].createdAt.getTime()
        const diffMs = lastCallTime - firstCallTime

        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

        hoursWorked = `${diffHrs}h ${diffMins}m`
    } else if (logs.length === 1) {
        hoursWorked = "< 1m" // just one call made
    }

    return {
        totalCalls,
        totalAnswers,
        totalAppointments: appointments,
        totalRejected: rejected,
        conversionRate,
        hoursWorked
    }
}
