# Scheda Trattativa & Forzatura Venditori — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costringere strutturalmente Conferme e Venditori a passare dal CRM: le Conferme compilano una "Scheda Trattativa" obbligatoria (sondaggio + briefing), il venditore deve fare check-in nel CRM per accedere al lead (telefono incluso) e non può usare la dashboard finché non registra esito + sondaggio degli appuntamenti arretrati.

**Architecture:** Estende `confermeLeadSurveys` con campi-briefing nella forma del `botReport`; rende obbligatorio il sondaggio Conferme su conferma E scarto (fondendo il dialog di scarto nel sondaggio); aggiunge `leads.negotiationStartedAt` (check-in "Inizia trattativa") che gatea l'accesso al lead lato venditore; aggiunge un overlay bloccante (`OutcomeGate`) sugli esiti arretrati e guardie server in `saveVenditoreOutcome`.

**Tech Stack:** Next.js 16 (App Router) · Drizzle ORM · Supabase Postgres · Tailwind v4 · React 19. **Niente test runner nel progetto** → la verifica è `npx next build` (typecheck) + check manuale via dev server / Playwright MCP; per la logica pura si usano piccoli script `npx tsx`.

## Global Constraints

- **DB**: solo Drizzle (`src/db/schema.ts`), mai SQL raw nelle action. Migrazioni = file SQL numerati in `drizzle/migrations/` (prossimo: `0014_`).
- **Multi-tenant**: ogni query filtra per `companyId` (`ctx.companyId` da `currentTenant()` + `assertSalesArea(ctx)`). Mai leggere/scrivere senza `companyId`.
- **Optimistic locking**: `leads.version` va incrementato a ogni update; rispettare il pattern `eq(leads.version, oldLead.version)` + ritorno `CONCURRENCY_ERROR`.
- **Bottoni interattivi**: mai dentro `<span>`/`<p>` (WSOD su Vercel) — usare `<div>`.
- **Esiti venditore canonici**: `'Chiuso' | 'Non chiuso' | 'Sparito'` (campo `leads.salespersonOutcome`).
- **Funnel escluso dai sondaggi venditore**: `EXCLUDED_FUNNEL = 'database'`.
- **Costante grazia arretrati**: `OVERDUE_GRACE_HOURS = 2`.
- **Compat storico scarto**: i valori dei motivi di scarto restano le stringhe attuali (es. `'non interessato'`, `'non ha soldi'`) — già persistite in `leads.confirmationsDiscardReason`. Non snake-case-ificarli.
- **Gamification venditore**: resta OFF (nessun coin/XP al venditore). Gamification Conferme invariata.
- **Build verde**: ogni task termina con `npx next build` senza errori TypeScript.

---

## File Structure

**Nuovi file**
- `drizzle/migrations/0014_scheda_trattativa.sql` — migration colonne nuove + indice arretrati.
- `src/lib/briefing/normalize.ts` — normalizza botReport + confermeLeadSurveys nella stessa forma `LeadBriefing` per il venditore.
- `src/components/venditore/OutcomeGate.tsx` — overlay bloccante esiti arretrati.
- `src/components/venditore/LeadBriefingCard.tsx` — card briefing (riusata da workspace venditore).

**File modificati**
- `src/db/schema.ts` — colonne su `leads` e `confermeLeadSurveys` + indice.
- `src/lib/surveys/questions.ts` — costanti nuove (works, pain/urgency/budget, lista scarto canonica).
- `src/app/actions/surveyActions.ts` — payload + validazione `saveConfermeSurvey`; nessuna modifica a `saveSalesSurvey`.
- `src/app/actions/confermeActions.ts` — guardia Scheda in `setConfermeOutcome`.
- `src/app/actions/venditoreActions.ts` — `startNegotiation` (nuova), `getVenditoreAppointments` (+ `negotiationStartedAt`), guardie in `saveVenditoreOutcome`.
- `src/components/surveys/ConfermeSurveyDialog.tsx` — Parte A + Parte B, lista scarto canonica.
- `src/components/ConfermeDrawer.tsx` — Scheda obbligatoria all'esito; rimozione `<select>` scarto separato.
- `src/components/VenditoreDrawer.tsx` — sondaggio obbligatorio anche su "Chiuso".
- `src/app/(dashboard)/venditore/page.tsx` — query arretrati + render `OutcomeGate`.
- `src/components/VenditoreDashboardClient.tsx` — lista pre-check-in (solo logistica) + "Inizia trattativa" + workspace briefing.

---

## FASE 1 — Schema & costanti

### Task 1: Migration + colonne schema

**Files:**
- Create: `drizzle/migrations/0014_scheda_trattativa.sql`
- Modify: `src/db/schema.ts:165` (leads, dopo `salespersonUserId`) e `src/db/schema.ts:815` (confermeLeadSurveys, dopo `whyNot`)

**Interfaces:**
- Produces: `leads.negotiationStartedAt` (timestamptz, nullable); `confermeLeadSurveys` nuove colonne: `works` boolean, `summary` text, `painPoints` text[], `urgency` text, `budgetSignal` text, `objections` text[], `levaConsigliata` text; indice `leads_overdue_idx` su `(salespersonUserId, appointmentDate, salespersonOutcome)`.

- [ ] **Step 1: Aggiungere la colonna a `leads` in schema.ts**

In `src/db/schema.ts`, subito dopo la riga `salespersonUserId: text('salespersonUserId').references(() => users.id),` (riga ~165) inserire:

```ts
    // Check-in "Inizia trattativa": timbra quando il venditore apre il lead nel CRM
    // per condurre la trattativa. NULL = non ancora iniziata. Gatea l'accesso al
    // telefono/briefing lato venditore e l'esito non è registrabile se è NULL.
    negotiationStartedAt: timestamp('negotiationStartedAt', { withTimezone: true, mode: 'date' }),
```

- [ ] **Step 2: Aggiungere l'indice arretrati a `leads`**

Nel blocco indici di `leads` (la funzione `(table) => { return { ... } }`, righe ~182-190), aggiungere dopo `assignedRecallIdx`:

