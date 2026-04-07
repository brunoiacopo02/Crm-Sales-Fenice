export const BREAK_RULES = {
    MAX_MINUTES_PER_PAUSE: 15,
}

// Helper per ottenere data locale in formato YYYY-MM-DD
export function getLocalDateRome(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }) // Restituisce YYYY-MM-DD localizzato a Roma
}
