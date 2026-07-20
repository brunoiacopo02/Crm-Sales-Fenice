# Pool Database mensili da ActiveCampaign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sezione "Pool Database (ActiveCampaign)" su /import: il TL sincronizza pool di lead per mese di creazione contatto AC (esclusi i già clienti), li assegna ai GDO, confronta la resa dei mesi in una mini tabella e rimuove il pool quando esaurito (pulsante esteso anche alla card Black Summer).

**Architecture:** Pattern Black Summer replicato con bucket dinamici `DB_YYYY_MM` + nuova tabella registro `launchPools` (archiviazione card). Helper condivisi (`pickAndAssignBuckets`, `acGet`) estratti da `launchPoolActions.ts` in `src/lib/launchPoolShared.ts`. Stats per-bucket (NON per funnel: i ~17k lead database storici non devono inquinare).

**Tech Stack:** Next.js App Router, Drizzle ORM, Supabase Postgres, ActiveCampaign API v3, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-20-database-month-pools-design.md`

## Global Constraints

- Funnel dei lead importati: **`'Database'`** (esatto, capitalizzato — 13.734 lead esistenti usano questo valore; tutti i check a valle sono case-insensitive).
- `source: 'activecampaign'`, `status: 'NEW'`, `assignedToId: null`, `companyId: 'fenice'`.
- Bucket: `'DB_' + monthKey.replace('-', '_')` (es. `DB_2025_09`).
- Tutte le server action: `currentTenant()` + `assertSalesArea(ctx)` + gate `ctx.companyId === 'fenice'` + ruolo in `['ADMIN','MANAGER','TL']`.
- **Nessuna dedup verso il resto del CRM** (decisione PO): dedup SOLO dentro al bucket (acContactId + telefono) per idempotenza re-sync.
- Migrazioni applicate A MANO via `mcp__supabase__apply_migration` (project_id `ncutwzsifzundikwllxp`) — drizzle-kit generate inutilizzabile.
- MAI query SQL raw nel codice app fuori dal pattern `sql\`\`` Drizzle già in uso.
- Niente insert di eventi per-lead durante il sync (solo durante l'assegnazione, gestita da `pickAndAssignBuckets`).
- Verifica per ogni task: `npx tsc --noEmit` pulito; build finale `npm run build` senza errori (il progetto non ha test runner: la verifica è compile + QA prod).
- I file in `src/app/actions/` sono `"use server"`: ogni export deve essere una async function. Gli helper sincroni/condivisi vivono in `src/lib/`.

---

### Task 1: Migrazione `launchPools` + schema Drizzle

**Files:**
- Create: `drizzle/migrations/0023_launch_pools.sql`
- Modify: `src/db/schema.ts` (aggiungere tabella dopo `salesWeeklyFocus`, ~riga 946)

**Interfaces:**
- Produces: tabella Drizzle `launchPools` esportata da `@/db/schema` con colonne `id, companyId, bucket, kind, label, monthKey, createdAt, createdBy, archivedAt, archivedBy`.

- [ ] **Step 1: Scrivere la migrazione**

Creare `drizzle/migrations/0023_launch_pools.sql`:

```sql
-- Registro dei pool di /import (spec 2026-07-20-database-month-pools).
-- kind: 'DATABASE_MONTH' (pool mensili da AC) | 'LAUNCH' (lanci, es. Black Summer).
-- archivedAt != NULL => card nascosta su /import (i lead assegnati restano intatti).
CREATE TABLE IF NOT EXISTS "launchPools" (
    "id" text PRIMARY KEY,
    "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE,
    "bucket" text NOT NULL,
    "kind" text NOT NULL,
    "label" text NOT NULL,
    "monthKey" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "createdBy" text,
    "archivedAt" timestamptz,
    "archivedBy" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "launch_pools_company_bucket_uq"
    ON "launchPools" ("companyId", "bucket");

-- Backfill: la card Black Summer acquisisce il pulsante "Rimuovi pool".
INSERT INTO "launchPools" ("id", "companyId", "bucket", "kind", "label", "monthKey")
VALUES (gen_random_uuid()::text, 'fenice', 'BLACK_SUMMER', 'LAUNCH', 'Pool Lancio Black Summer', NULL)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Aggiungere la tabella a `src/db/schema.ts`**

Dopo il blocco `salesWeeklyFocus` (~riga 946), stile identico alle tabelle vicine:

```ts
// Registro dei pool di /import (spec 2026-07-20-database-month-pools).
// Una riga per bucket: i DATABASE_MONTH sono creati dal sync AC per mese
// ('DB_2025_09'...), BLACK_SUMMER è backfillata dalla migrazione 0023.
// archivedAt != null = card nascosta su /import; i lead del bucket non si toccano.
export const launchPools = pgTable('launchPools', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    bucket: text('bucket').notNull(),
    kind: text('kind').notNull(), // 'DATABASE_MONTH' | 'LAUNCH'
    label: text('label').notNull(),
    monthKey: text('monthKey'), // 'YYYY-MM' per i DATABASE_MONTH, null per i lanci
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    createdBy: text('createdBy'),
    archivedAt: timestamp('archivedAt', { withTimezone: true, mode: 'date' }),
    archivedBy: text('archivedBy'),
}, (table) => {
    return {
        bucketUnique: uniqueIndex('launch_pools_company_bucket_uq').on(table.companyId, table.bucket),
    };
});
```

- [ ] **Step 3: Verifica TypeScript**

Run: `npx tsc --noEmit`
Expected: exit 0, nessun errore.

- [ ] **Step 4: Applicare la migrazione in prod**

Via MCP (solo sessione principale, NON subagent): `mcp__supabase__apply_migration` con name `0023_launch_pools` e il contenuto SQL dello Step 1.
Poi verificare: `mcp__supabase__execute_sql` → `SELECT bucket, kind, label FROM "launchPools";`
Expected: 1 riga `BLACK_SUMMER | LAUNCH | Pool Lancio Black Summer`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0023_launch_pools.sql src/db/schema.ts
git commit -m "feat(db): tabella launchPools — registro pool /import con archiviazione (migr. 0023)"
```

