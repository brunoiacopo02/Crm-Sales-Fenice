# Lancio Videoeditor Pool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere al manager di pescare gradualmente da un pool di ~5.728 lead "Lancio Videoeditor" (1.473 webinar visto + 4.255 non visto), assegnandone N+M alla volta a un sottoinsieme di GDO con split round-robin equo.

**Architecture:** Schema change minimo (colonna `launchBucket` su `leads`), seed SQL diretto su Supabase, due server action (`getLaunchPoolStatus` + `assignFromLaunchPool`) con pesca atomica `FOR UPDATE SKIP LOCKED`, una card client (`LaunchPoolCard`) montata sotto il flusso CSV in `/import`.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, Supabase Postgres, Tailwind, Lucide. Test = `npm run build` typecheck + smoke browser su `localhost:3000/import`.

**Spec:** `docs/superpowers/specs/2026-05-12-lancio-videoeditor-pool-design.md`

**Note importanti:**
- Niente infrastruttura test nel progetto → ogni task chiude con `npm run build` (typecheck pulito) + commit.
- Migration applicata via Supabase MCP (`apply_migration`) come prassi del progetto.
- Seed dei lead via Supabase MCP (`execute_sql`) in batch da ~400 righe.

---

## File Structure

**Modified:**
- `src/db/schema.ts` — aggiunta colonna `launchBucket: text('launchBucket')` sulla table `leads`.
- `src/app/(dashboard)/import/page.tsx` — montaggio `<LaunchPoolCard />` sotto `<LeadRedistributionCard />`.

**Created:**
- `drizzle/migrations/0003_lead_launch_bucket.sql` — migration ALTER TABLE.
- `src/app/actions/launchPoolActions.ts` — `getLaunchPoolStatus`, `assignFromLaunchPool`.
- `src/components/LaunchPoolCard.tsx` — UI client.
- `scripts/seed-launch-pool.mjs` — script one-shot che legge i due xlsx e produce SQL batchato per Supabase MCP (oneshot, non committato in cronologia critica).

**Eseguito una tantum su Supabase prod:**
- Apply migration `0003_lead_launch_bucket`.
- Seed 1.473 + 4.255 = 5.728 lead.

---

## Task 1: Schema change + migration file

**Files:**
- Modify: `src/db/schema.ts` (riga ~79, accanto a `isSelfBooked`)
- Create: `drizzle/migrations/0003_lead_launch_bucket.sql`

- [ ] **Step 1.1: Aggiungere colonna `launchBucket` allo schema Drizzle**

In `src/db/schema.ts`, individua la riga `isSelfBooked: boolean('isSelfBooked').default(false).notNull(),` (intorno a riga 79) all'interno della definizione `export const leads = pgTable('leads', { ... })`. Aggiungi **subito sotto** questa riga:

```ts
    // Lancio Videoeditor (maggio 2026): marca i lead pescabili dal pool del lancio.
    // 'WEBINAR' = ha visto il webinar Zoom; 'NO_WEBINAR' = non l'ha visto; null = lead normale.
    launchBucket: text('launchBucket'),
```

- [ ] **Step 1.2: Creare il file migration**

Crea `drizzle/migrations/0003_lead_launch_bucket.sql` con questo contenuto esatto:

```sql
ALTER TABLE "leads" ADD COLUMN "launchBucket" text;

-- Indice parziale: tutte le query del pool filtrano su (launchBucket NOT NULL AND assignedToId IS NULL).
-- L'indice parziale &egrave; piccolo e rende O(log n) il count del pool, che viene letto a ogni
-- apertura della card LaunchPoolCard in /import.
CREATE INDEX "leads_launch_bucket_pool_idx"
  ON "leads" ("launchBucket")
  WHERE "launchBucket" IS NOT NULL AND "assignedToId" IS NULL;
```

- [ ] **Step 1.3: Aggiornare `_journal.json` di drizzle**

Apri `drizzle/migrations/meta/_journal.json` e aggiungi un'entry per la nuova migration in coda all'array `entries`. La struttura tipica &egrave;:

```json
{
  "idx": 3,
  "version": "7",
  "when": <UNIX_MS_TIMESTAMP>,
  "tag": "0003_lead_launch_bucket",
  "breakpoints": true
}
```

Usa il timestamp corrente (es. `Date.now()` di Node.js). Verifica che gli `idx`, `version`, e `breakpoints` siano coerenti con le entry esistenti (copia il formato della entry per `0002_lead_is_self_booked`).

- [ ] **Step 1.4: Typecheck**

```bash
npm run build
```
Atteso: build OK, nessun errore TS sulla nuova colonna. Se errore "Cannot find name `launchBucket`", rileggere step 1.1.

- [ ] **Step 1.5: Commit**

```bash
git add src/db/schema.ts drizzle/migrations/0003_lead_launch_bucket.sql drizzle/migrations/meta/_journal.json
git commit -m "feat(schema): add launchBucket column for lancio videoeditor pool"
```

---

## Task 2: Apply migration to Supabase production

**Files:** nessuno (operazione DB live)

- [ ] **Step 2.1: Applicare la migration via Supabase MCP**

Invoca lo strumento `mcp__supabase__apply_migration` con:
- `name`: `"0003_lead_launch_bucket"`
- `query`: il contenuto **completo** del file `drizzle/migrations/0003_lead_launch_bucket.sql` (entrambe le statement: ALTER TABLE + CREATE INDEX).

Atteso: response con `success: true`.

- [ ] **Step 2.2: Verifica che la colonna esista**

Invoca `mcp__supabase__execute_sql` con:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'leads' AND column_name = 'launchBucket';
```

Atteso: una riga `launchBucket | text | YES`.

- [ ] **Step 2.3: Verifica indice parziale**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'leads' AND indexname = 'leads_launch_bucket_pool_idx';
```

Atteso: una riga con l'indexdef contenente `WHERE`.

---

## Task 3: Seed dei lead dai due xlsx

**Files:**
- Create: `scripts/seed-launch-pool.mjs` (one-shot, conservato in repo per traccia)

- [ ] **Step 3.1: Scrivere lo script che converte xlsx → SQL**

Crea `scripts/seed-launch-pool.mjs`:

```js
// One-shot seeder per il pool Lancio Videoeditor (12 maggio 2026).
// Legge i due xlsx forniti dall'owner, normalizza nome/email/telefono, ed emette
// statement SQL INSERT batchati (400 righe per batch) su stdout.
// Esegui:  node scripts/seed-launch-pool.mjs > /tmp/seed-launch-pool.sql
// Poi applica i blocchi via Supabase MCP execute_sql (un batch alla volta).

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import * as XLSX from 'xlsx-cli/xlsx.js' // o equivalente — vedi step 3.2

const FILES = [
  { path: 'C:/Users/bruno/Downloads/lead_zoom_con_telefono.xlsx',  bucket: 'WEBINAR' },
  { path: 'C:/Users/bruno/Downloads/lead_da_chiamare_dopo.xlsx',    bucket: 'NO_WEBINAR' },
]

const BATCH = 400

function esc(v) {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

function normalizePhone(raw) {
  if (!raw) return null
  const cleaned = String(raw).replace(/[^\d+]/g, '')
  return cleaned.length >= 5 ? cleaned : null
}

function normalizeEmail(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  return s.includes('@') && s.includes('.') ? s : null
}

const now = new Date().toISOString()
const allRows = []

for (const { path, bucket } of FILES) {
  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

  for (const r of rows) {
    const phone = normalizePhone(r.Telefono ?? r.telefono ?? r.Phone)
    if (!phone) continue // skip righe senza telefono utile
    const name  = String(r.Nome ?? r.nome ?? '').trim() || 'Lead senza nome'
    const email = normalizeEmail(r.Email ?? r.email)
    allRows.push({ id: randomUUID(), name, phone, email, bucket })
  }
}

console.log(`-- TOTAL ROWS: ${allRows.length}`)
for (let i = 0; i < allRows.length; i += BATCH) {
  const chunk = allRows.slice(i, i + BATCH)
  console.log(`\n-- BATCH ${Math.floor(i / BATCH) + 1} (${chunk.length} righe)`)
  const values = chunk.map(r =>
    `(${esc(r.id)}, ${esc(r.name)}, ${esc(r.phone)}, ${r.email ? esc(r.email) : 'NULL'}, 'ORG', 'NEW', 0, false, ${esc(r.bucket)}, NULL, '${now}', '${now}')`
  ).join(',\n  ')
  console.log(
    `INSERT INTO leads (id, name, phone, email, funnel, status, "callCount", "isSelfBooked", "launchBucket", "assignedToId", "createdAt", "updatedAt") VALUES\n  ${values};`
  )
}

// Eventi IMPORTED associati (uno per lead). Stesso batching.
console.log(`\n-- EVENTS IMPORTED`)
for (let i = 0; i < allRows.length; i += BATCH) {
  const chunk = allRows.slice(i, i + BATCH)
  console.log(`\n-- EVENTS BATCH ${Math.floor(i / BATCH) + 1} (${chunk.length} righe)`)
  const values = chunk.map(r =>
    `(${esc(randomUUID())}, ${esc(r.id)}, 'IMPORTED', NULL, NULL, NULL, '{"source":"launch_pool_seed","bucket":"${r.bucket}"}'::jsonb, '${now}')`
  ).join(',\n  ')
  console.log(
    `INSERT INTO events (id, "leadId", "eventType", "userId", "fromSection", "toSection", metadata, "createdAt") VALUES\n  ${values};`
  )
}
```

