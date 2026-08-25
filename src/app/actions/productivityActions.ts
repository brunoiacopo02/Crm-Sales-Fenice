"use server"

/**
 * Produttività telefonica dei GDO dai tabulati del centralino (tabella
 * pbxCalls, alimentata da scripts/import-cdr.ts).
 *
 * Il "tempo non telefonico" comprende sia il ritmo di lavoro fra una chiamata
 * e l'altra (chiudere l'esito, comporre il numero dopo — è lavoro, non
 * pausa) sia le interruzioni vere. Dal 2026-08-25 le due cose si contano
 * separatamente (vedi workRhythmMinPerDay/pauseMinPerDay) e le interruzioni
 * si confrontano coi 30 minuti di pausa concessi da contratto
 * (overAllowanceMinPerDay), non più col migliore del gruppo.
 *
 * Tutte le medie giornaliere (chiamate, telefono, squilli, ritmo, pause,
 * bordi del turno) si calcolano SOLO sulle "giornate intere", cioè quelle
 * che non sono permessi/mezze giornate/uscite autorizzate (vedi la soglia
 * usata per `daysShort`). Includere le giornate corte abbasserebbe ogni
 * voce e farebbe risultare chi ha avuto permessi più diligente di chi ha
 * lavorato tutti i giorni interi. Le giornate corte non spariscono: restano
 * contate in `daysShort` e mostrate a parte.
 */

import { db } from "@/db"
import { pbxCalls, users, leads } from "@/db/schema"
import { and, gte, lte, lt, eq, isNotNull, or } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { computeDayMetrics, median, type DayCall } from "@/lib/cdr/dayMetrics"
import { shiftBoundsFor, lateAndEarly, saturdayAllowanceSec, fermoTotalSeconds, SATURDAY_TRAINING_ALLOWANCE_MIN, WEEKDAY_DAYS_SHORT_THRESHOLD_MIN, SATURDAY_DAYS_SHORT_THRESHOLD_MIN, romeDowOf } from "@/lib/cdr/shift"
import { apptSetAt } from "@/lib/kpi/canon"
import { dayBoundsRome } from "@/lib/dateUtils"

/** Sotto questa soglia la giornata non è rappresentativa (mezze giornate, assenze). */
const MIN_CALLS_PER_DAY = 40

/**
 * Soglia (secondi) oltre la quale un buco fra due chiamate è una vera
 * interruzione e non ritmo di lavoro. Sotto: chiudere l'esito e comporre il
 * numero successivo (11-25 secondi di mediana, misurato agosto 2026) — è
 * lavoro incomprimibile, non pausa. Soglia prudente concordata col committente
 * il 2026-08-25.
 */
const WORK_RHYTHM_THRESHOLD_SEC = 2 * 60

/**
 * Pausa quotidiana prevista da contratto (minuti): diritto contrattuale, non
 * un obiettivo aziendale. È il metro di riferimento per overAllowanceMinPerDay,
 * al posto del "migliore del gruppo" usato in precedenza.
 */
const CONTRACTUAL_PAUSE_ALLOWANCE_MIN = 30

/** Ruoli che possono vedere produttività telefonica e qualità appuntamenti dei GDO. */
const PRODUCTIVITY_VIEW_ROLES = ['ADMIN', 'MANAGER', 'TL']

