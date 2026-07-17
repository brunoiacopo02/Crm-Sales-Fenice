# Presenze GDO: Latch `presentedAt` + Conteggio per Data Appuntamento + Backfill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una presenza GDO, una volta maturata, non sparisce mai più (né per "Sparito" al follow-up né per esiti successivi) e conta nel giorno dell'appuntamento; backfill dei lead "Sparito" che avevano presenziato.

**Architecture:** Nuovo campo latch `leads.presentedAt` (timestamp, nullable) settato alla PRIMA registrazione di un esito Chiuso/Non chiuso con valore = `appointmentDate` del lead (fallback: data esito), mai sovrascritto dai path di esito. Tutti i conteggi presenze (bonus bisettimanale, Performance GDO, /kpi-gdo, pipeline) passano a basarsi su `presentedAt`. App Fissati e Chiusure NON cambiano (decisione PO 2026-07-17).

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, Supabase Postgres (migrazione via MCP `apply_migration`, backfill via `execute_sql`).

## Global Constraints

- Decisione PO 2026-07-17: la presenza conta SEMPRE il giorno dell'appuntamento (`appointmentDate`), non si sposta mai (nemmeno se il lead viene chiuso dopo). La chiusura resta datata `salespersonOutcomeAt`.
- Decisione PO 2026-07-17 (backfill): i lead oggi "Sparito" con presenza pregressa vanno riportati all'ultimo esito-presenza (tipicamente "Non chiuso"), oltre a marcarne la presenza.
- App Fissati: nessuna modifica a conteggi/attribuzione (base fissaggio `apptSetAt`).
- MAI query SQL raw nel codice app (solo Drizzle); SQL raw ammesso solo per migrazione/backfill one-shot.
- Il backfill massivo deve girare con `session_replication_role = replica` nella transazione per NON far scattare il trigger Broadcast 0019 su migliaia di righe.
- `drizzle-kit generate` inutilizzabile nel repo: migrazione scritta a mano.

---

### Task 1: Schema + migrazione DB

**Files:**
- Modify: `src/db/schema.ts:173` (dopo `salespersonOutcomeAt`)
- DB: migrazione Supabase `add_leads_presented_at`

**Interfaces:**
- Produces: colonna `leads."presentedAt"` (timestamptz null) + `leads.presentedAt` nel tipo Drizzle; indice parziale `leads_presented_at_idx`.

- [x] **Step 1: Aggiungi colonna a schema.ts** dopo la riga `salespersonOutcomeAt`:

```ts
    // Latch presenza (decisione PO 2026-07-17): settato alla PRIMA registrazione di
    // un esito Chiuso/Non chiuso, valore = appointmentDate del lead (il giorno in cui
    // ha presenziato). NON viene mai sovrascritto dai path di esito: uno "Sparito" a
    // un follow-up successivo NON cancella la presenza. È la base canonica di TUTTI
    // i conteggi presenze (bonus bisettimanale incluso).
    presentedAt: timestamp('presentedAt', { withTimezone: true, mode: 'date' }),
```

- [x] **Step 2: Applica migrazione** via `mcp__supabase__apply_migration` (nome `add_leads_presented_at`):

```sql
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "presentedAt" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "leads_presented_at_idx" ON "leads" ("assignedToId", "presentedAt") WHERE "presentedAt" IS NOT NULL;
```

- [x] **Step 3: Verifica** con `execute_sql`: `SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name='presentedAt';` → 1 riga.

### Task 2: Latch nei path di scrittura esito

**Files:**
- Modify: `src/app/actions/venditoreActions.ts:280-291` (tx update in `saveVenditoreOutcome`)
- Modify: `src/app/actions/confermeActions.ts:690-696` (update in `setSalespersonOutcome`)
- Modify: `src/app/actions/appointmentActions.ts:207` (annullamento appuntamento admin)

**Interfaces:**
- Consumes: `leads.presentedAt` (Task 1); `oldLead` row completa già selezionata in entrambi gli action.
- Produces: invariante "presentedAt settato solo da NULL, mai cancellato dai path esito; azzerato SOLO dall'annullamento appuntamento admin".

- [x] **Step 1: `saveVenditoreOutcome`** — nel `.set({...})` della transazione aggiungi (dopo `salespersonOutcomeAt`):

