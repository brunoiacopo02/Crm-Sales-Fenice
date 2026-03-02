"use client"
import { useAuth } from "@/components/AuthProvider"

import { Search, Bell, X, Phone, User, Trophy } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { searchLeads, SearchResult } from "@/app/actions/searchActions"
import { usePathname, useRouter } from "next/navigation"
import { ContactDrawer } from "./ContactDrawer"
import { PauseTimer } from "./PauseTimer"
import { getUnreadNotifications, markNotificationsAsRead, markAllNotificationsAsRead } from "@/app/actions/notificationActions"
import { getUserWalletCoins } from "@/app/actions/sprintActions"
import { getEquippedSkinCss } from "@/app/actions/shopActions"
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications"

export function Topbar() {
    const { user: authUser, isLoading } = useAuth();
    const session = authUser ? { user: { id: authUser.id, role: authUser.user_metadata?.role, email: authUser.email, name: authUser.user_metadata?.name } } : null;
    const status = isLoading ? "loading" : (session ? "authenticated" : "unauthenticated");
    const pathname = usePathname()

    const [query, setQuery] = useState("")
    const [results, setResults] = useState<SearchResult[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const notifRef = useRef<HTMLDivElement>(null)
    const router = useRouter()

    const { notifications, setNotifications, liveToast, setLiveToast } = useRealtimeNotifications()
    const [isNotifOpen, setIsNotifOpen] = useState(false)
    const [walletCoins, setWalletCoins] = useState(0)
    const [skinCss, setSkinCss] = useState<string | null>(null)
    const prevNotifIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        if (session?.user?.id) {
            getUserWalletCoins(session.user.id).then(setWalletCoins).catch(console.error)
            getEquippedSkinCss(session.user.id).then(setSkinCss).catch(console.error)
        }
    }, [session?.user?.id])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
            if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
                setIsNotifOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const handleNotifClick = async (notif: any) => {
        setIsNotifOpen(false)
        // Mark as read immediately
        await markNotificationsAsRead([notif.id])
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, status: 'read' } : n))

        // Navigate based on type
        const meta = notif.metadata as Record<string, any>
        if (notif.type === 'leaderboard_overtaken') {
            router.push(`/classifica?period=${meta?.period || 'today'}`)
        } else if (notif.type === 'appointment_confirmed' || notif.type === 'sales_outcome_set' || notif.type === 'appointment_assigned') {
            // Se la notifica riguarda un lead, apriamo la drawer cercando globalmente
            if (meta?.leadId) {
                setSelectedLeadId(meta.leadId)
                setIsDrawerOpen(true)
            }
        }
    }

    const handleMarkAllRead = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!session?.user?.id) return
        await markAllNotificationsAsRead(session.user.id)
        setNotifications(prev => prev.map(n => ({ ...n, status: 'read' })))
    }

    useEffect(() => {
        if (query.trim().length < 2) {
            setResults([])
            setIsOpen(false)
            return
        }

        const timer = setTimeout(async () => {
            setIsSearching(true)
            try {
                const data = await searchLeads(query)
                setResults(data)
                setIsOpen(true)
            } catch (e) {
                console.error(e)
            } finally {
                setIsSearching(false)
            }
        }, 300) // 300ms debounce

        return () => clearTimeout(timer)
    }, [query])

    const handleClear = () => {
        setQuery("")
        setResults([])
        setIsOpen(false)
    }

    const handleResultClick = (leadId: string) => {
        setSelectedLeadId(leadId)
        setIsDrawerOpen(true)
        setIsOpen(false)
    }

    return (
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm z-30">
            {session?.user?.role === "GDO" ? (
                <div className="flex items-center max-w-xl w-full relative" ref={wrapperRef}>
                    <div className="relative w-full">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onFocus={() => {
                                if (query.trim().length >= 2) setIsOpen(true)
                            }}
                            className="block w-full pl-10 pr-10 py-2 border border-gray-200 rounded-md leading-5 bg-gray-50 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-brand-orange focus:border-brand-orange sm:text-sm transition-colors"
                            placeholder="Cerca lead per nome, email o telefono..."
                        />
                        {query && (
                            <button
                                onClick={handleClear}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    {/* Dropdown Results */}
                    {isOpen && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                            {isSearching ? (
                                <div className="p-4 text-center text-sm text-gray-500">Ricerca in corso...</div>
                            ) : results.length > 0 ? (
                                <ul className="max-h-96 overflow-y-auto custom-scrollbar">
                                    {results.map(lead => (
                                        <li
                                            key={lead.id}
                                            className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors cursor-pointer"
                                            onClick={() => handleResultClick(lead.id)}
                                        >
                                            <div className="px-4 py-3 flex items-start justify-between">
                                                <div>
                                                    <div className="font-medium text-gray-800 text-sm flex items-center gap-1.5">
                                                        <User className="h-3.5 w-3.5 text-gray-400" />
                                                        {lead.name}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                                                        <span className="flex items-center gap-1">
                                                            <Phone className="h-3 w-3" />
                                                            {lead.phone}
                                                        </span>
                                                        {lead.email && <span>• {lead.email}</span>}
                                                    </div>
                                                </div>
                                                <div>
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${lead.statusColor}`}>
                                                        {lead.statusLabel}
                                                    </span>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="p-4 text-center text-sm text-gray-500">Nessun lead trovato</div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex-1" />
            )}

            <div className="flex items-center gap-6">
                {session?.user?.role === "GDO" && <PauseTimer />}

                <div className="relative" ref={notifRef}>
                    <button
                        onClick={() => setIsNotifOpen(!isNotifOpen)}
                        className="p-2 text-gray-400 hover:text-gray-500 relative transition-colors"
                    >
                        <Bell className="h-6 w-6" />
                        {notifications.filter(n => n.status === 'unread').length > 0 && (
                            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-orange ring-2 ring-white text-[9px] font-bold text-white">
                                {notifications.filter(n => n.status === 'unread').length}
                            </span>
                        )}
                    </button>

                    {isNotifOpen && (
                        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 bg-gray-50/50">
                                <h3 className="font-semibold text-gray-800 text-sm">Notifiche</h3>
                                {notifications.filter(n => n.status === 'unread').length > 0 && (
                                    <button
                                        onClick={handleMarkAllRead}
                                        className="text-[11px] font-medium text-brand-orange hover:text-brand-orange/80 transition-colors"
                                    >
                                        Segna tutte lette
                                    </button>
                                )}
                            </div>

                            <div className="max-h-[28rem] overflow-y-auto custom-scrollbar">
                                {notifications.length > 0 ? (
                                    <ul className="divide-y divide-gray-50">
                                        {notifications.map(notif => (
                                            <li
                                                key={notif.id}
                                                onClick={() => handleNotifClick(notif)}
                                                className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer group ${notif.status === 'unread' ? 'bg-orange-50/30' : ''}`}
                                            >
                                                <div className="flex gap-3">
                                                    <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${notif.status === 'unread' ? 'bg-brand-orange' : 'bg-transparent'}`} />
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-800 line-clamp-1">{notif.title}</p>
                                                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{notif.body}</p>
                                                        <p className="text-[10px] text-gray-400 mt-2 font-medium">
                                                            {new Date(notif.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                        </p>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="p-8 text-center flex flex-col items-center justify-center text-gray-400">
                                        <Bell className="h-8 w-8 mb-3 opacity-20" />
                                        <p className="text-sm">Nessuna notifica</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
                    {session?.user?.role === "GDO" && (
                        <div className="flex items-center gap-1.5 bg-yellow-50 text-yellow-700 font-bold px-2.5 py-1 rounded-full text-xs shadow-sm border border-yellow-200" title="I tuoi Fenice Coin vinti nello Sprint">
                            <img src="/assets/store/icon_fenice_coin.png" alt="Fenice Coin" className="w-4 h-4 object-contain drop-shadow-sm" />
                            {walletCoins}
                        </div>
                    )}

                    <div className="text-sm font-medium text-gray-700">
                        {session?.user?.name || "GDO"}
                    </div>
                    <div className={`h-8 w-8 rounded-full bg-brand-orange flex items-center justify-center text-white font-bold shadow-sm ${skinCss?.includes('skin-avatar') ? skinCss : ''}`}>
                        {session?.user?.name?.charAt(0) || "U"}
                    </div>
                </div>
            </div>

            <ContactDrawer
                isOpen={isDrawerOpen}
                leadId={selectedLeadId}
                onClose={() => setIsDrawerOpen(false)}
            />

            {/* Live Toast Form per eventi Leaderboard Overtaken */}
            {liveToast && (
                <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-right-10 fade-in duration-500">
                    <div className="bg-white border-l-4 border-yellow-500 rounded-xl shadow-2xl p-4 pr-10 relative max-w-sm mb-4 cursor-pointer"
                        onClick={() => { setLiveToast(null); handleNotifClick(liveToast); }}>
                        <button onClick={(e) => { e.stopPropagation(); setLiveToast(null) }} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 bg-gray-50 rounded-full p-1">
                            <X className="h-4 w-4" />
                        </button>
                        <div className="flex gap-4 items-center">
                            <div className="h-10 w-10 bg-gradient-to-br from-yellow-100 to-orange-100 text-yellow-600 rounded-full flex items-center justify-center shrink-0 shadow-sm border border-yellow-200">
                                <Bell className="h-5 w-5" />
                            </div>
                            <div>
                                <h4 className="font-bold text-gray-800 text-sm leading-tight">{liveToast.title}</h4>
                                <p className="text-xs text-gray-600 mt-1 leading-snug">{liveToast.body}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </header>
    )
}
