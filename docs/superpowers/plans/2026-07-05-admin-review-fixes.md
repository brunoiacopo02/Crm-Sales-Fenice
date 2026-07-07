# Admin Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correggere i dati sbagliati della sezione admin, unificare le definizioni KPI su quelle del Sales Manager, uniformare i gate di ruolo, potenziare l'account TL GDO, rendere affidabile la presence Conferme e ridurre il Disk IO Supabase.

**Architecture:** Le definizioni canoniche vivono in un nuovo modulo condiviso `src/lib/kpi/canon.ts` importato dalle server action. I fix sono ordinati per rischio crescente: prima interventi DB senza deploy (indici), poi bug puntuali, poi il refactor delle definizioni, infine navigazione. Ogni task termina con `npm run build` verde e un commit.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM (`src/db/schema.ts`), Supabase (progetto `ncutwzsifzundikwllxp`), Tailwind.

## Global Constraints

- **VIETATO eliminare qualsiasi dato esistente**: nessun `DELETE`, nessun `DROP TABLE`, nessun `DROP COLUMN`, nessuna riduzione di retention (resta 90gg), nessuna migrazione distruttiva. Gli unici `DROP INDEX` ammessi sono quelli elencati nel Task E2 (gli indici non contengono dati).
- **NON droppare** `sales_attempts_lead_idx` e `sales_attempts_user_date_idx` (feature live dal 2/7, "unused" solo perché nuova).
- Definizioni canoniche decise dal product owner: **presenziato = `salespersonOutcome IN ('Chiuso','Non chiuso')`** (né `Sparito` né `Perso` contano); **target = tabella `monthlyLeadTargets`** (quella del Sales Manager); **target app/gg default per-GDO = 8**, soglia giudizio manager = 10 (invariata); **"App Fissati" attribuiti alla data di fissaggio** (`appointmentCreatedAt || appointmentDate`), con gate `appointmentDate IS NOT NULL`; **marketing = budget manuali** (nessuna Meta API).
- Serenamente è in pausa: basta che non inquini i numeri Fenice e che non si rompa nulla. Non investire in feature multi-azienda nuove; il vincolo unique globale su `monthlyLeadTargets.yearMonth` si segnala ma non si risolve ora.
- Il bot fissatore (`users.isBot = true`) va escluso da OGNI classifica, media e monitor gamification manager; resta visibile solo dove già progettato (`/statistiche-fissatore`).
- Timezone: ogni bound temporale nelle action deve usare gli helper Rome di `src/lib/dateUtils.ts` (`dayBoundsRome:36`, `monthBoundsRome:46`, `weekBoundsRome:69`, `toRomeDateStr:31`) e i giorni lavorativi `src/lib/workingDaysUtils.ts` (`countWorkingDaysInMonth:54`, `countWorkingDaysElapsed:74`, con festività). Mai `new Date()` + `setHours` per confini di giornata.
- Tenancy: `currentTenant()` / `companyScope(ctx, col)` / `ALL_COMPANIES` da `src/lib/tenancy.ts` (`companyScope:163`).
- Il repo NON ha una test suite: la verifica di ogni task è `npm run build` senza errori + controlli mirati indicati nel task. Niente hydration warning: mai bottoni dentro `<span>`/`<p>`.
- Commit frequenti, uno per task, messaggio indicato nel task. Push a main solo a fine piano dopo QA.

---

## FASE E — Supabase Disk IO (nessun deploy necessario per E2)

### Task E2: Drop degli 11 indici inutilizzati

**Files:** nessun file di repo — SQL diretto su Supabase via MCP `mcp__supabase__execute_sql` (project_id `ncutwzsifzundikwllxp`). `DROP INDEX CONCURRENTLY` non può girare in transazione: eseguire **una istruzione per chiamata**.

**Interfaces:** nessuna. Gli indici NON contengono dati, sono ricostruibili.

- [ ] **Step 1: Verifica che gli indici siano ancora unused** (idx_scan = 0):

```sql
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE indexrelname IN ('ac_daily_metrics_company_funnel_date_idx','ads_daily_insights_company_funnel_date_idx','crm_appointments_company_date_idx','crm_appointments_company_funnel_date_idx','crm_appointments_status_idx','crm_deals_company_closed_idx','crm_deals_company_funnel_closed_idx','crm_deals_company_salesperson_idx','crm_events_company_occurred_idx','crm_events_lead_idx','crm_events_type_idx');
```

