"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { sql, gte, lte, eq, and, desc } from "drizzle-orm"
import { startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from "date-fns"
export type KpiPeriod = 'oggi' | 'ieri' | 'settimana' | 'mese'

export async function getTeamKpiDashboard(period: KpiPeriod, funnelFilter?: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== 'MANAGER' && session.user.role !== 'ADMIN')) {
        throw new Error("Accesso negato. Solo Manager e Admin possono visualizzare i KPI aggregati.")
    }

    const now = new Date()
    let startDate: Date
    let endDate: Date

    if (period === 'oggi') {
        startDate = startOfDay(now)
        endDate = endOfDay(now)
    } else if (period === 'ieri') {
        startDate = startOfDay(subDays(now, 1))
        endDate = endOfDay(subDays(now, 1))
    } else if (period === 'settimana') {
        startDate = startOfWeek(now, { weekStartsOn: 1 })
        endDate = endOfWeek(now, { weekStartsOn: 1 })
    } else {
        startDate = startOfMonth(now)
        endDate = endOfMonth(now)
    }

    // Costruzione query con join per permettere filtro Funnel sul Lead di origine
    const baseConditions = [
        gte(callLogs.createdAt, startDate),
        lte(callLogs.createdAt, endDate)
    ]

    let logsQuery = await db.select({
            id: callLogs.id,
            outcome: callLogs.outcome,
            userId: callLogs.userId,
            createdAt: callLogs.createdAt,
            leadFunnel: leads.funnel
        })
            .from(callLogs)
            .leftJoin(leads, eq(callLogs.leadId, leads.id))
            .where(and(...baseConditions))

    let logs = await logsQuery

    if (funnelFilter && funnelFilter !== 'ALL') {
        logs = logs.filter(l => l.leadFunnel === funnelFilter)
    }

    // Recupero Mappatura Utenti
    const allUsers = await db.select().from(users).where(eq(users.role, 'GDO'))
    const userMap = new Map(allUsers.map(u => [u.id, u]))

    // 1. CALCOLO AGGREGATI TOTALI TEAM
    const totalCalls = logs.length
    const answeredLogs = logs.filter(l => l.outcome !== 'NON_RISPOSTO')
    const totalAnswers = answeredLogs.length
    const totalAppointments = logs.filter(l => l.outcome === 'APPUNTAMENTO').length
    const totalRecalls = logs.filter(l => l.outcome === 'RICHIAMO').length // Solo a fini statistici se serve

    // Chiamate / Ora stimate (Team)
    let teamHoursWorked = 0
    // Simplified hour calculation: just max - min across the entire team logs. Not perfectly accurate but gives a baseline.
    if (logs.length > 2) {
        logs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        const firstLog = logs[0].createdAt.getTime()
        const lastLog = logs[logs.length - 1].createdAt.getTime()
        teamHoursWorked = (lastLog - firstLog) / (1000 * 60 * 60)
    }
    const teamCallsPerHour = teamHoursWorked > 0 ? Math.round(totalCalls / teamHoursWorked) : totalCalls

    const teamAnswerRate = totalCalls > 0 ? Math.round((totalAnswers / totalCalls) * 100) : 0
    const teamConversionRate = totalCalls > 0 ? parseFloat(((totalAppointments / totalCalls) * 100).toFixed(1)) : 0

    // 2. CALCOLO RANKING GDO
    const rankingMap = new Map<string, any>()
    for (const u of allUsers) {
        rankingMap.set(u.id, {
            userId: u.id,
            gdoCode: u.gdoCode,
            displayName: u.displayName || u.name || `GDO ${u.gdoCode}`,
            avatarUrl: u.avatarUrl,
            calls: 0,
            answers: 0,
            appointments: 0,
            firstCallTime: Infinity,
            lastCallTime: 0
        })
    }

    for (const log of logs) {
        if (!log.userId) continue
        const rank = rankingMap.get(log.userId)
        if (!rank) continue

        rank.calls += 1
        if (log.outcome !== 'NON_RISPOSTO') rank.answers += 1
        if (log.outcome === 'APPUNTAMENTO') rank.appointments += 1

        const logTime = log.createdAt.getTime()
        if (logTime < rank.firstCallTime) rank.firstCallTime = logTime
        if (logTime > rank.lastCallTime) rank.lastCallTime = logTime
    }

    // Trasformazione e calcoli percentuali per Ranking
    const ranking = Array.from(rankingMap.values()).map(r => {
        let hrs = 0
        if (r.firstCallTime !== Infinity && r.lastCallTime !== 0 && r.lastCallTime > r.firstCallTime) {
            hrs = (r.lastCallTime - r.firstCallTime) / (1000 * 60 * 60)
        }
        return {
            ...r,
            answerRate: r.calls > 0 ? Math.round((r.answers / r.calls) * 100) : 0,
            conversionRate: r.calls > 0 ? parseFloat(((r.appointments / r.calls) * 100).toFixed(1)) : 0,
            callsPerHour: hrs > 0 ? Math.round(r.calls / hrs) : r.calls
        }
    })

    // Ordine di default: chi ha più appuntamenti vince. Tie-breaker: conversionRate, poi chiamate totali.
    ranking.sort((a, b) => {
        if (b.appointments !== a.appointments) return b.appointments - a.appointments
        if (b.conversionRate !== a.conversionRate) return b.conversionRate - a.conversionRate
        return b.calls - a.calls
    })

    // 3. GENERAZIONE DATI PER GRAFICO TREND (Timeline)
    const trendMap = new Map<string, { chiamate: number, appuntamenti: number }>()

    // Inizializza asse X in base al periodo
    if (period === 'oggi' || period === 'ieri') {
        // Grafico orario dalle 08:00 alle 20:00
        for (let i = 8; i <= 20; i++) {
            trendMap.set(`${i}:00`, { chiamate: 0, appuntamenti: 0 })
        }
        for (const log of logs) {
            const h = log.createdAt.getHours()
            if (h >= 8 && h <= 20) {
                const label = `${h}:00`
                const entry = trendMap.get(label)!
                entry.chiamate += 1
                if (log.outcome === 'APPUNTAMENTO') entry.appuntamenti += 1
            }
        }
    } else {
        // Grafico giornaliero
        let cursor = new Date(startDate)
        while (cursor <= endDate) {
            const label = format(cursor, 'EEE dd/MM') // es. "Mon 02/09"
            trendMap.set(label, { chiamate: 0, appuntamenti: 0 })
            cursor.setDate(cursor.getDate() + 1)
        }
        for (const log of logs) {
            const label = format(log.createdAt, 'EEE dd/MM')
            if (trendMap.has(label)) {
                const entry = trendMap.get(label)!
                entry.chiamate += 1
                if (log.outcome === 'APPUNTAMENTO') entry.appuntamenti += 1
            }
        }
    }

    const chartData = Array.from(trendMap.entries()).map(([timeLabel, data]) => ({
        timeLabel,
        ...data
    }))

    return {
        aggregate: {
            totalCalls,
            totalAnswers,
            teamAnswerRate,
            totalAppointments,
            teamConversionRate,
            teamCallsPerHour
        },
        ranking,
        chartData
    }
}