---

### Task 2: Estrarre gli helper condivisi in `src/lib/launchPoolShared.ts`

**Files:**
- Create: `src/lib/launchPoolShared.ts`
- Modify: `src/app/actions/launchPoolActions.ts` (rimuovere `pickAndAssignBuckets`, `acGet` e relative costanti; importarli dalla lib)

**Interfaces:**
- Produces (usati dal Task 3):
  - `export async function acGet(path: string, attempt?: number): Promise<any>` — GET su `/api/3<path>` con backoff anti-429.
  - `export const AC_KEY: string` — chiave API (vuota se non configurata).
  - `export type BucketRequest = { bucket: string; count: number }`
  - `export type PickAssignResult = { assigned: Record<string, Record<string, number>>; totalAssigned: number }`
  - `export async function pickAndAssignBuckets(params: { companyId: string; requests: BucketRequest[]; selectedGdos: Array<{ id: string; displayName: string | null; name: string | null }>; adminId?: string }): Promise<PickAssignResult>`

- [ ] **Step 1: Creare `src/lib/launchPoolShared.ts`**

Spostarci, INVARIATI nel corpo, i seguenti blocchi oggi in `src/app/actions/launchPoolActions.ts`:
- i tipi `BucketRequest` e `PickAssignResult` (righe 15-20) — aggiungere `export`;
- la funzione `pickAndAssignBuckets` (righe 22-117) — aggiungere `export`, conservare il commento doc esteso (aggiornando "Condiviso tra pool Videoeditor... e Black Summer" in "...Black Summer (BLACK_SUMMER) e Database mensili (DB_*)");
- le costanti `AC_URL`, `AC_KEY`, `AC_MAX_RETRIES` (righe 333-335) — esportare `AC_KEY`;
- la funzione `acGet` (righe 338-352) — aggiungere `export`, conservare il commento.

Intestazione del file:

```ts
// Helper condivisi dei pool di /import (Videoeditor, Black Summer, Database
// mensili). Estratti da launchPoolActions.ts (spec 2026-07-20): i file
// actions/ sono "use server" e possono esportare solo async function per il
// client — le utility condivise vivono qui.
import { db } from "@/db"
import { leads, leadEvents } from "@/db/schema"
import { and, eq, sql, inArray } from "drizzle-orm"
import { previewLeadDistribution } from "@/lib/distributionUtils"
import crypto from "crypto"
```

