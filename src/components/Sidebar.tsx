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
} from "lucide-react"
import { SerenaMenteLogo } from "@/components/SerenaMenteLogo"
import { isConfermeTl } from "@/lib/confermeTl"

import { useEffect, useState } from "react"
import { getRecallLeads } from "@/app/actions/recallActions"
import { countPendingContactRequests } from "@/app/actions/contactRequestActions"
import { onBusEvent } from "@/lib/realtimeBus"
import { createClient } from "@/utils/supabase/client"

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

export function Sidebar({ companyId }: { companyId?: string }) {
    const pathname = usePathname()
    const { isOpen, close } = useSidebar()
    const { user: authUser, isLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const role = session?.user?.role
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
        getRecallLeads().then(data => {
            setExpiredCount(data.expired.length)
        }).catch(() => { })
    }, [pathname])

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
            { name: "Storico Pause", href: "/storico-pause", icon: Clock },
            { name: "Il mio Profilo", href: "/profilo", icon: Gamepad2, gamification: true },
            { name: "Classifica", href: "/classifica", icon: Trophy, gamification: true },
            { name: storeLabel, href: "/store", icon: Store, gamification: true },
        ]
    } else if (role === "CONFERME") {
        navItems = [
            { name: "Dashboard Conferme", href: "/conferme", icon: Calendar },
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
            { name: "Portafoglio Clienti", href: "/portafoglio-clienti", icon: Briefcase },
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
                        { name: "Portafoglio Clienti", href: "/portafoglio-clienti", icon: Briefcase },
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
                        { name: "Monitor RPG GDO", href: "/manager-rpg-monitor", icon: Gamepad2 },
                        { name: "Gestione Store", href: "/team/store", icon: Store },
                    ],
                },
                {
                    label: "Team",
                    items: [
                        { name: "Gestione Account", href: "/team", icon: UserCog },
                    ],
                },
                // Ultima voce di tutta la sidebar, e solo ADMIN: oltre al ruolo
                // la pagina chiede una password propria (budget e marginalita').
                ...(role === "ADMIN" ? [{
                    label: "Riservato",
                    items: [
                        { name: "Previsionale", href: "/previsionale", icon: Calculator },
                    ],
                }] : []),
            ]
        }
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
