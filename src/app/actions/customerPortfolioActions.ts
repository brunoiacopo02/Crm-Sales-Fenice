"use server"
import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { customerPortfolios, users } from "@/db/schema"
import { eq, and, desc, asc, sql } from "drizzle-orm"
import crypto from "crypto"
import { currentTenant, assertSalesArea } from '@/lib/tenancy'

type SessionUser = { id: string; role: string; email?: string; name?: string }

async function getSession(): Promise<{ user: SessionUser } | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    return {
        user: {
            id: user.id,
            role: user.user_metadata?.role,
            email: user.email,
            name: user.user_metadata?.name,
        },
    }
}

function isManager(role: string | undefined): boolean {
    return role === 'MANAGER' || role === 'ADMIN'
}

function canEditCustomer(session: { user: SessionUser }, customerSalespersonUserId: string): boolean {
    if (isManager(session.user.role)) return true
    if (session.user.role === 'VENDITORE' && session.user.id === customerSalespersonUserId) return true
    return false
}

// ───────────────────────────────────────────────────────────────────────────
// READ
// ───────────────────────────────────────────────────────────────────────────

/**
 * Lista clienti del portafoglio.
 * - VENDITORE: solo i propri
 * - MANAGER/ADMIN: tutti (con possibilità di filtrare via salespersonUserIdFilter)
 */
export async function listCustomerPortfolios(salespersonUserIdFilter?: string) {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session) throw new Error("Unauthorized")

    const conditions = [eq(customerPortfolios.companyId, ctx.companyId)]
    if (session.user.role === 'VENDITORE') {
        conditions.push(eq(customerPortfolios.salespersonUserId, session.user.id))
    } else if (isManager(session.user.role)) {
        if (salespersonUserIdFilter) {
            conditions.push(eq(customerPortfolios.salespersonUserId, salespersonUserIdFilter))
        }
    } else {
        throw new Error("Unauthorized")
    }

    const rows = await db
        .select({
            id: customerPortfolios.id,
            salespersonUserId: customerPortfolios.salespersonUserId,
            salespersonName: users.displayName,
            salespersonRealName: users.name,
            firstName: customerPortfolios.firstName,
            lastName: customerPortfolios.lastName,
            email: customerPortfolios.email,
            phone: customerPortfolios.phone,
            course: customerPortfolios.course,
            packageType: customerPortfolios.packageType,
            contractAmountEur: customerPortfolios.contractAmountEur,
            contractSignedAt: customerPortfolios.contractSignedAt,
            followUpMessageSent: customerPortfolios.followUpMessageSent,
            followUpMessageSentAt: customerPortfolios.followUpMessageSentAt,
            followUpResponded: customerPortfolios.followUpResponded,
            appointmentSet: customerPortfolios.appointmentSet,
            outcome: customerPortfolios.outcome,
            upsellAmountEur: customerPortfolios.upsellAmountEur,
            notes: customerPortfolios.notes,
            createdAt: customerPortfolios.createdAt,
            updatedAt: customerPortfolios.updatedAt,
        })
        .from(customerPortfolios)
        .leftJoin(users, eq(customerPortfolios.salespersonUserId, users.id))
        .where(and(...conditions))
        .orderBy(desc(customerPortfolios.contractSignedAt))

    return rows
}

/**
 * Lista venditori (per dropdown form). Solo manager/admin.
 */
export async function listSalespeople() {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session || !isManager(session.user.role)) throw new Error("Unauthorized")

    const rows = await db
        .select({
            id: users.id,
            displayName: users.displayName,
            name: users.name,
            email: users.email,
        })
        .from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'VENDITORE'), eq(users.isActive, true)))
        .orderBy(asc(users.displayName))

    return rows
}

// ───────────────────────────────────────────────────────────────────────────
// CREATE
// ───────────────────────────────────────────────────────────────────────────

export type CreateCustomerInput = {
    salespersonUserId: string
    firstName: string
    lastName: string
    email?: string | null
    phone?: string | null
    packageType: 'ADVANCE' | 'GOLD' | 'EXCLUSIVE'
    contractAmountEur: number
    contractSignedAt: Date
    notes?: string | null
}

export async function createCustomerPortfolio(input: CreateCustomerInput) {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session || !isManager(session.user.role)) throw new Error("Unauthorized")

    if (!input.firstName?.trim() || !input.lastName?.trim()) {
        return { success: false, error: 'Nome e cognome obbligatori' }
    }
    if (!['ADVANCE', 'GOLD', 'EXCLUSIVE'].includes(input.packageType)) {
        return { success: false, error: 'Pacchetto non valido' }
    }
    if (!(input.contractAmountEur > 0)) {
        return { success: false, error: 'Importo contratto deve essere > 0' }
    }
    if (!(input.contractSignedAt instanceof Date) || isNaN(input.contractSignedAt.getTime())) {
        return { success: false, error: 'Data firma non valida' }
    }

    // Verify salesperson exists and is VENDITORE
    const sp = (await db.select().from(users).where(and(eq(users.id, input.salespersonUserId), eq(users.companyId, ctx.companyId))))[0]
    if (!sp || sp.role !== 'VENDITORE') {
        return { success: false, error: 'Venditore non valido' }
    }

    const id = crypto.randomUUID()
    await db.insert(customerPortfolios).values({
        id,
        companyId: ctx.companyId,
        salespersonUserId: input.salespersonUserId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        course: 'SMM',
        packageType: input.packageType,
        contractAmountEur: input.contractAmountEur,
        contractSignedAt: input.contractSignedAt,
        notes: input.notes?.trim() || null,
        createdAt: new Date(),
        updatedAt: new Date(),
    })

    revalidatePath('/portafoglio-clienti')
    return { success: true, id }
}

