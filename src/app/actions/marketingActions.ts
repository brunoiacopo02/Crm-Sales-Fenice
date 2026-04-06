"use server";

import { db } from "@/db";
import { leads, marketingBudgets } from "@/db/schema";
import { and, eq, ne, isNotNull, gte, lte } from "drizzle-orm";

const OFFICIAL_FUNNELS = [
    "TELEGRAM",
    "JOB SIMULATOR",
    "CORSO 10 ORE",
    "ORG",
    "DATABASE",
    "TELEGRAM-TK",
    "GOOGLE",
    "SOCIAL"
];

/** Convert "YYYY-MM-DD" to UTC Date at start of that day in Europe/Rome */
function toRomeStartOfDay(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const noon = new Date(Date.UTC(y, m - 1, d, 12));
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        timeZoneName: 'longOffset'
    });
    const parts = fmt.formatToParts(noon);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+01:00';
    const offset = tzPart.replace('GMT', '') || '+00:00';
    return new Date(`${dateStr}T00:00:00${offset}`);
}

/** Convert "YYYY-MM-DD" to UTC Date at end of that day (23:59:59.999) in Europe/Rome */
function toRomeEndOfDay(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const noon = new Date(Date.UTC(y, m - 1, d, 12));
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        timeZoneName: 'longOffset'
    });
    const parts = fmt.formatToParts(noon);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+01:00';
    const offset = tzPart.replace('GMT', '') || '+00:00';
    return new Date(`${dateStr}T23:59:59.999${offset}`);
}

/** Get first and last day strings of a month from "YYYY-MM" */
function getMonthBounds(monthString: string): { startDateStr: string; endDateStr: string } {
    const [yearStr, monthStr] = monthString.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    const lastDay = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this month
    return {
        startDateStr: `${monthString}-01`,
        endDateStr: `${monthString}-${String(lastDay).padStart(2, '0')}`
    };
}

export async function getMarketingStats(monthString: string) {
    // monthString format: "YYYY-MM"
    const { startDateStr, endDateStr } = getMonthBounds(monthString);
    const startDate = toRomeStartOfDay(startDateStr);
    const endDate = toRomeEndOfDay(endDateStr);

    // Get leads for the month that have a funnel != 'BLT'
    const allLeads = await db.select().from(leads).where(
        and(
            isNotNull(leads.funnel),
            ne(leads.funnel, 'BLT'),
            ne(leads.funnel, ''),
            gte(leads.createdAt, startDate),
            lte(leads.createdAt, endDate)
        )
    );

    // Get budgets for the month
    const budgets = await db.select().from(marketingBudgets).where(
        eq(marketingBudgets.month, monthString)
    );

    // Grouping
    const grouped: Record<string, any> = {};

    // Inizializza TUTTI i funnel ufficiali a zero
    for (const f of OFFICIAL_FUNNELS) {
        grouped[f] = {
            funnel: f,
            leads: 0,
            apps: 0,
            conferme: 0,
            trattative: 0,
            close: 0,
            fatturato: 0,
        };
    }

    for (const l of allLeads) {
        const rawFunnel = (l.funnel as string).toUpperCase();

        // Count only if the funnel is in the official list
        if (grouped[rawFunnel]) {
            grouped[rawFunnel].leads++;

            if (l.appointmentDate) {
                grouped[rawFunnel].apps++;

                const isConfirmed = (l.confirmationsOutcome && l.confirmationsOutcome.toLowerCase() !== 'scartato') || !!l.salespersonUserId;
                if (isConfirmed) {
                    grouped[rawFunnel].conferme++;

                    const showUp = l.salespersonOutcome &&
                        l.salespersonOutcome !== 'Sparito' &&
                        l.salespersonOutcome !== 'Lead non presenziato' &&
                        l.salespersonOutcome !== 'KO - Assente';

                    if (showUp) {
                        grouped[rawFunnel].trattative++;

                        if (l.salespersonOutcome === 'Chiuso') {
                            grouped[rawFunnel].close++;
                            grouped[rawFunnel].fatturato += l.closeAmountEur || 0;
                        }
                    }
                }
            }
        }
    }

    // Now convert to array exactly following OFFICIAL_FUNNELS order
    const statsArray = OFFICIAL_FUNNELS.map(funnelName => {
        const stat = grouped[funnelName];
        const budgetRow = budgets.find(b => b.funnel === funnelName);
        const spentAmountEur = budgetRow?.spentAmountEur || 0;

        const appsPercLead = stat.leads > 0 ? (stat.apps / stat.leads) * 100 : 0;
        const confermePercLead = stat.leads > 0 ? (stat.conferme / stat.leads) * 100 : 0;
        const trattativePercLead = stat.leads > 0 ? (stat.trattative / stat.leads) * 100 : 0;
        const closePercLead = stat.leads > 0 ? (stat.close / stat.leads) * 100 : 0;

        let roas = 0;
        if (spentAmountEur > 0) {
            roas = (stat.fatturato / spentAmountEur) * 100;
        }

        return {
            ...stat,
            appsPerc: appsPercLead,
            confermePerc: confermePercLead,
            trattativePerc: trattativePercLead,
            closePerc: closePercLead,
            spentAmountEur,
            roas
        };
    });

    return statsArray;
}

