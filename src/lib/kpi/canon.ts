// Esiti venditore che contano come "presenziato" (decisione PO 2026-07-05).
// ⚠️ DEPRECATO per i CONTEGGI presenze (PO 2026-07-17): la base canonica è il
// latch `leads.presentedAt` (giorno dell'appuntamento, settato alla prima
// registrazione di Chiuso/Non chiuso, mai sovrascritto — uno "Sparito" a un
// follow-up non toglie la presenza). Questa whitelist resta solo per viste
// legacy non ancora migrate e per decidere QUANDO scatta il latch.
export const PRESENZIATO_OUTCOMES = ['Chiuso', 'Non chiuso'] as const
export function isPresenziato(outcome: string | null): boolean {
    return outcome === 'Chiuso' || outcome === 'Non chiuso'
}
// Data canonica di attribuzione di un "App Fissato": quando il GDO l'ha fissato.
export function apptSetAt(lead: { appointmentCreatedAt: Date | null; appointmentDate: Date | null }): Date | null {
    if (!lead.appointmentDate) return null
    return lead.appointmentCreatedAt ?? lead.appointmentDate
}
/**
 * Data canonica di "ingresso in circolazione" di un lead (migrazione 0027,
 * decisione PO 2026-07-20/2026-08-06): un lead dei pool /import caricato a
 * luglio e distribuito dal TL ad agosto è un lead di agosto.
 *
 * Vale per tutti i lead, non solo per quelli dei pool: sui lead dei funnel a
 * pagamento `assignedAt` e `createdAt` cadono nello stesso giorno (verificato
 * su 23.760 lead non-pool da giugno: zero cambiano mese), quindi la regola
 * unica non sposta il CPL delle campagne.
 *
 * `assignedAt` è NULL sui lead di magazzino mai assegnati e sul tracciato
 * anteriore alla 0027: lì si ricade su `createdAt`.
 */
export function leadIntakeAt(lead: { assignedAt: Date | null; createdAt: Date }): Date {
    return lead.assignedAt ?? lead.createdAt
}

// Target giornalieri per-GDO (decisione PO): default individuale 8, soglia giudizio manager 10.
export const DEFAULT_DAILY_APPT_TARGET = 8
export const MANAGER_TARGET_APP_PER_GDO_DAY = 10
/**
 * Causali di scarto che NON sono una scelta basata sul contenuto della
 * chiamata, ma dicono che il lead non ha mai risposto (numero che non esiste,
 * non utilizzabile, ecc.). Vanno contate come mancato contatto nel tasso di
 * risposta ed ESCLUSE dai motivi di scarto: non sono un esito qualitativo.
 *
 * ⚠️ Le voci qui dentro devono essere gia' normalizzate (minuscolo, senza
 * spazi ai bordi): il confronto passa da `normalizeDiscardReason`.
 * Estendibile ad altre grafie ("numero errato", "numero non utilizzabile").
 */
export const NEVER_ANSWERED_DISCARD_REASONS = new Set<string>([
    'numero inesistente',
])

function normalizeDiscardReason(raw: string | null | undefined): string {
    return (raw ?? '').trim().toLowerCase()
}

/** true se il log dice "il lead non ha mai risposto" pur non essendo NON_RISPOSTO. */
export function isNeverAnsweredLog(outcome: string | null, discardReason: string | null): boolean {
    if (outcome !== 'DA_SCARTARE') return false
    const reason = normalizeDiscardReason(discardReason)
    return reason !== '' && NEVER_ANSWERED_DISCARD_REASONS.has(reason)
}

/**
 * Definizione canonica di "il GDO ha parlato con il lead", usata sia da
 * /kpi-gdo (`getAdvancedKpi`) sia da Operativa Team (`getManagerOperativaData`).
 *
 * ⚠️ Nasce dall'aver avuto due implementazioni divergenti della stessa metrica:
 * Operativa contava "numero inesistente" come risposta e KPI GDO no, con uno
 * scarto misurato fino a 4 punti sullo stesso GDO nello stesso mese. Se serve
 * cambiare la regola, si cambia QUI e basta — non nei chiamanti.
 *
 * `NON_RISPONDE` e' la grafia legacy di `NON_RISPOSTO` nel tracciato vecchio.
 */
export function isAnsweredLog(outcome: string | null, discardReason: string | null): boolean {
    const oc = (outcome ?? '').toUpperCase()
    if (oc === '' || oc === 'NON_RISPOSTO' || oc === 'NON_RISPONDE') return false
    return !isNeverAnsweredLog(outcome, discardReason)
}

// Filtro standard per GDO "veri" nelle classifiche/medie (esclude il bot fissatore).
export function isRealGdo(u: { role: string; isActive: boolean; isBot: boolean }): boolean {
    return u.role === 'GDO' && u.isActive && !u.isBot
}
// Divisore delle medie per-GDO: solo GDO reali con statsActive.
export function isStatsGdo(u: { role: string; isActive: boolean; isBot: boolean; statsActive: boolean }): boolean {
    return isRealGdo(u) && u.statsActive
}
