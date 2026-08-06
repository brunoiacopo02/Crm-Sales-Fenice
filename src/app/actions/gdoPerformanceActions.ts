'use server';

import { db } from "@/db";
import { leads, users, weeklyGamificationRules, callLogs, manualAdjustments } from "@/db/schema";
import { eq, and, gte, lte, lt, isNotNull, sql, or } from "drizzle-orm";
import { isWithinInterval } from "date-fns";
import { getBiweeklyCycle } from "@/lib/biweeklyCycle";
import { countPresences } from "@/lib/presenceCounting";
import { currentTenant, assertSalesArea } from "@/lib/tenancy";
import { isRealGdo, DEFAULT_DAILY_APPT_TARGET } from "@/lib/kpi/canon";
import { monthBoundsRome, dayBoundsRome, weekBoundsRome, toRomeDateStr } from "@/lib/dateUtils";

export interface GamificationTargetInput {
    month: string;
    targetTier1: number;
    rewardTier1: number;
    targetTier2: number;
    rewardTier2: number;
}

export async function saveGamificationRule(input: GamificationTargetInput) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    await db.insert(weeklyGamificationRules)
        .values({
            id: crypto.randomUUID(),
            month: input.month,
            companyId: ctx.companyId,
            targetTier1: input.targetTier1,
            rewardTier1: input.rewardTier1,
            targetTier2: input.targetTier2,
            rewardTier2: input.rewardTier2,
            updatedAt: new Date()
        })
        .onConflictDoUpdate({
            target: [weeklyGamificationRules.month, weeklyGamificationRules.companyId],
            set: {
                targetTier1: input.targetTier1,
                rewardTier1: input.rewardTier1,
                targetTier2: input.targetTier2,
                rewardTier2: input.rewardTier2,
                updatedAt: new Date()
            }
        });
}


/**
 * Funzione Helper: Divide il mese in blocchi di settimane solari (Lunedì-Domenica).
 * Contratto invariato (start = 00:00 inclusivo, end = 23:59:59.999 inclusivo)
 * per non rompere i consumer esistenti (isWithinInterval, lte); cambia solo il
 * fuso di calcolo: prima usava componenti Date locali (UTC su Vercel), ora
 * Europe/Rome tramite gli helper canonici di dateUtils.ts.
 */
function getMonthWeeks(monthStr: string) {
    const { start: monthStart, end: monthEndExclusive } = monthBoundsRome(monthStr);
    const monthEnd = new Date(monthEndExclusive.getTime() - 1); // ultimo istante del mese (inclusivo)

    const weeks: { name: string, start: Date, end: Date }[] = [];
    let currentStart = monthStart;
    let weekIndex = 1;

    while (currentStart <= monthEnd) {
        // Mezzogiorno UTC del giorno Rome corrente: non attraversa mai la mezzanotte
        // locale, quindi getUTCDay() riflette sempre il weekday Rome corretto.
        const noon = new Date(`${toRomeDateStr(currentStart)}T12:00:00Z`);
        const dow = noon.getUTCDay(); // 0 = domenica ... 6 = sabato
        const daysToSunday = dow === 0 ? 0 : 7 - dow;
        const sundayNoon = new Date(noon.getTime() + daysToSunday * 24 * 60 * 60 * 1000);

        // Fine settimana Rome inclusiva = ultimo istante della domenica.
        let currentEnd = new Date(dayBoundsRome(sundayNoon).end.getTime() - 1);
        if (currentEnd > monthEnd) {
            currentEnd = monthEnd;
        }

        weeks.push({
            name: `Week ${weekIndex}`,
            start: currentStart,
            end: currentEnd
        });

        // La settimana successiva inizia a mezzanotte Rome del giorno dopo currentEnd.
        currentStart = dayBoundsRome(new Date(currentEnd.getTime() + 1)).start;
        weekIndex++;
    }

    return weeks;
}

/**
 * FASE 2.1: Logica backend Tabellare e Calendario (Manager)
 */
