"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, users, assignmentSettings, importLogs } from "@/db/schema"
import { eq, or } from "drizzle-orm"
import crypto from "crypto"
import { logLeadEvent } from "@/lib/eventLogger"
import { previewLeadDistribution } from "@/lib/distributionUtils"

export type AssignmentMode = 'equal' | 'custom_quota'

// Server Action for managing settings
export async function getAssignmentSettings() {
    const defaultSettings = { mode: 'equal' as AssignmentMode, settings: {} }
    const st = (await db.select().from(assignmentSettings).limit(1))[0]
    if (!st) return defaultSettings
    return {
        mode: st.mode as AssignmentMode,
        settings: st.settings as Record<string, number> || {}
    }
}

export async function getActiveGdosForImport() {
    return (await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        gdoCode: users.gdoCode,
        isActive: users.isActive
    })
        .from(users)
        .where(eq(users.role, 'GDO')))

        // Se un account non è mai stato toccato, o è disattivato, o null per qualche bug di mapping RPC...
        // ...vogliamo che filtri SOLO quelli esplicitamente e inequivocabilmente considerati "Attivi" (true)
        .filter((u: any) => {
            if (u.isActive === true) return true;
            return false;
        })
}

export async function saveAssignmentSettings(mode: AssignmentMode, settings: Record<string, number>) {
    const st = (await db.select().from(assignmentSettings).limit(1))[0]
    const now = new Date()
    if (st) {
        await db.update(assignmentSettings)
            .set({ mode, settings, updatedAt: now, updatedBy: 'SYSTEM' })
            .where(eq(assignmentSettings.id, st.id))

    } else {
        await db.insert(assignmentSettings).values({
            id: crypto.randomUUID(),
            mode,
            settings,
            updatedAt: now,
            updatedBy: 'SYSTEM'
        })
    }
    return true
}

export type CsvRowPayload = {
    rowIndex: number
    nome: string
    email: string
    telefono: string
    cognome: string // used as funnel
}

export type ImportReport = {
    total: number
    inserted: number
    rejected: number
    errors: string[]
    perGdoAssigned: Record<string, number>
}

export async function processCsvImport(
    rows: CsvRowPayload[],
    modeOptions?: { mode: AssignmentMode, customSettings: Record<string, number> },
    importOptions?: { allowDuplicates?: boolean }
): Promise<ImportReport> {
    const report: ImportReport = {
        total: rows.length,
        inserted: 0,
        rejected: 0,
        errors: [],
        perGdoAssigned: {}
    }

    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    const adminId = session?.user?.id || undefined

    // Carica GDO Attivi (Solo quelli rigorosamente true)
    const activeGdos = (await db.select().from(users).where(eq(users.role, 'GDO')))
        .filter((u: any) => {
            if (u.isActive === true) return true;
            return false;
        })
    if (activeGdos.length === 0) {
        throw new Error("Impossibile importare: Nessun utente GDO è flaggato come Attivo per ricevere the Lead.")
    }

    // Carica settings attuali o ricevuti dal client
    let mode: AssignmentMode = 'equal'
    let settings: Record<string, number> = {}

    if (modeOptions) {
        mode = modeOptions.mode
        settings = modeOptions.customSettings
    } else {
        const stored = await getAssignmentSettings()
        mode = stored.mode
        settings = stored.settings
    }

    const validLeadsToInsert: { name: string, email: string | null, phone: string, funnel: string, rowIndex: number }[] = []
    const processedPhones = new Set<string>()
    const processedEmails = new Set<string>()

    const allowDuplicates = importOptions?.allowDuplicates ?? false

    for (const row of rows) {
        try {
            const name = row.nome?.trim() || 'Lead senza nome'
            let phone = row.telefono?.trim()
            let rawEmail = row.email?.trim()
            const funnel = row.cognome?.trim()

            // 1. Validation Funnel (obbligatorio)
            if (!funnel) {
                report.rejected++
                report.errors.push(`Riga ${row.rowIndex}: "Cognome" (Funnel) vuoto o mancante per ${name}.`)
                continue
            }

            // 2. Validation Phone (obbligatorio, minimo 5 cifre)
            if (!phone) {
                report.rejected++
                report.errors.push(`Riga ${row.rowIndex}: "Telefono1" vuoto per ${name}.`)
                continue
            }
            phone = phone.replace(/[^\d+]/g, '')
            if (phone.length < 5) {
                report.rejected++
                report.errors.push(`Riga ${row.rowIndex}: Telefono non valido (${row.telefono}) per ${name}.`)
                continue
            }

            // 3. Email (opzionale)
            let email: string | null = null
            if (rawEmail && rawEmail.includes('@') && rawEmail.includes('.')) {
                email = rawEmail
            }

            // 4. Deduplication (skippabile con allowDuplicates)
            if (!allowDuplicates) {
                const logicConditions = [eq(leads.phone, phone)]
                if (email) {
                    logicConditions.push(eq(leads.email, email))
                }

                const existingLead = (await db.select().from(leads).where(or(...logicConditions)))[0]

                if (existingLead || processedPhones.has(phone) || (email && processedEmails.has(email))) {
                    report.rejected++
                    report.errors.push(`Riga ${row.rowIndex}: Scartato (Duplicato) - Telefono o Email già presenti nel CRM o doppi in questo file per [${name}].`)
                    continue
                }
            }

            processedPhones.add(phone)
            if (email) processedEmails.add(email)

            // Invece di fare 'insert' lo pushiamo su Array temporaneo per l'assegnazione
            validLeadsToInsert.push({ name, email, phone, funnel, rowIndex: row.rowIndex })

        } catch (error: any) {
            report.rejected++
            report.errors.push(`Riga ${row.rowIndex}: Errore imprevisto - ${error.message}`)
        }
    }

    // Esegui la Preview di Assegnazione sui Valid
    const distribution = previewLeadDistribution(validLeadsToInsert.length, activeGdos, mode, settings)

    // Spiana l'oggetto in un Array Piatto mappato 1:1 con i validi, mantenendo l'ordine
    const assignmentPlan: string[] = [] // Conterra' l'ID del GDO da assegnare per ogni idx.
    for (const gdoId in distribution) {
        for (let i = 0; i < distribution[gdoId].count; i++) {
            assignmentPlan.push(gdoId)
        }
    }

    // Mescolamento o assegnamento sequenziale
    // Useremo un assegnamento sequenziale come estratto dal distributionPlan.

    // Ora Eseguiamo le vere insert
    const duplicateCount = report.rejected // The ones rejected by deduplication + invalid
    const invalidCount = rows.length - validLeadsToInsert.length - duplicateCount

    const batchId = crypto.randomUUID()
    const recordMap: Record<string, number> = {}

    for (let i = 0; i < validLeadsToInsert.length; i++) {
        const leadPayload = validLeadsToInsert[i]
        const assignedGdoId = assignmentPlan[i] || activeGdos[0].id // Fallback sicurissimo

        const newLeadId = crypto.randomUUID()
        await db.insert(leads).values({
            id: newLeadId,
            name: leadPayload.name,
            phone: leadPayload.phone,
            email: leadPayload.email,
            funnel: leadPayload.funnel,
            status: 'NEW',
            callCount: 0,
            assignedToId: assignedGdoId,
            createdAt: new Date(),
            updatedAt: new Date(),
        })

        await logLeadEvent({
            leadId: newLeadId,
            eventType: 'IMPORTED',
            toSection: 'Prima Chiamata'
        })

        // Log assegnazione originaria
        await logLeadEvent({
            leadId: newLeadId,
            eventType: 'ASSIGNED',
            userId: adminId, // Usa l'id del manager loggato o lascia null se in fallback
            metadata: { assignedToUser: assignedGdoId }
        })

        recordMap[assignedGdoId] = (recordMap[assignedGdoId] || 0) + 1
        report.inserted++
    }

    // Salva Log Import
    await db.insert(importLogs).values({
        id: batchId,
        totalRows: report.total,
        importedCount: report.inserted,
        duplicateCount: duplicateCount > 0 ? duplicateCount : 0,
        invalidCount: invalidCount > 0 ? invalidCount : 0,
        perGdoAssigned: recordMap,
        createdAt: new Date(),
    })

    report.perGdoAssigned = recordMap

    return report
}

