'use server';

import { db } from "@/db";
import { leads, users, weeklyGamificationRules, callLogs, manualAdjustments } from "@/db/schema";
import { eq, and, gte, lte, isNotNull, sql, or } from "drizzle-orm";
import { parseISO, endOfMonth, getDay, addDays, isWithinInterval } from "date-fns";

export interface GamificationTargetInput {
    month: string;
    targetTier1: number;
    rewardTier1: number;
    targetTier2: number;
    rewardTier2: number;
}

export async function saveGamificationRule(input: GamificationTargetInput) {
    await db.insert(weeklyGamificationRules)
        .values({
            id: crypto.randomUUID(),
            month: input.month,
            targetTier1: input.targetTier1,
            rewardTier1: input.rewardTier1,
            targetTier2: input.targetTier2,
            rewardTier2: input.rewardTier2,
            updatedAt: new Date()
        })
        .onConflictDoUpdate({
            target: weeklyGamificationRules.month,
            set: {
                targetTier1: input.targetTier1,
                rewardTier1: input.rewardTier1,
                targetTier2: input.targetTier2,
                rewardTier2: input.rewardTier2,
                updatedAt: new Date()
            }
        });
}

function isPresenziato(outcome: string | null) {
    if (!outcome) return false;
    const lower = outcome.toLowerCase();
    // Exclude 'sparito', 'assente', 'non presenziato'
    return !lower.includes('sparit') && !lower.includes('assent') && !lower.includes('non presenziato');
}

/**
 * Funzione Helper: Divide il mese in blocchi di settimane solari (Lunedì-Domenica).
 */
function getMonthWeeks(monthStr: string) {
    const startObj = parseISO(`${monthStr}-01T00:00:00`);
    const endObj = endOfMonth(startObj);

    // We break it down to buckets.
    const weeks: { name: string, start: Date, end: Date }[] = [];
    let currentStart = startObj;
    let weekIndex = 1;

    while (currentStart <= endObj) {
        // getDay(): Sunday = 0, Monday = 1 ... Saturday = 6
        let daysToSunday = 0;
        const currentDayOfWeek = getDay(currentStart);
        if (currentDayOfWeek === 0) {
            daysToSunday = 0;
        } else {
            daysToSunday = 7 - currentDayOfWeek;
        }

        let currentEnd = addDays(currentStart, daysToSunday);
        // Ensure end of day time
        currentEnd = new Date(currentEnd.getFullYear(), currentEnd.getMonth(), currentEnd.getDate(), 23, 59, 59, 999);

        if (currentEnd > endObj) {
            currentEnd = new Date(endObj.getFullYear(), endObj.getMonth(), endObj.getDate(), 23, 59, 59, 999);
        }

        weeks.push({
            name: `Week ${weekIndex}`,
            start: currentStart,
            end: currentEnd
        });

        // Next starts at currentEnd + 1 ms => next day 00:00:00
        currentStart = addDays(new Date(currentEnd.getFullYear(), currentEnd.getMonth(), currentEnd.getDate()), 1);
        currentStart = new Date(currentStart.getFullYear(), currentStart.getMonth(), currentStart.getDate(), 0, 0, 0, 0);
        weekIndex++;
    }

    return weeks;
}

/**
 * FASE 2.1: Logica backend Tabellare e Calendario (Manager)
 */
