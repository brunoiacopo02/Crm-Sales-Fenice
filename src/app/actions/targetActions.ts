'use server';

import { db } from '@/db';
import { monthlyLeadTargets, dailyKpiSnapshots, users, leads } from '@/db/schema';
import { eq, and, sql, gte, lt, lte, or, inArray, isNotNull, asc } from 'drizzle-orm';
import crypto from 'crypto';
import { currentTenant, assertSalesArea } from '@/lib/tenancy';
import { isStatsGdo, apptSetAt as canonApptSetAt } from '@/lib/kpi/canon';
import { monthBoundsRome, dayBoundsRome, toRomeDateStr } from '@/lib/dateUtils';
import { countWorkingDaysInMonth, countWorkingDaysElapsed } from '@/lib/workingDaysUtils';

// Tipi di utilità per i target
export interface MonthlyTargetInput {
    month: string;
    targetAppFissati: number;
    targetAppConfermati: number;
    targetTrattative: number;
    targetClosed: number;
    targetValoreContratti: number;
    workingDaysOverride?: number | null;
}

export interface LeadCategoryBreakdown {
    totale: number;
    fissati: number;
    confermati: number;
    presenziati: number;
    closed: number;
    valoreContratti: number;
}

export interface TargetStatsResponse {
    // Info Temporali e di Sistema
    month: string;
    giorniLavorativiTotaliMese: number;
    giorniLavorativiTrascorsiOggi: number;
    gdoAttivi: number;
    totaleLeadDelMese: number;

    // Suddivisione Nuovi vs Database (escluso BLT)
    breakdownNuovi: LeadCategoryBreakdown;
    breakdownDatabase: LeadCategoryBreakdown;

    // Numeri Mensili - Dati
    actAppsFissati: number;
    actAppsConfermati: number;
    actAppsPresenziati: number;
    actClosed: number;
    actValoreContratti: number;

    // Numeri Mensili - Percentuali e Targets
    targetData: MonthlyTargetInput;

    actPercFissati: number;
    actPercConfermati: number;
    actPercPresenziati: number;
    trattativeSuLeadPerc: number;
    actPercClosed: number;

    // Numeri Mensili - Today
    todayFissati: number;
    todayConfermati: number;
    todayPresenziati: number;
    todayClosed: number;

    // Numeri Mensili - Target / Day
    targetDayFissati: number;
    targetDayConfermati: number;
    targetDayPresenziati: number;
    targetDayClosed: number;
    targetDayValoreContratti: number;

    // DATO & Forecast
    fissaggioVariazionePerc: number; // Rispetto al target % Fissaggio
    fissaggioVariazioneAss: number; // ACT_Perc - TARGET_PREV_Perc
    mediaAppDayGdo: number;
    mediaVenditePrevisteMeseGdo: number;

    // Working Days Override
    workingDaysOverride: number | null;

    // Logica 7 Giorni Alert
    dataPrimoMeno20: string | null;
    is7DaysAlertActive: boolean;
}

/**
 * Calcola i giorni lavorativi (Europe/Rome, festività italiane incluse — Pasquetta
 * mobile compresa, sabati lavorativi) in un determinato mese testuale (es. 2026-03),
 * usando gli helper canonici di `workingDaysUtils.ts`.
 */
function getDateMetrics(monthString: string, testTodayOverride?: Date) {
    const today = testTodayOverride || new Date();

    const [year, month] = monthString.split('-').map(Number);

    const giorniLavorativiTotaliMese = countWorkingDaysInMonth(year, month);
    const giorniLavorativiTrascorsiOggi = countWorkingDaysElapsed(year, month, today);

    return { giorniLavorativiTotaliMese, giorniLavorativiTrascorsiOggi, today };
}

/**
 * Salva i target impostati dal manager.
 *
 * Unificato sulla tabella canonica `monthlyLeadTargets` (stessa fonte del
 * Sales Manager, decisione PO 2026-07-05 — Task B5). `monthlyTargets` (legacy)
 * NON viene più letta né scritta da qui, ma resta nel DB con i suoi dati.
 *
 * Mappatura campi: targetAppFissati→targetAppMonthly, targetAppConfermati→
 * targetConfMonthly, targetTrattative→targetPresMonthly, targetClosed→
 * targetCloseMonthly, targetValoreContratti→targetFatturatoMonthly,
 * workingDaysOverride→workingDays. Chiave: month ('YYYY-MM') → yearMonth.
 */