(NESSUNA direttiva `"use server"` in questo file.)

- [ ] **Step 2: Aggiornare `launchPoolActions.ts`**

- Eliminare i blocchi spostati (tipi, `pickAndAssignBuckets`, `AC_URL`/`AC_KEY`/`AC_MAX_RETRIES`, `acGet`).
- Aggiungere in testa: `import { pickAndAssignBuckets, acGet, AC_KEY } from "@/lib/launchPoolShared"`.
- Ripulire gli import Drizzle rimasti orfani (es. `leadEvents`, `crypto`, `previewLeadDistribution` se non più usati nel file).
- Le funzioni `findBlackSummerListId`, `syncBlackSummerPool`, `assignFromBlackSummerPool`, `assignFromLaunchPool`, `getLaunchPoolStatus`, `getBlackSummerPoolStatus` restano dove sono e continuano a funzionare invariati.

- [ ] **Step 3: Verifica TypeScript**

Run: `npx tsc --noEmit`
Expected: exit 0. Errori tipici da sistemare: import inutilizzati residui in `launchPoolActions.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/launchPoolShared.ts src/app/actions/launchPoolActions.ts
git commit -m "refactor(pool): pickAndAssignBuckets e acGet estratti in lib condivisa launchPoolShared"
```

---

### Task 3: Server actions `databasePoolActions.ts`

**Files:**
- Create: `src/app/actions/databasePoolActions.ts`

**Interfaces:**
- Consumes: `pickAndAssignBuckets`, `acGet`, `AC_KEY` da `@/lib/launchPoolShared` (Task 2); tabella `launchPools` (Task 1).
- Produces (usati dai Task 4 e 5):
  - `export type DatabaseSyncReport = { ok: boolean; imported: number; skippedClienti: number; skippedExisting: number; skippedNoPhone: number; totalMonth: number; errors: string[] }`
  - `export async function syncDatabaseMonthPool(monthKey: string): Promise<DatabaseSyncReport>`
  - `export type DatabasePoolRow = { bucket: string; label: string; monthKey: string | null; archived: boolean; totale: number; assegnati: number; disponibili: number; chiamati: number; fissati: number; confermati: number; chiusi: number; fatturatoEur: number }`
  - `export async function getDatabasePoolStats(): Promise<DatabasePoolRow[] | null>` — null se azienda attiva ≠ fenice (sezione nascosta); righe per TUTTI i pool `DATABASE_MONTH` (anche archiviati, ordinati per monthKey).
  - `export type DatabaseAssignReport = { ok: boolean; errors: string[]; perGdo: Record<string, { count: number; name: string }>; totalAssigned: number }`
  - `export async function assignFromDatabasePool(input: { bucket: string; count: number; gdoIds: string[] }): Promise<DatabaseAssignReport>`
  - `export async function archiveLaunchPool(bucket: string): Promise<{ ok: boolean; error?: string }>` — generica: vale per i pool `DB_*` E per `BLACK_SUMMER`.

- [ ] **Step 1: Creare il file con guardie e costanti**

```ts
"use server"

import { db } from "@/db"
import { leads, users, launchPools } from "@/db/schema"
import { and, eq, isNull, isNotNull, sql, inArray, asc } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"
import crypto from "crypto"
import { currentTenant, assertSalesArea, type TenantContext } from "@/lib/tenancy"
import { pickAndAssignBuckets, acGet, AC_KEY } from "@/lib/launchPoolShared"
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize"

const DB_POOL_COMPANY = 'fenice'
const DB_POOL_FUNNEL = 'Database' // valore canonico: 13.734 lead storici lo usano già
const DB_POOL_ROLES = ['ADMIN', 'MANAGER', 'TL']

// --- ESCLUSIONE "GIÀ CLIENTI" ---
// Nomi normalizzati (trim+lowercase) di tag e liste AC che identificano un
// cliente: i loro membri NON entrano mai nei pool database. Config nel codice
// come BLOCKED_LIST_NAMES_NORMALIZED del webhook (default di prodotto, non env).
// DA COMPILARE dopo l'esplorazione AC con conferma PO (spec §4) — finché sono
// vuoti il sync non esclude nessuno.
const CLIENT_TAG_NAMES_NORMALIZED: string[] = []
const CLIENT_LIST_NAMES_NORMALIZED: string[] = []

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
```