export async function getManagerGdoTables(monthString: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    // Tutti id e dati base GDO
    const allUsers = await db.select().from(users).where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'GDO')));
    // Il Bot Fissatore ha una pagina dedicata (/statistiche-fissatore) con metriche
    // event-based: qui la formula umana lo falserebbe, quindi niente card per lui.
    const activeGdos = allUsers.filter(u => u.isActive && !u.isBot);

    // Tutti gli appuntamenti fissati questo mese. Base canonica PO 2026-07-05
    // (src/lib/kpi/canon.ts): attribuzione per data di FISSAGGIO
    // (COALESCE(appointmentCreatedAt, appointmentDate)), non per data del
    // meeting (appointmentDate) — un appuntamento fissato a fine mese per il
    // mese successivo va contato nel mese in cui è stato fissato.
    // Bounds Europe/Rome (end esclusivo): prima usava componenti Date locali (UTC su Vercel).
    const { start: startObj, end: endObj } = monthBoundsRome(monthString);

    const [monthLeads, assignedLeadsRaw, presenceLeads, confirmedLeads, closedLeads] = await Promise.all([
        db.select().from(leads).where(
            and(
                eq(leads.companyId, ctx.companyId),
                isNotNull(leads.appointmentDate),
                sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) >= ${startObj}`,
                sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) < ${endObj}`,
            )
        ),
        db.select({
            assignedToId: leads.assignedToId,
            funnel: leads.funnel,
        }).from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                isNotNull(leads.assignedToId),
                // Base = presa in carico, non import (migr. 0027). I lead dei
                // pool /import nascono mesi prima di arrivare a un GDO: contati
                // su createdAt finivano nel mese del caricamento, dove nessuno
                // li guarda. COALESCE per i lead storici senza assignedAt.
                sql`COALESCE(${leads.assignedAt}, ${leads.createdAt}) >= ${startObj}`,
                sql`COALESCE(${leads.assignedAt}, ${leads.createdAt}) < ${endObj}`,
            )),
        // Presenze del mese (PO 2026-07-17): base `presentedAt` (giorno dell'appuntamento
        // in cui il lead ha presenziato, latch immutabile) — NON il cohort dei fissati.
        // Un lead fissato a giugno che presenzia a luglio conta nelle presenze di luglio.
        db.select({
            assignedToId: leads.assignedToId,
            funnel: leads.funnel,
            presentedAt: leads.presentedAt,
        }).from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                isNotNull(leads.presentedAt),
                gte(leads.presentedAt, startObj),
                lt(leads.presentedAt, endObj)
            )),
        // Confermati del mese (allineamento PO 2026-07-17): attribuiti al giorno
        // dell'APPUNTAMENTO confermato — stessa dimensione delle presenze, così
        // sulle righe settimanali conferme e presenze sono confrontabili
        // (conferme ≥ presenze vale riga per riga).
        db.select({
            assignedToId: leads.assignedToId,
            funnel: leads.funnel,
            appointmentDate: leads.appointmentDate,
        }).from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.confirmationsOutcome, 'confermato'),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, startObj),
                lt(leads.appointmentDate, endObj)
            )),
        // Chiusure del mese: data esito venditore (regola canonica chiusure).
        db.select({
            assignedToId: leads.assignedToId,
            funnel: leads.funnel,
            salespersonOutcomeAt: leads.salespersonOutcomeAt,
        }).from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                sql`LOWER(${leads.salespersonOutcome}) = 'chiuso'`,
                isNotNull(leads.salespersonOutcomeAt),
                gte(leads.salespersonOutcomeAt, startObj),
                lt(leads.salespersonOutcomeAt, endObj)
            ))
    ]);

    const weeks = getMonthWeeks(monthString);

    const gdoStatsMap: Record<string, any> = {};

    for (const gdo of activeGdos) {
        gdoStatsMap[gdo.id] = {
            gdoId: gdo.id,
            gdoName: gdo.displayName || `GDO ${gdo.gdoCode || gdo.id.slice(0, 4)}`,
            funnelStats: {} as Record<string, any>,
            // Lead assegnati al GDO per ciascun funnel (denominatore per % fissaggio per-funnel)
            leadAssegnatiFunnel: {} as Record<string, number>,
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

        // FISSATI: unica metrica che resta attribuita alla data di fissaggio
        // (apptSetAt) — decisione PO 2026-07-17: "gli app fissati non si toccano".
        gdoStats.funnelStats[f].fissati++;
        gdoStats.totalStats.fissati++;
    });

    // Allineamento dimensioni (PO 2026-07-17): confermati e presenze al giorno
    // dell'APPUNTAMENTO, chiusure alla data dell'esito venditore. Così sulle
    // righe settimanali conferme e presenze sono confrontabili riga per riga.
    const bucketInto = <T extends { assignedToId: string | null; funnel: string | null }>(
        arr: T[],
        dateOf: (lead: T) => Date | null,
        key: 'confermati' | 'presenziati' | 'chiusi',
    ) => {
        for (const lead of arr) {
            if (!lead.assignedToId || !gdoStatsMap[lead.assignedToId]) continue;
            const d = dateOf(lead);
            if (!d) continue;
            const gdoStats = gdoStatsMap[lead.assignedToId];
            const f = lead.funnel || 'ALTRO';
            if (!gdoStats.funnelStats[f]) {
                gdoStats.funnelStats[f] = { fissati: 0, confermati: 0, presenziati: 0, chiusi: 0 };
            }
            gdoStats.funnelStats[f][key]++;
            gdoStats.totalStats[key]++;
            const wIndex = weeks.findIndex(w => isWithinInterval(d, { start: w.start, end: w.end }));
            if (wIndex !== -1) gdoStats.calendarStats[key][wIndex]++;
        }
    };

    bucketInto(confirmedLeads, l => l.appointmentDate, 'confermati');
    bucketInto(presenceLeads, l => l.presentedAt, 'presenziati');
    bucketInto(closedLeads, l => l.salespersonOutcomeAt, 'chiusi');

    // Count leads assigned to each GDO in the month (totali + per-funnel)
    for (const lead of assignedLeadsRaw) {
        if (!lead.assignedToId || !gdoStatsMap[lead.assignedToId]) continue;
        const g = gdoStatsMap[lead.assignedToId];
        g.leadAssegnati++;
        const f = lead.funnel || 'ALTRO';
        g.leadAssegnatiFunnel[f] = (g.leadAssegnatiFunnel[f] || 0) + 1;
    }

    // Formatting for Frontend. Include any funnel that has either fissati > 0
    // OR lead assegnati > 0 (so the admin sees under-performing funnels with 0% fissaggio too).
    const result = Object.values(gdoStatsMap).map(gdo => {
        const allFunnelNames = new Set<string>([
            ...Object.keys(gdo.funnelStats),
            ...Object.keys(gdo.leadAssegnatiFunnel),
        ]);
        const funnelRows = [...allFunnelNames].sort((a, b) => {
            const la = gdo.leadAssegnatiFunnel[a] || 0;
            const lb = gdo.leadAssegnatiFunnel[b] || 0;
            return lb - la;
        }).map(k => {
            const row = gdo.funnelStats[k] || { fissati: 0, confermati: 0, presenziati: 0, chiusi: 0 };
            const leadAssegnatiFunnel = gdo.leadAssegnatiFunnel[k] || 0;
            return {
                funnel: k,
                leadAssegnatiFunnel,
                fissati: row.fissati,
                confermati: row.confermati,
                presenziati: row.presenziati,
                chiusi: row.chiusi,
                percFiss: leadAssegnatiFunnel > 0 ? (row.fissati / leadAssegnatiFunnel * 100).toFixed(1) + '%' : '-',
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
            gdoId: gdo.gdoId,
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
 *
 * Per GDO il ciclo è BISETTIMANALE (ancora lun 4-mag-2026, durata 14 giorni).
 * Le presenze sono ora filtrate per `salespersonOutcomeAt` ∈ ciclo (esito
 * maturato nel ciclo), non più per `appointmentDate` schedulato nel ciclo.
 *
 * Per CONFERME il ciclo resta SETTIMANALE come prima — stesso codice
 * di sempre, branchato sotto.
 */
export async function getCurrentGdoGamificationState(gdoUserId: string, testTodayOverride?: Date, overrides?: { role?: string; target1Override?: number; reward1Override?: number; target2Override?: number; reward2Override?: number }) {
    const ctx = await currentTenant();
    const today = testTodayOverride || new Date();

    if (overrides?.role === 'CONFERME') {
        return await getConfermeWeeklyState(gdoUserId, today, ctx.companyId, overrides);
    }

    // GDO: ciclo bisettimanale
    const cycle = getBiweeklyCycle(today);
    // Mese Europe/Rome: toISOString() (UTC) sceglierebbe il mese sbagliato
    // nella finestra 00:00-02:00 Rome.
    const currentMonthStr = toRomeDateStr(today).slice(0, 7);

    // Default GDO bisettimanale: 18 / 22 presenze → €270 / €540.
    // Manager modifica via /manager-targets (riusa weeklyGamificationRules).
    let target1 = 18, reward1 = 270;
    let target2 = 22, reward2 = 540;

    if (overrides?.target1Override) {
        target1 = overrides.target1Override;
        reward1 = overrides.reward1Override || reward1;
        target2 = overrides.target2Override || target2;
        reward2 = overrides.reward2Override || reward2;
    } else {
        const rules = await db.select().from(weeklyGamificationRules).where(and(eq(weeklyGamificationRules.companyId, ctx.companyId), eq(weeklyGamificationRules.month, currentMonthStr)));
        if (rules.length > 0) {
            target1 = rules[0].targetTier1;
            reward1 = rules[0].rewardTier1;
            target2 = rules[0].targetTier2;
            reward2 = rules[0].rewardTier2;
        }
    }

    const { total: currentPresences } = await countPresences(gdoUserId, cycle.start, cycle.end, ctx.companyId);

    return {
        currentPresences,
        target1,
        reward1,
        target2,
        reward2,
        currentWeekName: `Ciclo ${cycle.label}`,
        weekStart: cycle.startDateStr,
        weekEnd: cycle.endDateStr,
        cycleIndex: cycle.index,
        isBiweekly: true,
    };
}

/** Branch settimanale CONFERME — logica invariata rispetto a prima del refactor. */
async function getConfermeWeeklyState(
    gdoUserId: string,
    today: Date,
    companyId: string,
    overrides?: { role?: string; target1Override?: number; reward1Override?: number; target2Override?: number; reward2Override?: number },
) {
    // Mese in Europe/Rome (getMonthWeeks è Rome-native): toISOString() (UTC)
    // sceglierebbe il mese sbagliato nella finestra 00:00-02:00 Rome.
    const currentMonthStr = toRomeDateStr(today).slice(0, 7);
    const weeks = getMonthWeeks(currentMonthStr);

    let currentWeekName = "Fuori Mese";
    let currentWeekStart = today;
    let currentWeekEnd = today;

    const w = weeks.find(wk => isWithinInterval(today, { start: wk.start, end: wk.end }));
    if (w) {
        currentWeekName = w.name;
        currentWeekStart = w.start;
        currentWeekEnd = w.end;
    }

    let target1 = 10, reward1 = 135;
    let target2 = 13, reward2 = 270;

    if (overrides?.target1Override) {
        target1 = overrides.target1Override;
        reward1 = overrides.reward1Override || 145;
        target2 = overrides.target2Override || 21;
        reward2 = overrides.reward2Override || 290;
    } else {
        const rules = await db.select().from(weeklyGamificationRules).where(and(eq(weeklyGamificationRules.companyId, companyId), eq(weeklyGamificationRules.month, currentMonthStr)));
        if (rules.length > 0) {
            target1 = rules[0].targetTier1;
            reward1 = rules[0].rewardTier1;
            target2 = rules[0].targetTier2;
            reward2 = rules[0].rewardTier2;
        }
    }

    let currentPresences = 0;

    // Le chiusure Conferme sono OBIETTIVO DI GRUPPO: contano per tutta la squadra.
    // Una chiusura di Andrea vale per Alberto e Christel. Nessun filtro per utente.
    const confermeLeads = await db.select().from(leads).where(
        and(
            eq(leads.companyId, companyId),
            isNotNull(leads.confirmationsUserId),
            eq(leads.confirmationsOutcome, 'confermato'),
            eq(leads.salespersonOutcome, 'Chiuso'),
            isNotNull(leads.salespersonOutcomeAt),
            gte(leads.salespersonOutcomeAt, currentWeekStart),
            lte(leads.salespersonOutcomeAt, currentWeekEnd)
        )
    );
    currentPresences = confermeLeads.length;

    try {
        // Aggiustamenti manuali "chiusure" di QUALSIASI utente Conferme contano per il team.
        const adjustments = await db.select({ count: manualAdjustments.count, userId: manualAdjustments.userId })
            .from(manualAdjustments)
            .innerJoin(users, eq(users.id, manualAdjustments.userId))
            .where(
                and(
                    eq(users.companyId, companyId),
                    eq(manualAdjustments.companyId, companyId),
                    eq(users.role, 'CONFERME'),
                    eq(manualAdjustments.type, 'chiusure'),
                    gte(manualAdjustments.createdAt, currentWeekStart),
                    lte(manualAdjustments.createdAt, currentWeekEnd)
                )
            );
        adjustments.forEach(a => { currentPresences += a.count; });
    } catch { /* tabella non ancora migrata */ }

    return {
        currentPresences,
        target1,
        reward1,
        target2,
        reward2,
        currentWeekName,
        // Label in data Europe/Rome: con i bound di getMonthWeeks ora Rome-native,
        // toISOString() (UTC) mostrerebbe il giorno precedente (lun 00:00 Rome = dom 22:00 UTC).
        weekStart: toRomeDateStr(currentWeekStart),
        weekEnd: toRomeDateStr(currentWeekEnd),
        isBiweekly: false,
    };
}

/**
 * F2-011: Metriche conferme/presenze/chiusure per i lead di un GDO (settimana corrente lun-dom)
 */
export async function getGdoLeadOutcomeMetrics(gdoUserId: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    // Settimana corrente (lunedì 00:00 → lunedì successivo 00:00, esclusivo) Europe/Rome.
    const now = new Date();
    const { start: weekStart, end: weekEnd } = weekBoundsRome(now); // end esclusivo
    const monthStr = toRomeDateStr(now).slice(0, 7);

    // Mese corrente (Europe/Rome) — per le percentuali di conferma/presenza
    // mostrate nella mini-barra KPI in pipeline.
    const { start: monthStart, end: monthEnd } = monthBoundsRome(monthStr); // end esclusivo

    // Range query = unione settimana ∪ mese (la settimana può sforare nel mese
    // precedente/successivo); il bucketing preciso avviene in JS.
    const rangeStart = weekStart < monthStart ? weekStart : monthStart;
    const rangeEnd = weekEnd > monthEnd ? weekEnd : monthEnd;

    const gdoLeads = await db.select({
        appointmentDate: leads.appointmentDate,
        confirmationsOutcome: leads.confirmationsOutcome,
        salespersonOutcome: leads.salespersonOutcome,
        presentedAt: leads.presentedAt,
    }).from(leads).where(
        and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.assignedToId, gdoUserId),
            isNotNull(leads.appointmentDate),
            gte(leads.appointmentDate, rangeStart),
            lt(leads.appointmentDate, rangeEnd)
        )
    );

    let fissati = 0;
    let confermati = 0;
    let presenziati = 0;
    let chiusi = 0;
    const month = { fissati: 0, confermati: 0, presenziati: 0, chiusi: 0 };

    for (const lead of gdoLeads) {
        const isConfermato = lead.confirmationsOutcome === 'confermato';
        // Presenza = latch presentedAt (PO 2026-07-17): non sparisce con "Sparito" al follow-up.
        const isPresenziatoFlag = lead.presentedAt !== null;
        const isChiuso = lead.salespersonOutcome?.toLowerCase() === 'chiuso';

        const apptAt = lead.appointmentDate ? new Date(lead.appointmentDate) : null;
        const inMonth = apptAt && apptAt >= monthStart && apptAt < monthEnd;
        if (inMonth) {
            month.fissati++;
            if (isConfermato) month.confermati++;
            if (isPresenziatoFlag) month.presenziati++;
            if (isChiuso) month.chiusi++;
        }

        const inWeek = apptAt && apptAt >= weekStart && apptAt < weekEnd;
        if (inWeek) {
            fissati++;
            if (isConfermato) confermati++;
            if (isPresenziatoFlag) presenziati++;
            if (isChiuso) chiusi++;
        }
    }

    return {
        fissati,
        confermati,
        presenziati,
        chiusi,
        month,
        weekStart: weekStart.toISOString(),
        // weekEnd è esclusivo (lunedì successivo 00:00): il consumer
        // (GdoLeadMetrics.tsx) lo mostra come "fine settimana", quindi qui
        // sottraiamo 1ms SOLO per la rappresentazione — i confronti sopra
        // restano `< weekEnd`.
        weekEnd: new Date(weekEnd.getTime() - 1).toISOString(),
    };
}

/**
 * F2-012: Obiettivi giornalieri GDO — chiamate e fissaggi di oggi
 */
export async function getGdoDailyObjectives(gdoUserId: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const { start: todayStart, end: todayEnd } = dayBoundsRome(new Date()); // end esclusivo

    // Get user's dailyApptTarget
    const userRow = await db.select({ dailyApptTarget: users.dailyApptTarget })
        .from(users).where(and(eq(users.companyId, ctx.companyId), eq(users.id, gdoUserId))).limit(1);
    const dailyApptTarget = userRow[0]?.dailyApptTarget || DEFAULT_DAILY_APPT_TARGET;

    // Count today's calls from callLogs
    const callResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(callLogs)
        .where(and(
            eq(callLogs.companyId, ctx.companyId),
            eq(callLogs.userId, gdoUserId),
            gte(callLogs.createdAt, todayStart),
            lt(callLogs.createdAt, todayEnd)
        ));
    const callsDone = callResult[0]?.count || 0;

    // Count today's appointments set by this GDO
    const apptResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.assignedToId, gdoUserId),
            isNotNull(leads.appointmentCreatedAt),
            gte(leads.appointmentCreatedAt, todayStart),
            lt(leads.appointmentCreatedAt, todayEnd)
        ));
    const appointmentsDone = apptResult[0]?.count || 0;

    // Count leads in pipeline (assigned, not yet with appointment, active statuses)
    const pipelineResult = await db.select({ count: sql<number>`count(*)::integer` })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.assignedToId, gdoUserId),
            or(eq(leads.status, 'NEW'), eq(leads.status, 'IN_PROGRESS'))
        ));
    const pipelineSize = pipelineResult[0]?.count || 0;

    return {
        callsDone,
        callsTarget: 90,
        pipelineSize,
        appointmentsDone,
        appointmentsTarget: dailyApptTarget,
    };
}

