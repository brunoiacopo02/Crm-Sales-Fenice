"use client"
import { useAuth } from "@/components/AuthProvider"
import { useSidebar } from "@/components/providers/SidebarProvider"
import Image from "next/image"
import { Search, Bell, X, Phone, User, Trophy, Menu } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { searchLeads, SearchResult } from "@/app/actions/searchActions"
import { usePathname, useRouter } from "next/navigation"
import dynamic from "next/dynamic"

const ContactDrawer = dynamic(
  () => import("./ContactDrawer").then(mod => mod.ContactDrawer),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { PauseTimer } from "./PauseTimer"
import { getUnreadNotifications, markNotificationsAsRead, markAllNotificationsAsRead } from "@/app/actions/notificationActions"
import { getUserWalletCoins, getUserLevelProgress } from "@/app/actions/sprintActions"
import { getEquippedSkinCss } from "@/app/actions/shopActions"
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications"
import { getAnimationsEnabled, type RewardEarnedDetail } from "@/lib/animationUtils"

export function Topbar() {
    const { toggle } = useSidebar()
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
    const [displayedCoins, setDisplayedCoins] = useState(0)
    const [skinCss, setSkinCss] = useState<string | null>(null)
    const prevNotifIdsRef = useRef<Set<string>>(new Set())
    const [floatingCoins, setFloatingCoins] = useState<{ id: number; amount: number }[]>([])
    const floatingIdRef = useRef(0)
    const [coinBounce, setCoinBounce] = useState(false)
    const [levelProgress, setLevelProgress] = useState<{ level: number; progressPercent: number; remainingXp: number; targetXp: number } | null>(null)
    const isGamificationRole = session?.user?.role === "GDO" || session?.user?.role === "CONFERME"

    useEffect(() => {
        if (session?.user?.id) {
            getUserWalletCoins(session.user.id).then(c => { setWalletCoins(c); setDisplayedCoins(c); }).catch(console.error)
            getEquippedSkinCss(session.user.id).then(setSkinCss).catch(console.error)
            if (isGamificationRole) {
                getUserLevelProgress(session.user.id).then(p => { if (p) setLevelProgress(p); }).catch(console.error)
            }
        }
    }, [session?.user?.id, isGamificationRole])

    // Count-up animation when walletCoins changes
    useEffect(() => {
        if (walletCoins === displayedCoins) return
        if (!getAnimationsEnabled()) { setDisplayedCoins(walletCoins); return; }
        const diff = walletCoins - displayedCoins
        const steps = Math.min(Math.abs(diff), 20)
        const stepSize = diff / steps
        let step = 0
        const interval = setInterval(() => {
            step++
            if (step >= steps) { setDisplayedCoins(walletCoins); clearInterval(interval); return; }
            setDisplayedCoins(prev => Math.round(prev + stepSize))
        }, 30)
        return () => clearInterval(interval)
    }, [walletCoins]) // eslint-disable-line react-hooks/exhaustive-deps

    // Listen to reward_earned events for +X floating, wallet refresh, and XP bar update
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<RewardEarnedDetail>).detail
            if (detail.coinsGained > 0 && getAnimationsEnabled()) {
                const id = ++floatingIdRef.current
                setFloatingCoins(prev => [...prev, { id, amount: detail.coinsGained }])
                setCoinBounce(true)
                setTimeout(() => setCoinBounce(false), 400)
                setTimeout(() => setFloatingCoins(prev => prev.filter(f => f.id !== id)), 1500)
            }
            // Refresh wallet from server
            if (session?.user?.id) {
                getUserWalletCoins(session.user.id).then(setWalletCoins).catch(console.error)
                getUserLevelProgress(session.user.id).then(p => { if (p) setLevelProgress(p); }).catch(console.error)
            }
        }
        window.addEventListener('reward_earned', handler)
        return () => window.removeEventListener('reward_earned', handler)
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
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-ash-200/60 flex items-center justify-between px-4 lg:px-6 shadow-soft z-30">
            <div className="flex items-center flex-1 min-w-0">
                {/* Mobile hamburger */}
                <button
                    onClick={toggle}
                    className="lg:hidden p-2 -ml-1 mr-2 text-ash-500 hover:text-brand-charcoal hover:bg-ash-100 rounded-lg transition-colors shrink-0"
                >
                    <Menu className="h-5 w-5" />
                </button>

                {session?.user?.role === "GDO" ? (
                    <div className="flex items-center max-w-xl w-full relative" ref={wrapperRef}>
                        <div className="relative w-full">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search className="h-4 w-4 text-ash-400" />
                            </div>
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onFocus={() => {
                                    if (query.trim().length >= 2) setIsOpen(true)
                                }}
                                className="block w-full pl-10 pr-10 py-2 border border-ash-200 rounded-lg leading-5 bg-ash-50/50 placeholder-ash-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange sm:text-sm transition-all duration-200"
                                placeholder="Cerca lead per nome, email o telefono..."
                            />
                            {query && (
                                <button
                                    onClick={handleClear}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-ash-400 hover:text-ash-600 transition-colors"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>

                        {/* Dropdown Results */}
                        {isOpen && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-ash-200 rounded-xl shadow-elevated overflow-hidden z-[100] animate-fade-in">
                                {isSearching ? (
                                    <div className="p-4 text-center text-sm text-ash-500">Ricerca in corso...</div>
                                ) : results.length > 0 ? (
                                    <ul className="max-h-96 overflow-y-auto custom-scrollbar">
                                        {results.map(lead => (
                                            <li
                                                key={lead.id}
                                                className="border-b border-ash-100 last:border-0 hover:bg-ash-50 transition-colors cursor-pointer"
                                                onClick={() => handleResultClick(lead.id)}
                                            >
                                                <div className="px-4 py-3 flex items-start justify-between">
                                                    <div>
                                                        <div className="font-medium text-ash-800 text-sm flex items-center gap-1.5">
                                                            <User className="h-3.5 w-3.5 text-ash-400" />
                                                            {lead.name}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1 text-xs text-ash-500">
                                                            <div className="flex items-center gap-1">
                                                                <Phone className="h-3 w-3" />
                                                                {lead.phone}
                                                            </div>
                                                            {lead.email && <div>• {lead.email}</div>}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${lead.statusColor}`}>
                                                            {lead.statusLabel}
                                                        </span>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="p-4 text-center text-sm text-ash-500">Nessun lead trovato</div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex-1" />
                )}
            </div>

            <div className="flex items-center gap-3 lg:gap-5 shrink-0">
                {session?.user?.role === "GDO" && <PauseTimer />}

                {/* Notifications */}
                <div className="relative" ref={notifRef}>
                    <button
                        onClick={() => setIsNotifOpen(!isNotifOpen)}
                        className="p-2 text-ash-400 hover:text-ash-600 hover:bg-ash-100 rounded-lg relative transition-all duration-200"
                    >
                        <Bell className="h-5 w-5" />
                        {notifications.filter(n => n.status === 'unread').length > 0 && (
                            <div className="absolute -top-0.5 -right-0.5 flex items-center justify-center">
                                <div className="absolute inset-0 h-5 w-5 rounded-full bg-gradient-to-br from-ember-400 to-fire-500 topbar-notif-ping opacity-60" />
                                <div className="relative flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-ember-400 to-fire-500 ring-2 ring-white text-[9px] font-bold text-white shadow-gaming-glow-fire topbar-notif-pulse">
                                    {notifications.filter(n => n.status === 'unread').length}
                                </div>
                            </div>
                        )}
                    </button>

                    {isNotifOpen && (
                        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-elevated border border-ash-200/50 overflow-hidden z-[100] animate-fade-in">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-ash-100 bg-ash-50/50">
                                <h3 className="font-semibold text-ash-800 text-sm">Notifiche</h3>
                                {notifications.filter(n => n.status === 'unread').length > 0 && (
                                    <button
                                        onClick={handleMarkAllRead}
                                        className="text-[11px] font-medium text-brand-orange hover:text-brand-orange-600 transition-colors"
                                    >
                                        Segna tutte lette
                                    </button>
                                )}
                            </div>

                            <div className="max-h-[28rem] overflow-y-auto custom-scrollbar">
                                {notifications.length > 0 ? (
                                    <ul className="divide-y divide-ash-100">
                                        {notifications.map(notif => (
                                            <li
                                                key={notif.id}
                                                onClick={() => handleNotifClick(notif)}
                                                className={`p-4 hover:bg-ash-50 transition-colors cursor-pointer group ${notif.status === 'unread' ? 'bg-brand-orange-50/40' : ''}`}
                                            >
                                                <div className="flex gap-3">
                                                    <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${notif.status === 'unread' ? 'bg-brand-orange' : 'bg-transparent'}`} />
                                                    <div>
                                                        <div className="text-sm font-medium text-ash-800 line-clamp-1">{notif.title}</div>
                                                        <div className="text-xs text-ash-500 mt-1 line-clamp-2">{notif.body}</div>
                                                        <div className="text-[10px] text-ash-400 mt-2 font-medium">
                                                            {new Date(notif.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="p-8 text-center flex flex-col items-center justify-center text-ash-400">
                                        <Bell className="h-8 w-8 mb-3 opacity-20" />
                                        <div className="text-sm">Nessuna notifica</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* User section */}
                <div className="flex items-center gap-3 pl-3 lg:pl-4 border-l border-ash-200">
                    {isGamificationRole && (
                        <div className="relative flex items-center gap-1.5 bg-gradient-to-r from-[var(--color-gaming-bg-card)] to-[var(--color-gaming-bg-surface)] text-[var(--color-gaming-gold)] font-bold px-3 py-1.5 rounded-full text-xs shadow-gaming-glow-gold border border-[var(--color-gaming-border-hover)]" title="I tuoi Fenice Coin">
                            <Image
                                src="/assets/store/icon_fenice_coin.png"
                                alt="Fenice Coin"
                                width={16}
                                height={16}
                                className={`object-contain drop-shadow-sm topbar-coin-spin ${coinBounce ? 'topbar-coin-bounce' : ''}`}
                            />
                            <span className="tabular-nums min-w-[2ch] text-center">{displayedCoins}</span>
                            {/* Floating +X coins */}
                            {floatingCoins.map(fc => (
                                <span
                                    key={fc.id}
                                    className="absolute -top-1 right-0 text-[var(--color-gaming-gold)] font-bold text-xs topbar-coin-float pointer-events-none"
                                >
                                    +{fc.amount}
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-col items-end justify-center hidden sm:flex">
                        <div className="text-sm font-medium text-ash-700 leading-tight">
                            {session?.user?.name || "GDO"}
                        </div>
                        {/* Mini XP bar */}
                        {isGamificationRole && levelProgress && (
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] font-bold text-[var(--color-gaming-gold)]">Lv.{levelProgress.level}</span>
                                <div className="w-16 h-1.5 rounded-full bg-ash-200/60 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-[var(--color-fire-500)] to-[var(--color-gaming-gold)] topbar-xp-bar-shimmer transition-all duration-700 ease-out"
                                        style={{ width: `${levelProgress.progressPercent}%` }}
                                    />
                                </div>
                                <span className="text-[9px] text-ash-400 tabular-nums">{Math.round(levelProgress.progressPercent)}%</span>
                            </div>
                        )}
                    </div>
                    <div className="relative">
                        <div className={`h-9 w-9 rounded-full bg-gradient-to-br from-brand-orange to-fire-500 flex items-center justify-center text-white font-bold text-sm shadow-gaming-glow-fire ring-2 ring-fire-400/25 ${skinCss?.includes('skin-avatar') || skinCss?.includes('skin-effect') ? skinCss : ''}`}>
                            {session?.user?.name?.charAt(0) || "U"}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 ring-2 ring-white" />
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
                <div className="fixed bottom-6 right-6 z-50 animate-slide-in-right">
                    <div className="bg-white border-l-4 border-gold-400 rounded-xl shadow-elevated p-4 pr-10 relative max-w-sm mb-4 cursor-pointer"
                        onClick={() => { setLiveToast(null); handleNotifClick(liveToast); }}>
                        <button onClick={(e) => { e.stopPropagation(); setLiveToast(null) }} className="absolute top-2 right-2 text-ash-400 hover:text-ash-600 bg-ash-50 rounded-full p-1 transition-colors">
                            <X className="h-4 w-4" />
                        </button>
                        <div className="flex gap-4 items-center">
                            <div className="h-10 w-10 bg-gradient-to-br from-gold-100 to-brand-orange-100 text-gold-600 rounded-full flex items-center justify-center shrink-0 shadow-soft border border-gold-200">
                                <Bell className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="font-bold text-ash-800 text-sm leading-tight">{liveToast.title}</div>
                                <div className="text-xs text-ash-600 mt-1 leading-snug">{liveToast.body}</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </header>
    )
}
