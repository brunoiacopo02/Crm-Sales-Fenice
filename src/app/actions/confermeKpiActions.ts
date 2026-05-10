"use server"

import { db } from "@/db"
import { leads, users, monthlyTargets } from "@/db/schema"
import { eq, and, gte, lte, lt, asc, sql, isNotNull } from "drizzle-orm"
import { startOfMonth, endOfMonth, eachDayOfInterval, format, startOfWeek, endOfWeek, eachWeekOfInterval } from "date-fns"
import { weekBoundsRome } from "@/lib/dateUtils"

/** Format a Date to 'yyyy-MM-dd' in Europe/Rome timezone */
function toRomeDateStr(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

/** Default Conferme bonus: T1=30 chiusure (€145), T2=38 chiusure (€290).
 *  Module-private (i file con "use server" possono esportare solo funzioni
 *  async). */
const CONFERME_DEFAULT_TARGET_T1 = 30;
const CONFERME_DEFAULT_TARGET_T2 = 38;
const CONFERME_REWARD_T1 = 145;
const CONFERME_REWARD_T2 = 290;

export async function getConfermeKpiStats(monthDate: Date = new Date(), confermeUserId?: string) {
    const start = startOfMonth(monthDate)
    const end = endOfMonth(monthDate)
    const calendarStart = startOfWeek(start, { weekStartsOn: 1 })
    const calendarEnd = endOfWeek(end, { weekStartsOn: 1 })

    // === QUERY 1: per il THROUGHPUT SETTIMANALE ===
    // Qui 'confermati' = conferme AVVENUTE nel range (confirmationsTimestamp).
    // Serve al tracking del target settimanale del team Conferme (quante
    // pratiche chiude a settimana).
    const conditionsConfirmations = [
        gte(leads.confirmationsTimestamp, calendarStart),
        lte(leads.confirmationsTimestamp, calendarEnd)
    ]
    if (confermeUserId) {
        conditionsConfirmations.push(eq(leads.confirmationsUserId, confermeUserId))
    }

    const confirmedLeads = await db.select({
        id: leads.id,
        date: leads.confirmationsTimestamp,
        outcome: leads.confirmationsOutcome
    }).from(leads).where(and(...conditionsConfirmations))

    // === QUERY 2: per il CALENDARIO ===
    // La cella del giorno X mostra le metriche relative agli appuntamenti
    // SCHEDULATI per il giorno X (indipendentemente da quando la conferma/
    // scarto è stata registrata). Filtro su appointmentDate.
    const conditionsCalendar = [
        gte(leads.appointmentDate, calendarStart),
        lte(leads.appointmentDate, calendarEnd)
    ]
    if (confermeUserId) {
        // Filtrare per utente: Fissati resta globale, ma Confermati/Scartati
        // del singolo utente tengono conto di chi ha lavorato la pratica.
        // Qui prendiamo tutti i lead del range; poi in JS applichiamo il
        // filtro confirmationsUserId solo per confermati/scartati.
    }

    const calendarLeads = await db.select({
        id: leads.id,
        appointmentDate: leads.appointmentDate,
        outcome: leads.confirmationsOutcome,
        confirmationsUserId: leads.confirmationsUserId,
    }).from(leads).where(and(...conditionsCalendar))

    // Grouping by Day — dailyStats basato su appointmentDate
    const daysInMonth = eachDayOfInterval({ start, end })
    const dailyStats = daysInMonth.map(d => {
        const dayStr = format(d, 'yyyy-MM-dd')
        const leadsOfDay = calendarLeads.filter(l =>
            l.appointmentDate && toRomeDateStr(new Date(l.appointmentDate)) === dayStr,
        )
        const matchesUser = (l: typeof calendarLeads[number]) =>
            !confermeUserId || l.confirmationsUserId === confermeUserId

        const fixed = leadsOfDay.length
        const confirmed = leadsOfDay.filter(l => l.outcome === 'confermato' && matchesUser(l)).length
        const discarded = leadsOfDay.filter(l => l.outcome === 'scartato' && matchesUser(l)).length

        return {
            date: dayStr,
            dayOfWeek: d.getDay(), // 0 = Sunday, 1 = Monday
            fixed,
            confirmed,
            discarded,
        }
    })

    const totalFixed = dailyStats.reduce((acc, curr) => acc + curr.fixed, 0)
    const totalConfirmedAct = dailyStats.reduce((acc, curr) => acc + curr.confirmed, 0)

    // Calculate weekly and monthly targets (single query, no duplication)
    let weeklyTier1Target = 0;
    let weeklyTier2Target = 0;

    if (confermeUserId) {
        const userRow = await db.select().from(users).where(eq(users.id, confermeUserId)).limit(1);
        if (userRow.length > 0) {
            weeklyTier1Target = userRow[0].confermeTargetTier1 || CONFERME_DEFAULT_TARGET_T1;
            weeklyTier2Target = userRow[0].confermeTargetTier2 || CONFERME_DEFAULT_TARGET_T2;
        }
    } else {
        const allConferme = await db.select().from(users).where(eq(users.role, 'CONFERME'));
        if (allConferme.length > 0) {
            weeklyTier1Target = allConferme.reduce((sum, u) => sum + (u.confermeTargetTier1 || CONFERME_DEFAULT_TARGET_T1), 0);
            weeklyTier2Target = allConferme.reduce((sum, u) => sum + (u.confermeTargetTier2 || CONFERME_DEFAULT_TARGET_T2), 0);
        } else {
            weeklyTier1Target = CONFERME_DEFAULT_TARGET_T1;
            weeklyTier2Target = CONFERME_DEFAULT_TARGET_T2;
        }
    }

    // Monthly targets = weekly * 4
    const tier1Target = weeklyTier1Target * 4;
    const tier2Target = weeklyTier2Target * 4;

    // Build weekly history array based on full ISO weeks that overlap this month
    const weeksInMonth = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }) // Mondays

    const weeklyHistory = weeksInMonth.map((weekStart, index) => {
        const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

        const actThisWeek = confirmedLeads.filter(l =>
            l.date && l.outcome === 'confermato' &&
            new Date(l.date) >= weekStart &&
            new Date(l.date) <= weekEnd
        ).length;

        const isCurrent = new Date() >= weekStart && new Date() <= weekEnd

        return {
            weekName: `Sett. ${index + 1}`,
            dateRange: `${format(weekStart, 'dd/MM')} - ${format(weekEnd, 'dd/MM')}`,
            act: actThisWeek,
            t1: weeklyTier1Target,
            t2: weeklyTier2Target,
            hitT1: actThisWeek >= weeklyTier1Target,
            hitT2: actThisWeek >= weeklyTier2Target,
            isCurrent
        }
    })

    const currentWeekData = weeklyHistory.find(w => w.isCurrent) || weeklyHistory[weeklyHistory.length - 1]

    // === CHIUSURE & FATTURATO SETTIMANALI ===
    // Settimana ISO Europe/Rome (lun-dom), bounds espliciti per evitare
    // sfasamento ~2h su Vercel/UTC. Quando si guarda un singolo Conferme,
    // attribuiamo le chiusure al Conferme che ha confermato il lead
    // (confirmationsUserId), così la dashboard del singolo non mostra le
    // chiusure dell'intero team.
    const nowWeek = weekBoundsRome(new Date())
    const nowWeekStart = nowWeek.start
    const nowWeekEnd = nowWeek.end
    const closedWeekConditions = [
        eq(leads.salespersonOutcome, 'Chiuso'),
        gte(leads.salespersonOutcomeAt, nowWeekStart),
        lt(leads.salespersonOutcomeAt, nowWeekEnd),
    ]
    if (confermeUserId) {
        closedWeekConditions.push(eq(leads.confirmationsUserId, confermeUserId))
    }
    const closedThisWeekRows = await db.select({
        amount: leads.closeAmountEur,
    }).from(leads).where(and(...closedWeekConditions))
    const closedCountWeek = closedThisWeekRows.length
    const revenueEurWeek = closedThisWeekRows.reduce((sum, r) => sum + (r.amount || 0), 0)

    // === STORICO CHIUSURE SETTIMANALI (8 settimane chiuse precedenti) ===
    // Stessa attribuzione: per singolo Conferme filtra confirmationsUserId.
    // Ogni riga: chiusure, tier raggiunti, bonus maturato.
    const closedHistory: Array<{
        weekLabel: string
        weekStartStr: string
        weekEndStr: string
        closedCount: number
        revenueEur: number
        tier1Reached: boolean
        tier2Reached: boolean
        bonusEur: number
    }> = []
    for (let i = 1; i <= 8; i++) {
        const past = new Date(nowWeekStart.getTime() - i * 7 * 86400000)
        const pw = weekBoundsRome(past)
        const conds = [
            eq(leads.salespersonOutcome, 'Chiuso'),
            gte(leads.salespersonOutcomeAt, pw.start),
            lt(leads.salespersonOutcomeAt, pw.end),
        ]
        if (confermeUserId) {
            conds.push(eq(leads.confirmationsUserId, confermeUserId))
        }
        const rows = await db.select({ amount: leads.closeAmountEur }).from(leads).where(and(...conds))
        const cnt = rows.length
        const rev = rows.reduce((s, r) => s + (r.amount || 0), 0)
        const t1 = cnt >= weeklyTier1Target
        const t2 = cnt >= weeklyTier2Target
        let bonus = 0
        if (t1) bonus += CONFERME_REWARD_T1
        if (t2) bonus += CONFERME_REWARD_T2
        const lastDay = new Date(pw.end.getTime() - 86400000)
        closedHistory.push({
            weekLabel: `${format(pw.start, 'dd/MM')} - ${format(lastDay, 'dd/MM')}`,
            weekStartStr: toRomeDateStr(pw.start),
            weekEndStr: toRomeDateStr(lastDay),
            closedCount: cnt,
            revenueEur: rev,
            tier1Reached: t1,
            tier2Reached: t2,
            bonusEur: bonus,
        })
    }

    const calcWorkingDaysPassed = dailyStats.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6 && new Date(d.date) <= new Date()).length
    const calcTotalWorkingDays = dailyStats.filter(d => d.dayOfWeek !== 0 && d.dayOfWeek !== 6).length

    // Check for manager override of working days
    const monthStr = format(start, 'yyyy-MM')
    const mtQuery = await db.select().from(monthlyTargets).where(eq(monthlyTargets.month, monthStr))
    const overrideVal = mtQuery.length > 0 ? mtQuery[0].workingDaysOverride : null
    const totalWorkingDays = (overrideVal != null && overrideVal > 0) ? overrideVal : calcTotalWorkingDays
    const workingDaysPassed = Math.min(calcWorkingDaysPassed, totalWorkingDays)

    // --- EXCEL FORMULAS & MOCKS ---
    const buildRow = (label: string, actAbs: number, targetMax: number, today: number) => {
        const targetDay = targetMax / (totalWorkingDays || 1)
        const targetPrev = Math.round(targetDay * workingDaysPassed)

        const actPct = targetMax ? (actAbs / targetMax) * 100 : 0
        const prevPct = targetMax ? (targetPrev / targetMax) * 100 : 0

        const scostamentoAbs = actAbs - targetPrev
        const scostamentoPct = targetPrev ? (scostamentoAbs / targetPrev) * 100 : 0

        let badge: 'OK' | 'PRE-RISK' | 'ALLERT' = 'OK'
        if (scostamentoPct < -20) badge = 'ALLERT'
        else if (scostamentoPct < -5) badge = 'PRE-RISK'

        // Mock data primo -20% string if alert
        const dataPrimo = badge === 'ALLERT' ? format(new Date(Date.now() - 3 * 86400000), 'dd/MM/yyyy') : '-'

        return {
            label,
            actAbs,
            actPct,
            prevAbs: targetPrev,
            prevPct,
            targetDay,
            today,
            targetMax,
            scostamentoAbs,
            scostamentoPct,
            dataPrimo,
            badge
        }
    }

    const todayConfirmed = dailyStats.find(d => d.date === toRomeDateStr(new Date()))?.confirmed || 0

    // === TRATTATIVE & CHIUSURE MENSILI — DATI REALI ===
    // Conteggi attribuiti per data dell'esito venditore (salespersonOutcomeAt) nel mese.
    const monthlyOutcomeRows = await db.select({
        outcome: leads.salespersonOutcome,
        outcomeAt: leads.salespersonOutcomeAt,
        amount: leads.closeAmountEur,
    }).from(leads).where(and(
        isNotNull(leads.salespersonOutcomeAt),
        gte(leads.salespersonOutcomeAt, start),
        lte(leads.salespersonOutcomeAt, end),
    ))

    const todayStr = toRomeDateStr(new Date())
    let actTrattative = 0
    let actClosedMonth = 0
    let todayTrat = 0
    let todayClosedReal = 0

    for (const r of monthlyOutcomeRows) {
        const isPresenziato = r.outcome === 'Chiuso' || r.outcome === 'Non chiuso'
        const isToday = !!r.outcomeAt && toRomeDateStr(new Date(r.outcomeAt)) === todayStr
        if (isPresenziato) {
            actTrattative++
            if (isToday) todayTrat++
            if (r.outcome === 'Chiuso') {
                actClosedMonth++
                if (isToday) todayClosedReal++
            }
        }
    }

    // Target Trattative/Chiusure: default proxy del target conferme finché il manager
    // non potrà settarli in modo indipendente. Numerator (ACT) è reale.
    const defaultTargetTrat = Math.round(tier2Target * 0.65)
    const defaultTargetClosed = Math.round(defaultTargetTrat * 0.25)

    // Appuntamenti
    const rowAppuntamenti = buildRow("Appuntamenti Confermati", totalConfirmedAct, tier2Target, todayConfirmed)
    const rowTrattative = buildRow("Trattative Presenziate", actTrattative, defaultTargetTrat, todayTrat)
    const rowClosed = buildRow("Closed (Contratti)", actClosedMonth, defaultTargetClosed, todayClosedReal)

    const tableData = [rowAppuntamenti, rowTrattative, rowClosed]

    return {
        dailyStats,
        tableData,
        weeklyHistory,
        weekly: {
            confirmedAct: currentWeekData ? currentWeekData.act : 0,
            targetTier1: weeklyTier1Target,
            targetTier2: weeklyTier2Target,
            closedCount: closedCountWeek,
            revenueEur: revenueEurWeek,
            rewardTier1: CONFERME_REWARD_T1,
            rewardTier2: CONFERME_REWARD_T2,
        },
        closedHistory,
    }
}

