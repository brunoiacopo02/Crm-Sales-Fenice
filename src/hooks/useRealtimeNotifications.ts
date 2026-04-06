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
            } else if (error) {
                console.error('❌ Errore fetch notifiche iniziali:', error)
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
                    const updated = payload.new as Notification
                    setNotifications((prev) => {
                        const newList = prev.map(n => n.id === updated.id ? updated : n)
                        // Recompute unread count from the full updated list
                        // (payload.old may lack status without REPLICA IDENTITY FULL)
                        setUnreadCount(newList.filter(n => n.status === 'unread').length)
                        return newList
                    })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [user, supabase])

    return { notifications, unreadCount, setNotifications, setUnreadCount, liveToast, setLiveToast }
}
