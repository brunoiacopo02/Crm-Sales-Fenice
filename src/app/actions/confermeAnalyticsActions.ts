"use server"
import { createClient } from "@/utils/supabase/server"
import { db } from "@/db"
import { leads, leadEvents, users } from "@/db/schema"
import { eq, and, gte, lte, isNotNull, inArray } from "drizzle-orm"
import crypto from "crypto"

/**
 * Persiste la durata di una chiamata Conferme.
 * - actionTaken='nr': la durata viene scritta sullo slot del NR appena registrato (callsMade dopo l'azione = N → scrive su confCallNDuration).
 * - actionTaken='outcome': la durata viene scritta sul "tentativo di risposta" = confCall(N+1)Duration dove N=NR esistenti, marcata answered=true nell'event log.
 * - actionTaken=null: durata "orfana" (timer fermato senza azione rapida). Solo event log.
 *
 * Non usa version-check stretto sul lead per evitare race con l'azione rapida che ha appena
 * incrementato la version: aggiorna i soli campi confCall*Duration in modo idempotente.
 */
export async function logConfermeCallDuration(
    leadId: string,
    durationSeconds: number,
    opts: { actionTaken: 'nr' | 'outcome' | null }
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" };
        }

        if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
            return { success: false, error: "Invalid duration" };
        }

        const lead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
        if (!lead) return { success: false, error: "Lead not found" };

        const callsMade =
            (lead.confCall3At ? 3 : lead.confCall2At ? 2 : lead.confCall1At ? 1 : 0);

        let slot: 1 | 2 | 3 | null = null;
        let answered: boolean | null = null;

        if (opts.actionTaken === 'nr') {
            // L'azione rapida NR ha appena incrementato il count → la durata va sullo slot corrispondente.
            // callsMade qui è già post-NR perché confermeActions ha già aggiornato il lead.
            if (callsMade >= 1 && callsMade <= 3) {
                slot = callsMade as 1 | 2 | 3;
                answered = false;
            }
        } else if (opts.actionTaken === 'outcome') {
            // Risposta: scriviamo sullo slot del "tentativo che ha portato all'outcome".
            // = primo slot null = callsMade + 1 (capped a 3).
            const target = Math.min(callsMade + 1, 3) as 1 | 2 | 3;
            slot = target;
            answered = true;
        }

        const roundedDuration = Math.round(durationSeconds);

        // Update field if slot determined
        if (slot !== null) {
            const colName =
                slot === 1 ? 'confCall1Duration'
                : slot === 2 ? 'confCall2Duration'
                : 'confCall3Duration';
            const patch: Record<string, number> = { [colName]: roundedDuration };
            await db.update(leads).set(patch).where(eq(leads.id, leadId));
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_call_logged",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: {
                durationSeconds: roundedDuration,
                slot,
                answered,
                actionTaken: opts.actionTaken,
            },
        });

        return { success: true };
    } catch (e: any) {
        console.error("logConfermeCallDuration error:", e);
        return { success: false, error: e?.message || "INTERNAL_ERROR" };
    }
}

export type ConfermeAnalyticsResult = {
    hero: {
        capacityMin: number;
        demandMin: number;
        saturation: number;        // 0..1+
        operatorsFullDay: number;  // ceil
        peakOperators: number;     // float
        peakHour: number | null;   // 9..21 o null se zero dati
    };
    load: {
        mediaAppGiorno: number;
        splitMattina: number;      // ore 9..14
        splitPomeriggio: number;   // ore 15..21
    };
    times: {
        mediaRispostaSec: number;
        mediaNrSec: number;
        mediaTotaleSec: number;
    };
    responseDistribution: {
        pctRisp1: number;
        pctRisp2: number;
        pctRisp3: number;
        pctMai: number;
        denom: number;
    };
    recall: {
        pctSnoozeGiornata: number;
        pctParcheggiati: number;
        leadToccati: number;
    };
    hourlyDistribution: Array<{ hour: number; mediaApp: number }>;
    meta: {
        periodDays: number;
        daysWorked: number;
        nOperatoriAttivi: number;
        userFilter: string | null;
        generatedAt: string;
    };
};

const ROME_TZ = "Europe/Rome";

/** Conta i giorni lavorativi (lun-sab) in [start, end] inclusivi, in fuso Rome. */
function countWorkingDays(start: Date, end: Date): number {
    const msDay = 86400000;
    let n = 0;
    for (let t = start.getTime(); t <= end.getTime(); t += msDay) {
        const d = new Date(t);
        const dayName = new Intl.DateTimeFormat('en-US', { timeZone: ROME_TZ, weekday: 'short' }).format(d);
        if (dayName !== 'Sun') n++;
    }
    return Math.max(1, n);
}

