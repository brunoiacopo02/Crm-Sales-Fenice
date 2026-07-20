"use server"

import { db } from "@/db"
import { leads, users, launchPools } from "@/db/schema"
import { and, eq, isNull, sql, inArray, asc } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"
import crypto from "crypto"
import { currentTenant, assertSalesArea, assertSingleCompany, type TenantContext } from "@/lib/tenancy"
import { pickAndAssignBuckets, acGet, AC_KEY } from "@/lib/launchPoolShared"
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize"

const DB_POOL_COMPANY = 'fenice'
const DB_POOL_FUNNEL = 'Database' // valore canonico: 13.734 lead storici lo usano già
const DB_POOL_ROLES = ['ADMIN', 'MANAGER', 'TL']

// --- ESCLUSIONE "GIÀ CLIENTI" ---
// Nomi normalizzati (trim+lowercase) di tag e liste AC che identificano un
// cliente: i loro membri NON entrano mai nei pool database. Config nel codice
// come BLOCKED_LIST_NAMES_NORMALIZED del webhook (default di prodotto, non env).
// Confermati dal PO 2026-07-20 (esplorazione AC: union 2.625+ contatti;
// validazione set 2025: 6.392 nel mese, ~90 clienti esclusi → ~6.272
// importabili, coerente con l'atteso ~6.300 del PO).
const CLIENT_TAG_NAMES_NORMALIZED: string[] = [
    'cliente',
    'corso-finito',
    'gold',
    'exclusive',
    'advance',
    'sondaggio-cliente',
]
const CLIENT_LIST_NAMES_NORMALIZED: string[] = [
    'clienti',
    'clienti-save',
    'studenti - social media manager',
    'studenti - copywriter',
    'studenti - sales rappresentative',
    'studenti - e-commerce manager',
    'collocamento studente',
    'clienti lancio nuovo corso 497',
    'iscritti nuovo percorso 497',
    'clienti corso intelligenza artificiale nuovo',
    'clienti black friday 2025 (masterclass con il commercialista)',
    'clienti data analyst lezione live',
    'lista studenti corso data analyst (per mail lezioni live)',
    'studenti corso project manager',
    'studenti abb',
    "studenti iscritti all'abbonamento mensile",
    'clienti data analyst 2026 (marta)',
    'lista stage',
]

const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

/** Contesto validato per tutte le action dei pool database. Lancia se non autorizzato. */
async function requireDbPoolCtx(): Promise<TenantContext> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!DB_POOL_ROLES.includes(ctx.role)) {
        throw new Error(`Forbidden: ruolo ${ctx.role} non autorizzato sui pool database`)
    }
    return ctx
}

function bucketForMonth(monthKey: string): string {
    return 'DB_' + monthKey.replace('-', '_')
}

function labelForMonth(monthKey: string): string {
    const [y, m] = monthKey.split('-').map(Number)
    return `Database ${MESI_IT[m - 1]} ${y}`
}

export type DatabaseSyncReport = {
    ok: boolean
    imported: number
    skippedClienti: number
    skippedExisting: number
    skippedNoPhone: number
    totalMonth: number
    errors: string[]
}