```ts
        overdueOutcomeIdx: index('leads_overdue_idx').on(table.salespersonUserId, table.appointmentDate, table.salespersonOutcome),
```

- [ ] **Step 3: Aggiungere i campi-briefing a `confermeLeadSurveys`**

In `src/db/schema.ts`, subito dopo la riga `whyNot: text('whyNot'), ...` (riga ~815) inserire:

```ts
    // Diagnosi/qualifica (Parte A)
    works: boolean('works'),                          // "lavora / non lavora"
    // Briefing venditore (Parte B) — stessa forma del botReport
    summary: text('summary'),
    painPoints: text('painPoints').array(),
    urgency: text('urgency'),                          // 'alta'|'media'|'bassa'
    budgetSignal: text('budgetSignal'),               // 'ok'|'incerto'|'no'
    objections: text('objections').array(),
    levaConsigliata: text('levaConsigliata'),
```

- [ ] **Step 4: Scrivere la migration SQL**

Creare `drizzle/migrations/0014_scheda_trattativa.sql`:

```sql
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "negotiationStartedAt" timestamptz;

ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "works" boolean;
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "painPoints" text[];
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "urgency" text;
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "budgetSignal" text;
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "objections" text[];
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "levaConsigliata" text;

CREATE INDEX IF NOT EXISTS "leads_overdue_idx" ON "leads" ("salespersonUserId", "appointmentDate", "salespersonOutcome");
```

- [ ] **Step 5: Applicare la migration al DB Supabase**

Applicare via Supabase MCP `apply_migration` (name: `scheda_trattativa`, query = contenuto del file) **oppure** chiedere a Bruno di eseguirla. Verificare con `list_migrations` che `0014` risulti applicata.

- [ ] **Step 6: Verifica build**

Run: `npx next build`
Expected: zero errori TypeScript (le nuove colonne sono opzionali, nessun call-site rotto).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle/migrations/0014_scheda_trattativa.sql
git commit -m "feat(schema): negotiationStartedAt + campi briefing confermeLeadSurveys + indice arretrati"
```

---

### Task 2: Costanti questions.ts (Parte A/B + lista scarto canonica)

**Files:**
- Modify: `src/lib/surveys/questions.ts:149-156` (sezione CONFERME)

**Interfaces:**
- Produces: `CONFERME_DISCARD_REASONS`, `CONFERME_PAIN_POINT_OPTIONS`, `CONFERME_URGENCY_OPTIONS`, `CONFERME_BUDGET_OPTIONS` e i tipi relativi. `CONFERME_WHY_NOT_OPTIONS` resta per retro-compat ma non più usato dalla UI.

- [ ] **Step 1: Sostituire/estendere la sezione CONFERME**

In `src/lib/surveys/questions.ts`, dopo il blocco `CONFERME_WHY_NOT_OPTIONS` (riga ~156) aggiungere:

```ts
// Lista canonica dei motivi "non confermato / scarto" — fusione del vecchio
// <select> di scarto (ConfermeDrawer) e dei whyNot del sondaggio. I value sono
// le STRINGHE STORICHE già persistite in leads.confirmationsDiscardReason:
// non vanno modificate, altrimenti i record passati perdono la label.
export const CONFERME_DISCARD_REASONS = [
    { value: 'non risponde', label: 'Non risponde' },
    { value: 'non interessato', label: 'Non interessato' },
    { value: 'non ha soldi', label: 'Non ha soldi' },
    { value: 'posticipa senza data', label: 'Posticipa senza data' },
    { value: 'disoccupato', label: 'Disoccupato' },
    { value: 'straniero', label: 'Straniero' },
    { value: 'solo informazioni', label: 'Solo informazioni' },
    { value: "non vuole prendere l'appuntamento", label: "Non vuole prendere l'appuntamento" },
    { value: 'numero inesistente', label: 'Numero inesistente' },
    { value: 'attaccato in faccia', label: 'Attaccato in faccia' },
    { value: 'non ha potere decisionale', label: 'Non ha potere decisionale' },
] as const;
export type ConfermeDiscardReason = typeof CONFERME_DISCARD_REASONS[number]['value'];

// Briefing venditore (Parte B) — opzioni tunabili da Bruno.
export const CONFERME_PAIN_POINT_OPTIONS = [
    { value: 'economico', label: 'Problema economico' },
    { value: 'lavoro_insoddisfatto', label: 'Insoddisfatto del lavoro' },
    { value: 'tempo', label: 'Mancanza di tempo' },
    { value: 'competenze', label: 'Mancano competenze' },
    { value: 'crescita', label: 'Vuole cambiare vita/crescere' },
] as const;
export type ConfermePainPoint = typeof CONFERME_PAIN_POINT_OPTIONS[number]['value'];

export const CONFERME_URGENCY_OPTIONS = [
    { value: 'alta', label: 'Alta' },
    { value: 'media', label: 'Media' },
    { value: 'bassa', label: 'Bassa' },
] as const;
export type ConfermeUrgency = typeof CONFERME_URGENCY_OPTIONS[number]['value'];

