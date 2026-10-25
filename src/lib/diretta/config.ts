// Configurazione del restyle "Diretta" e della nuova gamification (PO 25/10/2026).
// Funzioni pure: i valori vivono in appSettings (chiave GAMIFICATION_SETTINGS_KEY)
// e l'admin li può cambiare; qui ci sono i default decisi da Bruno e i calcoli
// sulle finestre orarie, testabili senza database.

import { romeOffset, toRomeDateStr } from '@/lib/dateUtils'

export const GAMIFICATION_SETTINGS_KEY = 'gamification_targets'
export const DIRETTA_FLAG_KEYS = {
    GDO: 'gdo_ui_diretta',
    CONFERME: 'conferme_ui_diretta',
    // Veste dell'admin: cornice scura e centro di controllo (PO 25/10/2026).
    ADMIN: 'admin_ui_diretta',
} as const

export type RuoloDiretta = keyof typeof DIRETTA_FLAG_KEYS
export const RUOLI_DIRETTA = Object.keys(DIRETTA_FLAG_KEYS) as RuoloDiretta[]

/** Chiave dell'interruttore per il ruolo; null per chi non ha la Diretta (venditori, manager, TL). */
export function chiaveInterruttore(role: string | null | undefined): string | null {
    return role === 'GDO' || role === 'CONFERME' || role === 'ADMIN' ? DIRETTA_FLAG_KEYS[role] : null
}

export interface Fascia { start: string; end: string }   // 'HH:MM' ora di Roma, end esclusa

export interface GamificationTargets {
    personale: [number, number]       // fissati al giorno: primo e secondo scalino
    squadra: [number, number]         // fissati di squadra al giorno
    punta: [number, number]           // fissati di squadra nell'ora di punta
    puntaFeriale: Fascia
    puntaSabato: Fascia
    turnoFeriale: Fascia
    turnoSabato: Fascia
    pauseFeriali: Fascia[]
    pauseSabato: Fascia[]
    presenzeObiettivo: number         // presenze a settimana
    presenzeSogliaEuro: number        // le presenze OLTRE questa soglia valgono euro
    euroPerPresenza: number
}

export const DEFAULT_TARGETS: GamificationTargets = {
    personale: [8, 10],
    squadra: [55, 65],
    punta: [14, 20],
    puntaFeriale: { start: '18:00', end: '19:00' },
    // Sabato (PO 25/10/2026 mattina): punta 12:30-13:30, pause 12:00 e 14:15.
    puntaSabato: { start: '12:30', end: '13:30' },
    turnoFeriale: { start: '13:30', end: '20:00' },
    turnoSabato: { start: '10:00', end: '16:30' },
    pauseFeriali: [{ start: '15:30', end: '15:45' }, { start: '17:45', end: '18:00' }],
    pauseSabato: [{ start: '12:00', end: '12:15' }, { start: '14:15', end: '14:30' }],
    presenzeObiettivo: 7,
    presenzeSogliaEuro: 4,
    euroPerPresenza: 12,
}

/** Unisce il JSON salvato ai default: una chiave mancante o malformata non rompe nulla. */
export function parseTargets(raw: string | null | undefined): GamificationTargets {
    if (!raw) return DEFAULT_TARGETS
    try {
        const saved = JSON.parse(raw) as Partial<GamificationTargets>
        return { ...DEFAULT_TARGETS, ...saved }
    } catch {
        return DEFAULT_TARGETS
    }
}

/** Sabato secondo il calendario di Roma. */
export function isSaturdayRome(at: Date): boolean {
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' }).format(at)
    return day === 'Sat'
}

/** Istante assoluto di un orario 'HH:MM' di Roma nel giorno di `at` (gestisce ora legale/solare). */
export function romeTimeOnDay(at: Date, hhmm: string): Date {
    const day = toRomeDateStr(at)
    const probe = new Date(`${day}T12:00:00Z`)
    return new Date(`${day}T${hhmm}:00${romeOffset(probe)}`)
}

export function fasciaBounds(at: Date, f: Fascia): { start: Date; end: Date } {
    return { start: romeTimeOnDay(at, f.start), end: romeTimeOnDay(at, f.end) }
}

/** Ora di punta del giorno di `at`: sabato e feriali hanno fasce diverse; domenica nessuna. */
export function peakWindow(at: Date, t: GamificationTargets): { start: Date; end: Date } | null {
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' }).format(at)
    if (wd === 'Sun') return null
    return fasciaBounds(at, wd === 'Sat' ? t.puntaSabato : t.puntaFeriale)
}

export function shiftWindow(at: Date, t: GamificationTargets): { start: Date; end: Date } | null {
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' }).format(at)
    if (wd === 'Sun') return null
    return fasciaBounds(at, wd === 'Sat' ? t.turnoSabato : t.turnoFeriale)
}

/** Euro maturati in settimana dalle presenze: solo quelle oltre la soglia. */
export function euroFromPresences(presences: number, t: GamificationTargets): number {
    return Math.max(0, presences - t.presenzeSogliaEuro) * t.euroPerPresenza
}

/** Scalino raggiunto (0, 1 o 2) dato un valore e la coppia di soglie. */
export function stepReached(value: number, steps: [number, number]): 0 | 1 | 2 {
    if (value >= steps[1]) return 2
    if (value >= steps[0]) return 1
    return 0
}

/**
 * Membro della squadra: GDO umano attivo con un nome vero. 108 (IA vocale) e
 * 201 (bot) non hanno firstName; l'account di prova (isTest, migr. 0050) ha
 * un nome ma resta fuori. `isTest` è obbligatorio di proposito: chi legge la
 * riga senza la colonna non deve poter far entrare la prova in squadra.
 */
export function isTeamMember(u: { role: string; isActive: boolean; isBot?: boolean | null; isTest: boolean | null; firstName: string | null }): boolean {
    return u.role === 'GDO' && u.isActive && !u.isBot && !u.isTest && !!u.firstName?.trim()
}

/**
 * Chi accumula Scintille e Piume personali: la squadra e il GDO di prova, che
 * ha un registro suo (fissati, scalini, Piume dei suoi lead di prova) ma resta
 * fuori da squadra, classifica, cronaca e forzieri.
 */
export function guadagnaPremiPersonali(u: { role: string; isActive: boolean; isBot?: boolean | null; isTest: boolean | null; firstName: string | null }): boolean {
    return isTeamMember(u) || (u.role === 'GDO' && u.isActive && !u.isBot && u.isTest === true)
}

/** Nome da mostrare: il nome vero se c'è, altrimenti quello storico. */
export function personName(u: { firstName?: string | null; displayName?: string | null; name?: string | null }): string {
    return u.firstName?.trim() || u.displayName || u.name || ''
}
