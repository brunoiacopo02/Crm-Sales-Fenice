# Incassi dal gestionale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il CRM copia ogni ora contratti, rate, incassi e commissioni dall'API del gestionale e li mostra in `/incassi` (ADMIN) e `/miei-incassi` (VENDITORE, commissione meno multe).

**Architecture:** Moduli puri in `src/lib/gestionale/` (parse, plan, metrics) testati con `node:test`; un runner (`run.ts`) applica lo snapshot in transazione su 5 tabelle nuove; cron orario + pulsante admin chiamano lo stesso runner; due pagine server component leggono le tabelle tramite `queries.ts`.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM (pg), Supabase Postgres, Tailwind, `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-02-incassi-gestionale-design.md`

## Global Constraints

- Il CRM non scrive MAI verso il gestionale e NON ricalcola le commissioni: usa `commissione_imponibile` del blocco `commissioni`.
- Importi in centesimi interi (`integer`), conversione dalla stringa senza float.
- Date del gestionale = stringhe `YYYY-MM-DD`; mese = `YYYY-MM`.
- Mesi selezionabili: da `2026-09` al mese corrente Europe/Rome (`currentYearMonthRome()` in `src/lib/workingDaysUtils.ts`).
- Env: `GESTIONALE_API_URL`, `GESTIONALE_API_KEY`; kill-switch `GESTIONALE_SYNC=off`. Env assenti ⇒ run `skipped`, nessun errore.
- Parametri fissi della chiamata: `dal=2026-09-01&incassi_dal=2026-09-01`.
- Nessun export di logica non autenticata da un file `'use server'` (ogni export lì è un endpoint pubblico).
- Testi UI in italiano. Mai `<button>` dentro `<span>`/`<p>` (CLAUDE.md §4.1).
- Migration SQL a mano, idempotente, numero `0039`, commenti in italiano.
- Ogni nuovo `*.test.ts` va aggiunto in coda allo script `"test"` di `package.json` (i file sono elencati uno per uno).
- Commit con trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. Risposta del gestionale vuota o troncata (`contratti: []`) con dati già in DB → nessuna cancellazione di massa; run in errore leggibile. (Task 3)
2. Uno storno (importo negativo, `storno_di`) → il totale cassa del mese scende; l'originale non viene contato due volte né tolto due volte. (Task 6)
3. Un venditore apre `/miei-incassi` → vede solo i suoi dati anche manipolando la query string (`?mese=` è l'unico parametro accettato, l'utente viene SOLO dalla sessione). (Task 8)
4. Cron e pulsante partono insieme → un solo sync applica, l'altro esce `skipped` (lock advisory). (Task 4)
5. Mese senza riga `commissioni` per un venditore (o `?mese=` invalido) → pagina non crasha: zero esplicito / fallback al mese corrente. (Task 6, Task 7)

---

## File Structure

- Create `drizzle/migrations/0039_gestionale_incassi.sql` — DDL delle 5 tabelle.
- Modify `src/db/schema.ts` (in coda) — 5 tabelle Drizzle.
- Create `src/lib/gestionale/types.ts` — tipi riga condivisi.
- Create `src/lib/gestionale/parse.ts` + `parse.test.ts` — validazione e conversione snapshot.
- Create `src/lib/gestionale/__fixtures__/snapshot.sample.json` — fixture dal formato concordato.
- Create `src/lib/gestionale/plan.ts` + `plan.test.ts` — diff id e guardie.
- Create `src/lib/gestionale/client.ts` — fetch HTTP.
- Create `src/lib/gestionale/run.ts` — runner con transazione e lock.
- Create `src/app/api/cron/gestionale-sync/route.ts`; Modify `vercel.json`.
- Create `src/app/actions/gestionaleSyncActions.ts` — pulsante admin.
- Create `src/lib/gestionale/metrics.ts` + `metrics.test.ts` — calcoli puri.
- Create `src/lib/gestionale/queries.ts` — letture DB per le pagine.
- Create `src/app/(dashboard)/incassi/page.tsx`, `IncassiAdminClient.tsx`, `src/components/gestionale/MonthSelect.tsx`, `src/components/gestionale/AtRiskTable.tsx`, `src/components/gestionale/format.ts`.
- Create `src/app/(dashboard)/miei-incassi/page.tsx`.
- Modify `src/components/Sidebar.tsx` — due voci.
- Modify `package.json` — script test.

---

### Task 1: Tabelle (migration + schema Drizzle)

**Files:**
- Create: `drizzle/migrations/0039_gestionale_incassi.sql`
- Modify: `src/db/schema.ts` (append in fondo al file)

**Interfaces:**
- Produces: export Drizzle `gestionaleContratti`, `gestionaleRate`, `gestionaleIncassi`, `gestionaleCommissioni`, `gestionaleSyncRuns` con i nomi colonna qui sotto (camelCase quotati).

- [ ] **Step 1: Scrivi la migration**

```sql
-- 0039: incassi dal gestionale amministrazione (spec 2026-10-02).
--
-- Copia in sola lettura dello snapshot GET /api/v1/contratti del gestionale.
-- Il gestionale e' la fonte di verita': queste righe si riscrivono a ogni sync
-- e non si modificano mai a mano. Gli importi sono in CENTESIMI interi.
-- Un record sparito dallo snapshot non si cancella: prende "deletedAt", cosi'
-- un'eliminazione per errore nel gestionale si ripristina al giro dopo.

create table if not exists public."gestionaleContratti" (
  "id"               text primary key,
  "companyId"        text not null default 'fenice' references public.companies(id) on update cascade,
  "dataFirma"        date,
  "pacchetto"        text,
  "importoTotaleCents" integer not null default 0,
  "statoPagamento"   text,
  "venditoreCode"    text,
  "salesUserId"      text references public.users(id) on delete set null,
  "note"             text,
  "clienteNome"      text,
  "clienteCognome"   text,
  "clienteTelefono"  text,
  "clienteEmail"     text,
  "deletedAt"        timestamptz,
  "syncedAt"         timestamptz not null default now()
);
create index if not exists "gestionale_contratti_sales_idx" on public."gestionaleContratti" ("salesUserId");

create table if not exists public."gestionaleRate" (
  "id"           text primary key,
  "contrattoId"  text not null,
  "numero"       integer,
  "tipo"         text,
  "scadenza"     date,
  "importoCents" integer not null default 0,
  "stato"        text,
  "incassoId"    text,
  "deletedAt"    timestamptz,
  "syncedAt"     timestamptz not null default now()
);
create index if not exists "gestionale_rate_contratto_idx" on public."gestionaleRate" ("contrattoId");

create table if not exists public."gestionaleIncassi" (
  "id"               text primary key,
  "contrattoId"      text not null,
  "data"             date,
  "importoCents"     integer not null default 0,
  "metodo"           text,
  "voce"             text,
  "stato"            text,
  "stornoDi"         text,
  "rataId"           text,
  "venditoreCode"    text,
  "salesUserId"      text references public.users(id) on delete set null,
  "contaCommissione" boolean not null default false,
  "meseCommissione"  text,
  "deletedAt"        timestamptz,
  "syncedAt"         timestamptz not null default now()
);
create index if not exists "gestionale_incassi_sales_mese_idx" on public."gestionaleIncassi" ("salesUserId", "meseCommissione");
create index if not exists "gestionale_incassi_data_idx" on public."gestionaleIncassi" ("data");
create index if not exists "gestionale_incassi_contratto_idx" on public."gestionaleIncassi" ("contrattoId");

-- Una riga per codice venditore e mese, anche a zero: si sostituisce in blocco a ogni sync.
create table if not exists public."gestionaleCommissioni" (
  "venditoreCode"              text not null,
  "mese"                       text not null,
  "salesUserId"                text references public.users(id) on delete set null,
  "totaleIncassatoCents"       integer not null default 0,
  "commissioneLordaCents"      integer not null default 0,
  "commissioneImponibileCents" integer not null default 0,
  "syncedAt"                   timestamptz not null default now(),
  primary key ("venditoreCode", "mese")
);

create table if not exists public."gestionaleSyncRuns" (
  "id"          text primary key,
  "trigger"     text not null,
  "status"      text not null,
  "startedAt"   timestamptz not null default now(),
  "finishedAt"  timestamptz,
  "generatoIl"  text,
  "inserted"    integer not null default 0,
  "updated"     integer not null default 0,
  "deleted"     integer not null default 0,
  "restored"    integer not null default 0,
  "warnings"    jsonb not null default '[]'::jsonb,
  "error"       text
);
create index if not exists "gestionale_sync_runs_started_idx" on public."gestionaleSyncRuns" ("startedAt" desc);

-- Le tabelle non passano da PostgREST: le legge solo il server con Drizzle.
alter table public."gestionaleContratti"   enable row level security;
alter table public."gestionaleRate"        enable row level security;
alter table public."gestionaleIncassi"     enable row level security;
alter table public."gestionaleCommissioni" enable row level security;
alter table public."gestionaleSyncRuns"    enable row level security;
```

- [ ] **Step 2: Aggiungi le tabelle a `src/db/schema.ts`** (in fondo; `date`, `primaryKey`, `jsonb`, `boolean` sono già importati alla riga 1)

