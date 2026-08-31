/**
 * I tipi che attraversano il confine server/client della riconciliazione.
 *
 * Stanno in un modulo a parte, e NON vengono ri-esportati dalle action.
 *
 * Il punto preciso: dentro un file `'use server'` **dichiarare** un tipo
 * (`export type X = ...`) è innocuo, e mezzo progetto lo fa. **Ri-esportarne**
 * uno che arriva da un altro modulo (`export type { X };` dopo averlo
 * importato) no: il bundler tratta ogni export di quel file come una server
 * action da registrare a runtime, il tipo non esiste come valore, e ne esce un
 * `ReferenceError: ConfrontoResult is not defined` che abbatte l'intera pagina
 * al caricamento — non alla chiamata. Successo in produzione il 31/08, e nessun
 * type-check lo vede: per TypeScript quel codice è corretto.
 */
import type { DiffEntry } from './match';

export type ConfrontoResult =
    | { success: true; entries: DiffEntry[]; sheetContracts: number; sheetTotalEur: number; crmTotalEur: number }
    | { success: false; error: string };

export type ApplyResult = { success: true; runId: string; applied: number } | { success: false; error: string };

export type AnnullaRunResult = { success: true; reverted: number } | { success: false; error: string };

export type RiconciliazioneRunSummary = {
    id: string;
    appliedAt: Date;
    appliedBy: string;
    entryCount: number;
    revertedAt: Date | null;
};
