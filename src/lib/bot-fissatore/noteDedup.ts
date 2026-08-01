// Il bot ri-manda la stessa nota più volte a distanza di minuti, riscrivendo
// ogni volta il motivo ma non il fatto. Qui si estrae il fatto, così i re-invii
// si riconoscono senza buttare via le sfumature del motivo.

/** Entro questa finestra due note con la stessa intenzione sono lo stesso fatto. */
export const BOT_NOTE_DEDUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * L'intenzione di una nota, normalizzata per il confronto.
 *
 * In ordine: il testo fino a "Motivo:" (è lì che i re-invii coincidono e la
 * coda diverge), altrimenti la prima frase, altrimenti i primi 120 caratteri.
 * Ritorna stringa vuota per un testo vuoto — e una chiave vuota non combacia
 * mai con niente, nemmeno con un'altra chiave vuota.
 */
export function botNoteIntentKey(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return '';

    const motivoAt = trimmed.toLowerCase().indexOf('motivo:');
    let head: string;
    if (motivoAt > 0) {
        head = trimmed.slice(0, motivoAt);
    } else {
        const firstSentence = trimmed.match(/^[\s\S]*?\.(?=\s|$)/);
        head = firstSentence ? firstSentence[0] : trimmed.slice(0, 120);
    }

    return head
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[.,;:!?\s]+$/, '')
        .trim();
}

/** Due note raccontano lo stesso fatto? */
export function isSameBotNoteIntent(a: string, b: string): boolean {
    const keyA = botNoteIntentKey(a);
    return keyA.length > 0 && keyA === botNoteIntentKey(b);
}