```ts
// Incassi dal gestionale (spec 2026-10-02): copia in sola lettura dello snapshot
// GET /api/v1/contratti. Importi in CENTESIMI. Vedi migration 0039.
export const gestionaleContratti = pgTable('gestionaleContratti', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    dataFirma: date('dataFirma'),
    pacchetto: text('pacchetto'),
    importoTotaleCents: integer('importoTotaleCents').default(0).notNull(),
    statoPagamento: text('statoPagamento'),
    venditoreCode: text('venditoreCode'),
    salesUserId: text('salesUserId').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    clienteNome: text('clienteNome'),
    clienteCognome: text('clienteCognome'),
    clienteTelefono: text('clienteTelefono'),
    clienteEmail: text('clienteEmail'),
    deletedAt: timestamp('deletedAt', { withTimezone: true, mode: 'date' }),
    syncedAt: timestamp('syncedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
    salesIdx: index('gestionale_contratti_sales_idx').on(table.salesUserId),
}));

export const gestionaleRate = pgTable('gestionaleRate', {
    id: text('id').primaryKey(),
    contrattoId: text('contrattoId').notNull(),
    numero: integer('numero'),
    tipo: text('tipo'),
    scadenza: date('scadenza'),
    importoCents: integer('importoCents').default(0).notNull(),
    stato: text('stato'),
    incassoId: text('incassoId'),
    deletedAt: timestamp('deletedAt', { withTimezone: true, mode: 'date' }),
    syncedAt: timestamp('syncedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
    contrattoIdx: index('gestionale_rate_contratto_idx').on(table.contrattoId),
}));

export const gestionaleIncassi = pgTable('gestionaleIncassi', {
    id: text('id').primaryKey(),
    contrattoId: text('contrattoId').notNull(),
    data: date('data'),
    importoCents: integer('importoCents').default(0).notNull(),
    metodo: text('metodo'),
    voce: text('voce'),
    stato: text('stato'),
    stornoDi: text('stornoDi'),
    rataId: text('rataId'),
    venditoreCode: text('venditoreCode'),
    salesUserId: text('salesUserId').references(() => users.id, { onDelete: 'set null' }),
    contaCommissione: boolean('contaCommissione').default(false).notNull(),
    meseCommissione: text('meseCommissione'),
    deletedAt: timestamp('deletedAt', { withTimezone: true, mode: 'date' }),
    syncedAt: timestamp('syncedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
    salesMeseIdx: index('gestionale_incassi_sales_mese_idx').on(table.salesUserId, table.meseCommissione),
    dataIdx: index('gestionale_incassi_data_idx').on(table.data),
    contrattoIdx: index('gestionale_incassi_contratto_idx').on(table.contrattoId),
}));

export const gestionaleCommissioni = pgTable('gestionaleCommissioni', {
    venditoreCode: text('venditoreCode').notNull(),
    mese: text('mese').notNull(),
    salesUserId: text('salesUserId').references(() => users.id, { onDelete: 'set null' }),
    totaleIncassatoCents: integer('totaleIncassatoCents').default(0).notNull(),
    commissioneLordaCents: integer('commissioneLordaCents').default(0).notNull(),
    commissioneImponibileCents: integer('commissioneImponibileCents').default(0).notNull(),
    syncedAt: timestamp('syncedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.venditoreCode, table.mese] }),
}));

export const gestionaleSyncRuns = pgTable('gestionaleSyncRuns', {
    id: text('id').primaryKey(),
    trigger: text('trigger').notNull(),          // 'cron' | 'manuale'
    status: text('status').notNull(),            // 'running' | 'ok' | 'error' | 'skipped'
    startedAt: timestamp('startedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    finishedAt: timestamp('finishedAt', { withTimezone: true, mode: 'date' }),
    generatoIl: text('generatoIl'),
    inserted: integer('inserted').default(0).notNull(),
    updated: integer('updated').default(0).notNull(),
    deleted: integer('deleted').default(0).notNull(),
    restored: integer('restored').default(0).notNull(),
    warnings: jsonb('warnings').$type<string[]>().default([]).notNull(),
    error: text('error'),
}, (table) => ({
    startedIdx: index('gestionale_sync_runs_started_idx').on(table.startedAt),
}));
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: nessun errore nuovo (confronta con `git stash`-free baseline: gli errori preesistenti, se ci sono, restano identici).

- [ ] **Step 4: Commit** (la migration si applica al DB di produzione nel Task 9, non qui)

```bash
git add drizzle/migrations/0039_gestionale_incassi.sql src/db/schema.ts
git commit -m "feat(gestionale): tabelle per la copia di contratti, rate, incassi e commissioni"
```

---

### Task 2: Tipi + parser dello snapshot

**Files:**
- Create: `src/lib/gestionale/types.ts`
- Create: `src/lib/gestionale/parse.ts`
- Create: `src/lib/gestionale/__fixtures__/snapshot.sample.json`
- Test: `src/lib/gestionale/parse.test.ts`
- Modify: `package.json` (script `test`: append ` src/lib/gestionale/parse.test.ts`)

**Interfaces:**
- Produces (`types.ts`):
```ts
export type ContrattoRow = { id: string; dataFirma: string | null; pacchetto: string | null; importoTotaleCents: number; statoPagamento: string | null; venditoreCode: string | null; note: string | null; clienteNome: string | null; clienteCognome: string | null; clienteTelefono: string | null; clienteEmail: string | null }
export type RataRow = { id: string; contrattoId: string; numero: number | null; tipo: string | null; scadenza: string | null; importoCents: number; stato: string | null; incassoId: string | null }
export type IncassoRow = { id: string; contrattoId: string; data: string | null; importoCents: number; metodo: string | null; voce: string | null; stato: string | null; stornoDi: string | null; rataId: string | null; venditoreCode: string | null; contaCommissione: boolean; meseCommissione: string | null }
export type CommissioneRow = { venditoreCode: string; mese: string; totaleIncassatoCents: number; commissioneLordaCents: number; commissioneImponibileCents: number }
export type SnapshotRows = { generatoIl: string | null; contratti: ContrattoRow[]; rate: RataRow[]; incassi: IncassoRow[]; commissioni: CommissioneRow[] }
export const DIREZIONE = 'DIREZIONE'
```
- Produces (`parse.ts`): `eurToCents(value: unknown, path: string): number`, `class SnapshotParseError extends Error { path: string }`, `parseSnapshot(json: unknown): SnapshotRows`.

- [ ] **Step 1: Crea `types.ts`** con esattamente il blocco qui sopra.

- [ ] **Step 2: Crea la fixture** `src/lib/gestionale/__fixtures__/snapshot.sample.json`

```json
{
  "generato_il": "2026-10-02T18:00:00+02:00",
  "contratti": [
    {
      "id": "c1", "data_firma": "2026-09-03", "pacchetto": "Advance", "importo_totale": "3180.00",
      "stato_pagamento": "Pagamento programmato", "venditore": "Sales 002", "note": null,
      "cliente": { "nome": "Mario", "cognome": "Rossi", "telefono": "3331234567", "email": "mario@example.com" },
      "rate": [
        { "id": "r1", "numero": 1, "tipo": "rata", "scadenza": "2026-09-05", "importo": "1590.00", "stato": "pagata", "incasso_id": "i1" },
        { "id": "r2", "numero": 2, "tipo": "saldo", "scadenza": "2026-10-05", "importo": "1590.00", "stato": "da_pagare", "incasso_id": null }
      ],
      "incassi": [
        { "id": "i1", "data": "2026-09-05", "importo": "1590.00", "metodo": "bonifico", "voce": "RATA", "stato": "incassato",
          "storno_di": null, "rata_id": "r1", "venditore": "Sales 002", "conta_commissione": true, "mese_commissione": "2026-09" }
      ]
    },
    {
      "id": "c2", "data_firma": "2026-09-10", "pacchetto": "Gold", "importo_totale": "2000.00",
      "stato_pagamento": "Sollecito", "venditore": "DIREZIONE", "note": "cliente amministrazione",
      "cliente": { "nome": "Anna", "cognome": "Verdi", "telefono": null, "email": null },
      "rate": [
        { "id": "r3", "numero": 1, "tipo": "rata", "scadenza": "2026-09-15", "importo": "1000.00", "stato": "scaduta", "incasso_id": null }
      ],
      "incassi": [
        { "id": "i2", "data": "2026-09-12", "importo": "500.00", "metodo": "carta", "voce": "ACCONTO", "stato": "stornato",
          "storno_di": null, "rata_id": null, "venditore": "DIREZIONE", "conta_commissione": false, "mese_commissione": "2026-09" },
        { "id": "i3", "data": "2026-09-20", "importo": "-500.00", "metodo": "carta", "voce": "STORNO", "stato": "incassato",
          "storno_di": "i2", "rata_id": null, "venditore": "DIREZIONE", "conta_commissione": false, "mese_commissione": "2026-09" }
      ]
    }
  ],
  "commissioni": [
    { "venditore": "Sales 002", "mese": "2026-09", "totale_incassato": "1590.00", "commissione_lorda": "159.00", "commissione_imponibile": "130.33" },
    { "venditore": "Sales 003", "mese": "2026-09", "totale_incassato": "0.00", "commissione_lorda": "0.00", "commissione_imponibile": "0.00" }
  ]
}
```

- [ ] **Step 3: Scrivi i test che falliscono** (`parse.test.ts`)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eurToCents, parseSnapshot, SnapshotParseError } from './parse'

const sample = () => JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'snapshot.sample.json'), 'utf8'))

test('eurToCents: formati validi', () => {
    assert.equal(eurToCents('1250.00', 'x'), 125000)
    assert.equal(eurToCents('-50.00', 'x'), -5000)
    assert.equal(eurToCents('1250.5', 'x'), 125050)
    assert.equal(eurToCents('1250', 'x'), 125000)
    assert.equal(eurToCents('0.07', 'x'), 7)
    assert.equal(eurToCents('130.33', 'x'), 13033)
})

test('eurToCents: formati rifiutati con il path', () => {
    for (const bad of ['1.250,00', '', null, undefined, 12.5, '12.345', 'abc']) {
        assert.throws(() => eurToCents(bad, 'contratti[0].importo_totale'),
            (e: unknown) => e instanceof SnapshotParseError && e.path === 'contratti[0].importo_totale')
    }
})

test('parseSnapshot: fixture appiattita in righe', () => {
    const s = parseSnapshot(sample())
    assert.equal(s.generatoIl, '2026-10-02T18:00:00+02:00')
    assert.equal(s.contratti.length, 2)
    assert.equal(s.rate.length, 3)
    assert.equal(s.incassi.length, 3)
    assert.equal(s.commissioni.length, 2)
    const c1 = s.contratti.find(c => c.id === 'c1')!
    assert.equal(c1.importoTotaleCents, 318000)
    assert.equal(c1.clienteTelefono, '+393331234567')
    assert.equal(c1.venditoreCode, 'Sales 002')
    assert.equal(s.rate.find(r => r.id === 'r2')!.contrattoId, 'c1')
    const storno = s.incassi.find(i => i.id === 'i3')!
    assert.equal(storno.importoCents, -50000)
    assert.equal(storno.stornoDi, 'i2')
    assert.equal(storno.contrattoId, 'c2')
    assert.deepEqual(s.commissioni[0], { venditoreCode: 'Sales 002', mese: '2026-09', totaleIncassatoCents: 159000, commissioneLordaCents: 15900, commissioneImponibileCents: 13033 })
})

test('parseSnapshot: telefono assente, N/A o vuoto diventa null', () => {
    for (const tel of [null, 'N/A', '', '  ']) {
        const j = sample(); j.contratti[0].cliente.telefono = tel
        assert.equal(parseSnapshot(j).contratti[0].clienteTelefono, null)
    }
    const j = sample(); j.contratti[0].cliente.telefono = '393331234567'
    assert.equal(parseSnapshot(j).contratti[0].clienteTelefono, '+393331234567')
})

test('parseSnapshot: record malformato fa fallire tutto e nomina id e campo', () => {
    const j = sample(); delete j.contratti[1].incassi[0].id
    assert.throws(() => parseSnapshot(j), (e: unknown) => e instanceof SnapshotParseError && e.path === 'contratti[1].incassi[0].id')
    const k = sample(); k.commissioni[0].mese = 'settembre'
    assert.throws(() => parseSnapshot(k), (e: unknown) => e instanceof SnapshotParseError && e.path === 'commissioni[0].mese')
    assert.throws(() => parseSnapshot({ contratti: 'x' }), SnapshotParseError)
    assert.throws(() => parseSnapshot(null), SnapshotParseError)
})

test('parseSnapshot: id duplicati sono un errore', () => {
    const j = sample(); j.contratti[1].id = 'c1'
    assert.throws(() => parseSnapshot(j), (e: unknown) => e instanceof SnapshotParseError && e.path === 'contratti[1].id')
})

test('parseSnapshot: conta_commissione mancante vale false, venditore viene trimmato', () => {
    const j = sample(); delete j.contratti[0].incassi[0].conta_commissione; j.contratti[0].venditore = ' Sales 002 '
    const s = parseSnapshot(j)
    assert.equal(s.incassi[0].contaCommissione, false)
    assert.equal(s.contratti[0].venditoreCode, 'Sales 002')
})
```