// Scarica UNA volta i membri dei tag/liste "cliente" → Set di contactId da
// escludere. Lookup per-contatto impraticabile: 6300 contatti a ~5 req/s
// sarebbero 20+ minuti. Tag/lista configurata ma non trovata per nome = errore
// bloccante (meglio fermarsi che importare clienti).
async function buildClientExclusionSet(): Promise<Set<string>> {
    const excluded = new Set<string>()
    if (CLIENT_TAG_NAMES_NORMALIZED.length === 0 && CLIENT_LIST_NAMES_NORMALIZED.length === 0) {
        return excluded
    }

    const tagIds: string[] = []
    if (CLIENT_TAG_NAMES_NORMALIZED.length > 0) {
        const found = new Map<string, string>() // nameNorm -> id
        for (let offset = 0; offset < 2000; offset += 100) {
            const res = await acGet(`/tags?limit=100&offset=${offset}`)
            const tags = Array.isArray(res.tags) ? res.tags : []
            if (tags.length === 0) break
            for (const t of tags) {
                const nameNorm = String(t?.tag ?? '').trim().toLowerCase()
                if (CLIENT_TAG_NAMES_NORMALIZED.includes(nameNorm) && t?.id != null) found.set(nameNorm, String(t.id))
            }
            if (tags.length < 100) break
        }
        for (const name of CLIENT_TAG_NAMES_NORMALIZED) {
            const id = found.get(name)
            if (!id) throw new Error(`Tag cliente "${name}" non trovato su ActiveCampaign`)
            tagIds.push(id)
        }
    }

    const listIds: string[] = []
    if (CLIENT_LIST_NAMES_NORMALIZED.length > 0) {
        const found = new Map<string, string>()
        for (let offset = 0; offset < 500; offset += 100) {
            const res = await acGet(`/lists?limit=100&offset=${offset}`)
            const lists = Array.isArray(res.lists) ? res.lists : []
            if (lists.length === 0) break
            for (const l of lists) {
                const nameNorm = String(l?.name ?? '').trim().toLowerCase()
                if (CLIENT_LIST_NAMES_NORMALIZED.includes(nameNorm) && l?.id != null) found.set(nameNorm, String(l.id))
            }
            if (lists.length < 100) break
        }
        for (const name of CLIENT_LIST_NAMES_NORMALIZED) {
            const id = found.get(name)
            if (!id) throw new Error(`Lista clienti "${name}" non trovata su ActiveCampaign`)
            listIds.push(id)
        }
    }

    // Membri: paginazione difensiva con hard-cap 50.000 per sorgente.
    for (const tagId of tagIds) {
        for (let offset = 0; offset < 50000; offset += 100) {
            const page = await acGet(`/contacts?tagid=${tagId}&limit=100&offset=${offset}`)
            const contacts = Array.isArray(page.contacts) ? page.contacts : []
            if (contacts.length === 0) break
            for (const c of contacts) if (c?.id != null) excluded.add(String(c.id))
            if (contacts.length < 100) break
        }
    }
    for (const listId of listIds) {
        for (let offset = 0; offset < 50000; offset += 100) {
            const page = await acGet(`/contacts?listid=${listId}&status=-1&limit=100&offset=${offset}`)
            const contacts = Array.isArray(page.contacts) ? page.contacts : []
            if (contacts.length === 0) break
            for (const c of contacts) if (c?.id != null) excluded.add(String(c.id))
            if (contacts.length < 100) break
        }
    }
    return excluded
}

