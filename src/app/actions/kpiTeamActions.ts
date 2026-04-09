"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { gte, lte, eq, and } from "drizzle-orm"
import { startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from "date-fns"
export type KpiPeriod = 'oggi' | 'ieri' | 'settimana' | 'mese'

/** Verifica se un timestamp cade nell'orario lavorativo GDO 13:30-20:00 Europe/Rome */
function isWithinWorkingHours(date: Date): boolean {
    const romeTime = date.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })
    const [hStr, mStr] = romeTime.split(':')
    const h = parseInt(hStr)
    const m = parseInt(mStr)
    if (h === 13 && m >= 30) return true
    if (h >= 14 && h <= 19) return true
    if (h === 20 && m === 0) return true
    return false
}

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
    // Filtro orario lavorativo 13:30-20:00 Europe/Rome per conteggi chiamate
    const workingHoursLogs = logs.filter(l => isWithinWorkingHours(l.createdAt))
    const totalCalls = workingHoursLogs.length
    const answeredLogs = workingHoursLogs.filter(l => l.outcome !== 'NON_RISPOSTO')
    const totalAnswers = answeredLogs.length
    // Appuntamenti NON filtrati per orario (non hanno orario fisso)
    const totalAppointments = logs.filter(l => l.outcome === 'APPUNTAMENTO').length
    const totalRecalls = workingHoursLogs.filter(l => l.outcome === 'RICHIAMO').length

    // Chiamate / Ora: range fisso 13:30-20:00 = 6.5 ore lavorative
    const FIXED_HOURS_WORKED = 6.5
    const teamCallsPerHour = totalCalls > 0 ? Math.round(totalCalls / FIXED_HOURS_WORKED) : 0

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

        // Appuntamenti sempre conteggiati (non hanno orario fisso)
        if (log.outcome === 'APPUNTAMENTO') rank.appointments += 1

        // Chiamate/risposte solo in orario lavorativo 13:30-20:00
        if (isWithinWorkingHours(log.createdAt)) {
            rank.calls += 1
            if (log.outcome !== 'NON_RISPOSTO') rank.answers += 1

            const logTime = log.createdAt.getTime()
            if (logTime < rank.firstCallTime) rank.firstCallTime = logTime
            if (logTime > rank.lastCallTime) rank.lastCallTime = logTime
        }
    }

    // Trasformazione e calcoli percentuali per Ranking
    const ranking = Array.from(rankingMap.values()).map(r => {
        return {
            ...r,
            answerRate: r.calls > 0 ? Math.round((r.answers / r.calls) * 100) : 0,
            conversionRate: r.calls > 0 ? parseFloat(((r.appointments / r.calls) * 100).toFixed(1)) : 0,
            callsPerHour: r.calls > 0 ? Math.round(r.calls / FIXED_HOURS_WORKED) : 0
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
        // Grafico orario 13:30-20:00 (orario lavorativo Europe/Rome)
        trendMap.set('13:30', { chiamate: 0, appuntamenti: 0 })
        for (let i = 14; i <= 20; i++) {
            trendMap.set(`${i}:00`, { chiamate: 0, appuntamenti: 0 })
        }
        for (const log of logs) {
            const romeTime = log.createdAt.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })
            const [hStr, mStr] = romeTime.split(':')
            const h = parseInt(hStr)
            const m = parseInt(mStr)

            if (h === 13 && m >= 30) {
                const entry = trendMap.get('13:30')!
                entry.chiamate += 1
                if (log.outcome === 'APPUNTAMENTO') entry.appuntamenti += 1
            } else if (h >= 14 && h <= 20) {
                const label = `${h}:00`
                const entry = trendMap.get(label)
                if (entry) {
                    entry.chiamate += 1
                    if (log.outcome === 'APPUNTAMENTO') entry.appuntamenti += 1
                }
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
            // Filtro orario lavorativo anche nel trend giornaliero
            if (!isWithinWorkingHours(log.createdAt)) continue
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
