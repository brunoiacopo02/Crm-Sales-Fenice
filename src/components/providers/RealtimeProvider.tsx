"use client"

import { useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

type RealtimeContextType = {
    broadcastFomo: (event: string, payload: Record<string, unknown>) => void;
};

const RealtimeContext = createContext<RealtimeContextType>({ broadcastFomo: () => {} });

export const useRealtimeBroadcast = () => useContext(RealtimeContext);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const supabase = createClient()
    const channelRef = useRef<RealtimeChannel | null>(null)

    useEffect(() => {
        // Iscrizione al canale Realtime globale per Leads + FOMO events + broadcast
        const channel = supabase
            .channel('public:leads-changes')
            .on(
                'postgres_changes',
                {
                    event: '*', // Ascolta INSERT, UPDATE, DELETE
                    schema: 'public',
                    table: 'leads'
                },
                () => {
                    router.refresh()
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'leadEvents'
                },
                (payload) => {
                    try {
                        window.dispatchEvent(new CustomEvent('fomo_lead_event', { detail: payload.new }));
                    } catch { /* silent fail */ }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'userAchievements'
                },
                (payload) => {
                    try {
                        window.dispatchEvent(new CustomEvent('fomo_achievement_event', { detail: payload.new }));
                    } catch { /* silent fail */ }
                }
            )
            .on(
                'broadcast',
                { event: 'fomo_hotstreak' },
                (payload) => {
                    try {
                        window.dispatchEvent(new CustomEvent('fomo_hotstreak_event', { detail: payload.payload }));
                    } catch { /* silent fail */ }
                }
            )
            .subscribe()

        channelRef.current = channel

        return () => {
            supabase.removeChannel(channel)
            channelRef.current = null
        }
    }, [router, supabase])

    const broadcastFomo = useCallback((event: string, payload: Record<string, unknown>) => {
        try {
            channelRef.current?.send({ type: 'broadcast', event, payload });
        } catch { /* silent fail */ }
    }, [])

    return (
        <RealtimeContext.Provider value={{ broadcastFomo }}>
            {children}
        </RealtimeContext.Provider>
    )
}
