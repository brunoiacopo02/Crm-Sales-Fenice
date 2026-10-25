// Voci di menu della Diretta per il GDO (PO 25/10/2026): le stesse nella barra
// in alto (schermi larghi) e nel menu a scomparsa (schermi stretti). Niente
// creature, avventura, scambi né profilo dei giochi.

import {
    Calendar, CalendarClock, Coins, Gauge, Gift, LayoutDashboard, Phone, Quote, Store, Target, User, Users,
    type LucideIcon,
} from "lucide-react"

export type VoceMenu = { name: string; href: string; icon: LucideIcon; richiami?: boolean }

export const MENU_GDO_DIRETTA: VoceMenu[] = [
    { name: "Pipeline", href: "/", icon: Phone },
    { name: "Richiami", href: "/richiami", icon: CalendarClock, richiami: true },
    { name: "Appuntamenti", href: "/appuntamenti", icon: Calendar },
    { name: "I miei risultati", href: "/kpi-gdo", icon: LayoutDashboard },
    { name: "Squadra", href: "/classifica", icon: Users },
    { name: "Negozio", href: "/store", icon: Store },
]

/**
 * Voci in più del menu a scomparsa. Nella barra in alto il profilo si apre
 * dall'avatar. La pausa nella Diretta non c'è più (PO 25/10/2026).
 */
export const MENU_GDO_DIRETTA_PERSONALE: VoceMenu[] = [
    { name: "Il mio profilo", href: "/profilo", icon: User },
]

// ── Admin ────────────────────────────────────────────────────────────────
//
// Il menu dell'admin nella Diretta è quello classico (Sidebar.tsx), con tre
// differenze: il centro di controllo in cima, le pagine della Diretta in un
// gruppo loro, e i nomi scritti come si scrivono in italiano. Si ricava da
// quello classico, così una voce nuova lì compare anche qui.

export type VoceGruppo = { name: string; href: string; icon: LucideIcon; badge?: number }
export type GruppoMenu = { label: string; items: VoceGruppo[] }

export const VOCE_CENTRO_DIRETTA: VoceGruppo = { name: "Centro di controllo", href: "/admin/diretta", icon: Gauge }

/** Le pagine della Diretta per l'admin, nel gruppo che nel menu classico si chiama Gamification. */
export const MENU_ADMIN_DIRETTA: VoceGruppo[] = [
    { name: "Citazioni del giorno", href: "/admin/citazioni", icon: Quote },
    { name: "Premi del negozio", href: "/admin/premi", icon: Gift },
    { name: "Registro delle monete", href: "/admin/diretta/registro", icon: Coins },
    { name: "Bonus e obiettivi Conferme", href: "/admin/diretta/conferme", icon: Target },
    { name: "Pagina Squadra", href: "/classifica", icon: Users },
]

/**
 * Voci del menu classico che nella Diretta non compaiono: la vecchia
 * gamification (ferma, src/lib/economy/legacy.ts) e le voci della Diretta che
 * qui hanno il loro posto.
 */
const FUORI_DAL_MENU_DIRETTA = new Set(["/manager-rpg-monitor", "/team/store"])

const GRUPPI: Record<string, string> = {
    "Lead & Import": "Lead e import",
    "Gamification": "Diretta",
}

const NOMI: Record<string, string> = {
    "/manager-targets": "Target e previsioni",
    "/operativa-team": "Operativa team",
    "/monitor-pause": "Monitor pause",
    "/statistiche-fissatore": "Statistiche fissatore",
    "/richieste-contatto": "Richieste di contatto",
    "/kpi-venditori": "KPI venditori",
    "/performance-venditori": "Performance venditori",
    "/monitor-vendite": "Monitor vendite",
    "/calendari-venditori": "Calendari venditori",
    "/portafoglio-clienti": "Portafoglio clienti",
    "/conferme/analytics": "Analytics staffing Conferme",
    "/appuntamenti-oggi": "Appuntamenti di oggi",
    "/import": "Importa lead",
    "/lead-automatici": "Lead automatici (AC)",
    "/archivio": "Archivio storico",
    "/scartati": "Scartati (marketing)",
    "/qualita-lead": "Qualità lead (sondaggi)",
    "/analisi-qualita": "Analisi funnel",
    "/marketing-analytics": "Marketing analytics",
    "/team": "Gestione account",
}

const DELLA_DIRETTA = new Set([VOCE_CENTRO_DIRETTA.href, ...MENU_ADMIN_DIRETTA.map(v => v.href)])

/**
 * Menu dell'admin nella Diretta, ricavato dai gruppi del menu classico: il
 * centro di controllo va in cima, le pagine della Diretta nel gruppo Diretta,
 * la vecchia gamification resta fuori e i gruppi vuoti spariscono.
 */
export function menuAdminDiretta(gruppi: GruppoMenu[]): { centro: VoceGruppo; gruppi: GruppoMenu[] } {
    const out: GruppoMenu[] = []
    for (const g of gruppi) {
        const label = GRUPPI[g.label] ?? g.label
        const diretta = label === "Diretta"
        const items = diretta
            ? MENU_ADMIN_DIRETTA
            : g.items
                .filter(v => !FUORI_DAL_MENU_DIRETTA.has(v.href) && !DELLA_DIRETTA.has(v.href))
                .map(v => ({ ...v, name: NOMI[v.href] ?? v.name }))
        if (items.length > 0) out.push({ label, items })
    }
    // Senza il gruppo Gamification nel menu classico le pagine della Diretta
    // restano raggiungibili (a menu non ancora letto, solo il centro).
    if (gruppi.length > 0 && !out.some(g => g.label === "Diretta")) out.push({ label: "Diretta", items: MENU_ADMIN_DIRETTA })
    return { centro: VOCE_CENTRO_DIRETTA, gruppi: out }
}
