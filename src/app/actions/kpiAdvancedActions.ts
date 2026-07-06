"use server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { gte, lte, lt, and, eq, desc, isNotNull, sql } from "drizzle-orm"
import { format } from "date-fns"
import { dayBoundsRome, weekBoundsRome } from "@/lib/dateUtils"
import { currentTenant, assertSalesArea, companyScope } from '@/lib/tenancy'
import { isRealGdo } from '@/lib/kpi/canon'

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
    const ctx = await currentTenant()
    assertSalesArea(ctx)
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
    const leadConditions: any[] = [companyScope(ctx, leads.companyId)]
    if (filters.funnel) leadConditions.push(eq(leads.funnel, filters.funnel))
    if (filters.gdoId) leadConditions.push(eq(leads.assignedToId, filters.gdoId))

    // We consider a lead "in target" if created in the date range, or having activity in the date range.
    // For simplicity, let's just fetch all leads and filter their LOGS by date range,
    // OR filter leads created within the period for the import stats.

    let allLeads = await leadsQuery.where(and(...leadConditions))

    // Sicurezza Type: converti stringhe ISO in oggetti Date, dato che Next.js 
    // serializza in JSON senza conservare i prototipi passando ai Server Action.
    const safeStartDate = new Date(filters.startDate)
    const safeEndDate = new Date(filters.endDate)

    // Now fetch logs within the date range
    let logConditions = [
        companyScope(ctx, callLogs.companyId),
        gte(callLogs.createdAt, safeStartDate),
        lte(callLogs.createdAt, safeEndDate)
    ]
    if (filters.gdoId) logConditions.push(eq(callLogs.userId, filters.gdoId))

    const rawLogs = await db.select().from(callLogs).where(and(...logConditions))

    // Bot fissatore escluso da TUTTO su questa pagina (aggregati di testata,
    // trend, motivi scarto, ranking) — decisione PO 2026-07-05: la sua
    // produzione resta visibile solo su panoramica-generale e /statistiche-fissatore.
    // I log legacy senza userId restano inclusi come da comportamento storico.
    const allUsers = await db.select().from(users).where(companyScope(ctx, users.companyId))
    const userMap = new Map(allUsers.map(u => [u.id, u.name]))
    const realGdoIds = new Set(allUsers.filter(isRealGdo).map(u => u.id))
    const isRealGdoLog = (log: { userId: string | null }): boolean =>
        !log.userId || realGdoIds.has(log.userId)

    // Filter logs to match only leads in `allLeads` (in case funnel filter was applied)
    // + esclusione bot fissatore (vedi sopra)
    const validLeadIds = new Set(allLeads.map(l => l.id))
    const allValidLogs = rawLogs.filter(log => validLeadIds.has(log.leadId) && isRealGdoLog(log))

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
    // (validLogs è già filtrato a monte: solo GDO reali + tracciato legacy senza userId)
    const gdoStatsMap: Record<string, any> = {}

    validLogs.forEach(log => {
        const uid = log.userId || 'Tracciato Vecchio / Sconosciuto'
        const uname = userMap.get(uid) || uid
        if (!gdoStatsMap[uname]) {
            gdoStatsMap[uname] = { name: uname, calls: 0, answers: 0, totalContacted: new Set(), apptLeadIds: new Set<string>(), firstCallTimes: [] }
        }

        const st = gdoStatsMap[uname]
        st.calls++
        st.totalContacted.add(log.leadId)
        // Numero inesistente non conta come risposta (vedi NEVER_ANSWERED_DISCARD_REASONS)
        if (log.outcome !== 'NON_RISPOSTO' && !isNeverAnsweredLog(log.outcome, log.discardReason)) st.answers++
        if (log.outcome === 'APPUNTAMENTO') {
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
        // Appuntamenti deduplicati per lead. Allinea numeratore (apptLeadIds)
        // e denominatore di % Fissaggio / % Conferme / % Presenziati: prima
        // il primo era `apptLeadIds.size` ma il secondo era `appointments`
        // (numero di log con outcome=APPUNTAMENTO), gonfiando il denominatore
        // ogni volta che un GDO logga 2 appuntamenti sullo stesso lead.
        const apptLeadIds: Set<string> = st.apptLeadIds || new Set<string>()
        const appointments = apptLeadIds.size
        const apptRate = contactedLeads > 0 ? Math.round((appointments / contactedLeads) * 100) : 0
        const callsPerHour = st.calls / WORKING_HOURS_PER_DAY
        // Coefficiente produttività: (chiamate/ora) * (% fissaggio / 100)
        const productivityCoeff = callsPerHour * (apptRate / 100)

        // % Conferme: quanti degli app fissati sono stati confermati dalle Conferme.
        // % Presenziati: quanti il venditore ha effettivamente visto in chiamata
        // (Chiuso o Non chiuso, esclude Sparito / Lead non presenziato).
        // App ancora pending (in attesa) restano al denominatore ma non al numeratore.
        let confirmed = 0
        let presenziati = 0
        for (const lid of apptLeadIds) {
            const o = leadOutcomeMap.get(lid)
            if (!o) continue
            if (o.conf === 'confermato') confirmed++
            if (o.sales && PRESENZIATI_OUTCOMES.has(o.sales)) presenziati++
        }
        const confermePerc = appointments > 0 ? Math.round((confirmed / appointments) * 100) : 0
        const presenziatiPerc = appointments > 0 ? Math.round((presenziati / appointments) * 100) : 0

        return {
            name: st.name,
            calls: st.calls,
            answers: st.answers,
            responseRate,
            appointments,
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
    // GDO List — GDO reali (esclude bot fissatore) + MANAGER (per filtrare le proprie chiamate)
    const gdoList = allUsers.filter(u => isRealGdo(u) || u.role === 'MANAGER').map(u => ({ id: u.id, name: u.name }))

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
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // Fetch targets from user
    const user = (await db.select({
        dailyApptTarget: users.dailyApptTarget,
        weeklyConfirmedTarget: users.weeklyConfirmedTarget
    }).from(users).where(and(eq(users.id, gdoId), companyScope(ctx, users.companyId))))[0]

    if (!user) return null

    // Bounds Europe/Rome espliciti — su Vercel/UTC i `setHours()` sfasavano
    // giorno e settimana di ~2h. `gte(start) AND lt(end)` evita off-by-one.
    const now = new Date()
    const { start: todayStart, end: todayEnd } = dayBoundsRome(now)
    const { start: weekStart, end: weekEnd } = weekBoundsRome(now)

    // Appuntamenti Odierni — deduplicato per leadId.
    // Un GDO può loggare APPUNTAMENTO due volte sullo stesso lead in rari
    // casi (richiamo + conferma): conta come UN solo appuntamento.
    const todayApptLogs = await db.select({ leadId: callLogs.leadId })
        .from(callLogs)
        .where(and(
            companyScope(ctx, callLogs.companyId),
            eq(callLogs.userId, gdoId),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            gte(callLogs.createdAt, todayStart),
            lt(callLogs.createdAt, todayEnd)
        ))
    const todayAppointmentsCount = new Set(todayApptLogs.map(l => l.leadId)).size

    // Conferme Settimanali — filtra per `confirmationsTimestamp` (momento
    // in cui le Conferme marcano "confermato"), non per `appointmentDate`.
    const weeklyConfirmedCount = (await db.select({ id: leads.id })
        .from(leads)
        .where(and(
            companyScope(ctx, leads.companyId),
            eq(leads.assignedToId, gdoId),
            eq(leads.confirmationsOutcome, 'confermato'),
            gte(leads.confirmationsTimestamp, weekStart),
            lt(leads.confirmationsTimestamp, weekEnd)
        ))).length

    // Chiusure Settimanali (lead originariamente assegnati a questo GDO,
    // chiusi dal venditore nella settimana corrente — basato su
    // salespersonOutcomeAt, che ora è editabile dal venditore)
    const weeklyClosedRows = await db.select({ amount: leads.closeAmountEur })
        .from(leads)
        .where(and(
            companyScope(ctx, leads.companyId),
            eq(leads.assignedToId, gdoId),
            eq(leads.salespersonOutcome, 'Chiuso'),
            gte(leads.salespersonOutcomeAt, weekStart),
            lt(leads.salespersonOutcomeAt, weekEnd)
        ))
    const weeklyClosedCount = weeklyClosedRows.length
    const weeklyRevenueEur = weeklyClosedRows.reduce((sum, r) => sum + (r.amount || 0), 0)

    const res = {
        dailyApptTarget: user.dailyApptTarget,
        todayAppointments: todayAppointmentsCount,
        weeklyConfirmedTarget: user.weeklyConfirmedTarget,
        weeklyConfirmed: weeklyConfirmedCount,
        weeklyClosedCount,
        weeklyRevenueEur,
    }

    return res
}

export type GdoThroughputRow = {
    gdoId: string
    gdoName: string
    avgCallsPerLead: number | null
    callsPerDay: number          // media chiamate sui SOLI giorni attivi
    dailyCapacity: number | null
    closures: number
    closedLeadsCount: number
    activeDays: number           // giorni in cui il GDO ha esitato >= 20 lead distinti
}

export type GdoThroughputMetrics = {
    perGdo: GdoThroughputRow[]
    teamTotals: Omit<GdoThroughputRow, 'gdoId' | 'gdoName'>
}

/**
 * Soglia per considerare "attivo" un giorno lavorativo di un GDO:
 * numero minimo di lead distinti su cui ha registrato almeno una chiamata.
 * Bruno (2026-05-27): "per capire se un gdo è stato inattivo basta che guardi
 * se quel gdo ha esitato almeno 20 lead durante il giorno".
 */
const MIN_LEADS_FOR_ACTIVE_DAY = 20

/**
 * Throughput per GDO sulla finestra rolling 30 giorni Europe/Rome.
 *
 * Metriche:
 * - avgCallsPerLead = SUM(callCount sui lead chiusi nella finestra) / COUNT(lead chiusi)
 *   Un lead è "chiuso" se il suo status è APPOINTMENT (appointmentCreatedAt in finestra)
 *   oppure REJECTED (updatedAt in finestra). Gli eventType dedicati APPOINTMENT_SET/
 *   DISCARDED nella tabella leadEvents non vengono scritti dal codice reale, quindi
 *   usiamo i timestamp su leads come sorgente di verità.
 * - callsPerDay = SOMMA chiamate nei giorni attivi / NUMERO giorni attivi del GDO.
 *   Un giorno è "attivo" se il GDO ha esitato almeno MIN_LEADS_FOR_ACTIVE_DAY lead
 *   distinti quel giorno. I giorni di inattività (ferie, malattia, GDO non
 *   ancora operativo, GDO che ha smesso di lavorare) NON entrano nel divisore.
 * - dailyCapacity = round(callsPerDay / avgCallsPerLead) — metrica primaria
 * - closures = COUNT(lead con salespersonOutcome='Chiuso' e salespersonOutcomeAt nella finestra)
 *   (stesso pattern di getGdoTargetsProgress.weeklyClosedRows)
 *
 * Tutti i numeri sono tenant-scoped (companyId = ctx.companyId).
 */
export async function getGdoThroughputMetrics30d(): Promise<GdoThroughputMetrics> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    // Finestra: ultimi 30 giorni Europe/Rome, dall'inizio del giorno 29 giorni fa fino a now.
    const now = new Date()
    const startBound = dayBoundsRome(new Date(now.getTime() - 29 * 86400000)).start
    const end = now

    // --- Query 1: utenti GDO attivi del tenant (esclude bot fissatore) ---
    const gdoUsersRaw = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        role: users.role,
        isActive: users.isActive,
        isBot: users.isBot,
    })
        .from(users)
        .where(and(
            companyScope(ctx, users.companyId),
            eq(users.role, 'GDO')
        ))
    const gdoUsers = gdoUsersRaw.filter(isRealGdo)
    // Id dei soli GDO reali: usato per filtrare anche le aggregazioni team,
    // così la card team è la somma esatta delle righe per-GDO (bot escluso da
    // TUTTO su questa pagina — la sua produzione resta visibile solo su
    // panoramica-generale e /statistiche-fissatore).
    const realGdoIdSet = new Set(gdoUsers.map(u => u.id))

    // --- Query 2: lead chiusi nella finestra (per GDO) ---
    // Un lead è "chiuso" quando ha raggiunto uno stato terminale:
    //   APPOINTMENT  → appointmentCreatedAt cade nella finestra
    //   REJECTED     → updatedAt cade nella finestra (proxy del momento di scarto)
    // Niente self-booked, niente lead non assegnati. La dedup per leadId è gratis
    // perché il filtro per status mette ogni lead in al più una delle due query.
    const appointmentLeads = await db.select({
        id: leads.id,
        assignedToId: leads.assignedToId,
        callCount: leads.callCount,
    })
        .from(leads)
        .where(and(
            companyScope(ctx, leads.companyId),
            eq(leads.status, 'APPOINTMENT'),
            isNotNull(leads.assignedToId),
            isNotNull(leads.appointmentCreatedAt),
            gte(leads.appointmentCreatedAt, startBound),
            lt(leads.appointmentCreatedAt, end),
            eq(leads.isSelfBooked, false),
        ))

    const rejectedLeads = await db.select({
        id: leads.id,
        assignedToId: leads.assignedToId,
        callCount: leads.callCount,
    })
        .from(leads)
        .where(and(
            companyScope(ctx, leads.companyId),
            eq(leads.status, 'REJECTED'),
            isNotNull(leads.assignedToId),
            gte(leads.updatedAt, startBound),
            lt(leads.updatedAt, end),
            eq(leads.isSelfBooked, false),
        ))

    const closedByLead = new Map<string, { assignedToId: string; callCount: number }>()
    for (const row of [...appointmentLeads, ...rejectedLeads]) {
        if (!row.assignedToId) continue
        if (!realGdoIdSet.has(row.assignedToId)) continue // bot/non-GDO fuori anche dai totali team
        if (closedByLead.has(row.id)) continue
        closedByLead.set(row.id, { assignedToId: row.assignedToId, callCount: row.callCount ?? 0 })
    }

    // Aggrega per GDO.
    const closedByGdo = new Map<string, { sumCalls: number; count: number }>()
    for (const v of closedByLead.values()) {
        const cur = closedByGdo.get(v.assignedToId) ?? { sumCalls: 0, count: 0 }
        cur.sumCalls += v.callCount
        cur.count += 1
        closedByGdo.set(v.assignedToId, cur)
    }

    // --- Query 3: chiamate nella finestra (raw, per calcolare giorni attivi per GDO) ---
    // Fetch leggero: solo le 3 colonne necessarie. A scala (~30k righe/30gg) è ok in JS.
    const allCalls = await db.select({
        leadId: callLogs.leadId,
        userId: callLogs.userId,
        createdAt: callLogs.createdAt,
    })
        .from(callLogs)
        .where(and(
            companyScope(ctx, callLogs.companyId),
            isNotNull(callLogs.userId),
            gte(callLogs.createdAt, startBound),
            lt(callLogs.createdAt, end),
        ))

    // Day key in Europe/Rome timezone (YYYY-MM-DD) per raggruppare correttamente
    // i log fatti dopo la mezzanotte locale ma prima della mezzanotte UTC.
    const dayKeyRome = (d: Date): string => {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Rome',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(d)
    }

    // userId → dayKey → { distinctLeads, totalCalls }
    type DayBucket = { distinctLeads: Set<string>, totalCalls: number }
    const perUserDay = new Map<string, Map<string, DayBucket>>()
    for (const c of allCalls) {
        if (!c.userId) continue
        if (!realGdoIdSet.has(c.userId)) continue // bot/non-GDO fuori anche dai totali team
        const day = dayKeyRome(c.createdAt)
        let userMap = perUserDay.get(c.userId)
        if (!userMap) { userMap = new Map(); perUserDay.set(c.userId, userMap) }
        let bucket = userMap.get(day)
        if (!bucket) { bucket = { distinctLeads: new Set(), totalCalls: 0 }; userMap.set(day, bucket) }
        bucket.distinctLeads.add(c.leadId)
        bucket.totalCalls += 1
    }

    // Per ogni GDO: contiamo i giorni "attivi" (>= MIN_LEADS_FOR_ACTIVE_DAY lead esitati)
    // e sommiamo le chiamate fatte SOLO in quei giorni.
    const activityByGdo = new Map<string, { activeDays: number, callsOnActiveDays: number }>()
    for (const [userId, days] of perUserDay.entries()) {
        let activeDays = 0
        let callsOnActiveDays = 0
        for (const bucket of days.values()) {
            if (bucket.distinctLeads.size >= MIN_LEADS_FOR_ACTIVE_DAY) {
                activeDays += 1
                callsOnActiveDays += bucket.totalCalls
            }
        }
        activityByGdo.set(userId, { activeDays, callsOnActiveDays })
    }

    // --- Query 4: chiusure nella finestra (per GDO) — stesso pattern di getGdoTargetsProgress ---
    const closuresAgg = await db.select({
        assignedToId: leads.assignedToId,
        cnt: sql<number>`count(*)::int`,
    })
        .from(leads)
        .where(and(
            companyScope(ctx, leads.companyId),
            isNotNull(leads.assignedToId),
            eq(leads.salespersonOutcome, 'Chiuso'),
            gte(leads.salespersonOutcomeAt, startBound),
            lt(leads.salespersonOutcomeAt, end),
        ))
        .groupBy(leads.assignedToId)

    const closuresByGdo = new Map<string, number>()
    for (const r of closuresAgg) {
        if (!r.assignedToId) continue
        if (!realGdoIdSet.has(r.assignedToId)) continue // bot/non-GDO fuori anche dai totali team
        closuresByGdo.set(r.assignedToId, Number(r.cnt))
    }

    // --- Compose per-GDO rows ---
    const perGdo: GdoThroughputRow[] = gdoUsers.map(u => {
        const closed = closedByGdo.get(u.id)
        const closedCount = closed?.count ?? 0
        const sumCalls = closed?.sumCalls ?? 0

        const avgCallsPerLead = closedCount > 0
            ? Math.round((sumCalls / closedCount) * 10) / 10
            : null

        const activity = activityByGdo.get(u.id) ?? { activeDays: 0, callsOnActiveDays: 0 }
        const callsPerDay = activity.activeDays > 0
            ? Math.round((activity.callsOnActiveDays / activity.activeDays) * 10) / 10
            : 0

        // Se il GDO non ha avuto NESSUN giorno attivo, è considerato inattivo:
        // niente capacità giornaliera (è null, escluso dalla media headline).
        const dailyCapacity = (avgCallsPerLead && avgCallsPerLead > 0 && activity.activeDays > 0)
            ? Math.round(callsPerDay / avgCallsPerLead)
            : null

        return {
            gdoId: u.id,
            gdoName: u.displayName ?? u.name ?? u.id,
            avgCallsPerLead,
            callsPerDay,
            dailyCapacity,
            closures: closuresByGdo.get(u.id) ?? 0,
            closedLeadsCount: closedCount,
            activeDays: activity.activeDays,
        }
    })

    // --- Team totals: somma/somma sui SOLI giorni-GDO attivi ---
    // Concettualmente: "in una giornata di lavoro media di un GDO attivo, quante
    // chiamate fa il team?". Non è la somma assoluta delle chiamate / workingDays
    // (che sarebbe diluita dai GDO inattivi).
    let teamSumCalls = 0
    let teamClosedCount = 0
    for (const v of closedByLead.values()) {
        teamSumCalls += v.callCount
        teamClosedCount += 1
    }
    const teamClosures = Array.from(closuresByGdo.values()).reduce((a, b) => a + b, 0)

    let teamActiveDays = 0
    let teamCallsOnActiveDays = 0
    for (const a of activityByGdo.values()) {
        teamActiveDays += a.activeDays
        teamCallsOnActiveDays += a.callsOnActiveDays
    }

    const teamAvgCallsPerLead = teamClosedCount > 0
        ? Math.round((teamSumCalls / teamClosedCount) * 10) / 10
        : null
    const teamCallsPerDay = teamActiveDays > 0
        ? Math.round((teamCallsOnActiveDays / teamActiveDays) * 10) / 10
        : 0
    const teamDailyCapacity = (teamAvgCallsPerLead && teamAvgCallsPerLead > 0 && teamActiveDays > 0)
        ? Math.round(teamCallsPerDay / teamAvgCallsPerLead)
        : null

    return {
        perGdo,
        teamTotals: {
            avgCallsPerLead: teamAvgCallsPerLead,
            callsPerDay: teamCallsPerDay,
            dailyCapacity: teamDailyCapacity,
            closures: teamClosures,
            closedLeadsCount: teamClosedCount,
            activeDays: teamActiveDays,
        }
    }
}
