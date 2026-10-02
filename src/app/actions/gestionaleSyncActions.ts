"use server"

import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"
import { runGestionaleSync, type SyncResult } from "@/lib/gestionale/run"

/** Pulsante "Aggiorna adesso" di /incassi. Unico export: il gate admin è dentro. */
export async function aggiornaIncassiAdesso(): Promise<SyncResult> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") throw new Error("Unauthorized")
    const result = await runGestionaleSync("manuale")
    revalidatePath("/incassi")
    revalidatePath("/miei-incassi")
    return result
}