export const CONFERME_BUDGET_OPTIONS = [
    { value: 'ok', label: 'Sembra avere budget' },
    { value: 'incerto', label: 'Budget incerto' },
    { value: 'no', label: 'Budget assente' },
] as const;
export type ConfermeBudget = typeof CONFERME_BUDGET_OPTIONS[number]['value'];
```

- [ ] **Step 2: Verifica build**

Run: `npx next build`
Expected: zero errori (solo aggiunte).

- [ ] **Step 3: Commit**

```bash
git add src/lib/surveys/questions.ts
git commit -m "feat(surveys): costanti Scheda Trattativa Conferme (scarto canonico + briefing)"
```

---

## FASE 2 — Conferme: Scheda Trattativa obbligatoria

### Task 3: `saveConfermeSurvey` — payload esteso + validazione Parte A/B

**Files:**
- Modify: `src/app/actions/surveyActions.ts:288-373`

**Interfaces:**
- Consumes: `CONFERME_DISCARD_REASONS`, `CONFERME_PAIN_POINT_OPTIONS`, `CONFERME_URGENCY_OPTIONS`, `CONFERME_BUDGET_OPTIONS` (Task 2).
- Produces: `ConfermeSurveyPayload` con campi Parte A/B; `saveConfermeSurvey` valida e persiste i nuovi campi. Helper esportato `isConfermeSchedaComplete(row, opts)` (vedi sotto) usato da Task 4.

- [ ] **Step 1: Aggiornare l'import delle costanti**

In `src/app/actions/surveyActions.ts`, nell'import da `@/lib/surveys/questions`, aggiungere `CONFERME_DISCARD_REASONS, CONFERME_PAIN_POINT_OPTIONS, CONFERME_URGENCY_OPTIONS, CONFERME_BUDGET_OPTIONS` (mantenendo gli import esistenti). Leggere prima la riga di import per inserire i nomi senza duplicare.

- [ ] **Step 2: Estendere `ConfermeSurveyPayload`**

Sostituire l'interfaccia (righe ~288-294) con:

```ts
export interface ConfermeSurveyPayload {
    // Parte A — diagnosi/qualifica
    remembersAppt: boolean;
    watchedVideo: boolean;
    works?: boolean;                  // opzionale per non rompere il build finché il dialog (Task 5) non lo passa
    confirmed: boolean;
    whyNot: string | null;            // valore da CONFERME_DISCARD_REASONS quando confirmed=false
    // Parte B — briefing venditore (richiesto solo quando confirmed=true)
    summary?: string | null;
    painPoints?: string[];
    urgency?: string | null;
    budgetSignal?: string | null;
    objections?: string[];
    levaConsigliata?: string | null;
    fillDurationMs: number;
}
```

**Nota build-greenness:** i campi nuovi sono `?:` opzionali apposta — così il call-site attuale del dialog (non ancora aggiornato) continua a compilare. Nel corpo dell'action usare sempre i fallback (`payload.painPoints ?? []`, `payload.works ?? null`, ecc.). Dopo Task 5 il dialog li passa sempre.

- [ ] **Step 3: Aggiungere validazione + helper completezza**

Subito prima di `saveConfermeSurvey`, aggiungere l'helper riusato dalla guardia server:

```ts
// Una Scheda è completa per CONFERMA se ha Parte A piena + briefing (Parte B).
// È completa per SCARTO se ha Parte A piena + motivo valido. botReport presente
// soddisfa la Parte B (lead-bot: il briefing esiste già).
export function isConfermeSchedaComplete(
    row: { remembersAppt: boolean | null; watchedVideo: boolean | null; works: boolean | null; confirmed: boolean | null; whyNot: string | null; summary: string | null; painPoints: string[] | null; urgency: string | null } | null,
    opts: { outcome: 'confermato' | 'scartato'; hasBotReport: boolean },
): boolean {
    if (!row) return false;
    const partA = row.remembersAppt !== null && row.watchedVideo !== null && row.works !== null && row.confirmed !== null;
    if (!partA) return false;
    if (opts.outcome === 'scartato') {
        return row.confirmed === false && !!row.whyNot;
    }
    // confermato
    if (opts.hasBotReport) return true; // briefing già fornito dal bot
    return row.confirmed === true && !!row.summary && Array.isArray(row.painPoints) && row.painPoints.length > 0 && !!row.urgency;
}
```

- [ ] **Step 4: Aggiornare la validazione e l'upsert in `saveConfermeSurvey`**

Dentro `saveConfermeSurvey`, sostituire il blocco di validazione `whyNot` (righe ~305-310) con la validazione completa, e aggiungere i nuovi campi a `insert`/`update` (righe ~323-345). Validazione (dopo `assertSalesArea`/`requireRole`):

```ts
        // Validazione motivo (quando non confermato)
        if (payload.confirmed === false) {
            const valid = CONFERME_DISCARD_REASONS.map((o) => o.value) as readonly string[];
            if (!payload.whyNot || !valid.includes(payload.whyNot)) {
                return { success: false, error: "Motivo scarto non valido" };
            }
        }
        // Validazione briefing (quando confermato): pain points / urgenza dai set noti
        if (payload.confirmed === true) {
            const validPain = CONFERME_PAIN_POINT_OPTIONS.map((o) => o.value) as readonly string[];
            for (const p of (payload.painPoints ?? [])) if (!validPain.includes(p)) return { success: false, error: `Pain point non valido: ${p}` };
            const validUrg = CONFERME_URGENCY_OPTIONS.map((o) => o.value) as readonly string[];
            if (payload.urgency && !validUrg.includes(payload.urgency)) return { success: false, error: "Urgenza non valida" };
            const validBud = CONFERME_BUDGET_OPTIONS.map((o) => o.value) as readonly string[];
            if (payload.budgetSignal && !validBud.includes(payload.budgetSignal)) return { success: false, error: "Budget non valido" };
        }
```

Nei `db.insert(confermeLeadSurveys).values({...})` e `db.update(confermeLeadSurveys).set({...})`, aggiungere i campi (in entrambi i rami):

```ts
                works: payload.works ?? null,
                summary: payload.confirmed ? (payload.summary ?? null) : null,
                painPoints: payload.confirmed ? (payload.painPoints ?? []) : [],
                urgency: payload.confirmed ? (payload.urgency ?? null) : null,
                budgetSignal: payload.confirmed ? (payload.budgetSignal ?? null) : null,
                objections: payload.confirmed ? (payload.objections ?? []) : [],
                levaConsigliata: payload.confirmed ? (payload.levaConsigliata ?? null) : null,
```

(Mantenere `remembersAppt`, `watchedVideo`, `confirmed`, `whyNot`, `fillDurationMs`, `suspicious` come oggi; `whyNot` ora prende il valore canonico.)

- [ ] **Step 5: Verifica build**

Run: `npx next build`
Expected: errori SOLO nei call-site che costruiscono `ConfermeSurveyPayload` (il dialog, Task 6) → atteso. Se il dialog non è ancora aggiornato, build fallisce qui: in tal caso committare schema/action e completare Task 6 prima della verifica finale, oppure eseguire Task 6 nello stesso branch prima del build. Procedere a Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/surveyActions.ts
git commit -m "feat(conferme): saveConfermeSurvey con Parte A/B + helper isConfermeSchedaComplete"
```

