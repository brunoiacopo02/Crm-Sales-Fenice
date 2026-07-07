"use client"

import { useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { logRealtimeStatus } from '@/lib/realtimeUtils'
import { initRealtimeBus, onBusEvent } from '@/lib/realtimeBus'

type RealtimeContextType = {
    broadcastFomo: (event: string, payload: Record<string, unknown>) => void;
};

const RealtimeContext = createContext<RealtimeContextType>({ broadcastFomo: () => {} });

export const useRealtimeBroadcast = () => useContext(RealtimeContext);

/**
 * Migrazione Broadcast 2026-07-07: gli eventi derivati dal DB (leads,
 * leadEvents, userAchievements) arrivano dal bus (src/lib/realtimeBus.ts,
 * trigger migrazione 0019) invece che da postgres_changes. I due canali
 * broadcast puri pre-esistenti restano invariati:
 * - 'public:leads-changes' per fomo_hotstreak (send client→client via
 *   broadcastFomo, usato da HotStreak.tsx)
 * - 'team-adventure' per team_boss_damage (inviato anche server-side da
 *   teamAdventureActions.ts)
 */
export function RealtimeProvider({ userId, companies, children }: {
    userId: string;
    companies: string[];
    children: React.ReactNode;
}) {
    const router = useRouter()
    const supabase = createClient()
    const channelRef = useRef<RealtimeChannel | null>(null)

    useEffect(() => {
        const disconnect = initRealtimeBus(userId, companies)

        const offLeads = onBusEvent('leads', () => {
            router.refresh()
        })
        const offLeadEvents = onBusEvent('leadEvents', (payload) => {
            try {
                window.dispatchEvent(new CustomEvent('fomo_lead_event', { detail: payload }));
            } catch { /* silent fail */ }
        })
        const offAchievements = onBusEvent('userAchievements', (payload) => {
            try {
                window.dispatchEvent(new CustomEvent('fomo_achievement_event', { detail: payload }));
            } catch { /* silent fail */ }
        })

        return () => {
            offLeads()
            offLeadEvents()
            offAchievements()
            disconnect()
        }
    }, [router, userId, companies.join(',')])

    useEffect(() => {
        // Canale broadcast client→client per gli hot streak (nessun costo DB).
        const channel = supabase
            .channel('public:leads-changes')
            .on(
                'broadcast',
                { event: 'fomo_hotstreak' },
                (payload) => {
                    try {
                        window.dispatchEvent(new CustomEvent('fomo_hotstreak_event', { detail: payload.payload }));
                    } catch { /* silent fail */ }
                }
            )
            .subscribe(logRealtimeStatus('realtime-provider-main'))

        channelRef.current = channel

        // Team adventure channel for boss damage broadcasts
        const teamChannel = supabase.channel('team-adventure')
            .on(
                'broadcast',
                { event: 'team_boss_damage' },
                (payload) => {
                    try {
                        window.dispatchEvent(new CustomEvent('team_boss_damage_event', { detail: payload.payload }));
                    } catch { /* silent fail */ }
                }
            )
            .subscribe(logRealtimeStatus('team-adventure'))

        return () => {
            supabase.removeChannel(channel)
            supabase.removeChannel(teamChannel)
            channelRef.current = null
        }
    }, [supabase])

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