- [ ] **Step 2: Implementare `syncDatabaseMonthPool`**

```ts
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
    try { ctx = await requireDbPoolCtx() } catch (e: any) {
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
        await db.insert(leads).values(toInsert.slice(i, i + 500))
        report.imported += Math.min(500, toInsert.length - i)
    }

    // Upsert riga registro (de-archivia se il TL ri-sincronizza un mese rimosso).
    const [poolRow] = await db.select().from(launchPools).where(and(
        eq(launchPools.companyId, ctx.companyId),
        eq(launchPools.bucket, bucket),
    )).limit(1)
    if (poolRow) {
        await db.update(launchPools)
            .set({ archivedAt: null, archivedBy: null })
            .where(eq(launchPools.id, poolRow.id))
    } else {
        await db.insert(launchPools).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            bucket,
            kind: 'DATABASE_MONTH',
            label: labelForMonth(monthKey),
            monthKey,
            createdBy: ctx.userId,
        })
    }

    revalidatePath('/', 'layout')
    report.ok = report.errors.length === 0
    return report
}
```

- [ ] **Step 3: Implementare `getDatabasePoolStats`**

```ts
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
```

- [ ] **Step 4: Implementare `assignFromDatabasePool` e `archiveLaunchPool`**

```ts
export type DatabaseAssignReport = {
    ok: boolean
    errors: string[]
    perGdo: Record<string, { count: number, name: string }>
    totalAssigned: number
}

export async function assignFromDatabasePool(input: { bucket: string; count: number; gdoIds: string[] }): Promise<DatabaseAssignReport> {
    const report: DatabaseAssignReport = { ok: false, errors: [], perGdo: {}, totalAssigned: 0 }
    let ctx: TenantContext
    try { ctx = await requireDbPoolCtx() } catch (e: any) {
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
    try { ctx = await requireDbPoolCtx() } catch (e: any) {
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
```

- [ ] **Step 5: Verifica TypeScript**

Run: `npx tsc --noEmit`
Expected: exit 0. Attenzione a `isNotNull` importato ma non usato: rimuoverlo dagli import se il linter lo segnala.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/databasePoolActions.ts
git commit -m "feat(pool-database): server actions sync/assegnazione/stats/archiviazione pool mensili da AC"
```

---

### Task 4: Archiviazione sulla card Black Summer

**Files:**
- Modify: `src/app/actions/launchPoolActions.ts` (funzione `getBlackSummerPoolStatus`)
- Modify: `src/components/BlackSummerPoolCard.tsx`

**Interfaces:**
- Consumes: `archiveLaunchPool` da `@/app/actions/databasePoolActions` (Task 3).
- Produces: `getBlackSummerPoolStatus(): Promise<{ available: number } | null>` — ritorna `null` ANCHE quando la riga `launchPools` di BLACK_SUMMER è archiviata (card nascosta). La firma pubblica non cambia.

- [ ] **Step 1: Nascondere la card se il pool BS è archiviato**

In `launchPoolActions.ts`, dentro `getBlackSummerPoolStatus`, dopo il gate company aggiungere il check registro (import: `launchPools` da `@/db/schema`, `isNotNull` già presente):

```ts
    // Pool rimosso dal TL (registro launchPools, spec 2026-07-20): card nascosta.
    const [poolRow] = await db.select({ archivedAt: launchPools.archivedAt })
        .from(launchPools)
        .where(and(
            eq(launchPools.companyId, ctx.companyId),
            eq(launchPools.bucket, BLACK_SUMMER_BUCKET),
        )).limit(1)
    if (poolRow?.archivedAt) return null
```

- [ ] **Step 2: Pulsante "Rimuovi pool" sulla card BS**

In `BlackSummerPoolCard.tsx`:
1. Import: `import { archiveLaunchPool } from "@/app/actions/databasePoolActions"` e `Trash2` da lucide-react.
2. State: `const [archiving, setArchiving] = useState(false)`.
3. Handler:

```ts
    const handleArchive = async () => {
        if (archiving || status.available > 0) return
        if (!confirm("Rimuovere il pool Black Summer da /import? I lead già assegnati e le loro statistiche restano intatti.")) return
        setArchiving(true)
        try {
            const res = await archiveLaunchPool('BLACK_SUMMER')
            if (!res.ok) alert(res.error || 'Rimozione non riuscita.')
            else { setStatus(null); router.refresh() }
        } finally {
            setArchiving(false)
        }
    }
