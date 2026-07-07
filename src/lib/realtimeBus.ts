"use client"

/**
 * Realtime Bus — SINGLETON per tab (migrazione Broadcast 2026-07-07).
 *
 * Sostituisce tutte le sottoscrizioni `postgres_changes` (13 in 8 file, causa
 * del WAL polling `realtime.list_changes` che ha contribuito all'outage del
 * 2026-07-07): i trigger DB (migrazione 0019) inviano messaggi Broadcast su
 * topic PRIVATI e questo modulo li smista ai componenti.
 *
 * Topic:
 * - `crm:<companyId>`  → eventi di squadra: 'leads' (ping), 'leadEvents',
 *   'duels', 'userAchievements', 'bossBattles', 'seasonalEvents',
 *   'internalAlerts' (broadcast a tutti)
 * - `user:<userId>`    → 'notifications' ({op, row}), 'internalAlerts' (ping)
 *
 * Regole (stesse di confermePresence.ts):
 * - UNA SOLA istanza di canale per topic per tab (refcount in initRealtimeBus).
 * - L'evento 'leads' è COALESCED (debounce trailing 1500ms): un burst di
 *   update (es. import CSV) produce una sola refetch lato componenti.
 * - Watchdog: ogni 30s i canali non-SUBSCRIBED vengono ricreati; anche gli
 *   eventi window 'online' e visibilitychange forzano il check. È la stessa
 *   difesa "il realtime a volte muore in silenzio" emersa dal QA Conferme.
 */

import { createClient } from "@/utils/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { logRealtimeStatus } from "@/lib/realtimeUtils"

export type BusEvent =
    | "leads"
    | "leadEvents"
    | "notifications"
    | "internalAlerts"
    | "duels"
    | "userAchievements"
    | "bossBattles"
    | "seasonalEvents"

type BusListener = (payload: any) => void

const BUS_EVENTS: BusEvent[] = [
    "leads", "leadEvents", "notifications", "internalAlerts",
    "duels", "userAchievements", "bossBattles", "seasonalEvents",
]

const LEADS_DEBOUNCE_MS = 1_500
const WATCHDOG_INTERVAL_MS = 30_000

type ManagedChannel = {
    topic: string
    channel: RealtimeChannel
    subscribed: boolean
    /** cicli di watchdog consecutivi in cui il canale è risultato giù */
    downTicks: number
}

let refCount = 0
let currentUserId: string | null = null
let currentCompanies: string[] = []
let channels = new Map<string, ManagedChannel>()
let watchdog: ReturnType<typeof setInterval> | null = null
let leadsDebounce: ReturnType<typeof setTimeout> | null = null
let pendingLeadsPayload: any = null
const listeners = new Map<BusEvent, Set<BusListener>>()

function emit(event: BusEvent, payload: any) {
    const set = listeners.get(event)
    if (!set) return
    set.forEach(cb => { try { cb(payload) } catch { /* listener isolato */ } })
}

function onMessage(event: BusEvent, payload: any) {
    if (event === "leads") {
        // Coalescing: un burst di ping produce una sola emissione.
        pendingLeadsPayload = payload
        if (leadsDebounce) return
        leadsDebounce = setTimeout(() => {
            leadsDebounce = null
            const p = pendingLeadsPayload
            pendingLeadsPayload = null
            emit("leads", p)
        }, LEADS_DEBOUNCE_MS)
        return
    }
    emit(event, payload)
}

function buildChannel(topic: string): ManagedChannel {
    const supabase = createClient()
    const ch = supabase.channel(topic, { config: { private: true } })
    const managed: ManagedChannel = { topic, channel: ch, subscribed: false, downTicks: 0 }

    for (const ev of BUS_EVENTS) {
        ch.on("broadcast", { event: ev }, (msg) => onMessage(ev, msg.payload))
    }

    const logStatus = logRealtimeStatus(`bus:${topic}`)
    ch.subscribe((status, err) => {
        logStatus(status, err)
        managed.subscribed = status === "SUBSCRIBED"
        if (managed.subscribed) managed.downTicks = 0
    })
    return managed
}

function rebuildChannel(topic: string) {
    const old = channels.get(topic)
    if (old) {
        try { createClient().removeChannel(old.channel) } catch { /* ignore */ }
    }
    channels.set(topic, buildChannel(topic))
}

async function ensureChannels() {
    if (!currentUserId) return
    // I canali privati richiedono il token realtime: supabase-js lo aggiorna da
    // solo sugli auth state change, ma al primo mount lo forziamo per evitare
    // la corsa "subscribe prima del token" (JOIN rifiutato dalla RLS).
    try { await createClient().realtime.setAuth() } catch { /* token già in corso */ }

    const wanted = new Set<string>([`user:${currentUserId}`, ...currentCompanies.map(c => `crm:${c}`)])
    for (const topic of wanted) {
        if (!channels.has(topic)) channels.set(topic, buildChannel(topic))
    }
    for (const [topic, managed] of channels) {
        if (!wanted.has(topic)) {
            try { createClient().removeChannel(managed.channel) } catch { /* ignore */ }
            channels.delete(topic)
        }
    }
}

function watchdogTick() {
    if (refCount <= 0) return
    for (const managed of channels.values()) {
        if (managed.subscribed) continue
        managed.downTicks++
        // Al secondo ciclo consecutivo giù (>30s) il rejoin automatico di
        // supabase-js evidentemente non ce l'ha fatta: ricrea il canale.
        if (managed.downTicks >= 2) {
            console.warn(`[bus] canale ${managed.topic} giù da ${managed.downTicks} cicli, rebuild`)
            rebuildChannel(managed.topic)
        }
    }
}

function onOnline() { void ensureChannels(); watchdogTick() }
function onVisibilityChange() { if (!document.hidden) watchdogTick() }

function teardown() {
    if (watchdog) { clearInterval(watchdog); watchdog = null }
    if (leadsDebounce) { clearTimeout(leadsDebounce); leadsDebounce = null; pendingLeadsPayload = null }
    window.removeEventListener("online", onOnline)
    document.removeEventListener("visibilitychange", onVisibilityChange)
    const supabase = createClient()
    for (const managed of channels.values()) {
        try { supabase.removeChannel(managed.channel) } catch { /* ignore */ }
    }
    channels = new Map()
    currentUserId = null
    currentCompanies = []
}

/**
 * Monta (o riusa) i canali del bus. Ritorna la funzione di disconnessione:
 * i canali vengono smontati solo quando TUTTI i consumer si sono disconnessi.
 */
export function initRealtimeBus(userId: string, companies: string[]): () => void {
    currentUserId = userId
    currentCompanies = companies.length > 0 ? companies : []
    refCount++
    void ensureChannels()
    if (!watchdog) {
        watchdog = setInterval(watchdogTick, WATCHDOG_INTERVAL_MS)
        window.addEventListener("online", onOnline)
        document.addEventListener("visibilitychange", onVisibilityChange)
    }
    let disconnected = false
    return () => {
        if (disconnected) return
        disconnected = true
        refCount--
        if (refCount <= 0) {
            refCount = 0
            teardown()
        }
    }
}

/** Sottoscrive un evento del bus. L'evento 'leads' è debounced (1500ms). */
export function onBusEvent(event: BusEvent, cb: BusListener): () => void {
    let set = listeners.get(event)
    if (!set) { set = new Set(); listeners.set(event, set) }
    set.add(cb)
    return () => { set!.delete(cb) }
}
