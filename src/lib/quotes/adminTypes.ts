// Tipi della pagina /admin/citazioni, condivisi tra server action e client.

export interface AdminQuote {
    id: string
    kind: string
    text: string
    author: string
    work: string | null
    reference: string | null
    translationUrl: string | null
    translator: string | null
    theme: string | null
    occasions: string[]
    roles: string[]
    suggestedReflection: string | null
    reflectionSource: string | null
    technique: string | null
    usage: string | null
    originalText: string | null
    isActive: boolean
}

export interface AdminDayEntry {
    quote: AdminQuote | null
    /** Testo salvato dall'admin (approvato o da approvare). */
    reflection: string | null
    approved: boolean
    approvedAt: string | null
}

export interface AdminCalendarDay {
    day: string
    /** Es. "lunedì 26 ottobre", calcolato sul server. */
    label: string
    isToday: boolean
    citazione: AdminDayEntry
    vendita: AdminDayEntry
}

export interface QuoteChoice {
    id: string
    text: string
    author: string
    work: string | null
    theme: string | null
    technique: string | null
    occasions: string[]
    /** Giorni in cui è già in calendario (passati e futuri). */
    usedOn: string[]
}

export type ActionResult = { ok: true } | { ok: false; error: string }