export async function getManagerGdoTables(monthString: string) {
    // Tutti id e dati base GDO
    const allUsers = await db.select().from(users).where(eq(users.role, 'GDO'));
    const activeGdos = allUsers.filter(u => u.isActive);

    // Tutti gli appuntamenti fissati questo mese (verranno splittati per data di appuntamento, 
    // ma la select la facciamo su tutto, o per appointmentDate compreso in questo mese per evitare di prenderli tutti)
    // Meglio prendere tutti i lead e poi filtrare in memoria.
    const startObj = parseISO(`${monthString}-01T00:00:00`);
    const endObj = new Date(endOfMonth(startObj).getFullYear(), endOfMonth(startObj).getMonth(), endOfMonth(startObj).getDate(), 23, 59, 59, 999);

    const [monthLeads, assignedLeadsRaw] = await Promise.all([
        db.select().from(leads).where(
            and(
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, startObj),
                lte(leads.appointmentDate, endObj)
            )
        ),
        db.select({
            assignedToId: leads.assignedToId,
        }).from(leads)
            .where(and(
                isNotNull(leads.assignedToId),
                gte(leads.createdAt, startObj),
                lte(leads.createdAt, endObj)
            ))
    ]);

    const weeks = getMonthWeeks(monthString);

    const gdoStatsMap: Record<string, any> = {};

    for (const gdo of activeGdos) {
        gdoStatsMap[gdo.id] = {
            gdoName: gdo.displayName || `GDO ${gdo.gdoCode || gdo.id.slice(0, 4)}`,
            funnelStats: {} as Record<string, any>,
            calendarStats: {
                confermati: Array(weeks.length).fill(0),
                presenziati: Array(weeks.length).fill(0),
                chiusi: Array(weeks.length).fill(0)
            },
            totalStats: {
                fissati: 0, confermati: 0, presenziati: 0, chiusi: 0
            },
            leadAssegnati: 0
        };
    }

    monthLeads.forEach(lead => {
        if (!lead.assignedToId || !gdoStatsMap[lead.assignedToId]) return;

        const gdoStats = gdoStatsMap[lead.assignedToId];
        const f = lead.funnel || 'ALTRO';

        if (!gdoStats.funnelStats[f]) {
            gdoStats.funnelStats[f] = { fissati: 0, confermati: 0, presenziati: 0, chiusi: 0 };
        }

        const isConfermato = lead.confirmationsOutcome && lead.confirmationsOutcome.toLowerCase() !== 'scartato';
        const isPresenziatoFlag = isPresenziato(lead.salespersonOutcome);
        const isChiuso = lead.salespersonOutcome?.toLowerCase() === 'chiuso';

        // 1. DIMENSIONE FUNNEL
        gdoStats.funnelStats[f].fissati++;
        gdoStats.totalStats.fissati++;

        if (isConfermato) {
            gdoStats.funnelStats[f].confermati++;
            gdoStats.totalStats.confermati++;
        }
        if (isPresenziatoFlag) {
            gdoStats.funnelStats[f].presenziati++;
            gdoStats.totalStats.presenziati++;
        }
        if (isChiuso) {
            gdoStats.funnelStats[f].chiusi++;
            gdoStats.totalStats.chiusi++;
        }

        // 2. DIMENSIONE WEEKLY (Calendar)
        // Find which week this appointment falls into
        if (lead.appointmentDate) {
            const wIndex = weeks.findIndex(w => isWithinInterval(lead.appointmentDate!, { start: w.start, end: w.end }));
            if (wIndex !== -1) {
                if (isConfermato) gdoStats.calendarStats.confermati[wIndex]++;
                if (isPresenziatoFlag) gdoStats.calendarStats.presenziati[wIndex]++;
                if (isChiuso) gdoStats.calendarStats.chiusi[wIndex]++;
            }
        }
    });

    // Count leads assigned to each GDO in the month
    for (const lead of assignedLeadsRaw) {
        if (!lead.assignedToId || !gdoStatsMap[lead.assignedToId]) continue;
        gdoStatsMap[lead.assignedToId].leadAssegnati++;
    }

    // Formatting for Frontend
    const result = Object.values(gdoStatsMap).map(gdo => {
        const funnelRows = Object.keys(gdo.funnelStats).map(k => {
            const row = gdo.funnelStats[k];
            return {
                funnel: k,
                fissati: row.fissati,
                confermati: row.confermati,
                presenziati: row.presenziati,
                chiusi: row.chiusi,
                percConf: row.fissati ? (row.confermati / row.fissati * 100).toFixed(0) + '%' : '-',
                percPres: row.confermati ? (row.presenziati / row.confermati * 100).toFixed(0) + '%' : '-',
                percClosed: row.presenziati ? (row.chiusi / row.presenziati * 100).toFixed(0) + '%' : '-',
            };
        });

        const weeklyRows = [
            { label: 'App Confermati', data: gdo.calendarStats.confermati },
            { label: 'App Presenziati', data: gdo.calendarStats.presenziati },
            { label: 'Chiusure (V', data: gdo.calendarStats.chiusi },
        ];

        return {
            gdoName: gdo.gdoName,
            leadAssegnati: gdo.leadAssegnati,
            percFissaggio: gdo.leadAssegnati > 0 ? (gdo.totalStats.fissati / gdo.leadAssegnati * 100).toFixed(1) + '%' : '-',
            funnelRows,
            totalRows: {
                fissati: gdo.totalStats.fissati,
                confermati: gdo.totalStats.confermati,
                presenziati: gdo.totalStats.presenziati,
                chiusi: gdo.totalStats.chiusi,
                percConf: gdo.totalStats.fissati ? (gdo.totalStats.confermati / gdo.totalStats.fissati * 100).toFixed(0) + '%' : '-',
                percPres: gdo.totalStats.confermati ? (gdo.totalStats.presenziati / gdo.totalStats.confermati * 100).toFixed(0) + '%' : '-',
                percClosed: gdo.totalStats.presenziati ? (gdo.totalStats.chiusi / gdo.totalStats.presenziati * 100).toFixed(0) + '%' : '-'
            },
            weeklyRows,
            weekNames: weeks.map(w => w.name)
        };
    });

    return result.sort((a, b) => b.totalRows.fissati - a.totalRows.fissati); // Sort by total appointments
}

