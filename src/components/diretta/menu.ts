// Voci di menu della Diretta per il GDO (PO 25/10/2026): le stesse nella barra
// in alto (schermi larghi) e nel menu a scomparsa (schermi stretti). Niente
// creature, avventura, scambi né profilo dei giochi.

import {
    Calendar, CalendarClock, Coins, KeyRound, Gauge, Gift, LayoutDashboard, Phone, Quote, Store, Target, User, Users,
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
// Il menu dell'admin nella Rinascita è quello classico (Sidebar.tsx), con
// queste differenze: il centro di controllo in cima, le voci divise in gruppi
// a tendina con un nome che dice di chi sono (Sales Manager, GDO, Conferme…),
// le pagine della gamification nuova nel gruppo Rinascita e i nomi scritti
// come si scrivono in italiano. Si ricava da quello classico, così una voce
// nuova lì compare anche qui.

export type VoceGruppo = { name: string; href: string; icon: LucideIcon; badge?: number }
export type GruppoMenu = { label: string; items: VoceGruppo[] }

export const VOCE_CENTRO_DIRETTA: VoceGruppo = { name: "Centro di controllo", href: "/admin/diretta", icon: Gauge }

/** Nome visibile del gruppo della gamification nuova (PO 25/10/2026: "Rinascita", non "Diretta"). */
export const GRUPPO_RINASCITA = "Rinascita"
export const GRUPPO_AMMINISTRAZIONE = "Amministrazione"

/** Le pagine della Rinascita per l'admin, nel gruppo che nel menu classico si chiama Gamification. */
export const MENU_ADMIN_DIRETTA: VoceGruppo[] = [
    { name: "Citazioni del giorno", href: "/admin/citazioni", icon: Quote },
    { name: "Premi del negozio", href: "/admin/premi", icon: Gift },
    { name: "Registro delle monete", href: "/admin/diretta/registro", icon: Coins },
    { name: "Bonus e obiettivi Conferme", href: "/admin/diretta/conferme", icon: Target },
    { name: "Pagina Squadra", href: "/classifica", icon: Users },
]

/** Voci nuove della Rinascita che stanno con gli account, non con la gamification. */
export const MENU_ADMIN_AMMINISTRAZIONE: VoceGruppo[] = [
    { name: "Accessi del team", href: "/admin/accessi", icon: KeyRound },
]

/**
 * Voci del menu classico che nella Rinascita non compaiono: la vecchia
 * gamification (ferma, src/lib/economy/legacy.ts) e le voci della Rinascita
 * che qui hanno il loro posto.
 */
const FUORI_DAL_MENU_DIRETTA = new Set(["/manager-rpg-monitor", "/team/store"])

/** Gruppo classico → gruppo a tendina. Più gruppi classici possono finire nello stesso. */
const GRUPPI: Record<string, string> = {
    "Direzione": "Sales Manager",
    "Lead & Import": "Lead e import",
    "Qualità": "Marketing",
    "Gamification": GRUPPO_RINASCITA,
    "Team": GRUPPO_AMMINISTRAZIONE,
    "Riservato": GRUPPO_AMMINISTRAZIONE,
}

/** Ordine dei gruppi a tendina; quelli non elencati vanno in fondo, nell'ordine in cui arrivano. */
const ORDINE_GRUPPI = [
    "Sales Manager", "GDO", "Conferme", "Venditori", "Lead e import", "Marketing", GRUPPO_RINASCITA, GRUPPO_AMMINISTRAZIONE,
]

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
    "/conferme": "Appuntamenti delle Conferme",
    "/conferme/analytics": "Analytics staffing",
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

const DELLA_DIRETTA = new Set([
    VOCE_CENTRO_DIRETTA.href,
    ...MENU_ADMIN_DIRETTA.map(v => v.href),
    ...MENU_ADMIN_AMMINISTRAZIONE.map(v => v.href),
])

/** La voce è la pagina corrente o una sua sottopagina (es. /admin/premi/…). */
export function voceAttiva(href: string, pathname: string | null | undefined): boolean {
    if (!pathname) return false
    return pathname === href || (href !== "/" && pathname.startsWith(href + "/"))
}

/**
 * Il gruppo che contiene la pagina corrente (si apre da solo). Vince la voce
 * più lunga: su /conferme/analytics conta "Analytics staffing", non "/conferme".
 */
export function gruppoDellaPagina(gruppi: GruppoMenu[], pathname: string | null | undefined): string | null {
    let migliore: { label: string; lunghezza: number } | null = null
    for (const g of gruppi) {
        for (const v of g.items) {
            if (voceAttiva(v.href, pathname) && (!migliore || v.href.length > migliore.lunghezza)) {
                migliore = { label: g.label, lunghezza: v.href.length }
            }
        }
    }
    return migliore?.label ?? null
}

/**
 * Menu dell'admin nella Rinascita, ricavato dai gruppi del menu classico: il
 * centro di controllo va in cima, le voci nei gruppi a tendina (nell'ordine di
 * ORDINE_GRUPPI), le pagine della gamification nuova nel gruppo Rinascita, la
 * vecchia gamification resta fuori e i gruppi vuoti spariscono.
 */
export function menuAdminDiretta(gruppi: GruppoMenu[]): { centro: VoceGruppo; gruppi: GruppoMenu[] } {
    const perNome = new Map<string, VoceGruppo[]>()
    const aggiungi = (label: string, items: VoceGruppo[]) => {
        const lista = perNome.get(label) ?? []
        for (const v of items) if (!lista.some(x => x.href === v.href)) lista.push(v)
        perNome.set(label, lista)
    }
    for (const g of gruppi) {
        const label = GRUPPI[g.label] ?? g.label
        if (label === GRUPPO_RINASCITA) {
            aggiungi(label, MENU_ADMIN_DIRETTA)
            continue
        }
        aggiungi(label, g.items
            .filter(v => !FUORI_DAL_MENU_DIRETTA.has(v.href) && !DELLA_DIRETTA.has(v.href))
            .map(v => ({ ...v, name: NOMI[v.href] ?? v.name })))
    }
    // A menu non ancora letto (nessun gruppo) c'è solo il centro. Altrimenti le
    // pagine della Rinascita e gli accessi restano raggiungibili anche senza i
    // gruppi Gamification e Team nel menu classico.
    if (gruppi.length > 0) {
        if (!perNome.has(GRUPPO_RINASCITA)) aggiungi(GRUPPO_RINASCITA, MENU_ADMIN_DIRETTA)
        aggiungi(GRUPPO_AMMINISTRAZIONE, MENU_ADMIN_AMMINISTRAZIONE)
    }
    const posto = (label: string) => {
        const i = ORDINE_GRUPPI.indexOf(label)
        return i === -1 ? ORDINE_GRUPPI.length : i
    }
    const out = [...perNome.entries()]
        .map(([label, items], i) => ({ label, items, i }))
        .filter(g => g.items.length > 0)
        .sort((a, b) => posto(a.label) - posto(b.label) || a.i - b.i)
        .map(({ label, items }) => ({ label, items }))
    return { centro: VOCE_CENTRO_DIRETTA, gruppi: out }
}
