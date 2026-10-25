// Serenamente ignorata per GDO e Conferme (PO 25/10/2026): per loro non esiste.
// Restringere le aziende consentite in `currentTenant` basta a togliere tutto
// insieme: il redirect a /seleziona-azienda, il banner dei richiami dell'altra
// azienda, lo switcher e i lead Serenamente nelle viste (l'azienda attiva
// diventa sempre Fenice, anche con un vecchio cookie). Admin, manager e
// venditori restano come prima.

const RUOLI_SOLO_FENICE = new Set(['GDO', 'CONFERME'])

export function aziendeEffettive(ruolo: string, consentite: readonly string[]): string[] {
    if (RUOLI_SOLO_FENICE.has(ruolo) && consentite.includes('fenice')) return ['fenice']
    return [...consentite]
}
