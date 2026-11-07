// Cursore del feed `/api/bot/lead-status` (contratto v1.14).
//
// Il cursore vecchio era solo `since` = updatedAt dell'ultima riga, al millisecondo.
// Due difetti insieme l'hanno fermato il 19/10/2026: (1) un update in blocco scrive lo
// stesso updatedAt su centinaia di lead, più della pagina; (2) Postgres tiene i
// microsecondi e il JS li tronca, quindi `updatedAt > since` ripescava sempre le stesse
// righe. Il cursore nuovo è la coppia (updatedAt al microsecondo, id): ordine totale,
// ogni riga esce una volta sola anche dentro un blocco con lo stesso istante.
//
// Formato in chiaro, opaco per il bot: `<ISO UTC al microsecondo>|<leadId>`.
// Il timestamp non contiene `|`, quindi si taglia sul primo.

export type LeadStatusCursor = { updatedAt: string; id: string };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export function encodeCursor(c: LeadStatusCursor): string {
    return `${c.updatedAt}|${c.id}`;
}

/** null se il cursore non è del formato nuovo (o è malformato). */
export function parseCursor(raw: unknown): LeadStatusCursor | null {
    if (typeof raw !== 'string') return null;
    const sep = raw.indexOf('|');
    if (sep <= 0) return null;
    const updatedAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!id || !ISO_RE.test(updatedAt) || isNaN(new Date(updatedAt).getTime())) return null;
    return { updatedAt, id };
}

/**
 * Confronto (updatedAt, id) come lo fa Postgres sulla row comparison. Gli ISO UTC con
 * lo stesso numero di cifre si confrontano come stringhe; il CRM li scrive sempre a 6.
 * Usato dai test per simulare il cursore senza database.
 */
export function compareKey(a: LeadStatusCursor, b: LeadStatusCursor): number {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
}
