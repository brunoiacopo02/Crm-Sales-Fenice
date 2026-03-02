"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useAuth } from '@/components/AuthProvider'

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
            }
        }

        fetchInitial()

        const channel = supabase
            .channel('realtime_notifications')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `recipientUserId=eq.${user.id}`,
                },
                (payload) => {
                    const newNotif = payload.new as Notification
                    console.log('🔔 Nuova notifica Live:', newNotif)
                    setNotifications((prev) => [newNotif, ...prev])
                    setUnreadCount((prev) => prev + 1)
                    setLiveToast(newNotif)

                    // Dispatch a global event to let other components re-fetch (e.g. KPI Board)
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('realtime_update', { detail: { type: newNotif.type } }))
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'notifications',
                    filter: `recipientUserId=eq.${user.id}`,
                },
                (payload) => {
                    setNotifications((prev) =>
                        prev.map(n => n.id === payload.new.id ? payload.new as Notification : n)
                    )
                    if (payload.old.status === 'unread' && payload.new.status === 'read') {
                        setUnreadCount((prev) => Math.max(0, prev - 1))
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [user, supabase])

    return { notifications, unreadCount, setNotifications, setUnreadCount, liveToast, setLiveToast }
}