- [ ] **Step 4: Aggiungi il file allo script `test`** in `package.json` e verifica che fallisca

Run: `node --import tsx --test src/lib/gestionale/parse.test.ts`
Expected: FAIL (`Cannot find module './parse'`).

- [ ] **Step 5: Implementa `parse.ts`**

```ts
import { normalizePhoneStrict } from '@/lib/phoneNormalize'
import type { CommissioneRow, ContrattoRow, IncassoRow, RataRow, SnapshotRows } from './types'

/** Errore di formato: `path` dice quale record e quale campo, es. `contratti[1].incassi[0].id`. */
export class SnapshotParseError extends Error {
    constructor(public path: string, message: string) {
        super(`${path}: ${message}`)
        this.name = 'SnapshotParseError'
    }
}

const EUR_RE = /^-?\d+(\.\d{1,2})?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

/** "1250.00" → 125000. Niente float: si lavora sulle cifre della stringa. */
export function eurToCents(value: unknown, path: string): number {
    if (typeof value !== 'string' || !EUR_RE.test(value.trim())) {
        throw new SnapshotParseError(path, `importo non valido (${JSON.stringify(value)})`)
    }
    const v = value.trim()
    const neg = v.startsWith('-')
    const [int, dec = ''] = (neg ? v.slice(1) : v).split('.')
    const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'))
    return neg ? -cents : cents
}

function obj(v: unknown, path: string): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SnapshotParseError(path, 'oggetto atteso')
    return v as Record<string, unknown>
}
function arr(v: unknown, path: string): unknown[] {
    if (!Array.isArray(v)) throw new SnapshotParseError(path, 'array atteso')
    return v
}
function reqId(v: unknown, path: string): string {
    if (typeof v !== 'string' || !v.trim()) throw new SnapshotParseError(path, 'id mancante')
    return v.trim()
}
function optStr(v: unknown, path: string): string | null {
    if (v === null || v === undefined) return null
    if (typeof v !== 'string') throw new SnapshotParseError(path, 'stringa attesa')
    const t = v.trim()
    return t ? t : null
}
function optDate(v: unknown, path: string): string | null {
    const s = optStr(v, path)
    if (s !== null && !DATE_RE.test(s)) throw new SnapshotParseError(path, `data non valida (${s})`)
    return s
}
function optMonth(v: unknown, path: string): string | null {
    const s = optStr(v, path)
    if (s !== null && !MONTH_RE.test(s)) throw new SnapshotParseError(path, `mese non valido (${s})`)
    return s
}
function optInt(v: unknown, path: string): number | null {
    if (v === null || v === undefined) return null
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new SnapshotParseError(path, 'intero atteso')
    return v
}
function phone(v: unknown, path: string): string | null {
    const s = optStr(v, path)
    if (s === null || s.toUpperCase() === 'N/A') return null
    return normalizePhoneStrict(s)
}

/**
 * Valida e appiattisce lo snapshot. Un solo record malformato fa fallire
 * TUTTO: una copia parziale è peggio della copia di un'ora fa.
 */
export function parseSnapshot(json: unknown): SnapshotRows {
    const root = obj(json, '$')
    const contratti: ContrattoRow[] = []
    const rate: RataRow[] = []
    const incassi: IncassoRow[] = []
    const seen = { c: new Set<string>(), r: new Set<string>(), i: new Set<string>() }
    const unique = (set: Set<string>, id: string, path: string) => {
        if (set.has(id)) throw new SnapshotParseError(path, `id duplicato (${id})`)
        set.add(id)
    }

    arr(root.contratti, 'contratti').forEach((raw, ci) => {
        const p = `contratti[${ci}]`
        const c = obj(raw, p)
        const id = reqId(c.id, `${p}.id`)
        unique(seen.c, id, `${p}.id`)
        const cliente = c.cliente === null || c.cliente === undefined ? {} : obj(c.cliente, `${p}.cliente`)
        contratti.push({
            id,
            dataFirma: optDate(c.data_firma, `${p}.data_firma`),
            pacchetto: optStr(c.pacchetto, `${p}.pacchetto`),
            importoTotaleCents: eurToCents(c.importo_totale, `${p}.importo_totale`),
            statoPagamento: optStr(c.stato_pagamento, `${p}.stato_pagamento`),
            venditoreCode: optStr(c.venditore, `${p}.venditore`),
            note: optStr(c.note, `${p}.note`),
            clienteNome: optStr(cliente.nome, `${p}.cliente.nome`),
            clienteCognome: optStr(cliente.cognome, `${p}.cliente.cognome`),
            clienteTelefono: phone(cliente.telefono, `${p}.cliente.telefono`),
            clienteEmail: optStr(cliente.email, `${p}.cliente.email`),
        })
        arr(c.rate ?? [], `${p}.rate`).forEach((rr, ri) => {
            const rp = `${p}.rate[${ri}]`
            const r = obj(rr, rp)
            const rid = reqId(r.id, `${rp}.id`)
            unique(seen.r, rid, `${rp}.id`)
            rate.push({
                id: rid, contrattoId: id,
                numero: optInt(r.numero, `${rp}.numero`),
                tipo: optStr(r.tipo, `${rp}.tipo`),
                scadenza: optDate(r.scadenza, `${rp}.scadenza`),
                importoCents: eurToCents(r.importo, `${rp}.importo`),
                stato: optStr(r.stato, `${rp}.stato`),
                incassoId: optStr(r.incasso_id, `${rp}.incasso_id`),
            })
        })
        arr(c.incassi ?? [], `${p}.incassi`).forEach((ir, ii) => {
            const ip = `${p}.incassi[${ii}]`
            const i = obj(ir, ip)
            const iid = reqId(i.id, `${ip}.id`)
            unique(seen.i, iid, `${ip}.id`)
            incassi.push({
                id: iid, contrattoId: id,
                data: optDate(i.data, `${ip}.data`),
                importoCents: eurToCents(i.importo, `${ip}.importo`),
                metodo: optStr(i.metodo, `${ip}.metodo`),
                voce: optStr(i.voce, `${ip}.voce`),
                stato: optStr(i.stato, `${ip}.stato`),
                stornoDi: optStr(i.storno_di, `${ip}.storno_di`),
                rataId: optStr(i.rata_id, `${ip}.rata_id`),
                venditoreCode: optStr(i.venditore, `${ip}.venditore`),
                contaCommissione: i.conta_commissione === true,
                meseCommissione: optMonth(i.mese_commissione, `${ip}.mese_commissione`),
            })
        })
    })

    const commissioni: CommissioneRow[] = arr(root.commissioni ?? [], 'commissioni').map((raw, k) => {
        const p = `commissioni[${k}]`
        const c = obj(raw, p)
        const venditoreCode = optStr(c.venditore, `${p}.venditore`)
        if (!venditoreCode) throw new SnapshotParseError(`${p}.venditore`, 'venditore mancante')
        const mese = optMonth(c.mese, `${p}.mese`)
        if (!mese) throw new SnapshotParseError(`${p}.mese`, 'mese mancante')
        return {
            venditoreCode, mese,
            totaleIncassatoCents: eurToCents(c.totale_incassato, `${p}.totale_incassato`),
            commissioneLordaCents: eurToCents(c.commissione_lorda, `${p}.commissione_lorda`),
            commissioneImponibileCents: eurToCents(c.commissione_imponibile, `${p}.commissione_imponibile`),
        }
    })

    return { generatoIl: optStr(root.generato_il, 'generato_il'), contratti, rate, incassi, commissioni }
}
```

Nota: `optMonth` su `'settembre'` lancia con path `commissioni[0].mese` (il test lo richiede).

- [ ] **Step 6: Esegui i test**

Run: `node --import tsx --test src/lib/gestionale/parse.test.ts`
Expected: PASS (7 test). Se `__dirname` non è definito sotto tsx ESM, usa `join(process.cwd(), 'src/lib/gestionale/__fixtures__/snapshot.sample.json')`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/gestionale/types.ts src/lib/gestionale/parse.ts src/lib/gestionale/parse.test.ts src/lib/gestionale/__fixtures__/snapshot.sample.json package.json
git commit -m "feat(gestionale): parser dello snapshot con importi in centesimi"
```

---

### Task 3: Piano di sincronizzazione e guardie

**Files:**
- Create: `src/lib/gestionale/plan.ts`
- Test: `src/lib/gestionale/plan.test.ts`
- Modify: `package.json` (append ` src/lib/gestionale/plan.test.ts`)

**Interfaces:**
- Produces:
```ts
export type ExistingId = { id: string; deleted: boolean }
export type IdDiff = { insertIds: string[]; updateIds: string[]; restoreIds: string[]; deleteIds: string[] }
export function diffIds(existing: ExistingId[], incomingIds: string[]): IdDiff
export class SyncGuardError extends Error {}
export const MAX_DELETE_RATIO = 0.3
export const MIN_ROWS_FOR_RATIO = 10
export function assertSafeToApply(table: string, liveCount: number, incomingCount: number, deleteCount: number): void
export type SellerMap = Map<string, string>   // 'Sales 002' -> users.id
export function resolveSeller(code: string | null, sellers: SellerMap, warnings: Set<string>): string | null
```
Semantica: `updateIds` = presenti vivi e in arrivo; `restoreIds` = presenti con `deleted` e in arrivo (anche loro vengono riscritti); `deleteIds` = presenti vivi e assenti; gli già eliminati e ancora assenti non compaiono da nessuna parte.

- [ ] **Step 1: Test che falliscono** (`plan.test.ts`)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffIds, assertSafeToApply, SyncGuardError, resolveSeller } from './plan'

test('diffIds: nuovi, aggiornati, ripristinati, eliminati', () => {
    const d = diffIds(
        [{ id: 'a', deleted: false }, { id: 'b', deleted: false }, { id: 'c', deleted: true }, { id: 'z', deleted: true }],
        ['a', 'c', 'n'],
    )
    assert.deepEqual(d.insertIds, ['n'])
    assert.deepEqual(d.updateIds, ['a'])
    assert.deepEqual(d.restoreIds, ['c'])
    assert.deepEqual(d.deleteIds, ['b'])
})

test('guardia: snapshot vuoto con righe vive blocca', () => {
    assert.throws(() => assertSafeToApply('contratti', 5, 0, 5), SyncGuardError)
})

test('guardia: primo sync vuoto è ammesso', () => {
    assert.doesNotThrow(() => assertSafeToApply('contratti', 0, 0, 0))
})

test('guardia: oltre il 30% di eliminazioni blocca solo sopra 10 righe vive', () => {
    assert.throws(() => assertSafeToApply('incassi', 100, 69, 31), SyncGuardError)
    assert.doesNotThrow(() => assertSafeToApply('incassi', 100, 70, 30))
    assert.doesNotThrow(() => assertSafeToApply('incassi', 9, 4, 5))
})

test('resolveSeller: codice noto, DIREZIONE, sconosciuto, null', () => {
    const sellers = new Map([['Sales 002', 'u2']])
    const w = new Set<string>()
    assert.equal(resolveSeller('Sales 002', sellers, w), 'u2')
    assert.equal(resolveSeller('DIREZIONE', sellers, w), null)
    assert.equal(resolveSeller(null, sellers, w), null)
    assert.equal(resolveSeller('Sales 099', sellers, w), null)
    assert.deepEqual([...w], ['Codice venditore sconosciuto: Sales 099'])
})
```

