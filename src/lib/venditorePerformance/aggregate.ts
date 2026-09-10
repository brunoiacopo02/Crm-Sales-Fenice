import { cohortClosing } from '@/lib/kpi/salesCohort';

export interface AttemptInput {
    leadId: string;
    attemptNumber: number;
    outcome: string;
    notClosedReason: string | null;
    nextFollowUpDate: Date | null;
    closeProduct: string | null;
    closeAmountEur: number | null;
    outcomeAt: Date;
    /**
     * Latch della presenza del LEAD (`leads.presentedAt`), non della singola riga:
     * è lo stesso valore su tutti i tentativi dello stesso `leadId`. Serve a
     * ricostruire la coorte del mese senza una seconda query sui lead (ogni lead
     * con `presentedAt` ha almeno un attempt: verificato in produzione).
     */
    presentedAt: Date | null;
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

// NOTA: il closing rate è di COORTE (decisione PO 2026-09-10, regola canonica in
// `@/lib/kpi/salesCohort`). Il denominatore sono le PRESENZE del mese — i lead con
// `presentedAt` in [start,end) — e il numeratore quelle il cui esito corrente è 'Chiuso'.
// Non si torna a bucketizzare sull'esito più recente: `outcomeAt` si sposta a OGNI
// follow-up, quindi una presenza di agosto ricadeva nel denominatore di settembre appena
// il venditore registrava un richiamo, e le presenze di settembre ancora da esitare non
// ci entravano affatto (settembre 2026: 111 "esitati" contro 81 presenze reali, Sales 008
// al 29% invece che al 47%). Le presenze ancora aperte restano nel denominatore: per
// questo `inLavorazione` viene esposto e va mostrato accanto al rate.
//
// ⚠️ Sembra un'incoerenza ma non lo è: `fatturato`, `ticketMedio` e `topProduct` NON sono
// di coorte. Restano attribuiti al mese di `outcomeAt` della chiusura, cioè al mese della
// firma: è quello il mese in cui i soldi entrano ed è la base di target, bonus e
// riconciliazione col foglio. Una chiusura di settembre su una presenza di agosto sta
// quindi nel fatturato di settembre ma nel closing rate di agosto.
export function closingStats(attempts: AttemptInput[], start: Date, end: Date) {
    // Un lead conta UNA volta, per il suo esito più recente.
    const latestByLead = new Map<string, AttemptInput>();
    for (const a of attempts) {
        const cur = latestByLead.get(a.leadId);
        if (!cur || a.outcomeAt > cur.outcomeAt || (a.outcomeAt.getTime() === cur.outcomeAt.getTime() && a.attemptNumber > cur.attemptNumber)) {
            latestByLead.set(a.leadId, a);
        }
    }
    const latest = [...latestByLead.values()];

    // Coorte: il modulo canonico filtra su `presentedAt` e scompone per esito corrente.
    const cohort = cohortClosing(
        latest.map(a => ({ presentedAt: a.presentedAt, salespersonOutcome: a.outcome })),
        start, end,
    );

    // Soldi: mese della firma, non mese della presenza (vedi nota sopra).
    const chiusiNelMese = latest.filter(a => a.outcome === 'Chiuso' && inRange(a, start, end));
    const fatturato = chiusiNelMese.reduce((s, a) => s + (a.closeAmountEur ?? 0), 0);
    const prodCounts = new Map<string, number>();
    for (const a of chiusiNelMese) if (a.closeProduct) prodCounts.set(a.closeProduct, (prodCounts.get(a.closeProduct) ?? 0) + 1);
    const topProduct = [...prodCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;

    return {
        chiusi: cohort.chiusi,
        nonChiusi: cohort.nonChiusi,
        perso: cohort.persi,
        sparito: cohort.spariti,
        inLavorazione: cohort.inLavorazione,
        presenze: cohort.presenze,
        closingPct: cohort.closingPct,
        fatturato,
        ticketMedio: chiusiNelMese.length ? Math.round(fatturato / chiusiNelMese.length) : 0,
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
