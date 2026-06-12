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
 * - subscribeConfermeLeadChanges(cb) → eventi postgres_changes su `leads`
 */

import { createClient } from "@/utils/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"

export type ConfermePresenceEntry = {
    online_at: string
    leadId: string | null
    user: { id: string; name?: string | null; displayName?: string | null }
}

type PresenceListener = (entries: ConfermePresenceEntry[]) => void
type ChangeListener = () => void

let channel: RealtimeChannel | null = null
let subscribed = false
let refCount = 0
let heartbeat: ReturnType<typeof setInterval> | null = null
let currentUser: ConfermePresenceEntry["user"] | null = null
let currentLeadId: string | null = null
let lastPresence: ConfermePresenceEntry[] = []
const presenceListeners = new Set<PresenceListener>()
const changeListeners = new Set<ChangeListener>()

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
        channel.track(buildPayload()).catch(() => { })
    }
}

function onVisibilityChange() {
    // Tab in background sospende i WebSocket: al ritorno ripubblica il track,
    // altrimenti chi torna dopo 10 minuti appare offline ai colleghi.
    if (!document.hidden) retrack()
}

function onPageHide() {
    try { channel?.untrack() } catch { /* ignore */ }
}

function ensureChannel() {
    if (channel) return
    const supabase = createClient()
    const ch = supabase.channel("conferme_realtime_board")
    channel = ch

    ch.on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        changeListeners.forEach(cb => { try { cb() } catch { /* listener isolato */ } })
    })

    ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState()
        const entries: ConfermePresenceEntry[] = []
        for (const key in state) {
            (state[key] as any[]).forEach(p => { if (p?.user) entries.push(p) })
        }
        lastPresence = entries
        presenceListeners.forEach(cb => { try { cb(entries) } catch { /* listener isolato */ } })
    })

    ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
            subscribed = true
            // Vale anche per i re-join automatici dopo riconnessione socket
            // (standby PC, rete instabile): il track viene ripubblicato da solo.
            retrack()
        } else {
            subscribed = false
        }
    })

    // Heartbeat: ogni 25s ripublica il track con nuovo online_at. Previene
    // che Supabase/colleghi ci considerino offline per disconnessioni brevi.
    heartbeat = setInterval(retrack, 25_000)
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pagehide", onPageHide)
}

function teardown() {
    if (!channel) return
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("pagehide", onPageHide)
    const ch = channel
    channel = null
    subscribed = false
    currentLeadId = null
    lastPresence = []
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
}

/** Sottoscrive la lista presence; emette subito lo stato corrente. */
export function subscribeConfermePresence(cb: PresenceListener): () => void {
    presenceListeners.add(cb)
    try { cb(lastPresence) } catch { /* ignore */ }
    return () => { presenceListeners.delete(cb) }
}

/** Sottoscrive i postgres_changes sulla tabella leads. */
export function subscribeConfermeLeadChanges(cb: ChangeListener): () => void {
    changeListeners.add(cb)
    return () => { changeListeners.delete(cb) }
}
