// Lettura della citazione del giorno che non dipende dalla migrazione 0048 e
// non ripete la stessa query fallita a ogni render (revisione del 25/10/2026).
// Funzioni pure, usate da ./today.ts e dai test.

/**
 * Vero se l'errore è una colonna che non esiste (Postgres 42703,
 * undefined_column), per esempio una migrazione non ancora applicata. Drizzle
 * avvolge l'errore di pg e lo mette in `cause`.
 */
export function colonnaMancante(e: unknown): boolean {
    let x: unknown = e
    for (let i = 0; i < 4 && x && typeof x === 'object'; i++) {
        if ((x as { code?: unknown }).code === '42703') return true
        x = (x as { cause?: unknown }).cause
    }
    return false
}

/**
 * Freno dopo un errore: per `pausaMs` si risponde senza andare al DB. Vive
 * nella memoria del processo, quindi vale per istanza del server: basta a non
 * rifare la stessa query fallita a ogni render e a ogni refresh.
 */
export function creaFreno(pausaMs: number, adesso: () => number = Date.now) {
    let fino = 0
    return {
        /** true finché dura la pausa dopo l'ultimo errore. */
        fermo: () => adesso() < fino,
        segnaErrore: () => { fino = adesso() + pausaMs },
    }
}
