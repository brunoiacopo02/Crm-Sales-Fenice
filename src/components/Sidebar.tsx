"use client"
import { useAuth } from "@/components/AuthProvider"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    Phone, Users, Calendar, LayoutDashboard, Search, LogOut, Upload, Database, Clock,
    UserCog,
    Trophy,
    Store,
    Target,
    Gamepad2
} from "lucide-react"

import { useEffect, useState } from "react"
import { getRecallLeads } from "@/app/actions/recallActions"
import { createClient } from "@/utils/supabase/client"

type NavItem = {
    name: string
    href: string
    icon: any
    badge?: number
}

export function Sidebar() {
    const pathname = usePathname()
    const { user: authUser, isLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const status = isLoading ? "loading" : (session ? "authenticated" : "unauthenticated");
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
    }, [pathname]) // refresh badge when navigation happens

    let navItems: NavItem[] = []

    if (role === "GDO") {
        navItems = [
            { name: "La mia Pipeline", href: "/", icon: Phone },
            { name: "Il mio Profilo / RPG", href: "/profilo", icon: Gamepad2 },
            { name: "I miei Richiami", href: "/richiami", icon: Calendar, badge: expiredCount },
            { name: "I miei Appuntamenti", href: "/appuntamenti", icon: Users },
            { name: "Classifica", href: "/classifica", icon: Trophy },
            { name: "Fenice Store", href: "/store", icon: Store },
            { name: "Le mie Performance", href: "/kpi-gdo", icon: LayoutDashboard },
        ]
    } else if (role === "CONFERME") {
        navItems = [
            { name: "Dashboard Conferme", href: "/conferme", icon: Calendar },
            { name: "KPI Conferme", href: "/kpi-conferme", icon: LayoutDashboard },
        ]
    } else if (role === "VENDITORE") {
        navItems = [
            { name: "Dashboard Vendite", href: "/venditore", icon: LayoutDashboard },
        ]
    } else if (role === "ADMIN" || role === "MANAGER") {
        if (session?.user?.email === "marketing@fenice.local" || session?.user?.name === "Marketing") {
            navItems = [
                { name: "Marketing Analytics", href: "/marketing-analytics", icon: Database },
            ]
        } else {
            navItems = [
                { name: "Gestione Team", href: "/team", icon: UserCog },
                { name: "Gestione Store", href: "/team/store", icon: Store },
                { name: "Monitor RPG GDO", href: "/manager-rpg-monitor", icon: Gamepad2 },
                { name: "Target & Previsioni", href: "/manager-targets", icon: Target },
                { name: "Performance GDO", href: "/manager-gdo-performance", icon: Trophy },
                { name: "KPI Team GDO", href: "/kpi-team", icon: LayoutDashboard },
                { name: "KPI Venditori", href: "/kpi-venditori", icon: Trophy },
                { name: "Marketing Analytics", href: "/marketing-analytics", icon: Database },
                { name: "Monitor Pause", href: "/monitor-pause", icon: Clock },
                { name: "Analisi Qualità", href: "/analisi-qualita", icon: Search },
                { name: "Importa Lead", href: "/import", icon: Upload },
                { name: "Archivio Storico", href: "/archivio", icon: Database },
                { name: "Scartati (Marketing)", href: "/scartati", icon: Database },
                { name: "Appuntamenti (Conferme)", href: "/conferme", icon: Calendar },
                { name: "KPI Conferme", href: "/kpi-conferme", icon: LayoutDashboard },
            ]
        }
    }

    return (
        <div className="flex flex-col w-64 h-screen bg-brand-charcoal text-white custom-scrollbar border-r border-gray-800">
            <div className="p-6 flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-brand-orange flex items-center justify-center font-bold text-white shadow-lg">
                    F
                </div>
                <span className="font-bold text-xl tracking-wide">Fenice CRM</span>
            </div>

            <div className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto pb-4">
                {navItems.map((item) => {
                    const isActive = pathname === item.href

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${isActive
                                ? "bg-brand-orange text-white font-medium shadow-sm"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <item.icon className={`h-5 w-5 ${isActive ? "text-white" : "text-gray-400"}`} />
                                {item.name}
                            </div>

                            {item.badge !== undefined && item.badge > 0 && (
                                <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse shadow">
                                    {item.badge}
                                </span>
                            )}
                        </Link>
                    )
                })}
            </div>

            <div className="p-4 border-t border-gray-800">
                <button
                    onClick={handleSignOut}
                    className="flex items-center gap-3 px-4 py-3 w-full text-left rounded-lg text-gray-300 hover:bg-gray-800 transition-colors"
                >
                    <LogOut className="h-5 w-5 text-gray-400" />
                    Disconnetti
                </button>
            </div>
        </div >
    )
}
