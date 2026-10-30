// Pool "Lead database punteggio alto" su /import (PO 30/10/2026).
//
// Sono i lead della coda marketing (launchBucket MKT_CODA, POST
// /api/webhooks/marketing-leads) rimasti senza nessuno: la coda al bot è spenta
// (MKT_CODA_BOT=off) e senza questa card non li vedeva nessuno. L'admin li
// guarda e, se vuole, li dà ai GDO che sceglie. Niente parte da solo.
//
// Qui le regole pure (testate in poolPunteggioAlto.test.ts); la query e la
// scrittura stanno in src/app/actions/poolPunteggioAltoActions.ts.

/** Un click non sposta più di così: oltre si ripete. */
export const MAX_PUNTEGGIO_ALTO_PER_VOLTA = 300

const FUNNEL: Record<string, string> = {
    corso10ore: 'Corso 10 ore',
    jobsimulator: 'Job Simulator',
    telegram: 'Telegram',
}

/**
 * Il funnel di origine come si legge in pagina. Il marketing li scrive in
 * minuscolo e senza spazi; quelli che non conosciamo restano come arrivano,
 * vuoto o "sconosciuto" diventa "Non indicato".
 */
export function etichettaFunnel(funnel: string | null | undefined): string {
    const v = (funnel ?? '').trim()
    const chiave = v.toLowerCase().replace(/[\s_-]+/g, '')
    if (!chiave || chiave === 'sconosciuto') return 'Non indicato'
    return FUNNEL[chiave] ?? v
}

/**
 * Il marketing ha visto un segnale (click, visita, apertura)? "Nessun segnale
 * recente" è il loro modo di dire di no.
 */
export function haSegnale(motivo: string | null | undefined): boolean {
    const v = (motivo ?? '').trim()
    return v.length > 0 && !/^nessun segnale/i.test(v)
}

export type FasciaEta = 'Meno di 6 mesi' | 'Da 6 a 12 mesi' | 'Da 1 a 2 anni' | 'Oltre 2 anni' | 'Non indicata'
export const FASCE_ETA: readonly FasciaEta[] = ['Meno di 6 mesi', 'Da 6 a 12 mesi', 'Da 1 a 2 anni', 'Oltre 2 anni', 'Non indicata']

/** Mesi interi fra il giorno di ingresso del contatto ('YYYY-MM-DD') e oggi; null se non c'è. */
export function mesiDiEta(dataIngresso: string | null | undefined, oggi: string): number | null {
    if (!dataIngresso || !/^\d{4}-\d{2}-\d{2}$/.test(dataIngresso) || !/^\d{4}-\d{2}-\d{2}$/.test(oggi)) return null
    const [ya, ma, ga] = dataIngresso.split('-').map(Number)
    const [yb, mb, gb] = oggi.split('-').map(Number)
    let mesi = (yb - ya) * 12 + (mb - ma)
    if (gb < ga) mesi--
    return Math.max(0, mesi)
}

/** In che fascia d'età cade il contatto. */
export function fasciaEta(mesi: number | null): FasciaEta {
    if (mesi === null) return 'Non indicata'
    if (mesi < 6) return 'Meno di 6 mesi'
    if (mesi < 12) return 'Da 6 a 12 mesi'
    if (mesi < 24) return 'Da 1 a 2 anni'
    return 'Oltre 2 anni'
}

/** "3 mesi", "1 anno e 2 mesi", "2 anni": l'età del contatto detta semplice. */
export function etaTesto(mesi: number | null): string {
    if (mesi === null) return '—'
    if (mesi < 1) return 'meno di un mese'
    const anni = Math.floor(mesi / 12)
    const resto = mesi % 12
    const m = resto === 1 ? '1 mese' : `${resto} mesi`
    if (anni === 0) return m
    const a = anni === 1 ? '1 anno' : `${anni} anni`
    return resto === 0 ? a : `${a} e ${m}`
}

/** Quanti se ne assegnano davvero: intero, almeno 0, mai oltre i presenti né il tetto del click. */
export function quantiDaAssegnare(richiesti: number, disponibili: number): number {
    const n = Math.floor(Number.isFinite(richiesti) ? richiesti : 0)
    return Math.max(0, Math.min(n, Math.max(0, disponibili), MAX_PUNTEGGIO_ALTO_PER_VOLTA))
}

/**
 * Pareggio sulle prime chiamate: ogni lead va a chi in quel momento ne ha meno
 * in prima chiamata, contando anche quelli appena dati in questo giro. Non è un
 * giro a turno: a chi ne ha 10 e a chi ne ha 120 si dà prima al più scarico.
 * A parità decide l'ordine dei GDO (per nome), così il piano è riproducibile.
 *
 * `leadIds` è già nell'ordine di assegnazione; il risultato tiene lo stesso
 * ordine.
 */
export function pianificaPareggio(
    leadIds: readonly string[],
    gdo: ReadonlyArray<{ id: string; carico: number }>,
): Array<{ leadId: string; gdoId: string }> {
    if (gdo.length === 0) return []
    const carico = gdo.map(g => Math.max(0, g.carico))
    const piano: Array<{ leadId: string; gdoId: string }> = []
    for (const leadId of leadIds) {
        let scelto = 0
        for (let i = 1; i < gdo.length; i++) if (carico[i] < carico[scelto]) scelto = i
        piano.push({ leadId, gdoId: gdo[scelto].id })
        carico[scelto]++
    }
    return piano
}

/** Quanti a testa dal piano, per l'anteprima e il resoconto. */
export function quantiATesta(piano: ReadonlyArray<{ gdoId: string }>): Map<string, number> {
    const m = new Map<string, number>()
    for (const p of piano) m.set(p.gdoId, (m.get(p.gdoId) ?? 0) + 1)
    return m
}
