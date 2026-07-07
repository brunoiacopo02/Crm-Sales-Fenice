"use client"

/**
 * Presence Conferme — SINGLETON per tab (QA Conferme 2026-06-12).
 *
 * Prima ConfermeBoard, ConfermeDrawer e TeamRadarWidget creavano CIASCUNO una
 * propria istanza di canale sullo stesso topic 'conferme_realtime_board' sullo
 * stesso client browser (singleton @supabase/ssr): alla chiusura della drawer
 * il suo removeChannel() smontava il topic anche per gli altri → presence e
 * realtime morivano a intermittenza ("a volte non vedo chi è online / chi è
 * sul lead"). Il board inoltre ricreava il canale a ogni cambio vista.
 *
 * Regola: UNA SOLA istanza di canale per topic per tab. Tutti i componenti
 * passano da qui:
 * - connectConfermePresence(user)  → monta il canale (refcount) e traccia
 * - setConfermeActivity(leadId)    → aggiorna il lead su cui si sta lavorando
 * - subscribeConfermePresence(cb)  → lista presence (tutti gli utenti online)
 * - subscribeConfermeLeadChanges(cb) → cambi sulla tabella `leads` (dal bus)
 *
 * Task P1 (2026-07-05): il Realtime da solo è inaffidabile (churn di
 * subscribe, tab in background, reti instabili) — gli operatori a volte non
 * si vedono online a vicenda. Questo modulo aggancia anche un heartbeat su DB
 * (src/app/actions/presenceActions.ts) come fonte di verità di backup: upsert
 * ogni 45s + a ogni cambio attività, sullo STESSO singleton (nessun secondo
 * canale realtime). Il Radar unisce le due fonti lato componente.
 *
 * Migrazione Broadcast (2026-07-07): il canale è ora SOLO presence — i cambi
 * lead arrivano dal bus (src/lib/realtimeBus.ts, trigger migrazione 0019),
 * quindi questo topic non pesa più sul WAL polling del DB. Hardening radar:
 * watchdog che ricrea il canale se resta giù >2 cicli da 30s e listener
 * window 'online' per il rientro immediato dopo una caduta di rete.
 */

import { createClient } from "@/utils/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { logRealtimeStatus } from "@/lib/realtimeUtils"
import { upsertHeartbeat } from "@/app/actions/presenceActions"
import { onBusEvent } from "@/lib/realtimeBus"

export type ConfermePresenceEntry = {
    online_at: string
    leadId: string | null
    user: { id: string; name?: string | null; displayName?: string | null }
}

type PresenceListener = (entries: ConfermePresenceEntry[]) => void
type ChangeListener = () => void
type ConnectionListener = (connected: boolean) => void

let channel: RealtimeChannel | null = null
let subscribed = false
let refCount = 0
let heartbeat: ReturnType<typeof setInterval> | null = null
let dbHeartbeat: ReturnType<typeof setInterval> | null = null
let presenceWatchdog: ReturnType<typeof setInterval> | null = null
let downTicks = 0
let busUnsubscribe: (() => void) | null = null
let currentUser: ConfermePresenceEntry["user"] | null = null
let currentLeadId: string | null = null
let lastPresence: ConfermePresenceEntry[] = []
const presenceListeners = new Set<PresenceListener>()
const changeListeners = new Set<ChangeListener>()
const connectionListeners = new Set<ConnectionListener>()

function notifyConnection() {
    connectionListeners.forEach(cb => { try { cb(subscribed) } catch { /* listener isolato */ } })
}

function buildPayload(): ConfermePresenceEntry {
    return {
        online_at: new Date().toISOString(),
        leadId: currentLeadId,
        user: {
            id: currentUser?.id || "",
            name: currentUser?.name,
            displayName: currentUser?.displayName,
        },
    }
}

function retrack() {
    if (channel && subscribed && currentUser?.id) {
        // Niente catch silenzioso: se il track fallisce dobbiamo saperlo
        // (evidenza per i report "non vedo i colleghi" — QA 2026-06-12).
        channel.track(buildPayload()).catch((e) => {
            console.warn("[presence] track fallito su conferme_realtime_board:", e)
        })
    }
}

/**
 * Upsert dell'heartbeat DB (Task P1). Fonte di verità di backup rispetto al
 * Realtime: non richiede `subscribed` perché deve funzionare anche quando il
 * canale è temporaneamente giù.
 */
function pushDbHeartbeat() {
    if (!currentUser?.id) return
    const activity = currentLeadId ? "call" : "board"
    upsertHeartbeat(activity, currentLeadId).catch((e) => {
        console.warn("[presence] upsertHeartbeat fallito:", e)
    })
}

function onVisibilityChange() {
    // Tab in background sospende i WebSocket: al ritorno ripubblica il track,
    // altrimenti chi torna dopo 10 minuti appare offline ai colleghi.
    if (!document.hidden) { retrack(); pushDbHeartbeat(); watchdogTick() }
}

function onOnline() {
    // Rete tornata: non aspettare il prossimo ciclo di watchdog.
    retrack()
    pushDbHeartbeat()
    watchdogTick()
}

/**
 * Watchdog radar (hardening 2026-07-07): se il canale resta non-SUBSCRIBED
 * per 2 cicli consecutivi (>30s) il rejoin automatico di supabase-js non ce
 * l'ha fatta — ricrea il canale da zero mantenendo listener e refcount.
 * È la risposta strutturale ai report "a volte non vedo i colleghi online".
 */
