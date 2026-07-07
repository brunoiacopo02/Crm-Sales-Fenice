// Esiti venditore che contano come "presenziato" (decisione PO 2026-07-05).
export const PRESENZIATO_OUTCOMES = ['Chiuso', 'Non chiuso'] as const
export function isPresenziato(outcome: string | null): boolean {
    return outcome === 'Chiuso' || outcome === 'Non chiuso'
}
// Data canonica di attribuzione di un "App Fissato": quando il GDO l'ha fissato.
export function apptSetAt(lead: { appointmentCreatedAt: Date | null; appointmentDate: Date | null }): Date | null {
    if (!lead.appointmentDate) return null
    return lead.appointmentCreatedAt ?? lead.appointmentDate
}
// Target giornalieri per-GDO (decisione PO): default individuale 8, soglia giudizio manager 10.
export const DEFAULT_DAILY_APPT_TARGET = 8
export const MANAGER_TARGET_APP_PER_GDO_DAY = 10
// Filtro standard per GDO "veri" nelle classifiche/medie (esclude il bot fissatore).
export function isRealGdo(u: { role: string; isActive: boolean; isBot: boolean }): boolean {
    return u.role === 'GDO' && u.isActive && !u.isBot
}
// Divisore delle medie per-GDO: solo GDO reali con statsActive.
export function isStatsGdo(u: { role: string; isActive: boolean; isBot: boolean; statsActive: boolean }): boolean {
    return isRealGdo(u) && u.statsActive
}