export async function saveMonthlyTarget(target: MonthlyTargetInput) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const existing = await db.select().from(monthlyLeadTargets).where(and(
        eq(monthlyLeadTargets.companyId, ctx.companyId),
        eq(monthlyLeadTargets.yearMonth, target.month),
    ));

    // `workingDays` su monthlyLeadTargets è NOT NULL (colonna condivisa col
    // Sales Manager, che la richiede sempre > 0): non può rappresentare "nessun
    // override" con null come faceva `monthlyTargets.workingDaysOverride`. Se il
    // manager sceglie "calcolo automatico" (workingDaysOverride null/0),
    // valorizziamo comunque il campo con il conteggio automatico corrente
    // (Rome-aware, festività incluse) invece di lasciarlo indefinito.
    const [year, month] = target.month.split('-').map(Number);
    const resolvedWorkingDays = (target.workingDaysOverride != null && target.workingDaysOverride > 0)
        ? target.workingDaysOverride
        : countWorkingDaysInMonth(year, month);

    const metricFields = {
        targetAppMonthly: target.targetAppFissati,
        targetConfMonthly: target.targetAppConfermati,
        targetPresMonthly: target.targetTrattative,
        targetCloseMonthly: target.targetClosed,
        targetFatturatoMonthly: target.targetValoreContratti,
        workingDays: resolvedWorkingDays,
    };

    if (existing.length > 0) {
        await db.update(monthlyLeadTargets)
            .set({
                ...metricFields,
                updatedAt: new Date(),
            })
            .where(and(
                eq(monthlyLeadTargets.companyId, ctx.companyId),
                eq(monthlyLeadTargets.id, existing[0].id),
            ));
    } else {
        await db.insert(monthlyLeadTargets).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            yearMonth: target.month,
            // Campi lead (Sales Manager, /panoramica-generale) non gestiti da
            // questa form: default neutri non distruttivi. L'admin li imposta
            // separatamente con setLeadMonthlyTarget; se poi configura anche
            // quella pagina, l'update la sovrascriverà correttamente.
            targetNuovi: 0,
            targetDatabase: 0,
            ...metricFields,
            updatedAt: new Date(),
        });
    }
    return true;
}

/**
 * Recupera l'array cronologico degli snapshot ed esegue il calcolo
 * del banner di criticità di -20% su 7 giorni.
 */
async function processDailySnapshots(monthString: string, currentFissaggioVariazione: number, todayFormatted: string, companyId: string) {
    // Verifica se oggi è già snapshotato (tenant-scoped)
    const existingToday = await db.select().from(dailyKpiSnapshots).where(and(
        eq(dailyKpiSnapshots.companyId, companyId),
        eq(dailyKpiSnapshots.date, todayFormatted),
    ));
    if (existingToday.length === 0) {
        await db.insert(dailyKpiSnapshots).values({
            id: crypto.randomUUID(),
            date: todayFormatted,
            fissaggioVariazionePerc: currentFissaggioVariazione,
            companyId,
        });
    } else {
        // Aggiorniamo comunque oggi per reattività durante la giornata
        await db.update(dailyKpiSnapshots)
            .set({ fissaggioVariazionePerc: currentFissaggioVariazione })
            .where(and(
                eq(dailyKpiSnapshots.companyId, companyId),
                eq(dailyKpiSnapshots.id, existingToday[0].id),
            ));
    }

    // Facciamo la query su tutti nel mese corrente (tenant-scoped)
    const allSnaps = await db.select()
        .from(dailyKpiSnapshots)
        .where(
            and(
                eq(dailyKpiSnapshots.companyId, companyId),
                gte(dailyKpiSnapshots.date, `${monthString}-01`),
                lte(dailyKpiSnapshots.date, `${monthString}-31`)
            )
        )
        .orderBy(asc(dailyKpiSnapshots.date));

    // Trova il *primo* giorno dove c'è stato il trigger del <= -20% 
    // e da quel giorno controlla se c'è stata continuità di drop o se si è mai ripreso.
    let dataPrimoMeno20: string | null = null;
    let is7DaysAlertActive = false;
    let consecutiveDaysInDeficit = 0;

    for (const snap of allSnaps) {
        if (snap.fissaggioVariazionePerc <= -20) {
            if (!dataPrimoMeno20) {
                dataPrimoMeno20 = snap.date;
            }
            consecutiveDaysInDeficit++;
        } else {
            // Se si rialza sopra il -20%, resettiamo lo streak
            dataPrimoMeno20 = null;
            consecutiveDaysInDeficit = 0;
        }
    }

    // Se sono passati 7 GIORNI O PIÙ di calendario nello streak
    // (O se il count degli snap consecutivi è >= 7 dipendendo dalla granularità, ma il requisito chiede "da 7 o più giorni")
    if (dataPrimoMeno20) {
        const dPrimo = new Date(dataPrimoMeno20);
        const dTogiorno = new Date(todayFormatted);
        const timeDiff = dTogiorno.getTime() - dPrimo.getTime();
        const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
        if (daysDiff >= 7) {
            is7DaysAlertActive = true;
        }
    }

    return { dataPrimoMeno20, is7DaysAlertActive };
}

