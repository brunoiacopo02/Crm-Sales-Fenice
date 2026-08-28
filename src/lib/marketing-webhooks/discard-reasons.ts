import { CONFERME_DISCARD_REASONS } from '@/lib/surveys/questions';

/**
 * Codice stabile della causale di scarto, per il CRM marketing.
 *
 * Il marketing raggruppa su questo, mai sulla stringa italiana: le etichette
 * sono testo di UI e cambiano, i codici no. Aggiungere valori e' sicuro,
 * rinominarli spacca i loro grafici storici.
 */
export type DiscardReasonCode =
    | 'NO_BUDGET'
    | 'NOT_INTERESTED'
    | 'UNEMPLOYED'
    | 'FOREIGN'
    | 'INFO_ONLY'
    | 'REFUSED_APPOINTMENT'
    | 'INVALID_NUMBER'
    | 'NO_DECISION_POWER'
    | 'UNREACHABLE'
    | 'NO_ANSWER'
    | 'POSTPONED_NO_DATE'
    | 'HUNG_UP'
    | 'OTHER';

/** Causali a testo esatto, normalizzate in minuscolo. */
const BY_REASON: Record<string, DiscardReasonCode> = {
    'non ha soldi': 'NO_BUDGET',
    'non interessato': 'NOT_INTERESTED',
    'disoccupato': 'UNEMPLOYED',
    'straniero': 'FOREIGN',
    'solo informazioni': 'INFO_ONLY',
    "non vuole prendere l'appuntamento": 'REFUSED_APPOINTMENT',
    'numero inesistente': 'INVALID_NUMBER',
    'non ha potere decisionale': 'NO_DECISION_POWER',
    'non risponde': 'NO_ANSWER',
    'posticipa senza data': 'POSTPONED_NO_DATE',
    'attaccato in faccia': 'HUNG_UP',
    '3 nr consecutivi': 'UNREACHABLE',
};

/**
 * Prefissi dell'auto-scarto per irreperibilita'. Non e' un match esatto perche'
 * la stringa porta dentro il numero di tentativi, e perche' fino al 2026-08-24
 * il CRM scriveva "irriperebile": i lead scartati prima di quella data devono
 * continuare a produrre UNREACHABLE.
 */
const UNREACHABLE_PREFIXES = ['irreperibile', 'irriperebile'];

function normalize(raw: string): string {
    return raw.trim().toLowerCase();
}

/** Codice stabile della causale. Non lancia mai: il fallback e' OTHER. */
export function discardReasonCode(raw: string | null | undefined): DiscardReasonCode {
    if (!raw) return 'OTHER';
    const n = normalize(raw);
    if (!n) return 'OTHER';
    if (UNREACHABLE_PREFIXES.some(p => n.startsWith(p))) return 'UNREACHABLE';
    return BY_REASON[n] ?? 'OTHER';
}

/**
 * Etichetta leggibile. Per le causali delle Conferme riusa quella gia' scritta
 * nella tendina ("Attaccato in faccia"); per tutto il resto restituisce il
 * testo ripulito dagli spazi.
 */
export function discardReasonLabel(raw: string | null | undefined): string {
    if (!raw) return '';
    const n = normalize(raw);
    const fromConferme = CONFERME_DISCARD_REASONS.find(o => o.value === n);
    return fromConferme?.label ?? raw.trim();
}
