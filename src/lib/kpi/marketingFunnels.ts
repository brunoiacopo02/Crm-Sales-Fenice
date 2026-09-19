/**
 * Elenco e ordine dei funnel di Marketing Analytics.
 *
 * Fino al 2026-09 la pagina girava su una WHITELIST (`OFFICIAL_FUNNELS`): un
 * funnel fuori da quella lista non compariva e i suoi lead sparivano dalla
 * pagina senza lasciare traccia. A settembre 2026 restavano fuori, fra gli
 * altri, `Lancio Web Dev AI` (l'intero lancio del 5 ottobre sarebbe stato
 * invisibile), `CORSO10ORE-TK` (74 lead e 11 appuntamenti), `JOBSIMULATOR`,
 * `SMM`, `SCONOSCIUTO`, `LEAD BF 2024`, `LANCIO DATA ANALYST`, `INBOUND`.
 *
 * Decisione PO 2026-09-19: si passa a un'ESCLUSIONE. Si tolgono solo i funnel
 * di test/servizio, tutto il resto entra e l'elenco è derivato dai dati —
 * come fanno già la Panoramica Generale (`getCrmFunnelCounts`) e la panoramica
 * TL Conferme (vedi il commento in `confermeKpiActions.ts:358`, che cita
 * proprio questo problema).
 *
 * Logica pura: niente DB, niente `use server`. Così è testabile.
 */

/** Funnel di test/servizio: gli unici che non entrano mai nelle statistiche. */
export const SERVICE_FUNNELS = ['TEST', 'BLT', ''] as const;

/**
 * Chiave canonica di un funnel: MAIUSCOLO e senza spazi ai bordi.
 * A DB convivono più grafie della stessa cosa (`Database` / `DATABASE`,
 * `test`): la chiave le fonde, come fa da sempre `funnel.toUpperCase()`.
 */
export function funnelKey(funnel: string | null | undefined): string {
    return (funnel ?? '').trim().toUpperCase();
}

/** true se il funnel è di test/servizio e va escluso dalle statistiche. */
export function isServiceFunnel(funnel: string | null | undefined): boolean {
    return (SERVICE_FUNNELS as readonly string[]).includes(funnelKey(funnel));
}

/**
 * I funnel storici, sempre presenti e sempre in testa in QUEST'ORDINE (è
 * l'ordine della vecchia `OFFICIAL_FUNNELS`): le righe della tabella non
 * ballano da un mese all'altro e chi legge ritrova le colonne dove erano.
 *
 * NON è più un filtro: un funnel fuori da questa lista compare comunque, in
 * coda, ordinato per volume.
 */
export const PINNED_FUNNELS = [
    'TELEGRAM',
    'JOB SIMULATOR',
    'CORSO 10 ORE',
    'ORG',
    'DATABASE',
    'TELEGRAM-TK',
    'GOOGLE',
    'SOCIAL',
] as const;

/**
 * Ordine finale delle righe: prima i `PINNED_FUNNELS` nel loro ordine fisso
 * (anche a zero), poi tutti gli altri funnel visti nel mese secondo
 * `compareExtras` — tipicamente per volume decrescente, con l'alfabetico come
 * spareggio perché l'ordine sia deterministico.
 *
 * I funnel di servizio vengono scartati qui per sicurezza, anche se le query
 * li hanno già esclusi a monte.
 */
export function orderFunnels(
    names: Iterable<string>,
    compareExtras: (a: string, b: string) => number,
): string[] {
    const pinned = new Set<string>(PINNED_FUNNELS);
    const extras = Array.from(new Set(Array.from(names, funnelKey)))
        .filter((f) => !pinned.has(f) && !isServiceFunnel(f))
        .sort(compareExtras);
    return [...PINNED_FUNNELS, ...extras];
}

/**
 * Comparatore standard per la coda: volume decrescente su due chiavi
 * (tipicamente lead, poi appuntamenti), alfabetico a parità.
 */
export function byVolumeThenName(
    primary: (funnel: string) => number,
    secondary: (funnel: string) => number,
): (a: string, b: string) => number {
    return (a, b) =>
        primary(b) - primary(a) ||
        secondary(b) - secondary(a) ||
        a.localeCompare(b);
}