```ts
                // Latch presenza (PO 2026-07-17): prima presenza → giorno dell'appuntamento;
                // mai sovrascritto. "Sparito" a un follow-up NON toglie la presenza.
                presentedAt: oldLead.presentedAt ?? (
                    (payload.outcome === 'Chiuso' || payload.outcome === 'Non chiuso')
                        ? (oldLead.appointmentDate ?? effectiveOutcomeAt)
                        : null
                ),
```

- [x] **Step 2: `setSalespersonOutcome` (confermeActions)** — stesso latch nel `.set({...})` (la variabile data esito lì si chiama `outcomeAt`):

```ts
            // Latch presenza (PO 2026-07-17): vedi saveVenditoreOutcome.
            presentedAt: oldLead.presentedAt ?? (
                (outcome === 'Chiuso' || outcome === 'Non chiuso')
                    ? (oldLead.appointmentDate ?? outcomeAt)
                    : null
            ),
```

- [x] **Step 3: `appointmentActions` annullamento admin** — dopo `salespersonOutcomeAt: null,` aggiungi `presentedAt: null,` (l'annullamento wipe-a tutta la storia appuntamento, presenza inclusa).

- [x] **Step 4: `npx tsc --noEmit`** → 0 errori.

### Task 3: Conteggi presenze su `presentedAt`

**Files:**
- Modify: `src/lib/presenceCounting.ts:42-58` (countPresences — BONUS)
- Modify: `src/app/actions/gdoPerformanceActions.ts` (getManagerGdoTables + getGdoLeadOutcomeMetrics)
- Modify: `src/app/actions/kpiAdvancedActions.ts:62-76, 235-270` (% Presenziati ranking)
- Modify: `src/lib/kpi/canon.ts` (nota semantica)

**Interfaces:**
- Consumes: `leads.presentedAt`.
- Produces: presenza = `presentedAt IS NOT NULL`; data presenza = `presentedAt`. Chiusi/fissati invariati.

- [x] **Step 1: `countPresences`** — sostituisci il where dei lead:

```ts
        db.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, companyId),
            eq(leads.assignedToId, userId),
            isNotNull(leads.presentedAt),
            gte(leads.presentedAt, start),
            lt(leads.presentedAt, end),
        )),
```

Rimuovi `inArray`/`PRESENCE_OUTCOMES` e aggiorna il doc-comment (presenza = presentedAt nel range; presentedAt = giorno appuntamento, latch immutabile).

- [x] **Step 2: `getManagerGdoTables`** — le presenze escono dal cohort "fissati nel mese" ed entrano da una query dedicata su `presentedAt` ∈ mese, bucket settimanale su `presentedAt`:
  - aggiungi al `Promise.all` la query `presenceLeads` (`assignedToId, funnel, presentedAt` con `isNotNull(presentedAt)`, `gte/lt` su `startObj/endObj`);
  - nel forEach su `monthLeads` elimina `isPresenziatoFlag` e i 3 incrementi `presenziati`;
  - dopo il forEach aggiungi il loop su `presenceLeads` che incrementa `funnelStats[f].presenziati`, `totalStats.presenziati` e `calendarStats.presenziati[wIndex]` (wIndex da `presentedAt`);
  - fissati/confermati/chiusi INVARIATI (cohort fissaggio).

- [x] **Step 3: `getGdoLeadOutcomeMetrics`** — aggiungi `presentedAt: leads.presentedAt` alla select e sostituisci `const isPresenziatoFlag = isPresenziato(lead.salespersonOutcome)` con `const isPresenziatoFlag = lead.presentedAt !== null`. Rimuovi la funzione locale `isPresenziato` se resta inutilizzata.

- [x] **Step 4: `getAdvancedKpi` (kpiAdvancedActions)** — aggiungi `presentedAt: leads.presentedAt` alla select lead; `leadOutcomeMap` diventa `{ conf, presented: l.presentedAt !== null }`; il conteggio `presenziati` usa `o.presented`; rimuovi `PRESENZIATI_OUTCOMES`.

- [x] **Step 5: `canon.ts`** — aggiorna il commento di `PRESENZIATO_OUTCOMES`/`isPresenziato`: deprecato per i conteggi presenze (usare `leads.presentedAt`), resta solo per viste legacy non ancora migrate.

- [x] **Step 6: `npx tsc --noEmit`** → 0 errori.

### Task 4: Backfill dati (via `mcp__supabase__execute_sql`)

- [x] **Step 1: Diagnostica** (numeri da riportare al PO):

```sql
SELECT l."companyId", count(*) AS spariti_con_presenza,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "salesAttempts" sa2 WHERE sa2."leadId"=l.id AND sa2.outcome='Chiuso')) AS di_cui_gia_chiusi
FROM leads l
WHERE l."salespersonOutcome" = 'Sparito'
  AND EXISTS (SELECT 1 FROM "salesAttempts" sa WHERE sa."leadId" = l.id AND sa.outcome IN ('Chiuso','Non chiuso'))
GROUP BY 1;
```

- [x] **Step 2: Backfill A — recupero Sparito con presenza pregressa.** Ripristina l'ULTIMO esito-presenza (Chiuso > riprende anche prodotto/importo; altrimenti Non chiuso), presenza al giorno appuntamento. Transazione con trigger Broadcast disattivati:

```sql
BEGIN;
SET LOCAL session_replication_role = replica;
WITH pres AS (
  SELECT sa."leadId",
         min(sa."outcomeAt") AS first_pres_at,
         max(sa."outcomeAt") AS last_pres_at,
         (array_agg(sa.outcome ORDER BY sa."outcomeAt" DESC))[1] AS last_out,
         (array_agg(sa."closeProduct" ORDER BY sa."outcomeAt" DESC))[1] AS last_prod,
         (array_agg(sa."closeAmountEur" ORDER BY sa."outcomeAt" DESC))[1] AS last_amount
  FROM "salesAttempts" sa
  WHERE sa.outcome IN ('Chiuso','Non chiuso')
  GROUP BY sa."leadId"
)
UPDATE leads l
SET "salespersonOutcome" = pres.last_out,
    "salespersonOutcomeAt" = pres.last_pres_at,
    "closeProduct" = CASE WHEN pres.last_out='Chiuso' THEN pres.last_prod ELSE l."closeProduct" END,
    "closeAmountEur" = CASE WHEN pres.last_out='Chiuso' THEN pres.last_amount ELSE l."closeAmountEur" END,
    "presentedAt" = COALESCE(l."appointmentDate", pres.first_pres_at),
    "version" = l.version + 1,
    "updatedAt" = now()
FROM pres
WHERE l.id = pres."leadId" AND l."salespersonOutcome" = 'Sparito'
RETURNING l.id, l."assignedToId", l."salespersonOutcome", l."presentedAt";
COMMIT;
```

Salva l'elenco `RETURNING` (report al PO).

- [x] **Step 3: Backfill B — presentedAt per tutti i lead già Chiuso/Non chiuso:**

```sql
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE leads l
SET "presentedAt" = COALESCE(l."appointmentDate", l."salespersonOutcomeAt")
WHERE l."salespersonOutcome" IN ('Chiuso','Non chiuso')
  AND l."presentedAt" IS NULL
  AND (l."appointmentDate" IS NOT NULL OR l."salespersonOutcomeAt" IS NOT NULL);
COMMIT;
```

- [x] **Step 4: Verifica**: (a) `SELECT count(*) FROM leads WHERE "salespersonOutcome" IN ('Chiuso','Non chiuso') AND "presentedAt" IS NULL;` → atteso 0 (o solo casi senza alcuna data); (b) presenze ciclo corrente (2026-07-13 → 2026-07-27) per GDO con `presentedAt` vs vecchio conteggio (`salespersonOutcomeAt` + whitelist) — differenze spiegate solo da recuperi/rianchoraggio data.

### Task 5: Typecheck finale, commit, deploy, ri-backfill

- [x] **Step 1:** `npx tsc --noEmit` → 0 errori.
- [x] **Step 2:** Commit + push su main (deploy Vercel automatico):

```bash
git add src/db/schema.ts src/lib/presenceCounting.ts src/lib/kpi/canon.ts src/app/actions/venditoreActions.ts src/app/actions/confermeActions.ts src/app/actions/appointmentActions.ts src/app/actions/gdoPerformanceActions.ts src/app/actions/kpiAdvancedActions.ts docs/superpowers/plans/2026-07-17-presenze-latch.md
git commit -m "feat(presenze): latch presentedAt — presenza immutabile al giorno appuntamento + backfill Sparito"
```

- [x] **Step 3:** Dopo il deploy, ri-esegui Backfill B (Task 4 Step 3) per coprire i lead esitati tra backfill e deploy. → 0 righe residue.
- [x] **Step 4:** Smoke: tracker bisettimanale /kpi-gdo di un GDO mostra le presenze recuperate; nessun errore runtime nei log Vercel.
