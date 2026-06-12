/**
 * TL del team Conferme: vede la "Panoramica TL" (/conferme/panoramica-tl).
 * Gating per email (account CONFERME esistente, nessun ruolo dedicato —
 * richiesta Bruno 2026-06-12: il TL Conferme è Alberto).
 */
export const CONFERME_TL_EMAILS = ['alberto@fenice.local']

export function isConfermeTl(email: string | null | undefined): boolean {
    return !!email && CONFERME_TL_EMAILS.includes(email.toLowerCase())
}
