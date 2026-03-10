'use server';

import { db } from '@/db';
import { monthlyTargets, dailyKpiSnapshots, users, leads } from '@/db/schema';
import { eq, and, sql, gte, lte, or, inArray, isNotNull, asc } from 'drizzle-orm';
import crypto from 'crypto';
import { startOfMonth, endOfMonth, endOfDay, isBefore, isAfter, isSunday } from 'date-fns';

// Tipi di utilità per i target
export interface MonthlyTargetInput {
    month: string;
    targetAppFissati: number;
    targetAppConfermati: number;
    targetTrattative: number;
    targetClosed: number;
    targetValoreContratti: number;
}

export interface TargetStatsResponse {
    // Info Temporali e di Sistema
    month: string;
    giorniLavorativiTotaliMese: number;
    giorniLavorativiTrascorsiOggi: number;
    gdoAttivi: number;
    totaleLeadDelMese: number;

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

    // Logica 7 Giorni Alert
    dataPrimoMeno20: string | null;
    is7DaysAlertActive: boolean;
}

/**
 * Calcola programmaticamente i giorni lavorativi (Dal Lun - Sab, no Domenica)
 * in un determinato mese testuale (es. 2026-03).
 */
function getDateMetrics(monthString: string, testTodayOverride?: Date) {
    const today = testTodayOverride || new Date(); // Dalla timezone del server di esecuzione

    // Parsiamo il mese: 2026-03-01T00:00:00.000
    const [year, month] = monthString.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    let giorniLavorativiTotaliMese = 0;
    let giorniLavorativiTrascorsiOggi = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        // isSunday() -> 0 è domenica
        if (d.getDay() !== 0) {
            giorniLavorativiTotaliMese++;

            // Se il giorno del mese controllato è antecedente o identico (nel calendario lavorativo) a oggi
            // ATTENZIONE: solo se il "today" matcha il target month.
            const isSameMonth = today.getFullYear() === year && today.getMonth() === month - 1;

            if (isSameMonth) {
                // Limitiamo il count ai giorni trascorsi fino ad OGGI compreso
                if (d.getDate() <= today.getDate()) {
                    giorniLavorativiTrascorsiOggi++;
                }
            } else if (today > end) {
                // Il mese è gia finito nel passato, i trascorsi sono == al totale
                giorniLavorativiTrascorsiOggi++;
            }
            // Se today < start (mese futuro), i trascorsi rimangono 0.
        }
    }

    // Fallback matematico per non dividere per 0 casomai fossimo nel weekend o mese vuoto
    if (giorniLavorativiTotaliMese === 0) giorniLavorativiTotaliMese = 1;

    return { giorniLavorativiTotaliMese, giorniLavorativiTrascorsiOggi, today };
}

/**
 * Salva i target impostati dal manager
 */
export async function saveMonthlyTarget(target: MonthlyTargetInput) {
    const existing = await db.select().from(monthlyTargets).where(eq(monthlyTargets.month, target.month));

    if (existing.length > 0) {
        await db.update(monthlyTargets)
            .set({
                ...target,
                updatedAt: new Date()
            })
            .where(eq(monthlyTargets.id, existing[0].id));
    } else {
        await db.insert(monthlyTargets).values({
            id: crypto.randomUUID(),
            ...target,
            updatedAt: new Date()
        });
    }
    return true;
}

/**
 * Recupera l'array cronologico degli snapshot ed esegue il calcolo
 * del banner di criticità di -20% su 7 giorni.
 */
