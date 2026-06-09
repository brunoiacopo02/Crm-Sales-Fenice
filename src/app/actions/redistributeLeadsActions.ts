"use server"

import { db } from "@/db"
import { leads, leadEvents, users, notifications } from "@/db/schema"
import { and, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import crypto from "crypto"

// ────────────────────────────────────────────────────────────────────────────
// Riassegnazione lead "in coda" da un GDO sorgente a uno o più GDO destinatari.
// Pensata per l'admin che vede un GDO sommerso o assente: sposta in blocco le
// chiamate che non riesce a fare verso colleghi più liberi.
//
// Sezioni supportate (mappate sulle stesse pipeline GDO):
//   '1' = Prima chiamata  (callCount=0, no recallDate, status NEW/IN_PROGRESS)
//   '2' = Seconda chiamata (callCount=1, no recallDate, status NEW/IN_PROGRESS)
//   '3' = Terza chiamata   (callCount=2, no recallDate, status NEW/IN_PROGRESS)
//   'recall' = Richiami    (recallDate IS NOT NULL, status NEW/IN_PROGRESS)
//
// Ordine di selezione: i più nuovi prima (createdAt DESC), così se Bruno chiede
// "20 dei 50 della 1ª chiamata" prendo i 20 arrivati per ultimi.
// ────────────────────────────────────────────────────────────────────────────

export type RedistributionSection = '1' | '2' | '3' | 'recall'
export type RedistributionMode = 'equal' | 'custom_quota'

export type RedistributionInput = {
    sourceGdoId: string
    section: RedistributionSection
    funnels?: string[] | null  // null/undefined = tutti i funnel
    limit?: number | null      // null/undefined = tutti i lead matching
    mode: RedistributionMode
    targetGdoIds: string[]
    customQuotas?: Record<string, number>  // solo se mode = 'custom_quota'
}

export type RedistributionPreviewRow = {
    targetGdoId: string
    targetGdoName: string
    count: number
}

export type RedistributionPreviewResult = {
    totalMatching: number
    totalToMove: number
    perTarget: RedistributionPreviewRow[]
    funnelsAvailable: { funnel: string; count: number }[]
}

export type RedistributionExecuteResult = {
    success: boolean
    error?: string
    moved?: number
    perTarget?: Record<string, number>
}

// Sorgente virtuale: '__unassigned__' = lead non ancora assegnati (assignedToId IS NULL).
const UNASSIGNED_SOURCE = '__unassigned__'
function sourceMatch(sourceGdoId: string) {
    return sourceGdoId === UNASSIGNED_SOURCE ? isNull(leads.assignedToId) : eq(leads.assignedToId, sourceGdoId)
}

function buildSectionConditions(section: RedistributionSection) {
    const base = [
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
    ]
    if (section === 'recall') {
        return [...base, isNotNull(leads.recallDate)]
    }
    // sezioni 1/2/3: pipeline normale, niente recall
    const callCountValue = section === '1' ? 0 : section === '2' ? 1 : 2
    return [...base, isNull(leads.recallDate), eq(leads.callCount, callCountValue)]
}

async function assertAdmin() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false as const, error: 'Non autenticato.' }
    const role = (user.user_metadata as any)?.role
    if (role !== 'ADMIN') return { ok: false as const, error: 'Solo gli ADMIN possono ridistribuire i lead.' }
    return { ok: true as const, userId: user.id }
}

