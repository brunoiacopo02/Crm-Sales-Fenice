# Performance Venditori & Ciclo Follow-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare a venditori e sales manager una sezione di analisi performance (motivi di non chiusura, funnel follow-up, closing rate, tentativi medi, trend) e trasformare i follow-up in un ciclo tracciato con follow-up obbligatorio dopo un "Non chiuso", più un focus di coaching settimanale assegnato dal manager.

**Architecture:** Ogni esito venditore diventa un record in una nuova tabella `salesAttempts` (storia), mentre `leads` resta lo stato corrente denormalizzato per KPI/board esistenti. La logica di aggregazione è estratta in funzioni pure testabili (`src/lib/venditorePerformance/`). Una server action `getVenditorePerformance` alimenta un componente `VenditorePerformanceView` riusato sia nella dashboard venditore (dati propri) sia nella pagina Sales Manager `/performance-venditori` (filtro per venditore). Il focus settimanale vive in `salesWeeklyFocus`.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM 0.45, Supabase Postgres, React 19, Tailwind v4, lucide-react, recharts (già in deps), date-fns. Test: `node:test` + loader `tsx` (già in devDependencies), nessuna nuova dipendenza.

## Global Constraints

- **ORM**: solo Drizzle via `src/db/schema.ts`. Mai SQL raw nelle action.
- **Multi-tenant**: ogni query filtra per company con `companyScope(ctx, table.companyId)` o `eq(table.companyId, ctx.companyId)`. Ogni nuova tabella ha `companyId text default 'fenice' notNull references companies.id`.
- **Auth**: server action con `currentTenant()` + `assertSalesArea(ctx)`; guardie ruolo via `supabase.auth.getUser()` + `user.user_metadata.role`. Ruoli esistenti: `VENDITORE | MANAGER | ADMIN | CONFERME | GDO | TL`.
- **Timezone**: tutte le date periodiche in Europe/Rome via `monthBoundsRome`/`weekBoundsRome`/`dayBoundsRome` da `@/lib/dateUtils` e `currentYearMonthRome` da `@/lib/workingDaysUtils`. I `datetime-local` si convertono con `parseRomeDatetimeLocal`/`toRomeDatetimeLocal`.
- **Esiti venditore**: `Chiuso | Non chiuso | Perso | Sparito` (nuovo valore `Perso`).
- **Migrazioni**: file SQL idempotente (`IF NOT EXISTS`) in `drizzle/migrations/NNNN_*.sql`, applicato al DB Supabase remoto via MCP `mcp__supabase__apply_migration`. Ultima migrazione presente: `0014_scheda_trattativa.sql` → la nuova è `0015`.
- **No unit test preesistenti**: introdotto `node --import tsx --test`. Verifica UI/integrazione con `npm run build` + `npm run lint` + QA browser.
- **Interattività**: nessun bottone dentro `<span>/<p>` (regola WSOD): usare `<div>`/`<button>`.
- **Motivi non chiusura** (8, verbatim, label === valore salvato):
  `Non ha soldi | Deve parlare con terzi | Valuta altri percorsi | Non ha urgenza reale | Non vuole decidere in call | Troppo spaventato | Fa già altri corsi | Event imminente che lo blocca`

---

## File Structure

- `src/db/schema.ts` — **modifica**: aggiunge `salesAttempts` e `salesWeeklyFocus`.
- `drizzle/migrations/0015_sales_performance.sql` — **crea**: DDL delle due tabelle + indici.
- `src/lib/surveys/questions.ts` — **modifica**: esporta `NOT_CLOSED_REASONS` + tipo `NotClosedReason`.
- `src/lib/venditorePerformance/aggregate.ts` — **crea**: funzioni pure di aggregazione + tipo `AttemptInput`.
- `src/lib/venditorePerformance/aggregate.test.ts` — **crea**: test aggregazioni.
- `src/lib/venditorePerformance/guard.ts` — **crea**: `validateOutcomeTransition` (pura).
- `src/lib/venditorePerformance/guard.test.ts` — **crea**: test guardia.
- `src/app/actions/venditoreActions.ts` — **modifica**: `saveVenditoreOutcome` (insert attempt + guardie + `Perso`), nuove `getVenditoreFollowUps`, aggiunge `attemptCount`/`nextFollowUpDate` a `getVenditoreAppointments`.
- `src/app/actions/kpiVenditoriActions.ts` — **modifica**: conta `Perso` negli esitati.
- `src/app/actions/venditorePerformanceActions.ts` — **crea**: `getVenditorePerformance`.
- `src/app/actions/salesWeeklyFocusActions.ts` — **crea**: `getSalesWeeklyFocus`, `setSalesWeeklyFocus`, `listVenditori`.
- `src/lib/workingDaysUtils.ts` — **modifica**: aggiunge `currentWeekStartRome()`.
- `src/components/VenditoreDrawer.tsx` — **modifica**: reasons centralizzati, `Perso`, follow-up obbligatorio + tetto.
- `src/components/VenditoreDashboardClient.tsx` — **modifica**: tab "Follow-up" + tab "Performance" + banner focus.
- `src/components/venditore-performance/VenditorePerformanceView.tsx` — **crea**: componente analytics condiviso.
- `src/components/venditore-performance/WeeklyFocusBanner.tsx` — **crea**: banner focus venditore.
- `src/components/venditore-performance/SalesWeeklyFocusEditor.tsx` — **crea**: editor focus (manager).
- `src/app/(dashboard)/performance-venditori/page.tsx` — **crea**: pagina Sales Manager.
- `src/app/(dashboard)/performance-venditori/PerformanceVenditoriClient.tsx` — **crea**: client con selettori.
- `src/components/Sidebar.tsx` — **modifica**: voce nav "Performance Venditori".
- `package.json` — **modifica**: script `test`.

---

## Task 1: Schema DB `salesAttempts` + `salesWeeklyFocus` + migrazione

**Files:**
- Modify: `src/db/schema.ts` (dopo `salesLeadSurveys`, ~riga 865)
- Create: `drizzle/migrations/0015_sales_performance.sql`

**Interfaces:**
- Produces: tabelle Drizzle `salesAttempts` e `salesWeeklyFocus` con le colonne sotto. Le task successive importano `{ salesAttempts, salesWeeklyFocus }` da `@/db/schema`.

- [ ] **Step 1: Aggiungere le tabelle a `src/db/schema.ts`**