---

### Task 4: Guardia Scheda obbligatoria in `setConfermeOutcome`

**Files:**
- Modify: `src/app/actions/confermeActions.ts:418-470`

**Interfaces:**
- Consumes: `isConfermeSchedaComplete`, `getConfermeSurveyByLead` (Task 3).
- Produces: `setConfermeOutcome` rifiuta con errore parlante se la Scheda non è completa per l'esito richiesto; popola `confirmationsDiscardReason` dal sondaggio quando scartato.

- [ ] **Step 1: Importare l'helper e il getter**

In `src/app/actions/confermeActions.ts` aggiungere agli import:

```ts
import { isConfermeSchedaComplete } from "@/lib/surveys/scheda"
import { getConfermeSurveyByLead } from "@/app/actions/surveyActions"
```

> Nota: `isConfermeSchedaComplete` vive in `src/lib/surveys/scheda.ts` (NON in surveyActions.ts), perché quel file è `"use server"` e non può esportare funzioni sincrone.

- [ ] **Step 2: Inserire la guardia prima dell'update**

In `setConfermeOutcome`, subito dopo il blocco optimistic-lock (`if (oldLead.version !== currentVersion) {...}`, riga ~438) e prima del FreeBusy check, inserire:

```ts
        // GUARDIA SCHEDA TRATTATIVA: niente esito senza sondaggio completo.
        const scheda = await getConfermeSurveyByLead(leadId);
        const hasBotReport = !!oldLead.botReport;
        if (!isConfermeSchedaComplete(scheda, { outcome, hasBotReport })) {
            return {
                success: false,
                error: outcome === 'confermato'
                    ? "Compila la Scheda Trattativa (diagnosi + briefing) prima di confermare."
                    : "Compila il sondaggio (diagnosi + motivo) prima di scartare.",
            };
        }
```

- [ ] **Step 3: Derivare il motivo di scarto dalla Scheda**

Nell'`db.update(leads).set({...})` (riga ~451), cambiare la riga `confirmationsDiscardReason: reason || null,` in:

```ts
            confirmationsDiscardReason: outcome === 'scartato' ? (scheda?.whyNot ?? reason ?? null) : null,
```

(Così il motivo arriva dal sondaggio; `reason` resta fallback per retro-compat dei call-site esistenti.)

- [ ] **Step 4: Verifica build**

Run: `npx next build`
Expected: zero errori (la firma di `setConfermeOutcome` non cambia).

- [ ] **Step 5: Verifica manuale logica (script tsx)**

Creare uno script temporaneo in scratchpad che importa `isConfermeSchedaComplete` e asserisce: (a) `null → false`; (b) Parte A piena + confermato senza summary → false; (c) confermato + summary + painPoints + urgency → true; (d) confermato + hasBotReport → true anche senza summary; (e) scartato + whyNot → true; (f) scartato senza whyNot → false. Run: `npx tsx <path>`. Expected: tutte le asserzioni passano. Eliminare lo script.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/confermeActions.ts
git commit -m "feat(conferme): setConfermeOutcome esige Scheda Trattativa completa (conferma/scarto)"
```

---

### Task 5: `ConfermeSurveyDialog` — Parte A/B + bivio "ha confermato?"

**Files:**
- Modify: `src/components/surveys/ConfermeSurveyDialog.tsx` (intero)

**Interfaces:**
- Consumes: `CONFERME_DISCARD_REASONS`, `CONFERME_PAIN_POINT_OPTIONS`, `CONFERME_URGENCY_OPTIONS`, `CONFERME_BUDGET_OPTIONS`; `ConfermeSurveyPayload` esteso (Task 3).
- Produces: dialog che raccoglie Parte A sempre, Parte B quando `confirmed=true`, e i motivi canonici quando `confirmed=false`; `canSave` riflette le regole.

- [ ] **Step 1: Aggiornare import e stato**

Sostituire l'import `CONFERME_WHY_NOT_OPTIONS` con le quattro costanti nuove. Aggiungere stati: `works` (boolean|null), `summary` (string), `painPoints` (string[]), `urgency` (string|null), `budgetSignal` (string|null), `objections` (string — textarea, una obiezione per riga), `levaConsigliata` (string). Inizializzarli a null/''/[] e prefillarli dall'`existing` nel `useEffect` (mappare `existing.painPoints ?? []`, `existing.objections?.join('\n') ?? ''`, ecc.).

- [ ] **Step 2: Aggiornare `canSave`**

```ts
    const canSave =
        remembersAppt !== null &&
        watchedVideo !== null &&
        works !== null &&
        confirmed !== null &&
        (confirmed === true
            ? (summary.trim().length > 0 && painPoints.length > 0 && urgency !== null)
            : whyNot !== null);
```

- [ ] **Step 3: Aggiornare il payload in `handleSave`**

```ts
        const res = await saveConfermeSurvey(leadId, {
            remembersAppt: remembersAppt!,
            watchedVideo: watchedVideo!,
            works: works!,
            confirmed: confirmed!,
            whyNot: confirmed ? null : whyNot,
            summary: confirmed ? summary.trim() : null,
            painPoints: confirmed ? painPoints : [],
            urgency: confirmed ? urgency : null,
            budgetSignal: confirmed ? budgetSignal : null,
            objections: confirmed ? objections.split('\n').map(s => s.trim()).filter(Boolean) : [],
            levaConsigliata: confirmed ? (levaConsigliata.trim() || null) : null,
            fillDurationMs: Date.now() - startedAt,
        });
