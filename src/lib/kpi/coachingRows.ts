/**
 * Aggregazione delle righe del Report qualità GDO (coaching).
 *
 * Separata dal server action per poterla testare: la semantica di queste
 * righe decide i checkpoint del piano coaching, quindi non può stare solo
 * dentro una query.
 *
 * ⚠️ Regola di fondo: ogni metrica si calcola su fatti datati e immutabili
 * (righe di `callLogs`, data di fissaggio), MAI su campi mutabili del lead
 * come `lastCallDate`. La versione precedente usava `lastCallDate` per
 * decidere in quale settimana cadesse un lead: siccome quel campo avanza a
 * ogni nuova chiamata, i lead uscivano dalle settimane vecchie ed entravano
 * in quelle nuove. Le settimane passate si svuotavano da sole (sett. 1 del
 * GDO 110: 183 lavorati a fine luglio, 128 alla stessa domanda un mese dopo)
 * e ogni rapporto che le aveva a denominatore risultava gonfiato.
 */

/** Una chiamata, con la sua posizione nella storia completa del lead. */
export type CallFact = {
    leadId: string;
    userId: string | null;
    createdAt: Date;
    outcome: string;
    /** 1 = prima chiamata in assoluto su quel lead. */
    rn: number;
    funnel: string | null;
    /** Tentativi totali sul lead (leads.callCount), non solo quelli del periodo. */
    leadCallCount: number;
};

/** Un appuntamento fissato, con l'esito che le Conferme gli hanno dato. */
export type ApptFact = {
    leadId: string;
    assignedToId: string | null;
    apptSetAt: Date | null;
    confirmationsOutcome: string | null;
    confirmationsDiscardReason: string | null;
    funnel: string | null;
};

export type FunnelScope = 'ALL' | 'DATABASE' | 'NON_DATABASE';

export type QualityRow = {
    label: string;
    /** Lead distinti chiamati nel periodo. */
    lavorati: number;
    /** Chiamate fatte nel periodo. */
    chiamate: number;
    /**
     * Media dei tentativi totali sui lead lavorati nel periodo.
     *
     * ⚠️ Deliberatamente NON `chiamate / lavorati`: quel rapporto cresce con
     * la lunghezza della finestra (piu' settimane = piu' chiamate sullo
     * stesso lead), quindi la riga baseline da 7 settimane non sarebbe
     * confrontabile con una riga settimanale. La media dei tentativi totali
     * per lead non dipende dall'ampiezza del periodo, ed e' la stessa
     * grandezza del dossier di partenza (2,47 per il GDO 110).
     */
    mediaTentativi: number | null;
    fissati: number;
    pctFissSuLavorati: number | null;
    confermati: number;
    /** Fissati che le Conferme non hanno ancora esitato. */
    pendenti: number;
    /** confermati / fissati GIA' ESITATI. Null finché non c'è un esito. */
    pctConf: number | null;
    /** Scarti Conferme per mancata risposta (3 o 4 NR). */
    scartiNr: number;
    pctNr: number | null;
    /** Lead toccati per la prima volta in assoluto nel periodo. */
    primeChiamate: number;
    /** Di quelli, quanti sono stati scartati proprio a quella prima chiamata. */
    scarti1a: number;
    pctScarti1a: number | null;
    /** Quota di lead Database fra i lavorati: rende visibile il mix. */
    pctDatabase: number | null;
};

export function isDatabaseFunnel(funnel: string | null): boolean {
    return (funnel ?? '').trim().toUpperCase() === 'DATABASE';
}

export function matchesScope(funnel: string | null, scope: FunnelScope): boolean {
    if (scope === 'ALL') return true;
    const isDb = isDatabaseFunnel(funnel);
    return scope === 'DATABASE' ? isDb : !isDb;
}

/**
 * Scarto delle Conferme per mancata risposta. Copre sia "3 NR consecutivi"
 * sia "4 NR consecutivi": entrambi dicono che il lead non si è mai fatto
 * sentire, e il piano coaching li tratta insieme.
 */
export function isNrDiscard(reason: string | null): boolean {
    const r = (reason ?? '').trim().toLowerCase();
    return /\bnr\b/.test(r);
}

function pct(n: number, d: number): number | null {
    return d > 0 ? (n / d) * 100 : null;
}

export function computeRow(
    label: string,
    calls: CallFact[],
    appts: ApptFact[],
): QualityRow {
    const chiamate = calls.length;
    // Un lead va contato una volta sola anche se richiamato dieci volte.
    const tentativiPerLead = new Map<string, number>();
    for (const c of calls) tentativiPerLead.set(c.leadId, c.leadCallCount);
    const lavorati = tentativiPerLead.size;
    const sommaTentativi = [...tentativiPerLead.values()].reduce((s, n) => s + n, 0);

    // Mix di funnel sui lead lavorati, non sulle chiamate: un lead richiamato
    // dieci volte non deve pesare dieci volte sulla composizione.
    const dbLeadIds = new Set(calls.filter(c => isDatabaseFunnel(c.funnel)).map(c => c.leadId));

    // Prima chiamata in assoluto sul lead (rn = 1) avvenuta in questo periodo.
    const primeCalls = calls.filter(c => c.rn === 1);
    const primeChiamate = new Set(primeCalls.map(c => c.leadId)).size;
    const scarti1a = new Set(
        primeCalls.filter(c => c.outcome === 'DA_SCARTARE').map(c => c.leadId),
    ).size;

    const fissati = appts.length;
    const confermati = appts.filter(a => a.confirmationsOutcome === 'confermato').length;
    const pendenti = appts.filter(a => !a.confirmationsOutcome).length;
    // Denominatore = fissati GIA' esitati. Sui fissati della settimana in corso
    // le Conferme non hanno ancora lavorato: dividere per il totale faceva
    // leggere ~0% di conferma ogni venerdì, che è esattamente il giorno in cui
    // questo report viene guardato.
    const esitati = fissati - pendenti;
    const scartiNr = appts.filter(a =>
        a.confirmationsOutcome === 'scartato' && isNrDiscard(a.confirmationsDiscardReason),
    ).length;

    return {
        label,
        lavorati,
        chiamate,
        mediaTentativi: lavorati > 0 ? sommaTentativi / lavorati : null,
        fissati,
        pctFissSuLavorati: pct(fissati, lavorati),
        confermati,
        pendenti,
        pctConf: pct(confermati, esitati),
        scartiNr,
        pctNr: pct(scartiNr, esitati),
        primeChiamate,
        scarti1a,
        pctScarti1a: pct(scarti1a, primeChiamate),
        pctDatabase: pct(dbLeadIds.size, lavorati),
    };
}
