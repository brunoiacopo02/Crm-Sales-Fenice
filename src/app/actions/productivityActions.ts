"use server"

/**
 * Produttività telefonica dei GDO dai tabulati del centralino (tabella
 * pbxCalls, alimentata da scripts/import-cdr.ts).
 *
 * Il "tempo non telefonico" si scompone in TRE categorie, che dicono cose
 * diverse e vanno lette separatamente:
 *   1. il tempo per scrivere l'esito, riconosciuto telefonata per telefonata
 *      in base a COSA c'era da scrivere (workRhythmMinPerDay): 9 secondi se
 *      non ha risposto nessuno, 80 se è stato preso un appuntamento — vedi
 *      allowance.ts. È lavoro e non è un metro di giudizio;
 *   2. interruzioni brevi: il tempo oltre l'abbuono, nei buchi fino a 10
 *      minuti (shortPauseMinPerDay);
 *   3. pause vere, nei buchi oltre i 10 minuti (longPauseMinPerDay), 3-6
 *      volte al giorno: le uscite.
 *
 * Fino al 2026-08-26 l'abbuono era una soglia unica di 2 minuti per ogni
 * telefonata, indipendente dall'esito. Era troppo generosa: significava
 * regalare fino a due minuti anche dopo uno squillo a vuoto, dove non c'è
 * niente da annotare. Su agosto la sola fascia 30 secondi-2 minuti dopo una
 * chiamata senza risposta valeva 6-25 minuti al giorno a persona.
 * Le categorie 2+3 insieme sono pauseMinPerDay e si confrontano coi 30
 * minuti di pausa concessi da contratto (overAllowanceMinPerDay), non più
 * col migliore del gruppo.
 *
 * shortPauseAfterRingCountPerDay isola le interruzioni brevi che seguono uno
 * squillo a vuoto: lì non c'è nessun esito da scrivere, quindi è la voce più
 * difendibile in un confronto con la persona (1,5 volte al giorno il
 * migliore, 8,8 il peggiore).
 *
 * Tutte le medie giornaliere (chiamate, telefono, squilli, ritmo, pause,
 * bordi del turno) si calcolano SOLO sulle "giornate intere", cioè quelle
 * che non sono permessi/mezze giornate/uscite autorizzate né arrivi molto in
 * ritardo (vedi la soglia usata per `daysShort`, applicata a entrambi i
 * bordi del turno). Includere le giornate corte abbasserebbe ogni voce e
 * farebbe risultare chi ha avuto permessi più diligente di chi ha lavorato
 * tutti i giorni interi. Nessuna giornata con dei dati dietro sparisce però
 * dal conto: le corte restano in `daysShort` e quelle sotto le 40 chiamate
 * in `daysLowVolume`, entrambe mostrate a parte.
 */

import { db } from "@/db"
import { pbxCalls, users, leads, callLogs } from "@/db/schema"
import { and, gte, lte, lt, eq, isNotNull, or } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { computeDayMetrics, median, type DayCall } from "@/lib/cdr/dayMetrics"
import { shiftBoundsFor, lateAndEarly, trainingAllowanceSec, isCollectiveTrainingDay, fermoTotalSeconds, SATURDAY_TRAINING_ALLOWANCE_MIN, WEEKDAY_DAYS_SHORT_THRESHOLD_MIN, SATURDAY_DAYS_SHORT_THRESHOLD_MIN, romeDowOf } from "@/lib/cdr/shift"
import { apptSetAt } from "@/lib/kpi/canon"
import { dayBoundsRome, toRomeDateStr } from "@/lib/dateUtils"

/** Sotto questa soglia la giornata non è rappresentativa (mezze giornate, assenze). */
const MIN_CALLS_PER_DAY = 40

/**
 * Soglia (secondi) di eccesso oltre l'abbuono perché la fermata diventi un
 * EVENTO contato ("quante volte"). I minuti oltre l'abbuono si contano
 * sempre, anche pochi secondi; l'evento no, altrimenti ogni singola
 * telefonata produrrebbe un'interruzione e la colonna dei conteggi non
 * direbbe più niente. Un minuto oltre il tempo riconosciuto è una fermata
 * che si vede.
 */