export async function getConfermeSalesList(monthDate: Date = new Date()) {
    const start = startOfMonth(monthDate)
    const end = endOfMonth(monthDate)

    const vendors = await db.select({
        id: users.id,
        displayName: users.displayName,
        name: users.name,
        avatarUrl: users.avatarUrl
    }).from(users).where(eq(users.role, 'VENDITORE'))

    // Lead "confermati" assegnati al venditore nel mese — utile per
    // bilanciare il traffico in arrivo.
    const confirmedAssignments = await db.select({
        salespersonUserId: leads.salespersonUserId,
        count: sql<number>`count(${leads.id})::integer`
    })
        .from(leads)
        .where(and(
            eq(leads.confirmationsOutcome, 'confermato'),
            gte(leads.confirmationsTimestamp, start),
            lte(leads.confirmationsTimestamp, end)
        ))
        .groupBy(leads.salespersonUserId)
    const assignedMap = new Map(confirmedAssignments.map(r => [r.salespersonUserId, r.count]))

    // Trattative del mese (presenziati = Chiuso + Non chiuso) attribuite per
    // data esito venditore (salespersonOutcomeAt).
    const trattativeRows = await db.select({
        salespersonUserId: leads.salespersonUserId,
        outcome: leads.salespersonOutcome,
        amount: leads.closeAmountEur,
    })
        .from(leads)
        .where(and(
            isNotNull(leads.salespersonOutcomeAt),
            gte(leads.salespersonOutcomeAt, start),
            lte(leads.salespersonOutcomeAt, end),
        ))
    const trattativeMap = new Map<string, { trattative: number; chiusure: number; revenue: number }>()
    for (const r of trattativeRows) {
        if (!r.salespersonUserId) continue
        const isPresenziato = r.outcome === 'Chiuso' || r.outcome === 'Non chiuso'
        if (!isPresenziato) continue
        const cur = trattativeMap.get(r.salespersonUserId) || { trattative: 0, chiusure: 0, revenue: 0 }
        cur.trattative++
        if (r.outcome === 'Chiuso') {
            cur.chiusure++
            cur.revenue += r.amount || 0
        }
        trattativeMap.set(r.salespersonUserId, cur)
    }

    const salesList = vendors.map(v => {
        const trat = trattativeMap.get(v.id) || { trattative: 0, chiusure: 0, revenue: 0 }
        return {
            ...v,
            confirmedAssigned: assignedMap.get(v.id) || 0,
            trattative: trat.trattative,
            chiusure: trat.chiusure,
            revenueEur: trat.revenue,
        }
    }).sort((a, b) => b.confirmedAssigned - a.confirmedAssigned)

    return salesList
}

/**
 * F2-012: Obiettivi giornalieri Conferme — confermati oggi vs target
 */
export async function getConfermeDailyObjectives(confermeUserId: string) {
    const now = new Date()
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
    const [yearStr, monthStr, dayStr] = todayStr.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10)
    const day = parseInt(dayStr, 10)

    const todayStart = new Date(year, month - 1, day, 0, 0, 0, 0)
    const todayEnd = new Date(year, month - 1, day, 23, 59, 59, 999)

    // Daily conferme target: 8 conferme al giorno per TUTTO IL TEAM (non individuale)
    const dailyTarget = 8

    // Count today's confirmations by ALL conferme operators (team total)
    const confResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(leads)
        .where(and(
            eq(leads.confirmationsOutcome, 'confermato'),
            isNotNull(leads.confirmationsUserId),
            gte(leads.confirmationsTimestamp, todayStart),
            lte(leads.confirmationsTimestamp, todayEnd)
        ))
    const confirmationsDone = confResult[0]?.count || 0

    return {
        confirmationsDone,
        confirmationsTarget: dailyTarget,
    }
}