export async function saveMarketingBudget(funnel: string, month: string, spentAmountEur: number) {
    const existing = await db.select().from(marketingBudgets).where(
        and(
            eq(marketingBudgets.funnel, funnel),
            eq(marketingBudgets.month, month)
        )
    ).limit(1);

    if (existing.length > 0) {
        await db.update(marketingBudgets)
            .set({ spentAmountEur, updatedAt: new Date() })
            .where(eq(marketingBudgets.id, existing[0].id));
    } else {
        await db.insert(marketingBudgets).values({
            id: crypto.randomUUID(),
            funnel,
            month,
            spentAmountEur,
        });
    }

    return { success: true };
}

export async function getMarketingStatsByGdo(monthString: string) {
    const { startDateStr, endDateStr } = getMonthBounds(monthString);
    const startDate = toRomeStartOfDay(startDateStr);
    const endDate = toRomeEndOfDay(endDateStr);

    // Get leads for the month that have a funnel != 'BLT'
    const allLeads = await db.select().from(leads).where(
        and(
            isNotNull(leads.funnel),
            ne(leads.funnel, 'BLT'),
            ne(leads.funnel, ''),
            gte(leads.createdAt, startDate),
            lte(leads.createdAt, endDate)
        )
    );

    // Fetch all relevant users for quick reference
    const { users } = await import("@/db/schema");
    const allUsers = await db.select({ id: users.id, displayName: users.displayName, name: users.name, gdoCode: users.gdoCode }).from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    const result: Record<string, Record<string, {
        gdoName: string;
        appsFissati: number;
        appsConfermati: number;
        appsPresenziati: number;
        closed: number;
    }>> = {};

    // Inizializza TUTTI i funnel ufficiali a vuoto
    for (const f of OFFICIAL_FUNNELS) {
        result[f] = {};
    }

    for (const l of allLeads) {
        const rawFunnel = (l.funnel as string).toUpperCase();

        if (result[rawFunnel]) {
            const assignedId = l.assignedToId || 'UNASSIGNED';
            let gdoName = 'Non Assegnato';

            if (assignedId !== 'UNASSIGNED') {
                const u = userMap.get(assignedId);
                gdoName = u ? `${u.displayName || u.name || assignedId} ${u.gdoCode ? `(${u.gdoCode})` : ''}`.trim() : assignedId;
            }

            if (!result[rawFunnel][assignedId]) {
                result[rawFunnel][assignedId] = {
                    gdoName,
                    appsFissati: 0,
                    appsConfermati: 0,
                    appsPresenziati: 0,
                    closed: 0,
                };
            }

            const gdoStat = result[rawFunnel][assignedId];

            if (l.appointmentDate) {
                gdoStat.appsFissati++;

                const isConfirmed = (l.confirmationsOutcome && l.confirmationsOutcome.toLowerCase() !== 'scartato') || !!l.salespersonUserId;
                if (isConfirmed) {
                    gdoStat.appsConfermati++;

                    const showUp = l.salespersonOutcome &&
                        l.salespersonOutcome !== 'Sparito' &&
                        l.salespersonOutcome !== 'Lead non presenziato' &&
                        l.salespersonOutcome !== 'KO - Assente';

                    if (showUp) {
                        gdoStat.appsPresenziati++;

                        if (l.salespersonOutcome === 'Chiuso') {
                            gdoStat.closed++;
                        }
                    }
                }
            }
        }
    }

    // Convert to Array output with proper percentages
    const finalArray: {
        funnel: string;
        gdoStats: {
            gdoName: string;
            appsFissati: number;
            appsConfermati: number;
            confermePerc: number;
            appsPresenziati: number;
            presenziatiPerc: number;
            closed: number;
            closedPerc: number;
        }[]
    }[] = [];

    for (const f of OFFICIAL_FUNNELS) {
        const gdoKeys = Object.keys(result[f]);
        const gdoStatsArr = gdoKeys.map(key => {
            const stat = result[f][key];

            const confermePerc = stat.appsFissati > 0 ? (stat.appsConfermati / stat.appsFissati) * 100 : 0;
            const presenziatiPerc = stat.appsConfermati > 0 ? (stat.appsPresenziati / stat.appsConfermati) * 100 : 0;
            const closedPerc = stat.appsPresenziati > 0 ? (stat.closed / stat.appsPresenziati) * 100 : 0;

            return {
                gdoName: stat.gdoName,
                appsFissati: stat.appsFissati,
                appsConfermati: stat.appsConfermati,
                confermePerc,
                appsPresenziati: stat.appsPresenziati,
                presenziatiPerc,
                closed: stat.closed,
                closedPerc
            };
        });

        // Add to final array even if empty (to render the card structure natively)
        finalArray.push({
            funnel: f,
            gdoStats: gdoStatsArr.sort((a, b) => b.appsFissati - a.appsFissati) // Ordina per chi ha fissato di più
        });
    }

    return finalArray;
}