export async function syncDatabaseMonthPool(monthKey: string): Promise<DatabaseSyncReport> {
    const report: DatabaseSyncReport = {
        ok: false, imported: 0, skippedClienti: 0, skippedExisting: 0,
        skippedNoPhone: 0, totalMonth: 0, errors: [],
    }
    let ctx: TenantContext
    try {
        ctx = await requireDbPoolCtx()
        assertSingleCompany(ctx) // scrittura: bloccata in modalità "Tutte le aziende"
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== DB_POOL_COMPANY) {
        report.errors.push("I pool database sono disponibili solo con azienda attiva Fenice.")
        return report
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
        report.errors.push(`Mese non valido: "${monthKey}" (atteso YYYY-MM).`)
        return report
    }
    if (!AC_KEY) {
        report.errors.push("ACTIVECAMPAIGN_API_KEY non configurata sul server.")
        return report
    }
    // Guardia temporanea (review finale 2026-07-20): finché l'esclusione "già
    // clienti" non è configurata (Task 7, conferma PO), il sync è disabilitato —
    // un import senza esclusioni sarebbe irreversibile e contraddirebbe la UI.
    if (CLIENT_TAG_NAMES_NORMALIZED.length === 0 && CLIENT_LIST_NAMES_NORMALIZED.length === 0) {
        report.errors.push("Esclusione già clienti non ancora configurata: sync disabilitato fino alla conferma dei tag/liste clienti (in arrivo).")
        return report
    }

    const bucket = bucketForMonth(monthKey)

    // Range date per il filtro AC, allargato di 1 giorno per lato: la semantica
    // timezone di created_before/after non è garantita, il taglio ESATTO al mese
    // lo fa il check su cdate (prefisso YYYY-MM) contatto per contatto.
    const [y, m] = monthKey.split('-').map(Number)
    const monthStart = new Date(Date.UTC(y, m - 1, 1))
    const nextMonthStart = new Date(Date.UTC(y, m, 1))
    const dayBefore = new Date(monthStart.getTime() - 24 * 3600 * 1000)
    const dayAfter = new Date(nextMonthStart.getTime() + 24 * 3600 * 1000)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)

    let clientSet: Set<string>
    try {
        clientSet = await buildClientExclusionSet()
    } catch (e: any) {
        report.errors.push(`Esclusione clienti non costruibile: ${e?.message || e}`)
        return report
    }

    // Dedup SOLO dentro al bucket (idempotenza re-sync). Niente dedup sul resto
    // del CRM: decisione PO 2026-07-20, i duplicati cross-funnel vanno richiamati.
    const existingRows = await db
        .select({ acContactId: leads.acContactId, phone: leads.phone })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.launchBucket, bucket),
        ))
    const existingIds = new Set(existingRows.map(r => r.acContactId).filter(Boolean) as string[])
    const existingPhones = new Set(existingRows.map(r => r.phone))

    type NewLeadRow = typeof leads.$inferInsert
    const toInsert: NewLeadRow[] = []
    const importedContactIds: string[] = []

    let hitPaginationCap = true
    try {
        for (let offset = 0; offset < 20000; offset += 100) {
            const page = await acGet(
                `/contacts?filters[created_after]=${fmt(dayBefore)}&filters[created_before]=${fmt(dayAfter)}&limit=100&offset=${offset}`
            )
            const contacts = Array.isArray(page.contacts) ? page.contacts : []
            if (contacts.length === 0) { hitPaginationCap = false; break }

            for (const c of contacts) {
                const contactId = String(c?.id ?? '')
                if (!contactId) continue
                // Taglio esatto al mese richiesto (cdate es. "2025-09-15T10:33:00-05:00")
                if (!String(c?.cdate ?? '').startsWith(monthKey)) continue
                report.totalMonth++

                if (clientSet.has(contactId)) { report.skippedClienti++; continue }
                if (existingIds.has(contactId)) { report.skippedExisting++; continue }

                const rawPhone = String(c?.phone || '').trim()
                const phoneStrict = normalizePhoneStrict(rawPhone)
                const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone)
                const phoneFinal = phoneFinalNormalized?.startsWith('+39')
                    ? phoneFinalNormalized.slice(3)
                    : phoneFinalNormalized
                if (!rawPhone || !phoneFinal) { report.skippedNoPhone++; continue }
                if (existingPhones.has(phoneFinal)) { report.skippedExisting++; continue }

                const firstName = String(c?.firstName || '').trim()
                const lastName = String(c?.lastName || '').trim()
                const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome'
                const email = String(c?.email || '').trim() || null

                existingIds.add(contactId)
                existingPhones.add(phoneFinal)
                importedContactIds.push(contactId)
                toInsert.push({
                    id: crypto.randomUUID(),
                    name: fullName,
                    email,
                    phone: phoneFinal,
                    phoneSuspicious: !isPlausiblePhone(phoneStrict),
                    funnel: DB_POOL_FUNNEL,
                    source: 'activecampaign',
                    acContactId: contactId,
                    launchBucket: bucket,
                    status: 'NEW',
                    assignedToId: null,
                    companyId: ctx.companyId,
                })
            }
            if (contacts.length < 100) { hitPaginationCap = false; break }
        }
        if (hitPaginationCap) {
            report.errors.push('Attenzione: raggiunto il limite di sicurezza di 20.000 contatti — mese non scaricato per intero, riclicca per verificare.')
        }
    } catch (e: any) {
        report.errors.push(`Errore AC durante il download dei contatti: ${e?.message || e} — importati quelli scaricati finora, riclicca per riprendere.`)
    }

    // Re-check pre-insert anti doppio-sync (pattern BS: il download dura minuti,
    // due sync paralleli non si vedono; ultimo sguardo al DB prima dell'insert).
    if (toInsert.length > 0 && importedContactIds.length > 0) {
        const recheck = new Set<string>()
        for (let i = 0; i < importedContactIds.length; i += 500) {
            const rows = await db
                .select({ acContactId: leads.acContactId })
                .from(leads)
                .where(and(
                    eq(leads.companyId, ctx.companyId),
                    eq(leads.launchBucket, bucket),
                    inArray(leads.acContactId, importedContactIds.slice(i, i + 500)),
                ))
            for (const r of rows) if (r.acContactId) recheck.add(r.acContactId)
        }
        if (recheck.size > 0) {
            const before = toInsert.length
            for (let i = toInsert.length - 1; i >= 0; i--) {
                if (recheck.has(toInsert[i].acContactId as string)) toInsert.splice(i, 1)
            }
            report.skippedExisting += before - toInsert.length
        }
    }

    for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500)
        // ON CONFLICT DO NOTHING sull'indice parziale: un sync concorrente che
        // ha vinto la corsa non fa fallire questo, e imported conta i soli
        // inserimenti reali.
        const inserted = await db.insert(leads).values(chunk)
            .onConflictDoNothing()
            .returning({ id: leads.id })
        report.imported += inserted.length
        report.skippedExisting += chunk.length - inserted.length
    }

    // Niente riga registro per sync falliti a vuoto o mesi senza contatti.
    if (report.imported > 0 || report.totalMonth > 0) {
        // Upsert atomico sul vincolo (companyId, bucket): il primo sync crea la
        // riga, i successivi (o un mese rimosso e ri-sincronizzato) la de-archiviano.
        await db.insert(launchPools).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            bucket,
            kind: 'DATABASE_MONTH',
            label: labelForMonth(monthKey),
            monthKey,
            createdBy: ctx.userId,
        }).onConflictDoUpdate({
            target: [launchPools.companyId, launchPools.bucket],
            set: { archivedAt: null, archivedBy: null },
        })
    }

    revalidatePath('/', 'layout')
    report.ok = report.errors.length === 0
    return report
}

