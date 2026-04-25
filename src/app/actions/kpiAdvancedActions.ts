"use server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { gte, lte, and, eq, desc } from "drizzle-orm"
import { format } from "date-fns"

import { cache } from "react"

export type KpiFilters = {
    startDate: Date | string
    endDate: Date | string
    funnel?: string
    gdoId?: string
    /** Se true, conta solo le chiamate fatte in orario lavoro 13:30-20:00
     *  (Europe/Rome). Gli APPUNTAMENTI restano sempre conteggiati, anche
     *  fuori orario. Default: false (comportamento storico). */
    workingHoursOnly?: boolean
    /** Granularità del trend: 'day' = una barra per giorno, 'hour' = una
     *  barra per ora 13:30-20:00. Default: 'day'. 'hour' ha senso solo
     *  con range giornaliero (1 giorno). */
    trendGranularity?: 'day' | 'hour'
}

/**
 * discardReason che semanticamente NON è una scelta di scarto basata sul
 * contenuto della chiamata, ma indica che il lead non ha mai risposto
 * (numero che non esiste, non utilizzabile, ecc.). Va contato come
 * NON_RISPOSTO ai fini del tasso risposta del GDO e ESCLUSO dai motivi
 * di scarto, perché non è un esito qualitativo della chiamata.
 */
const NEVER_ANSWERED_DISCARD_REASONS = new Set<string>([
    'numero inesistente',
])

function isNeverAnsweredLog(outcome: string | null, discardReason: string | null): boolean {
    if (outcome !== 'DA_SCARTARE') return false
    return !!discardReason && NEVER_ANSWERED_DISCARD_REASONS.has(discardReason)
}