**Importante:** prima di eseguire, verifica nello schema reale di `events` (in `src/db/schema.ts`) quali colonne sono `NOT NULL` e adatta la INSERT di conseguenza. Se la colonna `metadata` non esiste o ha nome diverso (es. `data`), aggiusta. **Apri schema.ts ed ispeziona** la definizione di `events` PRIMA di lanciare lo script.

- [ ] **Step 3.2: Risolvere la dipendenza xlsx**

Lo script richiede una libreria xlsx. Le opzioni:

a. Usare `xlsx-cli` (gi&agrave; usata via npx in chat) → installazione globale o `npx xlsx-cli` per esportare a CSV temporaneo, poi parsare CSV nello script.

b. Usare la libreria `xlsx` (SheetJS) installata localmente per la durata dello script:

```bash
npm install --no-save xlsx
```

Se vai con (b), cambia la riga import in `scripts/seed-launch-pool.mjs`:

```js
import XLSX from 'xlsx'
```

L'API `XLSX.readFile(path)` e `XLSX.utils.sheet_to_json` &egrave; la stessa.

- [ ] **Step 3.3: Generare il file SQL**

```bash
node scripts/seed-launch-pool.mjs > /tmp/seed-launch-pool.sql
wc -l /tmp/seed-launch-pool.sql
head -30 /tmp/seed-launch-pool.sql
```

Atteso: file generato, riga 1 = `-- TOTAL ROWS: ~5700`. Verifica visivamente che la prima INSERT abbia ~400 righe.

- [ ] **Step 3.4: Applicare i batch su Supabase**

Estrai ogni blocco delimitato da `-- BATCH N` o `-- EVENTS BATCH N` dal file. Per ciascuno invoca `mcp__supabase__execute_sql` passando come `query` lo statement INSERT singolo.

Stima: ~15 batch leads (5728/400) + 15 batch events = 30 chiamate MCP. Eseguile in serie, non parallele (evitare timeout / lock contention).

- [ ] **Step 3.5: Verifica conteggi**

```sql
SELECT "launchBucket", COUNT(*)
FROM leads
WHERE "launchBucket" IS NOT NULL
GROUP BY "launchBucket";
```

Atteso:
```
WEBINAR     | ~1473
NO_WEBINAR  | ~4255
```

I numeri possono variare di pochi a causa di righe scartate per telefono mancante/invalido.

```sql
SELECT COUNT(*) FROM events WHERE "eventType" = 'IMPORTED' AND metadata->>'source' = 'launch_pool_seed';
```

Atteso: somma dei due conteggi precedenti.

- [ ] **Step 3.6: Commit dello script**

```bash
git add scripts/seed-launch-pool.mjs
git commit -m "chore(seed): one-shot script per pool lancio videoeditor"
```

---