export type DatabasePoolRow = {
    bucket: string
    label: string
    monthKey: string | null
    archived: boolean
    totale: number
    assegnati: number
    disponibili: number
    chiamati: number
    fissati: number
    confermati: number
    chiusi: number
    fatturatoEur: number
}

/**
 * Una riga per ogni pool DATABASE_MONTH mai sincronizzato (anche archiviati:
 * servono al confronto storico "quale mese rende meglio"). Scope per
 * launchBucket, NON per funnel: i ~17k lead Database storici non c'entrano.
 * Definizioni canon identiche a blackSummerStats (fissati=appointmentCreatedAt,
 * confermati=confirmationsOutcome, chiusi=salespersonOutcome, fatturato=closeAmountEur).
 * Ritorna null con azienda attiva ≠ Fenice (sezione nascosta).
 */
export async function getDatabasePoolStats(): Promise<DatabasePoolRow[] | null> {
    const ctx = await requireDbPoolCtx()
    // Sezione operativa: nascosta in modalità "Tutte le aziende" (sola lettura, no assertSingleCompany).
    if (ctx.isAllCompanies) return null
    if (ctx.companyId !== DB_POOL_COMPANY) return null

    const pools = await db.select().from(launchPools).where(and(
        eq(launchPools.companyId, ctx.companyId),
        eq(launchPools.kind, 'DATABASE_MONTH'),
    )).orderBy(asc(launchPools.monthKey))
    if (pools.length === 0) return []

    const buckets = pools.map(p => p.bucket)
    const aggRows = await db
        .select({
            bucket: leads.launchBucket,
            totale: sql<number>`count(*)::int`,
            assegnati: sql<number>`count(*) FILTER (WHERE ${leads.assignedToId} IS NOT NULL)::int`,
            disponibili: sql<number>`count(*) FILTER (WHERE ${leads.assignedToId} IS NULL)::int`,
            chiamati: sql<number>`count(*) FILTER (WHERE ${leads.callCount} >= 1)::int`,
            fissati: sql<number>`count(*) FILTER (WHERE ${leads.appointmentCreatedAt} IS NOT NULL)::int`,
            confermati: sql<number>`count(*) FILTER (WHERE ${leads.confirmationsOutcome} = 'confermato')::int`,
            chiusi: sql<number>`count(*) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso')::int`,
            fatturatoEur: sql<number>`COALESCE(sum(${leads.closeAmountEur}) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso'), 0)::float`,
        })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            inArray(leads.launchBucket, buckets),
        ))
        .groupBy(leads.launchBucket)
    const byBucket = new Map(aggRows.map(r => [r.bucket as string, r]))

    return pools.map(p => {
        const agg = byBucket.get(p.bucket)
        return {
            bucket: p.bucket,
            label: p.label,
            monthKey: p.monthKey,
            archived: p.archivedAt != null,
            totale: agg?.totale ?? 0,
            assegnati: agg?.assegnati ?? 0,
            disponibili: agg?.disponibili ?? 0,
            chiamati: agg?.chiamati ?? 0,
            fissati: agg?.fissati ?? 0,
            confermati: agg?.confermati ?? 0,
            chiusi: agg?.chiusi ?? 0,
            fatturatoEur: agg?.fatturatoEur ?? 0,
        }
    })
}

export type DatabaseAssignReport = {
    ok: boolean
    errors: string[]
    perGdo: Record<string, { count: number, name: string }>
    totalAssigned: number
}