export type PhoneProductivityRow = {
    userId: string
    gdo: string
    /**
     * Giornate INTERE (non permessi/mezze giornate): il denominatore di
     * tutte le medie della riga (callsPerDay, talkMinPerDay, ringingMinPerDay,
     * workRhythmMinPerDay, pauseMinPerDay, pauseCountPerDay, startLateAvgMin,
     * endEarlyAvgMin). Le giornate escluse sono in `daysShort`, mostrate a
     * parte per trasparenza, mai sparite dal computo.
     */
    days: number
    callsPerDay: number
    talkMinPerDay: number
    /**
     * Il telefono squilla ma nessuno risponde — media giornaliera di
     * sum(duration - billsec). Non è conversazione (talkMinPerDay) né tempo
     * fermo: è il terzo pezzo del turno, calcolato con lo stesso schema
     * degli altri campi (accumulo per giornata, poi media).
     */
    ringingMinPerDay: number
    /**
     * Ritmo di lavoro: minuti al giorno passati in buchi fra due chiamate
     * fino a WORK_RHYTHM_THRESHOLD_SEC (2 minuti) — chiudere l'esito e
     * comporre il numero dopo. Non è pausa.
     */
    workRhythmMinPerDay: number
    /**
     * Interruzioni vere: minuti al giorno passati in buchi fra due chiamate
     * sopra WORK_RHYTHM_THRESHOLD_SEC (2 minuti). Il sabato è già scalato
     * dell'abbuono formazione (vedi saturdayAllowanceSec in shift.ts),
     * altrimenti l'ultima ora di formazione risulterebbe un'interruzione.
     */
    pauseMinPerDay: number
    /**
     * Quante interruzioni sopra i 2 minuti in media al giorno (un decimale).
     * La differenza fra le persone è quasi tutta qui, non nella durata della
     * singola pausa (vedi avgPauseMin, quasi uguale per tutti).
     */
    pauseCountPerDay: number
    /** Durata media di una singola interruzione (minuti, arrotondati). Non abbuonata sabato: è la fotografia grezza della pausa tipica. */
    avgPauseMin: number
    /** max(0, pauseMinPerDay - 30): scostamento dai 30 minuti di pausa concessi da contratto. È il numero da guardare. */
    overAllowanceMinPerDay: number
    /** Ore complessive di eccesso nel periodo mostrato: overAllowanceMinPerDay * giornate INTERE / 60, un decimale (sulle giornate corte non si può pretendere il turno pieno). */
    overAllowanceHoursPeriod: number
    /**
     * Ritardo fra l'inizio turno e la prima chiamata — MEDIANA sulle giornate
     * (mai negativo). Non la media: poche giornate anomale (permessi, mezze
     * giornate, uscite autorizzate) la trascinano lontano dal caso tipico.
     */
    startLateMin: number
    /**
     * Anticipo fra la fine dell'ultima chiamata e la fine turno — MEDIANA
     * sulle giornate (mai negativo). Stesso motivo di startLateMin: la media
     * di questo campo può arrivare a 22-51 min pur avendo la maggioranza
     * delle giornate a 1-12 min, perché 1-2 giornate anomale a 200+ min la
     * spostano — vedi daysFullShift/daysShort per non perdere l'eccezione.
     */
    endEarlyMin: number
    /**
     * Ritardo fra l'inizio turno e la prima chiamata — MEDIA sulle sole
     * giornate INTERE (mai negativa), non mediana. Serve, insieme a
     * endEarlyAvgMin e workRhythmMinPerDay, a rendere la tabella verificabile
     * a mano: la mediana (startLateMin, calcolata su tutte le giornate) non è
     * sommabile con le altre colonne di tempo, la media sì. Calcolata sulle
     * sole giornate intere: includendo i permessi risulterebbe un ritardo
     * medio più basso di quello reale nelle giornate normali.
     */
    startLateAvgMin: number
    /**
     * Anticipo fra la fine dell'ultima chiamata e la fine turno — MEDIA sulle
     * sole giornate INTERE (mai negativa). Stesso motivo di startLateAvgMin:
     * serve per la somma di riga, la mediana (endEarlyMin, su tutte le
     * giornate) resta per il giudizio sulle giornate tipiche. Senza questo
     * filtro il valore risultava 19-52 min (trascinato dai permessi) contro
     * i 2-10 min reali delle sole giornate intere.
     */
    endEarlyAvgMin: number
    /** Giornate in cui si arriva a fine turno: anticipo ≤ 15 minuti. */
    daysFullShift: number
    /**
     * Giornate con anticipo oltre la soglia: mezze giornate, permessi, uscite
     * autorizzate. Soglia: 60 min nei feriali, 120 min il sabato (vedi
     * WEEKDAY_DAYS_SHORT_THRESHOLD_MIN e SATURDAY_DAYS_SHORT_THRESHOLD_MIN in shift.ts).
     * Il sabato 120 min sta dentro il gap fra formazione legittima (≤95 min)
     * e giornate anomale (≥113 min).
     */
    daysShort: number
    /** Buchi dentro il turno: fermo totale meno i due bordi. */
    idleInShiftMin: number
}

