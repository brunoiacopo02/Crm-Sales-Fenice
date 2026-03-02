"use server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { gte, lte, and, eq, desc } from "drizzle-orm"

import { cache } from "react"

export type KpiFilters = {
    startDate: Date | string
    endDate: Date | string
    funnel?: string
    gdoId?: string
}

export const getAdvancedKpi = cache(async (filters: KpiFilters) => {
    // We fetch everything and process in JS for maximum flexibility given SQLite limits on complex joins
    // Or we can use Drizzle. Given the scale, fetching filtered leads and logs is fine.

    let leadsQuery = db.select({
        id: leads.id,
        funnel: leads.funnel,
        status: leads.status,
        callCount: leads.callCount,
        createdAt: leads.createdAt,
        discardReason: leads.discardReason,
        assignedToId: leads.assignedToId,
        recallDate: leads.recallDate,
        appointmentDate: leads.appointmentDate,
    }).from(leads)

    // Apply lead-level filters
    const leadConditions = []
    if (filters.funnel) leadConditions.push(eq(leads.funnel, filters.funnel))
    if (filters.gdoId) leadConditions.push(eq(leads.assignedToId, filters.gdoId))

    // We consider a lead "in target" if created in the date range, or having activity in the date range.
    // For simplicity, let's just fetch all leads and filter their LOGS by date range,
    // OR filter leads created within the period for the import stats.

    let allLeads = await (leadConditions.length > 0 ? leadsQuery.where(and(...leadConditions)) : leadsQuery)

    // Sicurezza Type: converti stringhe ISO in oggetti Date, dato che Next.js 
    // serializza in JSON senza conservare i prototipi passando ai Server Action.
    const safeStartDate = new Date(filters.startDate)
    const safeEndDate = new Date(filters.endDate)

    // Now fetch logs within the date range
    let logConditions = [
        gte(callLogs.createdAt, safeStartDate),
        lte(callLogs.createdAt, safeEndDate)
    ]
    if (filters.gdoId) logConditions.push(eq(callLogs.userId, filters.gdoId))

    const rawLogs = await db.select().from(callLogs).where(and(...logConditions))

    // Filter logs to match only leads in `allLeads` (in case funnel filter was applied)
    const validLeadIds = new Set(allLeads.map(l => l.id))
    const validLogs = rawLogs.filter(log => validLeadIds.has(log.leadId))

    // 1. Funnel Conversione
    const leadIdsWithLogs = new Set(validLogs.map(l => l.leadId))
    const calledLeadsCount = leadIdsWithLogs.size

    const answeredLogs = validLogs.filter(l => l.outcome !== 'NON_RISPOSTO')
    const answeredLeadIds = new Set(answeredLogs.map(l => l.leadId))
    const answeredLeadsCount = answeredLeadIds.size

    const appointmentLogs = validLogs.filter(l => l.outcome === 'APPUNTAMENTO')
    const appointmentLeadIds = new Set(appointmentLogs.map(l => l.leadId))
    const appointmentsSet = appointmentLeadIds.size

    // 2. Motivi Scarto (Qualità Lead)
    const discardLogs = validLogs.filter(l => l.outcome === 'DA_SCARTARE' && l.discardReason)
    const discardReasonsTracker: Record<string, number> = {}
    discardLogs.forEach(log => {
        if (log.discardReason) {
            discardReasonsTracker[log.discardReason] = (discardReasonsTracker[log.discardReason] || 0) + 1
        }
    })
    const discardReasonsChart = Object.entries(discardReasonsTracker).map(([name, count]) => ({
        name,
        count
    })).sort((a, b) => b.count - a.count)

    // 3. Perché non si prendono Appuntamenti
    const totalCalls = validLogs.length
    const nonRispostoCount = validLogs.filter(l => l.outcome === 'NON_RISPOSTO').length
    const nonRispostoPerc = totalCalls > 0 ? Math.round((nonRispostoCount / totalCalls) * 100) : 0

    // Richiami non convertiti
    const recallLogs = validLogs.filter(l => l.outcome === 'RICHIAMO')
    let unconvertedRecalls = 0
    recallLogs.forEach(recall => {
        // Did this lead get an appointment AFTER this recall?
        const hasApptAfter = validLogs.some(l => l.leadId === recall.leadId && l.outcome === 'APPUNTAMENTO' && l.createdAt > recall.createdAt)
        if (!hasApptAfter) unconvertedRecalls++
    })
    const recallUnconvertedPerc = recallLogs.length > 0 ? Math.round((unconvertedRecalls / recallLogs.length) * 100) : 0

    // 4. Performance GDO
    const gdoStatsMap: Record<string, any> = {}

    const allUsers = await db.select().from(users)
    const userMap = new Map(allUsers.map(u => [u.id, u.name]))

    validLogs.forEach(log => {
        const uid = log.userId || 'Tracciato Vecchio / Sconosciuto'
        const uname = userMap.get(uid) || uid
        if (!gdoStatsMap[uname]) {
            gdoStatsMap[uname] = { name: uname, calls: 0, answers: 0, appointments: 0, totalContacted: new Set(), firstCallTimes: [] }
        }

        const st = gdoStatsMap[uname]
        st.calls++
        st.totalContacted.add(log.leadId)
        if (log.outcome !== 'NON_RISPOSTO') st.answers++
        if (log.outcome === 'APPUNTAMENTO') st.appointments++
    })

    const gdoStats = Object.values(gdoStatsMap).map(st => {
        const responseRate = st.calls > 0 ? Math.round((st.answers / st.calls) * 100) : 0
        const apptRate = st.totalContacted.size > 0 ? Math.round((st.appointments / st.totalContacted.size) * 100) : 0

        return {
            name: st.name,
            calls: st.calls,
            answers: st.answers,
            responseRate,
            appointments: st.appointments,
            apptRate
        }
    }).sort((a, b) => b.appointments - a.appointments)

    // Funnel list
    const funnelList = Array.from(new Set(allLeads.map(l => l.funnel!).filter(Boolean)))
    // GDO List
    const gdoList = allUsers.filter(u => u.role === 'GDO' || u.role === 'MANAGER').map(u => ({ id: u.id, name: u.name }))

    return {
        funnelConversion: {
            imported: allLeads.length, // approximation based on current DB without deleting matching funnel
            called: calledLeadsCount,
            answered: answeredLeadsCount,
            appointments: appointmentsSet,
            conversionRate: calledLeadsCount > 0 ? Math.round((appointmentsSet / calledLeadsCount) * 100) : 0
        },
        discardReasonsChart,
        bottlenecks: {
            totalCalls,
            nonRispostoPerc,
            totalRecalls: recallLogs.length,
            recallUnconvertedPerc
        },
        gdoStats,
        filtersData: {
            funnels: funnelList,
            gdos: gdoList
        }
    }
})