export async function assignFromDatabasePool(input: { bucket: string; count: number; gdoIds: string[] }): Promise<DatabaseAssignReport> {
    const report: DatabaseAssignReport = { ok: false, errors: [], perGdo: {}, totalAssigned: 0 }
    let ctx: TenantContext
    try {
        ctx = await requireDbPoolCtx()
        assertSingleCompany(ctx) // scrittura: bloccata in modalità "Tutte le aziende"
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== DB_POOL_COMPANY) {
        report.errors.push("I pool database sono disponibili solo con azienda attiva Fenice.")
        return report
    }

    // Il bucket DEVE essere un pool DATABASE_MONTH attivo del registro: mai
    // fidarsi del bucket arrivato dal client (potrebbe puntare a WEBINAR ecc.).
    const [pool] = await db.select().from(launchPools).where(and(
        eq(launchPools.companyId, ctx.companyId),
        eq(launchPools.bucket, input.bucket),
        eq(launchPools.kind, 'DATABASE_MONTH'),
        isNull(launchPools.archivedAt),
    )).limit(1)
    if (!pool) {
        report.errors.push("Pool non trovato o già rimosso.")
        return report
    }

    const count = Math.max(0, Math.floor(input.count || 0))
    if (count === 0) {
        report.errors.push("Devi specificare almeno 1 lead da pescare.")
        return report
    }
    if (!input.gdoIds || input.gdoIds.length === 0) {
        report.errors.push("Devi selezionare almeno 1 GDO destinatario.")
        return report
    }

    const selectedGdos = (await db.select().from(users).where(and(
        eq(users.companyId, ctx.companyId),
        inArray(users.id, input.gdoIds),
    )))
        .filter((u: any) => u.role === 'GDO' && u.isActive === true)
    if (selectedGdos.length === 0) {
        report.errors.push("Nessuno dei GDO selezionati è attivo.")
        return report
    }
    if (selectedGdos.length !== input.gdoIds.length) {
        report.errors.push(`${input.gdoIds.length - selectedGdos.length} GDO selezionati ignorati perché non attivi.`)
    }

    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()

    for (const g of selectedGdos) {
        report.perGdo[g.id] = { count: 0, name: g.displayName || g.name || g.id }
    }

    const result = await pickAndAssignBuckets({
        companyId: ctx.companyId,
        requests: [{ bucket: input.bucket, count }],
        selectedGdos,
        adminId: supabaseUser?.id,
    })
    for (const [gdoId, n] of Object.entries(result.assigned[input.bucket] ?? {})) {
        report.perGdo[gdoId].count += n
    }
    report.totalAssigned = result.totalAssigned

    revalidatePath('/', 'layout')
    report.ok = report.totalAssigned > 0
    if (report.totalAssigned === 0 && report.errors.length === 0) {
        report.errors.push("Nessun lead pescato (il pool potrebbe essere vuoto).")
    }
    return report
}

/**
 * Archivia un pool del registro (card nascosta su /import). Generica: vale per
 * i pool database (DB_*) e per BLACK_SUMMER. Guardia server: rifiuta finché
 * esistono lead del bucket non assegnati — regola PO "si rimuove solo dopo
 * aver assegnato tutto". Non cancella MAI nessun lead.
 */
export async function archiveLaunchPool(bucket: string): Promise<{ ok: boolean; error?: string }> {
    let ctx: TenantContext
    try {
        ctx = await requireDbPoolCtx()
        assertSingleCompany(ctx) // scrittura: bloccata in modalità "Tutte le aziende"
    } catch (e: any) {
        return { ok: false, error: String(e?.message || e) }
    }
    if (ctx.companyId !== DB_POOL_COMPANY) {
        return { ok: false, error: "Disponibile solo con azienda attiva Fenice." }
    }

    const [pool] = await db.select().from(launchPools).where(and(
        eq(launchPools.companyId, ctx.companyId),
        eq(launchPools.bucket, bucket),
        isNull(launchPools.archivedAt),
    )).limit(1)
    if (!pool) return { ok: false, error: "Pool non trovato o già rimosso." }

    const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.launchBucket, bucket),
            isNull(leads.assignedToId),
        ))
    if (n > 0) {
        return { ok: false, error: `Ci sono ancora ${n} lead non assegnati: assegnali tutti prima di rimuovere il pool.` }
    }

    await db.update(launchPools)
        .set({ archivedAt: new Date(), archivedBy: ctx.userId })
        .where(eq(launchPools.id, pool.id))

    revalidatePath('/', 'layout')
    return { ok: true }
}