async function processDailySnapshots(monthString: string, currentFissaggioVariazione: number, todayFormatted: string) {
    // Verifica se oggi è già snapshotato
    const existingToday = await db.select().from(dailyKpiSnapshots).where(eq(dailyKpiSnapshots.date, todayFormatted));
    if (existingToday.length === 0) {
        await db.insert(dailyKpiSnapshots).values({
            id: crypto.randomUUID(),
            date: todayFormatted,
            fissaggioVariazionePerc: currentFissaggioVariazione
        });
    } else {
        // Aggiorniamo comunque oggi per reattività durante la giornata
        await db.update(dailyKpiSnapshots)
            .set({ fissaggioVariazionePerc: currentFissaggioVariazione })
            .where(eq(dailyKpiSnapshots.id, existingToday[0].id));
    }

    // Facciamo la query su tutti nel mese corrente
    const allSnaps = await db.select()
        .from(dailyKpiSnapshots)
        .where(
            and(
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
    const { giorniLavorativiTotaliMese, giorniLavorativiTrascorsiOggi, today } = getDateMetrics(monthString, testTodayOverride);
    const todayFormatted = today.toISOString().split('T')[0];

    // 1. Setup Targets e Utenti
    const tQuery = await db.select().from(monthlyTargets).where(eq(monthlyTargets.month, monthString));
    const targetData = tQuery.length > 0 ? tQuery[0] : {
        month: monthString,
        targetAppFissati: 0,
        targetAppConfermati: 0,
        targetTrattative: 0,
        targetClosed: 0,
        targetValoreContratti: 0,
    };

    const gdoUsersObj = await db.select().from(users)
        .where(
            and(
                eq(users.role, 'GDO'),
                eq(users.isActive, true)
            )
        );
    let gdoAttivi = gdoUsersObj.length;
    if (gdoAttivi === 0) gdoAttivi = 1; // Fallback matematico 

    // 2. Fetch Lead del Mese (Simile a Marketing Dashboard, escludendo BLT)
    const [yearStr, monthStr] = monthString.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const start = new Date(year, month - 1, 1).toISOString();
    const end = new Date(year, month, 0, 23, 59, 59, 999).toISOString();

    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

    const monthLeads = await db.select().from(leads).where(
        and(
            gte(leads.createdAt, new Date(start)),
            lte(leads.createdAt, new Date(end)),
            or(sql`${leads.funnel} IS NULL`, sql`${leads.funnel} != 'BLT'`)
        )
    );

    const totaleLeadDelMese = monthLeads.length;

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

    monthLeads.forEach(lead => {
        // App Fissati
        if (lead.appointmentDate) {
            actAppsFissati++;
            // Controlla se è stato fissato ESATTAMENTE oggi in UI
            if (lead.appointmentCreatedAt && lead.appointmentCreatedAt >= new Date(todayStart) && lead.appointmentCreatedAt <= new Date(todayEnd)) {
                todayFissati++;
            }

            // App Confermati
            const isConfirmed = lead.confirmationsOutcome === 'confermato' ||
                (lead.confirmationsOutcome !== 'scartato' && lead.salespersonUserId);

            if (isConfirmed) {
                actAppsConfermati++;
                if (lead.confirmationsTimestamp && lead.confirmationsTimestamp >= new Date(todayStart) && lead.confirmationsTimestamp <= new Date(todayEnd)) {
                    todayConfermati++;
                }

                // Presenziati (Show-up)
                const isPresenziato = lead.salespersonOutcome &&
                    lead.salespersonOutcome !== 'Sparito' &&
                    lead.salespersonOutcome !== 'Lead non presenziato' &&
                    lead.salespersonOutcome !== 'KO - Assente';

                if (isPresenziato) {
                    actAppsPresenziati++;
                    if (lead.salespersonOutcomeAt && lead.salespersonOutcomeAt >= new Date(todayStart) && lead.salespersonOutcomeAt <= new Date(todayEnd)) {
                        todayPresenziati++;
                    }

                    // Chiuso
                    if (lead.salespersonOutcome === 'Chiuso') {
                        actClosed++;
                        if (lead.closeAmountEur) {
                            actValoreContratti += lead.closeAmountEur;
                        }
                        if (lead.salespersonOutcomeAt && lead.salespersonOutcomeAt >= new Date(todayStart) && lead.salespersonOutcomeAt <= new Date(todayEnd)) {
                            todayClosed++;
                        }
                    }
                }
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
    const snapshotAlert = await processDailySnapshots(monthString, fissaggioVariazionePerc, todayFormatted);

    return {
        month: monthString,
        giorniLavorativiTotaliMese,
        giorniLavorativiTrascorsiOggi,
        gdoAttivi: gdoUsersObj.length, // ritorna vero dato ai client
        totaleLeadDelMese,

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

        dataPrimoMeno20: snapshotAlert.dataPrimoMeno20,
        is7DaysAlertActive: snapshotAlert.is7DaysAlertActive
    };
}
