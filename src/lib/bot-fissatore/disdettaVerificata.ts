import { isSelfBooked } from '@/lib/salesPipeline/sentinel';

/**
 * DISDETTA VERIFICATA DAL BOT (contratto v1.10, PO 28/10/2026).
 *
 * Sui lead dei GDO il bot è il postino: fino a oggi una disdetta scritta in chat arrivava
 * come NOTA "DISDETTA" e le Conferme chiamavano comunque. Sui dati del 28/10: 206 disdette
 * vere con la call passata → 0 presenti. Ora il bot fa giudicare la disdetta da una
 * chiamata separata al modello (il "giudice", repo del bot `lib/giudice-disdetta.ts`) e
 * SOLO quando il verdetto è "disdetta vera" manda `DISDETTA_VERIFICATA`: il lead viene
 * scartato dalle Conferme esattamente come uno scarto fatto a mano, quindi esce dalla board
 * "da lavorare" (che filtra `confirmationsOutcome IS NULL`) e resta recuperabile con
 * "Annulla scarto" (`undoConfermeScarto`) come qualunque scarto.
 *
 * Questo file decide SE scartare: tutte le guardie stanno qui, pure e testate. Qualunque
 * dubbio → niente scarto e il bot ripiega sulla nota di sempre.
 */

export const DISDETTA_VERIFICATA_REASON = 'Disdetta in chat (verificata dal bot)';

/**
 * Oltre questo tempo dalla call non si scarta più: la videochiamata è passata da un pezzo,
 * il lead può essere già nelle mani del venditore o in un giro di recupero, e una disdetta
 * che arriva dopo non è più "non chiamatelo per quella call". 24 ore coprono il caso vero
 * (la disdetta arriva la sera della call o la mattina dopo, mentre le Conferme lo hanno
 * ancora in board per rifissarlo) senza toccare lead vecchi.
 */
export const CALL_PASSATA_MAX_MS = 24 * 60 * 60 * 1000;

export type LeadPerScarto = {
    status: string | null;
    appointmentDate: Date | null;
    confirmationsOutcome: string | null;
    confirmationsDiscardReason: string | null;
    salespersonUserId: string | null;
    salespersonOutcome: string | null;
    presentedAt: Date | null;
};

export type MotivoNoScarto =
    | 'non_appuntato'
    | 'autofissato'
    | 'gia_scartato_disdetta'
    | 'gia_scartato'
    | 'gia_confermato'
    | 'venditore_assegnato'
    | 'esito_venditore'
    | 'presentato'
    | 'senza_data'
    | 'call_passata';

export function valutaScartoDisdetta(
    lead: LeadPerScarto,
    now: Date = new Date(),
): { ok: true } | { ok: false; motivo: MotivoNoScarto } {
    if (lead.status !== 'APPOINTMENT') return { ok: false, motivo: 'non_appuntato' };
    if (isSelfBooked(lead.confirmationsOutcome)) return { ok: false, motivo: 'autofissato' };
    if (lead.confirmationsOutcome === 'scartato') {
        return {
            ok: false,
            motivo: lead.confirmationsDiscardReason === DISDETTA_VERIFICATA_REASON ? 'gia_scartato_disdetta' : 'gia_scartato',
        };
    }
    // Già confermato, con o senza venditore: lì c'è il lavoro di una persona, e decide lei.
    if (lead.confirmationsOutcome !== null) return { ok: false, motivo: 'gia_confermato' };
    if (lead.salespersonUserId) return { ok: false, motivo: 'venditore_assegnato' };
    if (lead.salespersonOutcome) return { ok: false, motivo: 'esito_venditore' };
    if (lead.presentedAt) return { ok: false, motivo: 'presentato' };
    if (!lead.appointmentDate) return { ok: false, motivo: 'senza_data' };
    if (lead.appointmentDate.getTime() < now.getTime() - CALL_PASSATA_MAX_MS) return { ok: false, motivo: 'call_passata' };
    return { ok: true };
}

export const CATEGORIE_DISDETTA_LABEL: Record<string, string> = {
    soldi: 'soldi / fuori budget',
    non_fa_per_me: 'non fa per lui',
    ripensamento: 'ripensamento, non più interessato',
    tempo: 'tempo',
    personale_salute: 'motivi personali o di salute',
    pensava_gratis: 'pensava fosse gratis',
    spostamento: 'spostamento',
    altro: 'altro',
};

function pulisci(t: string | undefined | null, max: number): string {
    const s = (t ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** La nota in timeline (tab Note delle Conferme): il fatto, la categoria, le parole vere. */
export function buildDisdettaVerificataNote(input: { citazione?: string | null; categoria?: string | null; note?: string | null }): string {
    const cat = input.categoria ? (CATEGORIE_DISDETTA_LABEL[input.categoria] ?? input.categoria) : 'non indicata';
    const parole = pulisci(input.citazione || input.note, 400);
    return `DISDETTA VERIFICATA — scartato in automatico dalle Conferme (${DISDETTA_VERIFICATA_REASON}). Categoria: ${cat}.`
        + (parole ? ` Parole del lead: "${parole}".` : '')
        + ' Se è un errore, recuperalo con "Annulla scarto".';
}
