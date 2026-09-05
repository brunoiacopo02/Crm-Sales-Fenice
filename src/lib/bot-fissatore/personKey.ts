/**
 * Chiave persona: le ultime 10 cifre del numero.
 *
 * Il fornitore deduplica per numero e non può fare altrimenti — una persona ha
 * una chat sola. Con questa chiave la stessa persona resta riconoscibile anche
 * quando da noi diventa un lead nuovo, e con formati di scrittura diversi
 * (`3200431888`, `+39 320 043 1888`, `0039320...`).
 *
 * Vive in un modulo suo, e non in push.ts, perché ne ha bisogno anche
 * l'adozione dei lead entranti: importarla da push.ts trascinerebbe la
 * connessione al DB dentro moduli puri e dentro i test. Definizione unica —
 * push.ts la ri-esporta e basta.
 */
export function personKeyOf(phone: string | null): string | null {
    const digits = (phone || '').replace(/\D/g, '').slice(-10);
    return digits.length >= 9 ? digits : null;
}
