// Helper puro per la "Scheda Trattativa" delle Conferme. Vive qui (non in
// surveyActions.ts) perché quel file è "use server": ogni export di un modulo
// server-action dev'essere async, mentre questo è un controllo sincrono.

export interface ConfermeSchedaRow {
    remembersAppt: boolean | null;
    watchedVideo: boolean | null;
    works: boolean | null;
    confirmed: boolean | null;
    whyNot: string | null;
    summary: string | null;
    painPoints: string[] | null;
    urgency: string | null;
}

// Una Scheda è completa per CONFERMA se ha Parte A piena + briefing (Parte B).
// È completa per SCARTO se ha Parte A piena + motivo valido. botReport presente
// soddisfa la Parte B (lead-bot: il briefing esiste già).
export function isConfermeSchedaComplete(
    row: ConfermeSchedaRow | null,
    opts: { outcome: 'confermato' | 'scartato'; hasBotReport: boolean },
): boolean {
    if (!row) return false;
    const partA = row.remembersAppt !== null && row.watchedVideo !== null && row.works !== null && row.confirmed !== null;
    if (!partA) return false;
    if (opts.outcome === 'scartato') {
        return row.confirmed === false && !!row.whyNot;
    }
    // confermato
    if (opts.hasBotReport) return true; // briefing già fornito dal bot
    return row.confirmed === true && !!row.summary && Array.isArray(row.painPoints) && row.painPoints.length > 0 && !!row.urgency;
}