Se un indice ha `idx_scan > 0`, NON dropparlo e segnalarlo nel report finale.

- [ ] **Step 2: Drop uno per volta** (11 chiamate `execute_sql` separate):

```sql
DROP INDEX CONCURRENTLY IF EXISTS "ac_daily_metrics_company_funnel_date_idx";
```

e così via per gli altri 10 nomi dello Step 1. NON toccare `sales_attempts_*`.

- [ ] **Step 3: Verifica** — `SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'crm_%';` deve mostrare gli indici rimasti (pkey e quelli usati). Annotare l'esito.

### Task E1: Dimagrire le scritture di `pipelineSnapshots`

**Files:**
- Modify: `src/app/actions/pipelineActions.ts:119-157` (blocco snapshot)

**Interfaces:**
- Consumes: `pipelineSnapshots` (schema.ts:420-433), colonne jsonb `firstCallIds/secondCallIds/thirdCallIds` NOT NULL.
- Produces: stesso comportamento diagnostico, ~90% di byte in meno scritti.

Logica attuale: a ogni cambio di fingerprint scrive contatori + **liste complete di ID** (~3KB/riga, ~1000 righe/gg, tabella = 151MB = metà DB). Il caso d'uso diagnostico è "lead spariti" → servono le liste SOLO quando una tab si RESTRINGE.

- [ ] **Step 1: Leggere `pipelineActions.ts:100-160`** per contesto reale.
- [ ] **Step 2: Modificare il blocco insert**: recuperare dall'ultimo snapshot anche i contatori (`firstCallCount`, `secondCallCount`, `thirdCallCount`), e scrivere le liste ID solo se almeno una tab è diminuita; altrimenti scrivere array vuoti (le colonne sono NOT NULL, `[]` è valido):

```ts
const lastSnap = await db.select({
    fingerprint: pipelineSnapshots.fingerprint,
    firstCallCount: pipelineSnapshots.firstCallCount,
    secondCallCount: pipelineSnapshots.secondCallCount,
    thirdCallCount: pipelineSnapshots.thirdCallCount,
}).from(pipelineSnapshots).where(and(
    eq(pipelineSnapshots.companyId, ctx.companyId),
    eq(pipelineSnapshots.userId, userId),
)).orderBy(desc(pipelineSnapshots.timestamp)).limit(1)

if (!lastSnap[0] || lastSnap[0].fingerprint !== fingerprint) {
    // Le liste ID servono solo per diagnosticare i "lead spariti": le salviamo
    // esclusivamente quando una tab si restringe rispetto allo snapshot precedente.
    const shrunk = !!lastSnap[0] && (
        firstCall.length < lastSnap[0].firstCallCount ||
        secondCall.length < lastSnap[0].secondCallCount ||
        thirdCall.length < lastSnap[0].thirdCallCount
    )
    await db.insert(pipelineSnapshots).values({
        id: crypto.randomUUID(),
        userId,
        firstCallCount: firstCall.length,
        secondCallCount: secondCall.length,
        thirdCallCount: thirdCall.length,
        recallsCount: recallsLeads.length,
        firstCallIds: shrunk ? firstIds : [],
        secondCallIds: shrunk ? secondIds : [],
        thirdCallIds: shrunk ? thirdIds : [],
        fingerprint,
        companyId: ctx.companyId,
    })
}
```

Il fingerprint resta calcolato sulle liste complete (invariato). NON toccare righe esistenti, NON cambiare retention.

- [ ] **Step 3: `npm run build`** → verde.
- [ ] **Step 4: Commit** — `perf(pipeline): snapshot slim, liste ID solo su restringimento tab (Disk IO)`

---

## FASE A — Fix dati oggettivamente sbagliati

### Task A1: `/monitor-vendite` — follow-up da `salesAttempts` (oggi sempre 0)

**Files:**
- Modify: `src/app/actions/venditoriMonitorActions.ts:135-190`
- Read first: `src/app/actions/venditoreActions.ts:144-189` (logica corretta lato venditore), `src/db/schema.ts:870-891` (`salesAttempts`)

**Interfaces:**
- Produces: `upcomingFollowUps` / `overdueFollowUps` con shape ESISTENTE del client (leggere `src/components` consumer di `venditoriMonitorActions` per non rompere le prop; mantenere i campi `followUpNumber`, `followUpDate`, dati lead).