- [ ] **Step 2: Verifica il fallimento**

Run: `node --import tsx --test src/lib/gestionale/plan.test.ts`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa `plan.ts`**

```ts
import { DIREZIONE } from './types'

export type ExistingId = { id: string; deleted: boolean }
export type IdDiff = { insertIds: string[]; updateIds: string[]; restoreIds: string[]; deleteIds: string[] }

export function diffIds(existing: ExistingId[], incomingIds: string[]): IdDiff {
    const byId = new Map(existing.map(e => [e.id, e]))
    const incoming = new Set(incomingIds)
    const out: IdDiff = { insertIds: [], updateIds: [], restoreIds: [], deleteIds: [] }
    for (const id of incomingIds) {
        const e = byId.get(id)
        if (!e) out.insertIds.push(id)
        else if (e.deleted) out.restoreIds.push(id)
        else out.updateIds.push(id)
    }
    for (const e of existing) if (!e.deleted && !incoming.has(e.id)) out.deleteIds.push(e.id)
    return out
}

export class SyncGuardError extends Error {
    constructor(message: string) { super(message); this.name = 'SyncGuardError' }
}

export const MAX_DELETE_RATIO = 0.3
export const MIN_ROWS_FOR_RATIO = 10

/**
 * Una risposta sbagliata del gestionale (vuota, troncata) non deve poter
 * svuotare la copia: meglio un dato vecchio di un'ora che nessun dato.
 */
export function assertSafeToApply(table: string, liveCount: number, incomingCount: number, deleteCount: number): void {
    if (liveCount > 0 && incomingCount === 0) {
        throw new SyncGuardError(`${table}: snapshot vuoto ma ${liveCount} righe presenti, sync annullato`)
    }
    if (liveCount >= MIN_ROWS_FOR_RATIO && deleteCount / liveCount > MAX_DELETE_RATIO) {
        throw new SyncGuardError(`${table}: ${deleteCount} eliminazioni su ${liveCount} righe (oltre il 30%), sync annullato`)
    }
}

export type SellerMap = Map<string, string>

export function resolveSeller(code: string | null, sellers: SellerMap, warnings: Set<string>): string | null {
    if (!code || code === DIREZIONE) return null
    const id = sellers.get(code)
    if (!id) warnings.add(`Codice venditore sconosciuto: ${code}`)
    return id ?? null
}
```

- [ ] **Step 4: Test verdi**

Run: `node --import tsx --test src/lib/gestionale/plan.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gestionale/plan.ts src/lib/gestionale/plan.test.ts package.json
git commit -m "feat(gestionale): diff degli id e guardie contro gli snapshot vuoti o troncati"
```

---

### Task 4: Client HTTP + runner del sync

**Files:**
- Create: `src/lib/gestionale/client.ts`
- Create: `src/lib/gestionale/run.ts`

**Interfaces:**
- Consumes: `parseSnapshot`, `SnapshotParseError` (Task 2); `diffIds`, `assertSafeToApply`, `SyncGuardError`, `resolveSeller` (Task 3); tabelle Task 1.
- Produces:
```ts
// client.ts
export const SYNC_FROM = '2026-09-01'
export class GestionaleNotConfiguredError extends Error {}
export class GestionaleHttpError extends Error { status: number }
export function gestionaleConfigured(): boolean
export async function fetchSnapshot(): Promise<unknown>
// run.ts
export type SyncTrigger = 'cron' | 'manuale'
export type SyncResult = { runId: string | null; status: 'ok' | 'error' | 'skipped'; reason?: string; inserted: number; updated: number; deleted: number; restored: number; warnings: string[]; error?: string }
export async function runGestionaleSync(trigger: SyncTrigger): Promise<SyncResult>
```

- [ ] **Step 1: `client.ts`**

```ts
export const SYNC_FROM = '2026-09-01'
const TIMEOUT_MS = 30_000
const ATTEMPTS = 2

export class GestionaleNotConfiguredError extends Error {
    constructor() { super('GESTIONALE_API_URL o GESTIONALE_API_KEY non impostate'); this.name = 'GestionaleNotConfiguredError' }
}
export class GestionaleHttpError extends Error {
    constructor(public status: number, message: string) { super(message); this.name = 'GestionaleHttpError' }
}

export function gestionaleConfigured(): boolean {
    return Boolean(process.env.GESTIONALE_API_URL && process.env.GESTIONALE_API_KEY)
}

/** Snapshot completo. Ritenta una volta su rete/5xx; 4xx (chiave sbagliata) non si ritenta. */
export async function fetchSnapshot(): Promise<unknown> {
    if (!gestionaleConfigured()) throw new GestionaleNotConfiguredError()
    const base = process.env.GESTIONALE_API_URL!.replace(/\/+$/, '')
    const url = `${base}/api/v1/contratti?dal=${SYNC_FROM}&incassi_dal=${SYNC_FROM}`
    let lastErr: unknown
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${process.env.GESTIONALE_API_KEY}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
                cache: 'no-store',
            })
            if (res.ok) return await res.json()
            const body = (await res.text()).slice(0, 300)
            const err = new GestionaleHttpError(res.status, `HTTP ${res.status} dal gestionale: ${body}`)
            if (res.status < 500) throw err
            lastErr = err
        } catch (e) {
            if (e instanceof GestionaleHttpError && e.status < 500) throw e
            lastErr = e
        }
        if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, 2000))
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
```

- [ ] **Step 2: `run.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { users, gestionaleContratti, gestionaleRate, gestionaleIncassi, gestionaleCommissioni, gestionaleSyncRuns } from '@/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { fetchSnapshot, gestionaleConfigured } from './client'
import { parseSnapshot } from './parse'
import { diffIds, assertSafeToApply, resolveSeller, type ExistingId, type SellerMap } from './plan'

export type SyncTrigger = 'cron' | 'manuale'
export type SyncResult = { runId: string | null; status: 'ok' | 'error' | 'skipped'; reason?: string; inserted: number; updated: number; deleted: number; restored: number; warnings: string[]; error?: string }

const CHUNK = 500
const LOCK_KEY = 'gestionale-sync'

function chunks<T>(xs: T[]): T[][] {
    const out: T[][] = []
    for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
    return out
}

/** Colonne da riscrivere in ON CONFLICT: tutte tranne la PK, più deletedAt=null (ripristino). */
function excludedSet(cols: string[]) {
    return Object.fromEntries(cols.map(c => [c, sql.raw(`excluded."${c}"`)]))
}

export async function runGestionaleSync(trigger: SyncTrigger): Promise<SyncResult> {
    const empty = { inserted: 0, updated: 0, deleted: 0, restored: 0, warnings: [] as string[] }
    if (process.env.GESTIONALE_SYNC === 'off') return { runId: null, status: 'skipped', reason: 'kill_switch_off', ...empty }
    if (!gestionaleConfigured()) return { runId: null, status: 'skipped', reason: 'not_configured', ...empty }

    const runId = randomUUID()
    await db.insert(gestionaleSyncRuns).values({ id: runId, trigger, status: 'running' })

    const finish = async (r: Omit<SyncResult, 'runId'>, generatoIl: string | null = null): Promise<SyncResult> => {
        await db.update(gestionaleSyncRuns).set({
            status: r.status, finishedAt: new Date(), generatoIl,
            inserted: r.inserted, updated: r.updated, deleted: r.deleted, restored: r.restored,
            warnings: r.warnings, error: r.error ?? r.reason ?? null,
        }).where(eq(gestionaleSyncRuns.id, runId))
        return { runId, ...r }
    }

    let snapshot
    try {
        snapshot = parseSnapshot(await fetchSnapshot())
    } catch (e) {
        return finish({ status: 'error', ...empty, error: e instanceof Error ? e.message : String(e) })
    }

    const sellerRows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, 'VENDITORE'))
    const sellers: SellerMap = new Map(sellerRows.filter(u => u.name).map(u => [u.name!.trim(), u.id]))
    const warnings = new Set<string>()
    const now = new Date()

    const contratti = snapshot.contratti.map(c => ({ ...c, salesUserId: resolveSeller(c.venditoreCode, sellers, warnings), deletedAt: null, syncedAt: now }))
    const rate = snapshot.rate.map(r => ({ ...r, deletedAt: null, syncedAt: now }))
    const incassi = snapshot.incassi.map(i => ({ ...i, salesUserId: resolveSeller(i.venditoreCode, sellers, warnings), deletedAt: null, syncedAt: now }))
    const commissioni = snapshot.commissioni.map(c => ({ ...c, salesUserId: resolveSeller(c.venditoreCode, sellers, warnings), syncedAt: now }))

    try {
        const counts = await db.transaction(async (tx) => {
            // Cron e pulsante insieme: il secondo esce senza toccare nulla.
            const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) as ok`)
            const ok = (lock as unknown as { rows: { ok: boolean }[] }).rows[0]?.ok
            if (!ok) return null

            const tables = [
                { name: 'contratti', table: gestionaleContratti, rows: contratti },
                { name: 'rate', table: gestionaleRate, rows: rate },
                { name: 'incassi', table: gestionaleIncassi, rows: incassi },
            ] as const
            const total = { inserted: 0, updated: 0, deleted: 0, restored: 0 }

            for (const t of tables) {
                const existing: ExistingId[] = (await tx.select({ id: t.table.id, deletedAt: t.table.deletedAt }).from(t.table))
                    .map(e => ({ id: e.id, deleted: e.deletedAt !== null }))
                const diff = diffIds(existing, t.rows.map(r => r.id))
                const live = existing.filter(e => !e.deleted).length
                assertSafeToApply(t.name, live, t.rows.length, diff.deleteIds.length)

                const cols = Object.keys(t.rows[0] ?? {}).filter(c => c !== 'id')
                for (const part of chunks(t.rows as Record<string, unknown>[])) {
                    await tx.insert(t.table).values(part as never)
                        .onConflictDoUpdate({ target: t.table.id, set: excludedSet(cols) as never })
                }
                for (const part of chunks(diff.deleteIds)) {
                    await tx.update(t.table).set({ deletedAt: now } as never)
                        .where(and(inArray(t.table.id, part), isNull(t.table.deletedAt)))
                }
                total.inserted += diff.insertIds.length
                total.updated += diff.updateIds.length
                total.restored += diff.restoreIds.length
                total.deleted += diff.deleteIds.length
            }

            // Commissioni: blocco sostituito per intero (una riga per codice e mese, anche a zero).
            await tx.delete(gestionaleCommissioni)
            for (const part of chunks(commissioni)) await tx.insert(gestionaleCommissioni).values(part)
            return total
        })
        if (counts === null) return finish({ status: 'skipped', reason: 'sync gia in corso', ...empty })
        return finish({ status: 'ok', ...counts, warnings: [...warnings] }, snapshot.generatoIl)
    } catch (e) {
        return finish({ status: 'error', ...empty, warnings: [...warnings], error: e instanceof Error ? e.message : String(e) })
    }
}
```

Nota per l'implementatore: il risultato di `tx.execute` con `drizzle-orm/node-postgres` è un `QueryResult` con `.rows`; il cast sopra lo legge. Se `excludedSet` produce problemi di tipo, mantieni i cast `as never` — la forma è verificata a runtime nel Task 9.

- [ ] **Step 3: Type-check e test esistenti**

Run: `npx tsc --noEmit -p . && npm test`
Expected: nessun errore nuovo; tutti i test verdi.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gestionale/client.ts src/lib/gestionale/run.ts
git commit -m "feat(gestionale): runner del sync con transazione, lock e registro dei giri"
```

