"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { callLogs, leads } from "@/db/schema"
import { eq, gte, lt, and, sql, isNotNull } from "drizzle-orm"
import { currentTenant, assertSalesArea } from '@/lib/tenancy';
import { dayBoundsRome } from '@/lib/dateUtils';
export type KpiData = {
    totalCalls: number
    totalAnswers: number
    totalAppointments: number
    totalRejected: number
    conversionRate: string
    hoursWorked: string
}

export async function getDailyKpi(dateStr?: string): Promise<KpiData> {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    // Use provided date or today
    const targetDate = dateStr ? new Date(dateStr) : new Date()

    // Bounds del giorno in Europe/Rome (evita lo sfasamento UTC del server Vercel).
    const { start: startOfDay, end: endOfDay } = dayBoundsRome(targetDate)

    const conditions = [
        eq(callLogs.companyId, ctx.companyId),
        gte(callLogs.createdAt, startOfDay),
        lt(callLogs.createdAt, endOfDay)
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

    // App Fissati: base canonica PO 2026-07-05 — data di fissaggio
    // (COALESCE(appointmentCreatedAt, appointmentDate)), gate appointmentDate
    // IS NOT NULL, dedup naturale (1 riga lead = 1 appuntamento). Sostituisce
    // il vecchio conteggio da callLogs.outcome='APPUNTAMENTO' (righe, non lead).
    const appointmentConditions = [
        eq(leads.companyId, ctx.companyId),
        isNotNull(leads.appointmentDate),
        sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) >= ${startOfDay}`,
        sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) < ${endOfDay}`,
    ]
    if (isGdo) appointmentConditions.push(eq(leads.assignedToId, userId))
    const appointmentLeads = await db.select({ id: leads.id })
        .from(leads)
        .where(and(...appointmentConditions))
    const appointments = appointmentLeads.length
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