async function getRedistributionFunnelsInternal(sourceGdoId: string, section: RedistributionSection, companyId: string): Promise<{ funnel: string; count: number }[]> {
    if (!sourceGdoId) return []
    const conditions = [
        eq(leads.companyId, companyId),
        sourceMatch(sourceGdoId),
        ...buildSectionConditions(section),
    ]
    const rows = await db
        .select({ funnel: leads.funnel, count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(...conditions))
        .groupBy(leads.funnel)
    return rows
        .map(r => ({ funnel: r.funnel || '(vuoto)', count: Number(r.count) || 0 }))
        .sort((a, b) => b.count - a.count)
}

export async function getRedistributionFunnels(sourceGdoId: string, section: RedistributionSection): Promise<{ funnel: string; count: number }[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return getRedistributionFunnelsInternal(sourceGdoId, section, ctx.companyId)
}

export async function getRedistributionPreview(input: Omit<RedistributionInput, 'targetGdoIds' | 'mode' | 'customQuotas'> & {
    targetGdoIds: string[]
    mode: RedistributionMode
    customQuotas?: Record<string, number>
}): Promise<RedistributionPreviewResult> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!input.sourceGdoId || !input.section || !Array.isArray(input.targetGdoIds)) {
        return { totalMatching: 0, totalToMove: 0, perTarget: [], funnelsAvailable: [] }
    }

    const sectionConds = buildSectionConditions(input.section)
    const baseConds = [eq(leads.companyId, ctx.companyId), sourceMatch(input.sourceGdoId), ...sectionConds]

    const funnelsAvailable = await getRedistributionFunnelsInternal(input.sourceGdoId, input.section, ctx.companyId)

    // Conteggio totale (con eventuale filtro funnel applicato)
    const allConds = [...baseConds]
    if (input.funnels && input.funnels.length > 0) {
        // funnels può contenere '(vuoto)' per il NULL: lo gestisco a parte
        const hasNullSentinel = input.funnels.includes('(vuoto)')
        const realFunnels = input.funnels.filter(f => f !== '(vuoto)')
        if (realFunnels.length > 0 && hasNullSentinel) {
            allConds.push(sql`(${leads.funnel} IS NULL OR ${leads.funnel} IN (${sql.join(realFunnels.map(f => sql`${f}`), sql`, `)}))`)
        } else if (realFunnels.length > 0) {
            allConds.push(sql`${leads.funnel} IN (${sql.join(realFunnels.map(f => sql`${f}`), sql`, `)})`)
        } else if (hasNullSentinel) {
            allConds.push(isNull(leads.funnel))
        }
    }

    const countRow = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(...allConds))
    const totalMatching = Number(countRow[0]?.c) || 0

    const limit = (typeof input.limit === 'number' && input.limit > 0) ? Math.min(input.limit, totalMatching) : totalMatching
    const totalToMove = limit

    // Calcola distribuzione tra target
    const targetUsers = await db
        .select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users)
        .where(and(
            eq(users.role, 'GDO'),
            // operatore assegnabile se l'azienda attiva è tra le sue allowedCompanies,
            // con fallback al companyId per gli utenti legacy (allowed_companies NULL).
            or(
                sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
                and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
            ),
        ))
    const targetMap = new Map(targetUsers.map(u => [u.id, u.displayName || u.name || 'GDO']))

    const perTarget: RedistributionPreviewRow[] = input.targetGdoIds.map(id => ({
        targetGdoId: id,
        targetGdoName: targetMap.get(id) || 'GDO',
        count: 0,
    }))

    if (perTarget.length === 0 || totalToMove === 0) {
        return { totalMatching, totalToMove, perTarget, funnelsAvailable }
    }

    if (input.mode === 'equal') {
        let i = 0
        for (let n = 0; n < totalToMove; n++) {
            perTarget[i].count++
            i = (i + 1) % perTarget.length
        }
    } else {
        // custom_quota: rispetta le quote, fallback round-robin sull'eccedenza
        let remaining = totalToMove
        for (const row of perTarget) {
            if (remaining <= 0) break
            const q = Math.max(0, Math.floor(input.customQuotas?.[row.targetGdoId] || 0))
            const assignable = Math.min(q, remaining)
            row.count += assignable
            remaining -= assignable
        }
        if (remaining > 0) {
            let i = 0
            for (let n = 0; n < remaining; n++) {
                perTarget[i].count++
                i = (i + 1) % perTarget.length
            }
        }
    }

    return { totalMatching, totalToMove, perTarget, funnelsAvailable }
}

