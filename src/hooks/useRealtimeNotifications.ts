"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { onBusEvent } from '@/lib/realtimeBus'

export type Notification = {
    id: string
    recipientUserId: string
    type: string
    title: string
    body: string
    status: 'unread' | 'read'
    metadata: any
    createdAt: string
}

export function useRealtimeNotifications() {
    const { user } = useAuth()
    const supabase = createClient()
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [liveToast, setLiveToast] = useState<Notification | null>(null)

    useEffect(() => {
        if (!user) return

        const fetchInitial = async () => {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('recipientUserId', user.id)
                .order('createdAt', { ascending: false })
                .limit(20)

            if (data && !error) {
                setNotifications(data as Notification[])
                setUnreadCount(data.filter((n) => n.status === 'unread').length)

                // Catch-up: if there's a recent unread duel_started notification (user was offline
                // when the admin created the duel), dispatch the overlay event now so they still
                // see the "SFIDA!" screen on first load.
                if (typeof window !== 'undefined') {
                    const now = Date.now()
                    const RECENT_MS = 60 * 60 * 1000 // 1 hour — covers a typical duel lifetime
                    const freshDuel = (data as Notification[]).find(n =>
                        n.type === 'duel_started' &&
                        n.status === 'unread' &&
                        (now - new Date(n.createdAt).getTime()) < RECENT_MS
                    )
                    if (freshDuel) {
                        window.dispatchEvent(new CustomEvent('duel_started', { detail: freshDuel }))
                    }
                }
            } else if (error) {
                console.error('Errore fetch notifiche iniziali:', error)
            }
        }

        fetchInitial()

        // Migrazione Broadcast 2026-07-07: il trigger notifications_broadcast
        // (migrazione 0019) invia {op, row} sul topic personale user:<id>;
        // il bus (realtimeBus.ts) è montato dal RealtimeProvider nel layout.
        const offNotifications = onBusEvent('notifications', (payload: { op: 'INSERT' | 'UPDATE'; row: Notification }) => {
            if (!payload?.row || payload.row.recipientUserId !== user.id) return
            if (payload.op === 'INSERT') {
                const newNotif = payload.row
                setNotifications((prev) => [newNotif, ...prev])
                setUnreadCount((prev) => prev + 1)
                setLiveToast(newNotif)

                // Dispatch a global event to let other components re-fetch (e.g. KPI Board)
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('realtime_update', { detail: { type: newNotif.type } }))
                    // Duel start overlay hook: fullscreen "SFIDA!" announcement
                    if (newNotif.type === 'duel_started') {
                        window.dispatchEvent(new CustomEvent('duel_started', { detail: newNotif }))
                    }
                }
            } else {
                const updated = payload.row
                setNotifications((prev) => {
                    const newList = prev.map(n => n.id === updated.id ? updated : n)
                    // Recompute unread count from the full updated list
                    setUnreadCount(newList.filter(n => n.status === 'unread').length)
                    return newList
                })
            }
        })

        return () => {
            offNotifications()
        }
    }, [user, supabase])

    return { notifications, unreadCount, setNotifications, setUnreadCount, liveToast, setLiveToast }
}
