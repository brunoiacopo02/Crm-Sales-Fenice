"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { gte, lt, eq, and, isNotNull, sql } from "drizzle-orm"
import { format } from "date-fns"
import { dayBoundsRome, weekBoundsRome, monthBoundsRome } from "@/lib/dateUtils"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { currentTenant, assertSalesArea } from '@/lib/tenancy';
import { isRealGdo, apptSetAt } from '@/lib/kpi/canon';
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
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== 'MANAGER' && session.user.role !== 'ADMIN')) {
        throw new Error("Accesso negato. Solo Manager e Admin possono visualizzare i KPI aggregati.")
    }

    // Bounds Europe/Rome espliciti (Sprint 2.3) — pattern gte(start) AND lt(end).
    const now = new Date()
    let startDate: Date
    let endDate: Date

    if (period === 'oggi') {
        const b = dayBoundsRome(now)
        startDate = b.start; endDate = b.end
    } else if (period === 'ieri') {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        const b = dayBoundsRome(yesterday)
        startDate = b.start; endDate = b.end
    } else if (period === 'settimana') {
        const b = weekBoundsRome(now)
        startDate = b.start; endDate = b.end
    } else {
        const b = monthBoundsRome(currentYearMonthRome(now))
        startDate = b.start; endDate = b.end
    }

    // Costruzione query con join per permettere filtro Funnel sul Lead di origine
    const baseConditions = [
        eq(callLogs.companyId, ctx.companyId),
        gte(callLogs.createdAt, startDate),
        lt(callLogs.createdAt, endDate)
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

    // Recupero Mappatura Utenti — esclude il bot fissatore dal ranking/aggregati team
    const allUsersRaw = await db.select().from(users).where(and(eq(users.role, 'GDO'), eq(users.companyId, ctx.companyId)))
    const allUsers = allUsersRaw.filter(isRealGdo)
    const userMap = new Map(allUsers.map(u => [u.id, u]))
    const realGdoIds = new Set(allUsers.map(u => u.id))
    // Solo bot fissatore (isBot=true), a differenza di realGdoIds che esclude
    // anche i GDO disattivati. Usato per l'attribuzione degli appuntamenti da
    // lead (fix F5): la storia di un GDO dimesso a metà mese resta contata,
    // solo la produzione del bot va fuori — altrimenti kpi-gdo (che dopo il
    // fix F1 esclude solo il bot) e kpi-team divergerebbero sui totali.
    const botIds = new Set(allUsersRaw.filter(u => u.isBot).map(u => u.id))
    // Le chiamate del bot fissatore non entrano negli aggregati/ranking team
    // (decisione PO 2026-07-05); i log senza userId restano (tracciato legacy).
    logs = logs.filter(l => !l.userId || realGdoIds.has(l.userId))

    // App Fissati: base canonica PO 2026-07-05 — data di fissaggio (apptSetAt =
    // appointmentCreatedAt ?? appointmentDate), gate appointmentDate IS NOT NULL,
    // dedup per lead (1 riga = 1 lead). Sostituisce il vecchio conteggio da
    // callLogs.outcome='APPUNTAMENTO' (righe, poteva contare 2 volte lo stesso
    // lead per richiamo+conferma). Il bot fissatore resta escluso dagli
    // aggregati/ranking team (coerente col filtro sui log sopra); i GDO
    // disattivati restano invece contati (vedi botIds sopra).
    const apptLeadsRaw = await db.select({
            id: leads.id,
            assignedToId: leads.assignedToId,
            funnel: leads.funnel,
            appointmentDate: leads.appointmentDate,
            appointmentCreatedAt: leads.appointmentCreatedAt,
        })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.appointmentDate),
            sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) >= ${startDate}`,
            sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) < ${endDate}`,
        ))
    let apptLeadsFiltered = apptLeadsRaw.filter(l => !l.assignedToId || !botIds.has(l.assignedToId))
    if (funnelFilter && funnelFilter !== 'ALL') {
        apptLeadsFiltered = apptLeadsFiltered.filter(l => l.funnel === funnelFilter)
    }
    const apptLeads = apptLeadsFiltered.map(l => ({ ...l, apptAt: apptSetAt(l)! }))

    // 1. CALCOLO AGGREGATI TOTALI TEAM
    // Filtro orario lavorativo 13:30-20:00 Europe/Rome per conteggi chiamate
    const workingHoursLogs = logs.filter(l => isWithinWorkingHours(l.createdAt))
    const totalCalls = workingHoursLogs.length
    const answeredLogs = workingHoursLogs.filter(l => l.outcome !== 'NON_RISPOSTO')
    const totalAnswers = answeredLogs.length
    // Appuntamenti = App Fissati dal lead (apptLeads sopra), non più righe log
    const totalAppointments = apptLeads.length
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

        // Chiamate/risposte solo in orario lavorativo 13:30-20:00
        if (isWithinWorkingHours(log.createdAt)) {
            rank.calls += 1
            if (log.outcome !== 'NON_RISPOSTO') rank.answers += 1

            const logTime = log.createdAt.getTime()
            if (logTime < rank.firstCallTime) rank.firstCallTime = logTime
            if (logTime > rank.lastCallTime) rank.lastCallTime = logTime
        }
    }
    // Appuntamenti per GDO: dal lead (apptLeads sopra, attribuzione via
    // leads.assignedToId), non più dal log — dedup naturale (1 riga = 1 lead).
    for (const l of apptLeads) {
        if (!l.assignedToId) continue
        const rank = rankingMap.get(l.assignedToId)
        if (rank) rank.appointments += 1
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
                trendMap.get('13:30')!.chiamate += 1
            } else if (h >= 14 && h <= 20) {
                const entry = trendMap.get(`${h}:00`)
                if (entry) entry.chiamate += 1
            }
        }
        // Appuntamenti (App Fissati) bucketizzati sulla propria data di
        // fissaggio (apptAt), non sull'orario del log della chiamata.
        for (const l of apptLeads) {
            const romeTime = l.apptAt.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })
            const [hStr, mStr] = romeTime.split(':')
            const h = parseInt(hStr)
            const m = parseInt(mStr)

            if (h === 13 && m >= 30) {
                trendMap.get('13:30')!.appuntamenti += 1
            } else if (h >= 14 && h <= 20) {
                const entry = trendMap.get(`${h}:00`)
                if (entry) entry.appuntamenti += 1
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
                trendMap.get(label)!.chiamate += 1
            }
        }
        // Appuntamenti (App Fissati) bucketizzati sulla propria data di
        // fissaggio (apptAt), non sull'orario del log della chiamata.
        for (const l of apptLeads) {
            const label = format(l.apptAt, 'EEE dd/MM')
            if (trendMap.has(label)) {
                trendMap.get(label)!.appuntamenti += 1
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