/**
 * F3-007: Script completion rate for a GDO user.
 * Returns total calls, calls with script completed, percentage, and consecutive-day streak.
 */
export async function getScriptCompletionRate(userId: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const [totalResult, scriptResult, scriptDaysResult] = await Promise.all([
        db.select({ count: sql<number>`count(*)::integer` })
            .from(callLogs)
            .where(and(eq(callLogs.companyId, ctx.companyId), eq(callLogs.userId, userId))),
        db.select({ count: sql<number>`count(*)::integer` })
            .from(callLogs)
            .where(and(
                eq(callLogs.companyId, ctx.companyId),
                eq(callLogs.userId, userId),
                eq(callLogs.scriptCompleted, true)
            )),
        // Get distinct dates (Europe/Rome) where user completed at least one script, ordered desc
        db.select({
            day: sql<string>`DISTINCT DATE(${callLogs.createdAt} AT TIME ZONE 'Europe/Rome')`.as('day'),
        })
            .from(callLogs)
            .where(and(
                eq(callLogs.companyId, ctx.companyId),
                eq(callLogs.userId, userId),
                eq(callLogs.scriptCompleted, true)
            ))
            .orderBy(sql`day DESC`),
    ]);

    const totalCalls = totalResult[0]?.count || 0;
    const scriptCompletedCount = scriptResult[0]?.count || 0;

    // Calculate consecutive-day streak from today backwards
    let scriptStreak = 0;
    if (scriptDaysResult.length > 0) {
        const now = new Date();
        const todayRome = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
        const todayStr = todayRome.toISOString().slice(0, 10);
        const yesterdayDate = new Date(todayRome);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

        // Streak must start from today or yesterday
        const firstDay = String(scriptDaysResult[0].day).slice(0, 10);
        if (firstDay === todayStr || firstDay === yesterdayStr) {
            let expectedDate = new Date(firstDay + 'T00:00:00');
            for (const row of scriptDaysResult) {
                const dayStr = String(row.day).slice(0, 10);
                const dayDate = new Date(dayStr + 'T00:00:00');
                if (dayDate.getTime() === expectedDate.getTime()) {
                    scriptStreak++;
                    expectedDate.setDate(expectedDate.getDate() - 1);
                } else {
                    break;
                }
            }
        }
    }

    return {
        totalCalls,
        scriptCompletedCount,
        completionRate: totalCalls > 0 ? Math.round((scriptCompletedCount / totalCalls) * 100) : 0,
        scriptStreak,
    };
}

