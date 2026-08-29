"use server"

import { db } from "@/db"
import { leads, users, monthlyLeadTargets } from "@/db/schema"
import { eq, and, gte, lt, or, asc, sql, isNotNull } from "drizzle-orm"
import { format } from "date-fns"
import { weekBoundsRome, monthBoundsRome, dayBoundsRome, toRomeDateStr, previousYearMonth } from "@/lib/dateUtils"
import { currentTenant, assertSalesArea, companyScope } from '@/lib/tenancy'
import { isConfermeTl } from '@/lib/confermeTl'
import { isFunnelClosure } from '@/lib/kpi/canon'

/** Default Conferme bonus: T1=30 chiusure (€145), T2=38 chiusure (€290).
 *  Module-private (i file con "use server" possono esportare solo funzioni
 *  async). */
const CONFERME_DEFAULT_TARGET_T1 = 30;
const CONFERME_DEFAULT_TARGET_T2 = 38;
const CONFERME_REWARD_T1 = 145;
const CONFERME_REWARD_T2 = 290;

export async function getConfermeKpiStats(monthDate: Date = new Date(), confermeUserId?: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const monthStr = toRomeDateStr(monthDate).slice(0, 7)
    const { start, end } = monthBoundsRome(monthStr) // end esclusivo
    const calendarStart = weekBoundsRome(new Date(start.getTime() + 12 * 3600_000)).start
    const calendarEnd = weekBoundsRome(new Date(end.getTime() - 12 * 3600_000)).end // fine (esclusiva) della settimana che contiene l'ultimo giorno

    // === QUERY 1: per il THROUGHPUT SETTIMANALE ===
    // Qui 'confermati' = conferme AVVENUTE nel range (confirmationsTimestamp).
    // Serve al tracking del target settimanale del team Conferme (quante
    // pratiche chiude a settimana).
    const conditionsConfirmations = [
        companyScope(ctx, leads.companyId),
        gte(leads.confirmationsTimestamp, calendarStart),
        lt(leads.confirmationsTimestamp, calendarEnd)
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
        companyScope(ctx, leads.companyId),
        gte(leads.appointmentDate, calendarStart),
        lt(leads.appointmentDate, calendarEnd)
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

    // Grouping by Day — dailyStats basato su appointmentDate. Giorni del mese
    // come stringhe Rome (il passo a mezzogiorno evita i bordi DST).
    const daysInMonth: string[] = []
    for (let t = start.getTime() + 12 * 3600_000; t < end.getTime(); t += 24 * 3600_000) {
        const s = toRomeDateStr(new Date(t))
        if (daysInMonth[daysInMonth.length - 1] !== s) daysInMonth.push(s)
    }
    const dailyStats = daysInMonth.map(dayStr => {
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
            dayOfWeek: new Date(dayStr + 'T12:00:00Z').getUTCDay(), // 0 = Sunday, 1 = Monday
            fixed,
            confirmed,
            discarded,
        }
    })

    const totalFixed = dailyStats.reduce((acc, curr) => acc + curr.fixed, 0)
    const totalConfirmedAct = dailyStats.reduce((acc, curr) => acc + curr.confirmed, 0)

    // Target settimanali. Per la vista TEAM (no userId) usiamo i target
    // di GRUPPO fissi (T1=30, T2=38), NON la somma dei target individuali:
    // l'obiettivo settimanale è del team, non per operatore.
    let weeklyTier1Target = 0;
    let weeklyTier2Target = 0;

    if (confermeUserId) {
        const userRow = await db.select().from(users).where(and(eq(users.id, confermeUserId), companyScope(ctx, users.companyId))).limit(1);
        if (userRow.length > 0) {
            weeklyTier1Target = userRow[0].confermeTargetTier1 || CONFERME_DEFAULT_TARGET_T1;
            weeklyTier2Target = userRow[0].confermeTargetTier2 || CONFERME_DEFAULT_TARGET_T2;
        }
    } else {
        weeklyTier1Target = CONFERME_DEFAULT_TARGET_T1;
        weeklyTier2Target = CONFERME_DEFAULT_TARGET_T2;
    }

    // Monthly targets = weekly * 4
    const tier1Target = weeklyTier1Target * 4;
    const tier2Target = weeklyTier2Target * 4;

    // Build weekly history array based on full ISO weeks that overlap this month,
    // Rome-native (weekEnd esclusivo).
    const weekStartsRome: Date[] = []
    let w = weekBoundsRome(new Date(start.getTime() + 12 * 3600_000)).start
    while (w < end) {
        weekStartsRome.push(w)
        w = weekBoundsRome(new Date(w.getTime() + 7 * 86400_000 + 12 * 3600_000)).start
    }

    const weeklyHistory = weekStartsRome.map((weekStart, index) => {
        const weekEnd = weekBoundsRome(new Date(weekStart.getTime() + 12 * 3600_000)).end // esclusivo

        const actThisWeek = confirmedLeads.filter(l =>
            l.date && l.outcome === 'confermato' &&
            new Date(l.date) >= weekStart &&
            new Date(l.date) < weekEnd
        ).length;

        const isCurrent = new Date() >= weekStart && new Date() < weekEnd
        const fmt = (d: Date) => { const [Y, M, D] = toRomeDateStr(d).split('-'); return `${D}/${M}` }

        return {
            weekName: `Sett. ${index + 1}`,
            dateRange: `${fmt(weekStart)} - ${fmt(new Date(weekEnd.getTime() - 12 * 3600_000))}`,
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
    // Contiamo SOLO le chiusure passate per la dashboard Conferme:
    // il lead deve essere stato confermato da un operatore Conferme.
    // Esclude vendite dirette o import storici che non sono passati di qui.
    const closedWeekConditions = [
        companyScope(ctx, leads.companyId),
        eq(leads.salespersonOutcome, 'Chiuso'),
        eq(leads.confirmationsOutcome, 'confermato'),
        isNotNull(leads.confirmationsUserId),
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
            companyScope(ctx, leads.companyId),
            eq(leads.salespersonOutcome, 'Chiuso'),
            eq(leads.confirmationsOutcome, 'confermato'),
            isNotNull(leads.confirmationsUserId),
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

    // Check for manager override of working days — letto da monthlyLeadTargets
    // (fonte canonica, unificata col Sales Manager e con /manager-targets —
    // Task B5). Chiave month → yearMonth, workingDaysOverride → workingDays.
    // (monthStr già calcolato Rome-native all'inizio della funzione.)
    const mtQuery = await db.select().from(monthlyLeadTargets).where(and(eq(monthlyLeadTargets.yearMonth, monthStr), companyScope(ctx, monthlyLeadTargets.companyId)))
    const overrideVal = mtQuery.length > 0 ? mtQuery[0].workingDays : null
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
    // Trattative: latch presentedAt (PO 2026-07-17) — presenza contata nel giorno
    // dell'appuntamento, immutabile. Chiusure: data esito venditore (salespersonOutcomeAt).
    const monthlyOutcomeRows = await db.select({
        outcome: leads.salespersonOutcome,
        outcomeAt: leads.salespersonOutcomeAt,
        presentedAt: leads.presentedAt,
        amount: leads.closeAmountEur,
    }).from(leads).where(and(
        companyScope(ctx, leads.companyId),
        or(
            and(isNotNull(leads.presentedAt), gte(leads.presentedAt, start), lt(leads.presentedAt, end)),
            and(isNotNull(leads.salespersonOutcomeAt), gte(leads.salespersonOutcomeAt, start), lt(leads.salespersonOutcomeAt, end)),
        ),
    ))

    const todayStr = toRomeDateStr(new Date())
    let actTrattative = 0
    let actClosedMonth = 0
    let todayTrat = 0
    let todayClosedReal = 0

    for (const r of monthlyOutcomeRows) {
        const presAt = r.presentedAt ? new Date(r.presentedAt) : null
        if (presAt && presAt >= start && presAt < end) {
            actTrattative++
            if (toRomeDateStr(presAt) === todayStr) todayTrat++
        }
        const closeAt = r.outcomeAt ? new Date(r.outcomeAt) : null
        if (r.outcome === 'Chiuso' && closeAt && closeAt >= start && closeAt < end) {
            actClosedMonth++
            if (toRomeDateStr(closeAt) === todayStr) todayClosedReal++
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

// ── Panoramica TL Conferme ───────────────────────────────────────────────────
// Dashboard generale per il TL del team Conferme (richiesta 2026-06-12,
// estesa 2026-07-27 con analytics per funnel — vedi
// docs/superpowers/specs/2026-07-27-tl-conferme-analytics-funnel-design.md).
//
// METODO: attribuzione CANON action-date, identica a getMarketingStatsByGdo e
// a src/lib/metricsUtils.ts. Ogni metrica è contata nel mese in cui è avvenuta
// QUELLA azione, con la sua data sorgente:
//   Fissati    → COALESCE(appointmentCreatedAt, appointmentDate), appointmentDate NOT NULL
//   Confermati → confirmationsTimestamp + confirmationsOutcome='confermato'
//   Presenziati→ presentedAt (latch giorno appuntamento, PO 2026-07-17)
//   Chiusi     → salespersonOutcomeAt + salespersonOutcome='Chiuso'
// Funnel esclusi: TEST, BLT, vuoto. La lista funnel è DERIVATA DAI DATI, non
// da OFFICIAL_FUNNELS (che non contiene BLACK SUMMER).
//
// COSTO: una sola query su leads per mese selezionato + mese precedente, poi
// tutta l'aggregazione in memoria (budget Disk IO — vedi incident 2026-06-27).

/** Riga della tabella per funnel (e riga TOTALE, con funnel='TOTALE'). */
export type TlFunnelRow = {
    funnel: string
    fissati: number
    confermati: number
    presenziati: number
    chiusi: number
    /** Sottoinsieme di `chiusi` con una presenza vera dietro (isFunnelClosure):
     *  numeratore di pctChius/pctFissatoChiuso. `chiusi` e `fatturatoEur`
     *  restano sul totale grezzo, comprese le chiusure fuori funnel scritte
     *  dalla riconciliazione fatturato (Database Clienti, PO 2026-08-29). */
    chiusiConPresenza: number
    fatturatoEur: number
    pctConf: number | null            // confermati / fissati
    pctPres: number | null            // presenziati / confermati
    pctChius: number | null           // chiusiConPresenza / presenziati
    pctFissatoChiuso: number | null   // chiusiConPresenza / fissati
    eurPerFissato: number | null      // fatturato / fissati
    /** true sulla riga di coda aggregata: i funnel sotto la top-N del mese. */
    isOther?: boolean
    /** Solo sulla riga "Altri": nomi dei funnel accorpati. */
    otherFunnels?: string[]
}

/**
 * Quanti funnel mostrare per esteso. La coda finisce in una riga "Altri" invece
 * di sparire: così le colonne sommano sempre alla riga TOTALE.
 * Selezione DINAMICA per mese, mai una lista fissa (PO 2026-07-27): a maggio
 * 2026 ORG valeva il 54% dei fissati, a luglio lo 0,4%.
 */
const TL_FUNNEL_TOP_N = 5

export type ConfermeTlOverview =
    | {
        success: true
        yearMonth: string
        currentYearMonth: string
        isCurrentMonth: boolean
        month: {
            fissati: number
            confermati: number
            scartati: number
            presentati: number
            chiusure: number
            fatturatoEur: number
            pctConferme: number | null   // confermati / fissati
            pctPresenze: number | null   // presentati / confermati
            pctChiusure: number | null   // chiusure / presentati
        }
        /** Differenza in PUNTI percentuali (o valore assoluto) vs mese precedente intero. */
        deltaVsPrev: {
            pctConferme: number | null
            pctPresenze: number | null
            pctChiusure: number | null
            chiusure: number
            fatturatoEur: number
        }
        week: {
            chiusure: number
            fatturatoEur: number
        }
        perFunnel: TlFunnelRow[]
        totals: TlFunnelRow
        discardReasons: Array<{ reason: string; count: number; pct: number }>
        scartiTotali: number
        /** Coorte dei fissati del mese, per distanza fissaggio → appuntamento. */
        leadTime: Array<{
            bucket: string
            fissati: number
            confermati: number
            presenziati: number
            pctConf: number | null
            pctPres: number | null
        }>
        weekly: Array<{
            label: string
            range: string
            fissati: number
            confermati: number
            presenziati: number
            chiusi: number
            pctConf: number | null
            pctPres: number | null
            pctChius: number | null
            isCurrent: boolean
        }>
        perOperator: Array<{
            userId: string
            name: string
            confermati: number
            scartati: number
            presenziati: number
            chiusure: number
            fatturatoEur: number
            pctPresenze: number | null    // presenziati / confermati
            pctChiusure: number | null    // chiusure / presenziati
            eurPerConferma: number | null
        }>
    }
    | { success: false; error: string }

/** Riga leads con i soli campi usati dall'aggregazione TL. */
type TlLeadRow = {
    funnel: string | null
    appointmentDate: Date | null
    appointmentCreatedAt: Date | null
    confirmationsOutcome: string | null
    confirmationsTimestamp: Date | null
    confirmationsUserId: string | null
    confirmationsDiscardReason: string | null
    presentedAt: Date | null
    salespersonOutcome: string | null
    salespersonOutcomeAt: Date | null
    amount: number | null
}

const inRange = (d: Date | null | undefined, s: Date, e: Date): boolean =>
    !!d && d >= s && d < e

/** Data canonica di fissaggio (M2): appointmentCreatedAt, fallback appointmentDate. */
const apptSetAt = (r: TlLeadRow): Date | null =>
    r.appointmentDate ? (r.appointmentCreatedAt || r.appointmentDate) : null

function emptyRow(funnel: string): TlFunnelRow {
    return {
        funnel, fissati: 0, confermati: 0, presenziati: 0, chiusi: 0, chiusiConPresenza: 0, fatturatoEur: 0,
        pctConf: null, pctPres: null, pctChius: null, pctFissatoChiuso: null, eurPerFissato: null,
    }
}

function withRatios(r: TlFunnelRow): TlFunnelRow {
    return {
        ...r,
        pctConf: r.fissati > 0 ? r.confermati / r.fissati : null,
        pctPres: r.confermati > 0 ? r.presenziati / r.confermati : null,
        // Numeratore = solo chiusure con presenza vera (vedi chiusiConPresenza):
        // altrimenti una chiusura riconciliata fuori funnel gonfia il tasso.
        pctChius: r.presenziati > 0 ? r.chiusiConPresenza / r.presenziati : null,
        pctFissatoChiuso: r.fissati > 0 ? r.chiusiConPresenza / r.fissati : null,
        eurPerFissato: r.fissati > 0 ? r.fatturatoEur / r.fissati : null,
    }
}

/** Accumula le 4 metriche canoniche di `row` (se nel range) dentro `acc`. */
function accumulate(acc: TlFunnelRow, r: TlLeadRow, s: Date, e: Date): void {
    if (inRange(apptSetAt(r), s, e)) acc.fissati++
    if (r.confirmationsOutcome === 'confermato' && inRange(r.confirmationsTimestamp, s, e)) acc.confermati++
    if (inRange(r.presentedAt, s, e)) acc.presenziati++
    if (r.salespersonOutcome === 'Chiuso' && inRange(r.salespersonOutcomeAt, s, e)) {
        acc.chiusi++
        acc.fatturatoEur += r.amount || 0
        // Chiusura senza presenza (riconciliazione fatturato): vera per i
        // soldi (fatturatoEur sopra), esclusa dal numeratore dei tassi.
        if (isFunnelClosure(r)) acc.chiusiConPresenza++
    }
}

export async function getConfermeTlOverview(yearMonth?: string): Promise<ConfermeTlOverview> {
    try {
        const ctx = await currentTenant()
        assertSalesArea(ctx)
        const authorized = ['ADMIN', 'MANAGER'].includes(ctx.role)
            || (ctx.role === 'CONFERME' && isConfermeTl(ctx.email))
        if (!authorized) return { success: false, error: 'Non autorizzato' }

        const currentYearMonth = toRomeDateStr(new Date()).slice(0, 7)
        const ym = /^\d{4}-\d{2}$/.test(yearMonth || '') ? yearMonth! : currentYearMonth
        const isCurrentMonth = ym === currentYearMonth

        const { start, end } = monthBoundsRome(ym)
        const prev = monthBoundsRome(previousYearMonth(ym))
        // Settimana corrente (solo sul mese in corso): può sconfinare nel mese
        // successivo, quindi allarga la finestra di fetch.
        const wk = weekBoundsRome(new Date())
        const fetchStart = prev.start
        const fetchEnd = isCurrentMonth && wk.end > end ? wk.end : end

        const rows: TlLeadRow[] = await db.select({
            funnel: leads.funnel,
            appointmentDate: leads.appointmentDate,
            appointmentCreatedAt: leads.appointmentCreatedAt,
            confirmationsOutcome: leads.confirmationsOutcome,
            confirmationsTimestamp: leads.confirmationsTimestamp,
            confirmationsUserId: leads.confirmationsUserId,
            confirmationsDiscardReason: leads.confirmationsDiscardReason,
            presentedAt: leads.presentedAt,
            salespersonOutcome: leads.salespersonOutcome,
            salespersonOutcomeAt: leads.salespersonOutcomeAt,
            amount: leads.closeAmountEur,
        }).from(leads).where(and(
            companyScope(ctx, leads.companyId),
            sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('TEST', 'BLT', '')`,
            or(
                and(isNotNull(leads.appointmentDate),
                    sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) >= ${fetchStart}`,
                    sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) <  ${fetchEnd}`),
                and(gte(leads.confirmationsTimestamp, fetchStart), lt(leads.confirmationsTimestamp, fetchEnd)),
                and(gte(leads.presentedAt, fetchStart), lt(leads.presentedAt, fetchEnd)),
                and(gte(leads.salespersonOutcomeAt, fetchStart), lt(leads.salespersonOutcomeAt, fetchEnd)),
            ),
        ))

        // ── Totali mese + breakdown per funnel ──────────────────────────────
        const totals = emptyRow('TOTALE')
        const prevTotals = emptyRow('TOTALE')
        const byFunnel = new Map<string, TlFunnelRow>()
        let scartatiMese = 0

        for (const r of rows) {
            accumulate(totals, r, start, end)
            accumulate(prevTotals, r, prev.start, prev.end)

            const key = (r.funnel || '').toUpperCase()
            let acc = byFunnel.get(key)
            if (!acc) { acc = emptyRow(key); byFunnel.set(key, acc) }
            accumulate(acc, r, start, end)

            if (r.confirmationsOutcome === 'scartato' && inRange(r.confirmationsTimestamp, start, end)) {
                scartatiMese++
            }
        }

        // Top-N per volume di appuntamenti fissati (è ciò che occupa il tempo
        // del team Conferme); la coda si accorpa in una riga "Altri" così i
        // totali di colonna restano quadrati con la riga TOTALE.
        const active = [...byFunnel.values()]
            .filter(r => r.fissati > 0 || r.confermati > 0 || r.presenziati > 0 || r.chiusi > 0)
        const ranked = [...active].sort((a, b) => b.fissati - a.fissati || b.fatturatoEur - a.fatturatoEur)
        const head = ranked.slice(0, TL_FUNNEL_TOP_N)
        const tail = ranked.slice(TL_FUNNEL_TOP_N)

        const perFunnel = head
            .map(withRatios)
            .sort((a, b) => b.fatturatoEur - a.fatturatoEur || b.fissati - a.fissati)

        if (tail.length > 0) {
            const other = tail.reduce((acc, r) => {
                acc.fissati += r.fissati
                acc.confermati += r.confermati
                acc.presenziati += r.presenziati
                acc.chiusi += r.chiusi
                acc.chiusiConPresenza += r.chiusiConPresenza
                acc.fatturatoEur += r.fatturatoEur
                return acc
            }, emptyRow('ALTRI'))
            perFunnel.push({
                ...withRatios(other),
                isOther: true,
                otherFunnels: tail.map(r => r.funnel).sort(),
            })
        }
        const totalsRow = withRatios(totals)
        const prevRow = withRatios(prevTotals)

        // ── Motivi di scarto (scarti registrati nel mese) ────────────────────
        const reasonMap = new Map<string, number>()
        for (const r of rows) {
            if (r.confirmationsOutcome !== 'scartato') continue
            if (!inRange(r.confirmationsTimestamp, start, end)) continue
            const key = r.confirmationsDiscardReason?.trim() || 'Senza motivo'
            reasonMap.set(key, (reasonMap.get(key) || 0) + 1)
        }
        const discardReasons = [...reasonMap.entries()]
            .map(([reason, count]) => ({
                reason,
                count,
                pct: scartatiMese > 0 ? count / scartatiMese : 0,
            }))
            .sort((a, b) => b.count - a.count)

        // ── Lead time fissaggio → appuntamento ──────────────────────────────
        // NB: unico blocco per-appuntamento (coorte dei fissati del mese seguita
        // fino a conferma/presenza), non action-date. Etichettato come tale in UI.
        const LT_BUCKETS = ['0 gg', '1 gg', '2-3 gg', '4-7 gg', '8+ gg'] as const
        const ltMap = new Map<string, { fissati: number; confermati: number; presenziati: number }>(
            LT_BUCKETS.map(b => [b, { fissati: 0, confermati: 0, presenziati: 0 }]),
        )
        const dayIndex = (d: Date): number =>
            Math.floor(Date.parse(`${toRomeDateStr(d)}T00:00:00Z`) / 86400000)
        for (const r of rows) {
            const setAt = apptSetAt(r)
            if (!setAt || !inRange(setAt, start, end) || !r.appointmentDate) continue
            const gap = Math.max(0, dayIndex(r.appointmentDate) - dayIndex(setAt))
            const bucket = gap === 0 ? '0 gg'
                : gap === 1 ? '1 gg'
                : gap <= 3 ? '2-3 gg'
                : gap <= 7 ? '4-7 gg'
                : '8+ gg'
            const acc = ltMap.get(bucket)!
            acc.fissati++
            if (r.confirmationsOutcome === 'confermato') acc.confermati++
            if (r.presentedAt) acc.presenziati++
        }
        const leadTime = LT_BUCKETS.map(b => {
            const a = ltMap.get(b)!
            return {
                bucket: b,
                fissati: a.fissati,
                confermati: a.confermati,
                presenziati: a.presenziati,
                pctConf: a.fissati > 0 ? a.confermati / a.fissati : null,
                pctPres: a.confermati > 0 ? a.presenziati / a.confermati : null,
            }
        }).filter(b => b.fissati > 0)

        // ── Trend settimanale (settimane ISO clampate al mese) ───────────────
        const weeklyRows: Array<{
            label: string; range: string; fissati: number; confermati: number
            presenziati: number; chiusi: number
            pctConf: number | null; pctPres: number | null; pctChius: number | null
            isCurrent: boolean
        }> = []
        const now = new Date()
        let cursor = weekBoundsRome(new Date(start.getTime() + 12 * 3600_000)).start
        let wIdx = 0
        while (cursor < end) {
            const wEnd = weekBoundsRome(new Date(cursor.getTime() + 12 * 3600_000)).end
            const s = cursor > start ? cursor : start
            const e = wEnd < end ? wEnd : end
            const acc = emptyRow(`w${wIdx}`)
            for (const r of rows) accumulate(acc, r, s, e)
            const fmt = (d: Date) => { const [, M, D] = toRomeDateStr(d).split('-'); return `${D}/${M}` }
            weeklyRows.push({
                label: `Sett. ${wIdx + 1}`,
                range: `${fmt(s)} - ${fmt(new Date(e.getTime() - 12 * 3600_000))}`,
                fissati: acc.fissati,
                confermati: acc.confermati,
                presenziati: acc.presenziati,
                chiusi: acc.chiusi,
                pctConf: acc.fissati > 0 ? acc.confermati / acc.fissati : null,
                pctPres: acc.confermati > 0 ? acc.presenziati / acc.confermati : null,
                pctChius: acc.presenziati > 0 ? acc.chiusi / acc.presenziati : null,
                isCurrent: now >= s && now < e,
            })
            cursor = weekBoundsRome(new Date(cursor.getTime() + 7 * 86400_000 + 12 * 3600_000)).start
            wIdx++
        }

        // ── Chiusure + fatturato della settimana corrente (canon: tutte le
        //    chiusure della settimana, come Marketing/KPI GDO) ───────────────
        let chiusureSettimana = 0
        let fatturatoSettimana = 0
        if (isCurrentMonth) {
            for (const r of rows) {
                if (r.salespersonOutcome === 'Chiuso' && inRange(r.salespersonOutcomeAt, wk.start, wk.end)) {
                    chiusureSettimana++
                    fatturatoSettimana += r.amount || 0
                }
            }
        }

        // ── Breakdown per operatore Conferme ─────────────────────────────────
        // Righe: utenti CONFERME attivi + chiunque abbia lavorato ≥1 esito nel
        // mese (es. un admin che ha confermato al posto del team).
        const companyUsers = await db.select({
            id: users.id,
            name: users.name,
            displayName: users.displayName,
            role: users.role,
            isActive: users.isActive,
        }).from(users).where(companyScope(ctx, users.companyId))
        const userMap = new Map(companyUsers.map(u => [u.id, u]))

        const opIds = new Set<string>(
            companyUsers.filter(u => u.role === 'CONFERME' && u.isActive).map(u => u.id),
        )
        for (const r of rows) {
            if (!r.confirmationsUserId) continue
            const worked = (r.confirmationsOutcome === 'confermato' || r.confirmationsOutcome === 'scartato')
                && inRange(r.confirmationsTimestamp, start, end)
            if (worked) opIds.add(r.confirmationsUserId)
        }

        const perOperator = [...opIds].map(id => {
            const u = userMap.get(id)
            let confermati = 0, scartati = 0, presenziati = 0, chiusure = 0, fatturatoEur = 0
            for (const r of rows) {
                if (r.confirmationsUserId !== id) continue
                if (inRange(r.confirmationsTimestamp, start, end)) {
                    if (r.confirmationsOutcome === 'confermato') confermati++
                    else if (r.confirmationsOutcome === 'scartato') scartati++
                }
                if (inRange(r.presentedAt, start, end)) presenziati++
                if (r.salespersonOutcome === 'Chiuso' && inRange(r.salespersonOutcomeAt, start, end)) {
                    chiusure++
                    fatturatoEur += r.amount || 0
                }
            }
            return {
                userId: id,
                name: u?.name || u?.displayName || id,
                confermati,
                scartati,
                presenziati,
                chiusure,
                fatturatoEur,
                pctPresenze: confermati > 0 ? presenziati / confermati : null,
                pctChiusure: presenziati > 0 ? chiusure / presenziati : null,
                eurPerConferma: confermati > 0 ? fatturatoEur / confermati : null,
            }
        }).sort((a, b) => b.confermati - a.confermati)

        const deltaPct = (cur: number | null, old: number | null): number | null =>
            cur === null || old === null ? null : cur - old

        return {
            success: true,
            yearMonth: ym,
            currentYearMonth,
            isCurrentMonth,
            month: {
                fissati: totalsRow.fissati,
                confermati: totalsRow.confermati,
                scartati: scartatiMese,
                presentati: totalsRow.presenziati,
                chiusure: totalsRow.chiusi,
                fatturatoEur: totalsRow.fatturatoEur,
                pctConferme: totalsRow.pctConf,
                pctPresenze: totalsRow.pctPres,
                pctChiusure: totalsRow.pctChius,
            },
            deltaVsPrev: {
                pctConferme: deltaPct(totalsRow.pctConf, prevRow.pctConf),
                pctPresenze: deltaPct(totalsRow.pctPres, prevRow.pctPres),
                pctChiusure: deltaPct(totalsRow.pctChius, prevRow.pctChius),
                chiusure: totalsRow.chiusi - prevRow.chiusi,
                fatturatoEur: totalsRow.fatturatoEur - prevRow.fatturatoEur,
            },
            week: { chiusure: chiusureSettimana, fatturatoEur: fatturatoSettimana },
            perFunnel,
            totals: totalsRow,
            discardReasons,
            scartiTotali: scartatiMese,
            leadTime,
            weekly: weeklyRows,
            perOperator,
        }
    } catch (error) {
        console.error('Errore getConfermeTlOverview:', error)
        return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
}

export async function getConfermeSalesList(monthDate: Date = new Date()) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // Bounds Europe/Rome (end esclusivo): prima startOfMonth/endOfMonth
    // interpretavano monthDate nel fuso del server (UTC su Vercel).
    const { start, end } = monthBoundsRome(toRomeDateStr(monthDate).slice(0, 7))

    const vendors = await db.select({
        id: users.id,
        displayName: users.displayName,
        name: users.name,
        avatarUrl: users.avatarUrl
    }).from(users).where(and(
        eq(users.role, 'VENDITORE'),
        // Staff condiviso: venditori con companyId='fenice' operano anche su
        // Serenamente via allowedCompanies (fallback legacy su companyId).
        or(
            sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, companyScope(ctx, users.companyId)),
        ),
    ))

    // Un solo set di lead "presenti nel mese" per ciascun venditore.
    // Un lead conta come ATTIVO NEL MESE se:
    //   (a) è stato confermato (assegnato al venditore) nel mese, OR
    //   (b) il venditore l'ha esitato nel mese (salespersonOutcomeAt).
    //
    // Da questo set unico derivano Asgn / Tratt / Chius — garantendo
    // sempre Asgn ≥ Tratt ≥ Chius e nessuna doppia attribuzione. Prima
    // le due colonne usavano date sorgente diverse e potevano divergere
    // (es. lead confermato ad aprile e chiuso a maggio: assegnato=0,
    // trattative=1 → confusione UX).
    const activeRows = await db.select({
        id: leads.id,
        salespersonUserId: leads.salespersonUserId,
        confirmationsOutcome: leads.confirmationsOutcome,
        confirmationsTimestamp: leads.confirmationsTimestamp,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeAt: leads.salespersonOutcomeAt,
        presentedAt: leads.presentedAt,
        amount: leads.closeAmountEur,
    }).from(leads).where(and(
        companyScope(ctx, leads.companyId),
        isNotNull(leads.salespersonUserId),
        or(
            and(
                eq(leads.confirmationsOutcome, 'confermato'),
                gte(leads.confirmationsTimestamp, start),
                lt(leads.confirmationsTimestamp, end),
            ),
            and(
                isNotNull(leads.salespersonOutcomeAt),
                gte(leads.salespersonOutcomeAt, start),
                lt(leads.salespersonOutcomeAt, end),
            ),
            and(
                isNotNull(leads.presentedAt),
                gte(leads.presentedAt, start),
                lt(leads.presentedAt, end),
            ),
        ),
    ))

    const statsMap = new Map<string, { assigned: number; trattative: number; chiusure: number; revenue: number }>()
    const seenLeadIds = new Map<string, Set<string>>() // sales -> leadIds (dedup difensivo)

    for (const r of activeRows) {
        if (!r.salespersonUserId) continue
        const sid = r.salespersonUserId
        // Dedup: un lead conta una volta sola anche se entrambe le condizioni OR matchano
        const seen = seenLeadIds.get(sid) || new Set<string>()
        if (seen.has(r.id)) continue
        seen.add(r.id)
        seenLeadIds.set(sid, seen)

        const cur = statsMap.get(sid) || { assigned: 0, trattative: 0, chiusure: 0, revenue: 0 }
        cur.assigned++
        // Trattative: latch presentedAt (PO 2026-07-17) — contano nel mese del giorno
        // dell'appuntamento presenziato. Chiusure: contano nel mese dell'esito venditore.
        // (un lead confermato a maggio ma chiuso a giugno → Asgn maggio, Chius giugno.)
        const presInMonth = r.presentedAt
            && new Date(r.presentedAt) >= start
            && new Date(r.presentedAt) < end
        if (presInMonth) {
            cur.trattative++
        }
        const outcomeInMonth = r.salespersonOutcomeAt
            && new Date(r.salespersonOutcomeAt) >= start
            && new Date(r.salespersonOutcomeAt) < end
        if (r.salespersonOutcome === 'Chiuso' && outcomeInMonth) {
            cur.chiusure++
            cur.revenue += r.amount || 0
        }
        statsMap.set(sid, cur)
    }

    const salesList = vendors.map(v => {
        const s = statsMap.get(v.id) || { assigned: 0, trattative: 0, chiusure: 0, revenue: 0 }
        return {
            ...v,
            confirmedAssigned: s.assigned,
            trattative: s.trattative,
            chiusure: s.chiusure,
            revenueEur: s.revenue,
        }
    }).sort((a, b) => b.confirmedAssigned - a.confirmedAssigned)

    return salesList
}

/**
 * F2-012: Obiettivi giornalieri Conferme — confermati oggi vs target
 */
export async function getConfermeDailyObjectives(confermeUserId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const { start: todayStart, end: todayEnd } = dayBoundsRome(new Date())

    // Daily conferme target: 8 conferme al giorno per TUTTO IL TEAM (non individuale)
    const dailyTarget = 8

    // Count today's confirmations by ALL conferme operators (team total)
    const confResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(leads)
        .where(and(
            companyScope(ctx, leads.companyId),
            eq(leads.confirmationsOutcome, 'confermato'),
            isNotNull(leads.confirmationsUserId),
            gte(leads.confirmationsTimestamp, todayStart),
            lt(leads.confirmationsTimestamp, todayEnd)
        ))
    const confirmationsDone = confResult[0]?.count || 0

    return {
        confirmationsDone,
        confirmationsTarget: dailyTarget,
    }
}
