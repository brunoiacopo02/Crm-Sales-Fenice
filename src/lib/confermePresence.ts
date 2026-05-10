"use client"

// Singleton presence manager per il canale Conferme.
// Un solo channel.subscribe() per tab, un solo track() per utente.
// Risolve i bug:
//   - Dual-track Board+Drawer che produceva entry duplicate per stesso user.id
//   - Channel ricreato a ogni cambio viewMode (flicker presence)
//   - Payload "leadId: null" sempre attivo dal Board che mascherava il leadId del Drawer
//
// API:
//   useConfermePresence(user) -> { presence, setActivity }
//   setActivity(activity)    aggiorna il proprio stato e re-tracka.

import { useEffect, useState } from "react"
import { createClient } from "@/utils/supabase/client"
import { readTimerState } from "@/lib/confermeCallTimer"

export type ConfermePresenceActivity =
    | { state: "idle" }
    | { state: "viewing"; leadId: string; leadName: string }
    | { state: "calling"; leadId: string; leadName: string }
    | { state: "writing_note"; leadId: string; leadName: string }

export interface ConfermePresenceUser {
    id: string
    name?: string | null
    displayName?: string | null
}

export interface ConfermePresenceEntry {
    user: ConfermePresenceUser
    activity: ConfermePresenceActivity
    online_at: string
    // Compat: alcuni consumer esistenti leggono `leadId` direttamente.
    leadId: string | null
}

type Listener = (list: ConfermePresenceEntry[]) => void

let supabaseClient: any = null
let channel: any = null
let refCount = 0
let subscribed = false
let me: ConfermePresenceUser | null = null
let myActivity: ConfermePresenceActivity = { state: "idle" }
let lastSnapshot: ConfermePresenceEntry[] = []

let heartbeatId: ReturnType<typeof setInterval> | null = null
let visibilityHandler: (() => void) | null = null
let pageHideHandler: (() => void) | null = null
let timerHandler: (() => void) | null = null

const listeners = new Set<Listener>()

function activityToLeadId(a: ConfermePresenceActivity): string | null {
    return "leadId" in a ? a.leadId : null
}

function buildPayload() {
    return {
        online_at: new Date().toISOString(),
        activity: myActivity,
        leadId: activityToLeadId(myActivity),
        user: me,
    }
}

function trackNow() {
    if (subscribed && channel) {
        channel.track(buildPayload()).catch(() => { })
    }
}

function rebuildSnapshot() {
    if (!channel) {
        lastSnapshot = []
        listeners.forEach((cb) => cb(lastSnapshot))
        return
    }
    const state = channel.presenceState() as Record<string, any[]>

    // Dedup per user.id preferendo l'entry "piu informativa":
    //   1. attivita non-idle batte idle
    //   2. parita: leadId valorizzato batte null
    //   3. parita: online_at piu recente vince
    const byUser = new Map<string, ConfermePresenceEntry>()
    const score = (e: any): number => {
        const isIdle = e?.activity?.state === "idle" || !e?.activity?.state
        const hasLead = !!e?.leadId
        return (isIdle ? 0 : 2) + (hasLead ? 1 : 0)
    }

    for (const id in state) {
        for (const raw of state[id]) {
            if (!raw?.user?.id) continue
            const entry: ConfermePresenceEntry = {
                user: raw.user,
                activity: raw.activity ?? { state: "idle" },
                online_at: raw.online_at ?? "",
                leadId: raw.leadId ?? activityToLeadId(raw.activity ?? { state: "idle" }),
            }
            const existing = byUser.get(entry.user.id)
            if (!existing) {
                byUser.set(entry.user.id, entry)
                continue
            }
            const sNew = score(entry)
            const sOld = score(existing)
            if (sNew > sOld) {
                byUser.set(entry.user.id, entry)
            } else if (sNew === sOld && (entry.online_at || "") > (existing.online_at || "")) {
                byUser.set(entry.user.id, entry)
            }
        }
    }

    lastSnapshot = Array.from(byUser.values())
    listeners.forEach((cb) => cb(lastSnapshot))
}

