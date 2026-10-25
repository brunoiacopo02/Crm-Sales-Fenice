// Lead accantonati (PO 25/10/2026): i ridati dal bot messi da parte senza
// GDO (evento RIDATO_PARCHEGGIATO, assignedToId null) che l'admin assegna a
// mano da /import. Qui le regole pure; la query sta in accantonatiActions.ts.
//
// Accantonato = lead aperto (NEW/IN_PROGRESS), di nessuno, con almeno un
// evento RIDATO_PARCHEGGIATO, senza appuntamento né presenza, non di prova,
// non del lancio (tolto ai GDO il 24/10), conta nei KPI, nessuna richiesta
// "Ti ha cercato" aperta. In cima i ridati più di recente.

/** Un click non sposta più di così: oltre si ripete. */
export const MAX_ACCANTONATI_PER_VOLTA = 300

const MOTIVI: Record<string, string> = {
    mai_risposto_al_bot: 'Non hanno mai risposto in chat',
    stella_fuori_selezione: 'Chat interrotta, inserzioni meno buone',
    lorenzo_solo_ridati_migliori: 'Tolti a Lorenzo',
}

/** Nome in italiano semplice del motivo per cui il lead è stato accantonato. */
export function etichettaMotivo(motivo: string | null | undefined): string {
    if (!motivo) return 'Altro'
    return MOTIVI[motivo] ?? 'Altro'
}

/** Quanti se ne assegnano davvero: intero, almeno 0, mai oltre i presenti né il tetto del click. */
export function quantiDaAssegnare(richiesti: number, disponibili: number): number {
    const n = Math.floor(Number.isFinite(richiesti) ? richiesti : 0)
    return Math.max(0, Math.min(n, Math.max(0, disponibili), MAX_ACCANTONATI_PER_VOLTA))
}

/**
 * Più motivi con lo stesso nome (es. due motivi rari finiti in "Altro") si
 * sommano; in ordine dal più numeroso.
 */
export function raggruppaMotivi(righe: Array<{ motivo: string | null; n: number }>): Array<{ etichetta: string; n: number }> {
    const somma = new Map<string, number>()
    for (const r of righe) {
        const e = etichettaMotivo(r.motivo)
        somma.set(e, (somma.get(e) ?? 0) + r.n)
    }
    return [...somma.entries()]
        .map(([etichetta, n]) => ({ etichetta, n }))
        .filter(r => r.n > 0)
        .sort((a, b) => b.n - a.n || a.etichetta.localeCompare(b.etichetta))
}