---

### Task 5: Cron orario + pulsante "Aggiorna adesso"

**Files:**
- Create: `src/app/api/cron/gestionale-sync/route.ts`
- Modify: `vercel.json` (array `crons`)
- Create: `src/app/actions/gestionaleSyncActions.ts`

**Interfaces:**
- Consumes: `runGestionaleSync`, `SyncResult` (Task 4).
- Produces: `aggiornaIncassiAdesso(): Promise<SyncResult>` (server action, solo ADMIN).

- [ ] **Step 1: Route cron**

```ts
import { NextResponse } from 'next/server'
import { runGestionaleSync } from '@/lib/gestionale/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Copia oraria dello snapshot del gestionale (spec 2026-10-02).
 * Kill-switch: GESTIONALE_SYNC=off. Senza GESTIONALE_API_URL/KEY esce "skipped".
 */
export async function GET(req: Request) {
    // Prima il Bearer, poi la diagnosi sulla env (stesso ordine di sales-late-penalties).
    const secret = process.env.CRON_SECRET
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return new NextResponse('Unauthorized', { status: 401 })
    }
    if (!secret) {
        return NextResponse.json({ error: 'CRON_SECRET non impostata' }, { status: 500 })
    }
    const result = await runGestionaleSync('cron')
    return NextResponse.json(result, { status: result.status === 'error' ? 500 : 200 })
}
```

- [ ] **Step 2: `vercel.json`** — aggiungi in coda all'array `crons`:

```json
    {
      "path": "/api/cron/gestionale-sync",
      "schedule": "15 * * * *"
    }
```

- [ ] **Step 3: Server action**

```ts
"use server"

import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"
import { runGestionaleSync, type SyncResult } from "@/lib/gestionale/run"

/** Pulsante "Aggiorna adesso" di /incassi. Unico export: il gate admin è dentro. */
export async function aggiornaIncassiAdesso(): Promise<SyncResult> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") throw new Error("Unauthorized")
    const result = await runGestionaleSync("manuale")
    revalidatePath("/incassi")
    revalidatePath("/miei-incassi")
    return result
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: nessun errore nuovo.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/gestionale-sync/route.ts vercel.json src/app/actions/gestionaleSyncActions.ts
git commit -m "feat(gestionale): cron orario e pulsante admin per il sync"
```

---

### Task 6: Calcoli puri (metrics)

**Files:**
- Create: `src/lib/gestionale/metrics.ts`
- Test: `src/lib/gestionale/metrics.test.ts`
- Modify: `package.json` (append ` src/lib/gestionale/metrics.test.ts`)

**Interfaces:**
- Produces:
```ts
export const FIRST_MONTH = '2026-09'
export function monthsFrom(first: string, current: string): string[]          // decrescente, current per primo
export function pickMonth(raw: string | undefined, current: string): string    // valido e in range, altrimenti current
export type SellerMonth = { incassatoCents: number; lordaCents: number; imponibileCents: number; multeCents: number; nettoCents: number; hasCommissionRow: boolean }
export function sellerMonthSummary(comm: { totaleIncassatoCents: number; commissioneLordaCents: number; commissioneImponibileCents: number } | undefined, multeEur: number): SellerMonth
export function cashTotalCents(incassi: { data: string | null; importoCents: number }[], mese: string): number
export function commissionableSumCents(incassi: { contaCommissione: boolean; importoCents: number }[]): number
export const AT_RISK_STATES = ['Avvocato', 'Recupero', 'Sollecito', 'Stand-by'] as const
export type AtRiskContract = { id: string; clienteNome: string | null; clienteCognome: string | null; clienteTelefono: string | null; venditoreCode: string | null; salesUserId: string | null; statoPagamento: string | null; dataFirma: string | null }
export type AtRiskRata = { contrattoId: string; scadenza: string | null; importoCents: number; stato: string | null }
export type AtRiskRow = AtRiskContract & { rateScadute: number; scadutoCents: number; residuoCents: number; giorniDallaPiuVecchia: number | null }
export function classifyAtRisk(contratti: AtRiskContract[], rate: AtRiskRata[], today: string): AtRiskRow[]
```

- [ ] **Step 1: Test che falliscono** (`metrics.test.ts`)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthsFrom, pickMonth, sellerMonthSummary, cashTotalCents, commissionableSumCents, classifyAtRisk, type AtRiskContract } from './metrics'

test('monthsFrom: dal corrente al primo, scavalla l anno', () => {
    assert.deepEqual(monthsFrom('2026-09', '2027-01'), ['2027-01', '2026-12', '2026-11', '2026-10', '2026-09'])
    assert.deepEqual(monthsFrom('2026-09', '2026-09'), ['2026-09'])
})

test('pickMonth: valido, fuori range, spazzatura', () => {
    assert.equal(pickMonth('2026-09', '2026-10'), '2026-09')
    assert.equal(pickMonth('2026-08', '2026-10'), '2026-10')
    assert.equal(pickMonth('2026-11', '2026-10'), '2026-10')
    assert.equal(pickMonth('<script>', '2026-10'), '2026-10')
    assert.equal(pickMonth(undefined, '2026-10'), '2026-10')
})

test('sellerMonthSummary: netto = imponibile meno multe', () => {
    const s = sellerMonthSummary({ totaleIncassatoCents: 1_000_000, commissioneLordaCents: 100_000, commissioneImponibileCents: 81_967 }, 30)
    assert.deepEqual(s, { incassatoCents: 1_000_000, lordaCents: 100_000, imponibileCents: 81_967, multeCents: 3000, nettoCents: 78_967, hasCommissionRow: true })
})

test('sellerMonthSummary: senza riga commissioni è zero esplicito, multe restano', () => {
    const s = sellerMonthSummary(undefined, 10)
    assert.equal(s.hasCommissionRow, false)
    assert.equal(s.imponibileCents, 0)
    assert.equal(s.nettoCents, -1000)
})

test('cashTotalCents: somma tutti gli incassi del mese, storni negativi compresi', () => {
    const rows = [
        { data: '2026-09-05', importoCents: 159000 },
        { data: '2026-09-12', importoCents: 50000 },   // originale poi stornato
        { data: '2026-09-20', importoCents: -50000 },  // storno
        { data: '2026-10-01', importoCents: 99900 },
        { data: null, importoCents: 12345 },
    ]
    assert.equal(cashTotalCents(rows, '2026-09'), 159000)
    assert.equal(cashTotalCents(rows, '2026-10'), 99900)
})

test('commissionableSumCents: solo conta_commissione', () => {
    assert.equal(commissionableSumCents([{ contaCommissione: true, importoCents: 100 }, { contaCommissione: false, importoCents: 50 }]), 100)
})

const c = (id: string, statoPagamento: string | null): AtRiskContract => ({ id, clienteNome: 'N', clienteCognome: 'C', clienteTelefono: null, venditoreCode: 'Sales 002', salesUserId: 'u2', statoPagamento, dataFirma: '2026-09-01' })

test('classifyAtRisk: stati a rischio o rate scadute, ordinati per gravità poi scaduto', () => {
    const rows = classifyAtRisk(
        [c('ok', 'Pagato'), c('sol', 'Sollecito'), c('avv', 'Avvocato'), c('solo-rata', 'Pagamento programmato'), c('sol2', 'Sollecito')],
        [
            { contrattoId: 'solo-rata', scadenza: '2026-09-10', importoCents: 1000, stato: 'scaduta' },
            { contrattoId: 'solo-rata', scadenza: '2026-10-10', importoCents: 1000, stato: 'da_pagare' },
            { contrattoId: 'sol', scadenza: '2026-09-01', importoCents: 500, stato: 'scaduta' },
            { contrattoId: 'sol2', scadenza: '2026-09-02', importoCents: 900, stato: 'scaduta' },
            { contrattoId: 'ok', scadenza: '2026-09-01', importoCents: 700, stato: 'pagata' },
        ],
        '2026-10-02',
    )
    assert.deepEqual(rows.map(r => r.id), ['avv', 'sol2', 'sol', 'solo-rata'])
    const sr = rows.find(r => r.id === 'solo-rata')!
    assert.equal(sr.rateScadute, 1)
    assert.equal(sr.scadutoCents, 1000)
    assert.equal(sr.residuoCents, 2000)
    assert.equal(sr.giorniDallaPiuVecchia, 22)
    assert.equal(rows.find(r => r.id === 'avv')!.giorniDallaPiuVecchia, null)
})
```

- [ ] **Step 2: Verifica il fallimento**

Run: `node --import tsx --test src/lib/gestionale/metrics.test.ts`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementa `metrics.ts`**

```ts
export const FIRST_MONTH = '2026-09'
const MONTH_RE = /^\d{4}-\d{2}$/

export function monthsFrom(first: string, current: string): string[] {
    const out: string[] = []
    let [y, m] = current.split('-').map(Number)
    while (`${y}-${String(m).padStart(2, '0')}` >= first) {
        out.push(`${y}-${String(m).padStart(2, '0')}`)
        m -= 1
        if (m === 0) { m = 12; y -= 1 }
    }
    return out
}

export function pickMonth(raw: string | undefined, current: string): string {
    if (!raw || !MONTH_RE.test(raw)) return current
    return raw >= FIRST_MONTH && raw <= current ? raw : current
}

export type SellerMonth = { incassatoCents: number; lordaCents: number; imponibileCents: number; multeCents: number; nettoCents: number; hasCommissionRow: boolean }

