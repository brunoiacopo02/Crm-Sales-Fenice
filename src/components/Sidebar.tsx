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
} from "lucide-react"

import { useEffect, useState } from "react"
import { getRecallLeads } from "@/app/actions/recallActions"
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

export function Sidebar() {
    const pathname = usePathname()
    const { isOpen, close } = useSidebar()
    const { user: authUser, isLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const role = session?.user?.role
    const [expiredCount, setExpiredCount] = useState(0)
    const supabase = createClient()
    const handleSignOut = async () => {
        await supabase.auth.signOut()
        window.location.href = "/login"
    }

    useEffect(() => {
        getRecallLeads().then(data => {
            setExpiredCount(data.expired.length)
        }).catch(() => { })
    }, [pathname])

    // Close sidebar on route change (mobile)
    useEffect(() => {
        close()
    }, [pathname, close])

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
            { name: "Fenice Store", href: "/store", icon: Store, gamification: true },
        ]
    } else if (role === "CONFERME") {
        navItems = [
            { name: "Dashboard Conferme", href: "/conferme", icon: Calendar },
            { name: "KPI Conferme", href: "/kpi-conferme", icon: LayoutDashboard },
            { name: "Il mio Profilo", href: "/profilo", icon: Gamepad2, gamification: true },
            { name: "Classifica", href: "/classifica", icon: Trophy, gamification: true },
            { name: "Fenice Store", href: "/store", icon: Store, gamification: true },
        ]
    } else if (role === "VENDITORE") {
        navItems = [
            { name: "Dashboard Vendite", href: "/venditore", icon: LayoutDashboard },
            { name: "Il mio Profilo", href: "/profilo", icon: Gamepad2 },
            { name: "Classifica", href: "/classifica", icon: Trophy },
            { name: "Fenice Store", href: "/store", icon: Store },
        ]
    } else if (role === "ADMIN" || role === "MANAGER") {
        if (session?.user?.email === "marketing@fenice.local" || session?.user?.name === "Marketing") {
            navItems = [
                { name: "Marketing Analytics", href: "/marketing-analytics", icon: Database },
            ]
        } else {
            navGroups = [
                {
                    label: "Operativo",
                    items: [
                        { name: "Dashboard Operativa", href: "/team", icon: UserCog },
                        { name: "Appuntamenti Oggi", href: "/appuntamenti-oggi", icon: Calendar },
                        { name: "Appuntamenti (Conferme)", href: "/conferme", icon: Calendar },
                        { name: "Monitor Pause", href: "/monitor-pause", icon: Clock },
                        { name: "Importa Lead", href: "/import", icon: Upload },
                        { name: "Archivio Storico", href: "/archivio", icon: Database },
                        { name: "Scartati (Marketing)", href: "/scartati", icon: Database },
                    ],
                },
                {
                    label: "KPI & Analytics",
                    items: [
                        { name: "KPI Team", href: "/kpi-team", icon: LayoutDashboard },
                        { name: "KPI GDO", href: "/kpi-gdo", icon: LayoutDashboard },
                        { name: "KPI Venditori", href: "/kpi-venditori", icon: Trophy },
                        { name: "KPI Conferme", href: "/kpi-conferme", icon: LayoutDashboard },
                        { name: "Marketing Analytics", href: "/marketing-analytics", icon: Database },
                        { name: "Analisi Qualità", href: "/analisi-qualita", icon: Search },
                        { name: "Performance GDO", href: "/manager-gdo-performance", icon: Trophy },
                    ],
                },
                {
                    label: "Team & HR",
                    items: [
                        { name: "Target & Previsioni", href: "/manager-targets", icon: Target },
                        { name: "Note GDO", href: "/note-gdo", icon: FileText },
                    ],
                },
                {
                    label: "Gamification",
                    items: [
                        { name: "Monitor RPG GDO", href: "/manager-rpg-monitor", icon: Gamepad2 },
                        { name: "Gestione Store", href: "/team/store", icon: Store },
                    ],
                },
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
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-orange to-fire-500 flex items-center justify-center font-bold text-brand-charcoal sidebar-logo-pulse text-sm">
                            F
                        </div>
                        <span className="font-semibold text-base text-white tracking-wide">Fenice CRM</span>
                    </div>
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
