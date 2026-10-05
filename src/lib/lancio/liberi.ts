/**
 * Lead "liberi" del lancio (PO 05/10/2026): le chiamate subito della sera e
 * gli appuntamenti del mattino dopo col venditore. Su questi il venditore
 * lavora dalla sezione "Lead del lancio": telefono sempre visibile, niente
 * "Inizia trattativa", niente sondaggio e niente follow-up obbligatori.
 * L'esito resta quello di sempre (Chiuso con importo, Non chiuso con motivo).
 * Puro: niente DB.
 */
import { LANCIO_WEBDEV, type LancioConfig, type LancioScelta } from './config'

export const SCELTE_LIBERE: ReadonlyArray<LancioScelta> = ['chiamata_subito', 'app_mattina']

export function isLancioLiberoLead(
    lead: { launchBucket: string | null; lancioScelta: string | null },
    cfg: LancioConfig = LANCIO_WEBDEV,
): boolean {
    return lead.launchBucket === cfg.bucket
        && (SCELTE_LIBERE as ReadonlyArray<string>).includes(lead.lancioScelta ?? '')
}