```

- [ ] **Step 4: Aggiornare la UI del corpo**

Dopo `<YesNoRow label="Ha visto il video?" .../>`, aggiungere `<YesNoRow label="Lavora?" value={works} onChange={setWorks} />`. Mantenere la riga "Ha confermato?". Sostituire il blocco `confirmed === false` (motivi) per iterare su `CONFERME_DISCARD_REASONS` invece di `CONFERME_WHY_NOT_OPTIONS` (stesso markup a chip). Aggiungere un blocco `confirmed === true` con: textarea "Riassunto situazione" (→ `summary`), chip multi-select pain points (`CONFERME_PAIN_POINT_OPTIONS`, toggle dentro `painPoints[]`), chip single urgenza (`CONFERME_URGENCY_OPTIONS`), chip single budget (`CONFERME_BUDGET_OPTIONS`), textarea "Obiezioni (una per riga)" (→ `objections`), input "Leva consigliata" (→ `levaConsigliata`). Riusare le classi Tailwind dei chip esistenti (border-brand-orange/bg-brand-orange) per coerenza. Aggiornare il titolo header a "📋 Scheda Trattativa".

- [ ] **Step 5: Verifica build**

Run: `npx next build`
Expected: zero errori TypeScript (il payload combacia con Task 3).

- [ ] **Step 6: Verifica manuale UI**

Avviare `npm run dev`, entrare come account Conferme, aprire un lead appuntamento → "Sondaggio". Verificare: compaiono "Lavora?"; scegliendo "Ha confermato? = No" appare la lista canonica dei motivi; scegliendo "Sì" appaiono riassunto/pain/urgenza/budget/obiezioni/leva; "Salva" disabilitato finché Parte A (+ B se confermato) non è completa.

- [ ] **Step 7: Commit**

```bash
git add src/components/surveys/ConfermeSurveyDialog.tsx
git commit -m "feat(conferme): ConfermeSurveyDialog → Scheda Trattativa (Parte A/B, motivi canonici)"
```

---

### Task 6: `ConfermeDrawer` — Scheda come step obbligatorio, via il `<select>` scarto

**Files:**
- Modify: `src/components/ConfermeDrawer.tsx` (zona esito ~860-900 e handler ~236-253)

**Interfaces:**
- Consumes: la guardia server (Task 4) e il dialog (Task 5).
- Produces: il flusso esito Conferme passa dalla Scheda; lo scarto non ha più input separato; gli errori della guardia sono mostrati all'utente.

- [ ] **Step 1: Leggere il file e localizzare i punti**

Leggere `src/components/ConfermeDrawer.tsx` attorno alle righe 70-90 (stato `discardReason`), 236-255 (handler conferma/scarto che chiama `setConfermeOutcome`), 860-900 (radio scartato/confermato + `<select>`), 480-495 (pulsante "Sondaggio") e 982 (montaggio `ConfermeSurveyDialog`).

- [ ] **Step 2: Rimuovere il `<select>` scarto e il check `!discardReason`**

Eliminare il blocco `{outcome === "scartato" && (<div>…<select>…</select></div>)}` (righe ~867-882). Nell'handler (riga ~236), rimuovere `if (outcome === "scartato" && !discardReason) return alert("Inserisci motivo scarto");`. Nella chiamata a `setConfermeOutcome` (riga ~253) passare `undefined` come `reason` (il server lo deriva dalla Scheda): `setConfermeOutcome(lead.id, localVersion, outcome as ..., undefined, salesperson)`.

- [ ] **Step 3: Gestire l'errore-guardia mostrandolo e aprendo la Scheda**

Nell'handler, dopo aver ricevuto `result`, se `!result.success` e `result.error` contiene "Scheda" o "sondaggio", aprire il dialog Scheda (settare lo stato che controlla `ConfermeSurveyDialog open`) e mostrare il messaggio. Esempio (adattare ai nomi di stato reali nel file):

```ts
            if (!result.success) {
                if (/scheda|sondaggio/i.test(result.error || "")) {
                    setSurveyOpen(true); // apre ConfermeSurveyDialog
                }
                alert(result.error || "Errore");
                return;
            }
```

- [ ] **Step 4: Etichettare il pulsante "Sondaggio" come step obbligatorio**

Cambiare la label del pulsante (riga ~492) da "Sondaggio" a "📋 Scheda Trattativa" e, opzionale, evidenziarlo (es. ring brand-orange) quando `lead.confirmationsOutcome` è nullo e la scheda non risulta compilata, per segnalare che va fatto prima dell'esito.

- [ ] **Step 5: Verifica build**

Run: `npx next build`
Expected: zero errori. Se `discardReason`/`setDiscardReason` restano usati altrove, lasciarli; se diventano orfani, rimuoverne la dichiarazione (riga ~77) per evitare warning eslint.

- [ ] **Step 6: Verifica manuale E2E (Conferme)**

Dev server, account Conferme: provare a **confermare** un lead senza Scheda → bloccato con messaggio + dialog che si apre. Compilare la Scheda (confermato) → conferma riesce e assegna il venditore. Provare a **scartare** un altro lead senza Scheda → bloccato; compilare (No + motivo) → scarto riesce e `confirmationsDiscardReason` = motivo scelto (verificare nel DB o nella card "Scartato").

- [ ] **Step 7: Commit**

```bash
git add src/components/ConfermeDrawer.tsx
git commit -m "feat(conferme): Scheda Trattativa obbligatoria all'esito, rimosso select scarto separato"
```

---

## FASE 3 — Venditore: accesso gated (check-in + briefing)

### Task 7: `startNegotiation` + briefing query nel server

**Files:**
- Modify: `src/app/actions/venditoreActions.ts` (nuova action + `getVenditoreAppointments`)
- Create: `src/lib/briefing/normalize.ts`

**Interfaces:**
- Produces:
  - `startNegotiation(leadId: string): Promise<{ success: boolean; error?: string; phone?: string }>` — timbra `negotiationStartedAt` (idempotente: non sovrascrive se già valorizzato) e ritorna il telefono.
  - `getVenditoreAppointments` ritorna anche `negotiationStartedAt`.
  - `normalizeBriefing(input): LeadBriefing | null` con `LeadBriefing = { summary: string|null; painPoints: string[]; urgency: string|null; budgetSignal: string|null; objections: string[]; levaConsigliata: string|null; works: boolean|null; source: 'bot'|'conferme' }`.

- [ ] **Step 1: Creare il normalizer**

Creare `src/lib/briefing/normalize.ts`:

```ts
import type { BotReport } from "@/lib/bot-fissatore/types";

