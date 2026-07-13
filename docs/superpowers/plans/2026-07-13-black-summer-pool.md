# Pool Lancio Black Summer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare i ~3000 lead della lista AC "Lead Lancio Black Summer 2026" nel CRM come pool non assegnato e permettere all'admin di distribuirli ai GDO scelti da `/import`.

**Architecture:** Estensione del modulo launch pool esistente (`launchPoolActions.ts` + card in `/import`): una server action di sync idempotente che pagina l'API ActiveCampaign e inserisce lead con `launchBucket='BLACK_SUMMER'`, un refactor che estrae la pesca-e-split in un helper condiviso coi bucket Video Editor, e una nuova card client `BlackSummerPoolCard`.

**Tech Stack:** Next.js App Router server actions, Drizzle ORM (mai SQL raw fuori dai pattern già esistenti nel file), Tailwind, API ActiveCampaign v3.

## Global Constraints

- `leads.launchBucket` è `text` libero: valore nuovo `'BLACK_SUMMER'`, **nessuna migrazione DB**.
- Funnel dei lead importati: esattamente `'Black Summer'`.
- Nome lista AC (match normalizzato trim+lowercase): `lead lancio black summer 2026`.
- Company: tutto hardcoded/gated su `'fenice'` (la lista vive sull'account AC Fenice).
- Nessun evento per-lead alla creazione (lezione Disk IO write-storm giugno). Eventi `ASSIGNED` solo alla distribuzione, come già fa il pool VE.
- Bottoni interattivi mai figli di `<span>`/`<p>` (regola WSOD del CLAUDE.md).
- La card VE (`LaunchPoolCard`) deve continuare a funzionare identica (stesso report shape).
- Repo senza unit-test infra per server actions: verifica = `npm run build` pulito + smoke E2E in produzione (sezione finale).

---

### Task 1: Refactor `launchPoolActions.ts` — helper condiviso + azioni Black Summer (status/assign)

**Files:**
- Modify: `src/app/actions/launchPoolActions.ts`

**Interfaces:**
- Consumes: pattern esistenti nel file (`currentTenant`, `assertSalesArea`, `previewLeadDistribution`, `logLeadEvent`).
- Produces (usati da Task 3):
  - `getBlackSummerPoolStatus(): Promise<{ available: number } | null>` — `null` se azienda attiva ≠ fenice (la card si nasconde).
  - `assignFromBlackSummerPool(input: { count: number; gdoIds: string[] }): Promise<BlackSummerAssignReport>` con `BlackSummerAssignReport = { ok: boolean; errors: string[]; perGdo: Record<string, { count: number; name: string }>; totalAssigned: number }`.

- [ ] **Step 1: Estrai l'helper interno `pickAndAssignBuckets`**

Dentro `launchPoolActions.ts`, sotto gli import, aggiungi (NON esportato — le server action file esportano solo async):

```ts
type BucketRequest = { bucket: string; count: number }
type PickAssignResult = {
    /** bucket → gdoId → n. lead assegnati */
    assigned: Record<string, Record<string, number>>
    totalAssigned: number
}

/**
 * Pesca atomica (FOR UPDATE SKIP LOCKED, FIFO su createdAt con tiebreaker id —
 * i lead da sync bulk hanno createdAt identico, stessa lezione del fix
 * pipeline sort 49a61b0) e split equo round-robin sui GDO selezionati.
 * Logga gli eventi ASSIGNED fuori dalla transazione. Condiviso tra pool
 * Videoeditor (WEBINAR/NO_WEBINAR) e Black Summer (BLACK_SUMMER).
 */
async function pickAndAssignBuckets(params: {
    companyId: string
    requests: BucketRequest[]
    selectedGdos: Array<{ id: string; displayName: string | null; name: string | null }>
    adminId?: string
}): Promise<PickAssignResult> {
    const { companyId, requests, selectedGdos, adminId } = params
    const result: PickAssignResult = { assigned: {}, totalAssigned: 0 }
    const pickedByBucket: Record<string, string[]> = {}

    await db.transaction(async (tx) => {
        for (const { bucket, count } of requests) {
            if (count <= 0) continue
            const picked = await tx.execute(sql`
                SELECT id FROM leads
                WHERE "launchBucket" = ${bucket}
                  AND "assignedToId" IS NULL
                  AND "companyId" = ${companyId}
                ORDER BY "createdAt" ASC, id ASC
                LIMIT ${count}
                FOR UPDATE SKIP LOCKED
            `)
            const ids: string[] = (picked as any).rows
                ? (picked as any).rows.map((r: any) => r.id)
                : (picked as any).map((r: any) => r.id)
            pickedByBucket[bucket] = ids
        }

        for (const [bucket, ids] of Object.entries(pickedByBucket)) {
            if (ids.length === 0) continue
            result.assigned[bucket] = {}

            const distr = previewLeadDistribution(ids.length, selectedGdos, 'equal', {})
            const assignPlan: string[] = []
            for (const gdoId in distr) {
                for (let i = 0; i < distr[gdoId].count; i++) assignPlan.push(gdoId)
            }

            const idsByGdo: Record<string, string[]> = {}
            for (let i = 0; i < ids.length; i++) {
                const gdo = assignPlan[i] || selectedGdos[0].id
                if (!idsByGdo[gdo]) idsByGdo[gdo] = []
                idsByGdo[gdo].push(ids[i])
            }
            for (const [gdoId, leadIds] of Object.entries(idsByGdo)) {
                await tx
                    .update(leads)
                    .set({ assignedToId: gdoId, updatedAt: new Date() })
                    .where(and(
                        eq(leads.companyId, companyId),
                        inArray(leads.id, leadIds),
                    ))
                result.assigned[bucket][gdoId] = leadIds.length
                result.totalAssigned += leadIds.length
            }
        }
    })

    // Log eventi ASSIGNED (fuori dalla tx per non bloccarla)
    for (const [bucket, ids] of Object.entries(pickedByBucket)) {
        if (ids.length === 0) continue
        const assignedRows = await db
            .select({ id: leads.id, assignedToId: leads.assignedToId })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                inArray(leads.id, ids),
            ))
        for (const row of assignedRows) {
            await logLeadEvent({
                leadId: row.id,
                eventType: 'ASSIGNED',
                userId: adminId,
                metadata: { source: 'launch_pool', bucket, assignedToUser: row.assignedToId },
                companyId,
            })
        }
    }

    return result
}
```

- [ ] **Step 2: Riscrivi `assignFromLaunchPool` sopra l'helper (report VE invariato)**

Sostituisci il corpo dalla riga della «Pesca atomica» in giù (mantieni intatte: validazione input, verifica GDO attivi, identificazione admin, init `perGdo`) con:

```ts
    const result = await pickAndAssignBuckets({
        companyId: ctx.companyId,
        requests: [
            { bucket: 'WEBINAR', count: webinarCount },
            { bucket: 'NO_WEBINAR', count: noWebinarCount },
        ],
        selectedGdos,
        adminId,
    })

    for (const [gdoId, n] of Object.entries(result.assigned['WEBINAR'] ?? {})) {
        report.perGdo[gdoId].webinar += n
    }
    for (const [gdoId, n] of Object.entries(result.assigned['NO_WEBINAR'] ?? {})) {
        report.perGdo[gdoId].noWebinar += n
    }
    report.totalAssigned = result.totalAssigned

    revalidatePath('/', 'layout')

    report.ok = report.totalAssigned > 0
    if (report.totalAssigned === 0 && report.errors.length === 0) {
        report.errors.push("Nessun lead pescato (il pool del bucket richiesto potrebbe essere vuoto).")
    }
    return report
```

- [ ] **Step 3: Aggiungi status + assign Black Summer**

In coda al file:

```ts
// --- POOL LANCIO BLACK SUMMER (luglio 2026) ---
// La lista AC "Lead Lancio Black Summer 2026" è bloccata nel webhook
// (BLOCKED_LIST_NAMES_NORMALIZED): i lead entrano nel CRM SOLO via
// syncBlackSummerPool e vengono distribuiti da qui. Bucket unico,
// nessuna distinzione webinar (tutti da lista d'attesa).

const BLACK_SUMMER_BUCKET = 'BLACK_SUMMER'
const BLACK_SUMMER_COMPANY = 'fenice'

export async function getBlackSummerPoolStatus(): Promise<{ available: number } | null> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // La lista vive sull'account AC Fenice: con altra azienda attiva la card si nasconde.
    if (ctx.companyId !== BLACK_SUMMER_COMPANY) return null

    const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.launchBucket, BLACK_SUMMER_BUCKET),
            isNull(leads.assignedToId),
        ))
    return { available: rows[0]?.count ?? 0 }
}

export type BlackSummerAssignReport = {
    ok: boolean
    errors: string[]
    perGdo: Record<string, { count: number, name: string }>
    totalAssigned: number
}

export async function assignFromBlackSummerPool(input: { count: number; gdoIds: string[] }): Promise<BlackSummerAssignReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: BlackSummerAssignReport = { ok: false, errors: [], perGdo: {}, totalAssigned: 0 }

    if (ctx.companyId !== BLACK_SUMMER_COMPANY) {
        report.errors.push("Il pool Black Summer è disponibile solo con azienda attiva Fenice.")
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
    const adminId = supabaseUser?.id

    for (const g of selectedGdos) {
        report.perGdo[g.id] = { count: 0, name: g.displayName || g.name || g.id }
    }

    const result = await pickAndAssignBuckets({
        companyId: ctx.companyId,
        requests: [{ bucket: BLACK_SUMMER_BUCKET, count }],
        selectedGdos,
        adminId,
    })
    for (const [gdoId, n] of Object.entries(result.assigned[BLACK_SUMMER_BUCKET] ?? {})) {
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
```

- [ ] **Step 4: Verifica compilazione**

Run: `npx tsc --noEmit` (oppure `npm run build` se tsc standalone non è configurato)
Expected: nessun errore nel file modificato.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/launchPoolActions.ts
git commit -m "refactor(launch-pool): helper pesca/split condiviso + azioni pool Black Summer"
```

---

### Task 2: Server action `syncBlackSummerPool` — pull idempotente da ActiveCampaign

**Files:**
- Modify: `src/app/actions/launchPoolActions.ts` (in coda, dopo il Task 1)

**Interfaces:**
- Consumes: `BLACK_SUMMER_BUCKET`, `BLACK_SUMMER_COMPANY` dal Task 1; `normalizePhoneStrict`, `normalizePhoneLenient`, `isPlausiblePhone` da `@/lib/phoneNormalize`; `acIntakeFailures` da `@/db/schema`; `crypto` (node).
- Produces (usato da Task 3): `syncBlackSummerPool(): Promise<BlackSummerSyncReport>` con `BlackSummerSyncReport = { ok: boolean; imported: number; skippedExisting: number; skippedNoPhone: number; totalOnList: number; errors: string[] }`.

- [ ] **Step 1: Aggiungi import mancanti in testa al file**

```ts
import crypto from "crypto"
import { acIntakeFailures } from "@/db/schema"
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize"
import { like, isNotNull as dIsNotNull } from "drizzle-orm"
```

(Nota: `isNotNull` è già importato nel file — NON duplicarlo; aggiungi solo `like`. Verifica gli import esistenti e integra senza doppioni.)

- [ ] **Step 2: Aggiungi acGet locale + risoluzione lista + sync**

In coda al file:

```ts
// Client AC minimale con retry/backoff anti-429 — stessa logica dell'acGet
// del webhook Fenice (non esportato da lì: route handler). ~5 req/s per
// account, il backoff rispetta Retry-After.
const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com'
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || ''
const AC_MAX_RETRIES = 4
const BLACK_SUMMER_LIST_NAME_NORMALIZED = 'lead lancio black summer 2026'

async function acGet(path: string, attempt = 0): Promise<any> {
    const res = await fetch(`${AC_URL}/api/3${path}`, {
        headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
    })
    if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < AC_MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10000)
            : Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
        await new Promise((r) => setTimeout(r, backoffMs))
        return acGet(path, attempt + 1)
    }
    if (!res.ok) throw new Error(`AC API ${res.status}: ${await res.text()}`)
    return res.json()
}