export async function getPhoneProductivity(
    fromDateLocal: string,
    toDateLocal: string,
): Promise<{ rows: PhoneProductivityRow[] }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!PRODUCTIVITY_VIEW_ROLES.includes(ctx.role)) {
        throw new Error(`Forbidden: user ${ctx.userId} has role '${ctx.role}', not allowed to view phone productivity`)
    }

    const raw = await db.select({
        userId: pbxCalls.userId,
        dateLocal: pbxCalls.dateLocal,
        calldate: pbxCalls.calldate,
        duration: pbxCalls.duration,
        billsec: pbxCalls.billsec,
        disposition: pbxCalls.disposition,
        name: users.name,
        displayName: users.displayName,
    })
        .from(pbxCalls)
        .innerJoin(users, eq(users.id, pbxCalls.userId))
        .where(and(
            companyScope(ctx, pbxCalls.companyId),
            eq(pbxCalls.direction, 'out'),
            isNotNull(pbxCalls.userId),
            gte(pbxCalls.dateLocal, fromDateLocal),
            lte(pbxCalls.dateLocal, toDateLocal),
        ))

    // Raggruppa per (utente, giorno)
    const byDay = new Map<string, { userId: string; gdo: string; dateLocal: string; calls: DayCall[] }>()
    for (const r of raw) {
        const key = `${r.userId}|${r.dateLocal}`
        let slot = byDay.get(key)
        if (!slot) {
            slot = { userId: r.userId!, gdo: r.displayName || r.name || r.userId!, dateLocal: r.dateLocal, calls: [] }
            byDay.set(key, slot)
        }
        slot.calls.push({
            calldate: r.calldate,
            duration: r.duration,
            billsec: r.billsec,
            disposition: r.disposition,
        })
    }

    // Aggrega per utente sulle sole giornate rappresentative
    const byUser = new Map<string, {
        gdo: string
        // daysFull = giornate INTERE: denominatore di tutte le medie (calls,
        // talk, ringing, workRhythm, pause, startLate/endEarly medi).
        // daysShort = giornate corte (permessi/mezze giornate), escluse dalle
        // medie ma contate per trasparenza. daysTotal = daysFull + daysShort,
        // usato solo per idleInShiftMin (metrica non di riga, non richiesta
        // di essere "solo giornate intere").
        daysFull: number; daysShort: number; daysTotal: number
        calls: number; talk: number; ringing: number
        // startLate/endEarly per-giornata (secondi), su TUTTE le giornate
        // rappresentative: servono per la MEDIANA — vedi commento su
        // PhoneProductivityRow. Le somme per la MEDIA (startLateFullSec/
        // endEarlyFullSec) sono invece accumulate solo sulle giornate intere.
        startLateDaysSec: number[]; endEarlyDaysSec: number[]
        startLateFullSec: number; endEarlyFullSec: number
        daysFullShift: number
        idleInShift: number
        // Ritmo di lavoro (≤2 min) e interruzioni vere (>2 min) fra chiamate,
        // accumulati solo sulle giornate intere. pauseSec è già scalato
        // dell'abbuono formazione del sabato (per pauseMinPerDay/
        // overAllowance); pauseSecRaw e pauseCount non lo sono (per
        // avgPauseMin, la fotografia grezza della pausa tipica).
        workRhythmSec: number; pauseSec: number; pauseSecRaw: number; pauseCount: number
    }>()
    for (const slot of byDay.values()) {
        if (slot.calls.length < MIN_CALLS_PER_DAY) continue
        const m = computeDayMetrics(slot.calls)
        if (!m) continue

        // Le domeniche (se mai ce ne fossero) non hanno un turno definito:
        // la giornata va esclusa da tutte le metriche, non solo da quelle di turno.
        const shift = shiftBoundsFor(slot.dateLocal)
        if (!shift) continue

        let u = byUser.get(slot.userId)
        if (!u) {
            u = {
                gdo: slot.gdo, daysFull: 0, daysShort: 0, daysTotal: 0,
                calls: 0, talk: 0, ringing: 0,
                startLateDaysSec: [], endEarlyDaysSec: [],
                startLateFullSec: 0, endEarlyFullSec: 0,
                daysFullShift: 0,
                idleInShift: 0,
                workRhythmSec: 0, pauseSec: 0, pauseSecRaw: 0, pauseCount: 0,
            }
            byUser.set(slot.userId, u)
        }
        u.daysTotal += 1

        // Metriche di turno per questa giornata (secondi), poi mediate sulle
        // giornate come tutto il resto — mai sommate tutte insieme e divise alla fine.
        const shiftDurationSec = shift.minutes * 60
        const { startLateSec, endEarlySec } = lateAndEarly(m.firstAt, m.lastAt, shift)
        // Il sabato la formazione occupa spesso l'ultima ora: quell'anticipo
        // non conta come fermo, fino a SATURDAY_TRAINING_ALLOWANCE_MIN minuti
        // (vedi shift.ts). Nei feriali l'abbuono è sempre 0.
        const allowanceSec = saturdayAllowanceSec(slot.dateLocal, endEarlySec)
        const fermoTotalSec = fermoTotalSeconds(slot.dateLocal, shiftDurationSec, m.occupiedSeconds, endEarlySec)
        // I buchi interni restano quelli "grezzi" (non scalati dall'abbuono):
        // fermoTotalSec è già al netto dell'abbuono sull'anticipo, quindi qui
        // si sottrae l'anticipo altrettanto scalato per tornare ai soli buchi
        // interni — fermoTotale = startLate + idleInShift + (endEarly - abbuono).
        const idleInShiftSec = Math.max(0, fermoTotalSec - startLateSec - (endEarlySec - allowanceSec))

        // Mediana: su TUTTE le giornate rappresentative (vedi commento su
        // PhoneProductivityRow) — non filtrare qui, solo nelle somme sotto.
        u.startLateDaysSec.push(startLateSec)
        u.endEarlyDaysSec.push(endEarlySec)
        // Soglia sulla singola giornata, non sulla mediana: "arriva a fine
        // turno" è un evento puntuale, indipendente da intera/corta.
        if (endEarlySec <= 15 * 60) u.daysFullShift += 1
        u.idleInShift += idleInShiftSec

        // Giornata intera = non "corta" (non un permesso/mezza giornata).
        // Soglia dipendente dal giorno: feriali 60 min, sabato 120 min (vedi
        // shift.ts per la distribuzione che giustifica 120 — assorbe la
        // formazione legittima). Tutte le medie della riga si calcolano SOLO
        // su queste giornate: vedi commento in testa al file.
        const threshold = romeDowOf(slot.dateLocal) === 6
            ? SATURDAY_DAYS_SHORT_THRESHOLD_MIN * 60
            : WEEKDAY_DAYS_SHORT_THRESHOLD_MIN * 60
        if (endEarlySec > threshold) {
            u.daysShort += 1
            continue // giornata corta: non entra in nessuna media
        }
        u.daysFull += 1
        u.calls += m.calls
        u.talk += m.talkSeconds
        // squilli a vuoto = tempo occupato (duration) meno conversazione
        // effettiva (billsec), accumulato per giornata come talk/pause/ecc.
        u.ringing += m.occupiedSeconds - m.talkSeconds
        u.startLateFullSec += startLateSec
        u.endEarlyFullSec += endEarlySec

        // Ritmo di lavoro vs interruzioni vere: si riparte dai buchi grezzi
        // fra chiamate (m.gaps), non dai bucket esistenti (i loro confini a
        // 60/180/600/1800s non cadono sulla soglia dei 2 minuti concordata).
        let workRhythmSecDay = 0
        let pauseSecRawDay = 0
        let pauseCountRawDay = 0
        for (const gap of m.gaps) {
            if (gap <= WORK_RHYTHM_THRESHOLD_SEC) workRhythmSecDay += gap
            else {
                pauseSecRawDay += gap
                pauseCountRawDay += 1
            }
        }
        // Il sabato l'ultima ora di formazione compare come un buco interno
        // fra due chiamate: va abbuonata dalle pause con la stessa funzione e
        // lo stesso tetto (60 min) già usati per l'anticipo a fine turno,
        // altrimenti la formazione risulterebbe un'interruzione.
        const pauseAllowanceSec = saturdayAllowanceSec(slot.dateLocal, pauseSecRawDay)
        u.workRhythmSec += workRhythmSecDay
        u.pauseSec += pauseSecRawDay - pauseAllowanceSec
        u.pauseSecRaw += pauseSecRawDay
        u.pauseCount += pauseCountRawDay
    }

    const rows: PhoneProductivityRow[] = [...byUser.entries()]
        .filter(([, u]) => u.daysFull > 0)
        .map(([userId, u]) => {
            const pauseMinPerDay = Math.round(u.pauseSec / u.daysFull / 60)
            const overAllowanceMinPerDay = Math.max(0, pauseMinPerDay - CONTRACTUAL_PAUSE_ALLOWANCE_MIN)
            return {
                userId,
                gdo: u.gdo,
                days: u.daysFull,
                callsPerDay: Math.round(u.calls / u.daysFull),
                talkMinPerDay: Math.round(u.talk / u.daysFull / 60),
                ringingMinPerDay: Math.round(u.ringing / u.daysFull / 60),
                workRhythmMinPerDay: Math.round(u.workRhythmSec / u.daysFull / 60),
                pauseMinPerDay,
                // Un decimale: è la metrica che spiega la differenza fra le
                // persone (vedi commento sul campo in PhoneProductivityRow).
                pauseCountPerDay: Math.round((u.pauseCount / u.daysFull) * 10) / 10,
                avgPauseMin: u.pauseCount ? Math.round(u.pauseSecRaw / u.pauseCount / 60) : 0,
                overAllowanceMinPerDay,
                overAllowanceHoursPeriod: Math.round((overAllowanceMinPerDay * u.daysFull / 60) * 10) / 10,
                // Mediana, su tutte le giornate rappresentative — vedi commento su PhoneProductivityRow.
                startLateMin: Math.round(median(u.startLateDaysSec) / 60),
                endEarlyMin: Math.round(median(u.endEarlyDaysSec) / 60),
                // Media, solo giornate intere: serve alla somma di riga verificabile
                // a mano (vedi commento sui campi in PhoneProductivityRow).
                startLateAvgMin: Math.round(u.startLateFullSec / u.daysFull / 60),
                endEarlyAvgMin: Math.round(u.endEarlyFullSec / u.daysFull / 60),
                daysFullShift: u.daysFullShift,
                daysShort: u.daysShort,
                idleInShiftMin: u.daysTotal ? Math.round(u.idleInShift / u.daysTotal / 60) : 0,
            }
        }).sort((a, b) => b.overAllowanceMinPerDay - a.overAllowanceMinPerDay)

    return { rows }
}