export async function executeLeadRedistribution(input: RedistributionInput): Promise<RedistributionExecuteResult> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const auth = await assertAdmin()
    if (!auth.ok) return { success: false, error: auth.error }

    if (!input.sourceGdoId) return { success: false, error: 'GDO sorgente mancante.' }
    if (!input.targetGdoIds || input.targetGdoIds.length === 0) return { success: false, error: 'Seleziona almeno un GDO destinatario.' }
    if (input.targetGdoIds.includes(input.sourceGdoId)) return { success: false, error: 'Il GDO sorgente non può essere anche destinatario.' }

    const sectionConds = buildSectionConditions(input.section)
    const baseConds = [eq(leads.companyId, ctx.companyId), sourceMatch(input.sourceGdoId), ...sectionConds]

    if (input.funnels && input.funnels.length > 0) {
        const hasNullSentinel = input.funnels.includes('(vuoto)')
        const realFunnels = input.funnels.filter(f => f !== '(vuoto)')
        if (realFunnels.length > 0 && hasNullSentinel) {
            baseConds.push(sql`(${leads.funnel} IS NULL OR ${leads.funnel} IN (${sql.join(realFunnels.map(f => sql`${f}`), sql`, `)}))`)
        } else if (realFunnels.length > 0) {
            baseConds.push(sql`${leads.funnel} IN (${sql.join(realFunnels.map(f => sql`${f}`), sql`, `)})`)
        } else if (hasNullSentinel) {
            baseConds.push(isNull(leads.funnel))
        }
    }

    // Pesco i lead matching ordinati dai più nuovi (createdAt DESC)
    const matchingRows = await db
        .select({ id: leads.id, callCount: leads.callCount, recallDate: leads.recallDate, status: leads.status })
        .from(leads)
        .where(and(...baseConds))
        .orderBy(desc(leads.createdAt))

    const limit = (typeof input.limit === 'number' && input.limit > 0)
        ? Math.min(input.limit, matchingRows.length)
        : matchingRows.length

    if (limit === 0) return { success: true, moved: 0, perTarget: {} }

    const toMove = matchingRows.slice(0, limit)

    // Costruisco lista assegnatari secondo modalità
    const assignmentList: string[] = []
    if (input.mode === 'equal') {
        let i = 0
        for (let n = 0; n < toMove.length; n++) {
            assignmentList.push(input.targetGdoIds[i])
            i = (i + 1) % input.targetGdoIds.length
        }
    } else {
        let remaining = toMove.length
        const queue: string[] = []
        for (const tid of input.targetGdoIds) {
            const q = Math.max(0, Math.floor(input.customQuotas?.[tid] || 0))
            const assignable = Math.min(q, remaining)
            for (let k = 0; k < assignable; k++) queue.push(tid)
            remaining -= assignable
            if (remaining <= 0) break
        }
        if (remaining > 0) {
            let i = 0
            for (let n = 0; n < remaining; n++) {
                queue.push(input.targetGdoIds[i])
                i = (i + 1) % input.targetGdoIds.length
            }
        }
        assignmentList.push(...queue)
    }

    // Determino la "section" testuale per il log (FROM == TO perché spostiamo
    // entro la stessa sezione operativa, cambia solo l'assignee).
    const sectionLabel = input.section === '1' ? 'Prima Chiamata'
        : input.section === '2' ? 'Seconda Chiamata'
        : input.section === '3' ? 'Terza Chiamata'
        : 'Richiami'

    // Lookup nomi target per metadata + notifiche
    const targetUsers = await db
        .select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users)
        .where(and(
            eq(users.role, 'GDO'),
            // operatore assegnabile se l'azienda attiva è tra le sue allowedCompanies,
            // con fallback al companyId per gli utenti legacy (allowed_companies NULL).
            or(
                sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
                and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
            ),
        ))
    const targetMap = new Map(targetUsers.map(u => [u.id, u.displayName || u.name || 'GDO']))

    const perTargetCount: Record<string, number> = {}
    const eventInserts: any[] = []
    const notificationInserts: any[] = []
    const updatePromises: Promise<unknown>[] = []
    const now = new Date()

    for (let i = 0; i < toMove.length; i++) {
        const lead = toMove[i]
        const newAssignee = assignmentList[i]
        perTargetCount[newAssignee] = (perTargetCount[newAssignee] || 0) + 1

        updatePromises.push(
            db.update(leads)
                .set({
                    assignedToId: newAssignee,
                    updatedAt: now,
                    version: sql`${leads.version} + 1`,
                })
                .where(eq(leads.id, lead.id))
        )

        eventInserts.push({
            id: crypto.randomUUID(),
            leadId: lead.id,
            eventType: 'REASSIGNED_ADMIN',
            userId: auth.userId,
            fromSection: sectionLabel,
            toSection: sectionLabel,
            metadata: {
                reason: 'admin_redistribution',
                fromAssigneeId: input.sourceGdoId,
                toAssigneeId: newAssignee,
                section: input.section,
                funnels: input.funnels || null,
                mode: input.mode,
            },
            timestamp: now,
        })
    }

    // Notifiche realtime ai GDO destinatari (1 sola notifica aggregata per GDO)
    for (const [targetId, count] of Object.entries(perTargetCount)) {
        notificationInserts.push({
            id: crypto.randomUUID(),
            recipientUserId: targetId,
            type: 'lead_assignment',
            title: 'Nuovi lead assegnati',
            body: `Hai ricevuto ${count} lead in "${sectionLabel}" da una ridistribuzione admin.`,
            metadata: { source: 'admin_redistribution', sectionLabel, count },
            status: 'unread',
            createdAt: now,
        })
    }

    // Esecuzione: update batch + insert eventi + insert notifiche
    await Promise.all(updatePromises)
    if (eventInserts.length > 0) {
        await db.insert(leadEvents).values(eventInserts)
    }
    if (notificationInserts.length > 0) {
        try {
            await db.insert(notifications).values(notificationInserts)
        } catch (e) {
            // Non bloccante: la riassegnazione è già avvenuta, solo le notifiche
            // sono fallite (es. schema notifications cambiato in futuro).
            console.error('[redistribute] notifiche fallite:', e)
        }
    }

    return { success: true, moved: toMove.length, perTarget: perTargetCount }
}

export async function getActiveGdosForRedistribution(): Promise<{ id: string; name: string; displayName: string | null; isActive: boolean }[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const rows = await db
        .select({ id: users.id, name: users.name, displayName: users.displayName, isActive: users.isActive })
        .from(users)
        .where(and(
            eq(users.role, 'GDO'),
            // operatore assegnabile se l'azienda attiva è tra le sue allowedCompanies,
            // con fallback al companyId per gli utenti legacy (allowed_companies NULL).
            or(
                sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
                and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
            ),
        ))
    return rows.map(r => ({
        id: r.id,
        name: r.name || '',
        displayName: r.displayName,
        isActive: r.isActive === true,
    }))
}