function watchdogTick() {
    if (refCount <= 0 || !channel) return
    if (subscribed) { downTicks = 0; return }
    downTicks++
    if (downTicks >= 2) {
        console.warn(`[presence] conferme_realtime_board giù da ${downTicks} cicli, rebuild del canale`)
        downTicks = 0
        rebuildChannel()
    }
}

function rebuildChannel() {
    const ch = channel
    channel = null
    subscribed = false
    if (ch) {
        ;(async () => {
            try { await ch.untrack() } catch { /* ignore */ }
            try { createClient().removeChannel(ch) } catch { /* ignore */ }
        })()
    }
    ensureChannel()
    retrack()
}

function onPageHide() {
    try { channel?.untrack() } catch { /* ignore */ }
}

function ensureChannel() {
    if (channel) return
    const supabase = createClient()
    const ch = supabase.channel("conferme_realtime_board")
    channel = ch

    ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState()
        const entries: ConfermePresenceEntry[] = []
        for (const key in state) {
            (state[key] as any[]).forEach(p => { if (p?.user) entries.push(p) })
        }
        lastPresence = entries
        presenceListeners.forEach(cb => { try { cb(entries) } catch { /* listener isolato */ } })
    })

    const logStatus = logRealtimeStatus("conferme_realtime_board")
    ch.subscribe((status, err) => {
        logStatus(status, err)
        if (status === "SUBSCRIBED") {
            subscribed = true
            // Vale anche per i re-join automatici dopo riconnessione socket
            // (standby PC, rete instabile): il track viene ripubblicato da solo.
            retrack()
        } else {
            subscribed = false
        }
        notifyConnection()
    })

    // Timer e listener globali: guardati singolarmente perché ensureChannel
    // viene richiamata anche dal rebuild del watchdog (niente duplicati).
    if (!heartbeat) {
        // Heartbeat: ogni 25s ripublica il track con nuovo online_at. Previene
        // che Supabase/colleghi ci considerino offline per disconnessioni brevi.
        heartbeat = setInterval(retrack, 25_000)
        // Heartbeat DB (Task P1): ogni 45s, fonte di verità di backup al Realtime.
        dbHeartbeat = setInterval(pushDbHeartbeat, 45_000)
        // Watchdog radar: controlla ogni 30s che il canale sia vivo.
        presenceWatchdog = setInterval(watchdogTick, 30_000)
        document.addEventListener("visibilitychange", onVisibilityChange)
        window.addEventListener("pagehide", onPageHide)
        window.addEventListener("online", onOnline)
    }
    if (!busUnsubscribe) {
        // Cambi lead dal bus Broadcast (già debounced lato bus).
        busUnsubscribe = onBusEvent("leads", () => {
            changeListeners.forEach(cb => { try { cb() } catch { /* listener isolato */ } })
        })
    }
}

function teardown() {
    if (!channel) return
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
    if (dbHeartbeat) { clearInterval(dbHeartbeat); dbHeartbeat = null }
    if (presenceWatchdog) { clearInterval(presenceWatchdog); presenceWatchdog = null }
    if (busUnsubscribe) { busUnsubscribe(); busUnsubscribe = null }
    downTicks = 0
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("pagehide", onPageHide)
    window.removeEventListener("online", onOnline)
    const ch = channel
    channel = null
    subscribed = false
    currentLeadId = null
    lastPresence = []
    notifyConnection()
    ;(async () => {
        try { await ch.untrack() } catch { /* ignore */ }
        try { createClient().removeChannel(ch) } catch { /* ignore */ }
    })()
}

/**
 * Monta (o riusa) il canale presence e traccia l'utente. Ritorna la funzione
 * di disconnessione: il canale viene smontato solo quando TUTTI i componenti
 * che lo usano si sono disconnessi (refcount).
 */
export function connectConfermePresence(user: ConfermePresenceEntry["user"]): () => void {
    currentUser = user
    refCount++
    ensureChannel()
    retrack()
    pushDbHeartbeat()
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

/** Segnala su quale lead si sta lavorando (null = nessuno). */
export function setConfermeActivity(leadId: string | null) {
    currentLeadId = leadId
    retrack()
    pushDbHeartbeat()
}

/** Sottoscrive la lista presence; emette subito lo stato corrente. */
export function subscribeConfermePresence(cb: PresenceListener): () => void {
    presenceListeners.add(cb)
    try { cb(lastPresence) } catch { /* ignore */ }
    return () => { presenceListeners.delete(cb) }
}

/** Sottoscrive i cambi sulla tabella leads (bus Broadcast, debounced). */
export function subscribeConfermeLeadChanges(cb: ChangeListener): () => void {
    changeListeners.add(cb)
    return () => { changeListeners.delete(cb) }
}

/**
 * Stato connessione del canale presence (true = SUBSCRIBED). Emette subito lo
 * stato corrente. Usato dal Radar per mostrare se il realtime è vivo: dà agli
 * operatori (e a noi) l'evidenza che prima mancava nei report "a volte non va".
 */
export function subscribeConfermeConnection(cb: ConnectionListener): () => void {
    connectionListeners.add(cb)
    try { cb(subscribed) } catch { /* ignore */ }
    return () => { connectionListeners.delete(cb) }
}