/** La commissione la decide il gestionale; il CRM toglie solo le multe. Il netto si mostra com'è, anche negativo. */
export function sellerMonthSummary(
    comm: { totaleIncassatoCents: number; commissioneLordaCents: number; commissioneImponibileCents: number } | undefined,
    multeEur: number,
): SellerMonth {
    const multeCents = Math.round(multeEur * 100)
    const imponibileCents = comm?.commissioneImponibileCents ?? 0
    return {
        incassatoCents: comm?.totaleIncassatoCents ?? 0,
        lordaCents: comm?.commissioneLordaCents ?? 0,
        imponibileCents,
        multeCents,
        nettoCents: imponibileCents - multeCents,
        hasCommissionRow: comm !== undefined,
    }
}

/** Flusso di cassa del mese: ogni riga conta col suo segno, quindi originale + storno negativo = 0. */
export function cashTotalCents(incassi: { data: string | null; importoCents: number }[], mese: string): number {
    return incassi.reduce((s, i) => (i.data && i.data.slice(0, 7) === mese ? s + i.importoCents : s), 0)
}

export function commissionableSumCents(incassi: { contaCommissione: boolean; importoCents: number }[]): number {
    return incassi.reduce((s, i) => (i.contaCommissione ? s + i.importoCents : s), 0)
}

export const AT_RISK_STATES = ['Avvocato', 'Recupero', 'Sollecito', 'Stand-by'] as const

export type AtRiskContract = { id: string; clienteNome: string | null; clienteCognome: string | null; clienteTelefono: string | null; venditoreCode: string | null; salesUserId: string | null; statoPagamento: string | null; dataFirma: string | null }
export type AtRiskRata = { contrattoId: string; scadenza: string | null; importoCents: number; stato: string | null }
export type AtRiskRow = AtRiskContract & { rateScadute: number; scadutoCents: number; residuoCents: number; giorniDallaPiuVecchia: number | null }

function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export function classifyAtRisk(contratti: AtRiskContract[], rate: AtRiskRata[], today: string): AtRiskRow[] {
    const byContract = new Map<string, AtRiskRata[]>()
    for (const r of rate) {
        const list = byContract.get(r.contrattoId) ?? []
        list.push(r)
        byContract.set(r.contrattoId, list)
    }
    const rank = (s: string | null) => {
        const i = AT_RISK_STATES.indexOf(s as (typeof AT_RISK_STATES)[number])
        return i === -1 ? AT_RISK_STATES.length : i
    }
    const rows: AtRiskRow[] = []
    for (const c of contratti) {
        const rs = byContract.get(c.id) ?? []
        const scadute = rs.filter(r => r.stato === 'scaduta')
        const inState = rank(c.statoPagamento) < AT_RISK_STATES.length
        if (!inState && scadute.length === 0) continue
        const oldest = scadute.map(r => r.scadenza).filter((d): d is string => !!d).sort()[0]
        rows.push({
            ...c,
            rateScadute: scadute.length,
            scadutoCents: scadute.reduce((s, r) => s + r.importoCents, 0),
            residuoCents: rs.filter(r => r.stato !== 'pagata').reduce((s, r) => s + r.importoCents, 0),
            giorniDallaPiuVecchia: oldest ? daysBetween(oldest, today) : null,
        })
    }
    return rows.sort((a, b) => rank(a.statoPagamento) - rank(b.statoPagamento) || b.scadutoCents - a.scadutoCents)
}
```

- [ ] **Step 4: Test verdi**

Run: `node --import tsx --test src/lib/gestionale/metrics.test.ts`
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gestionale/metrics.ts src/lib/gestionale/metrics.test.ts package.json
git commit -m "feat(gestionale): calcoli di netto, cassa del mese e contratti a rischio"
```

---

### Task 7: Letture DB + pagina `/incassi` (ADMIN)

**Files:**
- Create: `src/lib/gestionale/queries.ts`
- Create: `src/components/gestionale/format.ts`
- Create: `src/components/gestionale/MonthSelect.tsx`
- Create: `src/components/gestionale/AtRiskTable.tsx`
- Create: `src/app/(dashboard)/incassi/page.tsx`
- Create: `src/app/(dashboard)/incassi/IncassiAdminClient.tsx`
- Modify: `src/components/Sidebar.tsx` (gruppo "Direzione", ~riga 215)

**Interfaces:**
- Consumes: metrics (Task 6), tabelle (Task 1), `aggiornaIncassiAdesso` (Task 5), `currentYearMonthRome` (`src/lib/workingDaysUtils.ts`), `salesLatePenalties` (schema).
- Produces (`queries.ts`, NIENTE `'use server'`, importato solo da server component):
```ts
export type LastRun = { status: string; startedAt: Date; finishedAt: Date | null; error: string | null; warnings: string[] } | null
export async function loadLastRun(): Promise<LastRun>
export async function loadLastOkAt(): Promise<Date | null>
export type IncassoView = { id: string; data: string | null; importoCents: number; voce: string | null; stato: string | null; contaCommissione: boolean; cliente: string; venditoreCode: string | null; salesUserId: string | null }
export type SellerRow = { venditoreCode: string; salesUserId: string | null; summary: SellerMonth }
export type AdminMonth = { cashCents: number; direzioneCashCents: number; sellers: SellerRow[]; incassi: IncassoView[]; atRisk: AtRiskRow[]; hasData: boolean }
export async function loadAdminMonth(mese: string, today: string): Promise<AdminMonth>
export type SellerMonthView = { summary: SellerMonth; incassi: IncassoView[]; commissionableCents: number; atRisk: AtRiskRow[]; hasData: boolean }
export async function loadSellerMonth(salesUserId: string, mese: string, today: string): Promise<SellerMonthView>
export function formatEur(cents: number): string   // in components/gestionale/format.ts
```

- [ ] **Step 1: `src/components/gestionale/format.ts`**

```ts
const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
export function formatEur(cents: number): string { return EUR.format(cents / 100) }
export function formatDate(d: string | null): string { return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—' }
export function formatMonth(m: string): string {
    return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`))
}
```

- [ ] **Step 2: `queries.ts`**

```ts
import { db } from '@/db'
import { gestionaleContratti, gestionaleRate, gestionaleIncassi, gestionaleCommissioni, gestionaleSyncRuns, salesLatePenalties } from '@/db/schema'
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { sellerMonthSummary, cashTotalCents, commissionableSumCents, classifyAtRisk, type SellerMonth, type AtRiskRow } from './metrics'
import { DIREZIONE } from './types'

export type LastRun = { status: string; startedAt: Date; finishedAt: Date | null; error: string | null; warnings: string[] } | null

export async function loadLastRun(): Promise<LastRun> {
    const [r] = await db.select().from(gestionaleSyncRuns).orderBy(desc(gestionaleSyncRuns.startedAt)).limit(1)
    return r ? { status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, error: r.error, warnings: r.warnings ?? [] } : null
}

export async function loadLastOkAt(): Promise<Date | null> {
    const [r] = await db.select({ f: gestionaleSyncRuns.finishedAt }).from(gestionaleSyncRuns)
        .where(eq(gestionaleSyncRuns.status, 'ok')).orderBy(desc(gestionaleSyncRuns.startedAt)).limit(1)
    return r?.f ?? null
}

export type IncassoView = { id: string; data: string | null; importoCents: number; voce: string | null; stato: string | null; contaCommissione: boolean; cliente: string; venditoreCode: string | null; salesUserId: string | null }
export type SellerRow = { venditoreCode: string; salesUserId: string | null; summary: SellerMonth }
export type AdminMonth = { cashCents: number; direzioneCashCents: number; sellers: SellerRow[]; incassi: IncassoView[]; atRisk: AtRiskRow[]; hasData: boolean }
export type SellerMonthView = { summary: SellerMonth; incassi: IncassoView[]; commissionableCents: number; atRisk: AtRiskRow[]; hasData: boolean }

function monthBounds(mese: string): { from: string; to: string } {
    const [y, m] = mese.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    return { from: `${mese}-01`, to: `${next}-01` }
}

const incassoCols = {
    id: gestionaleIncassi.id, data: gestionaleIncassi.data, importoCents: gestionaleIncassi.importoCents,
    voce: gestionaleIncassi.voce, stato: gestionaleIncassi.stato, contaCommissione: gestionaleIncassi.contaCommissione,
    venditoreCode: gestionaleIncassi.venditoreCode, salesUserId: gestionaleIncassi.salesUserId,
    nome: gestionaleContratti.clienteNome, cognome: gestionaleContratti.clienteCognome,
}
type IncassoRaw = { id: string; data: string | null; importoCents: number; voce: string | null; stato: string | null; contaCommissione: boolean; venditoreCode: string | null; salesUserId: string | null; nome: string | null; cognome: string | null }
const toView = (r: IncassoRaw): IncassoView => ({
    id: r.id, data: r.data, importoCents: r.importoCents, voce: r.voce, stato: r.stato, contaCommissione: r.contaCommissione,
    venditoreCode: r.venditoreCode, salesUserId: r.salesUserId,
    cliente: [r.nome, r.cognome].filter(Boolean).join(' ') || '—',
})

async function multeByUser(mese: string, salesUserId?: string): Promise<Map<string, number>> {
    const rows = await db.select({ u: salesLatePenalties.salesUserId, eur: sql<number>`coalesce(sum(${salesLatePenalties.amountEur}), 0)` })
        .from(salesLatePenalties)
        .where(and(
            eq(salesLatePenalties.monthKey, mese),
            isNull(salesLatePenalties.voidedAt),
            salesUserId ? eq(salesLatePenalties.salesUserId, salesUserId) : undefined,
        ))
        .groupBy(salesLatePenalties.salesUserId)
    return new Map(rows.map(r => [r.u, Number(r.eur)]))
}

async function atRiskFor(salesUserId?: string, today = ''): Promise<AtRiskRow[]> {
    const contratti = await db.select({
        id: gestionaleContratti.id, clienteNome: gestionaleContratti.clienteNome, clienteCognome: gestionaleContratti.clienteCognome,
        clienteTelefono: gestionaleContratti.clienteTelefono, venditoreCode: gestionaleContratti.venditoreCode,
        salesUserId: gestionaleContratti.salesUserId, statoPagamento: gestionaleContratti.statoPagamento, dataFirma: gestionaleContratti.dataFirma,
    }).from(gestionaleContratti).where(and(
        isNull(gestionaleContratti.deletedAt),
        salesUserId ? eq(gestionaleContratti.salesUserId, salesUserId) : undefined,
    ))
    if (contratti.length === 0) return []
    const ids = contratti.map(c => c.id)
    const rate = []
    for (let i = 0; i < ids.length; i += 500) {
        rate.push(...await db.select({
            contrattoId: gestionaleRate.contrattoId, scadenza: gestionaleRate.scadenza, importoCents: gestionaleRate.importoCents, stato: gestionaleRate.stato,
        }).from(gestionaleRate).where(and(isNull(gestionaleRate.deletedAt), inArray(gestionaleRate.contrattoId, ids.slice(i, i + 500)))))
    }
    return classifyAtRisk(contratti, rate, today)
}

