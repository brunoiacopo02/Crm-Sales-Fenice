"use server";

import { db } from "@/db";
import { leads, marketingBudgets } from "@/db/schema";
import { and, eq, ne, isNotNull, gte, lte } from "drizzle-orm";
import { startOfMonth, endOfMonth, parseISO } from "date-fns";

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

export async function getMarketingStats(monthString: string) {
    // monthString format: "YYYY-MM"
    const startDate = startOfMonth(parseISO(`${monthString}-01`));
    const endDate = endOfMonth(parseISO(`${monthString}-01`));

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
            roas = ((stat.fatturato - spentAmountEur) / spentAmountEur) * 100;
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
