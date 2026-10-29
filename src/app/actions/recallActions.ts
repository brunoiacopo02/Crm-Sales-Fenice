"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads } from "@/db/schema"
import { eq, and, ne, isNotNull, asc, lte, or, inArray } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { leadDelMondoDiAccount, rifiutoMondoDiverso } from "@/lib/prova/sql"
import { leadsPerGdo, noteDelBotSulLead } from "@/lib/diretta/noteBotDb"
import { notaDaSalvareDalGdo } from "@/lib/diretta/noteBotPerGdo"
export async function getRecallLeads() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    const now = new Date()

    // We fetch leads that:
    // 1. Are NOT REJECTED or APPOINTMENT
    // 2. Have a recallDate set

    const conditions = [
        eq(leads.companyId, ctx.companyId),
        // Prova (migr. 0050): ognuno vede i richiami della sua parte.
        leadDelMondoDiAccount(userId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNotNull(leads.recallDate)
    ]

    if (isGdo) conditions.push(eq(leads.assignedToId, userId))

    const allRecallsDb = await db.select()
            .from(leads)
            .where(and(...conditions))
            .orderBy(asc(leads.recallDate))
    // Al GDO le note del bot non arrivano al browser (PO 25/10 e 29/10/2026).
    const allRecalls = isGdo ? await leadsPerGdo(allRecallsDb) : allRecallsDb
        

    // Split into "Scaduti/Da Fare Ora" and "In Arrivo"
    const expired = allRecalls.filter(l => l.recallDate && l.recallDate <= now)
    const upcoming = allRecalls.filter(l => l.recallDate && l.recallDate > now)

    return { expired, upcoming }
}

/**
 * Modifica un richiamo esistente (data e/o note) SENZA loggare una chiamata
 * e senza incrementare callCount — a differenza di updateLeadOutcome('RICHIAMO').
 * Usata dal pulsante "Modifica richiamo" sulle card: per ri-programmare basta
 * la nuova data, le note restano quelle precedenti se non toccate.
 */
export async function updateRecallDetails(leadId: string, recallDate: Date, note: string | null) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const [lead] = await db.select({
        id: leads.id,
        isTest: leads.isTest,
        assignedToId: leads.assignedToId,
        recallDate: leads.recallDate,
        recallNote: leads.recallNote,
        version: leads.version,
    })
        .from(leads)
        .where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId)))
        .limit(1)
    if (!lead) return { success: false as const, error: 'Lead non trovato' }
    const rifiuto = await rifiutoMondoDiverso(lead, ctx.userId)
    if (rifiuto) return { success: false as const, error: rifiuto }
    if (ctx.role === 'GDO' && lead.assignedToId !== ctx.userId) {
        return { success: false as const, error: 'Lead non assegnato a te' }
    }
    if (!lead.recallDate) {
        return { success: false as const, error: 'Il lead non ha un richiamo attivo' }
    }

    // Il GDO non ha visto la nota del bot: se salva il richiamo senza nota, quella
    // resta per le Conferme e gli admin invece di sparire.
    const notaDaSalvare = ctx.role === 'GDO'
        ? notaDaSalvareDalGdo(note, lead.recallNote, await noteDelBotSulLead(leadId))
        : note

    await db.update(leads)
        .set({
            recallDate,
            recallNote: notaDaSalvare,
            recallMissedAt: null,
            version: lead.version + 1,
            updatedAt: new Date(),
        })
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, lead.version),
        ))

    return { success: true as const }
}

/**
 * Richiami imminenti (entro 30 min) o scaduti sulle ALTRE aziende dell'utente.
 * Serve all'avviso cross-company: "stai lavorando su Fenice ma hai un richiamo
 * Serenamente" (e viceversa). Sola lettura, volutamente fuori dallo scope
 * single-company: mostra solo lead assegnati all'utente stesso.
 */
export async function getCrossCompanyRecalls() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.isAllCompanies) return []
    const otherCompanies = ctx.allowedCompanies.filter(c => c !== ctx.companyId)
    if (otherCompanies.length === 0) return []

    const soon = new Date(Date.now() + 30 * 60 * 1000)
    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        recallDate: leads.recallDate,
        companyId: leads.companyId,
    })
        .from(leads)
        .where(and(
            inArray(leads.companyId, otherCompanies),
            eq(leads.assignedToId, ctx.userId),
            ne(leads.status, 'REJECTED'),
            ne(leads.status, 'APPOINTMENT'),
            isNotNull(leads.recallDate),
            lte(leads.recallDate, soon),
        ))
        .orderBy(asc(leads.recallDate))
        .limit(5)

    return rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        recallDate: r.recallDate ? r.recallDate.toISOString() : null,
        companyId: r.companyId,
    }))
}