// --- Manual single lead creation ---

export type ManualLeadInput = {
    nome: string
    telefono: string
    email?: string
    funnel: string
}

export async function createManualLead(input: ManualLeadInput): Promise<{ success: boolean; error?: string; leadId?: string }> {
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    if (!supabaseUser) return { success: false, error: "Non autenticato" }
    const adminId = supabaseUser.id

    // Validate funnel (required)
    const funnel = input.funnel?.trim()
    if (!funnel) return { success: false, error: "Il campo Funnel è obbligatorio." }

    // Validate phone (required, min 5 digits)
    let phone = input.telefono?.trim()
    if (!phone) return { success: false, error: "Il campo Telefono è obbligatorio." }
    phone = phone.replace(/[^\d+]/g, '')
    if (phone.length < 5) return { success: false, error: "Telefono non valido (minimo 5 cifre)." }

    // Validate email (optional)
    let email: string | null = null
    const rawEmail = input.email?.trim()
    if (rawEmail && rawEmail.includes('@') && rawEmail.includes('.')) {
        email = rawEmail
    }

    const name = input.nome?.trim() || 'Lead senza nome'

    // Deduplication check
    const logicConditions = [eq(leads.phone, phone)]
    if (email) logicConditions.push(eq(leads.email, email))
    const existingLead = (await db.select({ id: leads.id }).from(leads).where(or(...logicConditions)))[0]
    if (existingLead) return { success: false, error: "Lead duplicato: telefono o email già presenti nel CRM." }

    // Get active GDOs and assign using stored settings
    const activeGdos = (await db.select().from(users).where(eq(users.role, 'GDO')))
        .filter((u: any) => u.isActive === true)
    if (activeGdos.length === 0) return { success: false, error: "Nessun GDO attivo per l'assegnazione." }

    const stored = await getAssignmentSettings()
    const distribution = previewLeadDistribution(1, activeGdos, stored.mode, stored.settings)
    const assignedGdoId = Object.entries(distribution).find(([, v]) => v.count > 0)?.[0] || activeGdos[0].id

    const newLeadId = crypto.randomUUID()
    await db.insert(leads).values({
        id: newLeadId,
        name,
        phone,
        email,
        funnel,
        status: 'NEW',
        callCount: 0,
        assignedToId: assignedGdoId,
        createdAt: new Date(),
        updatedAt: new Date(),
    })

    await logLeadEvent({
        leadId: newLeadId,
        eventType: 'IMPORTED',
        toSection: 'Prima Chiamata',
        metadata: { source: 'manual' }
    })

    await logLeadEvent({
        leadId: newLeadId,
        eventType: 'ASSIGNED',
        userId: adminId,
        metadata: { assignedToUser: assignedGdoId, source: 'manual' }
    })

    return { success: true, leadId: newLeadId }
}
