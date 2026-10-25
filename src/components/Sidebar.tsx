"use client"
import { useAuth } from "@/components/AuthProvider"
import { useSidebar } from "@/components/providers/SidebarProvider"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    Phone, Users, Calendar, LayoutDashboard, Search, LogOut, Upload, Database, Clock,
    UserCog,
    Trophy,
    Store,
    Target,
    Gamepad2,
    FileText,
    X,
    Compass,
    ClipboardList,
    Zap,
    Briefcase,
    Activity,
    PhoneIncoming,
    Calculator,
    Scale,
    CalendarClock,
    Rocket,
    PhoneCall,
    Gift,
    User,
    type LucideIcon,
} from "lucide-react"
import { SerenaMenteLogo } from "@/components/SerenaMenteLogo"
import { isConfermeTl } from "@/lib/confermeTl"

import { useEffect, useState } from "react"
import { getRecallLeads } from "@/app/actions/recallActions"
import { countPendingContactRequests } from "@/app/actions/contactRequestActions"
import { getDirettaRichiamiScaduti } from "@/app/actions/direttaActions"
import { onBusEvent } from "@/lib/realtimeBus"
import { createClient } from "@/utils/supabase/client"
import { MENU_GDO_DIRETTA, MENU_GDO_DIRETTA_PERSONALE, menuAdminDiretta, type VoceGruppo } from "@/components/diretta/menu"

type NavItem = {
    name: string
    href: string
    icon: any
    badge?: number
    gamification?: boolean
}

type NavGroup = {
    label: string
    items: NavItem[]
}