## Task 4: Server action `getLaunchPoolStatus`

**Files:**
- Create: `src/app/actions/launchPoolActions.ts`

- [ ] **Step 4.1: Scrivere la action**

Crea `src/app/actions/launchPoolActions.ts`:

```ts
"use server"

import { db } from "@/db"
import { leads } from "@/db/schema"
import { and, isNull, isNotNull, sql, eq } from "drizzle-orm"

export type LaunchPoolStatus = {
    webinarAvailable: number
    noWebinarAvailable: number
}

export async function getLaunchPoolStatus(): Promise<LaunchPoolStatus> {
    const rows = await db
        .select({
            bucket: leads.launchBucket,
            count: sql<number>`count(*)::int`
        })
        .from(leads)
        .where(and(isNotNull(leads.launchBucket), isNull(leads.assignedToId)))
        .groupBy(leads.launchBucket)

    let webinar = 0
    let noWebinar = 0
    for (const r of rows) {
        if (r.bucket === 'WEBINAR') webinar = r.count
        else if (r.bucket === 'NO_WEBINAR') noWebinar = r.count
    }

    return { webinarAvailable: webinar, noWebinarAvailable: noWebinar }
}
```

- [ ] **Step 4.2: Typecheck**

```bash
npm run build
```

Atteso: build OK. Se "Property `launchBucket` does not exist on type … leads", il Task 1 non &egrave; stato applicato.

- [ ] **Step 4.3: Smoke test via dev server**

Avvia `npm run dev` in background. Apri una pagina della dashboard (manager). Aggiungi un piccolo blocco temporaneo in una pagina debug per chiamare `getLaunchPoolStatus()` e loggarne il risultato (oppure salta — lo verifichiamo end-to-end nel Task 8).

- [ ] **Step 4.4: Commit**

```bash
git add src/app/actions/launchPoolActions.ts
git commit -m "feat(actions): getLaunchPoolStatus per pool lancio videoeditor"
```

---

## Task 5: Server action `assignFromLaunchPool`

**Files:**
- Modify: `src/app/actions/launchPoolActions.ts`

- [ ] **Step 5.1: Aggiungere la action di pesca atomica**

In coda al file `src/app/actions/launchPoolActions.ts`, aggiungi:

```ts
import { createClient } from "@/utils/supabase/server"
import { users } from "@/db/schema"
import { inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import crypto from "crypto"
import { logLeadEvent } from "@/lib/eventLogger"
import { previewLeadDistribution } from "@/lib/distributionUtils"

export type AssignFromPoolInput = {
    webinarCount: number
    noWebinarCount: number
    gdoIds: string[]
}

export type AssignFromPoolReport = {
    ok: boolean
    errors: string[]
    /** Mappa gdoId → { webinar, noWebinar } effettivamente assegnati */
    perGdo: Record<string, { webinar: number, noWebinar: number, name: string }>
    totalAssigned: number
}

export async function assignFromLaunchPool(input: AssignFromPoolInput): Promise<AssignFromPoolReport> {
    const report: AssignFromPoolReport = {
        ok: false,
        errors: [],
        perGdo: {},
        totalAssigned: 0,
    }

    const webinarCount   = Math.max(0, Math.floor(input.webinarCount || 0))
    const noWebinarCount = Math.max(0, Math.floor(input.noWebinarCount || 0))

    if (webinarCount + noWebinarCount === 0) {
        report.errors.push("Devi specificare almeno 1 lead da pescare.")
        return report
    }
    if (!input.gdoIds || input.gdoIds.length === 0) {
        report.errors.push("Devi selezionare almeno 1 GDO destinatario.")
        return report
    }

    // Verifica GDO selezionati attivi
    const selectedGdos = (await db.select().from(users).where(inArray(users.id, input.gdoIds)))
        .filter((u: any) => u.role === 'GDO' && u.isActive === true)
    if (selectedGdos.length === 0) {
        report.errors.push("Nessuno dei GDO selezionati &egrave; attivo.")
        return report
    }
    if (selectedGdos.length !== input.gdoIds.length) {
        report.errors.push(`${input.gdoIds.length - selectedGdos.length} GDO selezionati ignorati perch&eacute; non attivi.`)
    }

    // Identifica admin chiamante per log evento
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const adminId = supabaseUser?.id

    // Inizializza perGdo
    for (const g of selectedGdos) {
        report.perGdo[g.id] = { webinar: 0, noWebinar: 0, name: g.displayName || g.name || g.id }
    }

    // Pesca atomica per ciascun bucket richiesto
    const pickedByBucket: Record<'WEBINAR' | 'NO_WEBINAR', string[]> = { WEBINAR: [], NO_WEBINAR: [] }

    await db.transaction(async (tx) => {
        for (const [bucket, n] of [['WEBINAR', webinarCount], ['NO_WEBINAR', noWebinarCount]] as const) {
            if (n === 0) continue
            const picked = await tx.execute(sql`
                SELECT id FROM leads
                WHERE "launchBucket" = ${bucket}
                  AND "assignedToId" IS NULL
                ORDER BY "createdAt" ASC
                LIMIT ${n}
                FOR UPDATE SKIP LOCKED
            `)
            const ids: string[] = (picked as any).rows
                ? (picked as any).rows.map((r: any) => r.id)
                : (picked as any).map((r: any) => r.id)
            pickedByBucket[bucket] = ids
        }

        // Compute split round-robin equo per ciascun bucket sui GDO selezionati
        // Riuso previewLeadDistribution che ritorna { gdoId: { count, name } }
        for (const bucket of ['WEBINAR', 'NO_WEBINAR'] as const) {
            const ids = pickedByBucket[bucket]
            if (ids.length === 0) continue

            const distr = previewLeadDistribution(ids.length, selectedGdos, 'equal', {})
            const assignPlan: string[] = []
            for (const gdoId in distr) {
                for (let i = 0; i < distr[gdoId].count; i++) assignPlan.push(gdoId)
            }

            // UPDATE in batch: un update per ciascun GDO con gli id che gli toccano
            const idsByGdo: Record<string, string[]> = {}
            for (let i = 0; i < ids.length; i++) {
                const gdo = assignPlan[i] || selectedGdos[0].id
                if (!idsByGdo[gdo]) idsByGdo[gdo] = []
                idsByGdo[gdo].push(ids[i])
            }
            for (const [gdoId, leadIds] of Object.entries(idsByGdo)) {
                await tx.execute(sql`
                    UPDATE leads
                    SET "assignedToId" = ${gdoId}, "updatedAt" = NOW()
                    WHERE id = ANY(${leadIds}::uuid[])
                `)
                if (bucket === 'WEBINAR') report.perGdo[gdoId].webinar += leadIds.length
                else report.perGdo[gdoId].noWebinar += leadIds.length
                report.totalAssigned += leadIds.length
            }
        }
    })

    // Log eventi ASSIGNED (fuori dalla tx per non bloccarla)
    for (const bucket of ['WEBINAR', 'NO_WEBINAR'] as const) {
        const ids = pickedByBucket[bucket]
        if (ids.length === 0) continue
        // Ricarico il mapping id → gdo per logging
        const assignedRows = await db
            .select({ id: leads.id, assignedToId: leads.assignedToId })
            .from(leads)
            .where(inArray(leads.id, ids))

        for (const row of assignedRows) {
            await logLeadEvent({
                leadId: row.id,
                eventType: 'ASSIGNED',
                userId: adminId,
                metadata: { source: 'launch_pool', bucket, assignedToUser: row.assignedToId }
            })
        }
    }

    revalidatePath('/', 'layout')

    report.ok = report.totalAssigned > 0
    if (report.totalAssigned === 0 && report.errors.length === 0) {
        report.errors.push("Nessun lead pescato (il pool del bucket richiesto potrebbe essere vuoto).")
    }
    return report
}
```

- [ ] **Step 5.2: Verifica firma di `previewLeadDistribution`**

Apri `src/lib/distributionUtils.ts` (o file equivalente) e verifica:
1. La funzione esiste e accetta `(total, gdos, mode, settings)`.
2. Ritorna `Record<gdoId, { count, name }>`.

Se la firma diverge, adatta la chiamata in Step 5.1 di conseguenza.