export type ApptQualityRow = {
    userId: string
    gdo: string
    app: number
    presenziati: number
    chiusi: number
    fatturato: number
    presenzaPct: number
    chiusuraPct: number
    euroPerApp: number
}

/**
 * Cascata di qualità degli appuntamenti per GDO.
 *
 * Attenzione alle date: l'appuntamento si conta al momento in cui è stato
 * fissato, la presenza al giorno in cui il lead si è presentato, la chiusura
 * alla data dell'esito del venditore. Sono tre date diverse: gli appuntamenti
 * di fine mese si presentano e si chiudono nel mese successivo, quindi la
 * cascata dell'ultimo mese è sempre parziale. Va detto nella UI.
 */
export async function getApptQuality(
    fromDateLocal: string,
    toDateLocal: string,
): Promise<ApptQualityRow[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!PRODUCTIVITY_VIEW_ROLES.includes(ctx.role)) {
        throw new Error(`Forbidden: user ${ctx.userId} has role '${ctx.role}', not allowed to view appointment quality`)
    }

    // Bounds Europe/Rome del periodo [fromDateLocal, toDateLocal] (inclusive),
    // via dayBoundsRome (gestisce il DST) invece di un offset scritto a mano:
    // `from` = inizio del primo giorno, `to` = inizio del giorno dopo `toDateLocal`
    // (esclusivo) — vedi inRange più sotto.
    const from = dayBoundsRome(new Date(`${fromDateLocal}T00:00:00Z`)).start
    const to = dayBoundsRome(new Date(`${toDateLocal}T00:00:00Z`)).end

    const rows = await db.select({
        userId: leads.assignedToId,
        name: users.name,
        displayName: users.displayName,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeAt: leads.salespersonOutcomeAt,
        closeAmountEur: leads.closeAmountEur,
    })
        .from(leads)
        .innerJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            companyScope(ctx, leads.companyId),
            eq(users.role, 'GDO'),
            eq(users.isBot, false),
            or(
                and(gte(leads.appointmentCreatedAt, from), lt(leads.appointmentCreatedAt, to)),
                and(gte(leads.appointmentDate, from), lt(leads.appointmentDate, to)),
                and(gte(leads.presentedAt, from), lt(leads.presentedAt, to)),
                and(gte(leads.salespersonOutcomeAt, from), lt(leads.salespersonOutcomeAt, to)),
            ),
        ))

    const agg = new Map<string, ApptQualityRow>()
    const slot = (id: string, gdo: string) => {
        let s = agg.get(id)
        if (!s) {
            s = { userId: id, gdo, app: 0, presenziati: 0, chiusi: 0, fatturato: 0, presenzaPct: 0, chiusuraPct: 0, euroPerApp: 0 }
            agg.set(id, s)
        }
        return s
    }
    const inRange = (d: Date | null) => !!d && d >= from && d < to

    for (const r of rows) {
        if (!r.userId) continue
        const s = slot(r.userId, r.displayName || r.name || r.userId)
        if (inRange(apptSetAt(r))) s.app += 1
        if (inRange(r.presentedAt)) s.presenziati += 1
        if (r.salespersonOutcome?.toLowerCase() === 'chiuso' && inRange(r.salespersonOutcomeAt)) {
            s.chiusi += 1
            s.fatturato += r.closeAmountEur || 0
        }
    }

    return [...agg.values()]
        .filter(s => s.app > 0)
        .map(s => ({
            ...s,
            fatturato: Math.round(s.fatturato),
            presenzaPct: s.app ? Math.round((100 * s.presenziati) / s.app) : 0,
            chiusuraPct: s.presenziati ? Math.round((100 * s.chiusi) / s.presenziati) : 0,
            euroPerApp: s.app ? Math.round(s.fatturato / s.app) : 0,
        }))
        .sort((a, b) => b.euroPerApp - a.euroPerApp)
}