async function findBlackSummerListId(): Promise<string | null> {
    for (let offset = 0; offset < 500; offset += 100) {
        const res = await acGet(`/lists?limit=100&offset=${offset}`)
        const lists = Array.isArray(res.lists) ? res.lists : []
        if (lists.length === 0) break
        for (const l of lists) {
            const nameNorm = String(l?.name ?? '').trim().toLowerCase()
            if (nameNorm === BLACK_SUMMER_LIST_NAME_NORMALIZED && l?.id != null) return String(l.id)
        }
        if (lists.length < 100) break
    }
    return null
}

export type BlackSummerSyncReport = {
    ok: boolean
    imported: number
    skippedExisting: number
    skippedNoPhone: number
    totalOnList: number
    errors: string[]
}

export async function syncBlackSummerPool(): Promise<BlackSummerSyncReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: BlackSummerSyncReport = {
        ok: false, imported: 0, skippedExisting: 0, skippedNoPhone: 0, totalOnList: 0, errors: [],
    }
    if (ctx.companyId !== BLACK_SUMMER_COMPANY) {
        report.errors.push("Il sync Black Summer è disponibile solo con azienda attiva Fenice.")
        return report
    }
    if (!AC_KEY) {
        report.errors.push("ACTIVECAMPAIGN_API_KEY non configurata sul server.")
        return report
    }

    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const adminId = supabaseUser?.id ?? null

    let listId: string | null = null
    try {
        listId = await findBlackSummerListId()
    } catch (e: any) {
        report.errors.push(`Errore AC durante la ricerca della lista: ${e?.message || e}`)
        return report
    }
    if (!listId) {
        report.errors.push(`Lista "Lead Lancio Black Summer 2026" non trovata su ActiveCampaign.`)
        return report
    }

    // acContactId già presenti (qualunque bucket/stato: mai due lead dallo
    // stesso contatto AC via sync). Solo la colonna, per non caricare righe intere.
    const existingRows = await db
        .select({ acContactId: leads.acContactId })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.acContactId),
        ))
    const existingIds = new Set(existingRows.map(r => r.acContactId as string))

    type NewLeadRow = typeof leads.$inferInsert
    const toInsert: NewLeadRow[] = []
    const importedContactIds: string[] = []

    try {
        // status=1 = iscrizione attiva alla lista. Paginazione difensiva:
        // hard-cap 20.000 contatti (200 pagine) per evitare loop su risposte anomale.
        for (let offset = 0; offset < 20000; offset += 100) {
            const page = await acGet(`/contacts?listid=${listId}&status=1&limit=100&offset=${offset}`)
            const contacts = Array.isArray(page.contacts) ? page.contacts : []
            if (offset === 0) report.totalOnList = Number(page?.meta?.total ?? contacts.length) || contacts.length
            if (contacts.length === 0) break

            for (const c of contacts) {
                const contactId = String(c?.id ?? '')
                if (!contactId) continue
                if (existingIds.has(contactId)) { report.skippedExisting++; continue }

                const rawPhone = String(c?.phone || '').trim()
                const phoneStrict = normalizePhoneStrict(rawPhone)
                const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone)
                const phoneFinal = phoneFinalNormalized?.startsWith('+39')
                    ? phoneFinalNormalized.slice(3)
                    : phoneFinalNormalized
                if (!rawPhone || !phoneFinal) { report.skippedNoPhone++; continue }

                const firstName = String(c?.firstName || '').trim()
                const lastName = String(c?.lastName || '').trim()
                const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome'
                const email = String(c?.email || '').trim() || null

                existingIds.add(contactId) // dedup anche intra-sync
                importedContactIds.push(contactId)
                toInsert.push({
                    id: crypto.randomUUID(),
                    name: fullName,
                    email,
                    phone: phoneFinal,
                    phoneSuspicious: !isPlausiblePhone(phoneStrict),
                    funnel: 'Black Summer',
                    source: 'activecampaign',
                    acContactId: contactId,
                    launchBucket: BLACK_SUMMER_BUCKET,
                    status: 'NEW',
                    assignedToId: null,
                    companyId: ctx.companyId,
                })
            }
            if (contacts.length < 100) break
        }
    } catch (e: any) {
        // Fallimento a metà: inseriamo comunque quanto raccolto (idempotente:
        // ri-cliccare riprende dai mancanti) e riportiamo l'errore.
        report.errors.push(`Errore AC durante il download dei contatti: ${e?.message || e} — importati quelli scaricati finora, riclicca per riprendere.`)
    }

    // Insert a chunk da 500 (niente eventi per-lead: vedi Global Constraints)
    for (let i = 0; i < toInsert.length; i += 500) {
        await db.insert(leads).values(toInsert.slice(i, i + 500))
        report.imported += Math.min(500, toInsert.length - i)
    }

    // Risolvi le failure "blocked_list" dei contatti ora importati, così
    // spariscono dal tab Bloccati di /lead-automatici.
    if (importedContactIds.length > 0) {
        for (let i = 0; i < importedContactIds.length; i += 500) {
            await db.update(acIntakeFailures)
                .set({ resolvedAt: new Date(), resolvedBy: adminId })
                .where(and(
                    eq(acIntakeFailures.companyId, ctx.companyId),
                    like(acIntakeFailures.reason, 'blocked_list:%'),
                    sql`${acIntakeFailures.resolvedAt} IS NULL`,
                    inArray(acIntakeFailures.acContactId, importedContactIds.slice(i, i + 500)),
                ))
        }
    }

    revalidatePath('/', 'layout')
    report.ok = report.errors.length === 0
    return report
}
```

- [ ] **Step 3: Verifica compilazione**

Run: `npm run build` (o `npx tsc --noEmit`)
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/launchPoolActions.ts
git commit -m "feat(black-summer): sync idempotente del pool da ActiveCampaign"
```