function bindCallTimerToActivity() {
    timerHandler = () => {
        const t = readTimerState()
        if (t.status === "running") {
            // Carry-over leadName se sappiamo gia il lead.
            const leadName =
                "leadId" in myActivity && myActivity.leadId === t.leadId ? myActivity.leadName : "lead"
            setActivity({ state: "calling", leadId: t.leadId, leadName })
        } else {
            // Timer fermato/idle: se eravamo in 'calling', torniamo a 'viewing' del lead corrente
            // (se ancora ne abbiamo uno aperto), altrimenti idle.
            if (myActivity.state === "calling") {
                setActivity({
                    state: "viewing",
                    leadId: myActivity.leadId,
                    leadName: myActivity.leadName,
                })
            }
        }
    }
    window.addEventListener("conferme-timer-changed", timerHandler)
}

function joinPresence(user: ConfermePresenceUser): () => void {
    refCount++
    if (channel) return makeUnjoin()

    me = user
    supabaseClient = createClient()
    channel = supabaseClient.channel("conferme_realtime_board")

    channel.on("presence", { event: "sync" }, rebuildSnapshot)

    channel.subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
            subscribed = true
            try { await channel.track(buildPayload()) } catch { /* noop */ }
        }
    })

    // Heartbeat 25s: previene timeout di presence su connessioni letargiche.
    heartbeatId = setInterval(trackNow, 25000)

    visibilityHandler = () => {
        // Tab background sospende WS; al ritorno re-tracciamo.
        if (!document.hidden) trackNow()
    }
    document.addEventListener("visibilitychange", visibilityHandler)

    pageHideHandler = () => {
        try { channel?.untrack() } catch { /* noop */ }
    }
    window.addEventListener("pagehide", pageHideHandler)

    bindCallTimerToActivity()

    return makeUnjoin()
}

function makeUnjoin() {
    let consumed = false
    return () => {
        if (consumed) return
        consumed = true
        refCount = Math.max(0, refCount - 1)
        if (refCount > 0) return
        teardown()
    }
}

function teardown() {
    if (heartbeatId) { clearInterval(heartbeatId); heartbeatId = null }
    if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler)
        visibilityHandler = null
    }
    if (pageHideHandler) {
        window.removeEventListener("pagehide", pageHideHandler)
        pageHideHandler = null
    }
    if (timerHandler) {
        window.removeEventListener("conferme-timer-changed", timerHandler)
        timerHandler = null
    }

    const ch = channel
    const sb = supabaseClient
    channel = null
    supabaseClient = null
    subscribed = false
    me = null
    myActivity = { state: "idle" }
    lastSnapshot = []
    listeners.forEach((cb) => cb([]))

        ; (async () => {
            try { await ch?.untrack() } catch { /* noop */ }
            try { sb?.removeChannel(ch) } catch { /* noop */ }
        })()
}

export function setActivity(activity: ConfermePresenceActivity) {
    myActivity = activity
    trackNow()
}

export function getActivity(): ConfermePresenceActivity {
    return myActivity
}

export function useConfermePresence(user: ConfermePresenceUser | null | undefined) {
    const [presence, setPresence] = useState<ConfermePresenceEntry[]>(lastSnapshot)

    useEffect(() => {
        if (!user?.id) return
        const unjoin = joinPresence(user)
        const listener: Listener = (list) => setPresence(list)
        listeners.add(listener)
        // Allinea subito al snapshot corrente.
        setPresence(lastSnapshot)
        return () => {
            listeners.delete(listener)
            unjoin()
        }
    }, [user?.id])

    return { presence, setActivity }
}

export function activityLabel(a: ConfermePresenceActivity | undefined): string {
    switch (a?.state) {
        case "calling": return "sta chiamando"
        case "writing_note": return "scrivendo nota"
        case "viewing": return "in lavorazione"
        case "idle":
        default: return "online"
    }
}
