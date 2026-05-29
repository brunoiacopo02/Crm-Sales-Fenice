"use server";

import { db } from "@/db";
import { leads, marketingBudgets } from "@/db/schema";
import { and, eq, ne, isNotNull, gte, lte, or } from "drizzle-orm";
import { currentTenant, assertSalesArea } from '@/lib/tenancy';

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
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    // monthString format: "YYYY-MM"
    const { startDateStr, endDateStr } = getMonthBounds(monthString);
    const startDate = toRomeStartOfDay(startDateStr);
    const endDate = toRomeEndOfDay(endDateStr);

    // Each metric is attributed to the month in which the corresponding action
    // happened — non al mese di creazione del lead. Quindi:
    //   • Lead acquisiti      → createdAt nel mese
    //   • App. fissati        → appointmentCreatedAt nel mese
    //   • Conferme            → confirmationsTimestamp nel mese
    //   • Trattative / Close  → salespersonOutcomeAt nel mese
    // Pesco con un OR su tutte e 4 le date per non perdere lead "longitudinali"
    // (creati a marzo ma chiusi a maggio, ecc.).
    const inMonth = (d: Date | null | undefined): boolean =>
        !!d && d >= startDate && d <= endDate;

    const allLeads = await db.select().from(leads).where(
        and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.funnel),
            ne(leads.funnel, 'BLT'),
            ne(leads.funnel, ''),
            or(
                and(gte(leads.createdAt, startDate), lte(leads.createdAt, endDate)),
                and(gte(leads.appointmentCreatedAt, startDate), lte(leads.appointmentCreatedAt, endDate)),
                and(gte(leads.confirmationsTimestamp, startDate), lte(leads.confirmationsTimestamp, endDate)),
                and(gte(leads.salespersonOutcomeAt, startDate), lte(leads.salespersonOutcomeAt, endDate)),
            )
        )
    );

    // Get budgets for the month
    const budgets = await db.select().from(marketingBudgets).where(
        and(
            eq(marketingBudgets.companyId, ctx.companyId),
            eq(marketingBudgets.month, monthString)
        )
    );

    // Grouping
    const grouped: Record<string, any> = {};

    // Inizializza TUTTI i funnel ufficiali a zero
    for (const f of OFFICIAL_FUNNELS) {
        grouped[f] = {
            funnel: f,
            leads: 0,
            leadAssegnati: 0,
            apps: 0,
            conferme: 0,
            trattative: 0,
            close: 0,
            fatturato: 0,
        };
    }

    for (const l of allLeads) {
        const rawFunnel = (l.funnel as string).toUpperCase();
        const g = grouped[rawFunnel];
        if (!g) continue;

        const leadAcquisitoNelMese = inMonth(l.createdAt);
        if (leadAcquisitoNelMese) {
            g.leads++;
            if (l.assignedToId) g.leadAssegnati++;
        }

        // App fissati: data dell'azione = appointmentCreatedAt (fallback appointmentDate per dati legacy)
        const apptSetAt = l.appointmentCreatedAt || l.appointmentDate;
        if (l.appointmentDate && inMonth(apptSetAt)) {
            g.apps++;
        }

        // Conferme: data dell'azione = confirmationsTimestamp.
        // Definizione canonica = confirmationsOutcome === 'confermato' (Sprint 1.4).
        const isConfirmed = l.confirmationsOutcome === 'confermato';
        if (l.appointmentDate && isConfirmed && inMonth(l.confirmationsTimestamp)) {
            g.conferme++;
        }

        // Trattative / Close: data dell'azione = salespersonOutcomeAt.
        // Presenziato canonico = whitelist Chiuso/Non chiuso (Sprint 1.5).
        const showUp = l.salespersonOutcome === 'Chiuso' || l.salespersonOutcome === 'Non chiuso';
        if (l.appointmentDate && showUp && inMonth(l.salespersonOutcomeAt)) {
            g.trattative++;
            if (l.salespersonOutcome === 'Chiuso') {
                g.close++;
                g.fatturato += l.closeAmountEur || 0;
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
        const fissaggioPerc = stat.leadAssegnati > 0 ? (stat.apps / stat.leadAssegnati) * 100 : 0;

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
            fissaggioPerc,
            spentAmountEur,
            roas
        };
    });

    return statsArray;
}

export async function saveMarketingBudget(funnel: string, month: string, spentAmountEur: number) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const existing = await db.select().from(marketingBudgets).where(
        and(
            eq(marketingBudgets.companyId, ctx.companyId),
            eq(marketingBudgets.funnel, funnel),
            eq(marketingBudgets.month, month)
        )
    ).limit(1);

    if (existing.length > 0) {
        await db.update(marketingBudgets)
            .set({ spentAmountEur, updatedAt: new Date() })
            .where(and(
                eq(marketingBudgets.companyId, ctx.companyId),
                eq(marketingBudgets.id, existing[0].id)
            ));
    } else {
        await db.insert(marketingBudgets).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            funnel,
            month,
            spentAmountEur,
        });
    }

    return { success: true };
}

