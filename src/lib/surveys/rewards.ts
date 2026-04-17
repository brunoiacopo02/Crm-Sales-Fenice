// Costanti gamification per sondaggi lead.
// Bilanciamento calibrato vs sistema esistente (leggi coinTransactions medi + targets settimanali).

// Coins/XP rewards immediati
// Calibrati sotto la soglia delle azioni core (FISSATO: 10c/15xp, CONFERMATO: 8c/20xp).
// La survey è un quality enhancer, non un'azione di business: deve pagare meno.
export const GDO_SURVEY_COMPLETE_COINS = 8;
export const GDO_SURVEY_COMPLETE_XP = 15;
export const GDO_SURVEY_PARTIAL_COINS = 3;
export const GDO_SURVEY_PARTIAL_XP = 5;

export const CONFERME_SURVEY_COMPLETE_COINS = 5;
export const CONFERME_SURVEY_COMPLETE_XP = 10;

// Anti-gaming thresholds
export const MIN_FILL_DURATION_MS = 5000;       // < 5 sec = suspicious
export const CLUSTER_WINDOW_MS = 2 * 60 * 1000; // 2 min
export const CLUSTER_COUNT_THRESHOLD = 5;       // >=5 survey in 2 min = suspicious
export const MONOTONOUS_CONSECUTIVE = 3;         // 3+ identiche consecutive = suspicious

export const INVALIDATION_PENALTY_COINS = -20;

// Coin transaction reason codes
export const COIN_REASON_GDO_SURVEY = 'gdo_survey_completed';
export const COIN_REASON_GDO_SURVEY_PARTIAL = 'gdo_survey_partial';
export const COIN_REASON_CONFERME_SURVEY = 'conferme_survey_completed';
export const COIN_REASON_SURVEY_INVALIDATED = 'survey_invalidated_penalty';

// Achievement IDs (seed)
export const ACH_GDO_ANALISTA = 'ach_gdo_analista_seniore';
export const ACH_GDO_PROFILER = 'ach_gdo_profiler';
export const ACH_CONFERME_RADAR = 'ach_conferme_radar';

// Quest target metrics (per achievement/quest tracking)
export const METRIC_GDO_SURVEYS_COMPLETED = 'gdo_surveys_completed';
export const METRIC_CONFERME_SURVEYS_COMPLETED = 'conferme_surveys_completed';
