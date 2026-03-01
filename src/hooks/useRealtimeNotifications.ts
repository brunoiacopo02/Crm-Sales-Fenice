"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useAuth } from '@/components/AuthProvider'

// Tipo base per le notifiche, adattabile allo schema reale
export type Notification = {
    id: string
    recipientUserId: string
    title: string
    message: string
    status: 'UNREAD' | 'READ'
    createdAt: string
    [key: string]: any
}

export function useRealtimeNotifications() {
    const { user } = useAuth()
    const supabase = createClient()
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)

    useEffect(() => {
        if (!user) return

        // 1. Carica le notifiche iniziali usando l'API server action o fetch Drizzle esistente
        // Per pura dimostrazione client-side leggiamo le ultime 10 ignorando Drizzle per un attimo se RLS lo permette
        const fetchInitial = async () => {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('recipientUserId', user.id)
                .order('createdAt', { ascending: false })
                .limit(10)

            if (data) {
                setNotifications(data as Notification[])
                setUnreadCount(data.filter((n) => n.status === 'UNREAD').length)
            }
        }

        fetchInitial()

        // 2. Iscrizione al canale Realtime di Supabase
        const channel = supabase
            .channel('schema-db-changes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `recipientUserId=eq.${user.id}`,
                },
                (payload) => {
                    console.log('🔔 Nuova notifica Live:', payload.new)
                    // Aggiungi la nuova notifica in cima alla lista
                    setNotifications((prev) => [payload.new as Notification, ...prev])
                    setUnreadCount((prev) => prev + 1)
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
                    // Aggiorna lo stato se una notifica viene letta da un'altra tab
                    setNotifications((prev) =>
                        prev.map(n => n.id === payload.new.id ? payload.new as Notification : n)
                    )

                    if (payload.old.status === 'UNREAD' && payload.new.status === 'READ') {
                        setUnreadCount((prev) => Math.max(0, prev - 1))
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [user, supabase])

    return { notifications, unreadCount, setNotifications, setUnreadCount }
}
