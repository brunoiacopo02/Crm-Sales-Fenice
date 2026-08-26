/**
 * Metriche di una giornata di lavoro di una postazione, ricavate dai
 * tabulati del centralino.
 *
 * Il "tempo non telefonico" NON è tempo di pausa: contiene anche la
 * compilazione degli esiti e la scelta del lead. Va sempre letto per
 * confronto con il migliore del gruppo, mai contro lo zero.
 */

export type DayCall = {
    calldate: Date
    duration: number   // secondi totali, squilli inclusi
    billsec: number    // secondi di conversazione effettiva
    disposition: string
}

/**
 * Secondi totali di buco, divisi per durata del singolo buco.
 * Serve a non confondere il ritmo lento con l'assenza: sotto il minuto è
 * la compilazione dell'esito (incomprimibile), sopra i 10 minuti è altro.
 */
export type GapBuckets = {
    under1m: number
    m1to3: number
    m3to10: number
    m10to30: number
    over30m: number
}

export function emptyBuckets(): GapBuckets {
    return { under1m: 0, m1to3: 0, m3to10: 0, m10to30: 0, over30m: 0 }
}

/**
 * Un singolo buco fra due chiamate, con l'esito della chiamata che lo
 * precede. `afterUnanswered` distingue il buco che segue uno squillo a
 * vuoto (billsec = 0): li' non c'e' nessun esito da scrivere, quindi una
 * interruzione subito dopo non ha la giustificazione del lavoro
 * amministrativo. E' la metrica piu' difendibile della scheda.
 */
export type GapDetail = {
    seconds: number
    afterUnanswered: boolean
    /**
     * Istante in cui il buco comincia (fine della chiamata precedente).
     * Serve a ritagliare il buco sui bordi del turno: un buco che comincia
     * prima dell'inizio turno non va addebitato per intero — vedi l'uso in
     * productivityActions.ts.
     */
    startsAt: Date
}

export type DayMetrics = {
    calls: number
    answered: number
    /**
     * Chiamate senza un secondo di conversazione (`billsec = 0`): squilli a
     * vuoto, occupato, numero inesistente. Definito su billsec e non su
     * `disposition` per restare coerente con `gapDetails.afterUnanswered`,
     * che usa lo stesso criterio — servono l'uno come denominatore
     * dell'altro.
     */
    unansweredCalls: number
    talkSeconds: number
    occupiedSeconds: number
    windowSeconds: number
    offPhoneSeconds: number
    gaps: number[]
    /** Gli stessi buchi di `gaps`, stesso ordine, con l'esito della chiamata precedente. */
    gapDetails: GapDetail[]
    buckets: GapBuckets
    firstAt: Date
    lastAt: Date
}

export function median(values: number[]): number {
    if (!values.length) return 0
    const s = [...values].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function computeDayMetrics(calls: DayCall[]): DayMetrics | null {
    if (!calls.length) return null

    const sorted = [...calls].sort((a, b) => a.calldate.getTime() - b.calldate.getTime())
    const endOf = (c: DayCall) => c.calldate.getTime() + c.duration * 1000

    const firstAt = sorted[0].calldate
    const lastAt = new Date(Math.max(...sorted.map(endOf)))
    const windowSeconds = Math.round((lastAt.getTime() - firstAt.getTime()) / 1000)

    let talkSeconds = 0, occupiedSeconds = 0, answered = 0, unansweredCalls = 0
    for (const c of sorted) {
        talkSeconds += c.billsec
        occupiedSeconds += c.duration
        if (c.disposition === 'ANSWERED') answered += 1
        if (c.billsec === 0) unansweredCalls += 1
    }

    // Gap fra la fine di una chiamata e l'inizio della successiva.
    // I negativi indicano chiamate sovrapposte (dato anomalo): si scartano.
    const gaps: number[] = []
    const gapDetails: GapDetail[] = []
    const buckets = emptyBuckets()
    for (let i = 1; i < sorted.length; i++) {
        const gap = Math.round((sorted[i].calldate.getTime() - endOf(sorted[i - 1])) / 1000)
        if (gap < 0) continue
        gaps.push(gap)
        gapDetails.push({
            seconds: gap,
            afterUnanswered: sorted[i - 1].billsec === 0,
            startsAt: new Date(endOf(sorted[i - 1])),
        })
        if (gap < 60) buckets.under1m += gap
        else if (gap < 180) buckets.m1to3 += gap
        else if (gap < 600) buckets.m3to10 += gap
        else if (gap < 1800) buckets.m10to30 += gap
        else buckets.over30m += gap
    }

    return {
        calls: sorted.length,
        answered,
        unansweredCalls,
        talkSeconds,
        occupiedSeconds,
        windowSeconds,
        offPhoneSeconds: Math.max(0, windowSeconds - occupiedSeconds),
        gaps,
        gapDetails,
        buckets,
        firstAt,
        lastAt,
    }
}