/** Verifica se un timestamp cade in orario lavoro GDO 13:30-20:00 Europe/Rome */
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
        // Necessari per % Conferme / % Presenziati nel ranking GDO
        confirmationsOutcome: leads.confirmationsOutcome,
        salespersonOutcome: leads.salespersonOutcome,
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
    const allValidLogs = rawLogs.filter(log => validLeadIds.has(log.leadId))

    // Working-hours filter: se ON, le chiamate sono SOLO quelle 13:30-20:00.
    // Gli APPUNTAMENTI restano comunque tutti conteggiati (matchando la
    // logica di /kpi-team — l'appuntamento è un esito che sopravvive
    // all'orario). Senza questo split, le chiamate fuori orario "sporcano"
    // i ratio di conversione/risposta.
    const workingHoursOnly = filters.workingHoursOnly === true
    const validLogs = workingHoursOnly
        ? allValidLogs.filter(l => l.outcome === 'APPUNTAMENTO' || isWithinWorkingHours(l.createdAt))
        : allValidLogs

    // 1. Funnel Conversione
    const leadIdsWithLogs = new Set(validLogs.map(l => l.leadId))
    const calledLeadsCount = leadIdsWithLogs.size

    // "Numero inesistente" trattato come NON_RISPOSTO: non conta come
    // risposta del GDO né come scarto qualitativo. Vedi
    // NEVER_ANSWERED_DISCARD_REASONS.
    const answeredLogs = validLogs.filter(l =>
        l.outcome !== 'NON_RISPOSTO' && !isNeverAnsweredLog(l.outcome, l.discardReason),
    )
    const answeredLeadIds = new Set(answeredLogs.map(l => l.leadId))
    const answeredLeadsCount = answeredLeadIds.size

    const appointmentLogs = validLogs.filter(l => l.outcome === 'APPUNTAMENTO')
    const appointmentLeadIds = new Set(appointmentLogs.map(l => l.leadId))
    const appointmentsSet = appointmentLeadIds.size

    // 2. Motivi Scarto (Qualità Lead) — esclude "numero inesistente"
    const discardLogs = validLogs.filter(l =>
        l.outcome === 'DA_SCARTARE' && l.discardReason && !isNeverAnsweredLog(l.outcome, l.discardReason),
    )
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
        // Numero inesistente non conta come risposta (vedi NEVER_ANSWERED_DISCARD_REASONS)
        if (log.outcome !== 'NON_RISPOSTO' && !isNeverAnsweredLog(log.outcome, log.discardReason)) st.answers++
        if (log.outcome === 'APPUNTAMENTO') {
            st.appointments++
            if (!st.apptLeadIds) st.apptLeadIds = new Set<string>()
            st.apptLeadIds.add(log.leadId)
        }
    })

    const WORKING_HOURS_PER_DAY = 6.5

    // Mappa leadId → outcome per il calcolo % Conferme / % Presenziati per GDO
    const leadOutcomeMap = new Map<string, { conf: string | null; sales: string | null }>()
    for (const l of allLeads) {
        leadOutcomeMap.set(l.id, { conf: l.confirmationsOutcome ?? null, sales: l.salespersonOutcome ?? null })
    }
    const PRESENZIATI_OUTCOMES = new Set(['Chiuso', 'Non chiuso'])

    const gdoStats = Object.values(gdoStatsMap).map(st => {
        const responseRate = st.calls > 0 ? Math.round((st.answers / st.calls) * 100) : 0
        const contactedLeads = st.totalContacted.size
        const apptRate = contactedLeads > 0 ? Math.round((st.appointments / contactedLeads) * 100) : 0
        const callsPerHour = st.calls / WORKING_HOURS_PER_DAY
        // Coefficiente produttività: (chiamate/ora) * (% fissaggio / 100)
        const productivityCoeff = callsPerHour * (apptRate / 100)

        // % Conferme: quanti degli app fissati sono stati confermati dalle Conferme.
        // % Presenziati: quanti il venditore ha effettivamente visto in chiamata
        // (Chiuso o Non chiuso, esclude Sparito / Lead non presenziato).
        // App ancora pending (in attesa) restano al denominatore ma non al numeratore.
        const apptLeadIds: Set<string> = st.apptLeadIds || new Set<string>()
        let confirmed = 0
        let presenziati = 0
        for (const lid of apptLeadIds) {
            const o = leadOutcomeMap.get(lid)
            if (!o) continue
            if (o.conf === 'confermato') confirmed++
            if (o.sales && PRESENZIATI_OUTCOMES.has(o.sales)) presenziati++
        }
        const confermePerc = st.appointments > 0 ? Math.round((confirmed / st.appointments) * 100) : 0
        const presenziatiPerc = st.appointments > 0 ? Math.round((presenziati / st.appointments) * 100) : 0

        return {
            name: st.name,
            calls: st.calls,
            answers: st.answers,
            responseRate,
            appointments: st.appointments,
            apptRate,
            contactedLeads,
            callsPerHour: Math.round(callsPerHour * 10) / 10,
            productivityCoeff: Math.round(productivityCoeff * 100) / 100,
            confirmed,
            confermePerc,
            presenziati,
            presenziatiPerc
        }
    }).sort((a, b) => b.appointments - a.appointments)

    // Funnel list
    const funnelList = Array.from(new Set(allLeads.map(l => l.funnel!).filter(Boolean)))
    // GDO List
    const gdoList = allUsers.filter(u => u.role === 'GDO' || u.role === 'MANAGER').map(u => ({ id: u.id, name: u.name }))

    // Trend chart data (sostituisce il vecchio mockTrend lato client).
    // Granularità 'hour' = barre 13:30 + 14-20 (orario lavoro).
    // Granularità 'day' = una barra per giorno nel range.
    const granularity: 'day' | 'hour' = filters.trendGranularity === 'hour' ? 'hour' : 'day'
    const trendMap = new Map<string, { chiamate: number; appuntamenti: number }>()

    if (granularity === 'hour') {
        trendMap.set('13:30', { chiamate: 0, appuntamenti: 0 })
        for (let h = 14; h <= 20; h++) {
            trendMap.set(`${h}:00`, { chiamate: 0, appuntamenti: 0 })
        }
        for (const log of allValidLogs) {
            const romeTime = log.createdAt.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })
            const [hStr, mStr] = romeTime.split(':')
            const h = parseInt(hStr)
            const m = parseInt(mStr)
            let label: string | null = null
            if (h === 13 && m >= 30) label = '13:30'
            else if (h >= 14 && h <= 20) label = `${h}:00`
            if (label && trendMap.has(label)) {
                const entry = trendMap.get(label)!
                entry.chiamate += 1
                if (log.outcome === 'APPUNTAMENTO') entry.appuntamenti += 1
            }
        }
    } else {
        // Granularità giornaliera. Itera dal giorno di safeStartDate fino a safeEndDate.
        const cursor = new Date(safeStartDate)
        cursor.setHours(0, 0, 0, 0)
        const endDay = new Date(safeEndDate)
        endDay.setHours(0, 0, 0, 0)
        while (cursor <= endDay) {
            const label = format(cursor, 'EEE dd/MM')
            trendMap.set(label, { chiamate: 0, appuntamenti: 0 })
            cursor.setDate(cursor.getDate() + 1)
        }
        const sourceLogs = workingHoursOnly
            ? allValidLogs.filter(l => l.outcome === 'APPUNTAMENTO' || isWithinWorkingHours(l.createdAt))
            : allValidLogs
        for (const log of sourceLogs) {
            const label = format(log.createdAt, 'EEE dd/MM')
            const entry = trendMap.get(label)
            if (entry) {
                entry.chiamate += 1
                if (log.outcome === 'APPUNTAMENTO') entry.appuntamenti += 1
            }
        }
    }

    const chartData = Array.from(trendMap.entries()).map(([timeLabel, vals]) => ({
        timeLabel,
        ...vals,
    }))

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
        chartData,
        chartGranularity: granularity,
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

    return res
}