// ───────────────────────────────────────────────────────────────────────────
// UPDATE — generico (manager only)
// ───────────────────────────────────────────────────────────────────────────

export type UpdateCustomerInput = {
    id: string
    firstName?: string
    lastName?: string
    email?: string | null
    phone?: string | null
    packageType?: 'ADVANCE' | 'GOLD' | 'EXCLUSIVE'
    contractAmountEur?: number
    contractSignedAt?: Date
    salespersonUserId?: string
    notes?: string | null
}

export async function updateCustomerPortfolio(input: UpdateCustomerInput) {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session || !isManager(session.user.role)) throw new Error("Unauthorized")

    const existing = (await db.select().from(customerPortfolios).where(and(eq(customerPortfolios.id, input.id), eq(customerPortfolios.companyId, ctx.companyId))))[0]
    if (!existing) return { success: false, error: 'Cliente non trovato' }

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (input.firstName !== undefined) patch.firstName = input.firstName.trim()
    if (input.lastName !== undefined) patch.lastName = input.lastName.trim()
    if (input.email !== undefined) patch.email = input.email?.trim() || null
    if (input.phone !== undefined) patch.phone = input.phone?.trim() || null
    if (input.packageType !== undefined) {
        if (!['ADVANCE', 'GOLD', 'EXCLUSIVE'].includes(input.packageType)) {
            return { success: false, error: 'Pacchetto non valido' }
        }
        patch.packageType = input.packageType
    }
    if (input.contractAmountEur !== undefined) patch.contractAmountEur = input.contractAmountEur
    if (input.contractSignedAt !== undefined) patch.contractSignedAt = input.contractSignedAt
    if (input.salespersonUserId !== undefined) patch.salespersonUserId = input.salespersonUserId
    if (input.notes !== undefined) patch.notes = input.notes?.trim() || null

    await db.update(customerPortfolios).set(patch).where(and(eq(customerPortfolios.id, input.id), eq(customerPortfolios.companyId, ctx.companyId)))

    revalidatePath('/portafoglio-clienti')
    return { success: true }
}

// ───────────────────────────────────────────────────────────────────────────
// FOLLOW-UP TOGGLES (venditore + manager)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Toggle "messaggio follow-up inviato".
 * Quando passa da false → true: imposta automaticamente outcome='IN_TRATTATIVA'
 * (se ancora null) e salva il timestamp.
 * Quando passa da true → false: resetta i campi follow-up dipendenti.
 */
export async function toggleFollowUpMessageSent(customerId: string, sent: boolean) {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session) throw new Error("Unauthorized")

    const existing = (await db.select().from(customerPortfolios).where(and(eq(customerPortfolios.id, customerId), eq(customerPortfolios.companyId, ctx.companyId))))[0]
    if (!existing) return { success: false, error: 'Cliente non trovato' }
    if (!canEditCustomer(session, existing.salespersonUserId)) throw new Error("Unauthorized")

    const patch: Record<string, unknown> = {
        followUpMessageSent: sent,
        followUpMessageSentAt: sent ? (existing.followUpMessageSentAt ?? new Date()) : null,
        updatedAt: new Date(),
    }

    if (sent) {
        // Auto-imposta IN_TRATTATIVA solo se outcome è null
        if (!existing.outcome) {
            patch.outcome = 'IN_TRATTATIVA'
        }
    } else {
        // Reset: torna allo stadio iniziale
        patch.outcome = null
        patch.followUpResponded = null
        patch.appointmentSet = null
        patch.upsellAmountEur = null
    }

    await db.update(customerPortfolios).set(patch).where(and(eq(customerPortfolios.id, customerId), eq(customerPortfolios.companyId, ctx.companyId)))

    revalidatePath('/portafoglio-clienti')
    return { success: true }
}

/**
 * Aggiorna i flag intermedi del follow-up (ha risposto / app fissato).
 * Non cambia outcome — quello si imposta solo via setOutcome.
 */
