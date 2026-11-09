"use server"

// Pulsante "Aggiorna ora" del monitor Black Friday (PO 09/11/2026): butta la
// cache di 45 secondi e rilegge subito. Solo ADMIN, dalla tabella users.

import { updateTag } from 'next/cache'
import { conRuoloDb } from '@/lib/auth/ruoloDb'
import { TAG_MONITOR_BF } from '@/lib/blackFriday/monitorDb'

export async function aggiornaMonitorBf(): Promise<{ success: boolean }> {
    if (!(await conRuoloDb(['ADMIN']))) return { success: false }
    updateTag(TAG_MONITOR_BF)
    return { success: true }
}
