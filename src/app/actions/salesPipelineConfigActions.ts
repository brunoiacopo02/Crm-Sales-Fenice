"use server"

import { db } from "@/db"
import { appSettings } from "@/db/schema"
import { eq } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import {
    SALES_PIPELINE_CONFIG_KEY,
    DEFAULT_SALES_PIPELINE_CONFIG,
    parseSalesPipelineConfig,
    type SalesPipelineConfig,
} from "@/lib/salesPipeline/config"

/**
 * Lettura senza sessione: la usa anche il webhook AC, che gira senza utente.
 * Non fallisce mai: se il DB non risponde, la pipeline risulta spenta e il
 * routing di sempre prosegue indisturbato.
 */
export async function readSalesPipelineConfig(): Promise<SalesPipelineConfig> {
    try {
        const rows = await db.select().from(appSettings)
            .where(eq(appSettings.key, SALES_PIPELINE_CONFIG_KEY))
        return parseSalesPipelineConfig(rows[0]?.value)
    } catch (e) {
        console.error('[sales-pipeline] lettura config fallita, pipeline considerata spenta', e)
        return DEFAULT_SALES_PIPELINE_CONFIG
    }
}

export async function getSalesPipelineConfig(): Promise<SalesPipelineConfig> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!['ADMIN', 'MANAGER'].includes(ctx.role)) {
        return DEFAULT_SALES_PIPELINE_CONFIG
    }
    return await readSalesPipelineConfig()
}

export async function setSalesPipelineConfig(
    next: SalesPipelineConfig,
): Promise<{ success: boolean; error?: string; config?: SalesPipelineConfig }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!['ADMIN', 'MANAGER'].includes(ctx.role)) {
        return { success: false, error: 'Solo ADMIN e MANAGER possono cambiare questa configurazione.' }
    }
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Non autenticato.' }

    // Si normalizza con lo stesso parser della lettura: cosi' quello che si
    // salva e quello che si rilegge non possono divergere.
    const clean = parseSalesPipelineConfig(JSON.stringify(next))
    if (next.enabled && !clean.enabled) {
        return { success: false, error: 'Per accendere la pipeline serve scegliere un venditore.' }
    }

    await db.insert(appSettings).values({
        key: SALES_PIPELINE_CONFIG_KEY,
        value: JSON.stringify(clean),
        updatedBy: user.id,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify(clean), updatedBy: user.id, updatedAt: new Date() },
    })

    return { success: true, config: clean }
}