export async function getManagerTargetsData(monthString: string, testTodayOverride?: Date): Promise<TargetStatsResponse> {
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const dateMetrics = getDateMetrics(monthString, testTodayOverride);
    const today = dateMetrics.today;
    const todayFormatted = toRomeDateStr(today);

    // 1. Setup Targets e Utenti (tenant-scoped)
    // Letto da monthlyLeadTargets (fonte canonica, unificata col Sales Manager
    // — Task B5): mappiamo i campi sulla shape MonthlyTargetInput esistente,
    // così il tipo di ritorno e la UI client non cambiano.
    const tQuery = await db.select().from(monthlyLeadTargets).where(and(
        eq(monthlyLeadTargets.companyId, ctx.companyId),
        eq(monthlyLeadTargets.yearMonth, monthString),
    ));
    const targetRow = tQuery.length > 0 ? tQuery[0] : null;
    const targetData: MonthlyTargetInput = targetRow ? {
        month: monthString,
        targetAppFissati: targetRow.targetAppMonthly,
        targetAppConfermati: targetRow.targetConfMonthly,
        targetTrattative: targetRow.targetPresMonthly,
        targetClosed: targetRow.targetCloseMonthly,
        targetValoreContratti: targetRow.targetFatturatoMonthly,
        workingDaysOverride: targetRow.workingDays > 0 ? targetRow.workingDays : null,
    } : {
        month: monthString,
        targetAppFissati: 0,
        targetAppConfermati: 0,
        targetTrattative: 0,
        targetClosed: 0,
        targetValoreContratti: 0,
        workingDaysOverride: null,
    };

    // Se il manager ha impostato un override manuale dei giorni lavorativi, usalo
    const hasOverride = targetData.workingDaysOverride != null && targetData.workingDaysOverride > 0;
    const giorniLavorativiTotaliMese = hasOverride
        ? targetData.workingDaysOverride!
        : dateMetrics.giorniLavorativiTotaliMese;
    // I giorni trascorsi non possono superare il totale
    const giorniLavorativiTrascorsiOggi = Math.min(
        dateMetrics.giorniLavorativiTrascorsiOggi,
        giorniLavorativiTotaliMese
    );

    // Divisore delle medie per-GDO: solo GDO reali (esclude bot fissatore) con
    // statsActive (decisione PO 2026-07-05), non solo isActive.
    const gdoUsersObjRaw = await db.select().from(users)
        .where(
            and(
                eq(users.companyId, ctx.companyId),
                eq(users.role, 'GDO')
            )
        );
    const gdoUsersObj = gdoUsersObjRaw.filter(isStatsGdo);
    let gdoAttivi = gdoUsersObj.length;
    if (gdoAttivi === 0) gdoAttivi = 1; // Fallback matematico

    // 2. Fetch Lead del Mese (Simile a Marketing Dashboard, escludendo BLT)
    // Bounds Europe/Rome (prima: componenti Date estratti in tz server → UTC su Vercel).
    const { start: startDate, end: endDate } = monthBoundsRome(monthString);
    const { start: todayStartDate, end: todayEndDate } = dayBoundsRome(today);

    // Ogni metrica è attribuita al mese in cui è avvenuta l'azione corrispondente,
    // NON al mese di creazione del lead. Pesco i lead con OR su tutte le date evento
    // e poi conto per la data canonica di ogni metrica (modello marketingActions).
    // end è esclusivo (inizio periodo successivo): confronto con `<`.
    const inMonth = (d: Date | null | undefined): boolean =>
        !!d && d >= startDate && d < endDate;
    const inToday = (d: Date | null | undefined): boolean =>
        !!d && d >= todayStartDate && d < todayEndDate;

    const monthLeads = await db.select().from(leads).where(
        and(
            eq(leads.companyId, ctx.companyId),
            or(sql`${leads.funnel} IS NULL`, sql`${leads.funnel} != 'BLT'`),
            or(
                and(gte(leads.createdAt, startDate), lt(leads.createdAt, endDate)),
                and(gte(leads.appointmentCreatedAt, startDate), lt(leads.appointmentCreatedAt, endDate)),
                and(gte(leads.appointmentDate, startDate), lt(leads.appointmentDate, endDate)),
                and(gte(leads.confirmationsTimestamp, startDate), lt(leads.confirmationsTimestamp, endDate)),
                and(gte(leads.salespersonOutcomeAt, startDate), lt(leads.salespersonOutcomeAt, endDate)),
            )
        )
    );

    // Totale lead = lead CREATI nel mese (semantica corretta per "lead acquisiti")
    const totaleLeadDelMese = monthLeads.filter(l => inMonth(l.createdAt)).length;

    // ACT Counters
    let actAppsFissati = 0;
    let actAppsConfermati = 0;
    let actAppsPresenziati = 0;
    let actClosed = 0;
    let actValoreContratti = 0;

    // TODAY Counters
    let todayFissati = 0;
    let todayConfermati = 0;
    let todayPresenziati = 0;
    let todayClosed = 0;

    // Breakdown Nuovi vs Database (funnel === 'database' case-insensitive → Database)
    const breakdownNuovi: LeadCategoryBreakdown = {
        totale: 0, fissati: 0, confermati: 0, presenziati: 0, closed: 0, valoreContratti: 0,
    };
    const breakdownDatabase: LeadCategoryBreakdown = {
        totale: 0, fissati: 0, confermati: 0, presenziati: 0, closed: 0, valoreContratti: 0,
    };

    monthLeads.forEach(lead => {
        const isDatabase = (lead.funnel ?? '').toLowerCase() === 'database';
        const bucket = isDatabase ? breakdownDatabase : breakdownNuovi;

        // Totale categoria = lead della categoria creato nel mese
        if (inMonth(lead.createdAt)) {
            bucket.totale++;
        }

        // App Fissati: base canonica PO 2026-07-05 (src/lib/kpi/canon.ts) — data
        // di fissaggio (appointmentCreatedAt fallback appointmentDate), gate
        // appointmentDate IS NOT NULL. Prima non c'era gate: un appuntamento
        // annullato (appointmentDate azzerato dal flow di reschedule Conferme,
        // ma appointmentCreatedAt ancora valorizzato) veniva comunque contato
        // come fissato.
        const apptDate = canonApptSetAt(lead);
        if (apptDate && inMonth(apptDate)) {
            actAppsFissati++;
            bucket.fissati++;
            if (inToday(apptDate)) {
                todayFissati++;
            }
        }

        // App Confermati: data conferma nel mese (definizione canonica = 'confermato')
        if (lead.confirmationsOutcome === 'confermato' && inMonth(lead.confirmationsTimestamp)) {
            actAppsConfermati++;
            bucket.confermati++;
            if (inToday(lead.confirmationsTimestamp)) {
                todayConfermati++;
            }
        }

        // Presenziati: whitelist Chiuso/Non chiuso, outcome date nel mese
        const isPresenziato = lead.salespersonOutcome === 'Chiuso' || lead.salespersonOutcome === 'Non chiuso';
        if (isPresenziato && inMonth(lead.salespersonOutcomeAt)) {
            actAppsPresenziati++;
            bucket.presenziati++;
            if (inToday(lead.salespersonOutcomeAt)) {
                todayPresenziati++;
            }
        }

        // Chiuso: salespersonOutcome='Chiuso', outcome date nel mese
        if (lead.salespersonOutcome === 'Chiuso' && inMonth(lead.salespersonOutcomeAt)) {
            actClosed++;
            bucket.closed++;
            if (lead.closeAmountEur) {
                actValoreContratti += lead.closeAmountEur;
                bucket.valoreContratti += lead.closeAmountEur;
            }
            if (inToday(lead.salespersonOutcomeAt)) {
                todayClosed++;
            }
        }
    });

    // Percentuali ACT (tutte basate su totaleLeadDelMese, eccetto Trattative su Lead = presenziati/totale)
    const baseLeads = totaleLeadDelMese > 0 ? totaleLeadDelMese : 1;

    const actPercFissati = (actAppsFissati / baseLeads) * 100;
    const actPercConfermati = (actAppsConfermati / baseLeads) * 100;
    const actPercPresenziati = (actAppsPresenziati / baseLeads) * 100;
    const actPercClosed = (actClosed / baseLeads) * 100;

    const trattativeSuLeadPerc = (actAppsPresenziati / baseLeads) * 100;

    // Target / Day calculations
    const targetDayFissati = targetData.targetAppFissati / giorniLavorativiTotaliMese;
    const targetDayConfermati = targetData.targetAppConfermati / giorniLavorativiTotaliMese;
    const targetDayPresenziati = targetData.targetTrattative / giorniLavorativiTotaliMese;
    const targetDayClosed = targetData.targetClosed / giorniLavorativiTotaliMese;
    const targetDayValoreContratti = targetData.targetValoreContratti / giorniLavorativiTotaliMese;

    // DATO & FORECAST
    const targetPercFissaggio = targetData.targetAppFissati > 0 ? (targetData.targetAppFissati / baseLeads) * 100 : 0;

    let fissaggioVariazionePerc = 0;
    if (targetPercFissaggio > 0) {
        fissaggioVariazionePerc = ((actPercFissati - targetPercFissaggio) / targetPercFissaggio) * 100;
    }
    const fissaggioVariazioneAss = actPercFissati - targetPercFissaggio;

    // Media app / day / gdo
    // Math: (Fissati Attuali / Giorni Trascorsi Oggi) / GDO
    const divisorGiorniTrascosi = giorniLavorativiTrascorsiOggi > 0 ? giorniLavorativiTrascorsiOggi : 1;
    const mediaAppDayGdo = (actAppsFissati / divisorGiorniTrascosi) / gdoAttivi;

    // Vendite / GDO (previste)
    // Math: ( (Closed Attuali / Giorni Trascorsi Oggi) * Giorni Lavorativi Totali) / GDO
    const mediaVenditePrevisteMeseGdo = ((actClosed / divisorGiorniTrascosi) * giorniLavorativiTotaliMese) / gdoAttivi;

    // Logica Snapshots Allarme 7 giorni (Solo se non siamo nel futuro e non siamo il 1° giorno del mese esatto senza niente)
    const snapshotAlert = await processDailySnapshots(monthString, fissaggioVariazionePerc, todayFormatted, ctx.companyId);

    return {
        month: monthString,
        giorniLavorativiTotaliMese,
        giorniLavorativiTrascorsiOggi,
        gdoAttivi: gdoUsersObj.length, // ritorna vero dato ai client
        totaleLeadDelMese,

        breakdownNuovi,
        breakdownDatabase,

        actAppsFissati,
        actAppsConfermati,
        actAppsPresenziati,
        actClosed,
        actValoreContratti,

        targetData,

        actPercFissati,
        actPercConfermati,
        actPercPresenziati,
        actPercClosed,
        trattativeSuLeadPerc,

        todayFissati,
        todayConfermati,
        todayPresenziati,
        todayClosed,

        targetDayFissati,
        targetDayConfermati,
        targetDayPresenziati,
        targetDayClosed,
        targetDayValoreContratti,

        fissaggioVariazionePerc,
        fissaggioVariazioneAss,
        mediaAppDayGdo,
        mediaVenditePrevisteMeseGdo,

        workingDaysOverride: targetData.workingDaysOverride ?? null,

        dataPrimoMeno20: snapshotAlert.dataPrimoMeno20,
        is7DaysAlertActive: snapshotAlert.is7DaysAlertActive
    };
}