export async function getConfermeAnalytics(opts: {
    periodDays: 7 | 14 | 30 | 90;
    userId?: string | null;
    /** Numero di operatori in turno per il calcolo della capacità (override del count
     *  automatico). Range 1..4. Se omesso, usa il count automatico di utenti CONFERME attivi. */
    nOperatoriOverride?: number | null;
}): Promise<ConfermeAnalyticsResult> {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role as string | undefined;
    if (!supabaseUser || !role || !["CONFERME", "MANAGER", "ADMIN"].includes(role)) {
        throw new Error("Unauthorized");
    }

    const periodDays = opts.periodDays;
    const userFilter = opts.userId && opts.userId !== 'all' ? opts.userId : null;

    const now = new Date();
    const periodStart = new Date(now.getTime() - periodDays * 86400000);
    const G = countWorkingDays(periodStart, now);

    // Operatori attivi in DB (per capacità del team). Eventuale override esplicito
    // della UI vince — utile quando alcuni account CONFERME esistono ma non sono
    // davvero in turno (es. account manager con role=CONFERME).
    const activeConferme = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.role, 'CONFERME'), eq(users.isActive, true)));
    const nOperatoriAttivi = activeConferme.length;
    const nOperatoriEffettivi = (typeof opts.nOperatoriOverride === 'number'
        && opts.nOperatoriOverride >= 1 && opts.nOperatoriOverride <= 4)
        ? opts.nOperatoriOverride
        : nOperatoriAttivi;

    // 1. Carico app/giorno + split mattina/pomeriggio + hourly distribution
    const appsInPeriod = await db.select({
        id: leads.id,
        appointmentDate: leads.appointmentDate,
    }).from(leads).where(and(
        isNotNull(leads.appointmentDate),
        gte(leads.appointmentDate, periodStart),
        lte(leads.appointmentDate, now),
    ));

    let nMattina = 0, nPomeriggio = 0;
    const hourBuckets = new Array(24).fill(0) as number[];
    for (const a of appsInPeriod) {
        if (!a.appointmentDate) continue;
        const hourStr = new Intl.DateTimeFormat('it-IT', { timeZone: ROME_TZ, hour: 'numeric', hour12: false }).format(a.appointmentDate);
        const h = parseInt(hourStr, 10);
        if (Number.isFinite(h)) {
            hourBuckets[h]++;
            if (h >= 9 && h <= 14) nMattina++;
            else if (h >= 15 && h <= 21) nPomeriggio++;
        }
    }
    const mediaAppGiorno = appsInPeriod.length / G;
    const splitMattina = nMattina / G;
    const splitPomeriggio = nPomeriggio / G;
    const hourlyDistribution = Array.from({ length: 13 }, (_, i) => {
        const h = 9 + i;
        return { hour: h, mediaApp: hourBuckets[h] / G };
    });

    // 2. Tempo medio chiamata (da leadEvents.conferme_call_logged)
    const callEventConditions = [
        eq(leadEvents.eventType, 'conferme_call_logged'),
        gte(leadEvents.timestamp, periodStart),
        lte(leadEvents.timestamp, now),
    ];
    if (userFilter) callEventConditions.push(eq(leadEvents.userId, userFilter));

    const callEvents = await db.select({
        metadata: leadEvents.metadata,
    }).from(leadEvents).where(and(...callEventConditions));

    let sumAns = 0, nAns = 0, sumNr = 0, nNr = 0, sumTot = 0, nTot = 0;
    for (const e of callEvents) {
        const md = (e.metadata as any) || {};
        const dur = typeof md.durationSeconds === 'number' ? md.durationSeconds : null;
        if (dur === null || dur < 0) continue;
        sumTot += dur; nTot++;
        if (md.answered === true) { sumAns += dur; nAns++; }
        else if (md.answered === false) { sumNr += dur; nNr++; }
    }
    const mediaRispostaSec = nAns > 0 ? sumAns / nAns : 0;
    const mediaNrSec = nNr > 0 ? sumNr / nNr : 0;
    const mediaTotaleSec = nTot > 0 ? sumTot / nTot : 0;

    // 3. % risposta per tentativo (lead con confirmationsTimestamp ∈ P)
    const outcomeConditions = [
        isNotNull(leads.confirmationsTimestamp),
        gte(leads.confirmationsTimestamp, periodStart),
        lte(leads.confirmationsTimestamp, now),
    ];
    if (userFilter) outcomeConditions.push(eq(leads.confirmationsUserId, userFilter));

    const outcomes = await db.select({
        confCall1At: leads.confCall1At,
        confCall2At: leads.confCall2At,
        confCall3At: leads.confCall3At,
        confirmationsDiscardReason: leads.confirmationsDiscardReason,
    }).from(leads).where(and(...outcomeConditions));

    let r1 = 0, r2 = 0, r3 = 0, mai = 0;
    for (const o of outcomes) {
        const isMai = o.confirmationsDiscardReason === '3 NR consecutivi'
            || o.confirmationsDiscardReason === '4 NR consecutivi';
        if (isMai) { mai++; continue; }
        if (!o.confCall1At) r1++;
        else if (!o.confCall2At) r2++;
        else if (!o.confCall3At) r3++;
        else r3++; // edge: outcome a 3 NR già fatti ma non scarto NR (raro)
    }
    const denom = r1 + r2 + r3 + mai;
    const pctRisp1 = denom > 0 ? r1 / denom : 0;
    const pctRisp2 = denom > 0 ? r2 / denom : 0;
    const pctRisp3 = denom > 0 ? r3 / denom : 0;
    const pctMai = denom > 0 ? mai / denom : 0;

    // 4. Recall: % snooze giornata + % parcheggiati altri giorni
    const recallEventConditions = [
        gte(leadEvents.timestamp, periodStart),
        lte(leadEvents.timestamp, now),
        inArray(leadEvents.eventType, ['conferme_snooze_set', 'conferme_recall_scheduled', 'conferme_no_answer', 'conferme_outcome_set', 'conferme_call_logged']),
    ];
    if (userFilter) recallEventConditions.push(eq(leadEvents.userId, userFilter));

    const recallEvents = await db.select({
        leadId: leadEvents.leadId,
        eventType: leadEvents.eventType,
        timestamp: leadEvents.timestamp,
        metadata: leadEvents.metadata,
    }).from(leadEvents).where(and(...recallEventConditions));

    const leadIdsToccati = new Set(recallEvents.map(e => e.leadId));
    const leadIdsSnoozeGiornata = new Set<string>();
    const leadIdsParcheggiati = new Set<string>();

    const sameDayRome = (a: Date, b: Date) => {
        const fa = new Intl.DateTimeFormat('en-CA', { timeZone: ROME_TZ }).format(a);
        const fb = new Intl.DateTimeFormat('en-CA', { timeZone: ROME_TZ }).format(b);
        return fa === fb;
    };

    for (const e of recallEvents) {
        const md = (e.metadata as any) || {};
        if (e.eventType === 'conferme_snooze_set' && md.snoozeAt) {
            const snoozeAt = new Date(md.snoozeAt);
            if (sameDayRome(snoozeAt, e.timestamp)) leadIdsSnoozeGiornata.add(e.leadId);
        } else if (e.eventType === 'conferme_recall_scheduled') {
            const payload = md.payload || {};
            if (payload.needsReschedule) leadIdsParcheggiati.add(e.leadId);
            else if (payload.newAppointmentDate) {
                const newAppt = new Date(payload.newAppointmentDate);
                if (!sameDayRome(newAppt, e.timestamp)) leadIdsParcheggiati.add(e.leadId);
            }
        }
    }
    const leadToccati = leadIdsToccati.size;
    const pctSnoozeGiornata = leadToccati > 0 ? leadIdsSnoozeGiornata.size / leadToccati : 0;
    const pctParcheggiati = leadToccati > 0 ? leadIdsParcheggiati.size / leadToccati : 0;

    // 5. Hero: saturazione e staffing
    const tempoMedioTotaleMin = mediaTotaleSec / 60;
    const moltRitenta = 1 + pctSnoozeGiornata + pctParcheggiati;
    const chiamatePerGiorno = mediaAppGiorno * moltRitenta;
    const demandMin = chiamatePerGiorno * tempoMedioTotaleMin;
    const capacityMin = 390 * Math.max(1, nOperatoriEffettivi);
    const saturation = capacityMin > 0 ? demandMin / capacityMin : 0;
    const operatorsFullDay = Math.ceil(demandMin / 390);

    let peakOperators = 0;
    let peakHour: number | null = null;
    for (const { hour, mediaApp } of hourlyDistribution) {
        const carico = mediaApp * tempoMedioTotaleMin * moltRitenta;
        const ops = carico / 60;
        if (ops > peakOperators) { peakOperators = ops; peakHour = hour; }
    }

    return {
        hero: { capacityMin, demandMin, saturation, operatorsFullDay, peakOperators, peakHour },
        load: { mediaAppGiorno, splitMattina, splitPomeriggio },
        times: { mediaRispostaSec, mediaNrSec, mediaTotaleSec },
        responseDistribution: { pctRisp1, pctRisp2, pctRisp3, pctMai, denom },
        recall: { pctSnoozeGiornata, pctParcheggiati, leadToccati },
        hourlyDistribution,
        meta: {
            periodDays,
            daysWorked: G,
            nOperatoriAttivi: nOperatoriEffettivi,
            userFilter,
            generatedAt: new Date().toISOString(),
        },
    };
}

/** Lista operatori Conferme attivi per popolare il filtro UI. */
export async function listActiveConfermeUsers(): Promise<Array<{ id: string; name: string }>> {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role as string | undefined;
    if (!supabaseUser || !role || !["CONFERME", "MANAGER", "ADMIN"].includes(role)) {
        throw new Error("Unauthorized");
    }
    const rows = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
    }).from(users).where(and(eq(users.role, 'CONFERME'), eq(users.isActive, true)));
    return rows.map(r => ({ id: r.id, name: r.displayName || r.name || 'Conferme' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'it'));
}