```

4. Bottone nell'header, tra il titolo e "Sincronizza da ActiveCampaign" (dentro il `div` con `flex items-center justify-between`, in un contenitore `<div className="flex items-center gap-2">` insieme al bottone sync):

```tsx
                <button
                    onClick={handleArchive}
                    disabled={archiving || syncing || loading || status.available > 0}
                    title={status.available > 0 ? "Assegna tutti i lead per poter rimuovere il pool" : "Rimuovi il pool da questa pagina"}
                    className="flex items-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    <Trash2 className="h-3.5 w-3.5" /> Rimuovi pool
                </button>
```

Nota WSOD (CLAUDE.md regola 1): il bottone va dentro `<div>`, MAI dentro `<span>`/`<p>`.

- [ ] **Step 3: Verifica TypeScript**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/launchPoolActions.ts src/components/BlackSummerPoolCard.tsx
git commit -m "feat(black-summer): pulsante Rimuovi pool (attivo solo a pool esaurito) via registro launchPools"
```

---

### Task 5: UI — `DatabasePoolSection` su /import

**Files:**
- Create: `src/components/DatabasePoolSection.tsx`
- Modify: `src/app/(dashboard)/import/ImportClient.tsx` (import + mount sotto `<BlackSummerPoolCard />`)

**Interfaces:**
- Consumes: `getDatabasePoolStats`, `syncDatabaseMonthPool`, `assignFromDatabasePool`, `archiveLaunchPool` + tipi `DatabasePoolRow`, `DatabaseSyncReport`, `DatabaseAssignReport` da `@/app/actions/databasePoolActions` (Task 3); `getActiveGdosForImport` da `@/app/actions/importLeads` (esistente).

- [ ] **Step 1: Creare `src/components/DatabasePoolSection.tsx`**

Tema blu (colore già associato ai "Lead Database" in manager-targets). Contenuto completo:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Database, RefreshCw, Users, AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react"
import {
    getDatabasePoolStats,
    syncDatabaseMonthPool,
    assignFromDatabasePool,
    archiveLaunchPool,
    type DatabasePoolRow,
    type DatabaseSyncReport,
    type DatabaseAssignReport,
} from "@/app/actions/databasePoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