Inserire dopo la chiusura di `salesLeadSurveys` (dopo la riga `});` a ~865). Gli helper `pgTable, text, integer, real, timestamp, index` sono già importati in cima al file (verificare l'import esistente; `real` è già usato da `closeAmountEur`).

```ts
// Storia degli esiti venditore: un record per ogni tentativo/esito su un lead.
// leads.* resta lo stato "corrente" per KPI/board; questa tabella è la storia
// su cui gira l'analytics performance (motivi, funnel follow-up, tentativi medi).
export const salesAttempts = pgTable('salesAttempts', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // 0 = esito post-appuntamento; 1..3 = follow-up successivi.
    attemptNumber: integer('attemptNumber').notNull(),
    outcome: text('outcome').notNull(),            // 'Chiuso' | 'Non chiuso' | 'Perso' | 'Sparito'
    notClosedReason: text('notClosedReason'),      // uno degli 8 motivi (solo Non chiuso/Perso)
    nextFollowUpDate: timestamp('nextFollowUpDate', { withTimezone: true, mode: 'date' }), // solo se Non chiuso
    closeProduct: text('closeProduct'),            // 'advance'|'gold'|'exclusive' (solo Chiuso)
    closeAmountEur: real('closeAmountEur'),        // solo Chiuso
    // Data effettiva dell'esito (mirror di leads.salespersonOutcomeAt): usata per i bounds periodo.
    outcomeAt: timestamp('outcomeAt', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
}, (table) => {
    return {
        leadIdx: index('sales_attempts_lead_idx').on(table.leadId),
        userDateIdx: index('sales_attempts_user_date_idx').on(table.salesUserId, table.outcomeAt),
        companyDateIdx: index('sales_attempts_company_date_idx').on(table.companyId, table.outcomeAt),
    };
});

// Focus di coaching settimanale assegnato dal manager al venditore.
export const salesWeeklyFocus = pgTable('salesWeeklyFocus', {
    id: text('id').primaryKey(),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    weekStart: text('weekStart').notNull(),        // 'YYYY-MM-DD' = lunedì (Rome)
    objection: text('objection'),                  // uno degli 8 motivi (nullable)
    taskNote: text('taskNote').notNull().default(''),
    createdBy: text('createdBy').notNull().references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
}, (table) => {
    return {
        weekUnique: uniqueIndex('sales_weekly_focus_user_week_uq').on(table.salesUserId, table.weekStart),
    };
});
```

Se `uniqueIndex` non è tra gli import in cima al file, aggiungerlo all'import da `drizzle-orm/pg-core` (accanto a `index`). Verificare con una ricerca dell'import esistente.

- [ ] **Step 2: Verificare che lo schema compili**

Run: `npx tsc --noEmit`
Expected: nessun errore relativo a `schema.ts` (eventuali errori preesistenti altrove sono baseline nota).

- [ ] **Step 3: Creare la migrazione SQL idempotente**

Create `drizzle/migrations/0015_sales_performance.sql`:

```sql
CREATE TABLE IF NOT EXISTS "salesAttempts" (
    "id" text PRIMARY KEY NOT NULL,
    "leadId" text NOT NULL,
    "salesUserId" text NOT NULL,
    "attemptNumber" integer NOT NULL,
    "outcome" text NOT NULL,
    "notClosedReason" text,
    "nextFollowUpDate" timestamptz,
    "closeProduct" text,
    "closeAmountEur" real,
    "outcomeAt" timestamptz NOT NULL,
    "createdAt" timestamptz DEFAULT now() NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL
);

CREATE TABLE IF NOT EXISTS "salesWeeklyFocus" (
    "id" text PRIMARY KEY NOT NULL,
    "salesUserId" text NOT NULL,
    "weekStart" text NOT NULL,
    "objection" text,
    "taskNote" text DEFAULT '' NOT NULL,
    "createdBy" text NOT NULL,
    "createdAt" timestamptz DEFAULT now() NOT NULL,
    "updatedAt" timestamptz DEFAULT now() NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL
);

CREATE INDEX IF NOT EXISTS "sales_attempts_lead_idx" ON "salesAttempts" ("leadId");
CREATE INDEX IF NOT EXISTS "sales_attempts_user_date_idx" ON "salesAttempts" ("salesUserId", "outcomeAt");
CREATE INDEX IF NOT EXISTS "sales_attempts_company_date_idx" ON "salesAttempts" ("companyId", "outcomeAt");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_weekly_focus_user_week_uq" ON "salesWeeklyFocus" ("salesUserId", "weekStart");
```

- [ ] **Step 4: Applicare la migrazione al DB Supabase**

Usare l'MCP Supabase. Se serve il project id, eseguire prima `mcp__supabase__list_projects`. Poi:
`mcp__supabase__apply_migration` con `name: "sales_performance"` e `query` = contenuto del file `.sql` sopra.
Expected: successo, nessun errore. (Idempotente: ri-eseguibile senza danni.)

Verifica: `mcp__supabase__list_tables` include `salesAttempts` e `salesWeeklyFocus`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/migrations/0015_sales_performance.sql
git commit -m "feat(venditori): schema salesAttempts + salesWeeklyFocus + migrazione 0015"
```

---

## Task 2: Libreria di aggregazione (funzioni pure + test)

**Files:**
- Create: `src/lib/venditorePerformance/aggregate.ts`
- Create: `src/lib/venditorePerformance/aggregate.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces:
  - `interface AttemptInput { leadId: string; attemptNumber: number; outcome: string; notClosedReason: string | null; nextFollowUpDate: Date | null; closeProduct: string | null; closeAmountEur: number | null; outcomeAt: Date }`
  - `reasonDistribution(attempts: AttemptInput[], start: Date, end: Date): { reason: string; count: number; pct: number }[]` — ordinato per count desc; `pct` arrotondato intero; considera solo attempt con `outcome ∈ {'Non chiuso','Perso'}` e `notClosedReason` non nullo, con `outcomeAt ∈ [start,end)`.
  - `topReason(dist): { reason: string; pct: number } | null` — primo elemento o null.
  - `followUpFunnel(attempts: AttemptInput[], start: Date, end: Date): { enteredFollowUp: number; closed: number; conversionPct: number }` — `enteredFollowUp` = n° lead distinti con un attempt `Non chiuso` in `[start,end)`; `closed` = quanti di quei lead hanno un attempt `Chiuso` (in qualsiasi data); `conversionPct` intero.
  - `closingStats(attempts, start, end): { chiusi: number; nonChiusi: number; perso: number; sparito: number; totalEsitati: number; closingPct: number; fatturato: number; ticketMedio: number; topProduct: string | null }` — su attempt con `outcomeAt ∈ [start,end)`.
  - `attemptsToClose(attempts, start, end): { avgAttempts: number; firstShotPct: number }` — sui lead con attempt `Chiuso` in periodo: `avgAttempts` = media `(attemptNumber+1)`, `firstShotPct` = % chiusi con `attemptNumber===0`.
  - `monthlyTrend(attempts, months: string[]): { yearMonth: string; closingPct: number; followUpConversionPct: number }[]` — `months` = array `'YYYY-MM'`; ogni mese calcolato con bounds derivati internamente (vedi sotto).

- [ ] **Step 1: Scrivere i test (falliscono)**

Create `src/lib/venditorePerformance/aggregate.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    reasonDistribution, topReason, followUpFunnel,
    closingStats, attemptsToClose, monthlyTrend, type AttemptInput,
} from './aggregate.ts';

const d = (s: string) => new Date(s);
const start = d('2026-06-01T00:00:00Z');
const end = d('2026-07-01T00:00:00Z');

// lead A: 3 tentativi → Non chiuso(0), Non chiuso(1), Chiuso(2)
// lead B: Non chiuso(0) e basta (follow-up aperto)
// lead C: Perso(0)
const attempts: AttemptInput[] = [
    { leadId: 'A', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-06-10T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-05T10:00:00Z') },
    { leadId: 'A', attemptNumber: 1, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-06-20T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-12T10:00:00Z') },
    { leadId: 'A', attemptNumber: 2, outcome: 'Chiuso', notClosedReason: null, nextFollowUpDate: null, closeProduct: 'gold', closeAmountEur: 2000, outcomeAt: d('2026-06-22T10:00:00Z') },
    { leadId: 'B', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Deve parlare con terzi', nextFollowUpDate: d('2026-06-25T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-15T10:00:00Z') },
    { leadId: 'C', attemptNumber: 0, outcome: 'Perso', notClosedReason: 'Non ha urgenza reale', nextFollowUpDate: null, closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-18T10:00:00Z') },
];

test('reasonDistribution conta motivi Non chiuso+Perso e calcola pct', () => {
    const dist = reasonDistribution(attempts, start, end);
    // 'Non ha soldi' x2, 'Deve parlare con terzi' x1, 'Non ha urgenza reale' x1 => tot 4
    assert.equal(dist[0].reason, 'Non ha soldi');
    assert.equal(dist[0].count, 2);
    assert.equal(dist[0].pct, 50);
    assert.equal(dist.reduce((s, r) => s + r.count, 0), 4);
});

test('topReason ritorna il motivo più frequente', () => {
    assert.deepEqual(topReason(reasonDistribution(attempts, start, end)), { reason: 'Non ha soldi', pct: 50 });
});

test('followUpFunnel: 2 lead entrati (A,B), 1 chiuso (A)', () => {
    const f = followUpFunnel(attempts, start, end);
    assert.equal(f.enteredFollowUp, 2);
    assert.equal(f.closed, 1);
    assert.equal(f.conversionPct, 50);
});

test('closingStats: 1 chiuso, 2 nonChiusi, 1 perso, fatturato 2000', () => {
    const s = closingStats(attempts, start, end);
    assert.equal(s.chiusi, 1);
    assert.equal(s.nonChiusi, 2);
    assert.equal(s.perso, 1);
    assert.equal(s.sparito, 0);
    assert.equal(s.totalEsitati, 4);
    assert.equal(s.closingPct, 25);
    assert.equal(s.fatturato, 2000);
    assert.equal(s.topProduct, 'gold');
});

test('attemptsToClose: A chiuso al 3° tentativo (attemptNumber 2)', () => {
    const a = attemptsToClose(attempts, start, end);
    assert.equal(a.avgAttempts, 3);   // attemptNumber 2 + 1
    assert.equal(a.firstShotPct, 0);
});

test('monthlyTrend produce una riga per mese richiesto', () => {
    const t = monthlyTrend(attempts, ['2026-06']);
    assert.equal(t.length, 1);
    assert.equal(t[0].yearMonth, '2026-06');
    assert.equal(t[0].closingPct, 25);
});

test('reasonDistribution vuoto → array vuoto, topReason null', () => {
    assert.deepEqual(reasonDistribution([], start, end), []);
    assert.equal(topReason([]), null);
});
```

- [ ] **Step 2: Aggiungere lo script test e verificare che fallisca**

In `package.json` scripts, aggiungere:
```json
"test": "node --import tsx --test src/lib/venditorePerformance/aggregate.test.ts src/lib/venditorePerformance/guard.test.ts"
```
(Il file `guard.test.ts` sarà creato nel Task 3; se non esiste ancora al primo run, eseguire temporaneamente solo `... --test src/lib/venditorePerformance/aggregate.test.ts`.)

Run: `node --import tsx --test src/lib/venditorePerformance/aggregate.test.ts`
Expected: FAIL — modulo `./aggregate.ts` non trovato / funzioni non definite.

- [ ] **Step 3: Implementare `aggregate.ts`**

Create `src/lib/venditorePerformance/aggregate.ts`:

```ts
export interface AttemptInput {
    leadId: string;
    attemptNumber: number;
    outcome: string;
    notClosedReason: string | null;
    nextFollowUpDate: Date | null;
    closeProduct: string | null;
    closeAmountEur: number | null;
    outcomeAt: Date;
}

const inRange = (a: AttemptInput, start: Date, end: Date) =>
    a.outcomeAt >= start && a.outcomeAt < end;

const roundPct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

export function reasonDistribution(attempts: AttemptInput[], start: Date, end: Date) {
    const scoped = attempts.filter(a =>
        inRange(a, start, end) &&
        (a.outcome === 'Non chiuso' || a.outcome === 'Perso') &&
        !!a.notClosedReason,
    );
    const counts = new Map<string, number>();
    for (const a of scoped) counts.set(a.notClosedReason!, (counts.get(a.notClosedReason!) ?? 0) + 1);
    const total = scoped.length;
    return [...counts.entries()]
        .map(([reason, count]) => ({ reason, count, pct: roundPct(count, total) }))
        .sort((x, y) => y.count - x.count || x.reason.localeCompare(y.reason, 'it'));
}

export function topReason(dist: { reason: string; pct: number }[]) {
    return dist.length ? { reason: dist[0].reason, pct: dist[0].pct } : null;
}

export function followUpFunnel(attempts: AttemptInput[], start: Date, end: Date) {
    const enteredLeads = new Set(
        attempts.filter(a => inRange(a, start, end) && a.outcome === 'Non chiuso').map(a => a.leadId),
    );
    const closedLeads = new Set(attempts.filter(a => a.outcome === 'Chiuso').map(a => a.leadId));
    let closed = 0;
    for (const id of enteredLeads) if (closedLeads.has(id)) closed++;
    return { enteredFollowUp: enteredLeads.size, closed, conversionPct: roundPct(closed, enteredLeads.size) };
}

export function closingStats(attempts: AttemptInput[], start: Date, end: Date) {
    const scoped = attempts.filter(a => inRange(a, start, end));
    const chiusi = scoped.filter(a => a.outcome === 'Chiuso');
    const nonChiusi = scoped.filter(a => a.outcome === 'Non chiuso').length;
    const perso = scoped.filter(a => a.outcome === 'Perso').length;
    const sparito = scoped.filter(a => a.outcome === 'Sparito').length;
    const totalEsitati = chiusi.length + nonChiusi + perso + sparito;
    const fatturato = chiusi.reduce((s, a) => s + (a.closeAmountEur ?? 0), 0);
    const prodCounts = new Map<string, number>();
    for (const a of chiusi) if (a.closeProduct) prodCounts.set(a.closeProduct, (prodCounts.get(a.closeProduct) ?? 0) + 1);
    const topProduct = [...prodCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return {
        chiusi: chiusi.length, nonChiusi, perso, sparito, totalEsitati,
        closingPct: roundPct(chiusi.length, totalEsitati),
        fatturato,
        ticketMedio: chiusi.length ? Math.round(fatturato / chiusi.length) : 0,
        topProduct,
    };
}

export function attemptsToClose(attempts: AttemptInput[], start: Date, end: Date) {
    const closed = attempts.filter(a => inRange(a, start, end) && a.outcome === 'Chiuso');
    if (!closed.length) return { avgAttempts: 0, firstShotPct: 0 };
    const avg = closed.reduce((s, a) => s + (a.attemptNumber + 1), 0) / closed.length;
    const firstShot = closed.filter(a => a.attemptNumber === 0).length;
    return { avgAttempts: Math.round(avg * 10) / 10, firstShotPct: roundPct(firstShot, closed.length) };
}

export function monthlyTrend(attempts: AttemptInput[], months: string[]) {
    return months.map(ym => {
        const [y, m] = ym.split('-').map(Number);
        const start = new Date(Date.UTC(y, m - 1, 1));
        const end = new Date(Date.UTC(y, m, 1));
        const cs = closingStats(attempts, start, end);
        const ff = followUpFunnel(attempts, start, end);
        return { yearMonth: ym, closingPct: cs.closingPct, followUpConversionPct: ff.conversionPct };
    });
}
```

Nota: i bounds in `monthlyTrend` usano UTC per determinismo del test. In produzione i mesi passati sono chiusi, quindi lo sfasamento Rome/UTC di 1-2 ore ai bordi è trascurabile per un trend mensile; il periodo "corrente" nella action usa comunque `monthBoundsRome`.

- [ ] **Step 4: Eseguire i test — devono passare**

Run: `node --import tsx --test src/lib/venditorePerformance/aggregate.test.ts`
Expected: PASS (tutti i test verdi).

- [ ] **Step 5: Commit**

```bash
git add src/lib/venditorePerformance/aggregate.ts src/lib/venditorePerformance/aggregate.test.ts package.json
git commit -m "feat(venditori): libreria aggregazione performance + test node:test"
```

---

## Task 3: Ciclo di vita — follow-up obbligatorio, tetto, esito `Perso`

**Files:**
- Create: `src/lib/venditorePerformance/guard.ts`
- Create: `src/lib/venditorePerformance/guard.test.ts`
- Modify: `src/lib/surveys/questions.ts` (esporta reasons)
- Modify: `src/app/actions/venditoreActions.ts` (`saveVenditoreOutcome`, `getVenditoreAppointments`)
- Modify: `src/app/actions/kpiVenditoriActions.ts` (conteggio `Perso`)
- Modify: `src/components/VenditoreDrawer.tsx` (UI)

**Interfaces:**
- Consumes: tabella `salesAttempts` (Task 1).
- Produces:
  - `NOT_CLOSED_REASONS: readonly string[]` e `type NotClosedReason` da `@/lib/surveys/questions`.
  - `validateOutcomeTransition(input: { outcome: string; nextFollowUpDate: Date | null; priorNonClosedCount: number }): { ok: true } | { ok: false; error: string }` da `@/lib/venditorePerformance/guard`.
  - `saveVenditoreOutcome` payload esteso con `nextFollowUpDate?: Date | null` e `outcome` che accetta anche `'Perso'`.
  - `getVenditoreAppointments` righe con nuovi campi `attemptCount: number`, `priorNonClosedCount: number`, `nextFollowUpDate: Date | null`.

- [ ] **Step 1: Centralizzare i reasons in `questions.ts`**

In `src/lib/surveys/questions.ts`, nella sezione `// ========== SALES ==========` (dopo `SALES_PRICE_REACTION_OPTIONS`, ~riga 225), aggiungere:

```ts
// Motivi di non chiusura del venditore (label === valore salvato in DB).
export const NOT_CLOSED_REASONS = [
    'Non ha soldi',
    'Deve parlare con terzi',
    'Valuta altri percorsi',
    'Non ha urgenza reale',
    'Non vuole decidere in call',
    'Troppo spaventato',
    'Fa già altri corsi',
    'Event imminente che lo blocca',
] as const;
export type NotClosedReason = typeof NOT_CLOSED_REASONS[number];
```

- [ ] **Step 2: Scrivere il test della guardia (fallisce)**

Create `src/lib/venditorePerformance/guard.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutcomeTransition } from './guard.ts';

test('Non chiuso senza follow-up → errore', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: null, priorNonClosedCount: 0 });
    assert.equal(r.ok, false);
});

test('Non chiuso con follow-up valido → ok', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: new Date('2026-07-10T09:00:00Z'), priorNonClosedCount: 1 });
    assert.equal(r.ok, true);
});

test('Non chiuso al 4° tentativo (tetto 3) → errore', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: new Date('2026-07-10T09:00:00Z'), priorNonClosedCount: 3 });
    assert.equal(r.ok, false);
});

test('Chiuso non richiede follow-up → ok', () => {
    const r = validateOutcomeTransition({ outcome: 'Chiuso', nextFollowUpDate: null, priorNonClosedCount: 3 });
    assert.equal(r.ok, true);
});

test('Perso è un esito terminale valido senza follow-up', () => {
    const r = validateOutcomeTransition({ outcome: 'Perso', nextFollowUpDate: null, priorNonClosedCount: 2 });
    assert.equal(r.ok, true);
});
```

Run: `node --import tsx --test src/lib/venditorePerformance/guard.test.ts`
Expected: FAIL — `./guard.ts` non trovato.

- [ ] **Step 3: Implementare `guard.ts`**

Create `src/lib/venditorePerformance/guard.ts`:

```ts
export const MAX_FOLLOW_UPS = 3;

// Regole (solo ruolo VENDITORE; MANAGER/ADMIN esenti a monte):
// - 'Non chiuso' richiede una data di follow-up e non è ammesso oltre il tetto.
// - 'Chiuso' | 'Perso' | 'Sparito' sono terminali, nessun follow-up richiesto.
export function validateOutcomeTransition(input: {
    outcome: string;
    nextFollowUpDate: Date | null;
    priorNonClosedCount: number;
}): { ok: true } | { ok: false; error: string } {
    if (input.outcome === 'Non chiuso') {
        if (input.priorNonClosedCount >= MAX_FOLLOW_UPS) {
            return { ok: false, error: `Raggiunto il numero massimo di follow-up (${MAX_FOLLOW_UPS}). Registra un esito definitivo: Chiuso o Perso.` };
        }
        if (!(input.nextFollowUpDate instanceof Date) || isNaN(input.nextFollowUpDate.getTime())) {
            return { ok: false, error: 'Dopo un "Non chiuso" devi impostare la data del prossimo follow-up.' };
        }
    }
    return { ok: true };
}
```

Run: `node --import tsx --test src/lib/venditorePerformance/guard.test.ts`
Expected: PASS.

- [ ] **Step 4: Estendere `getVenditoreAppointments` con conteggi attempt**

In `src/app/actions/venditoreActions.ts`, importare `salesAttempts` e `sql` (già importato `sql`). Aggiungere `salesAttempts` all'import da `@/db/schema` (riga 6). Dopo aver ottenuto `assignedLeads` (riga 50), calcolare i conteggi per lead e arricchire le righe. Sostituire il `return assignedLeads.map(...)` finale (righe 57-60) con:

```ts
    // Conteggi tentativi per lead (per tetto follow-up e ciclo).
    const leadIds = assignedLeads.map(l => l.id);
    const attemptRows = leadIds.length
        ? await db.select({
            leadId: salesAttempts.leadId,
            outcome: salesAttempts.outcome,
            nextFollowUpDate: salesAttempts.nextFollowUpDate,
            createdAt: salesAttempts.createdAt,
        }).from(salesAttempts).where(and(
            eq(salesAttempts.companyId, ctx.companyId),
            eq(salesAttempts.salesUserId, sellerId),
        ))
        : [];

    const byLead = new Map<string, { attemptCount: number; priorNonClosedCount: number; nextFollowUpDate: Date | null; lastAt: number }>();
    for (const r of attemptRows) {
        const cur = byLead.get(r.leadId) ?? { attemptCount: 0, priorNonClosedCount: 0, nextFollowUpDate: null, lastAt: 0 };
        cur.attemptCount += 1;
        if (r.outcome === 'Non chiuso') cur.priorNonClosedCount += 1;
        const ts = r.createdAt ? new Date(r.createdAt).getTime() : 0;
        if (ts >= cur.lastAt) { cur.lastAt = ts; cur.nextFollowUpDate = r.outcome === 'Non chiuso' ? r.nextFollowUpDate : null; }
        byLead.set(r.leadId, cur);
    }

    return assignedLeads.map(r => {
        const agg = byLead.get(r.id);
        return {
            ...r,
            phone: r.negotiationStartedAt ? r.phone : null,
            attemptCount: agg?.attemptCount ?? 0,
            priorNonClosedCount: agg?.priorNonClosedCount ?? 0,
            nextFollowUpDate: agg?.nextFollowUpDate ?? null,
        };
    })
```

- [ ] **Step 5: Guardie + insert attempt in `saveVenditoreOutcome`**

In `src/app/actions/venditoreActions.ts`:

(a) Estendere il tipo payload (righe 64-78): aggiungere `nextFollowUpDate?: Date | null` e aggiornare il commento di `outcome` a `"Chiuso" | "Non chiuso" | "Perso" | "Sparito"`.

(b) Importare in cima: `import { validateOutcomeTransition } from "@/lib/venditorePerformance/guard"` e assicurarsi che `salesAttempts` sia importato da `@/db/schema`.

(c) Dopo la GUARDIA 2 (dopo riga 119, prima dell'`update`), calcolare i tentativi pregressi e applicare la guardia transizione (solo per non-staff):

```ts
    // Conteggio tentativi pregressi sul lead (per attemptNumber e tetto follow-up).
    const priorAttempts = await db.select({ outcome: salesAttempts.outcome })
        .from(salesAttempts)
        .where(and(eq(salesAttempts.companyId, ctx.companyId), eq(salesAttempts.leadId, leadId)));
    const attemptNumber = priorAttempts.length;
    const priorNonClosedCount = priorAttempts.filter(a => a.outcome === 'Non chiuso').length;

    // GUARDIA 3: follow-up obbligatorio dopo "Non chiuso" + tetto a 3 (solo VENDITORE).
    if (!isStaff) {
        const check = validateOutcomeTransition({
            outcome: payload.outcome,
            nextFollowUpDate: payload.nextFollowUpDate ?? null,
            priorNonClosedCount,
        });
        if (!check.ok) return { success: false, error: check.error };
    }
```

(d) Nell'`update` di `leads` (righe 121-138), sostituire l'assegnazione dei follow-up per riflettere il ciclo (il follow-up pendente corrente va in `followUp1Date`, si azzera su esiti terminali):

```ts
            notClosedReason: payload.notClosedReason || null,
            followUp1Date: payload.outcome === 'Non chiuso' ? (payload.nextFollowUpDate || null) : null,
            followUp2Date: null,
```

(e) Dopo l'update riuscito (dopo riga 142, il blocco `if (updated.length === 0)`), inserire la riga attempt:

```ts
    // Storia: registra questo tentativo/esito.
    const effectiveOutcomeAt = payload.outcomeAt instanceof Date && !isNaN(payload.outcomeAt.getTime()) ? payload.outcomeAt : new Date();
    await db.insert(salesAttempts).values({
        id: crypto.randomUUID(),
        leadId,
        salesUserId: oldLead.salespersonUserId ?? session.user.id,
        attemptNumber,
        outcome: payload.outcome,
        notClosedReason: payload.notClosedReason || null,
        nextFollowUpDate: payload.outcome === 'Non chiuso' ? (payload.nextFollowUpDate || null) : null,
        closeProduct: payload.closeProduct || null,
        closeAmountEur: payload.closeAmountEur || null,
        outcomeAt: effectiveOutcomeAt,
        companyId: ctx.companyId,
    });
```

(f) Nel `leadEvents.insert` (riga 156-164), aggiungere `attemptNumber` al metadata: cambiare `metadata: payload,` in `metadata: { ...payload, attemptNumber },`.

- [ ] **Step 6: Contare `Perso` negli esitati in `kpiVenditoriActions.ts`**

In `src/app/actions/kpiVenditoriActions.ts`, dentro il `.map` (righe 88-92), aggiungere il conteggio `perso` e includerlo in `totalEsitati`:

```ts
        const chiusi = vOutcomes.filter(o => o.outcome === 'Chiuso').length
        const nonChiusi = vOutcomes.filter(o => o.outcome === 'Non chiuso').length
        const sparito = vOutcomes.filter(o => o.outcome === 'Sparito').length
        const perso = vOutcomes.filter(o => o.outcome === 'Perso').length

        const totalEsitati = chiusi + nonChiusi + sparito + perso
```

Aggiungere `perso` all'oggetto ritornato (dopo `sparito,` a riga 104): `perso,`. (I consumatori esistenti ignorano il campo extra; nessuna rottura.)

- [ ] **Step 7: UI drawer — `Perso`, follow-up obbligatorio, tetto**

In `src/components/VenditoreDrawer.tsx`:

(a) Rimuovere l'array locale `NOT_CLOSED_REASONS` (righe 22-31) e importarlo: nel blocco import in cima aggiungere `NOT_CLOSED_REASONS` all'import esistente da `@/lib/surveys/questions` (riga 11): `import { EXCLUDED_FUNNEL, NOT_CLOSED_REASONS } from "@/lib/surveys/questions"`.

(b) Stato: sostituire i due follow-up con uno solo. Rimuovere `followUp2Date` (riga 52) e `canAddFollowUp` (riga 93). Rinominare `followUp1Date` in `nextFollowUpDate`:
```ts
    const [nextFollowUpDate, setNextFollowUpDate] = useState(lead?.nextFollowUpDate ? toRomeDatetimeLocal(new Date(lead.nextFollowUpDate)) : "")
```

(c) Calcolo tetto e opzioni esito. Dopo `isStarted` (riga 36) aggiungere:
```ts
    const priorNonClosedCount = lead?.priorNonClosedCount ?? 0
    const followUpCapReached = priorNonClosedCount >= 3
    const OUTCOME_OPTIONS = followUpCapReached ? ["Chiuso", "Perso", "Sparito"] : ["Chiuso", "Non chiuso", "Perso", "Sparito"]
```

(d) Validazione `handleSave` (righe 104-107): sostituire il check follow-up e aggiungere l'obbligo:
```ts
        if (outcome === "Non chiuso" && !notClosedReason) {
            alert("Seleziona una motivazione valida per cui la vendita non è chiusa.")
            return
        }
        if (outcome === "Non chiuso" && !nextFollowUpDate) {
            alert("Dopo un \"Non chiuso\" devi impostare la data del prossimo follow-up.")
            return
        }
```

(e) Payload `saveVenditoreOutcome` (righe 129-140): sostituire le righe `followUp1Date`/`followUp2Date` con:
```ts
                notClosedReason: outcome === "Non chiuso" ? notClosedReason : undefined,
                nextFollowUpDate: outcome === "Non chiuso" && nextFollowUpDate ? parseRomeDatetimeLocal(nextFollowUpDate) : null,
```

(f) Selettore esito (righe 289-305): la mappa `["Chiuso", "Non chiuso", "Sparito"]` diventa `OUTCOME_OPTIONS`, e la griglia da `sm:grid-cols-3` a `sm:grid-cols-4`. Aggiungere lo stile per `Perso` nella logica colore (accanto agli altri):
```tsx
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            {OUTCOME_OPTIONS.map(o => (
                                <button
                                    key={o}
                                    onClick={() => setOutcome(o)}
                                    className={`px-4 py-3 border rounded-lg font-medium text-sm transition-all text-center
                                    ${outcome === o
                                            ? (o === 'Chiuso' ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500' :
                                                o === 'Non chiuso' ? 'bg-orange-50 border-orange-500 text-orange-700 ring-1 ring-orange-500' :
                                                o === 'Perso' ? 'bg-red-50 border-red-500 text-red-700 ring-1 ring-red-500' :
                                                    'bg-gray-100 border-gray-500 text-gray-700 ring-1 ring-gray-500')
                                            : 'bg-white border-gray-200 text-gray-500 hover:border-brand-orange hover:bg-orange-50/30'
                                        }`}
                                >
                                    {o}
                                </button>
                            ))}
                        </div>
```

(g) Blocco "Non chiuso" (righe 356-406): il follow-up diventa singolo e obbligatorio. Sostituire il sotto-blocco follow-up (righe 372-403) con:
```tsx
                            <div className="pt-4 border-t border-orange-200">
                                <h4 className="text-sm font-bold text-orange-900 mb-1">Prossimo follow-up *</h4>
                                <p className="text-xs text-orange-700 mb-3">Obbligatorio: fissa quando ricontattare il lead. Verrà mostrato nella tua tab "Follow-up".</p>
                                <input
                                    type="datetime-local"
                                    value={nextFollowUpDate}
                                    onChange={e => setNextFollowUpDate(e.target.value)}
                                    className="input-fenice text-sm !border-orange-200 !p-1.5 w-full"
                                />
                            </div>
```

(h) Aggiungere un blocco informativo per `Perso` (dopo il blocco "Sparito", riga 414):
```tsx
                    {outcome === "Perso" && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-4 animate-fade-in">
                            <div>
                                <label className="block text-sm font-medium text-red-900 mb-1">Motivazione *</label>
                                <select
                                    value={notClosedReason}
                                    onChange={e => setNotClosedReason(e.target.value)}
                                    className="input-fenice text-sm !border-red-200"
                                >
                                    <option value="" disabled>Seleziona un motivo...</option>
                                    {NOT_CLOSED_REASONS.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-xs text-red-700">Esito definitivo: il lead è perso e non verranno richiesti altri follow-up.</p>
                        </div>
                    )}
```

(i) `Perso` richiede motivo: nella validazione `handleSave`, estendere il check motivo a `Perso`:
```ts
        if ((outcome === "Non chiuso" || outcome === "Perso") && !notClosedReason) {
            alert("Seleziona una motivazione valida.")
            return
        }
```
(sostituisce il check al punto (d) `outcome === "Non chiuso" && !notClosedReason`). E nel payload passare il motivo anche per `Perso`:
```ts
                notClosedReason: (outcome === "Non chiuso" || outcome === "Perso") ? notClosedReason : undefined,
```

- [ ] **Step 8: Verifica build + lint + test**

Run: `npx tsc --noEmit`
Expected: nessun nuovo errore.
Run: `npm run test`
Expected: PASS (aggregate + guard).
Run: `npm run lint`
Expected: nessun nuovo problema oltre la baseline nota (~5700 preesistenti).

- [ ] **Step 9: Commit**

```bash
git add src/lib/surveys/questions.ts src/lib/venditorePerformance/guard.ts src/lib/venditorePerformance/guard.test.ts src/app/actions/venditoreActions.ts src/app/actions/kpiVenditoriActions.ts src/components/VenditoreDrawer.tsx
git commit -m "feat(venditori): ciclo esiti tracciato, follow-up obbligatorio + tetto 3, esito Perso"
```

---

## Task 4: Tab "Follow-up" nella dashboard venditore

**Files:**
- Modify: `src/app/actions/venditoreActions.ts` (nuova `getVenditoreFollowUps`)
- Modify: `src/components/VenditoreDashboardClient.tsx` (nuova vista)

**Interfaces:**
- Consumes: `salesAttempts`, `getVenditoreAppointments` shape (per riusare `VenditoreDrawer`).
- Produces: `getVenditoreFollowUps(sellerId: string): Promise<FollowUpLead[]>` dove `FollowUpLead` è la stessa forma di riga di `getVenditoreAppointments` con in più `nextFollowUpDate: Date` (garantito non nullo) e `bucket: 'overdue' | 'today' | 'upcoming'`.

- [ ] **Step 1: Implementare `getVenditoreFollowUps`**

In `src/app/actions/venditoreActions.ts`, aggiungere (usa `dayBoundsRome` — importarlo da `@/lib/dateUtils`):

```ts
export async function getVenditoreFollowUps(sellerId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    // Lead il cui ULTIMO tentativo è 'Non chiuso' → hanno un follow-up pendente.
    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
        funnel: leads.funnel,
        appointmentDate: leads.appointmentDate,
        appointmentNote: leads.appointmentNote,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeNotes: leads.salespersonOutcomeNotes,
        notClosedReason: leads.notClosedReason,
        negotiationStartedAt: leads.negotiationStartedAt,
        version: leads.version,
        closeProduct: leads.closeProduct,
        closeAmountEur: leads.closeAmountEur,
        gdoUserId: leads.assignedToId,
        gdoName: users.displayName,
        gdoCode: users.gdoCode,
    })
        .from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, sellerId),
            eq(leads.salespersonOutcome, 'Non chiuso'),
            isNotNull(leads.followUp1Date),
        ))

    // attempt aggregati per attemptCount/priorNonClosedCount/nextFollowUpDate
    const attemptRows = await db.select({
        leadId: salesAttempts.leadId,
        outcome: salesAttempts.outcome,
        nextFollowUpDate: salesAttempts.nextFollowUpDate,
        createdAt: salesAttempts.createdAt,
    }).from(salesAttempts).where(and(
        eq(salesAttempts.companyId, ctx.companyId),
        eq(salesAttempts.salesUserId, sellerId),
    ))

    const agg = new Map<string, { attemptCount: number; priorNonClosedCount: number; nextFollowUpDate: Date | null; lastAt: number }>()
    for (const r of attemptRows) {
        const cur = agg.get(r.leadId) ?? { attemptCount: 0, priorNonClosedCount: 0, nextFollowUpDate: null, lastAt: 0 }
        cur.attemptCount += 1
        if (r.outcome === 'Non chiuso') cur.priorNonClosedCount += 1
        const ts = r.createdAt ? new Date(r.createdAt).getTime() : 0
        if (ts >= cur.lastAt) { cur.lastAt = ts; cur.nextFollowUpDate = r.outcome === 'Non chiuso' ? r.nextFollowUpDate : null }
        agg.set(r.leadId, cur)
    }

    const now = new Date()
    const { start: todayStart, end: todayEnd } = dayBoundsRome(now)

    const result = rows
        .map(r => {
            const a = agg.get(r.id)
            const fu = a?.nextFollowUpDate ?? null
            return {
                ...r,
                phone: r.negotiationStartedAt ? r.phone : null,
                attemptCount: a?.attemptCount ?? 0,
                priorNonClosedCount: a?.priorNonClosedCount ?? 0,
                nextFollowUpDate: fu,
                bucket: !fu ? 'upcoming' : (fu < todayStart ? 'overdue' : (fu < todayEnd ? 'today' : 'upcoming')) as 'overdue' | 'today' | 'upcoming',
            }
        })
        .filter(r => r.nextFollowUpDate) // solo con follow-up pendente reale
        .sort((x, y) => (x.nextFollowUpDate!.getTime() - y.nextFollowUpDate!.getTime()))

    return result
}
```

Verificare che `isNotNull` e `dayBoundsRome` siano importati (aggiungere agli import esistenti se mancano: `isNotNull` da `drizzle-orm`, `dayBoundsRome` da `@/lib/dateUtils`).

- [ ] **Step 2: Aggiungere la vista "Follow-up" al client**

In `src/components/VenditoreDashboardClient.tsx`:

(a) Import: aggiungere `getVenditoreFollowUps` all'import da `@/app/actions/venditoreActions` (riga 4) e l'icona `Bell` a lucide-react (riga 5).

(b) Stato: estendere il tipo `view` (riga 23) e aggiungere stato follow-up:
```ts
    const [view, setView] = useState<'LISTA' | 'FOLLOWUP' | 'AGENDA' | 'CLASSIFICA'>('LISTA')
    const [followUps, setFollowUps] = useState<any[]>([])
```

(c) Caricare i follow-up quando si apre la tab. Aggiungere dopo l'effetto che carica gli appuntamenti un effetto:
```ts
    useEffect(() => {
        if (view !== 'FOLLOWUP') return
        let alive = true
        getVenditoreFollowUps(sellerId).then(r => { if (alive) setFollowUps(r) })
        return () => { alive = false }
    }, [view, sellerId])
```
Il conteggio scaduti per il badge:
```ts
    const overdueCount = followUps.filter(f => f.bucket === 'overdue').length
```
(Per popolare il badge anche quando la tab non è attiva, caricare i follow-up una volta al mount: aggiungere `getVenditoreFollowUps(sellerId).then(setFollowUps)` all'effetto di init esistente accanto al caricamento appuntamenti.)

(d) Toggle tab: nel gruppo di bottoni vista (righe ~161-183) aggiungere un bottone tra LISTA e AGENDA. Seguire lo stile dei bottoni esistenti; esempio:
```tsx
                <button
                    onClick={() => setView('FOLLOWUP')}
                    className={`relative inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === 'FOLLOWUP' ? 'bg-brand-orange text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                    <Bell className="h-4 w-4" /> Follow-up
                    {overdueCount > 0 && (
                        <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-red-600 text-white text-xs font-bold">{overdueCount}</span>
                    )}
                </button>
```
(Adattare le classi a quelle effettivamente usate dagli altri bottoni vista nel file.)

(e) Corpo vista: dopo il blocco della vista `AGENDA`, aggiungere il render condizionale `view === 'FOLLOWUP'`:
```tsx
                {view === 'FOLLOWUP' && (
                    <div className="space-y-6">
                        {['overdue', 'today', 'upcoming'].map(bucket => {
                            const items = followUps.filter(f => f.bucket === bucket)
                            if (!items.length) return null
                            const label = bucket === 'overdue' ? 'Scaduti' : bucket === 'today' ? 'Oggi' : 'Prossimi'
                            const color = bucket === 'overdue' ? 'text-red-600' : bucket === 'today' ? 'text-amber-600' : 'text-gray-600'
                            return (
                                <div key={bucket}>
                                    <h3 className={`text-sm font-bold uppercase tracking-wider mb-2 ${color}`}>{label} ({items.length})</h3>
                                    <div className="space-y-2">
                                        {items.map(f => (
                                            <button
                                                key={f.id}
                                                onClick={() => setSelectedLead(f)}
                                                className="w-full text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-brand-orange transition-colors flex items-center justify-between"
                                            >
                                                <div>
                                                    <div className="font-semibold text-gray-900">{f.name}</div>
                                                    <div className="text-xs text-gray-500">{f.funnel || 'Sconosciuto'} · Follow-up: {format(new Date(f.nextFollowUpDate), "dd MMM yyyy - HH:mm", { locale: it })}</div>
                                                </div>
                                                <div className="text-xs text-gray-400">Tentativi: {f.attemptCount}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                        {followUps.length === 0 && (
                            <div className="text-center text-gray-400 py-12">Nessun follow-up in sospeso 🎉</div>
                        )}
                    </div>
                )}
```

(f) Al salvataggio dell'esito (callback `onSaved` del drawer), ricaricare anche i follow-up: nell'handler che chiude il drawer dopo il salvataggio, aggiungere `getVenditoreFollowUps(sellerId).then(setFollowUps)` accanto al refetch appuntamenti esistente.

- [ ] **Step 3: Verifica build**

Run: `npx tsc --noEmit`
Expected: nessun nuovo errore.
Run: `npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/venditoreActions.ts src/components/VenditoreDashboardClient.tsx
git commit -m "feat(venditori): tab Follow-up con richiami dovuti (scaduti/oggi/prossimi)"
```

---

## Task 5: Analytics — action `getVenditorePerformance` + vista condivisa

**Files:**
- Create: `src/app/actions/venditorePerformanceActions.ts`
- Create: `src/components/venditore-performance/VenditorePerformanceView.tsx`
- Modify: `src/components/VenditoreDashboardClient.tsx` (tab "Performance")

**Interfaces:**
- Consumes: aggregatori da `@/lib/venditorePerformance/aggregate`, `salesAttempts`.
- Produces:
  - `getVenditorePerformance(input: { salesUserId: string; yearMonth: string }): Promise<VenditorePerformanceData>` con:
    ```ts
    interface VenditorePerformanceData {
        yearMonth: string;
        reasonDistribution: { reason: string; count: number; pct: number }[];
        topReason: { reason: string; pct: number } | null;
        followUpFunnel: { enteredFollowUp: number; closed: number; conversionPct: number };
        closing: { chiusi: number; nonChiusi: number; perso: number; sparito: number; totalEsitati: number; closingPct: number; fatturato: number; ticketMedio: number; topProduct: string | null };
        attemptsToClose: { avgAttempts: number; firstShotPct: number };
        overdueFollowUps: number;
        trend: { yearMonth: string; closingPct: number; followUpConversionPct: number }[];
    }
    ```
  - Componente `VenditorePerformanceView({ data }: { data: VenditorePerformanceData })`.

- [ ] **Step 1: Implementare la server action**

Create `src/app/actions/venditorePerformanceActions.ts`:

```ts
"use server"

import { db } from "@/db"
import { salesAttempts } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { monthBoundsRome } from "@/lib/dateUtils"
import {
    reasonDistribution, topReason, followUpFunnel, closingStats,
    attemptsToClose, monthlyTrend, type AttemptInput,
} from "@/lib/venditorePerformance/aggregate"

// Ultimi N mesi (incluso quello passato) come 'YYYY-MM', ordine cronologico.
function lastMonths(yearMonth: string, n: number): string[] {
    const [y, m] = yearMonth.split('-').map(Number)
    const out: string[] = []
    for (let i = n - 1; i >= 0; i--) {
        const dt = new Date(Date.UTC(y, m - 1 - i, 1))
        out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    return out
}

export async function getVenditorePerformance(input: { salesUserId: string; yearMonth: string }) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const rows = await db.select({
        leadId: salesAttempts.leadId,
        attemptNumber: salesAttempts.attemptNumber,
        outcome: salesAttempts.outcome,
        notClosedReason: salesAttempts.notClosedReason,
        nextFollowUpDate: salesAttempts.nextFollowUpDate,
        closeProduct: salesAttempts.closeProduct,
        closeAmountEur: salesAttempts.closeAmountEur,
        outcomeAt: salesAttempts.outcomeAt,
    }).from(salesAttempts).where(and(
        companyScope(ctx, salesAttempts.companyId),
        eq(salesAttempts.salesUserId, input.salesUserId),
    ))

    const attempts: AttemptInput[] = rows.map(r => ({
        leadId: r.leadId,
        attemptNumber: r.attemptNumber,
        outcome: r.outcome,
        notClosedReason: r.notClosedReason,
        nextFollowUpDate: r.nextFollowUpDate ? new Date(r.nextFollowUpDate) : null,
        closeProduct: r.closeProduct,
        closeAmountEur: r.closeAmountEur,
        outcomeAt: new Date(r.outcomeAt),
    }))

    const { start, end } = monthBoundsRome(input.yearMonth)
    const dist = reasonDistribution(attempts, start, end)

    // Follow-up scaduti "adesso": ultimo attempt del lead è 'Non chiuso' con data < now.
    const now = new Date()
    const lastByLead = new Map<string, AttemptInput>()
    for (const a of attempts) {
        const cur = lastByLead.get(a.leadId)
        if (!cur || a.outcomeAt >= cur.outcomeAt) lastByLead.set(a.leadId, a)
    }
    let overdueFollowUps = 0
    for (const a of lastByLead.values()) {
        if (a.outcome === 'Non chiuso' && a.nextFollowUpDate && a.nextFollowUpDate < now) overdueFollowUps++
    }

    return {
        yearMonth: input.yearMonth,
        reasonDistribution: dist,
        topReason: topReason(dist),
        followUpFunnel: followUpFunnel(attempts, start, end),
        closing: closingStats(attempts, start, end),
        attemptsToClose: attemptsToClose(attempts, start, end),
        overdueFollowUps,
        trend: monthlyTrend(attempts, lastMonths(input.yearMonth, 6)),
    }
}
```

- [ ] **Step 2: Implementare il componente vista condiviso**

Create `src/components/venditore-performance/VenditorePerformanceView.tsx`. Usa recharts (già in deps) per la barra dei motivi e il trend. `"use client"`.

```tsx
"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts"

interface Data {
    yearMonth: string
    reasonDistribution: { reason: string; count: number; pct: number }[]
    topReason: { reason: string; pct: number } | null
    followUpFunnel: { enteredFollowUp: number; closed: number; conversionPct: number }
    closing: { chiusi: number; nonChiusi: number; perso: number; sparito: number; totalEsitati: number; closingPct: number; fatturato: number; ticketMedio: number; topProduct: string | null }
    attemptsToClose: { avgAttempts: number; firstShotPct: number }
    overdueFollowUps: number
    trend: { yearMonth: string; closingPct: number; followUpConversionPct: number }[]
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
    )
}

export function VenditorePerformanceView({ data }: { data: Data }) {
    const { closing: c, followUpFunnel: f, attemptsToClose: a } = data
    return (
        <div className="space-y-6">
            {/* KPI principali */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Closing rate" value={`${c.closingPct}%`} sub={`${c.chiusi}/${c.totalEsitati} esitati`} />
                <Kpi label="Fatturato" value={`€${c.fatturato.toLocaleString('it-IT')}`} sub={`Ticket medio €${c.ticketMedio.toLocaleString('it-IT')}`} />
                <Kpi label="Conversione follow-up" value={`${f.conversionPct}%`} sub={`${f.closed}/${f.enteredFollowUp} chiusi da richiamo`} />
                <Kpi label="Tentativi medi a chiusura" value={`${a.avgAttempts}`} sub={`${a.firstShotPct}% chiusi al 1° colpo`} />
            </div>

            {/* Follow-up: lead entrati / chiusi / scaduti */}
            <div className="grid grid-cols-3 gap-3">
                <Kpi label="Lead a follow-up" value={`${f.enteredFollowUp}`} />
                <Kpi label="Chiusi da follow-up" value={`${f.closed}`} />
                <Kpi label="Follow-up scaduti (ora)" value={`${data.overdueFollowUps}`} sub="da lavorare" />
            </div>

            {/* Motivo top */}
            {data.topReason && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                    <div className="text-xs font-semibold text-orange-700 uppercase tracking-wider">Obiezione più frequente</div>
                    <div className="text-lg font-bold text-orange-900 mt-1">{data.topReason.reason} <span className="text-orange-600">({data.topReason.pct}%)</span></div>
                </div>
            )}

            {/* Distribuzione motivi */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Motivi di non chiusura</h3>
                {data.reasonDistribution.length ? (
                    <ResponsiveContainer width="100%" height={Math.max(160, data.reasonDistribution.length * 40)}>
                        <BarChart data={data.reasonDistribution} layout="vertical" margin={{ left: 40, right: 20 }}>
                            <XAxis type="number" hide />
                            <YAxis type="category" dataKey="reason" width={180} tick={{ fontSize: 12 }} />
                            <Tooltip formatter={(v: number, _n, p: any) => [`${v} (${p.payload.pct}%)`, 'Conteggio']} />
                            <Bar dataKey="count" fill="#f97316" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="text-sm text-gray-400 py-6 text-center">Nessun dato nel periodo.</div>
                )}
            </div>

            {/* Trend mensile */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Trend (ultimi 6 mesi)</h3>
                <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data.trend} margin={{ left: 0, right: 20 }}>
                        <XAxis dataKey="yearMonth" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} unit="%" />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="closingPct" name="Closing %" stroke="#16a34a" strokeWidth={2} />
                        <Line type="monotone" dataKey="followUpConversionPct" name="Conv. follow-up %" stroke="#f97316" strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
```

- [ ] **Step 3: Aggiungere la tab "Performance" al client venditore**

In `src/components/VenditoreDashboardClient.tsx`:

(a) Import: `getVenditorePerformance` da `@/app/actions/venditorePerformanceActions`, `VenditorePerformanceView` da `@/components/venditore-performance/VenditorePerformanceView`, `currentYearMonthRome` da `@/lib/workingDaysUtils`, icona `BarChart3` da lucide-react.

(b) Estendere `view` a includere `'PERFORMANCE'`. Stato:
```ts
    const [perfMonth, setPerfMonth] = useState<string>(() => currentYearMonthRome())
    const [perfData, setPerfData] = useState<any>(null)
```

(c) Effetto di caricamento:
```ts
    useEffect(() => {
        if (view !== 'PERFORMANCE') return
        let alive = true
        setPerfData(null)
        getVenditorePerformance({ salesUserId: sellerId, yearMonth: perfMonth }).then(d => { if (alive) setPerfData(d) })
        return () => { alive = false }
    }, [view, sellerId, perfMonth])
```

(d) Bottone tab "Performance" (accanto a Classifica), stesso stile:
```tsx
                <button
                    onClick={() => setView('PERFORMANCE')}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === 'PERFORMANCE' ? 'bg-brand-orange text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                    <BarChart3 className="h-4 w-4" /> Performance
                </button>
```

(e) Corpo vista con selettore mese (ultimi 12 mesi, pattern esistente):
```tsx
                {view === 'PERFORMANCE' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-gray-600">Mese:</label>
                            <select value={perfMonth} onChange={e => setPerfMonth(e.target.value)} className="input-fenice text-sm w-auto">
                                {Array.from({ length: 12 }).map((_, i) => {
                                    const now = new Date()
                                    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
                                    const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
                                    return <option key={ym} value={ym}>{ym}</option>
                                })}
                            </select>
                        </div>
                        {perfData ? <VenditorePerformanceView data={perfData} /> : <div className="text-center text-gray-400 py-12">Caricamento…</div>}
                    </div>
                )}
```

- [ ] **Step 4: Verifica build**

Run: `npx tsc --noEmit` → nessun nuovo errore.
Run: `npm run build` → OK.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/venditorePerformanceActions.ts src/components/venditore-performance/VenditorePerformanceView.tsx src/components/VenditoreDashboardClient.tsx
git commit -m "feat(venditori): analytics performance (action + vista) e tab Performance"
```

---

## Task 6: Focus della settimana (banner venditore + azioni)

**Files:**
- Modify: `src/lib/workingDaysUtils.ts` (`currentWeekStartRome`)
- Create: `src/app/actions/salesWeeklyFocusActions.ts`
- Create: `src/components/venditore-performance/WeeklyFocusBanner.tsx`
- Modify: `src/components/VenditoreDashboardClient.tsx` (montare il banner)

**Interfaces:**
- Consumes: `salesWeeklyFocus`, `NOT_CLOSED_REASONS`.
- Produces:
  - `currentWeekStartRome(d?: Date): string` — 'YYYY-MM-DD' del lunedì (Rome).
  - `getSalesWeeklyFocus(salesUserId: string, weekStart?: string): Promise<{ objection: string | null; taskNote: string; weekStart: string } | null>`
  - `setSalesWeeklyFocus(input: { salesUserId: string; weekStart: string; objection: string | null; taskNote: string }): Promise<{ success: boolean; error?: string }>` — solo MANAGER/ADMIN.
  - `listVenditori(): Promise<{ id: string; name: string }[]>` — venditori company-scoped (per Task 7).
  - Componente `WeeklyFocusBanner({ salesUserId }: { salesUserId: string })`.

- [ ] **Step 1: Helper `currentWeekStartRome`**

In `src/lib/workingDaysUtils.ts`, aggiungere (riusa lo stesso trucco `en-CA` di `currentYearMonthRome`, e `weekBoundsRome` da dateUtils per il lunedì):

```ts
import { weekBoundsRome } from "@/lib/dateUtils"

// 'YYYY-MM-DD' del lunedì della settimana corrente in Europe/Rome.
export function currentWeekStartRome(d: Date = new Date()): string {
    const monday = weekBoundsRome(d).start // atteso: lunedì 00:00 Rome
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
    return fmt.format(monday) // en-CA → 'YYYY-MM-DD'
}
```
Verificare che `weekBoundsRome(d).start` sia effettivamente il **lunedì** (locale IT). Se l'implementazione usa domenica come inizio, aggiungere +1 giorno prima del format. Controllare `src/lib/dateUtils.ts`.

- [ ] **Step 2: Azioni focus**

Create `src/app/actions/salesWeeklyFocusActions.ts`:

```ts
"use server"

import { createClient } from "@/utils/supabase/server"
import { db } from "@/db"
import { salesWeeklyFocus, users } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import crypto from "crypto"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { currentWeekStartRome } from "@/lib/workingDaysUtils"

export async function getSalesWeeklyFocus(salesUserId: string, weekStart?: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const wk = weekStart || currentWeekStartRome()
    const row = (await db.select({
        objection: salesWeeklyFocus.objection,
        taskNote: salesWeeklyFocus.taskNote,
        weekStart: salesWeeklyFocus.weekStart,
    }).from(salesWeeklyFocus).where(and(
        eq(salesWeeklyFocus.companyId, ctx.companyId),
        eq(salesWeeklyFocus.salesUserId, salesUserId),
        eq(salesWeeklyFocus.weekStart, wk),
    )))[0]
    return row ?? null
}

export async function setSalesWeeklyFocus(input: { salesUserId: string; weekStart: string; objection: string | null; taskNote: string }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role
    if (!user || !['MANAGER', 'ADMIN'].includes(role)) return { success: false, error: 'Unauthorized' }

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const existing = (await db.select({ id: salesWeeklyFocus.id }).from(salesWeeklyFocus).where(and(
        eq(salesWeeklyFocus.companyId, ctx.companyId),
        eq(salesWeeklyFocus.salesUserId, input.salesUserId),
        eq(salesWeeklyFocus.weekStart, input.weekStart),
    )))[0]

    if (existing) {
        await db.update(salesWeeklyFocus).set({
            objection: input.objection || null,
            taskNote: input.taskNote || '',
            createdBy: user.id,
            updatedAt: new Date(),
        }).where(eq(salesWeeklyFocus.id, existing.id))
    } else {
        await db.insert(salesWeeklyFocus).values({
            id: crypto.randomUUID(),
            salesUserId: input.salesUserId,
            weekStart: input.weekStart,
            objection: input.objection || null,
            taskNote: input.taskNote || '',
            createdBy: user.id,
            companyId: ctx.companyId,
        })
    }
    return { success: true }
}

export async function listVenditori() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const rows = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users).where(and(eq(users.role, 'VENDITORE'), companyScope(ctx, users.companyId)))
    return rows.map(r => ({ id: r.id, name: r.displayName || r.name })).sort((a, b) => a.name.localeCompare(b.name, 'it'))
}
```

- [ ] **Step 3: Banner venditore**

Create `src/components/venditore-performance/WeeklyFocusBanner.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { Target } from "lucide-react"
import { getSalesWeeklyFocus } from "@/app/actions/salesWeeklyFocusActions"

export function WeeklyFocusBanner({ salesUserId }: { salesUserId: string }) {
    const [focus, setFocus] = useState<{ objection: string | null; taskNote: string } | null>(null)
    useEffect(() => {
        let alive = true
        getSalesWeeklyFocus(salesUserId).then(f => { if (alive) setFocus(f) })
        return () => { alive = false }
    }, [salesUserId])

    if (!focus || (!focus.objection && !focus.taskNote)) return null
    return (
        <div className="bg-gradient-to-r from-brand-orange/10 to-amber-50 border border-brand-orange/30 rounded-xl p-4 flex items-start gap-3">
            <Target className="h-5 w-5 text-brand-orange shrink-0 mt-0.5" />
            <div>
                <div className="text-xs font-bold text-brand-orange uppercase tracking-wider">Focus della settimana</div>
                {focus.objection && <div className="text-sm font-semibold text-gray-900 mt-1">Obiezione da lavorare: {focus.objection}</div>}
                {focus.taskNote && <div className="text-sm text-gray-700 mt-1">{focus.taskNote}</div>}
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Montare il banner nella dashboard venditore**

In `src/components/VenditoreDashboardClient.tsx`, importare `WeeklyFocusBanner` e renderizzarlo in cima al contenuto (subito dopo l'header/titolo, prima dei toggle vista):
```tsx
                <WeeklyFocusBanner salesUserId={sellerId} />
```

- [ ] **Step 5: Verifica build**

Run: `npx tsc --noEmit` → nessun nuovo errore.
Run: `npm run build` → OK.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workingDaysUtils.ts src/app/actions/salesWeeklyFocusActions.ts src/components/venditore-performance/WeeklyFocusBanner.tsx src/components/VenditoreDashboardClient.tsx
git commit -m "feat(venditori): focus settimanale (azioni + banner venditore)"
```

---

## Task 7: Pagina Sales Manager `/performance-venditori`

**Files:**
- Create: `src/app/(dashboard)/performance-venditori/page.tsx`
- Create: `src/app/(dashboard)/performance-venditori/PerformanceVenditoriClient.tsx`
- Create: `src/components/venditore-performance/SalesWeeklyFocusEditor.tsx`
- Modify: `src/components/Sidebar.tsx` (voce nav)

**Interfaces:**
- Consumes: `getVenditorePerformance`, `listVenditori`, `getSalesWeeklyFocus`, `setSalesWeeklyFocus`, `currentWeekStartRome`, `currentYearMonthRome`, `VenditorePerformanceView`, `NOT_CLOSED_REASONS`.
- Produces: rotta `/performance-venditori` (ADMIN, + TL Conferme read-only) e componente `SalesWeeklyFocusEditor`.

- [ ] **Step 1: Editor focus (manager)**

Create `src/components/venditore-performance/SalesWeeklyFocusEditor.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { NOT_CLOSED_REASONS } from "@/lib/surveys/questions"
import { getSalesWeeklyFocus, setSalesWeeklyFocus } from "@/app/actions/salesWeeklyFocusActions"

export function SalesWeeklyFocusEditor({ salesUserId, weekStart, suggestedObjection, readOnly }: {
    salesUserId: string
    weekStart: string
    suggestedObjection?: string | null
    readOnly?: boolean
}) {
    const [objection, setObjection] = useState<string>("")
    const [taskNote, setTaskNote] = useState<string>("")
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        let alive = true
        getSalesWeeklyFocus(salesUserId, weekStart).then(f => {
            if (!alive) return
            setObjection(f?.objection ?? suggestedObjection ?? "")
            setTaskNote(f?.taskNote ?? "")
        })
        return () => { alive = false }
    }, [salesUserId, weekStart, suggestedObjection])

    const save = async () => {
        setSaving(true); setSaved(false)
        const r = await setSalesWeeklyFocus({ salesUserId, weekStart, objection: objection || null, taskNote })
        setSaving(false)
        if (r.success) setSaved(true); else alert(r.error || "Errore salvataggio focus")
    }

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-gray-700">Focus della settimana ({weekStart})</h3>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Obiezione da lavorare</label>
                <select value={objection} onChange={e => setObjection(e.target.value)} disabled={readOnly} className="input-fenice text-sm">
                    <option value="">— Nessuna —</option>
                    {NOT_CLOSED_REASONS.map(r => <option key={r} value={r}>{r}{suggestedObjection === r ? ' (più frequente)' : ''}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Task / nota</label>
                <textarea rows={3} value={taskNote} onChange={e => setTaskNote(e.target.value)} disabled={readOnly} className="input-fenice text-sm" placeholder="Es. Provare lo script alternativo sull'obiezione prezzo…" />
            </div>
            {!readOnly && (
                <div className="flex items-center gap-3">
                    <button onClick={save} disabled={saving} className="btn-primary text-sm py-2 px-5 disabled:opacity-50">{saving ? "Salvataggio…" : "Salva focus"}</button>
                    {saved && <span className="text-xs text-green-600 font-medium">Salvato ✓</span>}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Client pagina**

Create `src/app/(dashboard)/performance-venditori/PerformanceVenditoriClient.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { getVenditorePerformance } from "@/app/actions/venditorePerformanceActions"
import { VenditorePerformanceView } from "@/components/venditore-performance/VenditorePerformanceView"
import { SalesWeeklyFocusEditor } from "@/components/venditore-performance/SalesWeeklyFocusEditor"

interface Props {
    venditori: { id: string; name: string }[]
    initialYearMonth: string
    weekStart: string
    readOnly: boolean
}

export function PerformanceVenditoriClient({ venditori, initialYearMonth, weekStart, readOnly }: Props) {
    const [sel, setSel] = useState<string>(venditori[0]?.id ?? "")
    const [ym, setYm] = useState<string>(initialYearMonth)
    const [data, setData] = useState<any>(null)

    useEffect(() => {
        if (!sel) return
        let alive = true
        setData(null)
        getVenditorePerformance({ salesUserId: sel, yearMonth: ym }).then(d => { if (alive) setData(d) })
        return () => { alive = false }
    }, [sel, ym])

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Venditore</label>
                    <select value={sel} onChange={e => setSel(e.target.value)} className="input-fenice text-sm w-auto">
                        {venditori.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Mese</label>
                    <select value={ym} onChange={e => setYm(e.target.value)} className="input-fenice text-sm w-auto">
                        {Array.from({ length: 12 }).map((_, i) => {
                            const now = new Date()
                            const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
                            const m = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
                            return <option key={m} value={m}>{m}</option>
                        })}
                    </select>
                </div>
            </div>

            {sel && (
                <SalesWeeklyFocusEditor
                    salesUserId={sel}
                    weekStart={weekStart}
                    suggestedObjection={data?.topReason?.reason ?? null}
                    readOnly={readOnly}
                />
            )}

            {data ? <VenditorePerformanceView data={data} /> : <div className="text-center text-gray-400 py-12">Caricamento…</div>}
        </div>
    )
}
```

- [ ] **Step 3: Server page con guardia**

Create `src/app/(dashboard)/performance-venditori/page.tsx` (guardia identica a `panoramica-generale`: ADMIN + TL Conferme read-only):

```tsx
import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { isConfermeTl } from "@/lib/confermeTl"
import { currentYearMonthRome, currentWeekStartRome } from "@/lib/workingDaysUtils"
import { listVenditori } from "@/app/actions/salesWeeklyFocusActions"
import { PerformanceVenditoriClient } from "./PerformanceVenditoriClient"

export const dynamic = 'force-dynamic'

export default async function PerformanceVenditoriPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    const role = user.user_metadata?.role
    const isTlConfermeViewer = role === 'CONFERME' && isConfermeTl(user.email)
    if (role !== 'ADMIN' && role !== 'MANAGER' && !isTlConfermeViewer) redirect('/')

    const readOnly = isTlConfermeViewer
    const venditori = await listVenditori()

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">Performance Venditori</h1>
                <p className="text-sm text-ash-500 mt-0.5">Analisi per venditore: motivi di non chiusura, follow-up, closing rate, trend. Assegna il focus settimanale.</p>
            </div>
            <PerformanceVenditoriClient
                venditori={venditori}
                initialYearMonth={currentYearMonthRome()}
                weekStart={currentWeekStartRome()}
                readOnly={readOnly}
            />
        </div>
    )
}
```

- [ ] **Step 4: Voce nav in Sidebar**

In `src/components/Sidebar.tsx`, nel ramo ADMIN (dove c'è `{ name: "Sales Manager", href: "/panoramica-generale", icon: Compass }`, ~riga 126) aggiungere subito dopo:
```tsx
                        { name: "Performance Venditori", href: "/performance-venditori", icon: Trophy },
```
E nel ramo CONFERME per il TL (dopo `{ name: "Sales Manager", href: "/panoramica-generale", icon: Compass }`, ~riga 90) aggiungere:
```tsx
                { name: "Performance Venditori", href: "/performance-venditori", icon: Trophy },
```
(`Trophy` è già importato nel file — verificare; se manca, aggiungerlo all'import lucide-react.)

- [ ] **Step 5: Verifica build + lint**

Run: `npx tsc --noEmit` → nessun nuovo errore.
Run: `npm run build` → OK (la rotta `/performance-venditori` compare nel build output).
Run: `npm run lint` → nessun nuovo problema oltre baseline.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/performance-venditori src/components/venditore-performance/SalesWeeklyFocusEditor.tsx src/components/Sidebar.tsx
git commit -m "feat(venditori): pagina Sales Manager Performance Venditori + focus editor + nav"
```

---

## Verifica finale (dopo tutti i task)

- [ ] `npm run test` → tutti i test verdi.
- [ ] `npm run build` → build pulita.
- [ ] `npx tsc --noEmit` → nessun nuovo errore.
- [ ] QA browser (login ADMIN + un venditore):
  - Venditore: banner focus visibile se assegnato; tab Follow-up con bucket corretti; tab Performance con card e grafici; drawer "Non chiuso" richiede follow-up; al 4° tentativo "Non chiuso" sparisce; "Perso" chiude il caso.
  - Sales Manager `/performance-venditori`: selettore venditore/mese, dati coerenti, salvataggio focus, TL Conferme in sola lettura.
- [ ] Verificare che `getVenditoriKpi` continui a funzionare (KPI Venditori) con `Perso` conteggiato negli esitati.

## Note di rollout

- La migrazione `0015` è idempotente e va applicata a Supabase prima del deploy del codice (Task 1 Step 4).
- L'analytics parte dai nuovi `salesAttempts`: gli esiti storici (pre-feature) non sono migrati (fuori scope). I mesi precedenti al rilascio mostreranno dati parziali/nulli — atteso.
