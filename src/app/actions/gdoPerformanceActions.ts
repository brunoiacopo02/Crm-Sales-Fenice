'use server';

import { db } from "@/db";
import { leads, users, weeklyGamificationRules } from "@/db/schema";
import { eq, and, gte, lte, isNotNull, sql } from "drizzle-orm";
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

    const monthLeads = await db.select().from(leads).where(
        and(
            isNotNull(leads.appointmentDate),
            gte(leads.appointmentDate, startObj),
            lte(leads.appointmentDate, endObj)
        )
    );

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
            }
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
export async function getCurrentGdoGamificationState(gdoUserId: string, testTodayOverride?: Date) {
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

    const rules = await db.select().from(weeklyGamificationRules).where(eq(weeklyGamificationRules.month, currentMonthStr));
    if (rules.length > 0) {
        target1 = rules[0].targetTier1;
        reward1 = rules[0].rewardTier1;
        target2 = rules[0].targetTier2;
        reward2 = rules[0].rewardTier2;
    }

    // Conta le presenze matematiche SOLO in questa settimana in corso.
    const monthLeads = await db.select().from(leads).where(
        and(
            eq(leads.assignedToId, gdoUserId),
            isNotNull(leads.appointmentDate),
            gte(leads.appointmentDate, currentWeekStart),
            lte(leads.appointmentDate, currentWeekEnd)
        )
    );

    let currentPresences = 0;
    monthLeads.forEach(l => {
        if (isPresenziato(l.salespersonOutcome)) {
            currentPresences++;
        }
    });

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
