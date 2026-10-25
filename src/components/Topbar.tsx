"use client"
import { useAuth } from "@/components/AuthProvider"
import { useSidebar } from "@/components/providers/SidebarProvider"
import Image from "next/image"
import Link from "next/link"
import { Search, Bell, X, Phone, User, Trophy, Menu, Sparkles, Feather } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { searchLeads, SearchResult } from "@/app/actions/searchActions"
import { usePathname, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { SalesCompanySwitcher } from '@/components/sales/SalesCompanySwitcher'

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
import { getDirettaRichiamiScaduti, getDirettaSaldo } from "@/app/actions/direttaActions"
import { DIRETTA_APPUNTAMENTO } from "@/lib/diretta/eventi"
import { TIPO_NOTIFICA_APPENA_ARRIVATO } from "@/lib/diretta/notificaArrivo"
import { oraBreve, testoTurno } from "@/lib/diretta/home"
import type { GamificationTargets } from "@/lib/diretta/config"
import type { DirettaIo } from "@/lib/diretta/io"
import { MENU_GDO_DIRETTA } from "@/components/diretta/menu"
import { useOrologio } from "@/components/diretta/useOrologio"
import { numeroIt } from "@/lib/diretta/formato"

type TopbarProps = {
    /** Diretta accesa per il ruolo (dal layout, lato server). */
    diretta?: boolean
    ruolo?: string
    io?: DirettaIo | null
    obiettivi?: GamificationTargets | null
}

export function Topbar({ diretta = false, ruolo, io = null, obiettivi = null }: TopbarProps = {}) {
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
        // Con la Diretta monete, XP e skin vecchie non si mostrano: niente query.
        if (diretta) return
        if (session?.user?.id) {
            getUserWalletCoins(session.user.id).then(c => { setWalletCoins(c); setDisplayedCoins(c); }).catch(console.error)
            getEquippedSkinCss(session.user.id).then(setSkinCss).catch(console.error)
            if (isGamificationRole) {
                getUserLevelProgress(session.user.id).then(p => { if (p) setLevelProgress(p); }).catch(console.error)
            }
        }
    }, [session?.user?.id, isGamificationRole, diretta])

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
            if (session?.user?.id && !diretta) {
                getUserWalletCoins(session.user.id).then(setWalletCoins).catch(console.error)
                getUserLevelProgress(session.user.id).then(p => { if (p) setLevelProgress(p); }).catch(console.error)
            }
        }
        window.addEventListener('reward_earned', handler)
        return () => window.removeEventListener('reward_earned', handler)
    }, [session?.user?.id, diretta])

    // ── Diretta: saldo Scintille e Piume, richiami del menu, orologio ──
    const direttaGdo = diretta && ruolo === 'GDO'
    // L'admin ha la cornice della Diretta ma non guadagna monete: niente saldo.
    const direttaAdmin = diretta && ruolo === 'ADMIN'
    const conSaldo = diretta && !direttaAdmin
    const [saldo, setSaldo] = useState<{ scintille: number; piume: number } | null>(io ? { scintille: io.scintille, piume: io.piume } : null)
    const saldoPrima = useRef(saldo)
    const [guadagno, setGuadagno] = useState<{ testo: string; chiave: number } | null>(null)
    const [richiamiScaduti, setRichiamiScaduti] = useState(0)
    const [cercaAperta, setCercaAperta] = useState(false)
    const cercaRef = useRef<HTMLInputElement>(null)
    const adesso = useOrologio(15_000)

    // Il layout rilegge il saldo a ogni refresh: le props nuove vincono.
    useEffect(() => {
        if (diretta && io) setSaldo({ scintille: io.scintille, piume: io.piume })
    }, [diretta, io?.scintille, io?.piume]) // eslint-disable-line react-hooks/exhaustive-deps

    // "+N" accanto al saldo quando sale.
    useEffect(() => {
        if (!saldo) return
        const p = saldoPrima.current
        if (p) {
            const ds = saldo.scintille - p.scintille
            const dp = saldo.piume - p.piume
            const parti = [ds > 0 ? `+${numeroIt(ds)} Scintille` : null, dp > 0 ? `+${numeroIt(dp)} ${dp === 1 ? 'Piuma' : 'Piume'}` : null].filter(Boolean)
            if (parti.length > 0) setGuadagno({ testo: parti.join(', '), chiave: Date.now() })
        }
        saldoPrima.current = saldo
    }, [saldo])

    useEffect(() => {
        if (!guadagno) return
        const id = setTimeout(() => setGuadagno(null), 1800)
        return () => clearTimeout(id)
    }, [guadagno])

    // Dopo un appuntamento il premio lo scrive il server: si rilegge il saldo.
    // Sulle notifiche (conferme, presenze) al massimo una lettura ogni 10 s.
    useEffect(() => {
        if (!conSaldo) return
        let ultima = 0
        let attesa: ReturnType<typeof setTimeout> | null = null
        const rileggi = () => {
            ultima = Date.now()
            getDirettaSaldo().then(s => { if (s) setSaldo(s) }).catch(() => { })
        }
        const suAppuntamento = () => {
            if (attesa) clearTimeout(attesa)
            attesa = setTimeout(rileggi, 400)
        }
        const suNotifica = () => { if (Date.now() - ultima >= 10_000) rileggi() }
        window.addEventListener(DIRETTA_APPUNTAMENTO, suAppuntamento)
        window.addEventListener('realtime_update', suNotifica)
        return () => {
            if (attesa) clearTimeout(attesa)
            window.removeEventListener(DIRETTA_APPUNTAMENTO, suAppuntamento)
            window.removeEventListener('realtime_update', suNotifica)
        }
    }, [conSaldo])

    // Richiami scaduti per la voce di menu, a ogni cambio pagina.
    useEffect(() => {
        if (!direttaGdo) return
        getDirettaRichiamiScaduti().then(setRichiamiScaduti).catch(() => { })
    }, [direttaGdo, pathname])

    useEffect(() => {
        if (cercaAperta) cercaRef.current?.focus()
    }, [cercaAperta])

    // La ricerca a comparsa si chiude cliccando fuori.
    useEffect(() => {
        if (!cercaAperta) return
        const fuori = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setCercaAperta(false)
        }
        document.addEventListener('mousedown', fuori)
        return () => document.removeEventListener('mousedown', fuori)
    }, [cercaAperta])

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
        } else if (notif.type === 'bot_note') {
            // Le note del bot si leggono nella board Conferme, non nel drawer
            // della ricerca: è lì che l'operatore lavora il lead.
            if (meta?.leadId) router.push(`/conferme?lead=${meta.leadId}&tab=note`)
        } else if (notif.type === 'lancio_appuntamento') {
            // Appuntamento del lancio scelto col bot (pomeriggio/dopodomani) o
            // tornato dal venditore dopo tre NR: le Conferme lo lavorano in board.
            // Stesso deep-link della nota del bot, sul tab Note dove sta il
            // blocco "Dal bot – lancio"; la board carica il lead da sola anche
            // se non è in nessuna lista (ConfermeBoard, pendingDeepLink).
            if (meta?.leadId) router.push(`/conferme?lead=${meta.leadId}&tab=note`)
        } else if (notif.type === 'lancio_call_now') {
            // "Chiamami adesso": chi la riceve è il venditore di turno e il
            // lead si lavora nella sua tab Lancio, non nel drawer della ricerca.
            router.push('/venditore?view=lancio')
        } else if (notif.type === TIPO_NOTIFICA_APPENA_ARRIVATO) {
            // Lead appena arrivato (PO 25/10/2026): si apre il lead, con gli
            // stessi esiti della card, da qualunque coda o pagina sia il GDO.
            if (meta?.leadId) {
                setSelectedLeadId(meta.leadId)
                setIsDrawerOpen(true)
            } else {
                router.push('/')
            }
        } else if (notif.type === 'negozio_richiesta') {
            // Richiesta dal negozio della Diretta: si consegna o si annulla lì.
            router.push('/admin/premi')
        } else if (notif.type === 'appointment_confirmed' || notif.type === 'sales_outcome_set' || notif.type === 'appointment_assigned' || notif.type === 'bot_contatto_umano' || notif.type === 'contatto_umano_assegnato' || notif.type === 'appointment_rescheduled_by_sales') {
            // `contatto_umano_assegnato` era l'unico tipo che notificava e basta: il GDO
            // leggeva "Chiamalo tu", cliccava e non succedeva niente (11/09).
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

    // ── Veste Diretta (GDO e Conferme con l'interruttore acceso) ──
    // Scura e sobria: logo, menu (GDO, schermi larghi), ricerca, orologio con il
    // tempo a fine turno (solo lato client), pausa, notifiche, saldo, avatar col
    // nome vero che apre il profilo. La logica di ricerca, notifiche e drawer è
    // quella di sempre.
    //
    // Larghezze misurate (Poppins, 25/10/2026): menu 608 px, pausa in corso
    // 318, saldo 124 (226 con le etichette), avatar col nome fino a 206, ora col
    // turno 212. Per stare su una riga senza sovrapposizioni da 1024 px in su:
    // - sotto 2xl (1536) il menu è quello a scomparsa e da xl (1280) ci stanno
    //   turno e nome;
    // - da 2xl il menu sta nella barra e i testi facoltativi tornano da 1920
    //   (120rem); la ricerca larga da 2240 (140rem), sotto è a comparsa.
    // Tutto è shrink-0 tranne lo spazio vuoto e il nome accanto all'avatar: se
    // un numero cresce si stringono quelli (il nome si tronca), mai il menu.
    //
    // L'admin (interruttore admin_ui_diretta) ha la stessa barra con la sidebar
    // fissa come le Conferme: niente saldo, niente pausa, il selettore delle
    // aziende al posto della ricerca e l'avatar senza link al profilo dei giochi.
    if (diretta && (ruolo === 'GDO' || ruolo === 'CONFERME' || ruolo === 'ADMIN')) {
        const nonLette = notifications.filter(n => n.status === 'unread').length
        const nome = io?.nomeVero ?? io?.nome ?? session?.user?.name ?? ''
        const iniziale = io?.iniziale ?? (nome.charAt(0).toUpperCase() || 'F')
        const turno = direttaGdo && adesso && obiettivi ? testoTurno(adesso, obiettivi) : null
        // Testi facoltativi (nome, turno, etichette del saldo): al GDO solo dove
        // il menu nella barra lascia posto; le Conferme hanno la sidebar fissa e
        // la barra corta, quindi da lg.
        const facoltativo = direttaGdo ? 'hidden xl:inline 2xl:hidden min-[120rem]:inline' : 'hidden lg:inline'
        const etichettaSaldo = direttaGdo ? 'sr-only min-[120rem]:not-sr-only min-[120rem]:text-[#BFBFBF]' : 'sr-only lg:not-sr-only lg:text-[#BFBFBF]'
        return (
            <header className="relative z-40 flex h-16 shrink-0 items-center gap-2 border-b-2 border-[#262626] bg-[#171717] px-4 text-[#F2F2F2] sm:gap-3 lg:px-6">
                <button
                    type="button"
                    onClick={toggle}
                    aria-label="Apri il menu"
                    className={`-ml-1 shrink-0 rounded-lg p-2 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2] ${direttaGdo ? '2xl:hidden' : 'lg:hidden'}`}
                >
                    <Menu className="h-5 w-5" strokeWidth={1.5} />
                </button>

                {direttaGdo && (
                    <Link href="/" className="mr-2 flex shrink-0 items-center gap-2.5">
                        <span aria-hidden="true" className="h-6 w-6 rounded-lg bg-[#FF9330]" />
                        <span className="hidden text-[16px] font-semibold sm:inline">Fenice</span>
                    </Link>
                )}

                {direttaGdo && (
                    <nav aria-label="Menu" className="hidden shrink-0 items-center gap-1 2xl:flex">
                        {MENU_GDO_DIRETTA.map(v => {
                            const attiva = pathname === v.href
                            return (
                                <Link
                                    key={v.href}
                                    href={v.href}
                                    aria-current={attiva ? 'page' : undefined}
                                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-[14px] transition-colors ${attiva ? 'bg-[#262626] font-medium text-[#F2F2F2]' : 'text-[#BFBFBF] hover:text-[#F2F2F2]'}`}
                                >
                                    {v.name}
                                    {v.richiami && richiamiScaduti > 0 && (
                                        <span className="ml-1.5 tabular-nums text-[#FF9330]">{richiamiScaduti}</span>
                                    )}
                                </Link>
                            )
                        })}
                    </nav>
                )}

                <div className="min-w-0 flex-1" />

                {direttaGdo && (
                    <div className="relative shrink-0" ref={wrapperRef}>
                        <button
                            type="button"
                            onClick={() => setCercaAperta(v => !v)}
                            aria-label="Cerca un lead"
                            aria-expanded={cercaAperta}
                            className="rounded-lg p-2 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2] min-[140rem]:hidden"
                        >
                            <Search className="h-5 w-5" strokeWidth={1.5} />
                        </button>
                        <div className={`${cercaAperta ? 'absolute right-0 top-full z-[100] mt-2 w-[min(26rem,calc(100vw-2rem))]' : 'hidden'} min-[140rem]:static min-[140rem]:mt-0 min-[140rem]:block min-[140rem]:w-72`}>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C8C8C]" strokeWidth={1.5} />
                                <input
                                    ref={cercaRef}
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onFocus={() => { if (query.trim().length >= 2) setIsOpen(true) }}
                                    placeholder="Cerca per nome, email o telefono"
                                    className="h-10 w-full rounded-lg border-2 border-[#262626] bg-[#262626] pl-9 pr-9 text-[14px] text-[#F2F2F2] placeholder:text-[#8C8C8C] focus:border-[#8C8C8C] focus:outline-none"
                                />
                                {query && (
                                    <button
                                        type="button"
                                        onClick={handleClear}
                                        aria-label="Cancella la ricerca"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[#8C8C8C] transition-colors hover:text-[#F2F2F2]"
                                    >
                                        <X className="h-4 w-4" strokeWidth={1.5} />
                                    </button>
                                )}
                            </div>
                            {isOpen && (
                                <div className="absolute left-0 right-0 top-full z-[100] mt-2 overflow-hidden rounded-2xl border-2 border-[#3D3D3D] bg-[#262626]">
                                    {isSearching ? (
                                        <div className="p-4 text-center text-[14px] text-[#BFBFBF]">Ricerca in corso</div>
                                    ) : results.length > 0 ? (
                                        <ul className="max-h-96 overflow-y-auto">
                                            {results.map(lead => (
                                                <li key={lead.id} className="border-b-2 border-[#2E2E2E] last:border-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => { handleResultClick(lead.id); setCercaAperta(false) }}
                                                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#2E2E2E]"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="truncate text-[14px] font-medium text-[#F2F2F2]">{lead.name}</div>
                                                            <div className="mt-0.5 truncate text-[13px] text-[#BFBFBF]">{lead.phone}{lead.email ? `, ${lead.email}` : ''}</div>
                                                        </div>
                                                        <div className="shrink-0 text-[12px] text-[#BFBFBF]">{lead.statusLabel}</div>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <div className="p-4 text-center text-[14px] text-[#BFBFBF]">Nessun lead trovato</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {direttaAdmin && (
                    <div className="shrink-0">
                        <SalesCompanySwitcher variant="diretta" />
                    </div>
                )}

                <div className="hidden shrink-0 whitespace-nowrap text-[14px] tabular-nums text-[#BFBFBF] md:block">
                    {adesso && (
                        <>
                            <span className="text-[#F2F2F2]">{oraBreve(adesso)}</span>
                            {turno && <span className={facoltativo}>, {turno}</span>}
                        </>
                    )}
                </div>

                {direttaGdo && (
                    <div className="shrink-0">
                        <PauseTimer variant="diretta" />
                    </div>
                )}

                <div className="relative shrink-0" ref={notifRef}>
                    <button
                        type="button"
                        onClick={() => setIsNotifOpen(!isNotifOpen)}
                        aria-label={nonLette > 0 ? `Notifiche, ${nonLette} da leggere` : 'Notifiche'}
                        className="relative rounded-lg p-2 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]"
                    >
                        <Bell className="h-5 w-5" strokeWidth={1.5} />
                        {nonLette > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-[6px] bg-[#FF9330] px-1 text-[11px] font-semibold tabular-nums text-[#171717]">
                                {nonLette}
                            </span>
                        )}
                    </button>
                    {isNotifOpen && (
                        <div className="absolute right-0 z-[100] mt-2 w-80 overflow-hidden rounded-2xl border-2 border-[#3D3D3D] bg-[#262626] text-[#F2F2F2]">
                            <div className="flex items-center justify-between border-b-2 border-[#2E2E2E] px-4 py-3">
                                <div className="text-[14px] font-semibold">Notifiche</div>
                                {nonLette > 0 && (
                                    <button type="button" onClick={handleMarkAllRead} className="text-[12px] font-medium text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]">
                                        Segna tutte lette
                                    </button>
                                )}
                            </div>
                            <div className="max-h-[28rem] overflow-y-auto">
                                {notifications.length > 0 ? (
                                    <ul>
                                        {notifications.map(notif => (
                                            <li key={notif.id} className="border-b-2 border-[#2E2E2E] last:border-0">
                                                <button
                                                    type="button"
                                                    onClick={() => handleNotifClick(notif)}
                                                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-[#2E2E2E] ${notif.status === 'unread' ? 'bg-[#2E2E2E]' : ''}`}
                                                >
                                                    <div className={`line-clamp-1 text-[14px] ${notif.status === 'unread' ? 'font-semibold' : ''}`}>{notif.title}</div>
                                                    <div className="mt-1 line-clamp-2 text-[13px] text-[#BFBFBF]">{notif.body}</div>
                                                    <div className="mt-1.5 text-[12px] tabular-nums text-[#8C8C8C]">
                                                        {new Date(notif.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}
                                                    </div>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="p-8 text-center text-[14px] text-[#BFBFBF]">Nessuna notifica</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Sul telefono il saldo non ci sta (collaudo del 25/10/2026): resta nel profilo e nel negozio. */}
                {conSaldo && (
                    <div className="relative hidden shrink-0 items-center gap-3 whitespace-nowrap rounded-lg bg-[#262626] px-3 py-1.5 text-[13px] tabular-nums sm:flex" title="Il tuo saldo di Scintille e Piume">
                        <div className="flex items-center gap-1.5">
                            <Sparkles className="h-4 w-4 text-[#BFBFBF]" strokeWidth={1.5} aria-hidden="true" />
                            <span className="font-semibold">{numeroIt(saldo?.scintille ?? 0)}</span>
                            <span className={etichettaSaldo}>Scintille</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Feather className="h-4 w-4 text-[#BFBFBF]" strokeWidth={1.5} aria-hidden="true" />
                            <span className="font-semibold">{numeroIt(saldo?.piume ?? 0)}</span>
                            <span className={etichettaSaldo}>Piume</span>
                        </div>
                        {guadagno && (
                            <div key={guadagno.chiave} aria-live="polite" className="d-svanisce pointer-events-none absolute right-0 top-full mt-1.5 whitespace-nowrap rounded-lg bg-[#FF9330] px-2.5 py-1 text-[12px] font-semibold text-[#171717]">
                                {guadagno.testo}
                            </div>
                        )}
                    </div>
                )}

                {direttaAdmin ? (
                    <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`${facoltativo} max-w-[10rem] truncate text-[14px] text-[#F2F2F2]`}>{nome}</span>
                        {io?.immagine ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={io.immagine} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                        ) : (
                            <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F2F2F2] text-[14px] font-semibold text-[#171717]">
                                {iniziale}
                            </div>
                        )}
                    </div>
                ) : (
                    <Link
                        href="/profilo"
                        aria-label={nome ? `Il tuo profilo, ${nome}` : 'Il tuo profilo'}
                        aria-current={pathname === '/profilo' ? 'page' : undefined}
                        className="flex min-w-0 items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80"
                    >
                        <span className={`${facoltativo} max-w-[10rem] truncate text-[14px] text-[#F2F2F2]`}>{nome}</span>
                        {io?.immagine ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={io.immagine} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                        ) : (
                            <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F2F2F2] text-[14px] font-semibold text-[#171717]">
                                {iniziale}
                            </div>
                        )}
                    </Link>
                )}

                <ContactDrawer
                    isOpen={isDrawerOpen}
                    leadId={selectedLeadId}
                    onClose={() => setIsDrawerOpen(false)}
                    diretta
                />

                {liveToast && (
                    <div className="fixed bottom-6 right-6 z-50 max-w-sm">
                        <div className="relative rounded-2xl border-2 border-[#3D3D3D] bg-[#262626] p-4 pr-10 text-[#F2F2F2]">
                            <button
                                type="button"
                                onClick={() => setLiveToast(null)}
                                aria-label="Chiudi"
                                className="absolute right-2 top-2 rounded-lg p-1 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]"
                            >
                                <X className="h-4 w-4" strokeWidth={1.5} />
                            </button>
                            <button
                                type="button"
                                onClick={() => { const t = liveToast; setLiveToast(null); handleNotifClick(t) }}
                                className="block text-left"
                            >
                                <div className="text-[14px] font-semibold leading-tight">{liveToast.title}</div>
                                <div className="mt-1 text-[13px] leading-snug text-[#BFBFBF]">{liveToast.body}</div>
                            </button>
                        </div>
                    </div>
                )}
            </header>
        )
    }

    return (
        <header className="relative h-16 bg-white border-b border-ash-200/60 flex items-center justify-between px-4 lg:px-6 shadow-soft z-40">
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
                <SalesCompanySwitcher />
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