export const getGdoTargetsProgress = async (gdoId: string) => {
    // Fetch targets from user
    const user = (await db.select({
        dailyApptTarget: users.dailyApptTarget,
        weeklyConfirmedTarget: users.weeklyConfirmedTarget
    }).from(users).where(eq(users.id, gdoId)))[0]

    if (!user) return null

    // Compute range for Today
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)

    // Compute range for This Week (Monday to Sunday)
    const now = new Date()
    const day = now.getDay()
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
    const weekStart = new Date(now)
    weekStart.setDate(diffToMonday)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)

    // Appuntamenti Odierni
    const todayAppointmentsCount = (await db.select({ id: callLogs.id })
        .from(callLogs)
        .where(and(
            eq(callLogs.userId, gdoId),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            gte(callLogs.createdAt, todayStart),
            lte(callLogs.createdAt, todayEnd)
        ))).length

    // Conferme Settimanali
    const weeklyConfirmedCount = (await db.select({ id: leads.id })
        .from(leads)
        .where(and(
            eq(leads.assignedToId, gdoId),
            eq(leads.confirmationsOutcome, 'confermato'),
            gte(leads.confirmationsTimestamp, weekStart),
            lte(leads.confirmationsTimestamp, weekEnd)
        ))).length

    const res = {
        dailyApptTarget: user.dailyApptTarget,
        todayAppointments: todayAppointmentsCount,
        weeklyConfirmedTarget: user.weeklyConfirmedTarget,
        weeklyConfirmed: weeklyConfirmedCount
    }
    console.log(`[getGdoTargetsProgress] GDO: ${gdoId} - Range: ${weekStart.toISOString()} to ${weekEnd.toISOString()} - WeeklyConfirmed: ${weeklyConfirmedCount}`)

    return res
}