export async function updateFollowUpFlags(customerId: string, flags: {
    followUpResponded?: boolean | null
    appointmentSet?: boolean | null
}) {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session) throw new Error("Unauthorized")

    const existing = (await db.select().from(customerPortfolios).where(and(eq(customerPortfolios.id, customerId), eq(customerPortfolios.companyId, ctx.companyId))))[0]
    if (!existing) return { success: false, error: 'Cliente non trovato' }
    if (!canEditCustomer(session, existing.salespersonUserId)) throw new Error("Unauthorized")

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (flags.followUpResponded !== undefined) patch.followUpResponded = flags.followUpResponded
    if (flags.appointmentSet !== undefined) patch.appointmentSet = flags.appointmentSet

    await db.update(customerPortfolios).set(patch).where(and(eq(customerPortfolios.id, customerId), eq(customerPortfolios.companyId, ctx.companyId)))

    revalidatePath('/portafoglio-clienti')
    return { success: true }
}

/**
 * Imposta l'esito finale dell'upsell.
 * - 'CHIUSO' richiede upsellAmountEur > 0
 * - 'NON_CHIUSO' azzera upsellAmountEur
 * - 'IN_TRATTATIVA' (riapre) → azzera upsellAmountEur
 * - null → resetta outcome e azzera upsellAmountEur
 *
 * Nota: il record resta SEMPRE in "Pacchetto Clienti" (master).
 */
export async function setCustomerOutcome(customerId: string, outcome: 'IN_TRATTATIVA' | 'CHIUSO' | 'NON_CHIUSO' | null, upsellAmountEur?: number | null) {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session) throw new Error("Unauthorized")

    const existing = (await db.select().from(customerPortfolios).where(and(eq(customerPortfolios.id, customerId), eq(customerPortfolios.companyId, ctx.companyId))))[0]
    if (!existing) return { success: false, error: 'Cliente non trovato' }
    if (!canEditCustomer(session, existing.salespersonUserId)) throw new Error("Unauthorized")

    if (outcome === 'CHIUSO') {
        if (!upsellAmountEur || upsellAmountEur <= 0) {
            return { success: false, error: 'Importo upsell obbligatorio per chiusura' }
        }
    }

    const patch: Record<string, unknown> = {
        outcome,
        upsellAmountEur: outcome === 'CHIUSO' ? upsellAmountEur : null,
        updatedAt: new Date(),
    }

    // Se viene impostato un outcome ma il messaggio non risulta inviato, lo
    // marchiamo come inviato (il venditore non può essere in trattativa senza
    // aver mandato il messaggio).
    if (outcome && !existing.followUpMessageSent) {
        patch.followUpMessageSent = true
        patch.followUpMessageSentAt = new Date()
    }

    await db.update(customerPortfolios).set(patch).where(and(eq(customerPortfolios.id, customerId), eq(customerPortfolios.companyId, ctx.companyId)))

    revalidatePath('/portafoglio-clienti')
    return { success: true }
}

// ───────────────────────────────────────────────────────────────────────────
// DELETE (manager only)
// ───────────────────────────────────────────────────────────────────────────

export async function deleteCustomerPortfolio(customerId: string) {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session || !isManager(session.user.role)) throw new Error("Unauthorized")

    await db.delete(customerPortfolios).where(and(eq(customerPortfolios.id, customerId), eq(customerPortfolios.companyId, ctx.companyId)))

    revalidatePath('/portafoglio-clienti')
    return { success: true }
}

// ───────────────────────────────────────────────────────────────────────────
// AGGREGATES (per badge sui tab)
// ───────────────────────────────────────────────────────────────────────────

export async function getCustomerPortfolioCounts(salespersonUserIdFilter?: string) {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    const session = await getSession()
    if (!session) throw new Error("Unauthorized")

    const conditions = [eq(customerPortfolios.companyId, ctx.companyId)]
    if (session.user.role === 'VENDITORE') {
        conditions.push(eq(customerPortfolios.salespersonUserId, session.user.id))
    } else if (isManager(session.user.role)) {
        if (salespersonUserIdFilter) {
            conditions.push(eq(customerPortfolios.salespersonUserId, salespersonUserIdFilter))
        }
    } else {
        throw new Error("Unauthorized")
    }

    const baseWhere = and(...conditions)

    const [totalRow] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(customerPortfolios)
        .where(baseWhere)

    const [trattativaRow] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(customerPortfolios)
        .where(baseWhere ? and(baseWhere, eq(customerPortfolios.outcome, 'IN_TRATTATIVA')) : eq(customerPortfolios.outcome, 'IN_TRATTATIVA'))

    const [nonChiusoRow] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(customerPortfolios)
        .where(baseWhere ? and(baseWhere, eq(customerPortfolios.outcome, 'NON_CHIUSO')) : eq(customerPortfolios.outcome, 'NON_CHIUSO'))

    const [chiusoRow] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(customerPortfolios)
        .where(baseWhere ? and(baseWhere, eq(customerPortfolios.outcome, 'CHIUSO')) : eq(customerPortfolios.outcome, 'CHIUSO'))

    return {
        all: totalRow?.c ?? 0,
        inTrattativa: trattativaRow?.c ?? 0,
        nonChiuso: nonChiusoRow?.c ?? 0,
        chiuso: chiusoRow?.c ?? 0,
    }
}