export interface LeadBriefing {
    summary: string | null;
    painPoints: string[];
    urgency: string | null;
    budgetSignal: string | null;
    objections: string[];
    levaConsigliata: string | null;
    works: boolean | null;
    source: 'bot' | 'conferme';
}

type SchedaRow = {
    works: boolean | null;
    summary: string | null;
    painPoints: string[] | null;
    urgency: string | null;
    budgetSignal: string | null;
    objections: string[] | null;
    levaConsigliata: string | null;
} | null;

// Preferisce la Scheda Conferme; se assente/vuota ma c'è il botReport, usa quello.
export function normalizeBriefing(scheda: SchedaRow, botReport: unknown): LeadBriefing | null {
    const schedaHas = scheda && (scheda.summary || (scheda.painPoints?.length ?? 0) > 0);
    if (schedaHas) {
        return {
            summary: scheda!.summary ?? null,
            painPoints: scheda!.painPoints ?? [],
            urgency: scheda!.urgency ?? null,
            budgetSignal: scheda!.budgetSignal ?? null,
            objections: scheda!.objections ?? [],
            levaConsigliata: scheda!.levaConsigliata ?? null,
            works: scheda!.works ?? null,
            source: 'conferme',
        };
    }
    if (botReport && typeof botReport === 'object') {
        const r = botReport as BotReport;
        return {
            summary: r.summary ?? null,
            painPoints: r.painPoints ?? [],
            urgency: r.urgency ?? null,
            budgetSignal: r.budgetSignal ?? null,
            objections: r.objections ?? [],
            levaConsigliata: r.levaConsigliata ?? null,
            works: scheda?.works ?? null,
            source: 'bot',
        };
    }
    return null;
}
```

- [ ] **Step 2: Aggiungere `startNegotiation` in venditoreActions.ts**

In fondo a `src/app/actions/venditoreActions.ts`:

```ts
export async function startNegotiation(leadId: string): Promise<{ success: boolean; error?: string; phone?: string }> {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role)) {
        return { success: false, error: "Unauthorized" };
    }
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
        eq(leads.salespersonUserId, supabaseUser.id),
    )))[0];
    if (!lead) return { success: false, error: "Lead non assegnato" };

    if (!lead.negotiationStartedAt) {
        await db.update(leads).set({ negotiationStartedAt: new Date() })
            .where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId)));
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "negotiation_started",
            userId: supabaseUser.id,
            timestamp: new Date(),
            metadata: null,
            companyId: ctx.companyId,
        });
    }
    revalidatePath('/venditore');
    return { success: true, phone: lead.phone };
}
```

(Nota: MANAGER/ADMIN possono non avere `salespersonUserId` sui lead; se serve l'accesso staff, allentare il filtro `salespersonUserId` per quei ruoli. Per v1 il check-in è azione del venditore assegnatario.)

- [ ] **Step 3: Esporre `negotiationStartedAt` in `getVenditoreAppointments`**

Nel `.select({...})` di `getVenditoreAppointments` (righe ~18-40) aggiungere `negotiationStartedAt: leads.negotiationStartedAt,`.

- [ ] **Step 4: Verifica build**

Run: `npx next build`
Expected: zero errori (`BotReport` già esiste in `src/lib/bot-fissatore/types.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/venditoreActions.ts src/lib/briefing/normalize.ts
git commit -m "feat(venditore): startNegotiation (check-in) + normalizeBriefing + negotiationStartedAt nella query"
```

---

### Task 8: `LeadBriefingCard` + workspace gated nel dashboard venditore

**Files:**
- Create: `src/components/venditore/LeadBriefingCard.tsx`
- Modify: `src/components/VenditoreDashboardClient.tsx`

**Interfaces:**
- Consumes: `LeadBriefing` (Task 7), `startNegotiation`, label da `CONFERME_PAIN_POINT_OPTIONS`/`CONFERME_URGENCY_OPTIONS`/`CONFERME_BUDGET_OPTIONS`.
- Produces: la lista mostra solo nome+data/ora pre-check-in; "Inizia trattativa" rivela telefono + `LeadBriefingCard`; dopo il check-in si accede al form esito (VenditoreDrawer).

- [ ] **Step 1: Creare `LeadBriefingCard`**

Creare `src/components/venditore/LeadBriefingCard.tsx` (client) che riceve `briefing: LeadBriefing | null` e lo rende come card leggibile: titolo "📋 Briefing dalle Conferme" (o "🤖 Briefing dal bot" se `source==='bot'`), riassunto, lista pain points (mappare value→label con un helper locale che cerca in `CONFERME_PAIN_POINT_OPTIONS`, fallback al value grezzo per i botReport), urgenza, budget, obiezioni (lista), leva consigliata, e "Lavora: Sì/No" se `works !== null`. Se `briefing === null`, mostrare un avviso neutro "Nessun briefing disponibile". Stile coerente con la card "🤖 Report Bot" del `ConfermeDrawer` (riusare classi card esistenti).

- [ ] **Step 2: Leggere `VenditoreDashboardClient.tsx`**

Leggere il file per capire come è strutturata la vista LISTA e come si apre il drawer per un lead (stato selezionato + render `VenditoreDrawer`). Individuare dove mostrare nome/telefono del lead nella lista.

- [ ] **Step 3: Gating della lista pre-check-in**

Nella vista LISTA: per ogni lead **senza** `negotiationStartedAt`, mostrare solo nome + data/ora appuntamento e un pulsante `<button>` **"Inizia trattativa"** (mai dentro `<span>`). Nascondere il telefono. Per i lead **con** `negotiationStartedAt`, mostrare telefono + accesso al workspace/drawer come oggi.

- [ ] **Step 4: Handler "Inizia trattativa"**

Al click, chiamare `startNegotiation(lead.id)`; on success aprire il workspace del lead (lo stesso drawer/pannello che porta a esito) e mostrare `LeadBriefingCard` + telefono (dal `phone` ritornato o da `router.refresh()`). Usare `useTransition` per lo stato pending e `router.refresh()` per ricaricare `negotiationStartedAt`.

- [ ] **Step 5: Montare `LeadBriefingCard` nel workspace/drawer**

Mostrare `LeadBriefingCard` in cima al pannello di lavoro del lead (sopra il form esito). Il briefing va passato dal server: estendere la query/page che alimenta il client per includere la Scheda Conferme normalizzata (vedi nota sotto) — oppure caricarlo on-demand con un getter. **Scelta v1:** caricare on-demand al check-in con un piccolo server action `getLeadBriefing(leadId)` che fa `getConfermeSurveyByLead` + legge `leads.botReport` e ritorna `normalizeBriefing(...)`. Aggiungere `getLeadBriefing` in `venditoreActions.ts`:

```ts
export async function getLeadBriefing(leadId: string) {
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const lead = (await db.select({ botReport: leads.botReport }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId), eq(leads.id, leadId),
    )))[0];
    const { getConfermeSurveyByLead } = await import("@/app/actions/surveyActions");
    const scheda = await getConfermeSurveyByLead(leadId);
    const { normalizeBriefing } = await import("@/lib/briefing/normalize");
    return normalizeBriefing(scheda as any, lead?.botReport);
}
```

- [ ] **Step 6: Verifica build**

Run: `npx next build`
Expected: zero errori.

- [ ] **Step 7: Verifica manuale E2E (venditore entrata)**

Dev server, account venditore con un appuntamento assegnato: nella lista il telefono NON è visibile; "Inizia trattativa" rivela telefono + briefing compilato dalle Conferme (o dal bot). Ricaricando la pagina il lead resta "iniziato".

- [ ] **Step 8: Commit**

```bash
git add src/components/venditore/LeadBriefingCard.tsx src/components/VenditoreDashboardClient.tsx src/app/actions/venditoreActions.ts
git commit -m "feat(venditore): accesso gated — check-in rivela telefono + briefing (LeadBriefingCard)"
```

---

## FASE 4 — Venditore: gate arretrati + enforcement esito

### Task 9: Guardie server in `saveVenditoreOutcome`

**Files:**
- Modify: `src/app/actions/venditoreActions.ts:79-111`

**Interfaces:**
- Consumes: `getSalesSurveyByLead`, `EXCLUDED_FUNNEL`.
- Produces: `saveVenditoreOutcome` rifiuta l'esito se manca il check-in o (per Chiuso/Non chiuso non-database) se manca un sondaggio venditore completato non sospetto.

- [ ] **Step 1: Importare le dipendenze**

In `venditoreActions.ts` aggiungere import:

```ts
import { EXCLUDED_FUNNEL } from "@/lib/surveys/questions"
import { getSalesSurveyByLead } from "@/app/actions/surveyActions"
```

- [ ] **Step 2: Inserire le guardie dopo l'optimistic-lock**

In `saveVenditoreOutcome`, dopo il check `if (currentVersion !== undefined && oldLead.version !== currentVersion) {...}` (riga ~88) e prima dell'`db.update`:

```ts
    // GUARDIA 1: niente esito senza check-in "Inizia trattativa".
    if (!oldLead.negotiationStartedAt) {
        return { success: false, error: "Avvia la trattativa (Inizia trattativa) prima di registrare l'esito." };
    }

    // GUARDIA 2: sondaggio obbligatorio su Chiuso/Non chiuso (funnel ≠ database).
    const needsSurvey = (payload.outcome === 'Chiuso' || payload.outcome === 'Non chiuso')
        && oldLead.funnel !== EXCLUDED_FUNNEL;
    if (needsSurvey) {
        const survey = await getSalesSurveyByLead(leadId);
        if (!survey || survey.suspicious) {
            return { success: false, error: "Compila il sondaggio lead (3 blocchi) prima di salvare l'esito." };
        }
    }
