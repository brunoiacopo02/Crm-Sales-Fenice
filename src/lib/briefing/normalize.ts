import type { BotReport } from "@/lib/bot-fissatore/types";

export interface LeadBriefing {
    summary: string | null;
    painPoints: string[];
    urgency: string | null;
    budgetSignal: string | null;
    objections: string[];
    levaConsigliata: string | null;
    works: boolean | null;
    source: 'bot' | 'conferme';
}

type SchedaRow = {
    works: boolean | null;
    summary: string | null;
    painPoints: string[] | null;
    urgency: string | null;
    budgetSignal: string | null;
    objections: string[] | null;
    levaConsigliata: string | null;
} | null;

// Preferisce la Scheda Conferme; se assente/vuota ma c'è il botReport, usa quello.
export function normalizeBriefing(scheda: SchedaRow, botReport: unknown): LeadBriefing | null {
    const schedaHas = scheda && (scheda.summary || (scheda.painPoints?.length ?? 0) > 0);
    if (schedaHas) {
        return {
            summary: scheda!.summary ?? null,
            painPoints: scheda!.painPoints ?? [],
            urgency: scheda!.urgency ?? null,
            budgetSignal: scheda!.budgetSignal ?? null,
            objections: scheda!.objections ?? [],
            levaConsigliata: scheda!.levaConsigliata ?? null,
            works: scheda!.works ?? null,
            source: 'conferme',
        };
    }
    if (botReport && typeof botReport === 'object') {
        const r = botReport as BotReport;
        return {
            summary: r.summary ?? null,
            painPoints: r.painPoints ?? [],
            urgency: r.urgency ?? null,
            budgetSignal: r.budgetSignal ?? null,
            objections: r.objections ?? [],
            levaConsigliata: r.levaConsigliata ?? null,
            works: scheda?.works ?? null,
            source: 'bot',
        };
    }
    return null;
}