/**
 * F3-009: Bulk script completion rates for all active GDOs (used by manager view).
 */
export async function getAllGdoScriptRates(): Promise<Record<string, { completionRate: number; scriptCompletedCount: number }>> {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    // Esclude il bot fissatore dalle statistiche di completamento script (decisione PO 2026-07-05)
    const activeGdosRaw = await db.select({ id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot }).from(users).where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'GDO'), eq(users.isActive, true)));
    const activeGdos = activeGdosRaw.filter(isRealGdo);

    if (activeGdos.length === 0) return {};

    const gdoIds = activeGdos.map(g => g.id);

    const [totalByUser, scriptByUser] = await Promise.all([
        db.select({
            userId: callLogs.userId,
            count: sql<number>`count(*)::integer`.as('count'),
        }).from(callLogs)
            .where(and(
                eq(callLogs.companyId, ctx.companyId),
                sql`${callLogs.userId} IN (${sql.join(gdoIds.map(id => sql`${id}`), sql`, `)})`
            ))
            .groupBy(callLogs.userId),
        db.select({
            userId: callLogs.userId,
            count: sql<number>`count(*)::integer`.as('count'),
        }).from(callLogs)
            .where(and(
                eq(callLogs.companyId, ctx.companyId),
                sql`${callLogs.userId} IN (${sql.join(gdoIds.map(id => sql`${id}`), sql`, `)})`,
                eq(callLogs.scriptCompleted, true)
            ))
            .groupBy(callLogs.userId),
    ]);

    const totalMap: Record<string, number> = {};
    for (const row of totalByUser) {
        if (row.userId) totalMap[row.userId] = row.count;
    }
    const scriptMap: Record<string, number> = {};
    for (const row of scriptByUser) {
        if (row.userId) scriptMap[row.userId] = row.count;
    }

    const result: Record<string, { completionRate: number; scriptCompletedCount: number }> = {};
    for (const gdo of activeGdos) {
        const total = totalMap[gdo.id] || 0;
        const completed = scriptMap[gdo.id] || 0;
        result[gdo.id] = {
            completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
            scriptCompletedCount: completed,
        };
    }
    return result;
}