export async function loadAdminMonth(mese: string, today: string): Promise<AdminMonth> {
    const { from, to } = monthBounds(mese)
    const [incassiRaw, commRows, multe, atRisk] = await Promise.all([
        db.select(incassoCols).from(gestionaleIncassi)
            .leftJoin(gestionaleContratti, eq(gestionaleContratti.id, gestionaleIncassi.contrattoId))
            .where(and(isNull(gestionaleIncassi.deletedAt), gte(gestionaleIncassi.data, from), lt(gestionaleIncassi.data, to)))
            .orderBy(desc(gestionaleIncassi.data)),
        db.select().from(gestionaleCommissioni).where(eq(gestionaleCommissioni.mese, mese)),
        multeByUser(mese),
        atRiskFor(undefined, today),
    ])
    const incassi = incassiRaw.map(toView)
    const sellers: SellerRow[] = commRows
        .filter(c => c.venditoreCode !== DIREZIONE)
        .map(c => ({ venditoreCode: c.venditoreCode, salesUserId: c.salesUserId, summary: sellerMonthSummary(c, c.salesUserId ? multe.get(c.salesUserId) ?? 0 : 0) }))
        .sort((a, b) => a.venditoreCode.localeCompare(b.venditoreCode))
    return {
        cashCents: cashTotalCents(incassi, mese),
        direzioneCashCents: cashTotalCents(incassi.filter(i => i.venditoreCode === DIREZIONE || !i.venditoreCode), mese),
        sellers, incassi, atRisk,
        hasData: commRows.length > 0 || incassi.length > 0,
    }
}

export async function loadSellerMonth(salesUserId: string, mese: string, today: string): Promise<SellerMonthView> {
    const [incassiRaw, commRows, multe, atRisk] = await Promise.all([
        db.select(incassoCols).from(gestionaleIncassi)
            .leftJoin(gestionaleContratti, eq(gestionaleContratti.id, gestionaleIncassi.contrattoId))
            .where(and(isNull(gestionaleIncassi.deletedAt), eq(gestionaleIncassi.salesUserId, salesUserId), eq(gestionaleIncassi.meseCommissione, mese)))
            .orderBy(desc(gestionaleIncassi.data)),
        db.select().from(gestionaleCommissioni).where(and(eq(gestionaleCommissioni.mese, mese), eq(gestionaleCommissioni.salesUserId, salesUserId))),
        multeByUser(mese, salesUserId),
        atRiskFor(salesUserId, today),
    ])
    const incassi = incassiRaw.map(toView)
    return {
        summary: sellerMonthSummary(commRows[0], multe.get(salesUserId) ?? 0),
        incassi,
        commissionableCents: commissionableSumCents(incassi),
        atRisk,
        hasData: commRows.length > 0 || incassi.length > 0,
    }
}
```

Nota: `loadLastOkAt` serve a `/miei-incassi` ("aggiornato alle…"); `loadLastRun` a `/incassi` (mostra anche gli errori). `today` = `new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })`.

- [ ] **Step 3: `MonthSelect.tsx`** (client)

```tsx
"use client"

import { useRouter, usePathname } from "next/navigation"
import { formatMonth } from "./format"

export function MonthSelect({ months, value }: { months: string[]; value: string }) {
    const router = useRouter()
    const pathname = usePathname()
    return (
        <select
            className="rounded-md border border-ash-200 bg-white px-3 py-1.5 text-sm text-ash-800"
            value={value}
            onChange={(e) => router.push(`${pathname}?mese=${e.target.value}`)}
        >
            {months.map(m => <option key={m} value={m}>{formatMonth(m)}</option>)}
        </select>
    )
}
```

- [ ] **Step 4: `AtRiskTable.tsx`** (server-safe, niente hook)

```tsx
import type { AtRiskRow } from "@/lib/gestionale/metrics"
import { formatEur, formatDate } from "./format"

const BADGE: Record<string, string> = {
    Avvocato: "bg-red-100 text-red-800",
    Recupero: "bg-orange-100 text-orange-800",
    Sollecito: "bg-amber-100 text-amber-800",
    "Stand-by": "bg-ash-100 text-ash-700",
}

export function AtRiskTable({ rows, showSeller }: { rows: AtRiskRow[]; showSeller: boolean }) {
    if (rows.length === 0) return <div className="text-sm text-ash-500">Nessun contratto a rischio.</div>
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead>
                    <tr className="border-b border-ash-200 text-left text-xs uppercase text-ash-500">
                        <th className="py-2 pr-4">Cliente</th>
                        <th className="py-2 pr-4">Telefono</th>
                        {showSeller && <th className="py-2 pr-4">Venditore</th>}
                        <th className="py-2 pr-4">Stato</th>
                        <th className="py-2 pr-4">Firma</th>
                        <th className="py-2 pr-4 text-right">Rate scadute</th>
                        <th className="py-2 pr-4 text-right">Scaduto</th>
                        <th className="py-2 text-right">Residuo</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.id} className="border-b border-ash-100">
                            <td className="py-2 pr-4 text-ash-800">{[r.clienteNome, r.clienteCognome].filter(Boolean).join(" ") || "—"}</td>
                            <td className="py-2 pr-4 text-ash-600">{r.clienteTelefono ?? "—"}</td>
                            {showSeller && <td className="py-2 pr-4 text-ash-600">{r.venditoreCode ?? "—"}</td>}
                            <td className="py-2 pr-4">
                                <div className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${BADGE[r.statoPagamento ?? ""] ?? "bg-ash-100 text-ash-700"}`}>
                                    {r.statoPagamento ?? "—"}
                                </div>
                            </td>
                            <td className="py-2 pr-4 text-ash-600">{formatDate(r.dataFirma)}</td>
                            <td className="py-2 pr-4 text-right">
                                {r.rateScadute}{r.giorniDallaPiuVecchia !== null ? ` (da ${r.giorniDallaPiuVecchia} gg)` : ""}
                            </td>
                            <td className="py-2 pr-4 text-right font-medium text-red-700">{formatEur(r.scadutoCents)}</td>
                            <td className="py-2 text-right">{formatEur(r.residuoCents)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
```

- [ ] **Step 5: `incassi/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { FIRST_MONTH, monthsFrom, pickMonth } from "@/lib/gestionale/metrics"
import { loadAdminMonth, loadLastRun } from "@/lib/gestionale/queries"
import IncassiAdminClient from "./IncassiAdminClient"

export const dynamic = "force-dynamic"

export default async function IncassiPage({ searchParams }: { searchParams: { mese?: string } }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") redirect("/unauthorized")

    const current = currentYearMonthRome()
    const mese = pickMonth(searchParams.mese, current)
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" })
    const [data, lastRun] = await Promise.all([loadAdminMonth(mese, today), loadLastRun()])

    return (
        <IncassiAdminClient
            mese={mese}
            months={monthsFrom(FIRST_MONTH, current)}
            data={data}
            lastRun={lastRun ? { ...lastRun, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null } : null}
        />
    )
}
```

- [ ] **Step 6: `IncassiAdminClient.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { AdminMonth } from "@/lib/gestionale/queries"
import { aggiornaIncassiAdesso } from "@/app/actions/gestionaleSyncActions"
import { MonthSelect } from "@/components/gestionale/MonthSelect"
import { AtRiskTable } from "@/components/gestionale/AtRiskTable"
import { formatEur, formatDate } from "@/components/gestionale/format"

type RunInfo = { status: string; startedAt: string; finishedAt: string | null; error: string | null; warnings: string[] } | null

function Tile({ label, value, tone = "text-ash-800" }: { label: string; value: string; tone?: string }) {
    return (
        <div className="rounded-xl border border-ash-200 bg-white p-4">
            <div className="text-xs uppercase text-ash-500">{label}</div>
            <div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div>
        </div>
    )
}

export default function IncassiAdminClient({ mese, months, data, lastRun }: { mese: string; months: string[]; data: AdminMonth; lastRun: RunInfo }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [msg, setMsg] = useState<string | null>(null)
    const [seller, setSeller] = useState<string | null>(null)
    const [riskSeller, setRiskSeller] = useState<string>("")

    const refresh = () => startTransition(async () => {
        setMsg(null)
        try {
            const r = await aggiornaIncassiAdesso()
            setMsg(r.status === "ok" ? `Aggiornato: ${r.inserted} nuovi, ${r.updated} aggiornati, ${r.deleted} eliminati.`
                : r.status === "skipped" ? `Non eseguito: ${r.reason}` : `Errore: ${r.error}`)
            router.refresh()
        } catch {
            setMsg("Errore: aggiornamento non riuscito")
        }
    })

    const totImponibile = data.sellers.reduce((s, r) => s + r.summary.imponibileCents, 0)
    const totMulte = data.sellers.reduce((s, r) => s + r.summary.multeCents, 0)
    const scaduto = data.atRisk.reduce((s, r) => s + r.scadutoCents, 0)
    const riskRows = riskSeller ? data.atRisk.filter(r => (r.venditoreCode ?? "") === riskSeller) : data.atRisk
    const riskSellers = Array.from(new Set(data.atRisk.map(r => r.venditoreCode ?? ""))).sort()
    const sellerIncassi = seller ? data.incassi.filter(i => i.venditoreCode === seller) : []

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">Incassi</h1>
                    <div className="mt-1 text-sm text-ash-500">
                        Dati dal gestionale amministrazione.{" "}
                        {lastRun ? `Ultimo aggiornamento: ${new Date(lastRun.finishedAt ?? lastRun.startedAt).toLocaleString("it-IT", { timeZone: "Europe/Rome" })} (${lastRun.status})` : "Mai aggiornato."}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <MonthSelect months={months} value={mese} />
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={pending}
                        className="rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                        {pending ? "Aggiorno…" : "Aggiorna adesso"}
                    </button>
                </div>
            </div>

            {msg && <div className="rounded-md border border-ash-200 bg-ash-50 px-3 py-2 text-sm text-ash-700">{msg}</div>}
            {lastRun?.status === "error" && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    L&apos;ultimo aggiornamento è fallito: {lastRun.error}. Restano visibili i dati dell&apos;ultimo aggiornamento riuscito.
                </div>
            )}
            {lastRun && lastRun.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{lastRun.warnings.join(" · ")}</div>
            )}

            {!data.hasData ? (
                <div className="rounded-xl border border-ash-200 bg-white p-8 text-center text-ash-500">
                    Dati dal gestionale non ancora disponibili per questo mese.
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Tile label="Incassato del mese" value={formatEur(data.cashCents)} />
                        <Tile label="Commissioni (imponibile)" value={formatEur(totImponibile)} />
                        <Tile label="Multe venditori" value={formatEur(totMulte)} tone="text-red-700" />
                        <Tile label={`A rischio (${data.atRisk.length})`} value={formatEur(scaduto)} tone="text-red-700" />
                    </div>

                    <div className="rounded-xl border border-ash-200 bg-white p-4">
                        <h2 className="mb-3 font-semibold text-ash-800">Per venditore</h2>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b border-ash-200 text-left text-xs uppercase text-ash-500">
                                        <th className="py-2 pr-4">Venditore</th>
                                        <th className="py-2 pr-4 text-right">Incassato</th>
                                        <th className="py-2 pr-4 text-right">Comm. lorda</th>
                                        <th className="py-2 pr-4 text-right">Imponibile</th>
                                        <th className="py-2 pr-4 text-right">Multe</th>
                                        <th className="py-2 text-right">Netto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.sellers.map(s => (
                                        <tr key={s.venditoreCode} className="border-b border-ash-100">
                                            <td className="py-2 pr-4">
                                                <button type="button" onClick={() => setSeller(seller === s.venditoreCode ? null : s.venditoreCode)} className="font-medium text-brand-orange hover:underline">
                                                    {s.venditoreCode}
                                                </button>
                                            </td>
                                            <td className="py-2 pr-4 text-right">{formatEur(s.summary.incassatoCents)}</td>
                                            <td className="py-2 pr-4 text-right">{formatEur(s.summary.lordaCents)}</td>
                                            <td className="py-2 pr-4 text-right">{formatEur(s.summary.imponibileCents)}</td>
                                            <td className="py-2 pr-4 text-right text-red-700">{formatEur(s.summary.multeCents)}</td>
                                            <td className="py-2 text-right font-semibold">{formatEur(s.summary.nettoCents)}</td>
                                        </tr>
                                    ))}
                                    <tr className="text-ash-600">
                                        <td className="py-2 pr-4">DIREZIONE</td>
                                        <td className="py-2 pr-4 text-right">{formatEur(data.direzioneCashCents)}</td>
                                        <td className="py-2 text-right" colSpan={4}>senza commissione</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        {seller && (
                            <div className="mt-4">
                                <h3 className="mb-2 text-sm font-semibold text-ash-700">Incassi di {seller} con data nel mese</h3>
                                {sellerIncassi.length === 0 ? <div className="text-sm text-ash-500">Nessun incasso con data in questo mese.</div> : (
                                    <ul className="divide-y divide-ash-100 text-sm">
                                        {sellerIncassi.map(i => (
                                            <li key={i.id} className="flex justify-between py-1.5">
                                                <div>{formatDate(i.data)} · {i.cliente} · {i.voce ?? "—"}{i.stato === "stornato" ? " (stornato)" : ""}</div>
                                                <div className={i.importoCents < 0 ? "text-red-700" : ""}>{formatEur(i.importoCents)}</div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="rounded-xl border border-ash-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-semibold text-ash-800">Contratti a rischio</h2>
                    <select value={riskSeller} onChange={e => setRiskSeller(e.target.value)} className="rounded-md border border-ash-200 px-2 py-1 text-sm">
                        <option value="">Tutti i venditori</option>
                        {riskSellers.map(s => <option key={s} value={s}>{s || "—"}</option>)}
                    </select>
                </div>
                <AtRiskTable rows={riskRows} showSeller />
            </div>
        </div>
    )
}
```

