// Cosa si mostra della citazione del giorno e del consiglio di vendita
// (PO 25/10/2026). Funzioni pure, usate dalla lettura lato server e dai test.
//
// - Citazione: sempre testo e autore. Opera e riflessione solo se il giorno è
//   approvato e la riflessione c'è (pulsante "Approfondisci").
// - Consiglio di vendita: senza approvazione solo la frase e l'autore; se
//   manca la frase quel giorno non c'è consiglio. Con l'approvazione il
//   consiglio va nell'approfondimento e, se manca la frase, il titolo è la tecnica.
// - Se l'admin spegne la spiegazione (showReflection false) il giorno resta
//   approvato ma si vede come senza: sola frase e autore.
// - La bozza suggerita (suggestedReflection) non si mostra mai così com'è.

export interface DisplayRow {
    kind: string
    text: string
    author: string
    work: string | null
    technique: string | null
    roles: readonly string[]
    isActive: boolean
    approved: boolean
    reflection: string | null
    /** Spiegazione online (migr. 0052); assente = online, come prima. */
    showReflection?: boolean
}

export interface ShownQuote {
    /** Citazione, frase del consiglio o (consiglio approvato senza frase) la tecnica. */
    text: string
    author: string
    /** Contenuto di "Approfondisci": c'è solo se approvato. */
    deepen: { work: string | null; text: string } | null
}

export interface TodayQuotes {
    day: string
    citazione: ShownQuote | null
    vendita: ShownQuote | null
}

/** Righe massime di riflessione e consiglio, e caratteri per riga della stima. */
export const REFLECTION_MAX_LINES = 10
export const REFLECTION_CHARS_PER_LINE = 90

export function emptyToday(day: string): TodayQuotes {
    return { day, citazione: null, vendita: null }
}

/** L'admin vede tutto (approva lui); gli altri solo se il loro ruolo è tra quelli della citazione. */
export function canSee(roles: readonly string[], role: string | null | undefined): boolean {
    if (!role) return false
    return role === 'ADMIN' || roles.includes(role)
}

function approvedText(row: DisplayRow): string | null {
    if (!row.approved || row.showReflection === false) return null
    const t = row.reflection?.trim()
    return t ? t : null
}

export function shownCitazione(row: DisplayRow, role: string | null | undefined): ShownQuote | null {
    if (!row.isActive || !canSee(row.roles, role)) return null
    const text = row.text.trim()
    if (!text) return null
    const reflection = approvedText(row)
    return {
        text,
        author: row.author.trim(),
        deepen: reflection ? { work: row.work?.trim() || null, text: reflection } : null,
    }
}

export function shownVendita(row: DisplayRow, role: string | null | undefined): ShownQuote | null {
    if (!row.isActive || !canSee(row.roles, role)) return null
    const phrase = row.text.trim()
    const advice = approvedText(row)
    if (advice) {
        return {
            text: phrase || row.technique?.trim() || '',
            author: row.author.trim(),
            deepen: { work: row.work?.trim() || null, text: advice },
        }
    }
    if (!phrase) return null
    return { text: phrase, author: row.author.trim(), deepen: null }
}

export function buildTodayQuotes(day: string, rows: readonly DisplayRow[], role: string | null | undefined): TodayQuotes {
    const citazione = rows.find(r => r.kind === 'citazione')
    const vendita = rows.find(r => r.kind === 'vendita')
    return {
        day,
        citazione: citazione ? shownCitazione(citazione, role) : null,
        vendita: vendita ? shownVendita(vendita, role) : null,
    }
}

/**
 * Righe occupate dal testo a capo per parola (stima a larghezza fissa): ogni
 * a capo esplicito apre una riga, una parola più lunga della riga ne occupa
 * quante servono. Serve al contatore "massimo 10 righe" della pagina admin.
 */
export function countLines(text: string, charsPerLine = REFLECTION_CHARS_PER_LINE): number {
    if (!text.trim()) return 0
    let lines = 0
    for (const paragraph of text.replace(/\r\n/g, '\n').split('\n')) {
        const words = paragraph.split(/\s+/).filter(Boolean)
        if (words.length === 0) {
            lines++
            continue
        }
        let current = 0
        let paragraphLines = 1
        for (const w of words) {
            if (w.length > charsPerLine) {
                // parola lunghissima (es. un link): chiude la riga in corso e ne occupa diverse
                if (current > 0) paragraphLines++
                paragraphLines += Math.ceil(w.length / charsPerLine) - 1
                current = w.length % charsPerLine || charsPerLine
                continue
            }
            const needed = current === 0 ? w.length : current + 1 + w.length
            if (needed <= charsPerLine) {
                current = needed
            } else {
                paragraphLines++
                current = w.length
            }
        }
        lines += paragraphLines
    }
    return lines
}
