"use server"

import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { leggiCodaIaVocale, type LeadIaVocale } from "@/lib/iaVocaleQuery"

export type { LeadIaVocale }

/** Coda dell'IA vocale per la pagina admin /ia-vocale (vedi lib/iaVocaleQuery.ts). */
export async function getIaVocaleLeads(): Promise<LeadIaVocale[]> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !['ADMIN', 'MANAGER'].includes(role ?? '')) throw new Error('Unauthorized')
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return leggiCodaIaVocale(ctx.companyId)
}