Nota: `AdminMonth` contiene solo tipi serializzabili (stringhe/numeri/boolean): passa così dal server al client. Se `import type` da `queries.ts` trascina `db` nel bundle client, sposta i tipi `IncassoView/SellerRow/AdminMonth/SellerMonthView` in `src/lib/gestionale/types.ts` e importali da lì in entrambi i file.

- [ ] **Step 7: Sidebar** — nel gruppo "Direzione" (`src/components/Sidebar.tsx`, ~riga 215), dopo la voce "Sales Manager":

```tsx
                        ...(role === "ADMIN" ? [{ name: "Incassi", href: "/incassi", icon: Briefcase }] : []),
```
(`Briefcase` è già importato: è usato da "Portafoglio Clienti".)

- [ ] **Step 8: Type-check + build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: build OK, route `/incassi` presente nell'output.

- [ ] **Step 9: Commit**

```bash
git add src/lib/gestionale/queries.ts src/components/gestionale src/app/\(dashboard\)/incassi src/components/Sidebar.tsx src/lib/gestionale/types.ts
git commit -m "feat(incassi): pagina admin con incassi per venditore e contratti a rischio"
```

---

### Task 8: Pagina `/miei-incassi` (VENDITORE)

**Files:**
- Create: `src/app/(dashboard)/miei-incassi/page.tsx`
- Modify: `src/components/Sidebar.tsx` (menu VENDITORE, ~riga 150)

**Interfaces:**
- Consumes: `loadSellerMonth`, `loadLastOkAt` (Task 7), `MonthSelect`, `AtRiskTable`, `formatEur`, `formatDate` (Task 7), `pickMonth`, `monthsFrom`, `FIRST_MONTH` (Task 6).

- [ ] **Step 1: Pagina** (server component; l'utente viene SOLO dalla sessione, l'unico parametro letto è `mese`)

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { FIRST_MONTH, monthsFrom, pickMonth } from "@/lib/gestionale/metrics"
import { loadSellerMonth, loadLastOkAt } from "@/lib/gestionale/queries"
import { MonthSelect } from "@/components/gestionale/MonthSelect"
import { AtRiskTable } from "@/components/gestionale/AtRiskTable"
import { formatEur, formatDate } from "@/components/gestionale/format"

export const dynamic = "force-dynamic"

function Tile({ label, value, tone = "text-ash-800" }: { label: string; value: string; tone?: string }) {
    return (
        <div className="rounded-xl border border-ash-200 bg-white p-4">
            <div className="text-xs uppercase text-ash-500">{label}</div>
            <div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div>
        </div>
    )
}

export default async function MieiIncassiPage({ searchParams }: { searchParams: { mese?: string } }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "VENDITORE") redirect("/unauthorized")

    const current = currentYearMonthRome()
    const mese = pickMonth(searchParams.mese, current)
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" })
    const [view, lastOk] = await Promise.all([loadSellerMonth(user.id, mese, today), loadLastOkAt()])
    const s = view.summary

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">I miei incassi</h1>
                    <div className="mt-1 text-sm text-ash-500">
                        {lastOk ? `Aggiornato al ${lastOk.toLocaleString("it-IT", { timeZone: "Europe/Rome" })}` : "Dati non ancora disponibili"}
                    </div>
                </div>
                <MonthSelect months={monthsFrom(FIRST_MONTH, current)} value={mese} />
            </div>

            {!view.hasData ? (
                <div className="rounded-xl border border-ash-200 bg-white p-8 text-center text-ash-500">
                    Dati dal gestionale non ancora disponibili per questo mese.
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Tile label="Incassato" value={formatEur(s.incassatoCents)} />
                        <Tile label="Commissione" value={formatEur(s.imponibileCents)} />
                        <Tile label="Multe del mese" value={formatEur(s.multeCents)} tone="text-red-700" />
                        <Tile label="Netto" value={formatEur(s.nettoCents)} tone="text-emerald-700" />
                    </div>
                    <div className="text-xs text-ash-500">
                        Commissione = 10% dell&apos;incassato senza IVA, calcolata dall&apos;amministrazione. Le multe sono quelle registrate nel CRM per questo mese.
                    </div>

                    <div className="rounded-xl border border-ash-200 bg-white p-4">
                        <h2 className="mb-3 font-semibold text-ash-800">Incassi che maturano commissione questo mese</h2>
                        {view.incassi.length === 0 ? <div className="text-sm text-ash-500">Nessun incasso.</div> : (
                            <ul className="divide-y divide-ash-100 text-sm">
                                {view.incassi.map(i => (
                                    <li key={i.id} className="flex justify-between py-1.5">
                                        <div>
                                            {formatDate(i.data)} · {i.cliente} · {i.voce ?? "—"}
                                            {!i.contaCommissione && <span className="ml-1 text-xs text-ash-400">(non conta)</span>}
                                        </div>
                                        <div className={i.importoCents < 0 ? "text-red-700" : ""}>{formatEur(i.importoCents)}</div>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {view.commissionableCents !== s.incassatoCents && (
                            <div className="mt-2 text-xs text-ash-500">
                                Il totale dell&apos;amministrazione ({formatEur(s.incassatoCents)}) può differire dalla somma qui sopra ({formatEur(view.commissionableCents)}): fa fede l&apos;amministrazione.
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="rounded-xl border border-ash-200 bg-white p-4">
                <h2 className="mb-3 font-semibold text-ash-800">I miei contratti a rischio</h2>
                <AtRiskTable rows={view.atRisk} showSeller={false} />
            </div>
        </div>
    )
}
```

Nota: la `<span>` sopra contiene solo testo (nessun bottone): rispetta CLAUDE.md §4.1.

- [ ] **Step 2: Sidebar** — nel menu VENDITORE (`src/components/Sidebar.tsx`, ~riga 158), dopo "Portafoglio Clienti":

```tsx
            { name: "I miei incassi", href: "/miei-incassi", icon: Briefcase },
```

- [ ] **Step 3: Build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: build OK, `/miei-incassi` nell'output.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/miei-incassi src/components/Sidebar.tsx
git commit -m "feat(incassi): pagina del venditore con commissione meno multe"
```

---

### Task 9: Verifica end-to-end in locale sul DB (prima del deploy)

**Files:** nessun file di prodotto. Script temporanei nello scratchpad.

- [ ] **Step 1: Applica la migration 0039** al progetto Supabase `ncutwzsifzundikwllxp` con `mcp__supabase__apply_migration` (nome `0039_gestionale_incassi`, contenuto del file). Verifica con `list_tables` che le 5 tabelle esistano. (Additiva: nessuna tabella esistente toccata.)

- [ ] **Step 2: Sync contro un server finto** — avvia nello scratchpad un server HTTP Node che serve `snapshot.sample.json` su `/api/v1/contratti` controllando il Bearer; poi esegui con `npx tsx` uno script che imposta `GESTIONALE_API_URL=http://localhost:PORT`, `GESTIONALE_API_KEY=test` e chiama `runGestionaleSync('manuale')`.
Expected: `status: 'ok'`, `inserted: 8` (2 contratti + 3 rate + 3 incassi), warning vuoti (Sales 002 esiste). Secondo giro: `updated: 8`, `inserted: 0`.

- [ ] **Step 3: Guardia** — servi uno snapshot con `contratti: []` e rilancia. Expected: `status: 'error'` con messaggio "snapshot vuoto", righe ancora vive in DB.

- [ ] **Step 4: Pulizia** — `delete from "gestionaleSyncRuns"; delete from "gestionaleCommissioni"; delete from "gestionaleIncassi"; delete from "gestionaleRate"; delete from "gestionaleContratti";` via `execute_sql` (sono solo dati di prova: le tabelle sono nuove e vuote prima del test).

- [ ] **Step 5: `npm test` e `npm run build`** completi. Expected: tutto verde.

Il deploy in produzione NON fa parte del piano: lo autorizza il PO.
