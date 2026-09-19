"use server";

import { db } from "@/db";
import { leads, marketingBudgets } from "@/db/schema";
import { and, eq, isNotNull, isNull, gte, lte, or, sql } from "drizzle-orm";
import { currentTenant, assertSalesArea } from '@/lib/tenancy';
import { leadIntakeAt } from '@/lib/kpi/canon';
import { contaNeiKpi } from '@/lib/intakeBatch';
import { PINNED_FUNNELS, byVolumeThenName, funnelKey, orderFunnels } from '@/lib/kpi/marketingFunnels';

/**
 * Filtro dei funnel: ESCLUSIONE, non più whitelist (PO 2026-09-19).
 * Si escludono solo TEST / BLT / vuoto; l'elenco dei funnel mostrati è
 * derivato dai dati — vedi `@/lib/kpi/marketingFunnels` per il perché.
 * Case-insensitive: a DB convivono 'test', 'Database' e 'DATABASE'.
 */
function funnelNonDiServizio() {
    return sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('TEST', 'BLT', '')`;
}

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
            funnelNonDiServizio(),
            // Lead dei pool /import (launchBucket) non ancora assegnati =
            // magazzino: contano solo dall'assegnazione (PO 2026-07-20).
            or(isNull(leads.launchBucket), isNotNull(leads.assignedToId)),
            or(
                // Ingresso in circolazione = COALESCE(assignedAt, createdAt),
                // regola canonica migr. 0027 (leadIntakeAt). Senza il ramo su
                // assignedAt, un lead del pool creato a luglio e distribuito
                // dal TL ad agosto non veniva nemmeno pescato per agosto.
                sql`COALESCE(${leads.assignedAt}, ${leads.createdAt}) >= ${startDate} AND COALESCE(${leads.assignedAt}, ${leads.createdAt}) <= ${endDate}`,
                and(gte(leads.appointmentCreatedAt, startDate), lte(leads.appointmentCreatedAt, endDate)),
                and(gte(leads.confirmationsTimestamp, startDate), lte(leads.confirmationsTimestamp, endDate)),
                and(gte(leads.salespersonOutcomeAt, startDate), lte(leads.salespersonOutcomeAt, endDate)),
                and(gte(leads.presentedAt, startDate), lte(leads.presentedAt, endDate)),
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
    type FunnelRow = {
        funnel: string;
        leads: number;
        leadAssegnati: number;
        apps: number;
        conferme: number;
        trattative: number;
        close: number;
        fatturato: number;
    };
    const grouped: Record<string, FunnelRow> = {};
    const rigaVuota = (f: string): FunnelRow => ({
        funnel: f,
        leads: 0,
        leadAssegnati: 0,
        apps: 0,
        conferme: 0,
        trattative: 0,
        close: 0,
        fatturato: 0,
    });

    // I funnel storici ci sono sempre, anche a zero (righe stabili fra i mesi).
    for (const f of PINNED_FUNNELS) {
        grouped[f] = rigaVuota(f);
    }
    // Un funnel con una spesa registrata compare anche se nel mese non ha
    // prodotto nulla: altrimenti il budget resterebbe invisibile.
    for (const b of budgets) {
        const key = funnelKey(b.funnel);
        if (key && !grouped[key]) grouped[key] = rigaVuota(key);
    }

    for (const l of allLeads) {
        // Elenco derivato dai dati: un funnel mai visto prima crea la sua riga
        // invece di far sparire i lead (vecchia whitelist OFFICIAL_FUNNELS).
        const rawFunnel = funnelKey(l.funnel);
        const g = grouped[rawFunnel] ?? (grouped[rawFunnel] = rigaVuota(rawFunnel));

        // Il filtro sull'infornata anomala sta sul contatore, non nel WHERE:
        // la query pesca con un OR su tutte le date evento, e nel WHERE
        // avrebbe cancellato anche gli appuntamenti veri di quell'infornata.
        const leadAcquisitoNelMese = inMonth(leadIntakeAt(l)) && contaNeiKpi(l);
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

        // Trattative: latch presentedAt (PO 2026-07-17) — presenza contata nel giorno
        // dell'appuntamento, non sparisce con esiti successivi.
        if (l.presentedAt && inMonth(l.presentedAt)) {
            g.trattative++;
        }
        // Close: data dell'azione = salespersonOutcomeAt.
        if (l.appointmentDate && l.salespersonOutcome === 'Chiuso' && inMonth(l.salespersonOutcomeAt)) {
            g.close++;
            g.fatturato += l.closeAmountEur || 0;
        }
    }

    // Un funnel non storico entra in tabella solo se nel mese ha prodotto
    // qualcosa (o ha una spesa): la query pesca in OR su tutte le date evento
    // e può tirare su funnel che nel mese non contano nulla. I funnel storici
    // restano sempre, anche a zero.
    const conSegnale = Object.keys(grouped).filter(f => {
        const s = grouped[f];
        return s.leads > 0 || s.apps > 0 || s.conferme > 0 || s.trattative > 0
            || s.close > 0 || s.fatturato > 0
            || budgets.some(b => funnelKey(b.funnel) === f);
    });

    // Ordine delle righe: i funnel storici in testa (ordine invariato), poi
    // tutti gli altri per volume decrescente — lead, appuntamenti, alfabetico.
    const rowOrder = orderFunnels(
        conSegnale,
        byVolumeThenName(f => grouped[f]?.leads ?? 0, f => grouped[f]?.apps ?? 0),
    );

    const statsArray = rowOrder.map(funnelName => {
        const stat = grouped[funnelName] ?? rigaVuota(funnelName);
        // Abbinamento budget case-insensitive: le righe storiche sono salvate
        // MAIUSCOLE (il menu a tendina serve i nomi già normalizzati), ma una
        // grafia diversa non deve far perdere la spesa.
        const budgetRow = budgets.find(b => funnelKey(b.funnel) === funnelName);
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
            funnelNonDiServizio(),
            // Lead dei pool /import (launchBucket) non ancora assegnati =
            // magazzino: contano solo dall'assegnazione (PO 2026-07-20).
            or(isNull(leads.launchBucket), isNotNull(leads.assignedToId)),
            or(
                // Ingresso in circolazione = COALESCE(assignedAt, createdAt),
                // regola canonica migr. 0027 (leadIntakeAt). Senza il ramo su
                // assignedAt, un lead del pool creato a luglio e distribuito
                // dal TL ad agosto non veniva nemmeno pescato per agosto.
                sql`COALESCE(${leads.assignedAt}, ${leads.createdAt}) >= ${startDate} AND COALESCE(${leads.assignedAt}, ${leads.createdAt}) <= ${endDate}`,
                and(gte(leads.appointmentCreatedAt, startDate), lte(leads.appointmentCreatedAt, endDate)),
                and(gte(leads.confirmationsTimestamp, startDate), lte(leads.confirmationsTimestamp, endDate)),
                and(gte(leads.salespersonOutcomeAt, startDate), lte(leads.salespersonOutcomeAt, endDate)),
                and(gte(leads.presentedAt, startDate), lte(leads.presentedAt, endDate)),
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

    // I funnel storici hanno sempre la loro card, anche vuota.
    for (const f of PINNED_FUNNELS) {
        result[f] = {};
    }

    for (const l of allLeads) {
        // Elenco derivato dai dati, non da una whitelist (vedi getMarketingStats).
        const rawFunnel = funnelKey(l.funnel);
        if (!result[rawFunnel]) result[rawFunnel] = {};

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

        // Lead assegnati: entrato in circolazione nel mese (leadIntakeAt) e
        // assegnato. Sul createdAt puro i lead dei pool distribuiti dal TL
        // finivano tutti nel mese in cui il pool era stato sincronizzato da AC.
        // Filtro infornata anomala sul contatore, non nel WHERE (vedi
        // getMarketingStats): qui sotto si contano anche gli appuntamenti.
        if (inMonth(leadIntakeAt(l)) && l.assignedToId && contaNeiKpi(l)) {
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

        // Presenziato: latch presentedAt (PO 2026-07-17) — giorno dell'appuntamento,
        // non sparisce con esiti successivi.
        if (l.presentedAt && inMonth(l.presentedAt)) {
            gdoStat.appsPresenziati++;
        }
        // Close: data dell'azione = salespersonOutcomeAt.
        if (l.appointmentDate && l.salespersonOutcome === 'Chiuso' && inMonth(l.salespersonOutcomeAt)) {
            gdoStat.closed++;
            gdoStat.fatturato += l.closeAmountEur || 0;
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

    // Stesso ordine della tabella globale: storici in testa, poi gli altri per
    // volume (lead presi in carico, poi appuntamenti fissati).
    const sommaSu = (f: string, campo: 'leadAssegnati' | 'appsFissati') =>
        Object.values(result[f] ?? {}).reduce((n, s) => n + s[campo], 0);
    // Come nella tabella globale: una card nuova compare solo se ha numeri.
    const conSegnale = Object.keys(result).filter(f =>
        Object.values(result[f] ?? {}).some(s =>
            s.leadAssegnati > 0 || s.appsFissati > 0 || s.appsConfermati > 0
            || s.appsPresenziati > 0 || s.closed > 0 || s.fatturato > 0));
    const cardOrder = orderFunnels(
        conSegnale,
        byVolumeThenName(f => sommaSu(f, 'leadAssegnati'), f => sommaSu(f, 'appsFissati')),
    );

    for (const f of cardOrder) {
        const gdoKeys = Object.keys(result[f] ?? {});
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