- [ ] **Step 5.3: Verifica firma di `logLeadEvent`**

Apri `src/lib/eventLogger.ts` (o file equivalente). Conferma che accetta `{ leadId, eventType, userId, metadata }`. Se la API &egrave; diversa, adatta lo step 5.1.

- [ ] **Step 5.4: Typecheck**

```bash
npm run build
```

Atteso: nessun errore TS. Se ci sono errori, sono quasi certamente in:
- import di `sql` da drizzle-orm (verifica che non sia gi&agrave; importato in alto al file)
- firma di `previewLeadDistribution` o `logLeadEvent`
- handling del result di `tx.execute` (a seconda di come drizzle restituisce le righe)

Risolvi ogni errore mirando alla riga specifica.

- [ ] **Step 5.5: Commit**

```bash
git add src/app/actions/launchPoolActions.ts
git commit -m "feat(actions): assignFromLaunchPool atomica con FOR UPDATE SKIP LOCKED"
```

---

## Task 6: Componente UI `LaunchPoolCard`

**Files:**
- Create: `src/components/LaunchPoolCard.tsx`

- [ ] **Step 6.1: Scrivere il componente**

Crea `src/components/LaunchPoolCard.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Rocket, Eye, EyeOff, Users, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import {
    getLaunchPoolStatus,
    assignFromLaunchPool,
    type LaunchPoolStatus,
    type AssignFromPoolReport,
} from "@/app/actions/launchPoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

export function LaunchPoolCard() {
    const router = useRouter()
    const [status, setStatus] = useState<LaunchPoolStatus | null>(null)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [webinarN, setWebinarN] = useState<number>(0)
    const [noWebinarN, setNoWebinarN] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [report, setReport] = useState<AssignFromPoolReport | null>(null)

    useEffect(() => {
        Promise.all([getLaunchPoolStatus(), getActiveGdosForImport()])
            .then(([s, g]) => { setStatus(s); setGdos(g as GdoInfo[]) })
    }, [])

    // Pool completamente vuoto → non rendere nulla
    if (status && status.webinarAvailable === 0 && status.noWebinarAvailable === 0) {
        return null
    }
    if (!status) return null // loading: la card si nasconde fino al fetch

    const total = webinarN + noWebinarN
    const noGdoSelected = selectedGdoIds.size === 0
    const canSubmit = !loading && total > 0 && !noGdoSelected
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(total / selectedGdoIds.size) : 0

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
        if (total > 100 && !confirm(`Stai per assegnare ${total} lead in un colpo solo. Continuare?`)) return

        setLoading(true)
        setReport(null)
        try {
            const res = await assignFromLaunchPool({
                webinarCount: webinarN,
                noWebinarCount: noWebinarN,
                gdoIds: Array.from(selectedGdoIds),
            })
            setReport(res)
            if (res.ok) {
                // refresh stato pool + dashboard
                const fresh = await getLaunchPoolStatus()
                setStatus(fresh)
                setWebinarN(0)
                setNoWebinarN(0)
                router.refresh()
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="bg-gradient-to-br from-purple-50 to-white rounded-xl border-2 border-purple-200 shadow-sm p-6 space-y-5 mt-8">
            <div className="flex items-center gap-3 border-b border-purple-100 pb-4">
                <div className="h-10 w-10 rounded-lg bg-purple-600 text-white flex items-center justify-center">
                    <Rocket className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-ash-900">Pool Lancio Videoeditor</h2>
                    <p className="text-xs text-ash-500">Distribuisci gradualmente i lead del lancio ai tuoi GDO. Funnel: ORG.</p>
                </div>
            </div>

            {/* Stat tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg border border-purple-100 p-4 flex items-center gap-3">
                    <Eye className="h-6 w-6 text-purple-600" />
                    <div>
                        <p className="text-xs uppercase text-ash-500 tracking-wider font-semibold">Webinar Visto</p>
                        <p className="text-2xl font-black text-ash-900">{status.webinarAvailable} <span className="text-xs font-normal text-ash-500">disponibili</span></p>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-purple-100 p-4 flex items-center gap-3">
                    <EyeOff className="h-6 w-6 text-ash-500" />
                    <div>
                        <p className="text-xs uppercase text-ash-500 tracking-wider font-semibold">Webinar NON Visto</p>
                        <p className="text-2xl font-black text-ash-900">{status.noWebinarAvailable} <span className="text-xs font-normal text-ash-500">disponibili</span></p>
                    </div>
                </div>
            </div>

            {/* Quantit&agrave; input */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-semibold text-ash-700 mb-1 block">Pesca dal pool "Webinar Visto"</label>
                    <input
                        type="number"
                        min={0}
                        max={status.webinarAvailable}
                        value={webinarN}
                        disabled={status.webinarAvailable === 0}
                        onChange={(e) => setWebinarN(Math.max(0, Math.min(status.webinarAvailable, parseInt(e.target.value) || 0)))}
                        className="w-full h-10 px-3 border border-purple-200 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                    />
                </div>
                <div>
                    <label className="text-xs font-semibold text-ash-700 mb-1 block">Pesca dal pool "Webinar NON Visto"</label>
                    <input
                        type="number"
                        min={0}
                        max={status.noWebinarAvailable}
                        value={noWebinarN}
                        disabled={status.noWebinarAvailable === 0}
                        onChange={(e) => setNoWebinarN(Math.max(0, Math.min(status.noWebinarAvailable, parseInt(e.target.value) || 0)))}
                        className="w-full h-10 px-3 border border-purple-200 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                    />
                </div>
            </div>

            {/* GDO selection */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ash-700 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        GDO destinatari ({selectedGdoIds.size} su {gdos.length} selezionati)
                    </label>
                    <div className="flex gap-2 text-xs">
                        <button onClick={selectAll} className="text-purple-600 hover:underline font-medium">Tutti</button>
                        <button onClick={clearAll} className="text-ash-500 hover:underline">Nessuno</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                    {gdos.map(g => (
                        <label key={g.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${selectedGdoIds.has(g.id) ? 'bg-purple-50 border-purple-300' : 'bg-white border-ash-200 hover:bg-ash-50'}`}>
                            <input
                                type="checkbox"
                                checked={selectedGdoIds.has(g.id)}
                                onChange={() => toggleGdo(g.id)}
                                className="h-3.5 w-3.5 rounded text-purple-600 border-ash-300 focus:ring-purple-500"
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
                <div className="bg-purple-100/60 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{total} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> selezionati ({previewPerGdo} per GDO ca.). Lo split &egrave; calcolato separatamente per ciascun bucket.
                    </div>
                </div>
            )}

            {/* Submit */}
            <div className="flex justify-end pt-2">
                <button
                    onClick={handleAssign}
                    disabled={!canSubmit}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
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
                            {Object.entries(report.perGdo).filter(([, v]) => v.webinar + v.noWebinar > 0).map(([id, v]) => (
                                <span key={id} className="bg-white px-2.5 py-1 rounded-md border border-green-200 text-ash-600 font-medium shadow-sm">
                                    {v.name}: <strong className="text-purple-700">{v.webinar}W</strong> + <strong className="text-ash-700">{v.noWebinar}NW</strong>
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

- [ ] **Step 6.2: Typecheck**

```bash
npm run build
```

Atteso: nessun errore. Se compare un errore su `getActiveGdosForImport` (tipi del return), aggiusta il `as GdoInfo[]` cast in Step 6.1.

- [ ] **Step 6.3: Commit**

```bash
git add src/components/LaunchPoolCard.tsx
git commit -m "feat(ui): LaunchPoolCard per pesca dal pool lancio videoeditor"
```

---

## Task 7: Mount card in `/import`

**Files:**
- Modify: `src/app/(dashboard)/import/page.tsx`

- [ ] **Step 7.1: Importare e montare il componente**

In `src/app/(dashboard)/import/page.tsx`:

1. Aggiungi l'import insieme agli altri (vicino a `LeadRedistributionCard`):

```ts
import { LaunchPoolCard } from "@/components/LaunchPoolCard"
```

2. In fondo al JSX di ritorno, **subito sotto** `<LeadRedistributionCard />` (riga 501), aggiungi:

```tsx
<LaunchPoolCard />
```

Il blocco risultante deve essere:

```tsx
            <LeadRedistributionCard />
            <LaunchPoolCard />
        </div>
    )
}
```

- [ ] **Step 7.2: Typecheck**

```bash
npm run build
```

Atteso: build OK.

- [ ] **Step 7.3: Commit**

```bash
git add src/app/(dashboard)/import/page.tsx
git commit -m "feat(import): mount LaunchPoolCard sotto LeadRedistributionCard"
```

---

## Task 8: Smoke test end-to-end + deploy

**Files:** nessuno

- [ ] **Step 8.1: Avvia dev server e verifica la card**

```bash
npm run dev
```

Apri http://localhost:3000/import in un browser autenticato come manager. Atteso:
- La card "Pool Lancio Videoeditor" appare in fondo alla pagina con i conteggi corretti (~1473 / ~4255).
- La lista GDO mostra tutti gli account `GDO` attivi.

- [ ] **Step 8.2: Test pesca piccola**

Compila: webinar=2, no-webinar=2, seleziona 1 GDO. Premi "Esegui Assegnazione". Atteso:
- Report verde con "4 lead assegnati con successo".
- Tag che mostra `<NomeGdo>: 2W + 2NW`.
- I contatori si aggiornano: webinar → ~1471, no-webinar → ~4253.

- [ ] **Step 8.3: Verifica DB**

Invoca `mcp__supabase__execute_sql`:

```sql
SELECT id, name, "launchBucket", "assignedToId", status
FROM leads
WHERE "launchBucket" IS NOT NULL AND "assignedToId" IS NOT NULL
ORDER BY "updatedAt" DESC
LIMIT 6;
```

Atteso: 4 righe del GDO appena selezionato con `launchBucket` valorizzato e `assignedToId` settato.

```sql
SELECT "leadId", "eventType", metadata, "createdAt"
FROM events
WHERE metadata->>'source' = 'launch_pool'
ORDER BY "createdAt" DESC
LIMIT 8;
```

Atteso: 4 eventi `ASSIGNED` con `metadata.bucket` corretto.

- [ ] **Step 8.4: Test edge case — pool vuoto in un bucket**

Se vuoi forzare, esegui temporaneamente in SQL:

```sql
-- TEMP: marca i webinar come gi&agrave; assegnati per simulare pool vuoto
UPDATE leads SET "assignedToId" = (SELECT id FROM users WHERE role='GDO' AND "isActive"=true LIMIT 1)
WHERE "launchBucket" = 'WEBINAR' AND "assignedToId" IS NULL;
```

(Non eseguire in prod, salta questo step se non vuoi sporcare i dati).

Skip raccomandato per produzione.

- [ ] **Step 8.5: Test edge case — N richiesto > disponibili**

Imposta webinar = 999999. Atteso: l'input clampa automaticamente al max disponibile.

- [ ] **Step 8.6: Test edge case — nessun GDO selezionato**

Deseleziona tutti i GDO con "Nessuno". Atteso: bottone disabilitato.

- [ ] **Step 8.7: Commit finale (se ci sono modifiche non committate)**

```bash
git status
```

Se pulito, salta. Altrimenti committa con messaggio descrittivo.

- [ ] **Step 8.8: Push e deploy**

```bash
git push origin main
```

Vercel deploya automaticamente. Verifica deploy "Ready" su Vercel dashboard. Poi apri la URL di produzione `/import`, ripeti rapidamente step 8.1-8.2 con webinar=1, noWebinar=1, 1 GDO.

- [ ] **Step 8.9: Smoke produzione**

In prod:
- Card visibile? Conteggi giusti? Pesca riuscita? Report verde?
- Apri `/conferme` o la dashboard GDO assegnato — il lead pescato compare nella sua pipeline?

Se s&igrave;, feature shipped.

---

## Out of scope (esplicitamente)

- Storico dei round di pesca (chi ha pescato cosa quando).
- Filtri/analytics per `launchBucket` nelle altre pagine.
- "Restituisci al pool" / "scarta dal pool" (un lead assegnato non torna indietro).
- Auto-conversione da xlsx → DB direttamente dall'UI.
