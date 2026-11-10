"use server"

// Pulsante "Aggiorna ora" della pagina dei lead brochure (PO 10/11/2026): butta
// la cache di 45 secondi e rilegge subito. Stessi accessi di Marketing Analytics.

import { updateTag } from 'next/cache'
import { puoVedereMarketing } from '@/lib/brochure/accesso'
import { TAG_BROCHURE } from '@/lib/brochure/brochureDb'

export async function aggiornaBrochure(): Promise<{ success: boolean }> {
    if (!(await puoVedereMarketing())) return { success: false }
    updateTag(TAG_BROCHURE)
    return { success: true }
}
