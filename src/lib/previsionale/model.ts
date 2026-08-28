/**
 * Modello previsionale del funnel (ex foglio di calcolo Direzione).
 *
 * Puro: nessun accesso a DB, nessuna dipendenza React. Vive in `lib` così che
 * la pagina client possa ricalcolare a ogni battuta di tasto senza round-trip
 * e così che le tabelle di sensibilità possano rieseguirlo N volte al volo.
 *
 * Convenzione: tutti i campi `*Pct` sono percentuali "umane" (38 = 38%), la
 * divisione per 100 avviene UNA sola volta, qui dentro.
 */

export interface PrevisionaleParams {
    // Calendario
    giorniLavorativi: number;
    giorniCalendario: number;
    // Lead nuovi (evergreen freschi)
    gdoNuovi: number;
    leadPerGdo: number;
    cpl: number;
    // Database
    gdoDatabase: number;
    leadDbPerGdo: number;
    leadDbDaEvergreen: number;
    // Bot
    botFeriali: number;
    botSabato: number;
    botDomenica: number;
    giorniFeriali: number;
    giorniSabato: number;
    giorniDomenica: number;
    quotaRestituitaPct: number;
    // Fissaggio / conferma per origine
    fissBotPct: number;
    confBotPct: number;
    fissRidatiPct: number;
    confRidatiPct: number;
    fissFreschiPct: number;
    confFreschiPct: number;
    fissDatabasePct: number;
    confDatabasePct: number;
    // Chiusura
    presenzaPct: number;
    closingRatePct: number;
    ticketMedio: number;
}

export const DEFAULT_PARAMS: PrevisionaleParams = {
    giorniLavorativi: 26,
    giorniCalendario: 30,
    gdoNuovi: 5,
    leadPerGdo: 45,
    cpl: 10,
    gdoDatabase: 6,
    leadDbPerGdo: 85,
    leadDbDaEvergreen: 11,
    botFeriali: 150,
    botSabato: 136,
    botDomenica: 260,
    giorniFeriali: 22,
    giorniSabato: 4,
    giorniDomenica: 4,
    quotaRestituitaPct: 65.4,
    fissBotPct: 25,
    confBotPct: 22.2,
    fissRidatiPct: 10,
    confRidatiPct: 12.7,
    fissFreschiPct: 16,
    confFreschiPct: 15.9,
    fissDatabasePct: 7,
    confDatabasePct: 10,
    presenzaPct: 92,
    closingRatePct: 38,
    ticketMedio: 2500,
};

export interface PrevisionaleResult {
    capacitaGdo: number;
    leadAlBot: number;
    trattenuti: number;
    ridati: number;
    freschi: number;
    leadEvergreen: number;
    leadDatabase: number;
    leadTotali: number;
    budget: number;
    appBot: number;
    appRidati: number;
    appFreschi: number;
    appEvergreen: number;
    appDatabase: number;
    appTotali: number;
    conferme: number;
    presenze: number;
    vendite: number;
    fatturato: number;
    roas: number;
    costoPerAppuntamento: number;
    costoPerConferma: number;
    costoPerVendita: number;
    /** Medie di servizio, utili per confrontare col ritmo reale del mese. */
    appPerGiornoLavorativo: number;
    appPerGiornoCalendario: number;
    fatturatoPerGiornoCalendario: number;
}

/** Divisione che non esplode in Infinity/NaN quando il denominatore è 0. */
function safeDiv(a: number, b: number): number {
    return b > 0 ? a / b : 0;
}

const pct = (v: number) => (Number.isFinite(v) ? v : 0) / 100;
const num = (v: number) => (Number.isFinite(v) ? v : 0);

export function computePrevisionale(p: PrevisionaleParams): PrevisionaleResult {
    const giorniLavorativi = num(p.giorniLavorativi);
    const giorniCalendario = num(p.giorniCalendario);

    const capacitaGdo = num(p.gdoNuovi) * num(p.leadPerGdo) * giorniLavorativi;

    const leadAlBot =
        num(p.botFeriali) * num(p.giorniFeriali) +
        num(p.botSabato) * num(p.giorniSabato) +
        num(p.botDomenica) * num(p.giorniDomenica);

    const trattenuti = leadAlBot * (1 - pct(p.quotaRestituitaPct));
    const ridati = leadAlBot - trattenuti;
    // I ridati mangiano capacità GDO prima dei freschi: se il bot restituisce
    // più di quanto i GDO riescano a lavorare, di freschi non se ne comprano.
    const freschi = Math.max(0, capacitaGdo - ridati);

    const leadEvergreen = freschi + leadAlBot;
    const budget = leadEvergreen * num(p.cpl);

    const leadDatabase =
        (num(p.gdoDatabase) * num(p.leadDbPerGdo) + num(p.gdoNuovi) * num(p.leadDbDaEvergreen)) *
        giorniLavorativi;

    const appBot = trattenuti * pct(p.fissBotPct);
    const appRidati = ridati * pct(p.fissRidatiPct);
    const appFreschi = freschi * pct(p.fissFreschiPct);
    const appEvergreen = appBot + appRidati + appFreschi;
    const appDatabase = leadDatabase * pct(p.fissDatabasePct);
    const appTotali = appEvergreen + appDatabase;

    const conferme =
        appBot * pct(p.confBotPct) +
        appRidati * pct(p.confRidatiPct) +
        appFreschi * pct(p.confFreschiPct) +
        appDatabase * pct(p.confDatabasePct);

    const presenze = conferme * pct(p.presenzaPct);
    const vendite = presenze * pct(p.closingRatePct);
    const fatturato = vendite * num(p.ticketMedio);
    const roas = safeDiv(fatturato, budget);

    return {
        capacitaGdo,
        leadAlBot,
        trattenuti,
        ridati,
        freschi,
        leadEvergreen,
        leadDatabase,
        leadTotali: leadEvergreen + leadDatabase,
        budget,
        appBot,
        appRidati,
        appFreschi,
        appEvergreen,
        appDatabase,
        appTotali,
        conferme,
        presenze,
        vendite,
        fatturato,
        roas,
        costoPerAppuntamento: safeDiv(budget, appTotali),
        costoPerConferma: safeDiv(budget, conferme),
        costoPerVendita: safeDiv(budget, vendite),
        appPerGiornoLavorativo: safeDiv(appTotali, giorniLavorativi),
        appPerGiornoCalendario: safeDiv(appTotali, giorniCalendario),
        fatturatoPerGiornoCalendario: safeDiv(fatturato, giorniCalendario),
    };
}

/** Ricalcola il modello sostituendo un solo parametro: base delle sensibilità. */
export function computeWith(
    p: PrevisionaleParams,
    key: keyof PrevisionaleParams,
    value: number,
): PrevisionaleResult {
    return computePrevisionale({ ...p, [key]: value });
}

export const CLOSING_SCENARIOS = [30, 35, 38, 40, 42];
export const CPL_SCENARIOS = [8, 9, 10, 11];

/** Merge difensivo: i parametri arrivano da localStorage, non fidarsi mai. */
export function sanitizeParams(raw: unknown): PrevisionaleParams {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PARAMS };
    const src = raw as Record<string, unknown>;
    const out = { ...DEFAULT_PARAMS };
    for (const key of Object.keys(DEFAULT_PARAMS) as Array<keyof PrevisionaleParams>) {
        const v = src[key];
        if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    }
    return out;
}
