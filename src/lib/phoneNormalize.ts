/**
 * Normalizza un numero di telefono variabile (parentesi, trattini, spazi,
 * con/senza +39, con 00 prefisso internazionale) in formato E.164 italiano.
 *
 * Regole:
 * - Rimuovi tutto tranne cifre e un eventuale '+' all'inizio.
 * - "00xx..." -> "+xx..."
 * - "39..." con 11-13 cifre senza '+' -> "+39..."
 * - Numero italiano mobile di 10 cifre (3xxxxxxxxx) senza prefisso -> "+39" + numero
 * - Numero italiano fisso di 9-11 cifre (inizia con 0) senza prefisso -> "+39" + numero
 * - Se tutto il resto fallisce ma ha >=9 cifre, restituisco "+" + cifre (internazionale sconosciuto)
 * - Se invalido (<9 cifre), ritorno null.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const hasPlus = trimmed.startsWith('+');
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (!digitsOnly) return null;

    let result: string;

    if (hasPlus) {
        // già internazionale: ritengo solo le cifre
        result = '+' + digitsOnly;
    } else if (digitsOnly.startsWith('00')) {
        // 00xx... -> +xx...
        result = '+' + digitsOnly.slice(2);
    } else if (digitsOnly.startsWith('39') && digitsOnly.length >= 11 && digitsOnly.length <= 13) {
        // 39 + 9-11 cifre -> +39...
        result = '+' + digitsOnly;
    } else if (digitsOnly.length === 10 && digitsOnly.startsWith('3')) {
        // mobile italiano senza prefisso
        result = '+39' + digitsOnly;
    } else if (digitsOnly.startsWith('0') && digitsOnly.length >= 9 && digitsOnly.length <= 11) {
        // fisso italiano senza prefisso
        result = '+39' + digitsOnly;
    } else if (digitsOnly.length >= 9) {
        // fallback: internazionale sconosciuto, ma con almeno 9 cifre
        result = '+' + digitsOnly;
    } else {
        return null;
    }

    // Verifica finale: almeno 10 cifre totali (inclusi prefisso)
    const finalDigits = result.replace(/\D/g, '');
    if (finalDigits.length < 10) return null;
    return result;
}

/** Valida che il telefono normalizzato sembri plausibile (>=10 cifre, <=15). */
export function isPlausiblePhone(normalized: string | null): boolean {
    if (!normalized) return false;
    const digits = normalized.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
}
