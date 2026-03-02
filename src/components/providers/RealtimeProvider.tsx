"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        // Iscrizione al canale Realtime globale per i Leads
        const channel = supabase
            .channel('public:leads-changes')
            .on(
                'postgres_changes',
                {
                    event: '*', // Ascolta INSERT, UPDATE, DELETE
                    schema: 'public',
                    table: 'leads'
                },
                (payload) => {
                    console.log('🔄 Lead aggiornato in background via Realtime:', payload)
                    // Il router.refresh() ricaricherà i dati dal server (Server Actions) mantenendo lo stato client
                    router.refresh()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [router, supabase])

    return <>{children}</>
}