Bug: la query esige `isNull(leads.salespersonOutcome)` ma `saveVenditoreOutcome` (`venditoreActions.ts:280-289`) valorizza SEMPRE `salespersonOutcome='Non chiuso'` quando scrive `followUp1Date`, e `followUp2Date` è sempre null → risultato sempre vuoto.

- [ ] **Step 1:** Sostituire la query legacy: prendere i lead dei venditori target con `salespersonOutcome = 'Non chiuso'` e follow-up aperto, leggendo la verità da `salesAttempts`:

```ts
// Follow-up aperti: ultimo attempt del lead con nextFollowUpDate valorizzata
// e pratica ancora in 'Non chiuso' (il nuovo ciclo scrive lì, non più su followUp1/2Date).
const attempts = await db.select({
    leadId: salesAttempts.leadId,
    attemptNumber: salesAttempts.attemptNumber,
    nextFollowUpDate: salesAttempts.nextFollowUpDate,
    createdAt: salesAttempts.createdAt,
}).from(salesAttempts)
  .innerJoin(leads, eq(leads.id, salesAttempts.leadId))
  .where(and(
      eq(leads.companyId, ctx.companyId),
      inArray(leads.salespersonUserId, targetIds),
      eq(leads.salespersonOutcome, 'Non chiuso'),
      isNotNull(salesAttempts.nextFollowUpDate),
  ))
```

poi in JS tenere per ogni `leadId` solo l'attempt con `attemptNumber` massimo, e da lì costruire `followUpNumber = attemptNumber + 1`, `followUpDate = nextFollowUpDate`, ripartendo upcoming/overdue rispetto a `now` come fa il codice attuale (righe 157-183). Import di `salesAttempts` dallo schema.

- [ ] **Step 2:** Rimuovere la lettura di `followUp1Date`/`followUp2Date` in questo file (le colonne restano nel DB, nessun drop).
- [ ] **Step 3:** `npm run build` verde.
- [ ] **Step 4: Commit** — `fix(monitor-vendite): follow-up letti da salesAttempts, prima erano sempre 0`

### Task A2: `/qualita-lead` — filtro azienda + timezone Roma

**Files:**
- Modify: `src/app/(dashboard)/qualita-lead/actions.ts` (tutte le query) e `src/app/(dashboard)/qualita-lead/page.tsx:22-24` (default periodo)

**Interfaces:**
- Consumes: `currentTenant()`, `companyScope(ctx, leads.companyId)` da `src/lib/tenancy.ts`; `dayBoundsRome` da `src/lib/dateUtils.ts`.

Bug: zero filtri companyId in tutto il file → aggregati Fenice+Serenamente mescolati; date con suffisso `Z` (UTC).

