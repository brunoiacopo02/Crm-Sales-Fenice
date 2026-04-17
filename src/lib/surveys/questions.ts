// Costanti domande sondaggi lead. Hardcoded per ora (vedi PRD § 10).
// Tutte le label sono in italiano, user-facing.

// ========== GDO ==========
export const GDO_AGE_OPTIONS = [
    { value: '18-24', label: '18-24' },
    { value: '25-35', label: '25-35' },
    { value: '35-45', label: '35-45' },
    { value: '45-55', label: '45-55' },
    { value: '55+', label: '55+' },
] as const;
export type GdoAgeRange = typeof GDO_AGE_OPTIONS[number]['value'];

export const GDO_OCCUPATION_OPTIONS = [
    { value: 'disoccupato', label: 'Disoccupato' },
    { value: 'studente', label: 'Studente' },
    { value: 'full_time', label: 'Full time' },
    { value: 'part_time', label: 'Part time' },
    { value: 'p_iva', label: 'P. IVA' },
    { value: 'pensionato', label: 'Pensionato' },
] as const;
export type GdoOccupation = typeof GDO_OCCUPATION_OPTIONS[number]['value'];

export const GDO_REQUEST_REASON_OPTIONS = [
    { value: 'corso', label: 'Cerca un corso' },
    { value: 'valuta', label: 'Sta valutando cosa fare' },
    { value: 'info', label: 'Vuole informazioni' },
    { value: 'curiosita', label: 'Curiosità' },
] as const;
export type GdoRequestReason = typeof GDO_REQUEST_REASON_OPTIONS[number]['value'];

export const GDO_EXPECTATION_OPTIONS = [
    { value: 'info', label: 'Ricevere info' },
    { value: 'materiale_gratis', label: 'Solo materiale gratuito' },
    { value: 'comprare', label: 'Comprare un corso' },
    { value: 'capire', label: 'Capire se fa per me' },
] as const;
export type GdoExpectation = typeof GDO_EXPECTATION_OPTIONS[number]['value'];

export const GDO_MAIN_PROBLEM_OPTIONS = [
    { value: 'economico', label: 'Economico' },
    { value: 'insoddisfatto', label: 'Insoddisfatto' },
    { value: 'tempo', label: 'Non ha tempo' },
    { value: 'competenze', label: 'Non ha competenze' },
] as const;
export type GdoMainProblem = typeof GDO_MAIN_PROBLEM_OPTIONS[number]['value'];

export const GDO_DIGITAL_KNOW_OPTIONS = [
    { value: 'nulla', label: 'Nulla' },
    { value: 'ha_visto', label: 'Ha visto qualcosa' },
    { value: 'conosce', label: 'Conosce le professioni' },
    { value: 'esperto', label: 'Esperto' },
] as const;
export type GdoDigitalKnow = typeof GDO_DIGITAL_KNOW_OPTIONS[number]['value'];

export const GDO_CHANGE_WITHIN_OPTIONS = [
    { value: '<30gg', label: 'Entro 30 giorni' },
    { value: '30-90gg', label: '30-90 giorni' },
    { value: 'indefinito', label: 'Non ha una data definita' },
] as const;
export type GdoChangeWithin = typeof GDO_CHANGE_WITHIN_OPTIONS[number]['value'];

export const GDO_CHANGE_SINCE_OPTIONS = [
    { value: '<6m', label: 'Meno di 6 mesi' },
    { value: '6-12m', label: '6-12 mesi' },
    { value: '>12m', label: 'Più di 12 mesi' },
] as const;
export type GdoChangeSince = typeof GDO_CHANGE_SINCE_OPTIONS[number]['value'];

export const GDO_EARLY_EXIT_REASONS = [
    { value: 'no_budget', label: 'Non può investire' },
    { value: 'solo_corso_10h', label: 'Vuole solo un corso da 10 ore' },
    { value: 'curioso', label: 'È solo curioso' },
    { value: 'altro', label: 'Altro motivo articolato' },
] as const;
export type GdoEarlyExitReason = typeof GDO_EARLY_EXIT_REASONS[number]['value'];

// Ordine domande GDO (usato dal ScriptWidget per posizionarle nei blocchi pertinenti).
// L'ordine è anche l'ordine di rendering se tutte mostrate insieme.
export type GdoSurveyField =
    | 'ageRange'
    | 'occupation'
    | 'requestReason'
    | 'expectation'
    | 'mainProblem'
    | 'digitalKnow'
    | 'changeWithin'
    | 'changeSince';

export const GDO_SURVEY_FIELDS: GdoSurveyField[] = [
    'ageRange',
    'occupation',
    'requestReason',
    'expectation',
    'mainProblem',
    'digitalKnow',
    'changeWithin',
    'changeSince',
];

