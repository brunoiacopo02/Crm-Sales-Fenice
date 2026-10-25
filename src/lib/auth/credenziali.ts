// Email e password di accesso cambiate dal CRM (PO 25/10/2026): regole pure,
// usate dalle server action e dai test. Il cambio lo fa la funzione SQL
// public.cambia_credenziali (migr. 0053).

/** Ruoli che possono cambiare da soli le proprie credenziali. */
export const RUOLI_CREDENZIALI_PROPRIE: readonly string[] = ['GDO']

export const PASSWORD_MIN = 8
/** bcrypt considera solo i primi 72 byte. */
export const PASSWORD_MAX = 72

export type ErroreCredenziali =
    | 'email' | 'password_corta' | 'password_lunga' | 'password_diverse' | 'niente'
    | 'attuale' | 'email_usata' | 'utente' | 'ruolo' | 'errore'

export function normalizzaEmail(s: string | null | undefined): string {
    return (s ?? '').trim().toLowerCase()
}

export function emailValida(s: string): boolean {
    return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

export function controllaPassword(p: string): ErroreCredenziali | null {
    if (p.length < PASSWORD_MIN) return 'password_corta'
    if (new TextEncoder().encode(p).length > PASSWORD_MAX) return 'password_lunga'
    return null
}

/**
 * Controlla la richiesta del GDO: email nuova (vuota = resta com'è), password
 * nuova ripetuta due volte (vuota = resta com'è). Almeno una delle due.
 */
export function controllaRichiesta(i: { emailAttuale: string; email: string; password: string; ripeti: string }):
    { ok: true; email: string | null; password: string | null } | { ok: false; errore: ErroreCredenziali } {
    const email = normalizzaEmail(i.email)
    const nuovaEmail = email && email !== normalizzaEmail(i.emailAttuale) ? email : null
    if (nuovaEmail && !emailValida(nuovaEmail)) return { ok: false, errore: 'email' }
    const password = i.password ?? ''
    if (password) {
        const e = controllaPassword(password)
        if (e) return { ok: false, errore: e }
        if (password !== (i.ripeti ?? '')) return { ok: false, errore: 'password_diverse' }
    }
    if (!nuovaEmail && !password) return { ok: false, errore: 'niente' }
    return { ok: true, email: nuovaEmail, password: password || null }
}

export function messaggioCredenziali(e: ErroreCredenziali): string {
    switch (e) {
        case 'email': return 'Questa email non sembra valida.'
        case 'password_corta': return `La password deve avere almeno ${PASSWORD_MIN} caratteri.`
        case 'password_lunga': return 'La password è troppo lunga.'
        case 'password_diverse': return 'Le due password nuove non coincidono.'
        case 'niente': return 'Non hai cambiato niente.'
        case 'attuale': return 'La password attuale non è giusta.'
        case 'email_usata': return 'Questa email è già usata da un altro account.'
        case 'utente': return 'Account non trovato.'
        case 'ruolo': return 'Non puoi cambiare queste credenziali.'
        default: return 'Qualcosa non ha funzionato. Riprova tra poco.'
    }
}
