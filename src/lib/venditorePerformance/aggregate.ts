export interface AttemptInput {
    leadId: string;
    attemptNumber: number;
    outcome: string;
    notClosedReason: string | null;
    nextFollowUpDate: Date | null;
    closeProduct: string | null;
    closeAmountEur: number | null;
    outcomeAt: Date;
}

const inRange = (a: AttemptInput, start: Date, end: Date) =>
    a.outcomeAt >= start && a.outcomeAt < end;

const roundPct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

export function reasonDistribution(attempts: AttemptInput[], start: Date, end: Date) {
    const scoped = attempts.filter(a =>
        inRange(a, start, end) &&
        (a.outcome === 'Non chiuso' || a.outcome === 'Perso') &&
        !!a.notClosedReason,
    );
    const counts = new Map<string, number>();
    for (const a of scoped) counts.set(a.notClosedReason!, (counts.get(a.notClosedReason!) ?? 0) + 1);
    const total = scoped.length;
    return [...counts.entries()]
        .map(([reason, count]) => ({ reason, count, pct: roundPct(count, total) }))
        .sort((x, y) => y.count - x.count || x.reason.localeCompare(y.reason, 'it'));
}

export function topReason(dist: { reason: string; pct: number }[]) {
    return dist.length ? { reason: dist[0].reason, pct: dist[0].pct } : null;
}

export function followUpFunnel(attempts: AttemptInput[], start: Date, end: Date) {
    const enteredLeads = new Set(
        attempts.filter(a => inRange(a, start, end) && a.outcome === 'Non chiuso').map(a => a.leadId),
    );
    const closedLeads = new Set(attempts.filter(a => a.outcome === 'Chiuso').map(a => a.leadId));
    let closed = 0;
    for (const id of enteredLeads) if (closedLeads.has(id)) closed++;
    return { enteredFollowUp: enteredLeads.size, closed, conversionPct: roundPct(closed, enteredLeads.size) };
}

// NOTA: il lead è bucketizzato sul suo esito GLOBALMENTE più recente (non sul primo
// esito dentro [start,end)). Questo è intenzionale (point-in-time, lead-level, coerente
// con getVenditoriKpi) ma implica che i numeri di chiusura/trend di un mese passato
// possano cambiare retroattivamente quando arrivano nuovi tentativi: es. un "Non chiuso"
// di giugno che si chiude ad agosto sposta quel lead fuori dai finals di giugno la
// prossima volta che closingStats/monthlyTrend vengono ricalcolati.
export function closingStats(attempts: AttemptInput[], start: Date, end: Date) {
    // Un lead conta UNA volta, per il suo esito più recente (coerente con getVenditoriKpi).
    const latestByLead = new Map<string, AttemptInput>();
    for (const a of attempts) {
        const cur = latestByLead.get(a.leadId);
        if (!cur || a.outcomeAt > cur.outcomeAt || (a.outcomeAt.getTime() === cur.outcomeAt.getTime() && a.attemptNumber > cur.attemptNumber)) {
            latestByLead.set(a.leadId, a);
        }
    }
    const finals = [...latestByLead.values()].filter(a => inRange(a, start, end));
    const chiusi = finals.filter(a => a.outcome === 'Chiuso');
    const nonChiusi = finals.filter(a => a.outcome === 'Non chiuso').length;
    const perso = finals.filter(a => a.outcome === 'Perso').length;
    const sparito = finals.filter(a => a.outcome === 'Sparito').length;
    const totalEsitati = chiusi.length + nonChiusi + perso + sparito;
    const fatturato = chiusi.reduce((s, a) => s + (a.closeAmountEur ?? 0), 0);
    const prodCounts = new Map<string, number>();
    for (const a of chiusi) if (a.closeProduct) prodCounts.set(a.closeProduct, (prodCounts.get(a.closeProduct) ?? 0) + 1);
    const topProduct = [...prodCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return {
        chiusi: chiusi.length, nonChiusi, perso, sparito, totalEsitati,
        closingPct: roundPct(chiusi.length, totalEsitati),
        fatturato,
        ticketMedio: chiusi.length ? Math.round(fatturato / chiusi.length) : 0,
        topProduct,
    };
}

export function attemptsToClose(attempts: AttemptInput[], start: Date, end: Date) {
    const closed = attempts.filter(a => inRange(a, start, end) && a.outcome === 'Chiuso');
    if (!closed.length) return { avgAttempts: 0, firstShotPct: 0 };
    const avg = closed.reduce((s, a) => s + (a.attemptNumber + 1), 0) / closed.length;
    const firstShot = closed.filter(a => a.attemptNumber === 0).length;
    return { avgAttempts: Math.round(avg * 10) / 10, firstShotPct: roundPct(firstShot, closed.length) };
}

export function monthlyTrend(attempts: AttemptInput[], months: string[]) {
    return months.map(ym => {
        const [y, m] = ym.split('-').map(Number);
        const start = new Date(Date.UTC(y, m - 1, 1));
        const end = new Date(Date.UTC(y, m, 1));
        const cs = closingStats(attempts, start, end);
        const ff = followUpFunnel(attempts, start, end);
        return { yearMonth: ym, closingPct: cs.closingPct, followUpConversionPct: ff.conversionPct };
    });
}