- [ ] **Step 1:** In `requireManager` (actions.ts:18-29) aggiungere `const ctx = await currentTenant()` e ritornarlo; in `getAvailableFunnels`, `aggregateSingle`, `aggregateArray` e ogni query che tocca `leads` aggiungere `companyScope(ctx, leads.companyId)` alle condizioni (le survey si filtrano tramite l'innerJoin su leads: basta lo scope su leads).
- [ ] **Step 2:** In `buildCommonConditions` (actions.ts:63-66) sostituire i bound UTC con Rome: `dayBoundsRome(new Date(filters.startDate + 'T12:00:00')).start` e `dayBoundsRome(new Date(filters.endDate + 'T12:00:00')).end` (mezzogiorno evita il rollover di data).
- [ ] **Step 3:** `npm run build` verde. **Step 4: Commit** — `fix(qualita-lead): scope per azienda + confini giornata Europe/Rome`

### Task A3: `getConfermeDailyObjectives` senza companyScope

**Files:** Modify: `src/app/actions/confermeKpiActions.ts:595-615` (leggere prima la funzione intera).

- [ ] **Step 1:** Aggiungere `companyScope(ctx, leads.companyId)` al `where` (la funzione ha già o deve ottenere `ctx` via `currentTenant()` come le sorelle nello stesso file — copiarne il pattern).
- [ ] **Step 2:** `npm run build`. **Step 3: Commit** — `fix(conferme): obiettivi giornalieri filtrati per azienda`

### Task A4: redirect rotto `/accesso-negato`

**Files:** Modify: `src/app/(dashboard)/kpi-conferme/page.tsx:16`.

- [ ] **Step 1:** `redirect("/accesso-negato")` → `redirect("/unauthorized")`.
- [ ] **Step 2:** `npm run build`. **Step 3: Commit** — `fix(kpi-conferme): redirect non-autorizzato a /unauthorized (era 404)`

### Task A5: `/archivio` — dropdown utenti cross-tenant

**Files:** Modify: `src/app/(dashboard)/archivio/page.tsx:17-24`.

- [ ] **Step 1:** Filtrare gli utenti come le altre pagine: pattern canonico `allowedCompanies` (vedi `src/app/actions/venditoriMonitorActions.ts:68-71`): utente incluso se `companyId = ctx.companyId` OPPURE `allowedCompanies` contiene `ctx.companyId`. Usare `currentTenant()`.
- [ ] **Step 2:** `npm run build`. **Step 3: Commit** — `fix(archivio): dropdown operatori filtrati per azienda`

### Task A6: Lead bloccati AC visibili all'admin

**Files:**
- Modify: `src/app/api/webhooks/activecampaign/route.ts:285-313` (skip silenzioso), `src/app/actions/acIntakeActions.ts` (lista/retry), `src/components/LeadAutomaticiClient.tsx` (UI)
- Read first: schema `acIntakeFailures` in `src/db/schema.ts` (verificare il campo motivo, es. `reason`)

**Interfaces:**
- Produces: i blocked appaiono in una sezione UI dedicata "Bloccati da lista" e NON entrano in "Riprova tutti".

- [ ] **Step 1:** Nel webhook, al posto del solo `console.log`, chiamare la stessa `recordFailure(...)` usata dagli altri skip con reason/motivo `'blocked_list'` (payload completo per eventuale recupero manuale). Se `recordFailure` non ha un campo adatto, usare il campo note/reason esistente con prefisso `blocked_list:`.
- [ ] **Step 2:** In `acIntakeActions.ts`: escludere i record `blocked_list` dal batch di `retryAllAcFailures` (il retry li ri-skipperebbe in loop); lasciarli recuperabili solo col retry singolo (caso: lista sbloccata in futuro) e con "Risolto".
- [ ] **Step 3:** In `LeadAutomaticiClient.tsx`: sezione/badge separato "Bloccati da lista (N)" che elenca questi record, distinta dai failure veri.
- [ ] **Step 4:** `npm run build`. **Step 5: Commit** — `feat(lead-automatici): lead bloccati da lista AC tracciati e visibili (prima sparivano in silenzio)`

### Task A7: canone "presenziato" applicato a venditori/performance

**Files:**
- Read first: `src/lib/venditorePerformance/aggregate.ts` (righe 20, 51-77), `src/app/actions/kpiVenditoriActions.ts:63-98`
- Modify: solo i punti dove `'Perso'` o `'Sparito'` vengono contati come presenza/trattativa.

Decisione PO: presenziato = SOLO `Chiuso` | `Non chiuso`. `Perso` resta valido come esito/motivo di non-chiusura (feature Performance Venditori invariata: conteggi "esitati", motivi, funnel follow-up NON si toccano), ma NON deve entrare in metriche etichettate presenze/trattative/show-rate.

- [ ] **Step 1:** Audit dei due file: individuare le metriche etichettate "presenz*/trattativ*" e verificare il predicato. Correggere solo dove `Perso`/`Sparito` è incluso. Se `aggregate.ts` usa Perso solo per closing-rate/motivi, NON toccarlo.
- [ ] **Step 2:** `npm run build`. **Step 3: Commit** — `fix(kpi): presenziato = Chiuso|Non chiuso ovunque (decisione PO)`

---

## FASE P — Presence Conferme affidabile

### Task P1: heartbeat su DB come fonte di verità del Radar

**Files:**
- Modify: `src/db/schema.ts` (nuova tabella), `src/lib/confermePresence.ts`, componenti Radar conferme (individuarli da chi importa `useConfermePresence`)
- Create: migrazione drizzle (`npx drizzle-kit generate` → 0016), server action `src/app/actions/presenceActions.ts`

**Interfaces:**
- Produces: `upsertHeartbeat(activity: string, leadId: string | null): Promise<void>` e `getConfermeHeartbeats(): Promise<Array<{userId, name, activity, leadId, updatedAt}>>` (fresh = updatedAt < 90s fa).

Problema utente: gli operatori Conferme non sempre si vedono online / non vedono su che lead sta l'altro. La presence Supabase Realtime è inaffidabile (visto anche churn di 235k subscribe sul DB). Soluzione: heartbeat su DB (scritture trascurabili: ~4 operatori × 1 upsert/45s) con il Realtime che resta come segnale "instant" opzionale.

- [ ] **Step 1:** Tabella:

```ts
export const presenceHeartbeats = pgTable('presenceHeartbeats', {
    userId: text('userId').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    activity: text('activity').notNull(), // es. 'board' | 'call' | 'idle'
    leadId: text('leadId'),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow().notNull(),
});
```

Generare la migrazione (solo CREATE TABLE, niente di distruttivo) e applicarla via `mcp__supabase__apply_migration`.

- [ ] **Step 2:** Server action `upsertHeartbeat` (`onConflictDoUpdate` su userId) chiamata dal client conferme ogni 45s e a ogni `setActivity` (agganciarsi al punto in cui `useConfermePresence`/`setActivity` in `src/lib/confermePresence.ts` traccia l'attività — NON creare un secondo canale realtime: vincolo singleton esistente).
- [ ] **Step 3:** Il componente Radar unisce le due fonti: presente = visibile via Realtime **oppure** heartbeat fresco (< 90s), con activity/leadId dall'heartbeat come fallback. Polling `getConfermeHeartbeats` ogni 30s.
- [ ] **Step 4:** `npm run build`. **Step 5: Commit** — `feat(conferme): presence ibrida realtime+heartbeat DB, operatori sempre visibili`

---

## FASE B — Definizioni KPI canoniche

### Task B1: modulo `src/lib/kpi/canon.ts`

**Files:** Create: `src/lib/kpi/canon.ts`

**Interfaces (Produces):**

```ts
// Esiti venditore che contano come "presenziato" (decisione PO 2026-07-05).
export const PRESENZIATO_OUTCOMES = ['Chiuso', 'Non chiuso'] as const
export function isPresenziato(outcome: string | null): boolean {
    return outcome === 'Chiuso' || outcome === 'Non chiuso'
}
// Data canonica di attribuzione di un "App Fissato": quando il GDO l'ha fissato.
export function apptSetAt(lead: { appointmentCreatedAt: Date | null; appointmentDate: Date | null }): Date | null {
    if (!lead.appointmentDate) return null
    return lead.appointmentCreatedAt ?? lead.appointmentDate
}
// Target giornalieri per-GDO (decisione PO): default individuale 8, soglia giudizio manager 10.
export const DEFAULT_DAILY_APPT_TARGET = 8
export const MANAGER_TARGET_APP_PER_GDO_DAY = 10
// Filtro standard per GDO "veri" nelle classifiche/medie (esclude il bot fissatore).
export function isRealGdo(u: { role: string; isActive: boolean; isBot: boolean }): boolean {
    return u.role === 'GDO' && u.isActive && !u.isBot
}
// Divisore delle medie per-GDO: solo GDO reali con statsActive.
export function isStatsGdo(u: { role: string; isActive: boolean; isBot: boolean; statsActive: boolean }): boolean {
    return isRealGdo(u) && u.statsActive
}
```

- [ ] **Step 1:** Creare il file con il contenuto sopra. **Step 2:** `npm run build`. **Step 3: Commit** — `feat(kpi): modulo canon con definizioni condivise`

### Task B2: escludere il bot + statsActive da classifiche e medie

**Files (Modify, leggere ciascuno prima di editare):**
- `src/app/actions/kpiAdvancedActions.ts` (ranking :166-184, gdoList :245, throughput :449-454): filtrare gli userId dei GDO con `isRealGdo`; per i divisori delle medie usare `isStatsGdo`.
- `src/app/actions/kpiTeamActions.ts:80`: idem (`isRealGdo` per aggregati/ranking).
- `src/app/actions/targetActions.ts:267-275` (`gdoAttivi`): divisore medie con `isStatsGdo`.
- `src/app/actions/gdoPerformanceActions.ts:628` (`getAllGdoScriptRates`): `isRealGdo`.
- `src/app/actions/managerOverviewActions.ts:78-80` e `src/app/actions/salesAlertsActions.ts:278-281`: aggiungere `!isBot` accanto a `statsActive` (protezione code-enforced, non più solo spunta manuale).
- `src/app/actions/managerRpgActions.ts:292-301, 306-325`: escludere `isBot` da profili RPG e overview gamification.

- [ ] **Step 1:** Applicare i filtri file per file usando gli helper di B1 (selezionare `isBot`/`statsActive` nelle query users dove mancano).
- [ ] **Step 2:** `npm run build`. **Step 3: Commit** — `fix(kpi): bot fissatore escluso da classifiche/medie/RPG, statsActive nei divisori`

### Task B3: timezone Roma + festività ovunque

**Files (Modify):**
- `src/app/actions/kpiActions.ts:29-36` (`getDailyKpi`): sostituire `setHours` con `dayBoundsRome(new Date())`.
- `src/app/actions/targetActions.ts:90-118, 239, 283-287`: bound mese con `monthBoundsRome`, "oggi" con `toRomeDateStr`, giorni lavorativi con `countWorkingDaysInMonth`/`countWorkingDaysElapsed` (festività incluse) al posto del loop solo-domeniche.
- `src/app/actions/gdoPerformanceActions.ts:110-111, 190-191`: bound mese con `monthBoundsRome(yearMonth)`, bucketing settimane con `toRomeDateStr`.
- `src/app/actions/confermeKpiActions.ts:27-28, 374-375`: `startOfMonth/endOfMonth` locali → `monthBoundsRome` con `lt(end)` esclusivo (come `kpiVenditoriActions.ts:73-74`).

- [ ] **Step 1:** Applicare file per file. Attenzione: `monthBoundsRome` accetta `'YYYY-MM'`.
- [ ] **Step 2:** `npm run build`. **Step 3: Commit** — `fix(kpi): confini temporali Europe/Rome e giorni lavorativi con festività in tutte le action manager`

### Task B4: base-data unica per "App Fissati" + target/gg = 8

**Files (Modify):**
- `src/app/actions/kpiAdvancedActions.ts:129-131` e `src/app/actions/kpiTeamActions.ts:90` e `src/app/actions/kpiActions.ts:60`: contare i fissati dai lead (`apptSetAt` nel periodo, gate `appointmentDate IS NOT NULL`, dedup per lead) invece che dalle righe `callLogs.outcome='APPUNTAMENTO'`. Nota: elimina anche il doppio conteggio di kpi-team (righe vs lead).
- `src/app/actions/targetActions.ts:353-354`: aggiungere il gate `isNotNull(leads.appointmentDate)` (oggi conta anche appuntamenti annullati).
- `src/app/actions/kpiActions.ts:509` e `src/app/actions/kpiAdvancedActions.ts:385`: default target giornaliero `2` → `DEFAULT_DAILY_APPT_TARGET` (8). `managerOverviewActions.ts:20` resta 10 ma importarlo da canon (`MANAGER_TARGET_APP_PER_GDO_DAY`).

- [ ] **Step 1:** Applicare, riusando `apptSetAt` da canon. `gdoPerformanceActions` (data del meeting) si allinea anch'esso a `apptSetAt` per le tabelle di produttività GDO mensile (:114-120).
- [ ] **Step 2:** `npm run build`. **Step 3: Commit** — `fix(kpi): App Fissati attribuiti alla data di fissaggio ovunque, target/gg default 8`

### Task B5: `/manager-targets` sulla tabella canonica `monthlyLeadTargets`

**Files:**
- Modify: `src/app/actions/targetActions.ts:131-158` (write), `:242-245` (read), `src/app/actions/confermeKpiActions.ts:231` (read)
- Read first: `src/app/actions/panoramicaActions.ts` uso di `monthlyLeadTargets` per la mappatura campi.

**Mappatura campi** (monthlyTargets → monthlyLeadTargets): `targetAppFissati→targetAppMonthly`, `targetAppConfermati→targetConfMonthly`, `targetTrattative→targetPresMonthly`, `targetClosed→targetCloseMonthly`, `targetValoreContratti→targetFatturatoMonthly`, `workingDaysOverride→workingDays`. Chiave: `month ('YYYY-MM')` → `yearMonth`.

- [ ] **Step 1:** `getManagerTargetsData` legge da `monthlyLeadTargets` (upsert su `yearMonth`); il salvataggio scrive SOLO su `monthlyLeadTargets`. La tabella `monthlyTargets` resta nel DB con tutti i suoi dati (nessun drop, nessuna migrazione) — solo il codice smette di leggerla/scriverla. `confermeKpiActions.ts:231` passa a `monthlyLeadTargets.targetConfMonthly`.
- [ ] **Step 2 (one-shot manuale, via MCP `execute_sql`):** backfill NON distruttivo dei mesi presenti in `monthlyTargets` (companyId='fenice') e assenti in `monthlyLeadTargets`:

```sql
INSERT INTO "monthlyLeadTargets" (id, "yearMonth", "targetNuovi", "targetDatabase", "workingDays", "targetAppMonthly", "targetConfMonthly", "targetPresMonthly", "targetCloseMonthly", "targetFatturatoMonthly", "companyId")
SELECT gen_random_uuid()::text, mt.month, 0, 0, COALESCE(mt."workingDaysOverride", 26), mt."targetAppFissati", mt."targetAppConfermati", mt."targetTrattative", mt."targetClosed", mt."targetValoreContratti", mt."companyId"
FROM "monthlyTargets" mt
WHERE mt."companyId" = 'fenice'
  AND NOT EXISTS (SELECT 1 FROM "monthlyLeadTargets" mlt WHERE mlt."yearMonth" = mt.month);
```

(Solo INSERT di righe mancanti: se il mese esiste già in `monthlyLeadTargets`, vincono i valori del Sales Manager, nessun UPDATE.)

- [ ] **Step 3:** `npm run build`. **Step 4: Commit** — `feat(targets): manager-targets unificato su monthlyLeadTargets (fonte Sales Manager)`

---

## FASE D — Gate uniformi + account TL GDO

### Task D1: helper `requireRole` + gate mancanti

**Files:**
- Create: `src/lib/authz.ts`
- Modify: `src/app/(dashboard)/kpi-gdo/page.tsx` (nessun gate!), `src/app/(dashboard)/marketing-analytics/page.tsx` (nessun gate!), `src/app/(dashboard)/richiami/page.tsx` (nessun gate!), `src/app/debug/table/page.tsx`

**Interfaces (Produces):**

```ts
// src/lib/authz.ts
import { redirect } from 'next/navigation'
export async function requireRole(session: { user?: { role?: string } } | null, roles: string[]): Promise<void> {
    if (!session?.user?.role || !roles.includes(session.user.role)) redirect('/unauthorized')
}
```

- [ ] **Step 1:** `kpi-gdo`: `requireRole(session, ['ADMIN','MANAGER','TL'])`. `marketing-analytics`: `['ADMIN','MANAGER']` (+ mantiene l'accesso dell'utente marketing: aggiungere eccezione esplicita per email `marketing@fenice.local` PRIMA del requireRole). `richiami`: consentire GDO (già filtrato sui propri), ADMIN, MANAGER, TL; escludere VENDITORE/CONFERME.
- [ ] **Step 2:** `debug/table/page.tsx`: gate `if (process.env.NODE_ENV === 'production' || process.env.VERCEL) redirect('/')` — copre anche i preview Vercel. (La pagina resta per il dev locale.)
- [ ] **Step 3:** Normalizzare le destinazioni non-autorizzato esistenti a `/unauthorized` SOLO nelle pagine admin toccate dal piano (evitare un mass-rename fuori scope).
- [ ] **Step 4:** `npm run build`. **Step 5: Commit** — `fix(authz): gate su kpi-gdo/marketing-analytics/richiami, debug/table chiuso sui preview`

### Task D2: account TL GDO potenziato (Sales Manager + tutte le viste lead/GDO)

**Files:**
- Modify: `src/components/Sidebar.tsx` (blocco TL), e i gate delle pagine sotto.
- Read first: `Sidebar.tsx` righe ~74-183 per capire il blocco TL esistente.

Richiesta PO: l'account TL GDO (`tlgdo@fenice.com`, role `TL`) deve vedere le tabelle del Sales Manager E tutti i dati lead/GDO.

- [ ] **Step 1:** Aggiungere `'TL'` ai gate di: `panoramica-generale/page.tsx:23` (nota: oggi esclude MANAGER intenzionalmente — NON toccare MANAGER, aggiungere solo TL), `manager-targets/page.tsx:12`, `qualita-lead` (requireManager in actions.ts — includere TL), `analisi-qualita`, `archivio`, `appuntamenti-oggi`, `import`, `lead-automatici`, `kpi-gdo` (già fatto in D1), `richiami` (già in D1). Le pagine che già ammettono TL restano invariate (`manager-gdo-performance`, `statistiche-fissatore`, `operativa-team`, `monitor-pause`, `note-gdo`).
- [ ] **Step 2:** Sidebar: per role TL replicare le voci corrispondenti (gruppi: Sales Manager, Operativo lead/GDO, KPI GDO, Qualità) — NON le sezioni venditori/conferme/store admin.
- [ ] **Step 3:** `npm run build`. **Step 4: Commit** — `feat(tl-gdo): accesso Sales Manager + tutte le viste lead/GDO per il ruolo TL`

---

## FASE C — Navigazione admin coerente (riorganizzazione leggera)

### Task C1: sidebar per domini + naming + orfane

**Files:** Modify: `src/components/Sidebar.tsx` (blocco ADMIN/MANAGER, righe 124-181)

Riorganizzazione LEGGERA (nessuna pagina eliminata, nessun merge di pagine ora):

- [ ] **Step 1:** Regroup delle voci admin per dominio, stesse route:
  - **Direzione**: Sales Manager (`/panoramica-generale`), Target & Previsioni (`/manager-targets`)
  - **GDO**: KPI GDO (`/kpi-gdo`), Performance Mensili GDO (`/manager-gdo-performance`), Operativa Team (`/operativa-team`), Note GDO (`/note-gdo`), Monitor Pause (`/monitor-pause`), Bot Fissatore (`/statistiche-fissatore`)
  - **Venditori**: KPI Venditori (`/kpi-venditori`), Performance Venditori (`/performance-venditori`), Monitor Vendite (`/monitor-vendite`), Portafoglio Clienti (`/portafoglio-clienti`)
  - **Conferme**: Board Conferme (`/conferme`), KPI Conferme (`/kpi-conferme`), Panoramica TL (`/conferme/panoramica-tl`) ← voce NUOVA per admin (pagina oggi orfana), Staffing Analytics (`/conferme/analytics`)
  - **Lead & Import**: Appuntamenti Oggi, Importa Lead, Lead Automatici, Archivio Storico, Richiami, Scartati (Marketing)
  - **Qualità**: Qualità Lead — Sondaggi (`/qualita-lead`), Analisi Funnel (`/analisi-qualita`) ← rinominata: era "Analisi Qualità", nome quasi identico all'altra
  - **Marketing**: Marketing Analytics
  - **Gamification**: Monitor RPG, Gestione Store
  - **Team**: Dashboard Operativa → rinominata "Gestione Account" (`/team`)
- [ ] **Step 2:** `/manager-marketing-backfill` resta orfana di proposito (tool one-shot) — aggiungere solo un commento nel file page.tsx che lo dichiara. `/kpi-team` stub redirect resta (bookmark).
- [ ] **Step 3:** `npm run build` + controllo visivo che i gruppi GDO/CONFERME/VENDITORE/TL non siano cambiati se non dove previsto da D2.
- [ ] **Step 4: Commit** — `refactor(nav): sidebar admin raggruppata per dominio, naming disambiguato, panoramica-tl linkata`

---

## FASE F — Verifica finale

### Task F1: build, QA e push

- [ ] **Step 1:** `npm run build` finale verde.
- [ ] **Step 2:** QA browser (skill `browse`/playwright) da admin: `/panoramica-generale`, `/manager-targets` (salva un target → verifica che le card panoramica lo vedano), `/kpi-gdo` (bot assente dal ranking), `/monitor-vendite` (follow-up ≠ 0 se esistono attempt aperti), `/qualita-lead` (numeri ≠ pre-fix), `/lead-automatici` (sezione Bloccati), da account TL: sidebar nuova + pagine accessibili.
- [ ] **Step 3:** Verifica dati non toccati: `SELECT count(*) FROM "monthlyTargets";` e `SELECT count(*) FROM "pipelineSnapshots";` invariati rispetto a inizio lavori (nessuna cancellazione).
- [ ] **Step 4:** Push a main → deploy Vercel; smoke test prod.
- [ ] **Step 5:** Aggiornare la memoria di progetto con l'esito.

---

## Self-Review (fatto)

- Copertura: tutti i 10 bug 🔴 hanno un task (1→A1, 2→A2, 3→B5, 4→B2, 5→A7, 6→A3, 7→A4, 8→A5, 9→A6, 10→B3); incongruenze → B1-B5; gate → D1; TL GDO → D2; nav → C1; presence → P1; Disk IO → E1/E2. Fuori scope dichiarato: merge fisico delle pagine ridondanti (riorganizzazione pesante), fix unique `monthlyLeadTargets.yearMonth` per multi-company (Serenamente in pausa), consolidamento dashboard marketing doppia (decisione PO: budget manuali, si rivaluta quando ci saranno le API Meta).
- Vincolo dati: nessun task cancella dati (E2 droppa solo indici; B5 fa solo INSERT di righe mancanti; E1 riduce solo le scritture future).
- Tipi coerenti: helper canon usati con le firme definite in B1.
