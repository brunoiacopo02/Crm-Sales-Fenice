"use server"

// Pulsante "Aggiorna ora" del carico Conferme (PO 09/11/2026): butta la cache
// di 45 secondi e rilegge subito. Solo ADMIN, dalla tabella users.

import { updateTag } from 'next/cache'
import { conRuoloDb } from '@/lib/auth/ruoloDb'
import { TAG_CARICO_CONFERME } from '@/lib/conferme/caricoConfermeDb'

export async function aggiornaCaricoConferme(): Promise<{ success: boolean }> {
    if (!(await conRuoloDb(['ADMIN']))) return { success: false }
    updateTag(TAG_CARICO_CONFERME)
    return { success: true }
}