/**
 * FASE 2.2: Logica GDO Frontend (Widget Ultra Veloce)
 */
export async function getCurrentGdoGamificationState(gdoUserId: string, testTodayOverride?: Date, overrides?: { role?: string; target1Override?: number; reward1Override?: number; target2Override?: number; reward2Override?: number }) {
    const today = testTodayOverride || new Date();
    const currentMonthStr = today.toISOString().slice(0, 7);
    const weeks = getMonthWeeks(currentMonthStr);

    // Quale settimana è oggi?
    let currentWeekName = "Fuori Mese";
    let currentWeekStart = today;
    let currentWeekEnd = today;

    const w = weeks.find(wk => isWithinInterval(today, { start: wk.start, end: wk.end }));
    if (w) {
        currentWeekName = w.name;
        currentWeekStart = w.start;
        currentWeekEnd = w.end;
    }

    // Default Fallbacks
    let target1 = 10, reward1 = 135;
    let target2 = 13, reward2 = 270;

    if (overrides?.target1Override) {
        target1 = overrides.target1Override;
        reward1 = overrides.reward1Override || 145;
        target2 = overrides.target2Override || 21;
        reward2 = overrides.reward2Override || 290;
    } else {
        const rules = await db.select().from(weeklyGamificationRules).where(eq(weeklyGamificationRules.month, currentMonthStr));
        if (rules.length > 0) {
            target1 = rules[0].targetTier1;
            reward1 = rules[0].rewardTier1;
            target2 = rules[0].targetTier2;
            reward2 = rules[0].rewardTier2;
        }
    }

    // Conta le presenze/conferme SOLO in questa settimana in corso.
    let currentPresences = 0;

    if (overrides?.role === 'CONFERME') {
        // Per Conferme: conta le CHIUSURE dei lead confermati da questo operatore nella settimana
        // (lead dove confirmationsUserId = questo operatore E salespersonOutcome = 'Chiuso')
        const confermeLeads = await db.select().from(leads).where(
            and(
                eq(leads.confirmationsUserId, gdoUserId),
                eq(leads.confirmationsOutcome, 'confermato'),
                eq(leads.salespersonOutcome, 'Chiuso'),
                isNotNull(leads.salespersonOutcomeAt),
                gte(leads.salespersonOutcomeAt, currentWeekStart),
                lte(leads.salespersonOutcomeAt, currentWeekEnd)
            )
        );
        currentPresences = confermeLeads.length;

        // Aggiungi aggiustamenti manuali admin per questa settimana
        try {
            const adjustments = await db.select().from(manualAdjustments).where(
                and(
                    eq(manualAdjustments.userId, gdoUserId),
                    eq(manualAdjustments.type, 'chiusure'),
                    gte(manualAdjustments.createdAt, currentWeekStart),
                    lte(manualAdjustments.createdAt, currentWeekEnd)
                )
            );
            adjustments.forEach(a => { currentPresences += a.count; });
        } catch { /* tabella non ancora migrata */ }
    } else {
        // Per GDO: conta le presenze effettive
        const monthLeads = await db.select().from(leads).where(
            and(
                eq(leads.assignedToId, gdoUserId),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, currentWeekStart),
                lte(leads.appointmentDate, currentWeekEnd)
            )
        );
        monthLeads.forEach(l => {
            if (isPresenziato(l.salespersonOutcome)) {
                currentPresences++;
            }
        });

        // Aggiungi aggiustamenti manuali admin per questa settimana
        try {
            const adjustments = await db.select().from(manualAdjustments).where(
                and(
                    eq(manualAdjustments.userId, gdoUserId),
                    eq(manualAdjustments.type, 'presenze'),
                    gte(manualAdjustments.createdAt, currentWeekStart),
                    lte(manualAdjustments.createdAt, currentWeekEnd)
                )
            );
            adjustments.forEach(a => { currentPresences += a.count; });
        } catch { /* tabella non ancora migrata */ }
    }

    return {
        currentPresences,
        target1,
        reward1,
        target2,
        reward2,
        currentWeekName,
        weekStart: currentWeekStart.toISOString().split('T')[0],
        weekEnd: currentWeekEnd.toISOString().split('T')[0]
    };
}