---

### Task 3: `BlackSummerPoolCard` + mount in `/import`

**Files:**
- Create: `src/components/BlackSummerPoolCard.tsx`
- Modify: `src/app/(dashboard)/import/ImportClient.tsx` (riga ~538: mount sotto `<LaunchPoolCard />`)

**Interfaces:**
- Consumes: `getBlackSummerPoolStatus`, `syncBlackSummerPool`, `assignFromBlackSummerPool`, `type BlackSummerAssignReport`, `type BlackSummerSyncReport` da `@/app/actions/launchPoolActions`; `getActiveGdosForImport` da `@/app/actions/importLeads`.
- Produces: componente `<BlackSummerPoolCard />` (nessuna prop).

- [ ] **Step 1: Crea il componente**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sun, RefreshCw, Users, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import {
    getBlackSummerPoolStatus,
    syncBlackSummerPool,
    assignFromBlackSummerPool,
    type BlackSummerAssignReport,
    type BlackSummerSyncReport,
} from "@/app/actions/launchPoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

export function BlackSummerPoolCard() {
    const router = useRouter()
    const [status, setStatus] = useState<{ available: number } | null | undefined>(undefined)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [count, setCount] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [report, setReport] = useState<BlackSummerAssignReport | null>(null)
    const [syncReport, setSyncReport] = useState<BlackSummerSyncReport | null>(null)

    useEffect(() => {
        Promise.all([getBlackSummerPoolStatus(), getActiveGdosForImport()])
            .then(([s, g]) => { setStatus(s); setGdos(g as GdoInfo[]) })
    }, [])

    // undefined = loading, null = azienda ≠ Fenice → card nascosta.
    // A differenza della card VE resta visibile a pool vuoto: serve per il primo sync.
    if (status === undefined || status === null) return null

    const total = count
    const canSubmit = !loading && !syncing && total > 0 && selectedGdoIds.size > 0
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(total / selectedGdoIds.size) : 0

    const toggleGdo = (id: string) => {
        const next = new Set(selectedGdoIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedGdoIds(next)
    }
    const selectAll = () => setSelectedGdoIds(new Set(gdos.map(g => g.id)))
    const clearAll = () => setSelectedGdoIds(new Set())

    const handleSync = async () => {
        if (syncing || loading) return
        setSyncing(true)
        setSyncReport(null)
        try {
            const res = await syncBlackSummerPool()
            setSyncReport(res)
            const fresh = await getBlackSummerPoolStatus()
            setStatus(fresh)
            router.refresh()
        } finally {
            setSyncing(false)
        }
    }

    const handleAssign = async () => {
        if (!canSubmit) return
        if (total > 100 && !confirm(`Stai per assegnare ${total} lead in un colpo solo. Continuare?`)) return
        setLoading(true)
        setReport(null)
        try {
            const res = await assignFromBlackSummerPool({ count: total, gdoIds: Array.from(selectedGdoIds) })
            setReport(res)
            if (res.ok) {
                const fresh = await getBlackSummerPoolStatus()
                setStatus(fresh)
                setCount(0)
                router.refresh()
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="bg-gradient-to-br from-amber-50 to-white rounded-xl border-2 border-amber-300 shadow-sm p-6 space-y-5 mt-8">
            <div className="flex items-center justify-between gap-3 border-b border-amber-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                        <Sun className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-ash-900">Pool Lancio Black Summer</h2>
                        <p className="text-xs text-ash-500">Lista d&apos;attesa AC — bucket unico, nessuna distinzione webinar. Funnel: Black Summer.</p>
                    </div>
                </div>
                <button
                    onClick={handleSync}
                    disabled={syncing || loading}
                    className="flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {syncing
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sincronizzazione...</>
                        : <><RefreshCw className="h-3.5 w-3.5" /> Sincronizza da ActiveCampaign</>}
                </button>
            </div>

            {syncReport && (
                <div className={`p-3 rounded-lg border text-xs ${syncReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {syncReport.ok ? 'Sync completato' : 'Sync con errori'}
                        {' — '}{syncReport.imported} importati, {syncReport.skippedExisting} già presenti, {syncReport.skippedNoPhone} senza telefono (lista AC: {syncReport.totalOnList})
                    </div>
                    {syncReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
            )}

            {/* Stat tile */}
            <div className="bg-white rounded-lg border border-amber-100 p-4 flex items-center gap-3">
                <Sun className="h-6 w-6 text-amber-500" />
                <div>
                    <p className="text-xs uppercase text-ash-500 tracking-wider font-semibold">Lead nel pool</p>
                    <p className="text-2xl font-black text-ash-900">{status.available} <span className="text-xs font-normal text-ash-500">disponibili</span></p>
                </div>
            </div>

            {/* Quantità */}
            <div>
                <label className="text-xs font-semibold text-ash-700 mb-1 block">Quanti lead pescare dal pool</label>
                <input
                    type="number"
                    min={0}
                    max={status.available}
                    value={count}
                    disabled={status.available === 0}
                    onChange={(e) => setCount(Math.max(0, Math.min(status.available, parseInt(e.target.value) || 0)))}
                    className="w-full h-10 px-3 border border-amber-200 rounded-md text-sm focus:ring-amber-500 focus:border-amber-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                />
            </div>

            {/* GDO selection */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ash-700 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        GDO destinatari ({selectedGdoIds.size} su {gdos.length} selezionati)
                    </label>
                    <div className="flex gap-2 text-xs">
                        <button onClick={selectAll} className="text-amber-700 hover:underline font-medium">Tutti</button>
                        <button onClick={clearAll} className="text-ash-500 hover:underline">Nessuno</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                    {gdos.map(g => (
                        <label key={g.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${selectedGdoIds.has(g.id) ? 'bg-amber-50 border-amber-300' : 'bg-white border-ash-200 hover:bg-ash-50'}`}>
                            <input
                                type="checkbox"
                                checked={selectedGdoIds.has(g.id)}
                                onChange={() => toggleGdo(g.id)}
                                className="h-3.5 w-3.5 rounded text-amber-600 border-ash-300 focus:ring-amber-500"
                            />
                            <span className="truncate font-medium text-ash-800">{g.displayName || g.name || g.id.slice(0, 6)}</span>
                        </label>
                    ))}
                    {gdos.length === 0 && (
                        <p className="text-xs text-red-600 col-span-full">Nessun GDO attivo a sistema.</p>
                    )}
                </div>
            </div>

            {/* Preview */}
            {total > 0 && selectedGdoIds.size > 0 && (
                <div className="bg-amber-100/60 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{total} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> selezionati ({previewPerGdo} per GDO ca.).
                    </div>
                </div>
            )}

            {/* Submit */}
            <div className="flex justify-end pt-2">
                <button
                    onClick={handleAssign}
                    disabled={!canSubmit}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
                >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Assegnazione in corso...</> : <>Esegui Assegnazione</>}
                </button>
            </div>

            {/* Report */}
            {report && (
                <div className={`p-4 rounded-lg border ${report.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <h4 className="font-semibold text-sm text-ash-800 flex items-center gap-2 mb-2">
                        {report.ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
                        {report.ok ? `${report.totalAssigned} lead assegnati con successo` : 'Assegnazione non eseguita'}
                    </h4>
                    {report.errors.length > 0 && (
                        <ul className="text-xs text-red-700 list-disc pl-5 mb-2">
                            {report.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    )}
                    {report.ok && (
                        <div className="flex flex-wrap gap-2 text-xs">
                            {Object.entries(report.perGdo).filter(([, v]) => v.count > 0).map(([id, v]) => (
                                <span key={id} className="bg-white px-2.5 py-1 rounded-md border border-green-200 text-ash-600 font-medium shadow-sm">
                                    {v.name}: <strong className="text-amber-700">{v.count}</strong>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Mount in ImportClient**

In `src/app/(dashboard)/import/ImportClient.tsx`:
- aggiungi import: `import { BlackSummerPoolCard } from "@/components/BlackSummerPoolCard"`
- alla riga ~538, dopo `<LaunchPoolCard />`, aggiungi `<BlackSummerPoolCard />`.

- [ ] **Step 3: Verifica build completa**

Run: `npm run build`
Expected: build verde, nessun warning nuovo su questi file.

- [ ] **Step 4: Commit**

```bash
git add src/components/BlackSummerPoolCard.tsx "src/app/(dashboard)/import/ImportClient.tsx"
git commit -m "feat(black-summer): card pool in /import — sync AC + distribuzione ai GDO scelti"
```

---

### Task 4: Deploy + verifica E2E in produzione

**Files:** nessuno (operativo).

- [ ] **Step 1: Push su main** (Vercel auto-deploy)

```bash
git push
```

- [ ] **Step 2: Attendi deploy verde su Vercel** (via `gh`/dashboard Vercel MCP o CLI).

- [ ] **Step 3: Smoke E2E in prod (admin, azienda Fenice):**
1. Apri `/import` → la card "Pool Lancio Black Summer" è visibile con 0 disponibili.
2. Clicca "Sincronizza da ActiveCampaign" → attendi report: importati ≈ 2800-3000, confronta con `totalOnList`.
3. Ri-clicca sync → `imported: 0`, `skippedExisting` ≈ totale (idempotenza OK).
4. Verifica che il tab "Bloccati" di /lead-automatici non mostri più i contatti Black Summer importati.
5. Distribuisci un batch di prova (es. 4 lead su 2 GDO) → report per-GDO corretto, i lead compaiono nella board tentativo-0 dei GDO con funnel "Black Summer".
6. Verifica card VE ancora funzionante (deve restare nascosta se pool VE vuoto — nessun crash).

- [ ] **Step 4: Se tutto OK, comunicare a Bruno che i GDO possono partire.**