export async function getMarketingStatsByGdo(monthString: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const { startDateStr, endDateStr } = getMonthBounds(monthString);
    const startDate = toRomeStartOfDay(startDateStr);
    const endDate = toRomeEndOfDay(endDateStr);

    // Stessa logica action-date di getMarketingStats: ogni metrica viene contata
    // nel mese in cui è stata effettuata l'azione, non nel mese di creazione del lead.
    const inMonth = (d: Date | null | undefined): boolean =>
        !!d && d >= startDate && d <= endDate;

    const allLeads = await db.select().from(leads).where(
        and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.funnel),
            ne(leads.funnel, 'BLT'),
            ne(leads.funnel, ''),
            or(
                and(gte(leads.createdAt, startDate), lte(leads.createdAt, endDate)),
                and(gte(leads.appointmentCreatedAt, startDate), lte(leads.appointmentCreatedAt, endDate)),
                and(gte(leads.confirmationsTimestamp, startDate), lte(leads.confirmationsTimestamp, endDate)),
                and(gte(leads.salespersonOutcomeAt, startDate), lte(leads.salespersonOutcomeAt, endDate)),
            )
        )
    );

    // Fetch all relevant users for quick reference
    const { users } = await import("@/db/schema");
    const allUsers = await db.select({ id: users.id, displayName: users.displayName, name: users.name, gdoCode: users.gdoCode }).from(users).where(eq(users.companyId, ctx.companyId));
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    const result: Record<string, Record<string, {
        gdoName: string;
        leadAssegnati: number;
        appsFissati: number;
        appsConfermati: number;
        appsPresenziati: number;
        closed: number;
        fatturato: number;
    }>> = {};

    // Inizializza TUTTI i funnel ufficiali a vuoto
    for (const f of OFFICIAL_FUNNELS) {
        result[f] = {};
    }

    for (const l of allLeads) {
        const rawFunnel = (l.funnel as string).toUpperCase();
        if (!result[rawFunnel]) continue;

        const assignedId = l.assignedToId || 'UNASSIGNED';
        let gdoName = 'Non Assegnato';
        if (assignedId !== 'UNASSIGNED') {
            const u = userMap.get(assignedId);
            gdoName = u ? `${u.displayName || u.name || assignedId} ${u.gdoCode ? `(${u.gdoCode})` : ''}`.trim() : assignedId;
        }
        if (!result[rawFunnel][assignedId]) {
            result[rawFunnel][assignedId] = {
                gdoName,
                leadAssegnati: 0,
                appsFissati: 0,
                appsConfermati: 0,
                appsPresenziati: 0,
                closed: 0,
                fatturato: 0,
            };
        }

        const gdoStat = result[rawFunnel][assignedId];

        // Lead assegnati: lead creato e assegnato nel mese
        if (inMonth(l.createdAt) && l.assignedToId) {
            gdoStat.leadAssegnati++;
        }

        // App fissati: data fissaggio = appointmentCreatedAt (fallback appointmentDate)
        const apptSetAt = l.appointmentCreatedAt || l.appointmentDate;
        if (l.appointmentDate && inMonth(apptSetAt)) {
            gdoStat.appsFissati++;
        }

        // Confermato canonico = 'confermato' (Sprint 1.4).
        const isConfirmed = l.confirmationsOutcome === 'confermato';
        if (l.appointmentDate && isConfirmed && inMonth(l.confirmationsTimestamp)) {
            gdoStat.appsConfermati++;
        }

        // Presenziato canonico = whitelist Chiuso/Non chiuso (Sprint 1.5).
        const showUp = l.salespersonOutcome === 'Chiuso' || l.salespersonOutcome === 'Non chiuso';
        if (l.appointmentDate && showUp && inMonth(l.salespersonOutcomeAt)) {
            gdoStat.appsPresenziati++;
            if (l.salespersonOutcome === 'Chiuso') {
                gdoStat.closed++;
                gdoStat.fatturato += l.closeAmountEur || 0;
            }
        }
    }

    // Convert to Array output with proper percentages
    const finalArray: {
        funnel: string;
        gdoStats: {
            gdoName: string;
            leadAssegnati: number;
            fissaggioPerc: number;
            appsFissati: number;
            appsConfermati: number;
            confermePerc: number;
            appsPresenziati: number;
            presenziatiPerc: number;
            closed: number;
            closedPerc: number;
            fatturato: number;
        }[]
    }[] = [];

    for (const f of OFFICIAL_FUNNELS) {
        const gdoKeys = Object.keys(result[f]);
        const gdoStatsArr = gdoKeys.map(key => {
            const stat = result[f][key];

            const fissaggioPerc = stat.leadAssegnati > 0 ? (stat.appsFissati / stat.leadAssegnati) * 100 : 0;
            const confermePerc = stat.appsFissati > 0 ? (stat.appsConfermati / stat.appsFissati) * 100 : 0;
            const presenziatiPerc = stat.appsConfermati > 0 ? (stat.appsPresenziati / stat.appsConfermati) * 100 : 0;
            const closedPerc = stat.appsPresenziati > 0 ? (stat.closed / stat.appsPresenziati) * 100 : 0;

            return {
                gdoName: stat.gdoName,
                leadAssegnati: stat.leadAssegnati,
                fissaggioPerc,
                appsFissati: stat.appsFissati,
                appsConfermati: stat.appsConfermati,
                confermePerc,
                appsPresenziati: stat.appsPresenziati,
                presenziatiPerc,
                closed: stat.closed,
                closedPerc,
                fatturato: stat.fatturato,
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