/**
 * F2-011: Metriche conferme/presenze/chiusure per i lead di un GDO (mese corrente)
 */
export async function getGdoLeadOutcomeMetrics(gdoUserId: string) {
    const now = new Date();
    const monthStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }).slice(0, 7);
    const startObj = parseISO(`${monthStr}-01T00:00:00`);
    const endObj = new Date(endOfMonth(startObj).getFullYear(), endOfMonth(startObj).getMonth(), endOfMonth(startObj).getDate(), 23, 59, 59, 999);

    const gdoLeads = await db.select({
        confirmationsOutcome: leads.confirmationsOutcome,
        salespersonOutcome: leads.salespersonOutcome,
    }).from(leads).where(
        and(
            eq(leads.assignedToId, gdoUserId),
            isNotNull(leads.appointmentDate),
            gte(leads.appointmentDate, startObj),
            lte(leads.appointmentDate, endObj)
        )
    );

    let fissati = 0;
    let confermati = 0;
    let presenziati = 0;
    let chiusi = 0;

    for (const lead of gdoLeads) {
        fissati++;
        const isConfermato = lead.confirmationsOutcome && lead.confirmationsOutcome.toLowerCase() !== 'scartato';
        const isPresenziatoFlag = isPresenziato(lead.salespersonOutcome);
        const isChiuso = lead.salespersonOutcome?.toLowerCase() === 'chiuso';

        if (isConfermato) confermati++;
        if (isPresenziatoFlag) presenziati++;
        if (isChiuso) chiusi++;
    }

    return { fissati, confermati, presenziati, chiusi, month: monthStr };
}

/**
 * F2-012: Obiettivi giornalieri GDO — chiamate e fissaggi di oggi
 */
export async function getGdoDailyObjectives(gdoUserId: string) {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
    const [yearStr, monthStr, dayStr] = todayStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);

    const todayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
    const todayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

    // Get user's dailyApptTarget
    const userRow = await db.select({ dailyApptTarget: users.dailyApptTarget })
        .from(users).where(eq(users.id, gdoUserId)).limit(1);
    const dailyApptTarget = userRow[0]?.dailyApptTarget || 2;

    // Count today's calls from callLogs
    const callResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(callLogs)
        .where(and(
            eq(callLogs.userId, gdoUserId),
            gte(callLogs.createdAt, todayStart),
            lte(callLogs.createdAt, todayEnd)
        ));
    const callsDone = callResult[0]?.count || 0;

    // Count today's appointments set by this GDO
    const apptResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(leads)
        .where(and(
            eq(leads.assignedToId, gdoUserId),
            isNotNull(leads.appointmentCreatedAt),
            gte(leads.appointmentCreatedAt, todayStart),
            lte(leads.appointmentCreatedAt, todayEnd)
        ));
    const appointmentsDone = apptResult[0]?.count || 0;

    // Count leads in pipeline (assigned, not yet with appointment, active statuses)
    const pipelineResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(leads)
        .where(and(
            eq(leads.assignedToId, gdoUserId),
            or(eq(leads.status, 'NEW'), eq(leads.status, 'IN_PROGRESS'))
        ));
    const pipelineSize = pipelineResult[0]?.count || 0;

    return {
        callsDone,
        pipelineSize,
        appointmentsDone,
        appointmentsTarget: dailyApptTarget,
    };
}