const PAUSE_EVENT_MIN_SEC = 60

/**
 * Soglia (secondi) che separa l'interruzione breve dalla pausa vera. Sotto i
 * 10 minuti è lo stacco che non basta per uscire; sopra è un'uscita. Le due
 * fasce si distribuiscono in modo diverso fra le persone e vanno mostrate
 * separate: insieme facevano una colonna "pause" che mescolava due
 * comportamenti distinti.
 */
const LONG_PAUSE_THRESHOLD_SEC = 10 * 60

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
     * Minuti al giorno riconosciuti per scrivere gli esiti: la somma degli
     * abbuoni di ogni telefonata (9 / 30 / 80 secondi a seconda dell'esito,
     * vedi allowance.ts), limitata al buco realmente disponibile. Non è
     * pausa e non è un metro di giudizio: cresce col numero di telefonate.
     */
    workRhythmMinPerDay: number
    /**
     * Interruzioni vere: minuti al giorno passati in buchi fra due chiamate
     * oltre l'abbuono di scrittura dell'esito. È esattamente la somma di
     * shortPauseMinPerDay + longPauseMinPerDay, e si calcola da quelle: così
     * la riga somma anche mostrando le due voci separate. Il sabato è già
     * scalato dell'abbuono formazione (vedi saturdayAllowanceSec in
     * shift.ts), altrimenti l'ultima ora di formazione risulterebbe pausa.
     */
    pauseMinPerDay: number
    /** Interruzioni brevi: minuti al giorno oltre l'abbuono, nei buchi fino a 10 minuti. */
    shortPauseMinPerDay: number
    /** Quante interruzioni brevi in media al giorno (un decimale): contate quando l'eccesso supera PAUSE_EVENT_MIN_SEC. */
    shortPauseCountPerDay: number
    /**
     * Quante delle interruzioni brevi seguono uno squillo a vuoto (la
     * chiamata precedente ha billsec = 0), in media al giorno. Dopo uno
     * squillo a vuoto non c'è nessun esito da scrivere: è la voce meno
     * contestabile della scheda.
     */
    shortPauseAfterRingCountPerDay: number
    /** Pause vere (oltre 10 min): minuti in media al giorno, già al netto dell'abbuono formazione del sabato. */
    longPauseMinPerDay: number
    /** Quante pause vere in media al giorno (un decimale): sono le uscite, 3-6 in una giornata normale. */
    longPauseCountPerDay: number
    /**
     * Su cento squilli a vuoto, quanti sono seguiti da un'interruzione breve
     * (un decimale). È la stessa cosa di shortPauseAfterRingCountPerDay ma in
     * forma di TASSO, e regge un'obiezione che il conteggio non regge: chi
     * lavora liste riciclate ha molti più squilli a vuoto degli altri, quindi
     * ha più occasioni di fermarsi. Il tasso toglie di mezzo il volume.
     * Agosto 2026: 1,1-6,1% per tutti, 12,1% per il GDO 115.
     */
    shortPauseAfterRingRatePct: number
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
     * Giornate corte: mezze giornate, permessi, uscite autorizzate e arrivi
     * molto in ritardo. Soglia applicata a ENTRAMBI i bordi del turno
     * (anticipo in uscita e ritardo in ingresso): 60 min nei feriali, 120 min
     * il sabato (vedi WEEKDAY_DAYS_SHORT_THRESHOLD_MIN e
     * SATURDAY_DAYS_SHORT_THRESHOLD_MIN in shift.ts). Il sabato 120 min sta
     * dentro il gap fra formazione legittima (≤95 min) e giornate anomale
     * (≥113 min).
     */
    daysShort: number
    /**
     * Giornate con meno di MIN_CALLS_PER_DAY chiamate: non rappresentative,
     * fuori da tutte le medie. Contate qui perché nessuna giornata con dei
     * dati dietro sparisca in silenzio — prima uscivano prima di qualunque
     * contatore, mentre la pagina dichiarava che le escluse erano tutte
     * mostrate.
     */
    daysLowVolume: number
    /**
     * Giornate il cui turno non e' coperto per intero dai tabulati importati
     * (l'export si fa a mano e puo' fermarsi a meta' giornata). Escluse da
     * tutto: se contassero come giornate corte, l'ultimo giorno importato
     * risulterebbe un permesso per l'intera squadra.
     */
    daysNotImported: number
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
        dstKey: pbxCalls.dstKey,
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

    // Esiti registrati nel CRM nello stesso periodo: servono a sapere COSA
    // c'era da scrivere dopo ogni telefonata, e quindi quanto tempo di lavoro
    // riconoscere nel buco che segue (vedi allowance.ts). Si agganciano alla
    // telefonata per (operatore, giornata, ultime dieci cifre del numero):
    // stessa chiave usata da dstKey nei tabulati. Fra più esiti dello stesso
    // giorno sullo stesso numero si prende quello più vicino nel tempo alla
    // telefonata — gli esiti si registrano spesso con parecchio ritardo.
    const outcomeRows = await db.select({
        userId: callLogs.userId,
        outcome: callLogs.outcome,
        createdAt: callLogs.createdAt,
        phone: leads.phone,
    })
        .from(callLogs)
        .innerJoin(leads, eq(leads.id, callLogs.leadId))
        .where(and(
            companyScope(ctx, callLogs.companyId),
            isNotNull(callLogs.userId),
            gte(callLogs.createdAt, dayBoundsRome(new Date(`${fromDateLocal}T12:00:00Z`)).start),
            lte(callLogs.createdAt, dayBoundsRome(new Date(`${toDateLocal}T12:00:00Z`)).end),
        ))

    /** (utente|giornata|ultime 10 cifre) -> esiti di quella giornata su quel numero. */
    const outcomesByCall = new Map<string, { outcome: string; atMs: number }[]>()
    for (const r of outcomeRows) {
        const key10 = (r.phone ?? '').replace(/\D/g, '').slice(-10)
        if (key10.length < 10 || !r.userId) continue
        const key = `${r.userId}|${toRomeDateStr(r.createdAt)}|${key10}`
        const list = outcomesByCall.get(key)
        if (list) list.push({ outcome: r.outcome, atMs: r.createdAt.getTime() })
        else outcomesByCall.set(key, [{ outcome: r.outcome, atMs: r.createdAt.getTime() }])
    }

    /** L'esito registrato più vicino nel tempo a quella telefonata, se esiste. */
    const outcomeFor = (userId: string, dateLocal: string, dstKey: string | null, atMs: number): string | null => {
        if (!dstKey) return null
        const list = outcomesByCall.get(`${userId}|${dateLocal}|${dstKey}`)
        if (!list?.length) return null
        let best = list[0]
        for (const o of list) {
            if (Math.abs(o.atMs - atMs) < Math.abs(best.atMs - atMs)) best = o
        }
        return best.outcome
    }

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
            outcome: outcomeFor(r.userId!, r.dateLocal, r.dstKey, r.calldate.getTime()),
            calldate: r.calldate,
            duration: r.duration,
            billsec: r.billsec,
            disposition: r.disposition,
        })
    }

    // PRIMO PASSAGGIO: una riga per (utente, giornata), senza decidere
    // ancora nulla. Serve perché l'abbuono formazione non è deducibile da
    // una giornata sola: dipende da cosa ha fatto TUTTA la squadra quel
    // giorno (vedi isCollectiveTrainingDay in shift.ts).
    type DayRecord = {
        userId: string; gdo: string; dateLocal: string
        shiftDurationSec: number
        startLateSec: number; endEarlySec: number
        calls: number; talkSec: number; ringingSec: number; occupiedSec: number
        unansweredCalls: number
        workRhythmSec: number
        shortPauseSec: number; shortPauseCount: number; shortPauseAfterRingCount: number
        longPauseSecRaw: number; longPauseCount: number
        /** Sotto MIN_CALLS_PER_DAY: giornata non rappresentativa. Contata, non mediata. */
        lowVolume: boolean
        /** Il turno finisce dopo l'ultima chiamata importata: tabulati incompleti, non un comportamento. */
        notImported: boolean
    }
    // Fin dove arrivano i tabulati importati. L'export si fa a mano e puo'
    // fermarsi a meta' giornata: quella giornata risulterebbe "corta" per
    // tutti, cioe' un permesso collettivo che non e' mai avvenuto. Le
    // giornate il cui turno finisce dopo l'ultima chiamata importata sono
    // percio' escluse da tutto e contate a parte.
    let lastImportedMs = 0
    for (const r of raw) {
        const endMs = r.calldate.getTime() + r.duration * 1000
        if (endMs > lastImportedMs) lastImportedMs = endMs
    }

    const dayRecords: DayRecord[] = []
    for (const slot of byDay.values()) {
        // Le domeniche (se mai ce ne fossero) non hanno un turno definito:
        // la giornata va esclusa da tutte le metriche, non solo da quelle di turno.
        const shift = shiftBoundsFor(slot.dateLocal)
        if (!shift) continue
        const m = computeDayMetrics(slot.calls)
        if (!m) continue
        const { startLateSec, endEarlySec } = lateAndEarly(m.firstAt, m.lastAt, shift)

        // Le tre categorie: si riparte dai buchi grezzi fra chiamate
        // (m.gapDetails), non dai bucket esistenti (i loro confini a
        // 60/180/600/1800s non cadono sulle soglie concordate di 2 e 10
        // minuti). gapDetails porta anche l'esito della chiamata che precede
        // il buco, che serve per le interruzioni "dopo uno squillo a vuoto".
        let workRhythmSec = 0
        let shortPauseSec = 0, shortPauseCount = 0, shortPauseAfterRingCount = 0
        let longPauseSecRaw = 0, longPauseCount = 0
        for (const { seconds, afterUnanswered, startsAt, allowanceSec } of m.gapDetails) {
            // Il buco va ritagliato sui bordi del turno: chi comincia a
            // chiamare prima dell'inizio turno aveva un buco fra quella
            // chiamata e la prima "in orario", e addebitarlo per intero
            // significa contare come pausa del tempo fuori turno — cioe'
            // punire chi si e' messo al telefono in anticipo. Stessa cosa in
            // coda. Fino al 2026-08-26 il buco entrava intero: valeva 1-8
            // minuti al giorno a seconda della persona.
            const from = Math.max(startsAt.getTime(), shift.start.getTime())
            const to = Math.min(startsAt.getTime() + seconds * 1000, shift.end.getTime())
            const inShiftSec = Math.max(0, Math.round((to - from) / 1000))
            if (inShiftSec === 0) continue

            // L'abbuono dipende da cosa c'era da scrivere dopo QUELLA
            // telefonata (allowance.ts), non da una soglia unica: entro
            // l'abbuono è lavoro, oltre è tempo fermo. La fascia (breve o
            // pausa vera) si decide sulla lunghezza del buco, non
            // dell'eccesso: un buco di mezz'ora resta un'uscita anche se
            // l'abbuono ne toglie un minuto.
            const workSec = Math.min(inShiftSec, allowanceSec)
            workRhythmSec += workSec
            const excessSec = inShiftSec - workSec
            if (excessSec <= 0) continue

            if (inShiftSec <= LONG_PAUSE_THRESHOLD_SEC) {
                shortPauseSec += excessSec
                // L'evento si conta solo se l'eccesso si vede (vedi
                // PAUSE_EVENT_MIN_SEC): i minuti invece si contano sempre.
                if (excessSec >= PAUSE_EVENT_MIN_SEC) {
                    shortPauseCount += 1
                    if (afterUnanswered) shortPauseAfterRingCount += 1
                }
            } else {
                longPauseSecRaw += excessSec
                longPauseCount += 1
            }
        }

        dayRecords.push({
            userId: slot.userId, gdo: slot.gdo, dateLocal: slot.dateLocal,
            shiftDurationSec: shift.minutes * 60,
            startLateSec, endEarlySec,
            calls: m.calls, talkSec: m.talkSeconds,
            ringingSec: m.occupiedSeconds - m.talkSeconds,
            occupiedSec: m.occupiedSeconds,
            unansweredCalls: m.unansweredCalls,
            workRhythmSec, shortPauseSec, shortPauseCount, shortPauseAfterRingCount,
            longPauseSecRaw, longPauseCount,
            lowVolume: slot.calls.length < MIN_CALLS_PER_DAY,
            notImported: shift.end.getTime() > lastImportedMs,
        })
    }

    // SECONDO PASSAGGIO: in quali giornate la squadra ha fatto formazione.
    // Votano solo le giornate rappresentative: una giornata da poche chiamate
    // (permesso, rientro) non dice niente su cosa facesse il resto del gruppo.
    const endEarlyByDate = new Map<string, number[]>()
    for (const d of dayRecords) {
        if (d.lowVolume || d.notImported) continue
        const list = endEarlyByDate.get(d.dateLocal)
        if (list) list.push(d.endEarlySec)
        else endEarlyByDate.set(d.dateLocal, [d.endEarlySec])
    }
    const trainingDates = new Set<string>()
    for (const [dateLocal, endEarlySecs] of endEarlyByDate) {
        if (isCollectiveTrainingDay(dateLocal, endEarlySecs)) trainingDates.add(dateLocal)
    }

    // TERZO PASSAGGIO: le medie per utente.
    const byUser = new Map<string, {
        gdo: string
        // daysFull = giornate INTERE: denominatore di tutte le medie (calls,
        // talk, ringing, workRhythm, pause, startLate/endEarly medi).
        // daysShort = giornate corte (permessi/mezze giornate) e
        // daysLowVolume = giornate sotto le 40 chiamate: escluse dalle medie
        // ma contate per trasparenza — nessuna giornata con dati sparisce in
        // silenzio. daysTotal = daysFull + daysShort, usato solo per
        // idleInShiftMin (metrica non di riga).
        daysFull: number; daysShort: number; daysLowVolume: number; daysNotImported: number; daysTotal: number
        calls: number; talk: number; ringing: number; unanswered: number
        // startLate/endEarly per-giornata (secondi), su TUTTE le giornate
        // rappresentative: servono per la MEDIANA — vedi commento su
        // PhoneProductivityRow. Le somme per la MEDIA (startLateFullSec/
        // endEarlyFullSec) sono invece accumulate solo sulle giornate intere.
        startLateDaysSec: number[]; endEarlyDaysSec: number[]
        startLateFullSec: number; endEarlyFullSec: number
        daysFullShift: number
        idleInShift: number
        // Le tre categorie di tempo fra una chiamata e l'altra (vedi il
        // commento in testa al file), accumulate solo sulle giornate intere.
        workRhythmSec: number
        shortPauseSec: number; shortPauseCount: number; shortPauseAfterRingCount: number
        longPauseSec: number; longPauseCount: number
    }>()
    for (const d of dayRecords) {
        let u = byUser.get(d.userId)
        if (!u) {
            u = {
                gdo: d.gdo, daysFull: 0, daysShort: 0, daysLowVolume: 0, daysNotImported: 0, daysTotal: 0,
                calls: 0, talk: 0, ringing: 0, unanswered: 0,
                startLateDaysSec: [], endEarlyDaysSec: [],
                startLateFullSec: 0, endEarlyFullSec: 0,
                daysFullShift: 0,
                idleInShift: 0,
                workRhythmSec: 0,
                shortPauseSec: 0, shortPauseCount: 0, shortPauseAfterRingCount: 0,
                longPauseSec: 0, longPauseCount: 0,
            }
            byUser.set(d.userId, u)
        }

        // Giornata coperta solo in parte dall'import: non dice niente su
        // nessuno, non entra da nessuna parte (nemmeno fra le giornate corte,
        // dove risulterebbe un permesso mai avvenuto).
        if (d.notImported) {
            u.daysNotImported += 1
            continue
        }

        // Giornata da poche chiamate: contata e basta. Non entra in nessuna
        // media né nel tempo fermo, ma non sparisce dal conto delle giornate.
        if (d.lowVolume) {
            u.daysLowVolume += 1
            continue
        }
        u.daysTotal += 1

        // L'abbuono formazione vale solo nelle giornate in cui la formazione
        // c'è stata davvero: fino al 2026-08-26 valeva per ogni sabato, e
        // abbassava le pause di tutti di 10-13 min al giorno anche nei
        // sabati senza formazione (7 su 10 fra giugno e agosto).
        const isTrainingDay = trainingDates.has(d.dateLocal)
        // L'abbuono e' UNO PER GIORNATA, non uno per voce: la formazione dura
        // un'ora sola. Si scala prima dall'anticipo a fine turno, che e' dove
        // la formazione si manifesta sempre (verificato: nei sabati di
        // formazione nessuna pausa lunga tocca l'ultima ora di turno), e solo
        // l'eventuale residuo va sulle pause. Per meta' giornata del
        // 2026-08-26 i due abbuoni erano indipendenti, con tetto 60 ciascuno:
        // significava cancellare fino a 120 minuti, e i minuti tolti dalle
        // pause erano pause ordinarie del mattino, non formazione.
        const allowanceSec = trainingAllowanceSec(isTrainingDay, d.endEarlySec)
        const dayAllowanceCapSec = isTrainingDay ? SATURDAY_TRAINING_ALLOWANCE_MIN * 60 : 0
        const residualAllowanceSec = dayAllowanceCapSec - allowanceSec
        const pauseAllowanceSec = Math.min(residualAllowanceSec, d.longPauseSecRaw)
        const fermoTotalSec = fermoTotalSeconds(isTrainingDay, d.shiftDurationSec, d.occupiedSec, d.endEarlySec)
        // I buchi interni restano quelli "grezzi" (non scalati dall'abbuono):
        // fermoTotalSec è già al netto dell'abbuono sull'anticipo, quindi qui
        // si sottrae l'anticipo altrettanto scalato per tornare ai soli buchi
        // interni — fermoTotale = startLate + idleInShift + (endEarly - abbuono).
        const idleInShiftSec = Math.max(0, fermoTotalSec - d.startLateSec - (d.endEarlySec - allowanceSec))

        // Mediana: su TUTTE le giornate rappresentative (vedi commento su
        // PhoneProductivityRow) — non filtrare qui, solo nelle somme sotto.
        u.startLateDaysSec.push(d.startLateSec)
        u.endEarlyDaysSec.push(d.endEarlySec)
        // Soglia sulla singola giornata, non sulla mediana: "arriva a fine
        // turno" è un evento puntuale, indipendente da intera/corta.
        if (d.endEarlySec <= 15 * 60) u.daysFullShift += 1
        u.idleInShift += idleInShiftSec

        // Giornata intera = né mezza giornata né permesso, su ENTRAMBI i
        // bordi: si guarda l'anticipo a fine turno e anche il ritardo in
        // ingresso. Guardare solo l'uscita lasciava passare come "intera"
        // una giornata iniziata con tre ore di ritardo — la stessa
        // distorsione che il filtro esiste per prevenire, sull'altro bordo.
        // Soglia dipendente dal giorno: feriali 60 min, sabato 120 min (vedi
        // shift.ts). Tutte le medie della riga si calcolano SOLO su queste
        // giornate: vedi commento in testa al file.
        const thresholdSec = (romeDowOf(d.dateLocal) === 6
            ? SATURDAY_DAYS_SHORT_THRESHOLD_MIN
            : WEEKDAY_DAYS_SHORT_THRESHOLD_MIN) * 60
        if (d.endEarlySec > thresholdSec || d.startLateSec > thresholdSec) {
            u.daysShort += 1
            continue // giornata corta: non entra in nessuna media
        }
        u.daysFull += 1
        u.calls += d.calls
        u.talk += d.talkSec
        // squilli a vuoto = tempo occupato (duration) meno conversazione
        // effettiva (billsec), accumulato per giornata come talk/pause/ecc.
        u.ringing += d.ringingSec
        u.unanswered += d.unansweredCalls
        u.startLateFullSec += d.startLateSec
        // L'ora di formazione è lavoro, non "tempo dopo l'ultima chiamata":
        // va tolta anche dalla media sommabile, altrimenti comparirebbe come
        // tempo fermo a fine turno. La mediana resta grezza.
        u.endEarlyFullSec += d.endEarlySec - allowanceSec

        u.workRhythmSec += d.workRhythmSec
        u.shortPauseSec += d.shortPauseSec
        u.shortPauseCount += d.shortPauseCount
        u.shortPauseAfterRingCount += d.shortPauseAfterRingCount
        // Solo il residuo dell'abbuono giornaliero (vedi sopra): serve al caso
        // in cui la formazione cada fra due chiamate invece che a fine turno.
        u.longPauseSec += d.longPauseSecRaw - pauseAllowanceSec
        u.longPauseCount += d.longPauseCount
    }

    const rows: PhoneProductivityRow[] = [...byUser.entries()]
        .filter(([, u]) => u.daysFull > 0)
        .map(([userId, u]) => {
            // pauseMinPerDay si compone dalle due voci GIÀ arrotondate, non
            // dai secondi: così la somma mostrata in tabella (brevi + pause)
            // coincide sempre col totale, senza lo scarto di arrotondamento
            // che renderebbe la riga non verificabile a mano.
            const shortPauseMinPerDay = Math.round(u.shortPauseSec / u.daysFull / 60)
            const longPauseMinPerDay = Math.round(u.longPauseSec / u.daysFull / 60)
            const pauseMinPerDay = shortPauseMinPerDay + longPauseMinPerDay
            const overAllowanceMinPerDay = Math.max(0, pauseMinPerDay - CONTRACTUAL_PAUSE_ALLOWANCE_MIN)
            /** Media giornaliera con un decimale: i conteggi, non i minuti. */
            const perDay = (n: number) => Math.round((n / u.daysFull) * 10) / 10
            return {
                userId,
                gdo: u.gdo,
                days: u.daysFull,
                callsPerDay: Math.round(u.calls / u.daysFull),
                talkMinPerDay: Math.round(u.talk / u.daysFull / 60),
                ringingMinPerDay: Math.round(u.ringing / u.daysFull / 60),
                workRhythmMinPerDay: Math.round(u.workRhythmSec / u.daysFull / 60),
                pauseMinPerDay,
                shortPauseMinPerDay,
                // È il conteggio, non i minuti, a distinguere le persone
                // (vedi commento sui campi in PhoneProductivityRow).
                shortPauseCountPerDay: perDay(u.shortPauseCount),
                shortPauseAfterRingCountPerDay: perDay(u.shortPauseAfterRingCount),
                longPauseMinPerDay,
                longPauseCountPerDay: perDay(u.longPauseCount),
                // Tasso, non conteggio: toglie di mezzo l'obiezione "ho piu'
                // squilli a vuoto degli altri perche' chiamo liste peggiori".
                shortPauseAfterRingRatePct: u.unanswered
                    ? Math.round((u.shortPauseAfterRingCount / u.unanswered) * 1000) / 10
                    : 0,
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
                daysLowVolume: u.daysLowVolume,
                daysNotImported: u.daysNotImported,
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
