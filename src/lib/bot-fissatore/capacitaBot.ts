/**
 * Tetto giornaliero dei freschi al bot letto DAL BOT (PO 07/11/2026).
 *
 * Fino al 07/11 il tetto era solo l'env `BOT_TETTO_GIORNALIERO` (190), da alzare a
 * mano ogni volta che il bot promuove un numero (evento `tetto_promosso` del bot:
 * 2245/2508 30→50, 3199 15→30). Ora il CRM legge da solo la capacità del bot: la
 * somma dei tetti per numero in `tetti_numeri` del bot, esclusi i numeri a tetto 0
 * e quelli in pausa qualità. Arriva dall'endpoint già esistente
 * `/api/bot/qualita-numeri` (firma HMAC, contratto bot↔CRM, vedi qualitaNumeri.ts).
 *
 * - `BOT_TETTO_GIORNALIERO` resta l'INTERRUTTORE della regola: assente = regola
 *   spenta come prima (qui si torna null e nulla cambia).
 * - Valore usato: la capacità del bot se leggibile, altrimenti l'env (FALLBACK).
 * - `BOT_TETTO_DAL_BOT=off` forza l'env (rollback senza toccare il codice).
 * - Cache per istanza: 10 minuti sul valore letto, 1 minuto dopo un errore (il
 *   webhook AC non deve chiamare il bot a ogni lead).
 * - La riserva serale (`BOT_RISERVA_FUORI_ORARIO`) si applica dopo, invariata
 *   (`tettoBotAdesso` in leadRouting.ts).
 */
import { tettoBotGiornaliero } from './leadRouting';
import { statoNumeriDalBot, type StatoNumeriBot } from './qualitaNumeri';

export type FonteTetto = 'bot' | 'env' | 'env_forzata';

export type TettoBotEffettivo = {
    /** Tetto giornaliero da usare (prima della riserva serale). */
    valore: number;
    fonte: FonteTetto;
    /** Il valore dell'env, sempre (il fallback). */
    env: number;
    /** La capacità letta dal bot, se c'è (anche quando vince l'env forzata). */
    dalBot: number | null;
    /** Numeri contati (senza `whatsapp:`) → tetto, per la visibilità. */
    perNumero: Record<string, number> | null;
    /** Quando è stato letto il bot (ms), o null. */
    lettoAt: number | null;
};

const soloNumero = (n: string) => n.trim().replace(/^whatsapp:/i, '');

/**
 * Pura: la capacità del bot dai suoi `tetti_numeri`, esclusi i numeri in pausa
 * qualità e quelli a tetto 0. null = dati non usabili (tetti assenti/non oggetto,
 * oppure valori tutti illeggibili): chi chiama usa l'env. Mai sopra 1000 (lo
 * stesso limite dell'env).
 */
export function capacitaDaTetti(tetti: unknown, stato: unknown): { totale: number; perNumero: Record<string, number> } | null {
    if (!tetti || typeof tetti !== 'object' || Array.isArray(tetti)) return null;
    const pause = new Set<string>();
    if (stato && typeof stato === 'object') {
        const p = (stato as { pause?: unknown }).pause;
        if (p && typeof p === 'object') for (const k of Object.keys(p)) pause.add(soloNumero(k));
    }
    const perNumero: Record<string, number> = {};
    let leggibili = 0;
    for (const [k, v] of Object.entries(tetti as Record<string, unknown>)) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
        if (!Number.isInteger(n) || n < 0) continue;
        leggibili++;
        const num = soloNumero(k);
        if (n === 0 || pause.has(num)) continue;
        perNumero[num] = n;
    }
    if (leggibili === 0) return null;
    const totale = Object.values(perNumero).reduce((s, x) => s + x, 0);
    return { totale: Math.min(1000, totale), perNumero };
}

const CACHE_OK_MS = 10 * 60 * 1000;
const CACHE_ERRORE_MS = 60 * 1000;
/** Il webhook AC aspetta al massimo questo: oltre, vale l'env. */
const TIMEOUT_MS = 1500;

let cache: { dalBot: number | null; perNumero: Record<string, number> | null; lettoAt: number | null; fino: number } | null = null;

/** Solo per i test. */
export function _azzeraCacheCapacita(): void {
    cache = null;
}

/**
 * Il tetto giornaliero del bot da usare adesso. null = regola spenta (env assente).
 * Mai lancia; nel dubbio vale l'env.
 */
export async function tettoBotEffettivo(opzioni: {
    nowMs?: number;
    leggi?: () => Promise<StatoNumeriBot | null>;
} = {}): Promise<TettoBotEffettivo | null> {
    const env = tettoBotGiornaliero();
    if (env === null) return null;
    const nowMs = opzioni.nowMs ?? Date.now();
    const forzata = process.env.BOT_TETTO_DAL_BOT?.trim().toLowerCase() === 'off';

    if (!cache || cache.fino <= nowMs) {
        let letto: StatoNumeriBot | null = null;
        try { letto = await (opzioni.leggi ?? (() => statoNumeriDalBot(TIMEOUT_MS)))(); } catch { letto = null; }
        const cap = letto ? capacitaDaTetti(letto.tetti, letto.stato) : null;
        if (cap) {
            cache = { dalBot: cap.totale, perNumero: cap.perNumero, lettoAt: nowMs, fino: nowMs + CACHE_OK_MS };
            console.log(`[tetto-bot] capacita' letta dal bot: ${cap.totale} (${Object.entries(cap.perNumero).map(([n, t]) => `${n.slice(-4)}=${t}`).join(' ')}), env ${env}`);
        } else {
            cache = { dalBot: null, perNumero: null, lettoAt: null, fino: nowMs + CACHE_ERRORE_MS };
            console.error(`[tetto-bot] capacita' del bot non leggibile: vale BOT_TETTO_GIORNALIERO=${env}`);
        }
    }

    const base = { env, dalBot: cache.dalBot, perNumero: cache.perNumero, lettoAt: cache.lettoAt };
    if (forzata) return { ...base, valore: env, fonte: 'env_forzata' };
    if (cache.dalBot !== null) return { ...base, valore: cache.dalBot, fonte: 'bot' };
    return { ...base, valore: env, fonte: 'env' };
}
