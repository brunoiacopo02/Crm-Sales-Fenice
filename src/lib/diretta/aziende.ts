// Serenamente ignorata per GDO e Conferme (PO 25/10/2026): per loro non esiste.
// Restringere le aziende consentite in `currentTenant` basta a togliere tutto
// insieme: il redirect a /seleziona-azienda, il banner dei richiami dell'altra
// azienda, lo switcher e i lead Serenamente nelle viste (l'azienda attiva
// diventa sempre Fenice, anche con un vecchio cookie). Manager e venditori
// restano come prima.
//
// Admin (PO 25/10/2026, Rinascita): niente più scelta fra Fenice e Serenamente
// dopo il login, niente switcher né "Tutte le aziende". Un vecchio cookie
// (serenamente o __all__) non vale più: currentTenant lo scarta e torna Fenice.
// I dati Serenamente restano dove sono, solo non si sceglie più.

const RUOLI_SOLO_FENICE = new Set(['GDO', 'CONFERME', 'ADMIN'])

export function aziendeEffettive(ruolo: string, consentite: readonly string[]): string[] {
    if (RUOLI_SOLO_FENICE.has(ruolo) && consentite.includes('fenice')) return ['fenice']
    return [...consentite]
}