```

- [ ] **Step 3: Verifica build**

Run: `npx next build`
Expected: zero errori.

- [ ] **Step 4: Verifica manuale logica**

Dev server: tentare `saveVenditoreOutcome` su lead senza check-in → errore guardia 1. Su lead con check-in, esito "Chiuso" senza sondaggio → errore guardia 2. Con sondaggio salvato → esito passa.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/venditoreActions.ts
git commit -m "feat(venditore): saveVenditoreOutcome esige check-in + sondaggio (anche su Chiuso)"
```

---

### Task 10: `VenditoreDrawer` — sondaggio obbligatorio anche su "Chiuso", ordine salvataggio

**Files:**
- Modify: `src/components/VenditoreDrawer.tsx` (useMemo ~57-69, validazione ~89-105, salvataggio ~131-143, render inline ~364-372)

**Interfaces:**
- Consumes: guardie server (Task 9).
- Produces: il drawer mostra il sondaggio inline per Chiuso E Non chiuso (funnel≠database), lo valida lato client, e salva il sondaggio PRIMA dell'esito.

- [ ] **Step 1: Leggere il file**

Leggere `src/components/VenditoreDrawer.tsx` per i nomi esatti di stato/useMemo (`surveyRequired`, `surveyValid`, handler di salvataggio, render `VenditoreSurveyInline`).

- [ ] **Step 2: Estendere `surveyRequired` a "Chiuso"**

Cambiare il `useMemo` `surveyRequired` (righe ~57-69) perché sia true quando `outcome === 'Chiuso' || outcome === 'Non chiuso'` e funnel ≠ `'database'` (oggi è solo "Non chiuso"). Mantenere `surveyValid` invariato (controlla i 3 blocchi).

- [ ] **Step 3: Mostrare il sondaggio inline anche su "Chiuso"**

Nel render (righe ~364-372), la condizione che mostra `VenditoreSurveyInline` deve seguire `surveyRequired` (quindi appare anche per "Chiuso"), non più la sola condizione "Non chiuso".

- [ ] **Step 4: Garantire l'ordine: sondaggio prima dell'esito**

