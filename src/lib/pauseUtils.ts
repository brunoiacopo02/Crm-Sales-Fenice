export const BREAK_RULES = {
    MAX_DAILY_MINUTES: 30,
}

export function getLocalDateRome(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}
