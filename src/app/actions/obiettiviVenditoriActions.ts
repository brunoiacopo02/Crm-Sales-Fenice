"use server"

// Obiettivi di fatturato (sul FIRMATO) e guadagni dei venditori, per mese
// (PO 29/10/2026). Solo ADMIN e MANAGER, ruolo verificato anche sul DB.
// Il venditore vede il proprio guadagno da /miei-incassi (pagina server).

import { db } from "@/db"
import { users, salesMonthlyTargets } from "@/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { haRuoloDb } from "@/lib/auth/ruoloDb"
import { currentTenant, assertSalesArea, companyScope, type TenantContext } from "@/lib/tenancy"
import { validaObiettivi } from "@/lib/venditore/obiettivi"
import { loadGuadagniMese, loadObiettiviMese, type GuadagnoVenditore, type ObiettiviVenditore } from "@/lib/venditore/obiettiviDb"
import { incassiCommissioneMese, multeByUser, type IncassoView } from "@/lib/gestionale/queries"
import { revalidatePath } from "next/cache"

const RUOLI = ["ADMIN", "MANAGER"] as const
const YM = /^\d{4}-(0[1-9]|1[0-2])$/

async function requireManager(): Promise<{ id: string; ctx: TenantContext }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !role || !(RUOLI as readonly string[]).includes(role)) throw new Error("Unauthorized")
    if (!(await haRuoloDb(user.id, RUOLI))) throw new Error("Unauthorized")
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return { id: user.id, ctx }
}

/** Solo gli obiettivi del mese, per la schermata di modifica in /kpi-venditori. */
export async function getObiettiviMese(ym: string): Promise<ObiettiviVenditore[]> {
    const { ctx } = await requireManager()
    if (!YM.test(ym)) throw new Error("Mese non valido")
    return loadObiettiviMese(ym, companyScope(ctx, users.companyId))
}

export type CommissioneVenditore = GuadagnoVenditore & {
    multeCents: number
    incassi: Pick<IncassoView, "id" | "data" | "cliente" | "importoCents" | "voce" | "contaCommissione">[]
}

/**
 * Commissioni del mese di TUTTI i venditori (Performance venditori, per
 * controllare le fatture). Stesso calcolo di "I miei incassi"
 * (loadGuadagniMese), piu' multe e incassi riga per riga.
 */
export async function getCommissioniVenditori(ym: string): Promise<CommissioneVenditore[]> {
    const { ctx } = await requireManager()
    if (!YM.test(ym)) throw new Error("Mese non valido")
    const [righe, multe, incassi] = await Promise.all([
        loadGuadagniMese(ym, { companyFilter: companyScope(ctx, users.companyId) }),
        multeByUser(ym),
        incassiCommissioneMese(ym),
    ])
    return righe.map(r => ({
        ...r,
        multeCents: Math.round((multe.get(r.salesUserId) ?? 0) * 100),
        incassi: incassi
            .filter(i => i.salesUserId === r.salesUserId)
            .map(i => ({ id: i.id, data: i.data, cliente: i.cliente, importoCents: i.importoCents, voce: i.voce, contaCommissione: i.contaCommissione })),
    }))
}

/**
 * Salva gli obiettivi del mese `ym` (una riga per venditore). Vale anche per i
 * mesi dopo, finche' qualcuno non salva un mese successivo.
 */
export async function saveObiettiviVenditori(
    ym: string,
    righe: { salesUserId: string; target1Eur: number | null; target2Eur: number | null }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
    const { id, ctx } = await requireManager()
    if (!YM.test(ym)) return { ok: false, error: "Mese non valido" }
    for (const r of righe) {
        const err = validaObiettivi(r.target1Eur, r.target2Eur)
        if (err) return { ok: false, error: err }
    }
    const ids = righe.map(r => r.salesUserId)
    if (ids.length === 0) return { ok: true }
    const venditori = await db.select({ id: users.id, companyId: users.companyId }).from(users)
        .where(and(inArray(users.id, ids), eq(users.role, "VENDITORE"), companyScope(ctx, users.companyId)))
    if (venditori.length !== new Set(ids).size) return { ok: false, error: "Venditore non trovato" }
    const azienda = new Map(venditori.map(v => [v.id, v.companyId]))
    await db.transaction(async (tx) => {
        for (const r of righe) {
            await tx.insert(salesMonthlyTargets).values({
                salesUserId: r.salesUserId,
                yearMonth: ym,
                companyId: azienda.get(r.salesUserId)!,
                target1Eur: r.target1Eur,
                target2Eur: r.target2Eur,
                updatedAt: new Date(),
                updatedBy: id,
            }).onConflictDoUpdate({
                target: [salesMonthlyTargets.salesUserId, salesMonthlyTargets.yearMonth],
                set: { target1Eur: r.target1Eur, target2Eur: r.target2Eur, updatedAt: new Date(), updatedBy: id },
            })
        }
    })
    revalidatePath("/kpi-venditori")
    revalidatePath("/miei-incassi")
    revalidatePath("/performance-venditori")
    return { ok: true }
}