Nell'handler di salvataggio (righe ~89-143): mantenere il blocco client `if (surveyRequired && !surveyValid) { alert(...); return; }`. Assicurarsi che `saveSalesSurvey(...)` venga chiamato e atteso con successo **prima** di `saveVenditoreOutcome(...)`. Se oggi l'ordine è invertito (survey dopo outcome, righe ~131-143), riordinare: prima `const sres = await saveSalesSurvey(...)`, se `!sres.success` mostrare errore e `return`; poi `await saveVenditoreOutcome(...)`. Così la guardia 2 (Task 9) trova il sondaggio già persistito.

- [ ] **Step 5: Verifica build**

Run: `npx next build`
Expected: zero errori.

- [ ] **Step 6: Verifica manuale E2E**

Dev server, venditore: lead con check-in, esito "Chiuso" → il sondaggio inline appare ed è obbligatorio; salvando senza compilarlo → bloccato; compilandolo → esito salvato. Ripetere per "Non chiuso". Per "Sparito" → nessun sondaggio richiesto.

- [ ] **Step 7: Commit**

```bash
git add src/components/VenditoreDrawer.tsx
git commit -m "feat(venditore): sondaggio obbligatorio anche su Chiuso + salvataggio sondaggio prima dell'esito"
```

---

### Task 11: `OutcomeGate` — overlay bloccante arretrati

**Files:**
- Create: `src/components/venditore/OutcomeGate.tsx`
- Modify: `src/app/(dashboard)/venditore/page.tsx`

**Interfaces:**
- Consumes: `getVenditoreAppointments` (con `negotiationStartedAt`), `OVERDUE_GRACE_HOURS`.
- Produces: overlay full-screen non chiudibile quando esistono lead arretrati; ogni riga apre il flusso esito; a 0 arretrati sparisce.

- [ ] **Step 1: Definire la costante grazia**

In `src/lib/surveys/questions.ts` (o un `src/lib/venditore/constants.ts` nuovo) esportare:

```ts
export const OVERDUE_GRACE_HOURS = 2;
```

- [ ] **Step 2: Leggere la page venditore**

Leggere `src/app/(dashboard)/venditore/page.tsx` per capire come carica i dati (server component) e come monta `VenditoreDashboardClient`.

- [ ] **Step 3: Calcolare gli arretrati lato server**

Nella page (server component), dopo aver ottenuto gli appuntamenti del venditore, calcolare:

```ts
const graceMs = OVERDUE_GRACE_HOURS * 3600 * 1000;
const now = Date.now();
const overdue = appointments.filter(a =>
    a.appointmentDate && !a.salespersonOutcome &&
    (now - new Date(a.appointmentDate).getTime()) > graceMs
);
```

Passare `overdue` (id, name, phone, appointmentDate) al client.

- [ ] **Step 4: Creare `OutcomeGate`**

Creare `src/components/venditore/OutcomeGate.tsx` (client): overlay `fixed inset-0 z-[100]` con backdrop opaco, **senza** onClick di chiusura, senza X, e che intercetta ESC (`useEffect` su keydown che fa `preventDefault` su Escape). Titolo "Hai N esiti da registrare prima di continuare". Lista delle lead arretrate (nome, data/ora) ognuna con `<button>` "Registra esito" che apre il `VenditoreDrawer` per quel lead (riusare il drawer del client). Al salvataggio esito → `router.refresh()`; quando la prop `overdue` arriva vuota, il componente ritorna `null`.

- [ ] **Step 5: Montare il gate sopra la dashboard**

Renderizzare `<OutcomeGate overdue={overdue} />` nella page sopra `VenditoreDashboardClient`. Poiché il gate è `fixed`/`z-[100]`, copre la dashboard finché `overdue.length > 0`.

- [ ] **Step 6: Verifica build**

Run: `npx next build`
Expected: zero errori.

- [ ] **Step 7: Verifica manuale E2E**

Dev server, venditore con almeno un appuntamento con `appointmentDate` di ieri e nessun esito: all'apertura di `/venditore` compare l'overlay bloccante; non si chiude con ESC/click fuori; "Registra esito" → flusso check-in/esito/sondaggio; registrato l'ultimo arretrato → overlay sparisce e la dashboard è di nuovo usabile.

- [ ] **Step 8: Commit**

```bash
git add src/components/venditore/OutcomeGate.tsx src/app/(dashboard)/venditore/page.tsx src/lib/surveys/questions.ts
git commit -m "feat(venditore): OutcomeGate — overlay bloccante sugli esiti arretrati"
```

---

## Verifica finale & deploy

- [ ] **Build completa**: `npx next build` verde.
- [ ] **E2E manuale completo** del loop: Conferme compila Scheda → conferma+assegna; venditore vede lista senza telefono → "Inizia trattativa" rivela briefing+telefono → registra esito+sondaggio; lead arretrato fa comparire il gate.
- [ ] **Deploy**: push su `main` → Vercel (`crm-sales-fenice`), verificare deploy READY via Vercel MCP.
- [ ] **Memory update**: creare file memoria `project_scheda_trattativa.md` + voce in `MEMORY.md` (LIVE + commit).

---

## Self-Review (copertura spec)

- §3 Gate arretrati → Task 11 (+ grazia Task 11 Step 1). ✓
- §4 Scheda Conferme (modello, Parte A/B, idee TL #1/#2/#3, enforcement, briefing normalizzato) → Task 1,2,3,4,5,6 + normalizer Task 7. ✓
- §5 Accesso venditore (check-in, telefono gated, workspace) → Task 7,8. Trattative **solo da remoto** → telefono dietro check-in (Task 8 Step 3). ✓
- §6 Enforcement esito (check-in + sondaggio anche Chiuso, ordine atomico) → Task 9,10. ✓
- §8 Edge cases: database→no survey (Task 9 guardia 2), Sparito→no survey (Task 9/10), lead-bot→briefing da botReport (normalizer Task 7 + helper completezza Task 3), appuntamento slittato→check-in libero (Task 7), indice arretrati (Task 1). ✓
- §10 Motivi scarto canonici risolti da lettura codice (Task 2, valori storici preservati). ✓
- Scope gate solo `/venditore` (Approccio A) → Task 11 monta nella sola page venditore. ✓