export function Sidebar({ companyId, salesPipelineEnabled, lancioUmaniEnabled, diretta = false, ruolo }: {
    companyId?: string
    salesPipelineEnabled?: boolean
    lancioUmaniEnabled?: boolean
    /** Diretta accesa per il ruolo (dal layout, lato server: niente lampo della veste vecchia). */
    diretta?: boolean
    ruolo?: string
}) {
    const pathname = usePathname()
    const { isOpen, close } = useSidebar()
    const { user: authUser, isLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    // Con la Diretta il ruolo arriva già dal layout (stessi metadati, lato
    // server): il menu c'è subito, senza aspettare la sessione nel browser.
    const role = session?.user?.role ?? (diretta ? ruolo : undefined)
    const [expiredCount, setExpiredCount] = useState(0)
    const [contactPending, setContactPending] = useState(0)
    const supabase = createClient()
    const handleSignOut = async () => {
        // Azzera la selezione azienda (cookie HttpOnly) per non farla ereditare
        // al prossimo login sullo stesso browser.
        await fetch('/api/company/select', { method: 'DELETE' }).catch(() => { })
        await supabase.auth.signOut()
        window.location.href = "/login"
    }

    useEffect(() => {
        if (diretta) return
        getRecallLeads().then(data => {
            setExpiredCount(data.expired.length)
        }).catch(() => { })
    }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

    // Diretta: al GDO basta il numero dei richiami scaduti, un conteggio su indice.
    useEffect(() => {
        if (!diretta || ruolo !== 'GDO') return
        getDirettaRichiamiScaduti().then(setExpiredCount).catch(() => { })
    }, [pathname, diretta, ruolo])

    // Pallino rosso su "Ti hanno cercato" / "Richieste di Contatto".
    //
    // La campanella suona una volta e poi si legge; il pallino resta finché il
    // lavoro non è fatto. È la differenza che serviva: delle 53 richieste
    // storiche ne era stata lavorata UNA, pur essendo tutte notificate.
    //
    // Tre sorgenti di aggiornamento, nessuna delle quali interroga il DB a vuoto:
    //  - il cambio pagina, come già fa expiredCount;
    //  - una notifica in arrivo sul bus (una richiesta NUOVA fa nascere una
    //    notifica): il pallino compare senza ricaricare;
    //  - l'evento window che la pagina della coda emette quando qualcuno prende
    //    in carico o chiude: il pallino cala subito anche per gli altri.
    // Deliberatamente NON ascoltiamo il topic `leads`: rimbalza a ogni update di
    // qualunque lead dell'azienda, e ne pagheremmo una query di conteggio ognuna.
    useEffect(() => {
        if (role !== 'CONFERME' && role !== 'ADMIN') return
        let alive = true
        const refresh = () => {
            countPendingContactRequests()
                .then(n => { if (alive) setContactPending(n) })
                .catch(() => { })
        }
        refresh()
        const offBus = onBusEvent('notifications', (payload: { row?: { type?: string } }) => {
            if (payload?.row?.type === 'bot_contatto_umano' || payload?.row?.type === 'contatto_umano_assegnato') refresh()
        })
        window.addEventListener('contact-requests-changed', refresh)
        return () => {
            alive = false
            offBus()
            window.removeEventListener('contact-requests-changed', refresh)
        }
    }, [pathname, role])

    // Close sidebar on route change (mobile)
    useEffect(() => {
        close()
    }, [pathname, close])

    // Label store brand-aware (Serenamente non deve mostrare "Fenice Store")
    const storeLabel = companyId === 'serenamente' ? "SerenaMente Store" : "Fenice Store"

    let navItems: NavItem[] = []
    let navGroups: NavGroup[] | null = null

    if (role === "GDO") {
        navItems = [
            { name: "La mia Pipeline", href: "/", icon: Phone },
            { name: "I miei Richiami", href: "/richiami", icon: Calendar, badge: expiredCount },
            { name: "I miei Appuntamenti", href: "/appuntamenti", icon: Users },
            { name: "Le mie Performance", href: "/kpi-gdo", icon: LayoutDashboard },
            // Solo ai GDO del test lancio umani (PO 06/10/2026): per gli altri
            // la pagina sarebbe vuota, quindi la voce non compare.
            ...(lancioUmaniEnabled ? [{ name: "Test lancio umani", href: "/lancio-umani", icon: Rocket }] : []),
            { name: "Storico Pause", href: "/storico-pause", icon: Clock },
            { name: "Il mio Profilo", href: "/profilo", icon: Gamepad2, gamification: true },
            { name: "Classifica", href: "/classifica", icon: Trophy, gamification: true },
            { name: storeLabel, href: "/store", icon: Store, gamification: true },
        ]
    } else if (role === "CONFERME") {
        navItems = [
            { name: "Dashboard Conferme", href: "/conferme", icon: Calendar },
            { name: "Calendari Venditori", href: "/calendari-venditori", icon: CalendarClock },
            // Stessa coda dell'admin, fetta diversa: alle Conferme arrivano solo
            // i lead già appuntati, che da quel momento sono di loro competenza.
            { name: "Ti hanno cercato", href: "/richieste-contatto", icon: PhoneIncoming, badge: contactPending },
            // Panoramica TL + dashboard direzionali: solo per il TL del team Conferme (Alberto).
            ...(isConfermeTl(session?.user?.email) ? [
                { name: "Panoramica TL", href: "/conferme/panoramica-tl", icon: Compass },
                { name: "Sales Manager", href: "/panoramica-generale", icon: Compass },
                // Swap PO 2026-07-17: al TL Conferme serve il Monitor Vendite
                // (appuntamenti/follow-up operativi), non Performance Venditori.
                { name: "Monitor Vendite", href: "/monitor-vendite", icon: Trophy },
                { name: "Qualità Lead (Sondaggi)", href: "/qualita-lead", icon: ClipboardList },
            ] : []),
            { name: "KPI Conferme", href: "/kpi-conferme", icon: LayoutDashboard },
            { name: "Analytics Staffing", href: "/conferme/analytics", icon: LayoutDashboard },
            { name: "Il mio Profilo", href: "/profilo", icon: Gamepad2, gamification: true },
            { name: "Classifica", href: "/classifica", icon: Trophy, gamification: true },
            { name: storeLabel, href: "/store", icon: Store, gamification: true },
        ]
    } else if (role === "VENDITORE") {
        navItems = [
            { name: "Dashboard Vendite", href: "/venditore", icon: LayoutDashboard },
            // Serata di lancio (PO 05/10/2026): chiamate subito + appuntamenti del mattino.
            { name: "Lead del lancio", href: "/lead-lancio", icon: Rocket },
            // Solo per il venditore su cui la pipeline autonoma e' accesa oggi:
            // per chiunque altro la pagina rediriga alla home, ma la voce non
            // deve nemmeno comparire (sarebbe un difetto visibile).
            ...(salesPipelineEnabled ? [{ name: "La mia pipeline", href: "/mia-pipeline", icon: PhoneCall }] : []),
            { name: "Il mio Calendario", href: "/mio-calendario", icon: CalendarClock },
            { name: "Portafoglio Clienti", href: "/portafoglio-clienti", icon: Briefcase },
            { name: "I miei incassi", href: "/miei-incassi", icon: Briefcase },
        ]
    } else if (role === "TL") {
        // TL GDO: sezioni legate ai GDO + dashboard Sales Manager e tutte le
        // viste lead/GDO (accesso pieno, decisione PO 2026-07-05). Restano
        // escluse le sezioni venditori/conferme/store admin/marketing/team.
        navGroups = [
            {
                label: "GDO",
                items: [
                    { name: "Operativa Team", href: "/operativa-team", icon: LayoutDashboard },
                    { name: "KPI GDO", href: "/kpi-gdo", icon: LayoutDashboard },
                    { name: "Performance GDO", href: "/manager-gdo-performance", icon: Trophy },
                    { name: "Richiami", href: "/richiami", icon: Calendar },
                    { name: "Monitor Pause", href: "/monitor-pause", icon: Clock },
                    { name: "Note GDO", href: "/note-gdo", icon: FileText },
                ],
            },
            {
                label: "Sales Manager",
                items: [
                    { name: "Sales Manager", href: "/panoramica-generale", icon: Compass },
                    { name: "Target & Previsioni", href: "/manager-targets", icon: Target },
                    // La pagina del lancio ammette ADMIN, MANAGER e TL: per il
                    // TL e' sola lettura (turni e copertura li scrive l'admin),
                    // ma senza la voce ci arrivava solo chi sapeva l'URL.
                    { name: "Lancio Web Dev", href: "/lancio", icon: Rocket },
                ],
            },
            {
                label: "Operativo",
                items: [
                    { name: "Appuntamenti Oggi", href: "/appuntamenti-oggi", icon: Calendar },
                    { name: "Importa Lead", href: "/import", icon: Upload },
                    { name: "Lead Automatici (AC)", href: "/lead-automatici", icon: Zap },
                    { name: "Archivio Storico", href: "/archivio", icon: Database },
                ],
            },
            {
                label: "Qualità",
                items: [
                    { name: "Qualità Lead (Sondaggi)", href: "/qualita-lead", icon: ClipboardList },
                    { name: "Analisi Funnel", href: "/analisi-qualita", icon: Search },
                ],
            },
        ]
    } else if (role === "ADMIN" || role === "MANAGER") {
        if (session?.user?.email === "marketing@fenice.local" || session?.user?.name === "Marketing") {
            navItems = [
                { name: "Marketing Analytics", href: "/marketing-analytics", icon: Database },
                { name: "Qualità Lead", href: "/qualita-lead", icon: ClipboardList },
            ]
        } else {
            navGroups = [
                {
                    label: "Direzione",
                    items: [
                        ...(role === "ADMIN" ? [{ name: "Sales Manager", href: "/panoramica-generale", icon: Compass }] : []),
                        ...(role === "ADMIN" ? [{ name: "Incassi", href: "/incassi", icon: Briefcase }] : []),
                        ...(role === "ADMIN" ? [{ name: "Bonus", href: "/bonus", icon: Gift }] : []),
                        { name: "Target & Previsioni", href: "/manager-targets", icon: Target },
                    ],
                },
                {
                    label: "GDO",
                    items: [
                        { name: "KPI GDO", href: "/kpi-gdo", icon: LayoutDashboard },
                        { name: "Performance GDO", href: "/manager-gdo-performance", icon: Trophy },
                        { name: "Operativa Team", href: "/operativa-team", icon: LayoutDashboard },
                        { name: "Note GDO", href: "/note-gdo", icon: FileText },
                        { name: "Monitor Pause", href: "/monitor-pause", icon: Clock },
                        { name: "Statistiche Fissatore", href: "/statistiche-fissatore", icon: Activity },
                        // Coda di smistamento, non una vista di lettura: solo ADMIN.
                        ...(role === "ADMIN" ? [{ name: "Richieste di Contatto", href: "/richieste-contatto", icon: PhoneIncoming, badge: contactPending }] : []),
                    ],
                },
                {
                    label: "Venditori",
                    items: [
                        { name: "KPI Venditori", href: "/kpi-venditori", icon: Trophy },
                        ...(role === "ADMIN" ? [{ name: "Performance Venditori", href: "/performance-venditori", icon: Trophy }] : []),
                        { name: "Monitor Vendite", href: "/monitor-vendite", icon: ClipboardList },
                        { name: "Calendari Venditori", href: "/calendari-venditori", icon: CalendarClock },
                        { name: "Lancio Web Dev", href: "/lancio", icon: Rocket },
                        // PO 06/10/2026: 400 lead del lancio lavorati solo dai GDO 106 e 119.
                        { name: "Test lancio umani", href: "/lancio-umani", icon: Rocket },
                        { name: "Portafoglio Clienti", href: "/portafoglio-clienti", icon: Briefcase },
                        { name: "Pipeline venditore", href: "/pipeline-venditore", icon: PhoneCall },
                    ],
                },
                {
                    label: "Conferme",
                    items: [
                        { name: "Appuntamenti (Conferme)", href: "/conferme", icon: Calendar },
                        { name: "KPI Conferme", href: "/kpi-conferme", icon: LayoutDashboard },
                        { name: "Panoramica TL", href: "/conferme/panoramica-tl", icon: Compass },
                        { name: "Analytics Staffing Conferme", href: "/conferme/analytics", icon: LayoutDashboard },
                    ],
                },
                {
                    label: "Lead & Import",
                    items: [
                        { name: "Appuntamenti Oggi", href: "/appuntamenti-oggi", icon: Calendar },
                        { name: "Importa Lead", href: "/import", icon: Upload },
                        // PO 06/10/2026: ridati dal bot oltre il tetto dei GDO, per l'IA vocale.
                        { name: "Lead per IA vocale", href: "/ia-vocale", icon: PhoneCall },
                        { name: "Lead Automatici (AC)", href: "/lead-automatici", icon: Zap },
                        { name: "Archivio Storico", href: "/archivio", icon: Database },
                        { name: "Richiami", href: "/richiami", icon: Calendar },
                        { name: "Scartati (Marketing)", href: "/scartati", icon: Database },
                    ],
                },
                {
                    label: "Qualità",
                    items: [
                        { name: "Qualità Lead (Sondaggi)", href: "/qualita-lead", icon: ClipboardList },
                        { name: "Analisi Funnel", href: "/analisi-qualita", icon: Search },
                    ],
                },
                {
                    label: "Marketing",
                    items: [
                        { name: "Marketing Analytics", href: "/marketing-analytics", icon: Database },
                    ],
                },
                {
                    label: "Gamification",
                    items: [
                        // Interruttori e obiettivi della Diretta, bonus e obiettivi
                        // delle Conferme (PO 25/10/2026): solo ADMIN.
                        ...(role === "ADMIN" ? [
                            { name: "Diretta: centro di controllo", href: "/admin/diretta", icon: Target },
                            { name: "Diretta: Conferme", href: "/admin/diretta/conferme", icon: Target },
                        ] : []),
                        { name: "Monitor RPG GDO", href: "/manager-rpg-monitor", icon: Gamepad2 },
                        { name: "Gestione Store", href: "/team/store", icon: Store },
                    ],
                },
                {
                    label: "Team",
                    items: [
                        { name: "Gestione Account", href: "/team", icon: UserCog },
                        ...(role === "ADMIN" ? [{ name: "Citazioni del giorno", href: "/admin/citazioni", icon: FileText }] : []),
                    ],
                },
                // Ultima voce di tutta la sidebar, e solo ADMIN: oltre al ruolo
                // la pagina chiede una password propria (budget e marginalita').
                ...(role === "ADMIN" ? [{
                    label: "Riservato",
                    items: [
                        { name: "Previsionale", href: "/previsionale", icon: Calculator },
                        { name: "Riconciliazione", href: "/riconciliazione", icon: Scale },
                    ],
                }] : []),
            ]
        }
    }

    // ── Veste Diretta dell'admin (interruttore admin_ui_diretta): scura e sobria,
    // fissa dagli schermi larghi come quella delle Conferme. Le voci sono quelle
    // del menu classico (menuAdminDiretta): centro di controllo in cima, pagine
    // della Diretta nel loro gruppo, nomi dei gruppi senza maiuscolo spaziato.
    if (diretta && ruolo === 'ADMIN') {
        const menu = menuAdminDiretta(navGroups ?? (navItems.length > 0 ? [{ label: '', items: navItems }] : []))
        const voce = (item: VoceGruppo) => {
            const attiva = pathname === item.href
            return (
                <Link
                    key={item.href}
                    href={item.href}
                    aria-current={attiva ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${attiva ? 'bg-[#262626] font-medium text-[#F2F2F2]' : 'text-[#BFBFBF] hover:text-[#F2F2F2]'}`}
                >
                    <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                    <span className="min-w-0 truncate">{item.name}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                        <span className="ml-auto text-[13px] font-semibold tabular-nums text-[#FF9330]">{item.badge}</span>
                    )}
                </Link>
            )
        }
        return (
            <>
                {/* Sopra la barra in alto (z-40): aperto, il menu non resta sotto la barra. */}
                {isOpen && (
                    <div className="fixed inset-0 z-[45] bg-black/60 lg:hidden" onClick={close} />
                )}
                <aside
                    aria-label="Menu"
                    className={`fixed inset-y-0 left-0 z-50 flex h-screen w-72 flex-col border-r-2 border-[#262626] bg-[#171717] font-[family-name:var(--font-poppins)] text-[#F2F2F2] transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:z-auto lg:w-64 lg:translate-x-0`}
                >
                    <div className="flex h-16 shrink-0 items-center justify-between px-5">
                        <Link href="/admin/diretta" className="flex items-center gap-2.5">
                            <span aria-hidden="true" className="h-6 w-6 rounded-lg bg-[#FF9330]" />
                            <span className="text-[16px] font-semibold">Fenice</span>
                        </Link>
                        <button
                            type="button"
                            onClick={close}
                            aria-label="Chiudi il menu"
                            className="rounded-lg p-1.5 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2] lg:hidden"
                        >
                            <X className="h-5 w-5" strokeWidth={1.5} />
                        </button>
                    </div>
                    <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
                        <div className="space-y-1">{voce(menu.centro)}</div>
                        {menu.gruppi.map(g => (
                            <div key={g.label || 'voci'} className="mt-3 border-t-2 border-[#262626] pt-3">
                                {g.label && <div className="px-3 pb-1.5 text-[13px] font-medium text-[#BFBFBF]">{g.label}</div>}
                                <div className="space-y-0.5">{g.items.map(voce)}</div>
                            </div>
                        ))}
                    </nav>
                    <div className="border-t-2 border-[#262626] p-3">
                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]"
                        >
                            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} />
                            Esci
                        </button>
                    </div>
                </aside>
            </>
        )
    }

    // ── Veste Diretta (GDO e Conferme con l'interruttore acceso): scura e sobria.
    // Il GDO sugli schermi larghi (da 2xl, 1536 px) ha il menu nella barra in
    // alto, quindi qui la sidebar resta solo come menu a scomparsa; le Conferme
    // la tengono fissa. Il profilo resta raggiungibile anche dall'avatar.
    if (diretta && (ruolo === 'GDO' || ruolo === 'CONFERME')) {
        const gdo = ruolo === 'GDO'
        type VoceDiretta = { name: string; href: string; icon: LucideIcon; badge?: number }
        const voci: VoceDiretta[] = gdo
            ? MENU_GDO_DIRETTA.map(v => ({ ...v, badge: v.richiami ? expiredCount : undefined }))
            : navItems.map(v => v.href === '/classifica' ? { ...v, name: 'Squadra' }
                : v.href === '/store' ? { ...v, name: 'Negozio' }
                : v.href === '/profilo' ? { ...v, name: 'Il mio profilo', icon: User }
                : v)
        const personali: VoceDiretta[] = gdo ? MENU_GDO_DIRETTA_PERSONALE : []
        const voce = (item: VoceDiretta) => {
            const attiva = pathname === item.href
            return (
                <Link
                    key={item.href}
                    href={item.href}
                    aria-current={attiva ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] transition-colors ${attiva ? 'bg-[#262626] font-medium text-[#F2F2F2]' : 'text-[#BFBFBF] hover:text-[#F2F2F2]'}`}
                >
                    <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                    <span className="min-w-0 truncate">{item.name}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                        <span className="ml-auto text-[13px] font-semibold tabular-nums text-[#FF9330]">{item.badge}</span>
                    )}
                </Link>
            )
        }
        return (
            <>
                {isOpen && (
                    <div className={`fixed inset-0 z-30 bg-black/60 ${gdo ? '2xl:hidden' : 'lg:hidden'}`} onClick={close} />
                )}
                <aside
                    aria-label="Menu"
                    className={`fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-col border-r-2 border-[#262626] bg-[#171717] text-[#F2F2F2] transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} ${gdo ? '2xl:hidden' : 'lg:relative lg:z-auto lg:w-60 lg:translate-x-0'}`}
                >
                    <div className="flex h-16 shrink-0 items-center justify-between px-5">
                        <Link href={gdo ? '/' : '/conferme'} className="flex items-center gap-2.5">
                            <span aria-hidden="true" className="h-6 w-6 rounded-lg bg-[#FF9330]" />
                            <span className="text-[16px] font-semibold">Fenice</span>
                        </Link>
                        <button
                            type="button"
                            onClick={close}
                            aria-label="Chiudi il menu"
                            className={`rounded-lg p-1.5 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2] ${gdo ? '2xl:hidden' : 'lg:hidden'}`}
                        >
                            <X className="h-5 w-5" strokeWidth={1.5} />
                        </button>
                    </div>
                    <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
                        <div className="space-y-1">{voci.map(voce)}</div>
                        {personali.length > 0 && (
                            <div className="mt-3 space-y-1 border-t-2 border-[#262626] pt-3">{personali.map(voce)}</div>
                        )}
                    </nav>
                    <div className="border-t-2 border-[#262626] p-3">
                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]"
                        >
                            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} />
                            Esci
                        </button>
                    </div>
                </aside>
            </>
        )
    }

    return (
        <>
            {/* Mobile backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
                    onClick={close}
                />
            )}

            <aside
                className={`flex flex-col h-screen bg-gradient-gaming-sidebar text-white custom-scrollbar fixed inset-y-0 left-0 z-40 w-72 transition-transform duration-300 ease-out ${isOpen ? "translate-x-0" : "-translate-x-full"} lg:relative lg:z-auto lg:w-64 lg:translate-x-0 lg:border-r lg:border-[var(--color-gaming-border)]`}
            >
                {/* Logo */}
                <div className="p-5 flex items-center justify-between">
                    {companyId === 'serenamente' ? (
                        <SerenaMenteLogo />
                    ) : (
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-orange to-fire-500 flex items-center justify-center font-bold text-brand-charcoal sidebar-logo-pulse text-sm">
                                F
                            </div>
                            <span className="font-semibold text-base text-white tracking-wide">Fenice CRM</span>
                        </div>
                    )}
                    <button
                        onClick={close}
                        className="lg:hidden p-1.5 rounded-md text-ash-400 hover:text-white hover:bg-white/10 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Gradient divider */}
                <div className="mx-4 h-px bg-gradient-to-r from-transparent via-[var(--color-gaming-border-hover)] to-transparent" />

                {/* Navigation */}
                <nav className="flex-1 px-3 mt-4 space-y-1 overflow-y-auto pb-4 custom-scrollbar">
                    {navGroups ? (
                        navGroups.map((group, groupIdx) => {
                            const isGamificationGroup = group.label === "Gamification"
                            return (
                            <div key={group.label}>
                                {groupIdx > 0 && (
                                    isGamificationGroup
                                        ? <div className="sidebar-gamification-separator" />
                                        : <div className="mx-1 my-2 h-px bg-gradient-to-r from-transparent via-[var(--color-gaming-border-hover)] to-transparent" />
                                )}
                                <div className="px-3 pt-3 pb-1.5">
                                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${isGamificationGroup ? "text-[var(--color-gaming-gold-dim)]" : "text-[var(--color-gaming-text-muted)]"}`}>
                                        {group.label}
                                    </span>
                                </div>
                                {group.items.map((item) => {
                                    const isActive = pathname === item.href
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`group flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200 ${isActive
                                                ? "sidebar-item-active text-white font-medium border border-[var(--color-gaming-border)]"
                                                : "sidebar-item-hover text-ash-400 hover:text-white"
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <item.icon className={`sidebar-icon h-[18px] w-[18px] transition-all duration-200 ${isActive ? "text-fire-400 drop-shadow-[0_0_6px_rgba(255,107,26,0.5)]" : "text-[var(--color-gaming-text-muted)]"}`} />
                                                <span className="text-sm">{item.name}</span>
                                            </div>
                                            {item.badge !== undefined && item.badge > 0 && (
                                                <span className="bg-ember-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse shadow-glow-ember">
                                                    {item.badge}
                                                </span>
                                            )}
                                        </Link>
                                    )
                                })}
                            </div>
                        )})
                    ) : (
                        navItems.map((item, idx) => {
                            const isActive = pathname === item.href
                            const showGamificationSep = item.gamification && (idx === 0 || !navItems[idx - 1]?.gamification)
                            return (
                                <div key={item.href}>
                                    {showGamificationSep && (
                                        <div className="sidebar-gamification-separator" />
                                    )}
                                    <Link
                                        href={item.href}
                                        className={`group flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 ${isActive
                                            ? "sidebar-item-active text-white font-medium border border-[var(--color-gaming-border)]"
                                            : "sidebar-item-hover text-ash-400 hover:text-white"
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <item.icon className={`sidebar-icon h-[18px] w-[18px] transition-all duration-200 ${isActive ? "text-fire-400 drop-shadow-[0_0_6px_rgba(255,107,26,0.5)]" : "text-[var(--color-gaming-text-muted)]"}`} />
                                            <span className="text-sm">{item.name}</span>
                                        </div>
                                        {item.badge !== undefined && item.badge > 0 && (
                                            <span className="bg-ember-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse shadow-glow-ember">
                                                {item.badge}
                                            </span>
                                        )}
                                    </Link>
                                </div>
                            )
                        })
                    )}
                </nav>

                {/* Bottom divider */}
                <div className="mx-4 h-px bg-gradient-to-r from-transparent via-[var(--color-gaming-border-hover)] to-transparent" />

                {/* Sign out */}
                <div className="p-3">
                    <button
                        onClick={handleSignOut}
                        className="flex items-center gap-3 px-3 py-2.5 w-full text-left rounded-lg text-[var(--color-gaming-text-muted)] hover:text-ember-300 hover:bg-[var(--color-gaming-bg-card)] transition-all duration-200"
                    >
                        <LogOut className="h-[18px] w-[18px]" />
                        <span className="text-sm">Disconnetti</span>
                    </button>
                </div>
            </aside>
        </>
    )
}