function fmtEur(v: number): string {
    return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export function DatabasePoolSection() {
    const router = useRouter()
    // undefined = loading, null = azienda ≠ Fenice → sezione nascosta
    const [pools, setPools] = useState<DatabasePoolRow[] | null | undefined>(undefined)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [syncMonth, setSyncMonth] = useState<string>('') // 'YYYY-MM' da <input type="month">
    const [syncing, setSyncing] = useState(false)
    const [syncReport, setSyncReport] = useState<DatabaseSyncReport | null>(null)

    const reload = async () => {
        const fresh = await getDatabasePoolStats()
        setPools(fresh)
    }

    useEffect(() => {
        Promise.all([getDatabasePoolStats(), getActiveGdosForImport()])
            .then(([p, g]) => { setPools(p); setGdos(g as GdoInfo[]) })
    }, [])

    if (pools === undefined || pools === null) return null

    const activePools = pools.filter(p => !p.archived)

    const handleSync = async () => {
        if (syncing || !syncMonth) return
        const [y, m] = syncMonth.split('-').map(Number)
        if (!confirm(`Sincronizzare da ActiveCampaign tutti i contatti creati a ${MESI_IT[m - 1]} ${y} (esclusi i già clienti)? L'operazione può durare qualche minuto.`)) return
        setSyncing(true)
        setSyncReport(null)
        try {
            const res = await syncDatabaseMonthPool(syncMonth)
            setSyncReport(res)
            await reload()
            router.refresh()
        } catch (e) {
            setSyncReport({
                ok: false, imported: 0, skippedClienti: 0, skippedExisting: 0,
                skippedNoPhone: 0, totalMonth: 0,
                errors: ['Errore imprevisto durante il sync: ' + String(e)],
            })
        } finally {
            setSyncing(false)
        }
    }

    return (
        <div className="bg-gradient-to-br from-blue-50 to-white rounded-xl border-2 border-blue-300 shadow-sm p-6 space-y-5 mt-8">
            {/* Header + selettore mese */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                        <Database className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-ash-900">Pool Database (ActiveCampaign)</h2>
                        <p className="text-xs text-ash-500">Contatti AC per mese di creazione, esclusi i già clienti. Provenienza: Database.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="month"
                        value={syncMonth}
                        onChange={(e) => setSyncMonth(e.target.value)}
                        disabled={syncing}
                        className="h-9 px-2 border border-blue-200 rounded-lg text-xs focus:ring-blue-500 focus:border-blue-500 disabled:bg-ash-100"
                    />
                    <button
                        onClick={handleSync}
                        disabled={syncing || !syncMonth}
                        className="flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold text-blue-800 bg-blue-100 border border-blue-300 hover:bg-blue-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {syncing
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sincronizzazione...</>
                            : <><RefreshCw className="h-3.5 w-3.5" /> Sincronizza mese</>}
                    </button>
                </div>
            </div>

            {syncReport && (
                <div className={`p-3 rounded-lg border text-xs ${syncReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {syncReport.ok ? 'Sync completato' : 'Sync con errori'}
                        {' — '}{syncReport.imported} importati, {syncReport.skippedClienti} esclusi perché clienti, {syncReport.skippedExisting} già presenti, {syncReport.skippedNoPhone} senza telefono (contatti del mese: {syncReport.totalMonth})
                    </div>
                    {syncReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
            )}

            {/* Mini tabella comparativa (tutti i pool, anche rimossi) */}
            {pools.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-blue-100 bg-white">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="bg-blue-50 text-ash-600 uppercase tracking-wider text-[10px]">
                                <th className="px-3 py-2 text-left font-semibold">Mese</th>
                                <th className="px-3 py-2 text-right font-semibold">Totale</th>
                                <th className="px-3 py-2 text-right font-semibold">Assegnati</th>
                                <th className="px-3 py-2 text-right font-semibold">Disponibili</th>
                                <th className="px-3 py-2 text-right font-semibold">Chiamati</th>
                                <th className="px-3 py-2 text-right font-semibold">Fissati</th>
                                <th className="px-3 py-2 text-right font-semibold">Confermati</th>
                                <th className="px-3 py-2 text-right font-semibold">Chiusi</th>
                                <th className="px-3 py-2 text-right font-semibold">Fatturato</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pools.map(p => (
                                <tr key={p.bucket} className="border-t border-ash-100">
                                    <td className="px-3 py-2 font-semibold text-ash-800">
                                        <div className="flex items-center gap-2">
                                            {p.label}
                                            {p.archived && <span className="px-1.5 py-0.5 rounded bg-ash-100 text-ash-500 text-[10px] font-bold uppercase">Rimosso</span>}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">{p.totale.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right">{p.assegnati.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right font-bold text-blue-700">{p.disponibili.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right">{p.chiamati.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right">{p.fissati.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right">{p.confermati.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right font-bold text-green-700">{p.chiusi.toLocaleString('it-IT')}</td>
                                    <td className="px-3 py-2 text-right font-bold text-green-700">{fmtEur(p.fatturatoEur)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activePools.length === 0 && (
                <p className="text-xs text-ash-500">Nessun pool attivo: scegli un mese e sincronizza da ActiveCampaign.</p>
            )}

            {activePools.map(p => (
                <DatabasePoolCard key={p.bucket} pool={p} gdos={gdos} onChanged={reload} />
            ))}
        </div>
    )
}

function DatabasePoolCard({ pool, gdos, onChanged }: { pool: DatabasePoolRow, gdos: GdoInfo[], onChanged: () => Promise<void> }) {
    const router = useRouter()
    const [count, setCount] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [archiving, setArchiving] = useState(false)
    const [report, setReport] = useState<DatabaseAssignReport | null>(null)

    const canSubmit = !loading && !archiving && count > 0 && selectedGdoIds.size > 0
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(count / selectedGdoIds.size) : 0

    const toggleGdo = (id: string) => {
        const next = new Set(selectedGdoIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedGdoIds(next)
    }
    const selectAll = () => setSelectedGdoIds(new Set(gdos.map(g => g.id)))
    const clearAll = () => setSelectedGdoIds(new Set())

    const handleAssign = async () => {
        if (!canSubmit) return
        if (count > 100 && !confirm(`Stai per assegnare ${count} lead in un colpo solo. Continuare?`)) return
        setLoading(true)
        setReport(null)
        try {
            const res = await assignFromDatabasePool({ bucket: pool.bucket, count, gdoIds: Array.from(selectedGdoIds) })
            setReport(res)
            if (res.ok) {
                setCount(0)
                await onChanged()
                router.refresh()
            }
        } catch (e) {
            setReport({ ok: false, errors: ['Errore imprevisto durante l\'assegnazione: ' + String(e)], perGdo: {}, totalAssigned: 0 })
        } finally {
            setLoading(false)
        }
    }

    const handleArchive = async () => {
        if (archiving || loading || pool.disponibili > 0) return
        if (!confirm(`Rimuovere il pool "${pool.label}"? I lead già assegnati e le loro statistiche restano intatti.`)) return
        setArchiving(true)
        try {
            const res = await archiveLaunchPool(pool.bucket)
            if (!res.ok) alert(res.error || 'Rimozione non riuscita.')
            else {
                await onChanged()
                router.refresh()
            }
        } finally {
            setArchiving(false)
        }
    }

    return (
        <div className="bg-white rounded-lg border border-blue-200 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Database className="h-5 w-5 text-blue-600" />
                    <div>
                        <h3 className="text-sm font-bold text-ash-900">{pool.label}</h3>
                        <p className="text-xs text-ash-500"><strong className="text-blue-700">{pool.disponibili.toLocaleString('it-IT')}</strong> lead disponibili su {pool.totale.toLocaleString('it-IT')}</p>
                    </div>
                </div>
                <button
                    onClick={handleArchive}
                    disabled={archiving || loading || pool.disponibili > 0}
                    title={pool.disponibili > 0 ? "Assegna tutti i lead per poter rimuovere il pool" : "Rimuovi il pool da questa pagina"}
                    className="flex items-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {archiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Rimuovi pool
                </button>
            </div>

            <div>
                <label className="text-xs font-semibold text-ash-700 mb-1 block">Quanti lead pescare dal pool</label>
                <input
                    type="number"
                    min={0}
                    max={pool.disponibili}
                    value={count}
                    disabled={pool.disponibili === 0}
                    onChange={(e) => setCount(Math.max(0, Math.min(pool.disponibili, parseInt(e.target.value) || 0)))}
                    className="w-full h-10 px-3 border border-blue-200 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                />
            </div>

            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ash-700 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        GDO destinatari ({selectedGdoIds.size} su {gdos.length} selezionati)
                    </label>
                    <div className="flex gap-2 text-xs">
                        <button onClick={selectAll} className="text-blue-700 hover:underline font-medium">Tutti</button>
                        <button onClick={clearAll} className="text-ash-500 hover:underline">Nessuno</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                    {gdos.map(g => (
                        <label key={g.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${selectedGdoIds.has(g.id) ? 'bg-blue-50 border-blue-300' : 'bg-white border-ash-200 hover:bg-ash-50'}`}>
                            <input
                                type="checkbox"
                                checked={selectedGdoIds.has(g.id)}
                                onChange={() => toggleGdo(g.id)}
                                className="h-3.5 w-3.5 rounded text-blue-600 border-ash-300 focus:ring-blue-500"
                            />
                            <span className="truncate font-medium text-ash-800">{g.displayName || g.name || g.id.slice(0, 6)}</span>
                        </label>
                    ))}
                    {gdos.length === 0 && (
                        <p className="text-xs text-red-600 col-span-full">Nessun GDO attivo a sistema.</p>
                    )}
                </div>
            </div>

            {count > 0 && selectedGdoIds.size > 0 && (
                <div className="bg-blue-100/60 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{count} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> selezionati ({previewPerGdo} per GDO ca.).
                    </div>
                </div>
            )}

            <div className="flex justify-end pt-1">
                <button
                    onClick={handleAssign}
                    disabled={!canSubmit}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
                >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Assegnazione in corso...</> : <>Esegui Assegnazione</>}
                </button>
            </div>

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
                                    {v.name}: <strong className="text-blue-700">{v.count}</strong>
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

- [ ] **Step 2: Montare la sezione in `ImportClient.tsx`**

1. Import in testa: `import { DatabasePoolSection } from "@/components/DatabasePoolSection"`.
2. Nel JSX, individuare `<BlackSummerPoolCard />` e aggiungere subito sotto, allo stesso livello: `<DatabasePoolSection />`.

- [ ] **Step 3: Verifica TypeScript + build**

Run: `npx tsc --noEmit` → exit 0.
Run: `npm run build` → build completata senza errori (gli warning ESLint bloccanti vanno risolti: import inutilizzati, apostrofi non escapati nelle stringhe JSX — usare `&apos;` o stringhe in JS).

- [ ] **Step 4: Commit**

```bash
git add src/components/DatabasePoolSection.tsx "src/app/(dashboard)/import/ImportClient.tsx"
git commit -m "feat(import): sezione Pool Database — sync AC per mese, tabella comparativa, assegnazione e rimozione pool"
```

---

### Task 6: Push, deploy e QA prod

**Files:** nessuno (operativo).

- [ ] **Step 1: Push su main**

```bash
git push origin main
```

Vercel builda in automatico. Verificare il deploy READY (via `mcp__vercel__list_deployments` o dashboard).

- [ ] **Step 2: QA in prod (browser)**

Su `https://crm-sales-fenice.vercel.app/import` da account admin:
1. La sezione "Pool Database (ActiveCampaign)" appare sotto la card Black Summer (solo azienda Fenice).
2. La card Black Summer mostra "Rimuovi pool" disabilitato (il pool BS ha ancora disponibili > 0) con tooltip.
3. NON sincronizzare ancora mesi reali: l'esclusione clienti non è configurata (Task 7). Verificare solo che il selettore mese e il bottone rispondano.

- [ ] **Step 3: Verifica su Serenamente**

Switch azienda → Serenamente: la sezione Pool Database NON deve apparire.

---

### Task 7: Esplorazione AC "già clienti" + attivazione pool set 2025 / apr 2026 — **BLOCCATO dalla chiave API**

Prerequisito: `ACTIVECAMPAIGN_API_KEY` nel `.env` locale (il PO la copia da Vercel) o fornita in sessione.

- [ ] **Step 1: Esplorare tag e liste AC**

Script usa-e-getta nello scratchpad (NON nel repo) con la chiave letta da `.env`:
- `GET /tags?limit=100&offset=N` → elenco completo `{id, tag, subscriber_count}`.
- `GET /lists?limit=100&offset=N` → elenco completo `{id, name}` (+ conteggi da `GET /lists/{id}` se servono).
Output: tabella nomi/conteggi per il PO.

- [ ] **Step 2: Proporre al PO i candidati "cliente" e farsi confermare i nomi**

Candidati tipici: tag "Cliente"/"Clienti", liste studenti/corsi acquistati. STOP: attendere conferma PO — è l'unico gate umano rimasto.

- [ ] **Step 3: Compilare le costanti**

In `src/app/actions/databasePoolActions.ts` popolare `CLIENT_TAG_NAMES_NORMALIZED` / `CLIENT_LIST_NAMES_NORMALIZED` con i nomi confermati (trim+lowercase).

- [ ] **Step 4: Validare il conteggio atteso**

Con lo script scratchpad: contatti con `cdate` in 2025-09 meno i membri dei tag/liste clienti ≈ **6.300** (atteso PO). Se lontano, riportare al PO prima di procedere.

- [ ] **Step 5: Commit + push**

```bash
git add src/app/actions/databasePoolActions.ts
git commit -m "feat(pool-database): config esclusione già clienti (tag/liste AC confermati dal PO)"
git push origin main
```

- [ ] **Step 6: Attivare i due pool iniziali in prod**

Da /import (admin): sincronizzare **2025-09** e **2026-04**. Verifiche:
- report sync set 2025: importati ≈ 6.300, `skippedClienti` > 0;
- tabella comparativa: 2 righe con totali coerenti;
- assegnare 2-3 lead a un GDO di test → disponibili scala, lead in pipeline GDO con funnel Database;
- "Rimuovi pool" resta disabilitato finché disponibili > 0.