// Mapping blocco script (1-based, titolo N) -> domande survey mostrate sotto quel blocco.
// Feedback Bruno 2026-04-17: l'età NON va chiesta all'inizio, la MAGGIOR PARTE delle
// domande va nella question phase (blocco 4 — Analisi problema), dove il GDO sta
// già sondando il contesto del lead.
// - Blocco 2 (gestione risposta, "cos'è che ti aveva colpito?"): motivo richiesta + aspettativa
// - Blocco 4 (analisi problema — QUESTION PHASE): età, occupazione, problema principale, conoscenza digitale
// - Blocco 7 (urgenza obiettivo): cambiamento entro + cerca da quanto
export const GDO_FIELDS_BY_BLOCK: Record<number, GdoSurveyField[]> = {
    2: ['requestReason', 'expectation'],
    4: ['ageRange', 'occupation', 'mainProblem', 'digitalKnow'],
    7: ['changeWithin', 'changeSince'],
};

export const GDO_FIELD_LABELS: Record<GdoSurveyField, string> = {
    ageRange: 'Età del lead',
    occupation: 'Stato occupazionale',
    requestReason: 'Motivo della richiesta',
    expectation: 'Cosa si aspettava dopo aver lasciato i dati',
    mainProblem: 'Problema principale',
    digitalKnow: 'Conoscenza del digitale',
    changeWithin: 'Entro quanto vuole cambiare',
    changeSince: 'Da quanto cerca un cambiamento',
};

// Tutte single-choice (feedback Bruno 2026-04-17: motivo richiesta e aspettativa
// erano multi, ora una sola risposta per domanda).
export const GDO_FIELD_MULTI: Record<GdoSurveyField, boolean> = {
    ageRange: false,
    occupation: false,
    requestReason: false,
    expectation: false,
    mainProblem: false,
    digitalKnow: false,
    changeWithin: false,
    changeSince: false,
};

export const GDO_FIELD_OPTIONS: Record<GdoSurveyField, readonly { value: string; label: string }[]> = {
    ageRange: GDO_AGE_OPTIONS,
    occupation: GDO_OCCUPATION_OPTIONS,
    requestReason: GDO_REQUEST_REASON_OPTIONS,
    expectation: GDO_EXPECTATION_OPTIONS,
    mainProblem: GDO_MAIN_PROBLEM_OPTIONS,
    digitalKnow: GDO_DIGITAL_KNOW_OPTIONS,
    changeWithin: GDO_CHANGE_WITHIN_OPTIONS,
    changeSince: GDO_CHANGE_SINCE_OPTIONS,
};

// ========== CONFERME ==========
export const CONFERME_WHY_NOT_OPTIONS = [
    { value: 'non_risponde', label: 'Non risponde' },
    { value: 'non_interessato', label: 'Dice che non è interessato' },
    { value: 'no_soldi', label: 'Non ha soldi' },
    { value: 'posticipa_senza_data', label: 'Posticipa senza data' },
] as const;
export type ConfermeWhyNot = typeof CONFERME_WHY_NOT_OPTIONS[number]['value'];

// ========== SALES ==========
export const SALES_PROBLEM_SIGNAL_OPTIONS = [
    { value: 'problema_specifico', label: 'Ha dichiarato un problema specifico' },
    { value: 'gia_provato', label: 'Ha già provato a cambiare ma senza successo' },
    { value: 'situazione_concreta', label: 'Ha descritto una situazione negativa molto concreta' },
    { value: 'nessuna', label: 'Nessuna' },
] as const;
export type SalesProblemSignal = typeof SALES_PROBLEM_SIGNAL_OPTIONS[number]['value'];

export const SALES_URGENCY_SIGNAL_OPTIONS = [
    { value: 'entro_3m', label: 'Ha detto di voler iniziare entro 3 mesi' },
    { value: 'non_sostenibile', label: 'Ha detto che la sua situazione non è sostenibile' },
    { value: 'data_certa', label: 'Ha dato al suo cambiamento una data certa' },
    { value: 'nessuna', label: 'Nessuna' },
] as const;
export type SalesUrgencySignal = typeof SALES_URGENCY_SIGNAL_OPTIONS[number]['value'];

export const SALES_PRICE_REACTION_OPTIONS = [
    { value: 'avanti', label: 'Va avanti' },
    { value: 'modalita_pagamento', label: 'Fa domande sulla modalità di pagamento' },
    { value: 'alto', label: 'Dice che è alto rispetto al servizio' },
    { value: 'non_posso', label: '"Non posso permettermelo"' },
    { value: 'evita', label: 'Evita argomento' },
] as const;
export type SalesPriceReaction = typeof SALES_PRICE_REACTION_OPTIONS[number]['value'];

// ========== VALIDATION HELPERS ==========
export function isValidGdoValue<F extends GdoSurveyField>(field: F, value: unknown): boolean {
    if (value == null) return false;
    const options = GDO_FIELD_OPTIONS[field];
    const multi = GDO_FIELD_MULTI[field];
    if (multi) {
        if (!Array.isArray(value) || value.length === 0) return false;
        return value.every((v) => options.some((o) => o.value === v));
    }
    return options.some((o) => o.value === value);
}

export const EXCLUDED_FUNNEL = 'database';
