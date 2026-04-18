/**
 * Normalizza un numero di telefono. Due funzioni:
 * - normalizePhoneStrict: tenta normalizzazione italiana formale; ritorna
 *   null se non riesce (numero troppo corto o non valido). Usata per la
 *   validazione "forte".
 * - normalizePhoneLenient: rende il numero "presentabile" ma NON rigetta
 *   mai se c'è almeno una cifra. Usata dal webhook AC per non perdere lead
 *   anche quando il numero arriva incompleto (es. 8 cifre).
 *
 * Regole di normalizePhoneStrict:
 * - "00xx..." -> "+xx..."
 * - "39..." con 11-13 cifre senza '+' -> "+39..."
 * - Mobile IT 10 cifre (3xxxxxxxxx) -> "+39" + numero
 * - Fisso IT 9-11 cifre (0xxxx) -> "+39" + numero
 * - Con '+' o almeno 9 cifre -> "+" + digits
 * - Altrimenti null.
 */

export function normalizePhoneStrict(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const hasPlus = trimmed.startsWith('+');
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (!digitsOnly) return null;

    let result: string;

    if (hasPlus) {
        result = '+' + digitsOnly;
    } else if (digitsOnly.startsWith('00')) {
        result = '+' + digitsOnly.slice(2);
    } else if (digitsOnly.startsWith('39') && digitsOnly.length >= 11 && digitsOnly.length <= 13) {
        result = '+' + digitsOnly;
    } else if (digitsOnly.length === 10 && digitsOnly.startsWith('3')) {
        result = '+39' + digitsOnly;
    } else if (digitsOnly.startsWith('0') && digitsOnly.length >= 9 && digitsOnly.length <= 11) {
        result = '+39' + digitsOnly;
    } else if (digitsOnly.length >= 9) {
        result = '+' + digitsOnly;
    } else {
        return null;
    }

    const finalDigits = result.replace(/\D/g, '');
    if (finalDigits.length < 10) return null;
    return result;
}

/**
 * Versione lenient: se il numero è un formato italiano plausibile applica
 * normalizePhoneStrict; altrimenti restituisce il numero ripulito (solo
 * cifre + eventuale '+'), anche se incompleto. Ritorna null SOLO se non
 * c'è alcuna cifra.
 */
export function normalizePhoneLenient(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const strict = normalizePhoneStrict(raw);
    if (strict) return strict;
    // Fallback: pulisco ma preservo tutte le cifre ricevute.
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const hasPlus = trimmed.startsWith('+');
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (!digitsOnly) return null;
    return (hasPlus ? '+' : '') + digitsOnly;
}

/** Alias retrocompatibile: usato in contesti dove "strict" era l'intento. */
export function normalizePhone(raw: string | null | undefined): string | null {
    return normalizePhoneStrict(raw);
}

/** Valida che il telefono normalizzato sembri plausibile (>=10 cifre, <=15). */
export function isPlausiblePhone(normalized: string | null): boolean {
    if (!normalized) return false;
    const digits = normalized.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
}
