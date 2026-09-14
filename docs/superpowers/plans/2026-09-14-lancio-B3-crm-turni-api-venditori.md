# Lancio Web Dev AI — Blocco B3 (CRM: turni, API bot, venditori, Conferme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare al bot tre API firmate (`slots`, `book`, `call-now`) che la sera del 5/10/2026 distribuiscono i lead del lancio fra i venditori di turno (round robin, appuntamenti mattina già confermati) e le Conferme (pomeriggio/dopodomani), più la pagina admin `/lancio` (turni + copertura + monitor), la scheda venditore "Lancio: chiamate subito" e il badge LANCIO nelle Conferme.

**Architecture:** Tutta la logica decisionale (regole di ammissibilità di `at`, ore libere, round robin, ciclo NR delle chiamate subito) vive in moduli puri sotto `src/lib/lancio/` senza DB, testati con `node --test`; le date del lancio stanno in una sola costante `LANCIO_WEBDEV`. L'accesso al DB sta in `src/lib/lancio/*Queries.ts` / `booking.ts` (moduli normali, NON `"use server"`), le tre route `/api/bot/lancio/*` fanno solo HMAC + guardie + chiamata, e le Server Action in `src/app/actions/lancioActions.ts` servono la UI. Google Calendar e webhook marketing partono in `after()`. Le notifiche usano la tabella `notifications` (il trigger della migrazione 0019 le spinge già sul topic `user:<id>` del bus Broadcast: nessun canale nuovo).

**Tech Stack:** Next.js 16 App Router, Drizzle ORM su Supabase Postgres (migrazioni SQL a mano), Tailwind (preset `bg-brand-orange`), `node --import tsx --test`, `tsc`.

**Spec:** `docs/superpowers/specs/2026-09-14-lancio-webdev-ottobre-design.md` — sezioni §3.1 (tabella `launchShifts`, eventi), §4.2 (API), §4.3 (`/lancio`), §4.4 (scheda venditore), §4.5 (Conferme), §6.2 (codici di risposta).

## Global Constraints

- **Prerequisito duro: B1 mergiato su `main`.** B1 aggiunge a `leads` le colonne `lancioIngresso`, `lancioScelta`, `lancioSceltaAt`, `lancioCallNowAttempts`, `lancioCallNowNextAt`, `lancioBotInfo` con la migrazione `0036_*`. Questo piano usa la **`0037`** (l'ultima esistente oggi è `0035_sales_week_template.sql`; B1 prende la `0036`). Task 0 verifica che le colonne esistano in `src/db/schema.ts` prima di partire.
- Migrazioni **a mano** in `drizzle/migrations/` (`drizzle-kit generate` inutilizzabile) e applicate su Supabase PRIMA del deploy.
- Bucket `LANCIO_WEBDEV_2026`, funnel `Lancio Web Dev AI`, webinar `2026-10-05T21:00:00+02:00`, giorno dopo `2026-10-06`, dopodomani `2026-10-07`: una sola costante `LANCIO_WEBDEV` in `src/lib/lancio/config.ts`. Ore venditori `[9..14]`, ore pomeriggio `[15..20]`.
- Regole dure di `at`: 6/10 ore tonde 9-20 (9-14 venditori, 15-20 Conferme); 7/10 ore tonde 9-14 (Conferme); sempre `at ≥ now + 1h`. Tutto il resto → `422 { ok:false, motivo:'fuori_regole' }`.
- Le tre API rispondono in **< 3 s**: niente chiamate esterne in linea; Google Calendar e webhook marketing in `after()`.
- HMAC identico alle altre rotte bot: header `x-bot-signature`, `verifySignature(rawBody, sig, process.env.BOT_WEBHOOK_SECRET)` da `@/lib/marketing-webhooks/signing`. Il middleware lascia già passare `/api/bot/*` senza sessione.
- Il calendario venditori (`salesAvailabilitySlots`, `salesSlotBlocks`, `salesWeekPlans`) è **per-utente**: le letture NON filtrano `companyId` (nota in `schema.ts:1519-1536`). Gli appuntamenti "busy" di un venditore si leggono senza `companyId`, come fa `checkBookingAllowed`.
- Round robin su `launchShifts`: `ORDER BY coalesce(lastAssignedAt,'epoch'), salesUserId`.
- File `"use server"` esportano SOLO `async function`: tipi e costanti stanno nei moduli di `src/lib/lancio/`.
- UI: Tailwind coerente con il resto (`bg-brand-orange`, `text-ash-*`, `rounded-xl`, `shadow-soft`); nessun `<button>` dentro `<span>`/`<p>` (WSOD in hydration).
- Codici API (§6.2): `book` → `200 { ok, kind, venditore?, deduped? }` · `409 { ok:false, motivo:'ora_esaurita', slots }` · `422 fuori_regole` · `403` lead non del lancio. `call-now` → `200 { ok, venditore }` · `409 { ok:false, motivo:'nessun_venditore' }` · `403`. `slots` → `200`.
- Ogni task finisce con `npx tsc --noEmit` verde e `npm test` verde; ogni nuovo `*.test.ts` va aggiunto alla riga `"test"` di `package.json`.
- Commit piccoli, in italiano, senza push automatico (il push a `main` è deploy in produzione: lo decide Bruno a fine blocco).

---

## File Structure

**Creati**
- `drizzle/migrations/0037_launch_shifts.sql` — tabella `launchShifts`.
- `src/lib/lancio/config.ts` — `LANCIO_WEBDEV` (date/ore) + tipi `LancioScelta`, `LancioBotInfo`; ri-esporta `LANCIO_BUCKET`/`LANCIO_FUNNEL`/`LANCIO_SLUG`/`LANCIO_COMPANY` da `intake.ts` (B1), non li ridefinisce.
- `src/lib/lancio/conferme.ts` + `conferme.test.ts` — regole pure della board Conferme (`isLeadLancio`, `isCallNowHandoff`, `lancioPriority`, `lancioFirst`, `lancioSceltaLabel`, `lancioBotRisposte`).
- `src/lib/lancio/rules.ts` + `rules.test.ts` — ammissibilità di `at` (`classifyAt`), chiave ora (`hourKey`), dedup (`sameInstant`).
- `src/lib/lancio/slots.ts` + `slots.test.ts` — ore libere della mattina da fatti già letti (`mattinaSlots`), round robin puro (`pickRoundRobin`).
- `src/lib/lancio/callNow.ts` + `callNow.test.ts` — ciclo NR delle chiamate subito (`nextCallNowState`, `callNowColumn`, `handoffAppointmentAt`).
- `src/lib/lancio/shiftQueries.ts` — lettura turni + disponibilità dei venditori del turno (DB).
- `src/lib/lancio/booking.ts` — `bookLancio`, `assignCallNow` (DB, transazioni, advisory lock) + side effect `after()`.
- `src/lib/lancio/botGuard.ts` — HMAC + caricamento/guardia del lead lancio, condiviso dalle 3 route.
- `src/lib/lancio/monitor.ts` — contatori del monitor (DB).
- `src/app/api/bot/lancio/slots/route.ts`, `book/route.ts`, `call-now/route.ts`.
- `src/app/actions/lancioActions.ts` — Server Action per `/lancio` e per la scheda venditore.
- `src/app/(dashboard)/lancio/page.tsx`, `LancioClient.tsx`.
- `src/components/venditore/LancioCallNowTab.tsx`.

**Modificati**
- `src/db/schema.ts` — `launchShifts`.
- `package.json` — nuovi test nella riga `test`.
- `src/components/Sidebar.tsx` — voce "Lancio Web Dev" (ADMIN/MANAGER).
- `src/app/actions/venditoreActions.ts` — `getVenditoreAppointments` espone `lancioScelta`.
- `src/app/(dashboard)/venditore/page.tsx` — OutcomeGate esclude `chiamata_subito`.
- `src/components/VenditoreDashboardClient.tsx` — tab "Lancio" + esclusione dalla Lista (Task 10); atterraggio da `?view=lancio` (Task 11).
- `src/lib/venditore/latePenaltiesRunner.ts` — esclusione multe.
- `src/app/actions/confermeActions.ts` — `getConfermeAppointments` ordina i lead lancio in cima (`lancioFirst`, sort stabile).
- `src/components/ConfermeBoard.tsx`, `ConfermeBoardRow.tsx`, `ConfermeDrawer.tsx` — badge LANCIO in riga e in Confermati (con venditore), blocco "Dal bot – lancio" nel tab Note.
- `src/components/Topbar.tsx` — routing delle notifiche `lancio_call_now` e `lancio_appuntamento`.

---

### Task 0: Verifica prerequisiti B1

**Files:**
- Read: `src/db/schema.ts`, `drizzle/migrations/`

- [ ] **Step 1: Verifica che B1 sia a bordo**

Run: `grep -n "lancioScelta\|lancioBotInfo\|lancioCallNowAttempts\|lancioCallNowNextAt\|lancioIngresso\|lancioSceltaAt" src/db/schema.ts && ls drizzle/migrations | tail -3 && grep -n "export const LANCIO_BUCKET\|export const LANCIO_FUNNEL\|export const LANCIO_SLUG\|export const LANCIO_COMPANY" src/lib/lancio/intake.ts`
Expected: 6 colonne trovate nel blocco `leads`, l'ultima migrazione è la `0036_*` di B1, e `src/lib/lancio/intake.ts` esporta le quattro costanti `LANCIO_BUCKET`, `LANCIO_FUNNEL`, `LANCIO_SLUG`, `LANCIO_COMPANY` (nota di riconciliazione `2026-09-14-lancio-00-riconciliazione-interfacce.md`: `config.ts` di Task 2 le importa da lì).

Se una delle sei colonne manca, o `intake.ts` non esiste: **FERMATI** e segnala al PO che B1 va eseguito prima. Non aggiungere le colonne da qui (sarebbero duplicate nella migrazione di B1) e non creare `intake.ts` da qui (lo crea B1 Task 2 con i suoi test).

- [ ] **Step 2: Baseline verde**

Run: `npx tsc --noEmit && npm test`
Expected: entrambi verdi prima di toccare qualsiasi file.

---

### Task 1: Migrazione + schema `launchShifts`

**Files:**
- Create: `drizzle/migrations/0037_launch_shifts.sql`
- Modify: `src/db/schema.ts` (dopo `launchPools`, ~riga 1015)

**Interfaces:**
- Produces: tabella Drizzle `launchShifts` con colonne `id, companyId, bucket, kind ('SERA'|'GIORNO_DOPO'), salesUserId, lastAssignedAt, removedAt, removedBy, createdBy, createdAt`; unique `(bucket, kind, salesUserId)`.

Nota di deviazione dalla spec (§3.1): `leadEvents.leadId` è `NOT NULL` con FK su `leads`, quindi l'evento `LANCIO_SHIFT_CHANGED` non può vivere lì (un cambio turno non ha un lead). Si tiene la storia sulla tabella stessa con `removedAt/removedBy` (soft delete): chi c'era, chi lo ha messo, chi lo ha tolto. I lettori (round robin, copertura) filtrano `removedAt IS NULL`. Rimettere un venditore tolto riattiva la riga (l'unique lo impone) e conserva il suo `lastAssignedAt`.

- [ ] **Step 1: Scrivi la migrazione**

```sql
-- 0037: turni venditori del lancio Web Dev AI (spec 2026-09-14 §3.1).
--
-- Una riga = un venditore in un turno. kind: 'SERA' (chiamate subito la sera
-- del webinar) | 'GIORNO_DOPO' (appuntamenti 9-15 del giorno dopo).
-- Il round robin ordina per coalesce(lastAssignedAt,'epoch'), salesUserId.
--
-- removedAt/removedBy al posto di un DELETE: leadEvents richiede un leadId e un
-- cambio di turno non ne ha, quindi la storia sta qui. Chi legge filtra
-- removedAt IS NULL; rimettere un venditore riattiva la riga (unique).

create table if not exists public."launchShifts" (
  "id"             text primary key,
  "companyId"      text not null default 'fenice' references public.companies(id) on update cascade,
  "bucket"         text not null,
  "kind"           text not null,
  "salesUserId"    text not null references public.users(id) on delete cascade,
  "lastAssignedAt" timestamptz,
  "removedAt"      timestamptz,
  "removedBy"      text references public.users(id),
  "createdBy"      text references public.users(id),
  "createdAt"      timestamptz not null default now()
);

create unique index if not exists "launch_shifts_uq"
  on public."launchShifts" ("bucket", "kind", "salesUserId");
create index if not exists "launch_shifts_bucket_kind_idx"
  on public."launchShifts" ("companyId", "bucket", "kind");

comment on table public."launchShifts" is
  'Turni venditori dei lanci: SERA = chiamate subito, GIORNO_DOPO = appuntamenti mattina. Round robin su lastAssignedAt.';
```

- [ ] **Step 2: Aggiungi la tabella a `src/db/schema.ts`** subito dopo `launchPools`

```ts
// Turni venditori dei lanci (spec 2026-09-14 §3.1, migrazione 0037).
// kind: 'SERA' | 'GIORNO_DOPO'. Soft delete con removedAt: la storia dei turni
// sta qui perché leadEvents esige un leadId. Round robin: vedi lib/lancio/slots.ts.
export const launchShifts = pgTable('launchShifts', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    bucket: text('bucket').notNull(),
    kind: text('kind').notNull(),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    lastAssignedAt: timestamp('lastAssignedAt', { withTimezone: true, mode: 'date' }),
    removedAt: timestamp('removedAt', { withTimezone: true, mode: 'date' }),
    removedBy: text('removedBy').references(() => users.id),
    createdBy: text('createdBy').references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => {
    return {
        shiftUnique: uniqueIndex('launch_shifts_uq').on(table.bucket, table.kind, table.salesUserId),
        bucketKindIdx: index('launch_shifts_bucket_kind_idx').on(table.companyId, table.bucket, table.kind),
    };
});
```

- [ ] **Step 3: Compila**

Run: `npx tsc --noEmit`
Expected: verde.

- [ ] **Step 4: Applica la migrazione su Supabase** (con il MCP `supabase` `apply_migration`, nome `0037_launch_shifts`, o dalla SQL console) e verifica:

Run (SQL): `select count(*) from public."launchShifts";`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0037_launch_shifts.sql src/db/schema.ts
git commit -m "feat(lancio): tabella launchShifts per i turni venditori del lancio (migr. 0037)"
```

---

### Task 2: Configurazione e regole pure di ammissibilità (`config.ts`, `rules.ts`)

**Files:**
- Create: `src/lib/lancio/config.ts`
- Create: `src/lib/lancio/rules.ts`
- Test: `src/lib/lancio/rules.test.ts`
- Modify: `package.json` (riga `test`)

**Interfaces:**
- Consumes: `romeInstant`, `romeHour` da `@/lib/venditore/calendarSlots`; `toRomeDateStr` da `@/lib/dateUtils`; `LANCIO_BUCKET`, `LANCIO_FUNNEL`, `LANCIO_SLUG`, `LANCIO_COMPANY` da `./intake` (B1 Task 2, verificato in Task 0).
- Produces:
  - Ri-esportazioni `LANCIO_BUCKET`, `LANCIO_FUNNEL`, `LANCIO_SLUG`, `LANCIO_COMPANY` (stesse costanti di `intake.ts`: chi sta in `src/lib/lancio/` può importarle da `./config` o da `./intake`, sono lo stesso valore).
  - `LANCIO_WEBDEV: LancioConfig` con `{ bucket: LANCIO_BUCKET, funnel: LANCIO_FUNNEL, webinarAt:'2026-10-05T21:00:00+02:00', giornoDopo:'2026-10-06', dopodomani:'2026-10-07', oreVenditori:[9,10,11,12,13,14], orePomeriggio:[15,16,17,18,19,20] }` (a runtime `bucket === 'LANCIO_WEBDEV_2026'`, `funnel === 'Lancio Web Dev AI'`).
  - `type LancioScelta = 'chiamata_subito'|'app_mattina'|'app_pomeriggio'|'app_dopodomani'|'followup'`.
  - `interface LancioBotInfo { risposte?: string[]; slotsMostratiAt?: string | null; [k: string]: unknown }` (le risposte di riscaldamento in ordine; chiavi in più tollerate).
  - `MIN_LEAD_TIME_MS = 60*60*1000`; `CALL_NOW_MAX_ATTEMPTS = 3`; `CALL_NOW_RETRY_MINUTES = 30`; `type ShiftKind = 'SERA'|'GIORNO_DOPO'`.
  - `classifyAt(at: Date, now: Date, cfg?: LancioConfig): { ok:true; kind:'mattina'|'pomeriggio'|'dopodomani'; dateStr:string; hour:number } | { ok:false; motivo:'fuori_regole' }`.
  - `hourKey(dateStr: string, hour: number): string` → `'2026-10-06@9'` (stessa forma di `slotKey`).
  - `sameInstant(a: Date|null, b: Date, toleranceMs = 60_000): boolean`.
  - `slotDateKind(dateStr: string, cfg?): 'giornoDopo'|'dopodomani'|null`.

- [ ] **Step 1: Scrivi `src/lib/lancio/config.ts`**

Nota di riconciliazione (vince sui piani): bucket, funnel, slug e company del lancio hanno UNA sola definizione, in `src/lib/lancio/intake.ts` (B1). Qui si importano e si ri-esportano: nessun letterale `'LANCIO_WEBDEV_2026'` o `'Lancio Web Dev AI'` in questo file. Task 0 ha già verificato che `intake.ts` esista.

```ts
/**
 * Date e fasce del lancio "Web Developer AI" (webinar 5/10/2026 ore 21).
 * Unica sorgente: API, pagina /lancio, scheda venditore e test leggono da qui.
 * I test passano un `now` esplicito: nessuna funzione di questa cartella
 * chiama `new Date()` da sola se può riceverlo.
 *
 * Bucket/funnel/slug/company NON si ridefiniscono: vivono in intake.ts (B1) e
 * qui si ri-esportano, così chi sta in src/lib/lancio/ ha un solo import.
 */
import { LANCIO_BUCKET, LANCIO_COMPANY, LANCIO_FUNNEL, LANCIO_SLUG } from './intake'

export { LANCIO_BUCKET, LANCIO_COMPANY, LANCIO_FUNNEL, LANCIO_SLUG }

export interface LancioConfig {
    bucket: string
    funnel: string
    /** ISO con offset Europe/Rome. */
    webinarAt: string
    /** 'YYYY-MM-DD' Europe/Rome. */
    giornoDopo: string
    dopodomani: string
    /** Ore tonde del giorno dopo servite dai venditori (appuntamento già confermato). */
    oreVenditori: number[]
    /** Ore tonde del giorno dopo servite dalle Conferme. */
    orePomeriggio: number[]
}

export const LANCIO_WEBDEV: LancioConfig = {
    bucket: LANCIO_BUCKET,
    funnel: LANCIO_FUNNEL,
    webinarAt: '2026-10-05T21:00:00+02:00',
    giornoDopo: '2026-10-06',
    dopodomani: '2026-10-07',
    oreVenditori: [9, 10, 11, 12, 13, 14],
    orePomeriggio: [15, 16, 17, 18, 19, 20],
}

export type LancioScelta = 'chiamata_subito' | 'app_mattina' | 'app_pomeriggio' | 'app_dopodomani' | 'followup'

/**
 * Le risposte di riscaldamento raccolte dal bot (contratto B4, `lib/lancio-crm.ts`
 * del bot): `{ risposte: string[], slotsMostratiAt?: string|null }`. Si salva
 * com'è in `leads.lancioBotInfo` (jsonb) e si mostra `risposte` in ordine.
 * Chiavi in più sono tollerate e ignorate dalla UI.
 */
export interface LancioBotInfo {
    risposte?: string[]
    slotsMostratiAt?: string | null
    [k: string]: unknown
}

export type ShiftKind = 'SERA' | 'GIORNO_DOPO'

/** Un appuntamento si accetta solo se comincia almeno un'ora dopo la richiesta. */
export const MIN_LEAD_TIME_MS = 60 * 60 * 1000

/** Tentativi massimi della chiamata subito prima del passaggio alle Conferme (assunzione A1). */
export const CALL_NOW_MAX_ATTEMPTS = 3
/** Minuti fra un tentativo e il successivo. */
export const CALL_NOW_RETRY_MINUTES = 30
```

- [ ] **Step 2: Scrivi il test `src/lib/lancio/rules.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyAt, hourKey, sameInstant, slotDateKind } from './rules'

// La sera del webinar, dopo il pitch.
const SERA = new Date('2026-10-05T22:30:00+02:00')

test('9-14 del 6/10 sono mattina venditori', () => {
    const r = classifyAt(new Date('2026-10-06T09:00:00+02:00'), SERA)
    assert.deepEqual(r, { ok: true, kind: 'mattina', dateStr: '2026-10-06', hour: 9 })
    assert.equal(classifyAt(new Date('2026-10-06T14:00:00+02:00'), SERA).ok && classifyAt(new Date('2026-10-06T14:00:00+02:00'), SERA).kind, 'mattina')
})

test('15-20 del 6/10 sono pomeriggio Conferme', () => {
    const r = classifyAt(new Date('2026-10-06T15:00:00+02:00'), SERA)
    assert.equal(r.ok && r.kind, 'pomeriggio')
    assert.equal(classifyAt(new Date('2026-10-06T20:00:00+02:00'), SERA).ok, true)
})

test('9-14 del 7/10 sono dopodomani, il pomeriggio del 7 no', () => {
    assert.equal(classifyAt(new Date('2026-10-07T10:00:00+02:00'), SERA).ok && classifyAt(new Date('2026-10-07T10:00:00+02:00'), SERA).kind, 'dopodomani')
    assert.deepEqual(classifyAt(new Date('2026-10-07T15:00:00+02:00'), SERA), { ok: false, motivo: 'fuori_regole' })
})

test('fuori regole: ora non tonda, 21 del 6, 8 del 6, altro giorno, data non valida', () => {
    for (const iso of ['2026-10-06T09:30:00+02:00', '2026-10-06T21:00:00+02:00', '2026-10-06T08:00:00+02:00', '2026-10-08T10:00:00+02:00']) {
        assert.deepEqual(classifyAt(new Date(iso), SERA), { ok: false, motivo: 'fuori_regole' }, iso)
    }
    assert.deepEqual(classifyAt(new Date('non-una-data'), SERA), { ok: false, motivo: 'fuori_regole' })
})

test('at deve stare almeno un ora dopo now', () => {
    const now = new Date('2026-10-06T08:30:00+02:00')
    assert.deepEqual(classifyAt(new Date('2026-10-06T09:00:00+02:00'), now), { ok: false, motivo: 'fuori_regole' })
    assert.equal(classifyAt(new Date('2026-10-06T10:00:00+02:00'), now).ok, true)
    // Esattamente un'ora dopo è ammesso.
    assert.equal(classifyAt(new Date('2026-10-06T09:30:00+02:00'), new Date('2026-10-06T08:30:00+02:00')).ok, false) // non tonda
    assert.equal(classifyAt(new Date('2026-10-06T10:00:00+02:00'), new Date('2026-10-06T09:00:00+02:00')).ok, true)
})

test('hourKey ha la stessa forma di slotKey', () => {
    assert.equal(hourKey('2026-10-06', 9), '2026-10-06@9')
})

test('sameInstant tollera 60 secondi', () => {
    const a = new Date('2026-10-06T09:00:00+02:00')
    assert.equal(sameInstant(a, new Date('2026-10-06T09:00:30+02:00')), true)
    assert.equal(sameInstant(a, new Date('2026-10-06T09:02:00+02:00')), false)
    assert.equal(sameInstant(null, a), false)
})

test('slotDateKind riconosce solo le due date del lancio', () => {
    assert.equal(slotDateKind('2026-10-06'), 'giornoDopo')
    assert.equal(slotDateKind('2026-10-07'), 'dopodomani')
    assert.equal(slotDateKind('2026-10-08'), null)
    assert.equal(slotDateKind('06/10/2026'), null)
})
```

- [ ] **Step 3: Aggiungi il test a `package.json`** (in coda alla stringa `test`, separato da spazio): `src/lib/lancio/rules.test.ts`

- [ ] **Step 4: Esegui il test e verifica che fallisca**

Run: `node --import tsx --test src/lib/lancio/rules.test.ts`
Expected: FAIL — `Cannot find module './rules'`.

- [ ] **Step 5: Scrivi `src/lib/lancio/rules.ts`**

```ts
/**
 * Regole dure sull'ora richiesta dal bot. Pure: niente DB, `now` esplicito.
 *
 * Il bot NON inventa ore: qui si decide se `at` è una delle ore ammesse
 * (6/10 9-20 tonde, 7/10 9-14 tonde) e con almeno un'ora di anticipo.
 * Il fuso è Europe/Rome via calendarSlots: l'unico posto che fa aritmetica
 * sulle ore in tutto il progetto.
 */
import { romeHour, romeInstant } from '@/lib/venditore/calendarSlots'
import { toRomeDateStr } from '@/lib/dateUtils'
import { LANCIO_WEBDEV, MIN_LEAD_TIME_MS, type LancioConfig } from './config'

export type AtKind = 'mattina' | 'pomeriggio' | 'dopodomani'

export type AtDecision =
    | { ok: true; kind: AtKind; dateStr: string; hour: number }
    | { ok: false; motivo: 'fuori_regole' }

const FUORI: AtDecision = { ok: false, motivo: 'fuori_regole' }

/** 'giornoDopo' | 'dopodomani' | null per una data 'YYYY-MM-DD'. */
export function slotDateKind(dateStr: string, cfg: LancioConfig = LANCIO_WEBDEV): 'giornoDopo' | 'dopodomani' | null {
    if (dateStr === cfg.giornoDopo) return 'giornoDopo'
    if (dateStr === cfg.dopodomani) return 'dopodomani'
    return null
}

export function classifyAt(at: Date, now: Date, cfg: LancioConfig = LANCIO_WEBDEV): AtDecision {
    if (!(at instanceof Date) || isNaN(at.getTime())) return FUORI
    if (at.getTime() < now.getTime() + MIN_LEAD_TIME_MS) return FUORI

    const dateStr = toRomeDateStr(at)
    const hour = romeHour(at)
    // Ora tonda: l'istante deve coincidere con l'ora piena italiana.
    if (romeInstant(dateStr, hour).getTime() !== at.getTime()) return FUORI

    const day = slotDateKind(dateStr, cfg)
    if (day === 'giornoDopo') {
        if (cfg.oreVenditori.includes(hour)) return { ok: true, kind: 'mattina', dateStr, hour }
        if (cfg.orePomeriggio.includes(hour)) return { ok: true, kind: 'pomeriggio', dateStr, hour }
        return FUORI
    }
    if (day === 'dopodomani') {
        if (cfg.oreVenditori.includes(hour)) return { ok: true, kind: 'dopodomani', dateStr, hour }
        return FUORI
    }
    return FUORI
}

/** Stessa forma di `slotKey` (calendarSlots): '2026-10-06@9'. */
export function hourKey(dateStr: string, hour: number): string {
    return `${dateStr}@${hour}`
}

/** Idempotenza di `book`: lo stesso `at` entro 60 s è la stessa richiesta. */
export function sameInstant(a: Date | null | undefined, b: Date, toleranceMs = 60_000): boolean {
    if (!a) return false
    return Math.abs(a.getTime() - b.getTime()) <= toleranceMs
}
```

- [ ] **Step 6: Esegui i test**

Run: `node --import tsx --test src/lib/lancio/rules.test.ts`
Expected: PASS (8 test).

- [ ] **Step 7: Commit**

```bash
git add src/lib/lancio/config.ts src/lib/lancio/rules.ts src/lib/lancio/rules.test.ts package.json
git commit -m "feat(lancio): costante LANCIO_WEBDEV e regole pure di ammissibilita dell'ora"
```

---
### Task 3: Ore libere della mattina e round robin (puri)

**Files:**
- Create: `src/lib/lancio/slots.ts`
- Test: `src/lib/lancio/slots.test.ts`
- Modify: `package.json` (riga `test`)

**Interfaces:**
- Consumes: `hourKey`, `MIN_LEAD_TIME_MS` (Task 2); `romeInstant` da `calendarSlots`.
- Produces:
  - `interface ShiftMember { salesUserId: string; lastAssignedAt: Date | null }`
  - `interface VenditoreDayFacts extends ShiftMember { declared: Set<string>; blocked: Set<string>; busy: Set<string> }` (chiavi `hourKey`)
  - `mattinaSlots(input: { dateStr: string; hours: number[]; venditori: VenditoreDayFacts[]; now: Date }): { mattina: Array<{ hour: number; liberi: number; venditoriLiberi: string[] }>; mattinaEsaurita: boolean }` — solo ore con inizio ≥ `now + 1h`; un venditore è libero in un'ora se l'ha dichiarata, non bloccata e non occupata.
  - `isFreeAt(v: VenditoreDayFacts, key: string): boolean`
  - `pickRoundRobin<T extends ShiftMember>(candidati: T[]): T | null` — `lastAssignedAt` più vecchio (null = epoch), tiebreak `salesUserId` crescente.

- [ ] **Step 1: Scrivi il test `src/lib/lancio/slots.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mattinaSlots, pickRoundRobin, type VenditoreDayFacts } from './slots'

const D = '2026-10-06'
const k = (h: number) => `${D}@${h}`
const SERA = new Date('2026-10-05T22:30:00+02:00')
const HOURS = [9, 10, 11, 12, 13, 14]

function v(id: string, declared: number[], blocked: number[] = [], busy: number[] = []): VenditoreDayFacts {
    return {
        salesUserId: id, lastAssignedAt: null,
        declared: new Set(declared.map(k)), blocked: new Set(blocked.map(k)), busy: new Set(busy.map(k)),
    }
}

test('conta i venditori liberi per ora: dichiarato meno bloccato meno occupato', () => {
    const out = mattinaSlots({ dateStr: D, hours: HOURS, now: SERA, venditori: [
        v('a', [9, 10, 11], [10], []),
        v('b', [9, 11], [], [11]),
    ] })
    assert.deepEqual(out.mattina, [
        { hour: 9, liberi: 2, venditoriLiberi: ['a', 'b'] },
        { hour: 10, liberi: 0, venditoriLiberi: [] },
        { hour: 11, liberi: 1, venditoriLiberi: ['a'] },
        { hour: 12, liberi: 0, venditoriLiberi: [] },
        { hour: 13, liberi: 0, venditoriLiberi: [] },
        { hour: 14, liberi: 0, venditoriLiberi: [] },
    ])
    assert.equal(out.mattinaEsaurita, false)
})

test('mattina esaurita quando nessuna ora ha un venditore libero', () => {
    const out = mattinaSlots({ dateStr: D, hours: HOURS, now: SERA, venditori: [v('a', [], [], [])] })
    assert.equal(out.mattinaEsaurita, true)
    assert.ok(out.mattina.every(m => m.liberi === 0))
})

test('turno vuoto = mattina esaurita', () => {
    assert.equal(mattinaSlots({ dateStr: D, hours: HOURS, now: SERA, venditori: [] }).mattinaEsaurita, true)
})

test('le ore che cominciano entro un ora da now non si offrono', () => {
    const now = new Date('2026-10-06T08:30:00+02:00')
    const out = mattinaSlots({ dateStr: D, hours: HOURS, now, venditori: [v('a', HOURS)] })
    assert.deepEqual(out.mattina.map(m => m.hour), [10, 11, 12, 13, 14])
    const tardi = mattinaSlots({ dateStr: D, hours: HOURS, now: new Date('2026-10-06T13:30:00+02:00'), venditori: [v('a', HOURS)] })
    assert.deepEqual(tardi.mattina.map(m => m.hour), [])
    assert.equal(tardi.mattinaEsaurita, true)
})

test('round robin: lastAssignedAt piu vecchio, null prima di tutti, tiebreak id', () => {
    const t1 = new Date('2026-10-05T21:00:00Z')
    const t2 = new Date('2026-10-05T22:00:00Z')
    assert.equal(pickRoundRobin([
        { salesUserId: 'b', lastAssignedAt: t2 },
        { salesUserId: 'a', lastAssignedAt: t1 },
    ])?.salesUserId, 'a')
    assert.equal(pickRoundRobin([
        { salesUserId: 'b', lastAssignedAt: t1 },
        { salesUserId: 'a', lastAssignedAt: null },
    ])?.salesUserId, 'a')
    assert.equal(pickRoundRobin([
        { salesUserId: 'b', lastAssignedAt: null },
        { salesUserId: 'a', lastAssignedAt: null },
    ])?.salesUserId, 'a')
    assert.equal(pickRoundRobin([]), null)
})

test('pickRoundRobin non muta l input', () => {
    const arr = [{ salesUserId: 'b', lastAssignedAt: null }, { salesUserId: 'a', lastAssignedAt: null }]
    pickRoundRobin(arr)
    assert.deepEqual(arr.map(x => x.salesUserId), ['b', 'a'])
})
```

- [ ] **Step 2: Aggiungi `src/lib/lancio/slots.test.ts` alla riga `test` di `package.json`**

- [ ] **Step 3: Esegui e verifica il fallimento**

Run: `node --import tsx --test src/lib/lancio/slots.test.ts`
Expected: FAIL — `Cannot find module './slots'`.

- [ ] **Step 4: Scrivi `src/lib/lancio/slots.ts`**

```ts
/**
 * Ore libere della mattina del giorno dopo e round robin fra i venditori.
 * Puro: riceve fatti già letti (Task 5 li legge dal DB) e un `now` esplicito.
 *
 * "Libero in un'ora" = l'ha dichiarata nel calendario, non l'ha bloccata e non
 * ha già un appuntamento: la stessa lettura di checkBookingAllowed (Conferme).
 * Un esente (calendarExempt) non dichiara mai ore: esce da solo.
 */
import { romeInstant } from '@/lib/venditore/calendarSlots'
import { MIN_LEAD_TIME_MS } from './config'
import { hourKey } from './rules'

export interface ShiftMember {
    salesUserId: string
    lastAssignedAt: Date | null
}

export interface VenditoreDayFacts extends ShiftMember {
    declared: Set<string>
    blocked: Set<string>
    busy: Set<string>
}

export interface MattinaHour {
    hour: number
    liberi: number
    venditoriLiberi: string[]
}

export function isFreeAt(v: VenditoreDayFacts, key: string): boolean {
    return v.declared.has(key) && !v.blocked.has(key) && !v.busy.has(key)
}

export function mattinaSlots(input: {
    dateStr: string
    hours: number[]
    venditori: VenditoreDayFacts[]
    now: Date
}): { mattina: MattinaHour[]; mattinaEsaurita: boolean } {
    const cutoff = input.now.getTime() + MIN_LEAD_TIME_MS
    const mattina: MattinaHour[] = []
    for (const hour of input.hours) {
        if (romeInstant(input.dateStr, hour).getTime() < cutoff) continue
        const key = hourKey(input.dateStr, hour)
        const liberi = input.venditori.filter(v => isFreeAt(v, key)).map(v => v.salesUserId).sort()
        mattina.push({ hour, liberi: liberi.length, venditoriLiberi: liberi })
    }
    return { mattina, mattinaEsaurita: mattina.every(m => m.liberi === 0) }
}

/** `coalesce(lastAssignedAt,'epoch'), salesUserId` — la stessa regola dell'ORDER BY della spec. */
export function pickRoundRobin<T extends ShiftMember>(candidati: T[]): T | null {
    if (candidati.length === 0) return null
    return [...candidati].sort((a, b) => {
        const ta = a.lastAssignedAt?.getTime() ?? 0
        const tb = b.lastAssignedAt?.getTime() ?? 0
        if (ta !== tb) return ta - tb
        return a.salesUserId < b.salesUserId ? -1 : a.salesUserId > b.salesUserId ? 1 : 0
    })[0]
}
```

- [ ] **Step 5: Esegui i test**

Run: `node --import tsx --test src/lib/lancio/slots.test.ts`
Expected: PASS (6 test).

- [ ] **Step 6: Commit**

```bash
git add src/lib/lancio/slots.ts src/lib/lancio/slots.test.ts package.json
git commit -m "feat(lancio): ore libere della mattina e round robin, moduli puri con test"
```

---

### Task 4: Ciclo NR delle chiamate subito (puro)

**Files:**
- Create: `src/lib/lancio/callNow.ts`
- Test: `src/lib/lancio/callNow.test.ts`
- Modify: `package.json` (riga `test`)

**Interfaces:**
- Consumes: `CALL_NOW_MAX_ATTEMPTS`, `CALL_NOW_RETRY_MINUTES`, `MIN_LEAD_TIME_MS`, `LANCIO_WEBDEV` (Task 2); `romeInstant`, `romeHour` da `calendarSlots`; `toRomeDateStr`.
- Produces:
  - `type CallNowColumn = 'da_chiamare'|'seconda'|'terza'|'esitati'`
  - `callNowColumn(lead: { lancioCallNowAttempts: number; salespersonOutcome: string | null }): CallNowColumn`
  - `handoffAppointmentAt(now: Date, cfg?): Date` — 6/10 09:00 se `now` è prima, altrimenti la prossima ora tonda ≥ `now + 1h`.
  - `nextCallNowState(attemptsSoFar: number, now: Date, cfg?): { kind:'retry'; attempts:number; nextAt: Date } | { kind:'handoff'; attempts:number; appointmentAt: Date }`

- [ ] **Step 1: Scrivi il test `src/lib/lancio/callNow.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callNowColumn, handoffAppointmentAt, nextCallNowState } from './callNow'

const SERA = new Date('2026-10-05T22:30:00+02:00')

test('colonne: 0 → da chiamare, 1 → seconda, 2 → terza, esito → esitati', () => {
    assert.equal(callNowColumn({ lancioCallNowAttempts: 0, salespersonOutcome: null }), 'da_chiamare')
    assert.equal(callNowColumn({ lancioCallNowAttempts: 1, salespersonOutcome: null }), 'seconda')
    assert.equal(callNowColumn({ lancioCallNowAttempts: 2, salespersonOutcome: null }), 'terza')
    assert.equal(callNowColumn({ lancioCallNowAttempts: 1, salespersonOutcome: 'Chiuso' }), 'esitati')
    assert.equal(callNowColumn({ lancioCallNowAttempts: 3, salespersonOutcome: null }), 'esitati')
})

test('primo e secondo NR: ritenta fra 30 minuti', () => {
    const r1 = nextCallNowState(0, SERA)
    assert.deepEqual(r1, { kind: 'retry', attempts: 1, nextAt: new Date('2026-10-05T23:00:00+02:00') })
    const r2 = nextCallNowState(1, SERA)
    assert.equal(r2.kind, 'retry')
    assert.equal(r2.attempts, 2)
})

test('terzo NR: passa alle Conferme il giorno dopo alle 09:00 (A1)', () => {
    const r = nextCallNowState(2, SERA)
    assert.deepEqual(r, { kind: 'handoff', attempts: 3, appointmentAt: new Date('2026-10-06T09:00:00+02:00') })
})

test('handoff dopo le 9 del 6: prossima ora tonda almeno un ora avanti', () => {
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-06T09:20:00+02:00')), new Date('2026-10-06T11:00:00+02:00'))
    assert.deepEqual(handoffAppointmentAt(new Date('2026-10-06T10:00:00+02:00')), new Date('2026-10-06T11:00:00+02:00'))
    assert.deepEqual(handoffAppointmentAt(SERA), new Date('2026-10-06T09:00:00+02:00'))
})
```

- [ ] **Step 2: Aggiungi `src/lib/lancio/callNow.test.ts` alla riga `test` di `package.json`**

- [ ] **Step 3: Esegui e verifica il fallimento**

Run: `node --import tsx --test src/lib/lancio/callNow.test.ts`
Expected: FAIL — `Cannot find module './callNow'`.

- [ ] **Step 4: Scrivi `src/lib/lancio/callNow.ts`**

```ts
/**
 * Ciclo delle "chiamate subito" (spec §4.4 + assunzione A1): il venditore di
 * turno chiama, e a ogni "Non risponde" il lead scala di colonna. Al terzo NR
 * il lead passa alle Conferme il giorno dopo alle 09:00, senza venditore.
 * Puro: `now` esplicito, niente DB.
 */
import { romeHour, romeInstant } from '@/lib/venditore/calendarSlots'
import { toRomeDateStr } from '@/lib/dateUtils'
import { CALL_NOW_MAX_ATTEMPTS, CALL_NOW_RETRY_MINUTES, LANCIO_WEBDEV, MIN_LEAD_TIME_MS, type LancioConfig } from './config'

export type CallNowColumn = 'da_chiamare' | 'seconda' | 'terza' | 'esitati'

export function callNowColumn(lead: { lancioCallNowAttempts: number; salespersonOutcome: string | null }): CallNowColumn {
    if (lead.salespersonOutcome) return 'esitati'
    if (lead.lancioCallNowAttempts <= 0) return 'da_chiamare'
    if (lead.lancioCallNowAttempts === 1) return 'seconda'
    if (lead.lancioCallNowAttempts === 2) return 'terza'
    return 'esitati'
}

/**
 * Quando le Conferme devono richiamare chi non ha risposto tre volte:
 * le 09:00 del giorno dopo, o — se sono già passate — la prossima ora tonda
 * che lascia almeno un'ora di respiro.
 */
export function handoffAppointmentAt(now: Date, cfg: LancioConfig = LANCIO_WEBDEV): Date {
    const nove = romeInstant(cfg.giornoDopo, 9)
    if (now.getTime() < nove.getTime()) return nove
    const min = new Date(now.getTime() + MIN_LEAD_TIME_MS)
    const dateStr = toRomeDateStr(min)
    let hour = romeHour(min)
    // Se `min` non è un'ora tonda, la prossima ora piena.
    if (romeInstant(dateStr, hour).getTime() < min.getTime()) hour += 1
    return romeInstant(dateStr, hour)
}

export type CallNowNext =
    | { kind: 'retry'; attempts: number; nextAt: Date }
    | { kind: 'handoff'; attempts: number; appointmentAt: Date }

export function nextCallNowState(attemptsSoFar: number, now: Date, cfg: LancioConfig = LANCIO_WEBDEV): CallNowNext {
    const attempts = attemptsSoFar + 1
    if (attempts >= CALL_NOW_MAX_ATTEMPTS) {
        return { kind: 'handoff', attempts, appointmentAt: handoffAppointmentAt(now, cfg) }
    }
    return { kind: 'retry', attempts, nextAt: new Date(now.getTime() + CALL_NOW_RETRY_MINUTES * 60_000) }
}
```

- [ ] **Step 5: Esegui i test**

Run: `node --import tsx --test src/lib/lancio/callNow.test.ts`
Expected: PASS (4 test).

- [ ] **Step 6: Commit**

```bash
git add src/lib/lancio/callNow.ts src/lib/lancio/callNow.test.ts package.json
git commit -m "feat(lancio): ciclo NR delle chiamate subito, modulo puro con test"
```

---
### Task 5: Lettura turni e disponibilità dal DB (`shiftQueries.ts`)

**Files:**
- Create: `src/lib/lancio/shiftQueries.ts`

**Interfaces:**
- Consumes: `launchShifts`, `users`, `salesAvailabilitySlots`, `salesSlotBlocks`, `leads` da `@/db/schema`; `romeInstant`, `slotKey` da `calendarSlots`; `VenditoreDayFacts`, `ShiftMember` (Task 3); `LANCIO_WEBDEV`, `ShiftKind` (Task 2).
- Produces:
  - `getShiftMembers(tx: Db, kind: ShiftKind, cfg?): Promise<Array<ShiftMember & { name: string; calendarExempt: boolean }>>` — solo righe `removedAt IS NULL` e venditori `isActive`.
  - `dayFactsFor(tx: Db, members: ShiftMember[], dateStr: string): Promise<VenditoreDayFacts[]>` — dichiarati, bloccati, occupati del giorno italiano `dateStr` per quei venditori (una query per tabella, `inArray`). **Nessun filtro `companyId`** su nessuna delle tre letture (calendario per-utente; occupazione = l'ora è presa per la persona, anche se l'appuntamento è di un'altra azienda, come in `checkBookingAllowed`).
  - `type Db` = `typeof db` o transazione Drizzle (`Parameters<Parameters<typeof db.transaction>[0]>[0]`).
  - `venditoreLabel(u: { name: string | null; displayName: string | null }): string`.

- [ ] **Step 1: Scrivi `src/lib/lancio/shiftQueries.ts`**

```ts
/**
 * Letture DB dei turni del lancio e della disponibilità dei venditori di turno.
 * Nessuna decisione qui: i fatti letti vanno ai moduli puri (slots.ts).
 *
 * MULTI-TENANT: salesAvailabilitySlots/salesSlotBlocks sono per-utente e la
 * "occupazione" di un venditore vale su ogni azienda (vedi la nota in
 * schema.ts sopra salesAvailabilitySlots e checkBookingAllowed): nessuna delle
 * tre letture filtra companyId. Non "ripararlo".
 */
import { db } from '@/db'
import { launchShifts, leads, salesAvailabilitySlots, salesSlotBlocks, users } from '@/db/schema'
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { romeInstant, slotKey } from '@/lib/venditore/calendarSlots'
import { LANCIO_WEBDEV, type LancioConfig, type ShiftKind } from './config'
import type { ShiftMember, VenditoreDayFacts } from './slots'

export type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface ShiftMemberRow extends ShiftMember {
    name: string
    calendarExempt: boolean
}

export function venditoreLabel(u: { name: string | null; displayName: string | null }): string {
    return u.displayName || u.name || 'Venditore'
}

/** Venditori attivi del turno, nell'ordine del round robin. */
export async function getShiftMembers(tx: Db, kind: ShiftKind, cfg: LancioConfig = LANCIO_WEBDEV): Promise<ShiftMemberRow[]> {
    const rows = await tx.select({
        salesUserId: launchShifts.salesUserId,
        lastAssignedAt: launchShifts.lastAssignedAt,
        name: users.name,
        displayName: users.displayName,
        calendarExempt: users.calendarExempt,
    }).from(launchShifts)
        .innerJoin(users, eq(users.id, launchShifts.salesUserId))
        .where(and(
            eq(launchShifts.bucket, cfg.bucket),
            eq(launchShifts.kind, kind),
            isNull(launchShifts.removedAt),
            eq(users.isActive, true),
        ))
        .orderBy(asc(sql`coalesce(${launchShifts.lastAssignedAt}, 'epoch'::timestamptz)`), asc(launchShifts.salesUserId))
    return rows.map(r => ({
        salesUserId: r.salesUserId,
        lastAssignedAt: r.lastAssignedAt,
        name: venditoreLabel(r),
        calendarExempt: r.calendarExempt,
    }))
}

/** Dichiarati / bloccati / occupati del giorno italiano `dateStr` per i venditori dati. */
export async function dayFactsFor(tx: Db, members: ShiftMember[], dateStr: string): Promise<VenditoreDayFacts[]> {
    if (members.length === 0) return []
    const ids = members.map(m => m.salesUserId)
    const dayStart = romeInstant(dateStr, 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    const [declared, blocked, busy] = await Promise.all([
        tx.select({ salesUserId: salesAvailabilitySlots.salesUserId, slotStart: salesAvailabilitySlots.slotStart })
            .from(salesAvailabilitySlots).where(and(
                inArray(salesAvailabilitySlots.salesUserId, ids),
                gte(salesAvailabilitySlots.slotStart, dayStart),
                lt(salesAvailabilitySlots.slotStart, dayEnd),
            )),
        tx.select({ salesUserId: salesSlotBlocks.salesUserId, slotStart: salesSlotBlocks.slotStart })
            .from(salesSlotBlocks).where(and(
                inArray(salesSlotBlocks.salesUserId, ids),
                gte(salesSlotBlocks.slotStart, dayStart),
                lt(salesSlotBlocks.slotStart, dayEnd),
            )),
        tx.select({ salesUserId: leads.salespersonUserId, appointmentDate: leads.appointmentDate })
            .from(leads).where(and(
                inArray(leads.salespersonUserId, ids),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, dayStart),
                lt(leads.appointmentDate, dayEnd),
            )),
    ])

    const facts = new Map<string, VenditoreDayFacts>()
    for (const m of members) facts.set(m.salesUserId, { ...m, declared: new Set(), blocked: new Set(), busy: new Set() })
    for (const r of declared) facts.get(r.salesUserId)?.declared.add(slotKey(r.slotStart))
    for (const r of blocked) facts.get(r.salesUserId)?.blocked.add(slotKey(r.slotStart))
    for (const r of busy) if (r.salesUserId && r.appointmentDate) facts.get(r.salesUserId)?.busy.add(slotKey(r.appointmentDate))
    return [...facts.values()]
}
```

Nota: `slotKey` produce `'2026-10-06@9'`, identico a `hourKey` di Task 2: i due moduli si parlano senza conversioni.

- [ ] **Step 2: Compila**

Run: `npx tsc --noEmit`
Expected: verde. Se `Db` non tipizza la transazione, sostituire con `type Db = Pick<typeof db, 'select'>` (bastano le select).

- [ ] **Step 3: Commit**

```bash
git add src/lib/lancio/shiftQueries.ts
git commit -m "feat(lancio): letture DB dei turni e della disponibilita dei venditori di turno"
```

---

### Task 6: Guardia condivisa delle route bot + `POST /api/bot/lancio/slots`

**Files:**
- Create: `src/lib/lancio/botGuard.ts`
- Create: `src/app/api/bot/lancio/slots/route.ts`

**Interfaces:**
- Consumes: `verifySignature` (`@/lib/marketing-webhooks/signing`); `getShiftMembers`, `dayFactsFor` (Task 5); `mattinaSlots` (Task 3); `slotDateKind` (Task 2); `LANCIO_WEBDEV`.
- Produces:
  - `authBotRequest(req: NextRequest): Promise<{ ok: true; body: any } | { ok: false; res: NextResponse }>` — 503 senza `BOT_WEBHOOK_SECRET`, 401 firma non valida, 400 JSON non valido.
  - `loadLancioLead(leadId: string): Promise<{ ok: true; lead: LancioLeadRow; botUserId: string } | { ok: false; res: NextResponse }>` — 404 se assente, 403 se `launchBucket !== cfg.bucket` o se non (`assignedToId` = account bot **oppure** `lancioIngresso === 'pulsante_webinar'`).
  - `LancioLeadRow` = `{ id, name, phone, email, funnel, companyId, assignedToId, status, appointmentDate, lancioScelta, lancioSceltaAt, lancioIngresso, salespersonUserId, confirmationsOutcome, version }`.
  - `computeSlots(dateStr: string, now: Date): Promise<SlotsResponse>` (in `botGuard.ts` per riuso da `book` nel 409).
  - `type SlotsResponse = { date: string; mattina: Array<{ hour: number; liberi: number }> | 'conferme'; pomeriggio: { aperto: boolean; ore: number[] }; mattinaEsaurita: boolean; oreAmmesse: number[] }`.
  - Risposta `slots` (bot B4): giornoDopo → `{ date:'2026-10-06', mattina:[{hour,liberi}...], pomeriggio:{ aperto:true, ore:[15..20] }, mattinaEsaurita, oreAmmesse:[9..20] }`; dopodomani → `{ date:'2026-10-07', mattina:'conferme', pomeriggio:{ aperto:false, ore:[] }, mattinaEsaurita:false, oreAmmesse:[9..14] }`; altra data → `422 { ok:false, motivo:'fuori_regole' }`. `venditoriLiberi` NON esce verso il bot (id interni).

- [ ] **Step 1: Scrivi `src/lib/lancio/botGuard.ts`**

```ts
/**
 * Pezzi comuni alle tre route /api/bot/lancio/*: firma HMAC (identica a
 * /api/bot/outcome), guardia di appartenenza del lead al lancio e calcolo
 * degli slot (serve sia a `slots` sia al 409 di `book`).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { leads, users } from '@/db/schema'
import { verifySignature } from '@/lib/marketing-webhooks/signing'
import { LANCIO_COMPANY, LANCIO_WEBDEV, type LancioConfig } from './config'
import { slotDateKind } from './rules'
import { mattinaSlots } from './slots'
import { dayFactsFor, getShiftMembers } from './shiftQueries'

/** Alias locale della company del lancio (intake.ts via config.ts): il lancio è solo Fenice. */
export const FENICE = LANCIO_COMPANY

export async function authBotRequest(req: NextRequest): Promise<{ ok: true; body: any } | { ok: false; res: NextResponse }> {
    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!secret) {
        console.error('[bot-lancio] missing BOT_WEBHOOK_SECRET')
        return { ok: false, res: NextResponse.json({ ok: false, motivo: 'not_configured' }, { status: 503 }) }
    }
    const rawBody = await req.text()
    const check = verifySignature(rawBody, req.headers.get('x-bot-signature') ?? '', secret)
    if (!check.valid) {
        return { ok: false, res: NextResponse.json({ ok: false, motivo: 'invalid_signature', detail: check.reason }, { status: 401 }) }
    }
    try {
        return { ok: true, body: rawBody ? JSON.parse(rawBody) : {} }
    } catch {
        return { ok: false, res: NextResponse.json({ ok: false, motivo: 'invalid_json' }, { status: 400 }) }
    }
}

export interface LancioLeadRow {
    id: string; name: string; phone: string; email: string | null; funnel: string | null
    companyId: string; assignedToId: string | null; status: string
    appointmentDate: Date | null; lancioScelta: string | null; lancioSceltaAt: Date | null
    lancioIngresso: string | null; salespersonUserId: string | null
    confirmationsOutcome: string | null; version: number
}

/** Il lead esiste, è del bucket lancio ed è in mano al bot (o è entrato dal pulsante). */
export async function loadLancioLead(leadId: string, cfg: LancioConfig = LANCIO_WEBDEV): Promise<{ ok: true; lead: LancioLeadRow; botUserId: string } | { ok: false; res: NextResponse }> {
    const [bot] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.isBot, true), eq(users.companyId, FENICE))).limit(1)
    if (!bot) return { ok: false, res: NextResponse.json({ ok: false, motivo: 'bot_account_not_found' }, { status: 503 }) }

    const [lead] = await db.select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, funnel: leads.funnel,
        companyId: leads.companyId, assignedToId: leads.assignedToId, status: leads.status,
        appointmentDate: leads.appointmentDate, lancioScelta: leads.lancioScelta, lancioSceltaAt: leads.lancioSceltaAt,
        lancioIngresso: leads.lancioIngresso, salespersonUserId: leads.salespersonUserId,
        confirmationsOutcome: leads.confirmationsOutcome, version: leads.version,
        launchBucket: leads.launchBucket,
    }).from(leads).where(eq(leads.id, leadId)).limit(1)

    if (!lead) return { ok: false, res: NextResponse.json({ ok: false, motivo: 'lead_not_found' }, { status: 404 }) }
    const delLancio = lead.companyId === FENICE && lead.launchBucket === cfg.bucket
    const inManoAlBot = lead.assignedToId === bot.id || lead.lancioIngresso === 'pulsante_webinar'
    if (!delLancio || !inManoAlBot) {
        return { ok: false, res: NextResponse.json({ ok: false, motivo: 'forbidden', detail: 'lead non del lancio o non in mano al bot' }, { status: 403 }) }
    }
    const { launchBucket: _b, ...row } = lead
    return { ok: true, lead: row, botUserId: bot.id }
}

export interface SlotsResponse {
    date: string
    mattina: Array<{ hour: number; liberi: number }> | 'conferme'
    pomeriggio: { aperto: boolean; ore: number[] }
    mattinaEsaurita: boolean
    /** Le ore tonde che `book` accetterà per questa data. */
    oreAmmesse: number[]
}

/** null = data fuori dal lancio (il chiamante risponde 422). */
export async function computeSlots(dateStr: string, now: Date, cfg: LancioConfig = LANCIO_WEBDEV): Promise<SlotsResponse | null> {
    const day = slotDateKind(dateStr, cfg)
    if (day === null) return null
    if (day === 'dopodomani') {
        return { date: dateStr, mattina: 'conferme', pomeriggio: { aperto: false, ore: [] }, mattinaEsaurita: false, oreAmmesse: [...cfg.oreVenditori] }
    }
    const members = await getShiftMembers(db, 'GIORNO_DOPO', cfg)
    const facts = await dayFactsFor(db, members, dateStr)
    const { mattina, mattinaEsaurita } = mattinaSlots({ dateStr, hours: cfg.oreVenditori, venditori: facts, now })
    return {
        date: dateStr,
        mattina: mattina.map(m => ({ hour: m.hour, liberi: m.liberi })),
        pomeriggio: { aperto: true, ore: [...cfg.orePomeriggio] },
        mattinaEsaurita,
        oreAmmesse: [...cfg.oreVenditori, ...cfg.orePomeriggio],
    }
}
```

- [ ] **Step 2: Scrivi `src/app/api/bot/lancio/slots/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { authBotRequest, computeSlots } from '@/lib/lancio/botGuard'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bot/lancio/slots  { date: 'YYYY-MM-DD' }
 * POST e non GET: bot-hmac firma il body. Risposta: vedi SlotsResponse.
 * Solo le due date del lancio; per il 7/10 risponde mattina:'conferme'.
 */
export async function POST(req: NextRequest) {
    const auth = await authBotRequest(req)
    if (!auth.ok) return auth.res
    const date = typeof auth.body?.date === 'string' ? auth.body.date : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'date richiesta (YYYY-MM-DD)' }, { status: 400 })
    }
    const slots = await computeSlots(date, new Date())
    if (!slots) return NextResponse.json({ ok: false, motivo: 'fuori_regole' }, { status: 422 })
    return NextResponse.json({ ok: true, ...slots })
}
```

- [ ] **Step 3: Compila e prova a mano**

Run: `npx tsc --noEmit`
Expected: verde.

Run (dev server acceso, `BOT_WEBHOOK_SECRET` in `.env`; firma con node):
```bash
BODY='{"date":"2026-10-06"}'; SIG="sha256=$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha256',process.env.BOT_WEBHOOK_SECRET).update(process.argv[1]).digest('hex'))" "$BODY")"
curl -s -X POST http://localhost:3000/api/bot/lancio/slots -H "content-type: application/json" -H "x-bot-signature: $SIG" -d "$BODY"
```
Expected: `{"ok":true,"date":"2026-10-06","mattina":[...6 ore con liberi 0...],"pomeriggio":{"aperto":true,"ore":[15,16,17,18,19,20]},"mattinaEsaurita":true,"oreAmmesse":[9,...,20]}` (turno vuoto → tutto a 0). Senza firma → 401. `{"date":"2026-10-09"}` → 422.

- [ ] **Step 4: Commit**

```bash
git add src/lib/lancio/botGuard.ts src/app/api/bot/lancio/slots/route.ts
git commit -m "feat(lancio): guardia HMAC condivisa e API slots per il bot"
```

---
### Task 7: Prenotazione (`booking.ts`) + `POST /api/bot/lancio/book`

**Files:**
- Create: `src/lib/lancio/booking.ts`
- Create: `src/app/api/bot/lancio/book/route.ts`

**Interfaces:**
- Consumes: `classifyAt`, `hourKey`, `sameInstant`, `AtKind` (Task 2); `pickRoundRobin`, `isFreeAt` (Task 3); `getShiftMembers`, `dayFactsFor` (Task 5); `authBotRequest`, `loadLancioLead`, `computeSlots`, `LancioLeadRow`, `FENICE` (Task 6); `CONFERME_DISCARD_RESET` (`@/lib/confermeReset`); `createGoogleCalendarEvent` (`@/lib/googleCalendar`); `enqueueMarketingWebhook` (`@/lib/marketing-webhooks/enqueue`); `after` da `next/server`.
- Produces:
  - `type BookOutcome = { ok:true; kind:'mattina'; venditore:{id:string; nome:string}; deduped?:true } | { ok:true; kind:'pomeriggio'|'dopodomani'; deduped?:true } | { ok:false; motivo:'ora_esaurita' }`
  - `bookLancio(input: { lead: LancioLeadRow; botUserId: string; at: Date; kind: AtKind; dateStr: string; hour: number; info?: LancioBotInfo; note?: string; now: Date; cfg?: LancioConfig }): Promise<BookOutcome>`
  - `mattinaSideEffects(input: { lead: LancioLeadRow; venditoreId: string; at: Date; botUserId: string }): Promise<void>` — Google Calendar + webhook marketing; il chiamante la mette in `after()`.
  - `notifyConfermeLancio(lead: { id: string; name: string }, at: Date, titolo: string): Promise<void>` — una `notifications` per ogni CONFERME attiva Fenice, `type:'lancio_appuntamento'`, `metadata:{ leadId }` (riusata da Task 10 per il passaggio A1).
- Contratto della route (bot B4): body `{ leadId, at, info?, note? }`, `at` ISO con offset. Risposte: `200 { ok:true, kind:'mattina', venditore:{id,nome} }` · `200 { ok:true, kind:'pomeriggio'|'dopodomani' }` · `200 { ok:true, kind, deduped:true, venditore? }` · `409 { ok:false, motivo:'ora_esaurita', slots:<SlotsResponse> }` · `422 { ok:false, motivo:'fuori_regole' }` · `403 { ok:false, motivo:'forbidden' }` · `400 { ok:false, motivo:'bad_request' }` (leadId/at mancanti o `at` senza offset) · `401`/`503`.

- [ ] **Step 1: Scrivi `src/lib/lancio/booking.ts`**

```ts
/**
 * Scritture della prenotazione del lancio (spec §4.2).
 *
 * Mattina (9-14 del giorno dopo): transazione con advisory lock sull'ORA, così
 * due lead che chiedono le 10:00 nello stesso istante non prendono lo stesso
 * venditore. Dentro il lock si rilegge la disponibilità (dichiarati − blocchi −
 * appuntamenti) e si sceglie con il round robin del turno GIORNO_DOPO.
 * L'appuntamento nasce GIÀ CONFERMATO (decisione 9): le Conferme non chiamano.
 *
 * Pomeriggio / dopodomani: appuntamento senza venditore, come un APPUNTAMENTO
 * del bot, e le Conferme ricevono la notifica.
 *
 * Google Calendar e webhook marketing NON stanno qui dentro: `mattinaSideEffects`
 * gira in `after()` dalla route, perché le API devono rispondere in < 3 s.
 */
import crypto from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { addHours } from 'date-fns'
import { db } from '@/db'
import { launchShifts, leadEvents, leads, notifications, users } from '@/db/schema'
import { CONFERME_DISCARD_RESET } from '@/lib/confermeReset'
import { createGoogleCalendarEvent } from '@/lib/googleCalendar'
import { enqueueMarketingWebhook } from '@/lib/marketing-webhooks/enqueue'
import { LANCIO_WEBDEV, type LancioBotInfo, type LancioConfig } from './config'
import { hourKey, sameInstant, type AtKind } from './rules'
import { isFreeAt, pickRoundRobin } from './slots'
import { dayFactsFor, getShiftMembers, type Db } from './shiftQueries'
import { FENICE, type LancioLeadRow } from './botGuard'

export type BookOutcome =
    | { ok: true; kind: 'mattina'; venditore: { id: string; nome: string }; deduped?: true }
    | { ok: true; kind: 'pomeriggio' | 'dopodomani'; deduped?: true }
    | { ok: false; motivo: 'ora_esaurita' }

const SCELTA_BY_KIND: Record<AtKind, 'app_mattina' | 'app_pomeriggio' | 'app_dopodomani'> = {
    mattina: 'app_mattina', pomeriggio: 'app_pomeriggio', dopodomani: 'app_dopodomani',
}

function whenLabel(at: Date): string {
    return at.toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })
}

export async function notifyConfermeLancio(lead: { id: string; name: string }, at: Date, titolo: string): Promise<void> {
    const conferme = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, FENICE), eq(users.role, 'CONFERME'), eq(users.isActive, true),
    ))
    if (conferme.length === 0) return
    const now = new Date()
    await db.insert(notifications).values(conferme.map(u => ({
        id: crypto.randomUUID(),
        recipientUserId: u.id,
        type: 'lancio_appuntamento',
        title: titolo,
        body: `${lead.name}: ${whenLabel(at)}`,
        metadata: { leadId: lead.id },
        status: 'unread',
        createdAt: now,
        companyId: FENICE,
    }))).catch(e => console.error('[bot-lancio] notifica Conferme fallita', e))
}

function eventRows(lead: LancioLeadRow, botUserId: string, now: Date, at: Date, kind: string, extra: Record<string, unknown>) {
    return [
        { id: crypto.randomUUID(), leadId: lead.id, eventType: 'APPOINTMENT_SET', userId: botUserId, timestamp: now, metadata: { source: 'lancio', kind, at: at.toISOString() }, companyId: FENICE },
        { id: crypto.randomUUID(), leadId: lead.id, eventType: 'LANCIO_BOOKED', userId: botUserId, timestamp: now, metadata: { kind, at: at.toISOString(), ...extra }, companyId: FENICE },
    ]
}

export async function bookLancio(input: {
    lead: LancioLeadRow; botUserId: string; at: Date; kind: AtKind; dateStr: string; hour: number
    info?: LancioBotInfo; note?: string; now: Date; cfg?: LancioConfig
}): Promise<BookOutcome> {
    const cfg = input.cfg ?? LANCIO_WEBDEV
    const { lead, at, now, botUserId } = input
    const scelta = SCELTA_BY_KIND[input.kind]

    // Idempotenza: stesso `at` (±60 s) su un lead già prenotato = stessa richiesta.
    if (lead.lancioScelta === scelta && sameInstant(lead.appointmentDate, at)) {
        if (input.kind === 'mattina' && lead.salespersonUserId) {
            const [v] = await db.select({ name: users.name, displayName: users.displayName }).from(users).where(eq(users.id, lead.salespersonUserId))
            return { ok: true, kind: 'mattina', venditore: { id: lead.salespersonUserId, nome: v?.displayName || v?.name || 'Venditore' }, deduped: true }
        }
        if (input.kind !== 'mattina') return { ok: true, kind: input.kind, deduped: true }
    }

    const comune = {
        status: 'APPOINTMENT',
        appointmentDate: at,
        appointmentCreatedAt: now,
        appointmentNote: input.note?.trim() || null,
        lancioScelta: scelta,
        lancioSceltaAt: now,
        ...(input.info ? { lancioBotInfo: input.info } : {}),
        confNeedsReschedule: false,
        confSnoozeAt: null,
        version: lead.version + 1,
        updatedAt: now,
    }

    if (input.kind !== 'mattina') {
        // Senza venditore: le Conferme lo lavorano. Uno scarto Conferme
        // precedente si azzera come fa updateLeadOutcome su un nuovo appuntamento.
        const reset = lead.confirmationsOutcome === 'scartato' ? CONFERME_DISCARD_RESET : {}
        const updated = await db.update(leads)
            .set({ ...reset, ...comune })
            .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version)))
            .returning({ id: leads.id })
        // Versione cambiata sotto i piedi (doppio invio concorrente): il bot
        // ripropone gli slot e al secondo giro la dedup lo chiude.
        if (updated.length === 0) return { ok: false, motivo: 'ora_esaurita' }
        await db.insert(leadEvents).values(eventRows(lead, botUserId, now, at, input.kind, { info: input.info ?? null }))
        await notifyConfermeLancio(lead, at, '🚀 Lancio: appuntamento dal bot')
        return { ok: true, kind: input.kind }
    }

    const key = hourKey(input.dateStr, input.hour)
    return await db.transaction(async (tx: Db) => {
        // Lock per ORA: serializza le prenotazioni della stessa ora, non tutte.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'lancio:' + key}))`)

        const members = await getShiftMembers(tx, 'GIORNO_DOPO', cfg)
        const facts = await dayFactsFor(tx, members, input.dateStr)
        const chosen = pickRoundRobin(facts.filter(v => isFreeAt(v, key)))
        if (!chosen) return { ok: false as const, motivo: 'ora_esaurita' as const }
        const nome = members.find(m => m.salesUserId === chosen.salesUserId)?.name ?? 'Venditore'

        const updated = await tx.update(leads)
            .set({
                ...comune,
                confirmationsOutcome: 'confermato',
                confirmationsUserId: botUserId,
                confirmationsTimestamp: now,
                confirmationsDiscardReason: null,
                salespersonUserId: chosen.salesUserId,
                salespersonAssigned: nome,
                salespersonAssignedAt: now,
            })
            .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version)))
            .returning({ id: leads.id })
        if (updated.length === 0) return { ok: false as const, motivo: 'ora_esaurita' as const }

        await tx.update(launchShifts).set({ lastAssignedAt: now }).where(and(
            eq(launchShifts.bucket, cfg.bucket), eq(launchShifts.kind, 'GIORNO_DOPO'), eq(launchShifts.salesUserId, chosen.salesUserId),
        ))
        await tx.insert(leadEvents).values(eventRows(lead, botUserId, now, at, 'mattina', { salesUserId: chosen.salesUserId, info: input.info ?? null }))
        return { ok: true as const, kind: 'mattina' as const, venditore: { id: chosen.salesUserId, nome } }
    })
}

/** Calendar + marketing, fuori dalla risposta HTTP: la route la passa ad `after()`. */
export async function mattinaSideEffects(input: { lead: LancioLeadRow; venditoreId: string; at: Date; botUserId: string }): Promise<void> {
    const { lead, at } = input
    await createGoogleCalendarEvent(
        input.venditoreId,
        {
            summary: `Appuntamento CRM: ${lead.name}`,
            description: `Lead: ${lead.name}\nTelefono: ${lead.phone}\nEmail: ${lead.email || 'N/A'}\nFunnel: ${lead.funnel || 'N/A'}\nOrigine: lancio Web Dev AI (prenotato dal bot)\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
            startTime: at,
            endTime: addHours(at, 1),
            attendees: lead.email ? [{ email: lead.email }] : [],
        },
        lead.id,
        'appointment',
    ).catch((err: any) => console.error('[bot-lancio] Google Calendar fallito:', err?.message ?? err))

    for (const eventType of ['appointment.set', 'appointment.outcome', 'deal.assigned'] as const) {
        await enqueueMarketingWebhook({ eventType, leadId: lead.id, actorUserId: input.botUserId })
            .catch((e: unknown) => console.error(`[bot-lancio] webhook ${eventType} err:`, e))
    }
}
```

- [ ] **Step 2: Scrivi `src/app/api/bot/lancio/book/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { after } from 'next/server'
import { authBotRequest, computeSlots, loadLancioLead } from '@/lib/lancio/botGuard'
import { classifyAt } from '@/lib/lancio/rules'
import { bookLancio, mattinaSideEffects } from '@/lib/lancio/booking'
import type { LancioBotInfo } from '@/lib/lancio/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bot/lancio/book  { leadId, at (ISO con offset), info?, note? }
 * 200 { ok, kind, venditore?, deduped? } · 409 ora_esaurita (+slots) · 422 fuori_regole · 403.
 */
export async function POST(req: NextRequest) {
    const auth = await authBotRequest(req)
    if (!auth.ok) return auth.res
    const body = auth.body as { leadId?: string; at?: string; info?: unknown; note?: string }

    if (!body.leadId || !body.at) {
        return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'leadId e at richiesti' }, { status: 400 })
    }
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(body.at)) {
        return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'at deve includere il fuso orario (offset, es. +02:00)' }, { status: 400 })
    }
    const at = new Date(body.at)
    const now = new Date()
    const decision = classifyAt(at, now)
    if (!decision.ok) return NextResponse.json({ ok: false, motivo: 'fuori_regole' }, { status: 422 })

    const guard = await loadLancioLead(body.leadId)
    if (!guard.ok) return guard.res

    const info = body.info && typeof body.info === 'object' && !Array.isArray(body.info) ? body.info as LancioBotInfo : undefined
    const out = await bookLancio({
        lead: guard.lead, botUserId: guard.botUserId, at,
        kind: decision.kind, dateStr: decision.dateStr, hour: decision.hour,
        info, note: typeof body.note === 'string' ? body.note : undefined, now,
    })

    if (!out.ok) {
        const slots = await computeSlots(decision.dateStr, now)
        return NextResponse.json({ ok: false, motivo: 'ora_esaurita', slots }, { status: 409 })
    }
    if (out.kind === 'mattina' && !out.deduped) {
        const lead = guard.lead, venditoreId = out.venditore.id, botUserId = guard.botUserId
        after(() => mattinaSideEffects({ lead, venditoreId, at, botUserId }))
    }
    return NextResponse.json(out)
}
```

- [ ] **Step 3: Compila**

Run: `npx tsc --noEmit`
Expected: verde. Se il tipo `Db` non accetta `tx.execute`, definire in `shiftQueries.ts` `export type Db = Pick<typeof db, 'select' | 'update' | 'insert' | 'execute'>` — Drizzle tipizza la transazione con gli stessi metodi.

- [ ] **Step 4: Prova a mano su un lead di test** (dev server; inserire prima con SQL un lead `launchBucket='LANCIO_WEBDEV_2026'`, `assignedToId` = id dell'account bot, `companyId='fenice'`; nessun turno GIORNO_DOPO ancora). Firma come in Task 6.

Body `{"leadId":"<id>","at":"2026-10-06T10:00:00+02:00","info":{"risposte":["faccio il barista","mi ha colpito lo stipendio"]}}` → `409 { ok:false, motivo:'ora_esaurita', slots:{...} }` (turno vuoto).
Body con `"at":"2026-10-06T16:00:00+02:00"` → `200 { ok:true, kind:'pomeriggio' }`; ripetuto identico → `200 { ..., deduped:true }`; su DB il lead è `APPOINTMENT`, `lancioScelta='app_pomeriggio'`, `lancioBotInfo` valorizzato; le Conferme attive hanno una notifica `lancio_appuntamento`.
Body con `"at":"2026-10-06T09:30:00+02:00"` → `422`. Lead senza bucket → `403`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lancio/booking.ts src/app/api/bot/lancio/book/route.ts
git commit -m "feat(lancio): API book, mattina con lock per ora e round robin, pomeriggio alle Conferme"
```

---

### Task 8: Chiamata subito (`assignCallNow`) + `POST /api/bot/lancio/call-now`

**Files:**
- Modify: `src/lib/lancio/booking.ts` (aggiungi `assignCallNow`, `callNowSideEffects`)
- Create: `src/app/api/bot/lancio/call-now/route.ts`

**Interfaces:**
- Consumes: come Task 7; `getShiftMembers(tx,'SERA')`; `pickRoundRobin`.
- Produces:
  - `type CallNowOutcome = { ok:true; venditore:{ id:string; nome:string }; deduped?:true } | { ok:false; motivo:'nessun_venditore' }`
  - `assignCallNow(input: { lead: LancioLeadRow; botUserId: string; info?: LancioBotInfo; note?: string; now: Date; cfg?: LancioConfig }): Promise<CallNowOutcome>`
  - `callNowSideEffects(input: { leadId: string; botUserId: string }): Promise<void>` — webhook marketing `appointment.set` + `deal.assigned` (in `after()`).
  - Notifica al venditore: `notifications` con `type:'lancio_call_now'`, `title:'🚀 Lancio: chiama subito'`, `body:'<nome> ha chiesto di essere chiamato adesso'`, `metadata:{ leadId }` → il trigger 0019 la spinge sul topic `user:<venditoreId>` del bus, la campanella suona da sola.
- Contratto della route (bot B4): body `{ leadId, info?, note? }`. Risposte: `200 { ok:true, venditore:{id,nome} }` · `200 { ok:true, venditore, deduped:true }` · `409 { ok:false, motivo:'nessun_venditore' }` · `403` · `400`/`401`/`503`.

- [ ] **Step 1: Aggiungi in coda a `src/lib/lancio/booking.ts`**

```ts
export type CallNowOutcome =
    | { ok: true; venditore: { id: string; nome: string }; deduped?: true }
    | { ok: false; motivo: 'nessun_venditore' }

/**
 * Chiamata subito (spec §4.2): round robin sul turno SERA, nessun controllo di
 * calendario (il venditore di turno è lì apposta). Il lead nasce APPOINTMENT
 * "adesso", già confermato, con il contatore NR a zero: è la scheda venditore
 * (lancioActions.recordLancioCallNowNoAnswer) a farlo scalare.
 */
export async function assignCallNow(input: {
    lead: LancioLeadRow; botUserId: string; info?: LancioBotInfo; note?: string; now: Date; cfg?: LancioConfig
}): Promise<CallNowOutcome> {
    const cfg = input.cfg ?? LANCIO_WEBDEV
    const { lead, now, botUserId } = input

    // Idempotenza: già assegnato a un venditore per la chiamata subito.
    if (lead.lancioScelta === 'chiamata_subito' && lead.salespersonUserId) {
        const [v] = await db.select({ name: users.name, displayName: users.displayName }).from(users).where(eq(users.id, lead.salespersonUserId))
        return { ok: true, venditore: { id: lead.salespersonUserId, nome: v?.displayName || v?.name || 'Venditore' }, deduped: true }
    }

    return await db.transaction(async (tx: Db) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lancio:call-now'))`)
        const members = await getShiftMembers(tx, 'SERA', cfg)
        const chosen = pickRoundRobin(members)
        if (!chosen) return { ok: false as const, motivo: 'nessun_venditore' as const }

        const updated = await tx.update(leads).set({
            status: 'APPOINTMENT',
            appointmentDate: now,
            appointmentCreatedAt: now,
            appointmentNote: input.note?.trim() || null,
            confirmationsOutcome: 'confermato',
            confirmationsUserId: botUserId,
            confirmationsTimestamp: now,
            confirmationsDiscardReason: null,
            confNeedsReschedule: false,
            confSnoozeAt: null,
            salespersonUserId: chosen.salesUserId,
            salespersonAssigned: chosen.name,
            salespersonAssignedAt: now,
            lancioScelta: 'chiamata_subito',
            lancioSceltaAt: now,
            lancioCallNowAttempts: 0,
            lancioCallNowNextAt: null,
            ...(input.info ? { lancioBotInfo: input.info } : {}),
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, lead.id), eq(leads.version, lead.version))).returning({ id: leads.id })
        if (updated.length === 0) return { ok: false as const, motivo: 'nessun_venditore' as const }

        await tx.update(launchShifts).set({ lastAssignedAt: now }).where(and(
            eq(launchShifts.bucket, cfg.bucket), eq(launchShifts.kind, 'SERA'), eq(launchShifts.salesUserId, chosen.salesUserId),
        ))
        await tx.insert(leadEvents).values([
            { id: crypto.randomUUID(), leadId: lead.id, eventType: 'APPOINTMENT_SET', userId: botUserId, timestamp: now, metadata: { source: 'lancio', kind: 'chiamata_subito' }, companyId: FENICE },
            { id: crypto.randomUUID(), leadId: lead.id, eventType: 'LANCIO_CALL_NOW_ASSIGNED', userId: botUserId, timestamp: now, metadata: { salesUserId: chosen.salesUserId, info: input.info ?? null }, companyId: FENICE },
        ])
        await tx.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: chosen.salesUserId,
            type: 'lancio_call_now',
            title: '🚀 Lancio: chiama subito',
            body: `${lead.name} ha chiesto di essere chiamato adesso`,
            metadata: { leadId: lead.id },
            status: 'unread',
            createdAt: now,
            companyId: FENICE,
        })
        return { ok: true as const, venditore: { id: chosen.salesUserId, nome: chosen.name } }
    })
}

export async function callNowSideEffects(input: { leadId: string; botUserId: string }): Promise<void> {
    for (const eventType of ['appointment.set', 'deal.assigned'] as const) {
        await enqueueMarketingWebhook({ eventType, leadId: input.leadId, actorUserId: input.botUserId })
            .catch((e: unknown) => console.error(`[bot-lancio] webhook ${eventType} err:`, e))
    }
}
```

- [ ] **Step 2: Scrivi `src/app/api/bot/lancio/call-now/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { after } from 'next/server'
import { authBotRequest, loadLancioLead } from '@/lib/lancio/botGuard'
import { assignCallNow, callNowSideEffects } from '@/lib/lancio/booking'
import type { LancioBotInfo } from '@/lib/lancio/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bot/lancio/call-now  { leadId, info?, note? }
 * 200 { ok, venditore:{id,nome} } · 409 nessun_venditore (turno SERA vuoto) · 403.
 */
export async function POST(req: NextRequest) {
    const auth = await authBotRequest(req)
    if (!auth.ok) return auth.res
    const body = auth.body as { leadId?: string; info?: unknown; note?: string }
    if (!body.leadId) return NextResponse.json({ ok: false, motivo: 'bad_request', detail: 'leadId richiesto' }, { status: 400 })

    const guard = await loadLancioLead(body.leadId)
    if (!guard.ok) return guard.res

    const info = body.info && typeof body.info === 'object' && !Array.isArray(body.info) ? body.info as LancioBotInfo : undefined
    const out = await assignCallNow({
        lead: guard.lead, botUserId: guard.botUserId, info,
        note: typeof body.note === 'string' ? body.note : undefined, now: new Date(),
    })
    if (!out.ok) return NextResponse.json(out, { status: 409 })
    if (!out.deduped) {
        const leadId = guard.lead.id, botUserId = guard.botUserId
        after(() => callNowSideEffects({ leadId, botUserId }))
    }
    return NextResponse.json(out)
}
```

- [ ] **Step 3: Compila e prova a mano**

Run: `npx tsc --noEmit`
Expected: verde.

Prova (turno SERA vuoto): `{"leadId":"<id lead test>"}` → `409 { ok:false, motivo:'nessun_venditore' }`. Inserire a mano una riga in `launchShifts` (`kind='SERA'`, `bucket='LANCIO_WEBDEV_2026'`, `salesUserId` di un venditore attivo) → `200 { ok:true, venditore:{id,nome} }`; ripetere → `deduped:true`; il venditore ha una notifica `lancio_call_now`, il lead ha `lancioScelta='chiamata_subito'` e `salespersonUserId` valorizzato, `lastAssignedAt` aggiornato sul turno.

- [ ] **Step 4: Commit**

```bash
git add src/lib/lancio/booking.ts src/app/api/bot/lancio/call-now/route.ts
git commit -m "feat(lancio): API call-now con round robin sul turno SERA e notifica al venditore"
```

---
### Task 9: Pagina admin `/lancio` — turni, copertura, monitor

**Files:**
- Create: `src/lib/lancio/monitor.ts`
- Create: `src/app/actions/lancioActions.ts`
- Create: `src/app/(dashboard)/lancio/page.tsx`
- Create: `src/app/(dashboard)/lancio/LancioClient.tsx`
- Modify: `src/components/Sidebar.tsx` (gruppo "Venditori" di ADMIN/MANAGER, ~riga 224-230; import lucide ~riga 6)

**Interfaces:**
- Consumes: `LANCIO_WEBDEV`, `ShiftKind` (Task 2); `isFreeAt` (Task 3); `getShiftMembers`, `dayFactsFor`, `venditoreLabel` (Task 5); `hourKey` (Task 2); `weekStartKey`, `romeInstant` (`calendarSlots`); `currentTenant`, `assertSalesArea` (`@/lib/tenancy`); `DELIVERED_PUSH_RESULTS_SQL` (`@/lib/bot-fissatore/pushAudit`).
- Produces (`monitor.ts`):
  ```ts
  export interface LancioMonitor {
    inLista: number; spintiAlBot: number; pulsantePremuto: number
    chiamateSubito: { assegnate: number; esitate: number; chiuse: number; euro: number; passateAlleConferme: number }
    prenotati: { mattina: number; pomeriggio: number; dopodomani: number }
    followupRisposti: number; restituitiAlPool: number; distribuitiAiGdo: number
    /** Contatori che vivono nel DB del bot (benvenuto consegnato, hanno risposto, posto bloccato, link inviato): il CRM non li ha. */
    soloBot: string[]
  }
  export async function getLancioMonitor(companyId: string, botUserId: string | null, cfg?: LancioConfig): Promise<LancioMonitor>
  ```
- Produces (`lancioActions.ts`, `"use server"`, solo `async function` + `export type`):
  ```ts
  export type LancioAdminView = {
    config: { bucket: string; funnel: string; webinarAt: string; giornoDopo: string; dopodomani: string; oreVenditori: number[] }
    venditori: Array<{ id: string; name: string; calendarExempt: boolean }>
    shifts: { SERA: string[]; GIORNO_DOPO: string[] }
    copertura: Array<{ salesUserId: string; name: string; calendarExempt: boolean; compilato: boolean; oreDichiarate: number[]; oreLibere: number[] }>
    monitor: LancioMonitor
  }
  export async function getLancioAdminView(): Promise<LancioAdminView>
  export async function saveLaunchShifts(kind: ShiftKind, salesUserIds: string[]): Promise<{ ok: true } | { ok: false; error: string }>
  ```
- Il monitor NON pretende dati che il CRM non ha: i quattro contatori del bot (§4.3) sono elencati in `soloBot` e la UI li mostra come "— (dato del bot)". Restituzioni e follow-up si contano dagli eventi/colonne che B5 scriverà (`LANCIO_RETURNED_TO_POOL`, `lancioScelta='followup'`): valgono 0 finché B5 non è live, non è un errore.

- [ ] **Step 1: Scrivi `src/lib/lancio/monitor.ts`**

```ts
/**
 * Contatori del Monitor lancio (spec §4.3), dagli eventi e dalle colonne del
 * CRM. Modello: la card Black Summer di /import. Una query sui lead del bucket
 * con `count(*) filter (...)` + due sugli eventi.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leadEvents, leads } from '@/db/schema'
import { DELIVERED_PUSH_RESULTS_SQL } from '@/lib/bot-fissatore/pushAudit'
import { LANCIO_WEBDEV, CALL_NOW_MAX_ATTEMPTS, type LancioConfig } from './config'

export interface LancioMonitor {
    inLista: number
    spintiAlBot: number
    pulsantePremuto: number
    chiamateSubito: { assegnate: number; esitate: number; chiuse: number; euro: number; passateAlleConferme: number }
    prenotati: { mattina: number; pomeriggio: number; dopodomani: number }
    followupRisposti: number
    restituitiAlPool: number
    distribuitiAiGdo: number
    soloBot: string[]
}

export async function getLancioMonitor(companyId: string, botUserId: string | null, cfg: LancioConfig = LANCIO_WEBDEV): Promise<LancioMonitor> {
    const inBucket = and(eq(leads.companyId, companyId), eq(leads.launchBucket, cfg.bucket))
    const [c] = await db.select({
        inLista: sql<number>`count(*)::int`,
        pulsantePremuto: sql<number>`count(*) filter (where ${leads.lancioIngresso} = 'pulsante_webinar' or ${leads.lancioScelta} is not null)::int`,
        csAssegnate: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'chiamata_subito')::int`,
        csEsitate: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'chiamata_subito' and ${leads.salespersonOutcome} is not null)::int`,
        csChiuse: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'chiamata_subito' and ${leads.salespersonOutcome} = 'Chiuso')::int`,
        csEuro: sql<number>`coalesce(sum(${leads.closeAmountEur}) filter (where ${leads.lancioScelta} = 'chiamata_subito' and ${leads.salespersonOutcome} = 'Chiuso'), 0)::float`,
        csConferme: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'chiamata_subito' and ${leads.lancioCallNowAttempts} >= ${CALL_NOW_MAX_ATTEMPTS} and ${leads.salespersonUserId} is null)::int`,
        mattina: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'app_mattina')::int`,
        pomeriggio: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'app_pomeriggio')::int`,
        dopodomani: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'app_dopodomani')::int`,
        followup: sql<number>`count(*) filter (where ${leads.lancioScelta} = 'followup')::int`,
        aiGdo: botUserId
            ? sql<number>`count(*) filter (where ${leads.assignedToId} is not null and ${leads.assignedToId} <> ${botUserId})::int`
            : sql<number>`count(*) filter (where ${leads.assignedToId} is not null)::int`,
    }).from(leads).where(inBucket)

    const [ev] = await db.select({
        spinti: sql<number>`count(distinct ${leadEvents.leadId}) filter (where ${leadEvents.eventType} = 'BOT_PUSHED' and ${leadEvents.metadata}->>'result' in (${sql.raw(DELIVERED_PUSH_RESULTS_SQL)}))::int`,
        restituiti: sql<number>`count(distinct ${leadEvents.leadId}) filter (where ${leadEvents.eventType} = 'LANCIO_RETURNED_TO_POOL')::int`,
    }).from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(inBucket)

    return {
        inLista: c?.inLista ?? 0,
        spintiAlBot: ev?.spinti ?? 0,
        pulsantePremuto: c?.pulsantePremuto ?? 0,
        chiamateSubito: { assegnate: c?.csAssegnate ?? 0, esitate: c?.csEsitate ?? 0, chiuse: c?.csChiuse ?? 0, euro: c?.csEuro ?? 0, passateAlleConferme: c?.csConferme ?? 0 },
        prenotati: { mattina: c?.mattina ?? 0, pomeriggio: c?.pomeriggio ?? 0, dopodomani: c?.dopodomani ?? 0 },
        followupRisposti: c?.followup ?? 0,
        restituitiAlPool: ev?.restituiti ?? 0,
        distribuitiAiGdo: c?.aiGdo ?? 0,
        soloBot: ['Benvenuto consegnato', 'Hanno risposto', 'Posto bloccato', 'Link Zoom inviato'],
    }
}
```

- [ ] **Step 2: Scrivi `src/app/actions/lancioActions.ts`** (le action della scheda venditore si aggiungono in Task 10)

```ts
"use server"

import crypto from "crypto"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { launchShifts, salesWeekPlans, users } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { romeInstant, weekStartKey } from "@/lib/venditore/calendarSlots"
import { LANCIO_WEBDEV, type ShiftKind } from "@/lib/lancio/config"
import { hourKey } from "@/lib/lancio/rules"
import { isFreeAt } from "@/lib/lancio/slots"
import { dayFactsFor, getShiftMembers, venditoreLabel } from "@/lib/lancio/shiftQueries"
import { getLancioMonitor, type LancioMonitor } from "@/lib/lancio/monitor"

export type LancioAdminView = {
    config: { bucket: string; funnel: string; webinarAt: string; giornoDopo: string; dopodomani: string; oreVenditori: number[] }
    venditori: Array<{ id: string; name: string; calendarExempt: boolean }>
    shifts: { SERA: string[]; GIORNO_DOPO: string[] }
    copertura: Array<{ salesUserId: string; name: string; calendarExempt: boolean; compilato: boolean; oreDichiarate: number[]; oreLibere: number[] }>
    monitor: LancioMonitor
}

async function requireAdminFenice(): Promise<{ userId: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || (role !== 'ADMIN' && role !== 'MANAGER')) throw new Error('Unauthorized')
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.companyId !== 'fenice') throw new Error('Il lancio è solo Fenice')
    return { userId: user.id }
}

export async function getLancioAdminView(): Promise<LancioAdminView> {
    await requireAdminFenice()
    const cfg = LANCIO_WEBDEV

    const venditoriRows = await db.select({
        id: users.id, name: users.name, displayName: users.displayName, calendarExempt: users.calendarExempt,
    }).from(users).where(and(eq(users.role, 'VENDITORE'), eq(users.isActive, true))).orderBy(users.name)
    const venditori = venditoriRows.map(v => ({ id: v.id, name: venditoreLabel(v), calendarExempt: v.calendarExempt }))

    const [sera, giornoDopo] = await Promise.all([getShiftMembers(db, 'SERA', cfg), getShiftMembers(db, 'GIORNO_DOPO', cfg)])

    // Copertura 9-14 del giorno dopo, letta dal calendario dei venditori del turno.
    const facts = await dayFactsFor(db, giornoDopo, cfg.giornoDopo)
    const weekKey = weekStartKey(romeInstant(cfg.giornoDopo, 12))
    const plans = giornoDopo.length > 0
        ? await db.select({ salesUserId: salesWeekPlans.salesUserId }).from(salesWeekPlans).where(and(
            inArray(salesWeekPlans.salesUserId, giornoDopo.map(m => m.salesUserId)),
            eq(salesWeekPlans.weekStart, weekKey),
        ))
        : []
    const compilati = new Set(plans.map(p => p.salesUserId))
    const copertura = giornoDopo.map(m => {
        const f = facts.find(x => x.salesUserId === m.salesUserId)
        const oreDichiarate = cfg.oreVenditori.filter(h => f?.declared.has(hourKey(cfg.giornoDopo, h)))
        const oreLibere = cfg.oreVenditori.filter(h => f ? isFreeAt(f, hourKey(cfg.giornoDopo, h)) : false)
        return { salesUserId: m.salesUserId, name: m.name, calendarExempt: m.calendarExempt, compilato: compilati.has(m.salesUserId) || m.calendarExempt, oreDichiarate, oreLibere }
    })

    const [bot] = await db.select({ id: users.id }).from(users).where(and(eq(users.isBot, true), eq(users.companyId, 'fenice'))).limit(1)
    const monitor = await getLancioMonitor('fenice', bot?.id ?? null, cfg)

    return {
        config: { bucket: cfg.bucket, funnel: cfg.funnel, webinarAt: cfg.webinarAt, giornoDopo: cfg.giornoDopo, dopodomani: cfg.dopodomani, oreVenditori: cfg.oreVenditori },
        venditori,
        shifts: { SERA: sera.map(m => m.salesUserId), GIORNO_DOPO: giornoDopo.map(m => m.salesUserId) },
        copertura,
        monitor,
    }
}

/**
 * Salva le spunte di un turno. Soft delete: chi esce prende removedAt, chi
 * rientra si riattiva (l'unique bucket+kind+salesUserId lo impone) e tiene
 * il suo lastAssignedAt. La storia dei turni è la tabella stessa.
 */
export async function saveLaunchShifts(kind: ShiftKind, salesUserIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
    const { userId } = await requireAdminFenice()
    if (kind !== 'SERA' && kind !== 'GIORNO_DOPO') return { ok: false, error: 'Turno non valido' }
    const cfg = LANCIO_WEBDEV
    const wanted = new Set(salesUserIds)

    const validi = await db.select({ id: users.id }).from(users).where(and(
        eq(users.role, 'VENDITORE'), eq(users.isActive, true), inArray(users.id, [...wanted].length ? [...wanted] : ['__nessuno__']),
    ))
    if (validi.length !== wanted.size) return { ok: false, error: 'Uno dei venditori selezionati non è attivo' }

    const now = new Date()
    await db.transaction(async (tx) => {
        const existing = await tx.select({ id: launchShifts.id, salesUserId: launchShifts.salesUserId, removedAt: launchShifts.removedAt })
            .from(launchShifts).where(and(eq(launchShifts.bucket, cfg.bucket), eq(launchShifts.kind, kind)))
        const byUser = new Map(existing.map(r => [r.salesUserId, r]))

        for (const id of wanted) {
            const row = byUser.get(id)
            if (!row) {
                await tx.insert(launchShifts).values({ id: crypto.randomUUID(), companyId: 'fenice', bucket: cfg.bucket, kind, salesUserId: id, createdBy: userId, createdAt: now })
            } else if (row.removedAt) {
                await tx.update(launchShifts).set({ removedAt: null, removedBy: null, createdBy: userId }).where(eq(launchShifts.id, row.id))
            }
        }
        for (const row of existing) {
            if (!wanted.has(row.salesUserId) && !row.removedAt) {
                await tx.update(launchShifts).set({ removedAt: now, removedBy: userId }).where(eq(launchShifts.id, row.id))
            }
        }
    })
    revalidatePath('/lancio')
    return { ok: true }
}
```

- [ ] **Step 3: Scrivi `src/app/(dashboard)/lancio/page.tsx`**

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getLancioAdminView } from "@/app/actions/lancioActions"
import { LancioClient } from "./LancioClient"

export default async function LancioPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    if (!user || !["ADMIN", "MANAGER"].includes(role)) redirect("/")

    let initial
    try {
        initial = await getLancioAdminView()
    } catch {
        // Azienda diversa da Fenice (o non autorizzato): la pagina non ha senso qui.
        redirect("/")
    }
    return (
        <div className="min-h-screen p-4 sm:p-6">
            <LancioClient initial={initial} />
        </div>
    )
}
```

- [ ] **Step 4: Scrivi `src/app/(dashboard)/lancio/LancioClient.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Rocket, Save, AlertTriangle, CheckCircle2 } from "lucide-react"
import { saveLaunchShifts, type LancioAdminView } from "@/app/actions/lancioActions"

type Kind = 'SERA' | 'GIORNO_DOPO'

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
    return (
        <div className="rounded-xl border border-amber-200 bg-white p-3 shadow-soft" title={hint}>
            <div className="text-[11px] font-bold uppercase tracking-wide text-ash-500">{label}</div>
            <div className="mt-1 text-2xl font-bold text-ash-900 tabular-nums">{value}</div>
        </div>
    )
}

function ShiftPicker({ kind, title, subtitle, venditori, selected, onSaved }: {
    kind: Kind; title: string; subtitle: string
    venditori: LancioAdminView['venditori']; selected: string[]; onSaved: () => void
}) {
    const [chosen, setChosen] = useState<Set<string>>(new Set(selected))
    const [pending, start] = useTransition()
    const [msg, setMsg] = useState<string | null>(null)
    const dirty = chosen.size !== selected.length || selected.some(id => !chosen.has(id))

    const toggle = (id: string) => setChosen(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })
    const save = () => start(async () => {
        setMsg(null)
        const res = await saveLaunchShifts(kind, [...chosen])
        setMsg(res.ok ? 'Turno salvato.' : res.error)
        if (res.ok) onSaved()
    })

    return (
        <div className="rounded-xl border border-ash-200/80 bg-white p-4 shadow-soft">
            <div className="mb-3">
                <h3 className="font-bold text-ash-900">{title}</h3>
                <p className="text-xs text-ash-500">{subtitle}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
                {venditori.map(v => (
                    <label key={v.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-ash-200/60 px-3 py-2 text-sm hover:border-brand-orange/40">
                        <input type="checkbox" checked={chosen.has(v.id)} onChange={() => toggle(v.id)} className="h-4 w-4 accent-brand-orange" />
                        <span className="font-medium text-ash-800">{v.name}</span>
                        {v.calendarExempt && <span className="ml-auto rounded bg-ash-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ash-500">esente calendario</span>}
                    </label>
                ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
                <button onClick={save} disabled={pending || !dirty}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-40">
                    <Save className="h-4 w-4" /> {pending ? 'Salvataggio…' : 'Salva turno'}
                </button>
                {msg && <div className="text-xs font-semibold text-ash-600">{msg}</div>}
            </div>
        </div>
    )
}

export function LancioClient({ initial }: { initial: LancioAdminView }) {
    const router = useRouter()
    const { config, venditori, shifts, copertura, monitor } = initial
    const refresh = () => router.refresh()
    const nonCompilati = copertura.filter(c => !c.compilato)

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-white"><Rocket className="h-5 w-5" /></div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">Lancio Web Dev AI</h1>
                    <div className="text-sm text-ash-500">Webinar {new Date(config.webinarAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full', timeStyle: 'short' })} · funnel {config.funnel} · bucket {config.bucket}</div>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <ShiftPicker kind="SERA" title="Turno SERA (chiamate subito)" subtitle="La sera del webinar: chi preme il pulsante e vuole essere chiamato adesso va a questi venditori, a rotazione." venditori={venditori} selected={shifts.SERA} onSaved={refresh} />
                <ShiftPicker kind="GIORNO_DOPO" title={`Turno GIORNO DOPO (${config.giornoDopo}, ore 9-15)`} subtitle="Appuntamenti già confermati sulle ore dichiarate nel calendario. Senza ore dichiarate il venditore non riceve nulla." venditori={venditori} selected={shifts.GIORNO_DOPO} onSaved={refresh} />
            </div>

            <div className="rounded-xl border border-ash-200/80 bg-white p-4 shadow-soft">
                <h3 className="font-bold text-ash-900">Copertura 9-15 del {config.giornoDopo}</h3>
                <p className="mb-3 text-xs text-ash-500">Dal calendario disponibilità dei venditori del turno GIORNO DOPO. Verde = ora libera, grigio = dichiarata ma occupata/bloccata, vuoto = non dichiarata.</p>
                {nonCompilati.length > 0 && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        Calendario della settimana non compilato: {nonCompilati.map(c => c.name).join(', ')}. Senza ore dichiarate la mattina risulta piena e tutto va alle Conferme.
                    </div>
                )}
                {copertura.length === 0 ? (
                    <div className="py-6 text-center text-sm text-ash-400">Nessun venditore nel turno GIORNO DOPO.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-ash-500">
                                    <th className="py-1 pr-3">Venditore</th>
                                    {config.oreVenditori.map(h => <th key={h} className="px-1 py-1 text-center">{String(h).padStart(2, '0')}:00</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {copertura.map(c => (
                                    <tr key={c.salesUserId} className="border-t border-ash-100">
                                        <td className="py-1.5 pr-3 font-medium text-ash-800">
                                            <div className="flex items-center gap-2">
                                                {c.name}
                                                {!c.compilato && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">non compilato</span>}
                                            </div>
                                        </td>
                                        {config.oreVenditori.map(h => {
                                            const libera = c.oreLibere.includes(h)
                                            const dichiarata = c.oreDichiarate.includes(h)
                                            return (
                                                <td key={h} className="px-1 py-1.5 text-center">
                                                    <div className={`mx-auto h-6 w-10 rounded-md ${libera ? 'bg-emerald-400' : dichiarata ? 'bg-ash-300' : 'border border-dashed border-ash-200'}`} title={libera ? 'Libera' : dichiarata ? 'Occupata o bloccata' : 'Non dichiarata'} />
                                                </td>
                                            )
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-white p-4 shadow-soft">
                <h3 className="mb-3 font-bold text-ash-900">Monitor lancio</h3>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Tile label="In lista (bucket)" value={monitor.inLista} />
                    <Tile label="Spinti al bot" value={monitor.spintiAlBot} hint="BOT_PUSHED consegnati" />
                    <Tile label="Pulsante premuto" value={monitor.pulsantePremuto} hint="Entrati dal pulsante o con una scelta fatta" />
                    <Tile label="Chiamate subito" value={`${monitor.chiamateSubito.assegnate} / ${monitor.chiamateSubito.esitate} / ${monitor.chiamateSubito.chiuse}`} hint="assegnate / esitate / chiuse" />
                    <Tile label="€ chiamate subito" value={`${Math.round(monitor.chiamateSubito.euro)} €`} />
                    <Tile label="Passate alle Conferme (3 NR)" value={monitor.chiamateSubito.passateAlleConferme} />
                    <Tile label="Prenotati mattina" value={monitor.prenotati.mattina} />
                    <Tile label="Prenotati pomeriggio" value={monitor.prenotati.pomeriggio} />
                    <Tile label="Prenotati dopodomani" value={monitor.prenotati.dopodomani} />
                    <Tile label="Follow-up → flusso standard" value={monitor.followupRisposti} hint="lancioScelta = followup (dal B5)" />
                    <Tile label="Restituiti al pool" value={monitor.restituitiAlPool} hint="Eventi LANCIO_RETURNED_TO_POOL (dal B5)" />
                    <Tile label="Distribuiti ai GDO" value={monitor.distribuitiAiGdo} />
                    {monitor.soloBot.map(l => <Tile key={l} label={l} value="—" hint="Dato che vive nel database del bot: si legge dai pannelli /fenice" />)}
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-ash-500"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> I contatori si aggiornano a ogni apertura della pagina.</div>
            </div>
        </div>
    )
}
```

- [ ] **Step 5: Sidebar** — in `src/components/Sidebar.tsx`, aggiungi `Rocket` all'import da `lucide-react` e, nel gruppo `label: "Venditori"` dei `navGroups` (ADMIN/MANAGER), dopo `{ name: "Calendari Venditori", href: "/calendari-venditori", icon: CalendarClock }`:

```ts
                        { name: "Lancio Web Dev", href: "/lancio", icon: Rocket },
```

- [ ] **Step 6: Compila e verifica dal vivo**

Run: `npx tsc --noEmit`
Expected: verde.

Dal browser come ADMIN: `/lancio` mostra le due liste di spunte, salva un turno SERA (riga in `launchShifts`), toglie la spunta e salva (la riga prende `removedAt`), la rimette (riattivata, stessa riga). Con un venditore nel turno GIORNO_DOPO senza calendario della settimana del 5-10/10 compare l'avviso rosso. Come CONFERME: `/lancio` → redirect.

- [ ] **Step 7: Commit**

```bash
git add src/lib/lancio/monitor.ts src/app/actions/lancioActions.ts "src/app/(dashboard)/lancio" src/components/Sidebar.tsx
git commit -m "feat(lancio): pagina /lancio con turni venditori, copertura 9-15 e monitor"
```

---
### Task 10: Scheda venditore "Lancio: chiamate subito" + esclusioni (OutcomeGate, Lista, multe)

**Files:**
- Modify: `src/app/actions/lancioActions.ts` (aggiungi `getVenditoreLancioLeads`, `recordLancioCallNowNoAnswer`)
- Create: `src/components/venditore/LancioCallNowTab.tsx`
- Modify: `src/components/VenditoreDashboardClient.tsx` (tipo `view` riga 29; fetch ~riga 133-150; useEffect bus ~riga 171-190; barra tab ~riga 250-300; filtro Lista ~riga 205; render viste ~riga 700-712)
- Modify: `src/app/actions/venditoreActions.ts:29-70` (`getVenditoreAppointments` select)
- Modify: `src/app/(dashboard)/venditore/page.tsx:24-30` (filtro OutcomeGate)
- Modify: `src/lib/venditore/latePenaltiesRunner.ts:38-56` e `:64-78` (candidati)

**Interfaces:**
- Consumes: `callNowColumn`, `nextCallNowState`, `CallNowColumn` (Task 4); `notifyConfermeLancio` (Task 7); `CONFERME_DISCARD_RESET`; `logLeadEvent` (`@/lib/eventLogger`); `VenditoreDrawer` (props `lead, onClose, onSaved, onStartNegotiation, isStarting`); `startNegotiation` (`venditoreActions`).
- Produces (`lancioActions.ts`):
  ```ts
  export type LancioCallNowLead = {
    id: string; name: string; phone: string; email: string | null; funnel: string | null
    lancioSceltaAt: string | null; lancioCallNowAttempts: number; lancioCallNowNextAt: string | null
    lancioBotInfo: { risposte?: string[] } | null; appointmentNote: string | null
    negotiationStartedAt: string | null; salespersonOutcome: string | null; appointmentDate: string | null
    version: number; priorNonClosedCount: number; attemptCount: number; column: CallNowColumn
  }
  export async function getVenditoreLancioLeads(sellerId: string): Promise<LancioCallNowLead[]>
  export async function recordLancioCallNowNoAnswer(leadId: string): Promise<{ ok: true; handoff: boolean } | { ok: false; error: string }>
  ```
- Il telefono di questi lead è visibile SUBITO (senza check-in): il lead ha chiesto lui di essere chiamato adesso. "Registra esito" fa il check-in (`startNegotiation`) se manca e apre il `VenditoreDrawer` esistente; niente `OutcomeGate` su questi lead; niente multe ritardi.

- [ ] **Step 1: Aggiungi in coda a `src/app/actions/lancioActions.ts`**

Aggiungi agli import: `import { leads, leadEvents, salesAttempts } from "@/db/schema"` (unire con l'import esistente di `@/db/schema`), `import { desc, isNotNull } from "drizzle-orm"` (unire), `import { CONFERME_DISCARD_RESET } from "@/lib/confermeReset"`, `import { callNowColumn, nextCallNowState, type CallNowColumn } from "@/lib/lancio/callNow"`, `import { notifyConfermeLancio } from "@/lib/lancio/booking"`, `import { countCycleNonClosed } from "@/lib/venditorePerformance/guard"`, `import { logLeadEvent } from "@/lib/eventLogger"`.

```ts
export type LancioCallNowLead = {
    id: string; name: string; phone: string; email: string | null; funnel: string | null
    lancioSceltaAt: string | null; lancioCallNowAttempts: number; lancioCallNowNextAt: string | null
    lancioBotInfo: { risposte?: string[] } | null; appointmentNote: string | null
    negotiationStartedAt: string | null; salespersonOutcome: string | null; appointmentDate: string | null
    version: number; priorNonClosedCount: number; attemptCount: number; column: CallNowColumn
}

async function requireVenditoreOrStaff(sellerId: string): Promise<{ userId: string; isStaff: boolean; companyId: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role ?? '')) throw new Error('Unauthorized')
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = role === 'MANAGER' || role === 'ADMIN'
    if (!isStaff && sellerId !== user.id) throw new Error('Forbidden')
    return { userId: user.id, isStaff, companyId: ctx.companyId }
}

/** I lead "chiamata subito" del venditore, con la colonna della scheda già calcolata. */
export async function getVenditoreLancioLeads(sellerId: string): Promise<LancioCallNowLead[]> {
    const { companyId } = await requireVenditoreOrStaff(sellerId)
    const rows = await db.select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, funnel: leads.funnel,
        lancioSceltaAt: leads.lancioSceltaAt, lancioCallNowAttempts: leads.lancioCallNowAttempts, lancioCallNowNextAt: leads.lancioCallNowNextAt,
        lancioBotInfo: leads.lancioBotInfo, appointmentNote: leads.appointmentNote,
        negotiationStartedAt: leads.negotiationStartedAt, salespersonOutcome: leads.salespersonOutcome, appointmentDate: leads.appointmentDate,
        version: leads.version, salesCycleStartAt: leads.salesCycleStartAt,
    }).from(leads).where(and(
        eq(leads.companyId, companyId),
        eq(leads.salespersonUserId, sellerId),
        eq(leads.lancioScelta, 'chiamata_subito'),
    )).orderBy(desc(leads.lancioSceltaAt))

    const ids = rows.map(r => r.id)
    const attempts = ids.length
        ? await db.select({ leadId: salesAttempts.leadId, outcome: salesAttempts.outcome, outcomeAt: salesAttempts.outcomeAt })
            .from(salesAttempts).where(and(eq(salesAttempts.companyId, companyId), inArray(salesAttempts.leadId, ids)))
        : []
    const byLead = new Map<string, { outcome: string; outcomeAt: Date | null }[]>()
    for (const a of attempts) byLead.set(a.leadId, [...(byLead.get(a.leadId) ?? []), a])

    const iso = (d: Date | null) => (d ? d.toISOString() : null)
    return rows.map(r => {
        const arr = byLead.get(r.id) ?? []
        return {
            id: r.id, name: r.name, phone: r.phone, email: r.email, funnel: r.funnel,
            lancioSceltaAt: iso(r.lancioSceltaAt), lancioCallNowAttempts: r.lancioCallNowAttempts ?? 0, lancioCallNowNextAt: iso(r.lancioCallNowNextAt),
            lancioBotInfo: (r.lancioBotInfo as { risposte?: string[] } | null) ?? null, appointmentNote: r.appointmentNote,
            negotiationStartedAt: iso(r.negotiationStartedAt), salespersonOutcome: r.salespersonOutcome, appointmentDate: iso(r.appointmentDate),
            version: r.version, attemptCount: arr.length,
            priorNonClosedCount: countCycleNonClosed(arr, r.salesCycleStartAt ?? null),
            column: callNowColumn({ lancioCallNowAttempts: r.lancioCallNowAttempts ?? 0, salespersonOutcome: r.salespersonOutcome }),
        }
    })
}

/**
 * "Non risponde" sulla chiamata subito: +1 tentativo e richiamo fra 30 minuti;
 * al terzo passa alle Conferme il giorno dopo (A1): venditore azzerato, esito
 * Conferme azzerato, appuntamento alle 09:00, badge LANCIO in board.
 */
export async function recordLancioCallNowNoAnswer(leadId: string): Promise<{ ok: true; handoff: boolean } | { ok: false; error: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role ?? '')) return { ok: false, error: 'Unauthorized' }
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = role === 'MANAGER' || role === 'ADMIN'

    const [lead] = await db.select().from(leads).where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId))).limit(1)
    if (!lead) return { ok: false, error: 'Lead non trovato' }
    if (lead.lancioScelta !== 'chiamata_subito') return { ok: false, error: 'Non è una chiamata subito del lancio' }
    if (!isStaff && lead.salespersonUserId !== user.id) return { ok: false, error: 'Lead di un altro venditore' }
    if (lead.salespersonOutcome) return { ok: false, error: 'Il lead ha già un esito' }
    if (!lead.salespersonUserId) return { ok: false, error: 'Lead già passato alle Conferme' }

    const now = new Date()
    const next = nextCallNowState(lead.lancioCallNowAttempts ?? 0, now)
    const previousSeller = lead.salespersonUserId

    if (next.kind === 'retry') {
        await db.update(leads).set({
            lancioCallNowAttempts: next.attempts,
            lancioCallNowNextAt: next.nextAt,
            lastCallDate: now,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version)))
    } else {
        await db.update(leads).set({
            ...CONFERME_DISCARD_RESET,
            lancioCallNowAttempts: next.attempts,
            lancioCallNowNextAt: null,
            lastCallDate: now,
            appointmentDate: next.appointmentAt,
            salespersonUserId: null,
            salespersonAssigned: null,
            salespersonAssignedAt: null,
            negotiationStartedAt: null,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version)))
        await notifyConfermeLancio({ id: lead.id, name: lead.name }, next.appointmentAt, '🚀 Lancio: 3 NR dal venditore, da richiamare')
    }

    await logLeadEvent({
        leadId, eventType: 'CALL_LOGGED', userId: user.id, companyId: ctx.companyId,
        metadata: { source: 'lancio_call_now', outcome: 'NON_RISPOSTO', attempts: next.attempts, handoff: next.kind === 'handoff', previousSeller },
    })
    revalidatePath('/venditore')
    return { ok: true, handoff: next.kind === 'handoff' }
}
```

- [ ] **Step 2: Scrivi `src/components/venditore/LancioCallNowTab.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import { Phone, PhoneMissed, Clock, Rocket } from "lucide-react"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import { recordLancioCallNowNoAnswer, type LancioCallNowLead } from "@/app/actions/lancioActions"
import type { CallNowColumn } from "@/lib/lancio/callNow"

const COLONNE: Array<{ key: CallNowColumn; title: string }> = [
    { key: 'da_chiamare', title: 'Da chiamare' },
    { key: 'seconda', title: 'Seconda chiamata' },
    { key: 'terza', title: 'Terza chiamata' },
    { key: 'esitati', title: 'Esitati' },
]

export function LancioCallNowTab({ leads, onOpen, onChanged }: {
    leads: LancioCallNowLead[]
    /** Apre il drawer esiti (il chiamante fa il check-in se manca). */
    onOpen: (lead: LancioCallNowLead) => void
    onChanged: () => void
}) {
    const [busyId, setBusyId] = useState<string | null>(null)
    const [, start] = useTransition()

    const nonRisponde = (lead: LancioCallNowLead) => {
        setBusyId(lead.id)
        start(async () => {
            try {
                const res = await recordLancioCallNowNoAnswer(lead.id)
                if (!res.ok) alert(res.error)
                else if (res.handoff) alert('Terzo tentativo a vuoto: il lead passa alle Conferme domattina.')
                onChanged()
            } finally {
                setBusyId(null)
            }
        })
    }

    return (
        <div className="p-2 sm:p-6 bg-gradient-to-b from-amber-50/50 to-white">
            <div className="mb-4 flex items-center gap-2 text-sm text-ash-600">
                <Rocket className="h-4 w-4 text-amber-500" />
                Lead della live che hanno chiesto di essere chiamati adesso. Chiama, poi "Registra esito" oppure "Non risponde" (richiamo fra 30 minuti, al terzo passa alle Conferme).
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {COLONNE.map(col => {
                    const items = leads.filter(l => l.column === col.key)
                    return (
                        <div key={col.key} className="rounded-xl border border-ash-200/60 bg-white p-3 shadow-soft">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-sm font-bold uppercase tracking-wide text-ash-700">{col.title}</h3>
                                <span className="rounded-full bg-ash-100 px-2 py-0.5 text-xs font-bold text-ash-600">{items.length}</span>
                            </div>
                            <div className="space-y-2">
                                {items.length === 0 && <div className="py-4 text-center text-xs text-ash-400">Nessun lead</div>}
                                {items.map(lead => {
                                    const nextAt = lead.lancioCallNowNextAt ? new Date(lead.lancioCallNowNextAt) : null
                                    const richiamaTra = nextAt ? Math.max(0, Math.round((nextAt.getTime() - Date.now()) / 60_000)) : null
                                    return (
                                        <div key={lead.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="truncate font-bold text-ash-900">{lead.name}</div>
                                                    <div className="flex items-center gap-1 text-sm text-ash-700"><Phone className="h-3.5 w-3.5 text-ash-400" />{lead.phone}</div>
                                                </div>
                                                {lead.lancioSceltaAt && (
                                                    <div className="shrink-0 text-[11px] text-ash-500" title="Ora della richiesta">
                                                        {format(new Date(lead.lancioSceltaAt), 'HH:mm', { locale: it })}
                                                    </div>
                                                )}
                                            </div>
                                            {lead.lancioBotInfo?.risposte && lead.lancioBotInfo.risposte.length > 0 && (
                                                <ul className="mt-2 space-y-0.5 rounded-md bg-white/70 p-2 text-xs text-ash-700">
                                                    {lead.lancioBotInfo.risposte.map((r, i) => <li key={i}>💬 {r}</li>)}
                                                </ul>
                                            )}
                                            {lead.appointmentNote && <div className="mt-1 text-xs italic text-ash-500">{lead.appointmentNote}</div>}
                                            {richiamaTra !== null && col.key !== 'esitati' && (
                                                <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-amber-700"><Clock className="h-3 w-3" /> {richiamaTra > 0 ? `richiama fra ${richiamaTra} min` : 'da richiamare ora'}</div>
                                            )}
                                            {col.key === 'esitati' ? (
                                                <div className="mt-2 text-xs font-bold text-emerald-700">{lead.salespersonOutcome}</div>
                                            ) : (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <button onClick={() => onOpen(lead)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600">
                                                        <Phone className="h-3.5 w-3.5" /> Registra esito
                                                    </button>
                                                    <button onClick={() => nonRisponde(lead)} disabled={busyId === lead.id} className="inline-flex items-center gap-1.5 rounded-lg border border-ash-200 bg-white px-3 py-1.5 text-xs font-semibold text-ash-700 hover:border-red-300 hover:text-red-700 disabled:opacity-50">
                                                        <PhoneMissed className="h-3.5 w-3.5" /> Non risponde
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
```

- [ ] **Step 3: `VenditoreDashboardClient.tsx` — tab "Lancio"**

1. Import: `import { LancioCallNowTab } from "@/components/venditore/LancioCallNowTab"`, `import { getVenditoreLancioLeads, type LancioCallNowLead } from "@/app/actions/lancioActions"`, `Rocket` da `lucide-react`.
2. Tipo della vista (riga 29): aggiungi `'LANCIO'` all'unione.
3. Stato: `const [lancioLeads, setLancioLeads] = useState<LancioCallNowLead[]>([])` e
   ```ts
   const fetchLancio = async () => {
       try { setLancioLeads(await getVenditoreLancioLeads(sellerId)) } catch (e) { console.error(e) }
   }
   ```
4. Nel `useEffect` di mount (riga ~171): chiama `fetchLancio()` accanto a `fetchFollowUps()`, e dentro `onBusEvent('leads', ...)` aggiungi `fetchLancio()` (la notifica `lancio_call_now` e il ping `leads` arrivano insieme: la tab si aggiorna da sola).
5. Filtro Lista (dentro `filteredAppointments`, prima di `// Search`): `if (app.lancioScelta === 'chiamata_subito') return false` — questi lead vivono solo nella tab Lancio.
6. Barra tab: subito dopo il bottone Follow-up, visibile solo se ci sono lead:
   ```tsx
   {lancioLeads.length > 0 && (
       <button
           onClick={() => setView('LANCIO')}
           className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${view === 'LANCIO' ? 'bg-white shadow-soft text-brand-charcoal' : 'text-ash-500 hover:text-ash-700'}`}
       >
           <Rocket className="h-4 w-4" />
           Lancio: chiamate subito
           {lancioLeads.filter(l => l.column !== 'esitati').length > 0 && (
               <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-amber-500 text-white text-xs font-bold">{lancioLeads.filter(l => l.column !== 'esitati').length}</span>
           )}
       </button>
   )}
   ```
7. Render della vista (nella catena di ternari, prima di `view === 'AGENDA'`):
   ```tsx
   ) : view === 'LANCIO' ? (
       <LancioCallNowTab
           leads={lancioLeads}
           onChanged={() => { fetchLancio(); fetchAppointments() }}
           onOpen={(lead) => {
               // Il telefono è già visibile; il check-in serve solo a sbloccare il form esito.
               if (lead.negotiationStartedAt) openLead(lead, false)
               else handleStartNegotiation(lead)
           }}
       />
   ```
   `handleStartNegotiation` e `openLead` accettano `any`: il `LancioCallNowLead` ha `id`, `name`, `phone`, `version`, `priorNonClosedCount`, `appointmentDate`: ciò che `VenditoreDrawer` legge.
8. Nel `onSaved` del drawer aggiungi `fetchLancio()`.

- [ ] **Step 4: `getVenditoreAppointments` espone `lancioScelta`** — in `src/app/actions/venditoreActions.ts` aggiungi al `select` (dopo `salesCycleStartAt`): `lancioScelta: leads.lancioScelta,`.

- [ ] **Step 5: OutcomeGate esclude le chiamate subito** — in `src/app/(dashboard)/venditore/page.tsx`, nel `.filter(a => ...)` aggiungi la condizione `a.lancioScelta !== 'chiamata_subito' &&` prima di `a.appointmentDate &&`. (Un `appointmentDate = now` della sera prima diventerebbe "arretrato" alle 2 ore: non è un appuntamento mancato.)

- [ ] **Step 6: Multe ritardi escluse** — in `src/lib/venditore/latePenaltiesRunner.ts`:
  - import: aggiungi `ne, or` da `drizzle-orm`;
  - in `appointmentCandidates`, dentro `and(...)` aggiungi `or(isNull(leads.lancioScelta), ne(leads.lancioScelta, 'chiamata_subito'))`;
  - in `followUpCandidates`, stessa condizione dentro il `where(and(...))`.
  Commento da lasciare sopra: `// Chiamate subito del lancio (spec 2026-09-14 §4.4): nessuna multa, l'"appuntamento" è l'ora della richiesta, non una scadenza.`

- [ ] **Step 7: Compila, test, verifica dal vivo**

Run: `npx tsc --noEmit && npm test`
Expected: verdi.

Dal vivo (account venditore con un lead `chiamata_subito` creato via Task 8): la tab "Lancio: chiamate subito" compare con badge 1; la card mostra telefono, ora, risposte; "Non risponde" → colonna Seconda chiamata con "richiama fra 30 min"; due volte ancora → alert del passaggio, la card sparisce, il lead in board Conferme ha `appointmentDate` 06/10 09:00, nessun venditore, `confirmationsOutcome` NULL. "Registra esito" → check-in + drawer; salvando Chiuso il lead va in Esitati. La Lista non lo mostra; nessun OutcomeGate anche dopo 2 ore.

- [ ] **Step 8: Commit**

```bash
git add src/app/actions/lancioActions.ts src/components/venditore/LancioCallNowTab.tsx src/components/VenditoreDashboardClient.tsx src/app/actions/venditoreActions.ts "src/app/(dashboard)/venditore/page.tsx" src/lib/venditore/latePenaltiesRunner.ts
git commit -m "feat(lancio): scheda venditore chiamate subito, NR con passaggio alle Conferme, esclusione gate e multe"
```

---

### Task 11: Conferme — badge LANCIO, ordinamento, blocco "Dal bot – lancio", routing notifiche

**Files:**
- Create: `src/lib/lancio/conferme.ts`
- Test: `src/lib/lancio/conferme.test.ts`
- Modify: `package.json` (riga `test`)
- Modify: `src/app/actions/confermeActions.ts:294-345` (`getConfermeAppointments`: dopo `withNotes`, prima del raggruppamento per ora)
- Modify: `src/components/ConfermeBoardRow.tsx:4` (import lucide) e `:263-265` (badge accanto a `botReport`)
- Modify: `src/components/ConfermeBoard.tsx:5` (import lucide) e `:682-686` (cella "Esito Conferma" dello Storico, ramo `confermato`)
- Modify: `src/components/ConfermeDrawer.tsx:4` (import lucide) e `:987` (tab Note, prima di `{loadingNotes ? (`)
- Modify: `src/components/Topbar.tsx:119-134` (`handleNotifClick`)
- Modify: `src/components/VenditoreDashboardClient.tsx:12` (import `useSearchParams`) e dopo il `useEffect` di mount (~riga 187)

**Interfaces:**
- Consumes: `LANCIO_BUCKET`, `CALL_NOW_MAX_ATTEMPTS`, `LancioBotInfo` (Task 2, `./config`); i campi scritti sul lead da Task 7 (`lancioScelta='app_pomeriggio'|'app_dopodomani'|'app_mattina'`, `lancioBotInfo`, `lancioSceltaAt`, `salespersonAssigned` sui mattina) e da Task 10 (passaggio A1: `lancioScelta='chiamata_subito'`, `lancioCallNowAttempts=3`, `salespersonUserId=null`, `confirmationsOutcome=null`); le notifiche `type:'lancio_appuntamento'` (Task 7 `notifyConfermeLancio`, riusata da Task 10) e `type:'lancio_call_now'` (Task 8), entrambe con `metadata:{ leadId }`; il deep-link esistente `/conferme?lead=<id>&tab=note` di `ConfermeBoard.tsx:67-135` (carica il lead da solo se non è in nessuna lista); la vista `'LANCIO'` e `fetchLancio()` di `VenditoreDashboardClient` (Task 10).
- Produces (`src/lib/lancio/conferme.ts`, puro):
  ```ts
  export interface LancioConfermeFields {
      launchBucket: string | null; status: string; lancioScelta: string | null
      lancioCallNowAttempts: number | null; salespersonUserId: string | null; confirmationsOutcome: string | null
  }
  export function isLeadLancio(lead: Pick<LancioConfermeFields, 'launchBucket' | 'status'>, bucket?: string): boolean
  export function isCallNowHandoff(lead: Pick<LancioConfermeFields, 'lancioScelta' | 'lancioCallNowAttempts' | 'salespersonUserId'>): boolean
  export function lancioPriority(lead: LancioConfermeFields, bucket?: string): 0 | 1
  export function lancioFirst<T extends { lead: LancioConfermeFields }>(rows: T[], bucket?: string): T[]   // sort stabile, non muta
  export function lancioSceltaLabel(scelta: string | null, handoff?: boolean): string
  export function lancioBotRisposte(info: unknown): string[]
  ```
- Nessuna colonna nuova e nessuna modifica alla `select` della board: `getConfermeAppointments` seleziona `lead: leads` (la riga intera), quindi `launchBucket`, `lancioScelta`, `lancioSceltaAt`, `lancioBotInfo`, `lancioCallNowAttempts` arrivano già alla UI appena B1 li mette nello schema. Il lavoro è: ordinare, marcare, mostrare, instradare.
- Chi va **in cima** (priorità 1): lead del bucket lancio, `status='APPOINTMENT'`, senza esito Conferme, con `lancioScelta` `app_pomeriggio` o `app_dopodomani`, oppure tornato dal venditore dopo tre NR (`chiamata_subito` + `salespersonUserId` nullo + `lancioCallNowAttempts >= 3`). Gli `app_mattina` NON contano: sono già confermati e non stanno nel kanban "da lavorare" (la query di default filtra `confirmationsOutcome IS NULL`); si vedono in Storico → Confermati.
- Il sort è **stabile** e sta nella server action, come `recoverableFirst` in `pipelineActions.ts:301-311`: dentro i due gruppi l'ordine del DB (`ORDER BY appointmentCreatedAt DESC`) resta identico. Non si tocca l'`orderBy` della query.

- [ ] **Step 1: Scrivi il test `src/lib/lancio/conferme.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    isCallNowHandoff, isLeadLancio, lancioBotRisposte, lancioFirst, lancioPriority, lancioSceltaLabel,
    type LancioConfermeFields,
} from './conferme'

const BUCKET = 'LANCIO_WEBDEV_2026'

function lead(over: Partial<LancioConfermeFields> = {}): LancioConfermeFields {
    return {
        launchBucket: BUCKET, status: 'APPOINTMENT', lancioScelta: 'app_pomeriggio',
        lancioCallNowAttempts: 0, salespersonUserId: null, confirmationsOutcome: null,
        ...over,
    }
}

test('isLeadLancio: bucket del lancio e status APPOINTMENT', () => {
    assert.equal(isLeadLancio(lead()), true)
    assert.equal(isLeadLancio(lead({ launchBucket: 'BLACK_SUMMER' })), false)
    assert.equal(isLeadLancio(lead({ launchBucket: null })), false)
    assert.equal(isLeadLancio(lead({ status: 'NEW' })), false)
    assert.equal(isLeadLancio(lead({ launchBucket: 'ALTRO' }), 'ALTRO'), true)
})

test('isCallNowHandoff: chiamata subito, tre tentativi, senza venditore', () => {
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: 3, salespersonUserId: null })), true)
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: 3, salespersonUserId: 'v1' })), false)
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: 2, salespersonUserId: null })), false)
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'app_pomeriggio', lancioCallNowAttempts: 3, salespersonUserId: null })), false)
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: null, salespersonUserId: null })), false)
})

test('lancioPriority: pomeriggio, dopodomani e passaggio A1 vanno in cima; mattina, esitati e non-lancio no', () => {
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_pomeriggio' })), 1)
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_dopodomani' })), 1)
    assert.equal(lancioPriority(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: 3, salespersonUserId: null })), 1)
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_mattina', confirmationsOutcome: 'confermato', salespersonUserId: 'v1' })), 0)
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_pomeriggio', confirmationsOutcome: 'scartato' })), 0)
    assert.equal(lancioPriority(lead({ lancioScelta: 'followup' })), 0)
    assert.equal(lancioPriority(lead({ lancioScelta: null })), 0)
    assert.equal(lancioPriority(lead({ launchBucket: null })), 0)
    assert.equal(lancioPriority(lead({ status: 'NEW' })), 0)
})

test('lancioFirst: i lancio in cima, ordine di arrivo conservato dentro i gruppi, input non mutato', () => {
    const rows = [
        { lead: { ...lead({ launchBucket: null }), id: 'n1' } },
        { lead: { ...lead({ lancioScelta: 'app_dopodomani' }), id: 'l1' } },
        { lead: { ...lead({ launchBucket: null }), id: 'n2' } },
        { lead: { ...lead({ lancioScelta: 'app_pomeriggio' }), id: 'l2' } },
        { lead: { ...lead({ lancioScelta: 'app_mattina', confirmationsOutcome: 'confermato' }), id: 'm1' } },
    ]
    const out = lancioFirst(rows)
    assert.deepEqual(out.map(r => r.lead.id), ['l1', 'l2', 'n1', 'n2', 'm1'])
    assert.deepEqual(rows.map(r => r.lead.id), ['n1', 'l1', 'n2', 'l2', 'm1'])
    assert.deepEqual(lancioFirst([]), [])
})

test('lancioSceltaLabel: una frase per scelta, il passaggio A1 vince sulla scelta', () => {
    assert.match(lancioSceltaLabel('app_pomeriggio'), /pomeriggio/i)
    assert.match(lancioSceltaLabel('app_dopodomani'), /dopodomani/i)
    assert.match(lancioSceltaLabel('app_mattina'), /nessuna chiamata/i)
    assert.match(lancioSceltaLabel('chiamata_subito'), /venditore/i)
    assert.match(lancioSceltaLabel('chiamata_subito', true), /tre chiamate a vuoto/i)
    assert.match(lancioSceltaLabel('followup'), /follow-up/i)
    assert.match(lancioSceltaLabel(null), /lancio/i)
})

test('lancioBotRisposte: solo stringhe non vuote, in ordine, da un jsonb qualunque', () => {
    assert.deepEqual(lancioBotRisposte({ risposte: [' faccio il barista ', '', 'mi ha colpito lo stipendio', 3] }), ['faccio il barista', 'mi ha colpito lo stipendio'])
    assert.deepEqual(lancioBotRisposte({ risposte: 'no' }), [])
    assert.deepEqual(lancioBotRisposte({ altro: true }), [])
    assert.deepEqual(lancioBotRisposte(null), [])
    assert.deepEqual(lancioBotRisposte(undefined), [])
    assert.deepEqual(lancioBotRisposte('testo'), [])
    assert.deepEqual(lancioBotRisposte(['a', 'b']), [])
})
```

- [ ] **Step 2: Aggiungi `src/lib/lancio/conferme.test.ts` alla riga `test` di `package.json`** (in coda alla stringa, separato da spazio)

- [ ] **Step 3: Esegui e verifica il fallimento**

Run: `node --import tsx --test src/lib/lancio/conferme.test.ts`
Expected: FAIL — `Cannot find module './conferme'`.

- [ ] **Step 4: Scrivi `src/lib/lancio/conferme.ts`**

```ts
/**
 * Regole pure della board Conferme per i lead del lancio (spec §4.5).
 *
 * Chi è "lancio" per le Conferme, chi va in cima alla prima chiamata, che
 * etichetta porta, come si leggono le risposte di riscaldamento del bot.
 * Niente DB: getConfermeAppointments passa le righe, la riga della board, lo
 * Storico e il drawer chiamano le stesse funzioni. Una regola, un posto.
 *
 * "In cima" funziona come il badge "Aveva detto sì" dei GDO
 * (pipelineActions.recoverableFirst): sort stabile per priorità, l'ordine
 * del DB resta identico dentro i gruppi.
 */
import { CALL_NOW_MAX_ATTEMPTS, LANCIO_BUCKET, type LancioBotInfo } from './config'

export interface LancioConfermeFields {
    launchBucket: string | null
    status: string
    lancioScelta: string | null
    lancioCallNowAttempts: number | null
    salespersonUserId: string | null
    confirmationsOutcome: string | null
}

/** Lead del bucket lancio con un appuntamento: l'unico che le Conferme vedono. */
export function isLeadLancio(lead: Pick<LancioConfermeFields, 'launchBucket' | 'status'>, bucket: string = LANCIO_BUCKET): boolean {
    return lead.launchBucket === bucket && lead.status === 'APPOINTMENT'
}

/**
 * Il venditore di turno ha fatto tre chiamate a vuoto e il lead è passato alle
 * Conferme (assunzione A1, scritto da recordLancioCallNowNoAnswer): la scelta
 * resta 'chiamata_subito' ma il venditore è stato tolto.
 */
export function isCallNowHandoff(lead: Pick<LancioConfermeFields, 'lancioScelta' | 'lancioCallNowAttempts' | 'salespersonUserId'>): boolean {
    return lead.lancioScelta === 'chiamata_subito'
        && !lead.salespersonUserId
        && (lead.lancioCallNowAttempts ?? 0) >= CALL_NOW_MAX_ATTEMPTS
}

/**
 * 1 = in cima alla prima chiamata: appuntamento del pomeriggio o di dopodomani
 * scelto in chat col bot, oppure tornato dal venditore dopo tre NR, e ancora
 * senza esito Conferme. 0 = ordine normale (compresi i mattina: sono già
 * confermati, nessuna chiamata).
 */
export function lancioPriority(lead: LancioConfermeFields, bucket: string = LANCIO_BUCKET): 0 | 1 {
    if (!isLeadLancio(lead, bucket)) return 0
    if (lead.confirmationsOutcome) return 0
    if (lead.lancioScelta === 'app_pomeriggio' || lead.lancioScelta === 'app_dopodomani') return 1
    if (isCallNowHandoff(lead)) return 1
    return 0
}

/** Copia ordinata: i lancio prima, poi tutti gli altri nell'ordine in cui erano. */
export function lancioFirst<T extends { lead: LancioConfermeFields }>(rows: T[], bucket: string = LANCIO_BUCKET): T[] {
    return [...rows].sort((a, b) => lancioPriority(b.lead, bucket) - lancioPriority(a.lead, bucket))
}

/** Testo del tooltip del badge e del blocco nel drawer. `handoff` vince sulla scelta. */
export function lancioSceltaLabel(scelta: string | null, handoff = false): string {
    if (handoff) return 'Tre chiamate a vuoto del venditore di turno: da richiamare'
    switch (scelta) {
        case 'chiamata_subito': return 'Ha chiesto la chiamata subito: in mano al venditore di turno'
        case 'app_mattina': return 'Appuntamento la mattina dopo, già confermato dal bot: nessuna chiamata'
        case 'app_pomeriggio': return 'Appuntamento il pomeriggio dopo, scelto in chat col bot'
        case 'app_dopodomani': return 'Appuntamento dopodomani mattina, scelto in chat col bot'
        case 'followup': return 'Ha risposto al follow-up del giorno dopo: flusso standard'
        default: return 'Lead del lancio Web Dev AI'
    }
}

/** Le risposte di riscaldamento in ordine, da un jsonb che può essere qualunque cosa. */
export function lancioBotRisposte(info: unknown): string[] {
    if (!info || typeof info !== 'object' || Array.isArray(info)) return []
    const risposte = (info as LancioBotInfo).risposte
    if (!Array.isArray(risposte)) return []
    return risposte
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map(r => r.trim())
}
```

- [ ] **Step 5: Esegui i test**

Run: `node --import tsx --test src/lib/lancio/conferme.test.ts`
Expected: PASS (6 test).

- [ ] **Step 6: Ordinamento nella board — `src/app/actions/confermeActions.ts`**

Import in testa al file (unire con gli import esistenti): `import { lancioFirst } from "@/lib/lancio/conferme"`.

Dentro `getConfermeAppointments`, subito dopo la costruzione di `withNotes` (il `results.map(r => { ... lastBotNote ... })`, riga ~318) e PRIMA di `const grouped: Record<string, RowWithNote[]> = {};`, aggiungi:

```ts
    // Lead del lancio in cima (spec 2026-09-14 §4.5): stesso meccanismo del
    // badge "Aveva detto sì" dei GDO (pipelineActions.recoverableFirst) — sort
    // stabile per priorità, l'ordine del DB resta identico dentro i gruppi.
    // Vale per la lista piatta e, di conseguenza, per ogni ora del kanban
    // (ConfermeBoard filtra flatList per ora senza riordinare).
    const ordered = lancioFirst(withNotes);
```

Poi sostituisci le due letture di `withNotes` che seguono:
- `for (const item of withNotes) {` → `for (const item of ordered) {`
- `flatList: withNotes` → `flatList: ordered`

Non toccare `.orderBy(desc(leads.appointmentCreatedAt))` né il filtro `strict_kanban`.

- [ ] **Step 7: Badge in riga — `src/components/ConfermeBoardRow.tsx`**

1. Import lucide (riga 4): aggiungi `Rocket` alla lista.
2. Import helper, dopo gli import di `@/app/actions/...`:
   ```ts
   import { isCallNowHandoff, isLeadLancio, lancioSceltaLabel } from "@/lib/lancio/conferme"
   ```
3. Subito DOPO il badge `{lead.botReport && (...)}` (riga ~263-265) e PRIMA della riga del telefono, aggiungi:

```tsx
                    {/* Badge LANCIO (spec 2026-09-14 §4.5): ambra, come l'accento del lancio
                        su /lancio. `<div>` e non `<span>`: sta in un contenitore flex con
                        pointer-events-none e non deve mai diventare padre di un bottone. */}
                    {isLeadLancio(lead) && (
                        <div
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 uppercase shrink-0 flex items-center gap-1"
                            title={`Lancio Web Dev AI · ${lancioSceltaLabel(lead.lancioScelta, isCallNowHandoff(lead))}`}
                        >
                            <Rocket className="w-3 h-3" /> Lancio
                        </div>
                    )}
```

- [ ] **Step 8: Confermati con badge e venditore — `src/components/ConfermeBoard.tsx`**

1. Import lucide (riga 5): aggiungi `Rocket`.
2. Import helper, dopo `import { markConfermeAlertHandled } ...`:
   ```ts
   import { isCallNowHandoff, isLeadLancio, lancioSceltaLabel } from "@/lib/lancio/conferme"
   ```
3. Nella tabella dello **Storico** (`viewMode === 'storico'`), cella "Esito Conferma" (riga ~682-686): sostituisci il ramo `confermato`

```tsx
                                                            {item.lead.confirmationsOutcome === "confermato" ? (
                                                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confermato
                                                                </span>
                                                            ) : (
```

con

```tsx
                                                            {item.lead.confirmationsOutcome === "confermato" ? (
                                                                <div className="flex flex-col items-start gap-1">
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                                                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confermato
                                                                    </span>
                                                                    {/* Lancio (spec §4.5): i prenotati della mattina nascono già confermati
                                                                        dal bot con il venditore del round robin. Badge + venditore, così
                                                                        le Conferme vedono che non c'è nessuna chiamata da fare. */}
                                                                    {isLeadLancio(item.lead) && (
                                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                                            <div
                                                                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 uppercase flex items-center gap-1"
                                                                                title={`Lancio Web Dev AI · ${lancioSceltaLabel(item.lead.lancioScelta, isCallNowHandoff(item.lead))}`}
                                                                            >
                                                                                <Rocket className="w-3 h-3" /> Lancio
                                                                            </div>
                                                                            {item.lead.salespersonAssigned && (
                                                                                <div className="text-[11px] font-semibold text-ash-600">→ {item.lead.salespersonAssigned}</div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
```

Il ramo `scartato` resta com'è. Lo Storico legge `confirmationsTimestamp` nell'intervallo scelto (default ultimi 7 giorni): i mattina prenotati la sera del 5/10 hanno `confirmationsTimestamp = now` (Task 7) e compaiono in "Confermati" dal 5/10 in poi.

- [ ] **Step 9: Blocco "Dal bot – lancio" nel drawer — `src/components/ConfermeDrawer.tsx`**

1. Import lucide (riga 4): aggiungi `Rocket`.
2. Import helper, dopo `import type { BotReport } ...`:
   ```ts
   import { isCallNowHandoff, isLeadLancio, lancioBotRisposte, lancioSceltaLabel } from "@/lib/lancio/conferme"
   ```
3. Nel tab Note (`activeTab === "note"`), dentro `<div className="flex-1 space-y-4 mb-6">` e PRIMA di `{loadingNotes ? (` (riga ~988), aggiungi:

```tsx
                                    {/* Dal bot – lancio (spec 2026-09-14 §4.5): la scelta fatta in chat e le
                                        risposte di riscaldamento. Sta sopra le note, sempre visibile, anche
                                        mentre le note caricano: è la prima cosa da leggere prima di chiamare. */}
                                    {isLeadLancio(lead) && (() => {
                                        const risposte = lancioBotRisposte(lead.lancioBotInfo)
                                        const handoff = isCallNowHandoff(lead)
                                        return (
                                            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
                                                <div className="flex justify-between items-start mb-2 gap-2">
                                                    <div className="text-xs font-bold text-amber-900 bg-amber-100 px-2 py-1 rounded-md flex items-center gap-1.5">
                                                        <Rocket className="w-3.5 h-3.5" /> Dal bot – lancio
                                                    </div>
                                                    {lead.lancioSceltaAt && (
                                                        <div className="text-[11px] font-medium text-amber-600 uppercase tracking-wider shrink-0">
                                                            {format(new Date(lead.lancioSceltaAt), "dd/MM/yy HH:mm")}
                                                        </div>
                                                    )}
                                                </div>
                                                <p className="text-sm font-semibold text-amber-950">{lancioSceltaLabel(lead.lancioScelta, handoff)}</p>
                                                {lead.lancioScelta === 'app_mattina' && lead.salespersonAssigned && (
                                                    <p className="text-xs text-amber-800 mt-1">Venditore: {lead.salespersonAssigned}</p>
                                                )}
                                                {risposte.length > 0 ? (
                                                    <ul className="mt-3 space-y-1.5">
                                                        {risposte.map((r, i) => (
                                                            <li key={i} className="text-sm text-amber-950 bg-white/70 rounded-md px-2.5 py-1.5 border border-amber-100">💬 {r}</li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="mt-2 text-xs italic text-amber-700">Nessuna risposta di riscaldamento registrata dal bot.</p>
                                                )}
                                            </div>
                                        )
                                    })()}
```

- [ ] **Step 10: Routing delle notifiche — `src/components/Topbar.tsx`**

In `handleNotifClick`, dopo il ramo `else if (notif.type === 'bot_note') { ... }` e PRIMA del ramo `appointment_confirmed || ...`, aggiungi:

```ts
        } else if (notif.type === 'lancio_appuntamento') {
            // Appuntamento del lancio scelto col bot (pomeriggio/dopodomani) o
            // tornato dal venditore dopo tre NR: le Conferme lo lavorano in board.
            // Stesso deep-link della nota del bot, sul tab Note dove sta il
            // blocco "Dal bot – lancio"; la board carica il lead da sola anche
            // se non è in nessuna lista (ConfermeBoard, pendingDeepLink).
            if (meta?.leadId) router.push(`/conferme?lead=${meta.leadId}&tab=note`)
        } else if (notif.type === 'lancio_call_now') {
            // Il venditore deve atterrare sulla scheda "Lancio: chiamate subito",
            // non nel drawer di ricerca: lì stanno "Registra esito" e "Non risponde".
            router.push('/venditore?view=lancio')
```

(la riga successiva resta `} else if (notif.type === 'appointment_confirmed' || ...`). Il toast live in fondo al file chiama la stessa `handleNotifClick`: nessun'altra modifica.

- [ ] **Step 11: Atterraggio sulla tab Lancio — `src/components/VenditoreDashboardClient.tsx`**

1. Import (riga 12): `import { useRouter, useSearchParams } from "next/navigation"`.
2. Dopo il `useEffect` di mount (quello che chiama `fetchAppointments()`/`fetchFollowUps()`/`fetchLancio()` e registra `onBusEvent('leads', ...)`, ~riga 171-187), aggiungi:

```tsx
    // Notifica "Lancio: chiama subito" → /venditore?view=lancio. Il parametro si
    // legge in modo reattivo e poi si toglie dall'URL (stesso pattern del
    // deep-link di ConfermeBoard): il venditore è già su questa pagina e una
    // navigazione sulla stessa rotta non rimonta il componente, quindi un
    // effetto legato al solo mount non scatterebbe mai. Senza il parametro un
    // refresh non riapre la tab da solo.
    const searchParams = useSearchParams()
    const wantLancio = searchParams.get('view') === 'lancio'
    useEffect(() => {
        if (!wantLancio) return
        setView('LANCIO')
        fetchLancio()
        const params = new URLSearchParams(window.location.search)
        params.delete('view')
        const rest = params.toString()
        window.history.replaceState({}, '', rest ? `${window.location.pathname}?${rest}` : window.location.pathname)
    }, [wantLancio])
```

`fetchLancio` è la funzione di Task 10 (Step 3, punto 3). La vista `'LANCIO'` renderizza `LancioCallNowTab` anche a zero lead (colonne con "Nessun lead"): se la notifica arriva prima del refetch, la tab si popola da sola al `fetchLancio()`.

- [ ] **Step 12: Compila, test, verifica dal vivo**

Run: `npx tsc --noEmit && npm test`
Expected: verdi (il nuovo file di test aggiunge 6 test).

Dal vivo, con un lead di prova nel kanban di OGGI (via SQL: `launchBucket='LANCIO_WEBDEV_2026'`, `status='APPOINTMENT'`, `companyId='fenice'`, `appointmentDate` = oggi alle 16:00 ora italiana, `lancioScelta='app_pomeriggio'`, `lancioSceltaAt=now()`, `lancioBotInfo='{"risposte":["faccio il barista","mi ha colpito lo stipendio"]}'`, `confirmationsOutcome=NULL`, `assignedToId` = id dell'account bot; e un secondo lead normale alla stessa ora con `appointmentCreatedAt` più recente):
- Board Conferme, tab Pomeriggio, ora 16:00: il lead lancio è **primo** nonostante l'`appointmentCreatedAt` più vecchio, con il badge ambra "Lancio" accanto al funnel; il tooltip dice "Appuntamento il pomeriggio dopo, scelto in chat col bot".
- Aprendo la riga → tab Note: in cima il blocco ambra "Dal bot – lancio" con la scelta e le due risposte; sotto, le note normali.
- Stesso lead con `lancioScelta='chiamata_subito'`, `lancioCallNowAttempts=3`, `salespersonUserId=NULL`: resta primo, tooltip "Tre chiamate a vuoto del venditore di turno: da richiamare".
- Lead con `lancioScelta='app_mattina'`, `confirmationsOutcome='confermato'`, `confirmationsTimestamp=now()`, `salespersonAssigned='Mario Rossi'`: non è nel kanban; in Storico → Confermati mostra "Confermato" + badge "Lancio" + "→ Mario Rossi".
- Inserendo a mano una `notifications` `type='lancio_appuntamento'`, `metadata={"leadId":"<id>"}` per l'account Conferme: la campanella suona, il click apre `/conferme` con il drawer del lead sul tab Note.
- Inserendo una `notifications` `type='lancio_call_now'` per un venditore: il click porta a `/venditore` con la tab "Lancio: chiamate subito" attiva e l'URL ripulito.
- Pulizia: cancellare i lead e le notifiche di prova.

- [ ] **Step 13: Commit**

```bash
git add src/lib/lancio/conferme.ts src/lib/lancio/conferme.test.ts package.json src/app/actions/confermeActions.ts src/components/ConfermeBoardRow.tsx src/components/ConfermeBoard.tsx src/components/ConfermeDrawer.tsx src/components/Topbar.tsx src/components/VenditoreDashboardClient.tsx
git commit -m "feat(lancio): badge LANCIO e priorita nella board Conferme, blocco dal bot nel drawer, routing notifiche"
```

---

## Self-review

Fatta con la spec e la nota di riconciliazione aperte accanto al piano, dopo il Task 11.

### 1. Copertura della spec

| Sezione | Requisito | Task | Note |
|---|---|---|---|
| §3.1 | Colonne `leads.lancio*` + riga `launchPools` | B1 (Task 1 di B1) | Task 0 verifica che ci siano. |
| §3.1 | Tabella `launchShifts` + unique `(bucket, kind, salesUserId)` + round robin `coalesce(lastAssignedAt,'epoch'), salesUserId` | Task 1, Task 3 (`pickRoundRobin`), Task 5 (`ORDER BY`) | **Deviazione dichiarata**: `removedAt/removedBy` in più (soft delete). |
| §3.1 | Eventi `LANCIO_CALL_NOW_ASSIGNED`, `LANCIO_BOOKED` | Task 8, Task 7 | — |
| §3.1 / §4.3 | Evento `LANCIO_SHIFT_CHANGED` | Task 1 (deviazione) | **Non scritto**: `leadEvents.leadId` è NOT NULL e un cambio turno non ha lead. La storia sta su `launchShifts` (`removedAt/removedBy/createdBy`). Il tipo TS resta (B1) per un eventuale uso futuro. Da dire al PO, non è un buco silenzioso. |
| §4.2 | `POST /api/bot/lancio/slots` (POST, forma della risposta, `mattina:'conferme'` per dopodomani, lettura come `checkBookingAllowed` senza `companyId`) | Task 6 (+ Task 3, Task 5) | `venditoriLiberi` non esce verso il bot. |
| §4.2 | `book` mattina: lock per ora, venditore libero con `lastAssignedAt` più vecchio, campi scritti, già confermato, Calendar, webhook `appointment.outcome`+`deal.assigned`, `lastAssignedAt`, eventi, `409 ora_esaurita` con slots | Task 7 | Calendar e webhook in `after()` (`mattinaSideEffects`). |
| §4.2 | `book` pomeriggio/dopodomani: nessun venditore, `lancioScelta`, notifica alle Conferme | Task 7 (`notifyConfermeLancio`) + Task 11 (routing del click) | — |
| §4.2 | Guardie (bucket + `assignedToId=bot` o `pulsante_webinar`), `422 fuori_regole`, idempotenza ±60 s → `deduped:true` | Task 6 (`loadLancioLead`), Task 2 (`classifyAt`, `sameInstant`), Task 7 | — |
| §4.2 | `call-now`: round robin SERA, campi scritti, notifica realtime al venditore, evento, `409 nessun_venditore` | Task 8 + Task 11 (routing) | Nessun canale nuovo: `notifications` + trigger 0019. |
| §4.2 | Tutte e tre < 3 s | Task 7, Task 8 (`after()`) | — |
| §4.3 | Turni: due liste di spunte, salvataggio su `launchShifts` | Task 9 | — |
| §4.3 | Copertura 9-15 del 6/10 dal calendario, avviso rosso su chi non ha compilato | Task 9 | — |
| §4.3 | Monitor lancio con tutti i contatori | Task 9 | **Parziale per scelta**: i quattro contatori che vivono nel DB del bot (benvenuto consegnato, hanno risposto, posto bloccato, link inviato) sono mostrati come "— (dato del bot)". La spec dice "Sorgenti: eventi CRM + `lead-status`": la lettura via `lead-status` NON è in questo piano. Vedi "Punti scoperti". |
| §4.3 | Impostazioni (link video/live) nel pannello del bot | — | Nulla da fare nel CRM, per spec. |
| §4.4 | Tab "Lancio: chiamate subito", 4 colonne, card con nome/telefono/ora/risposte/note, visibile solo se ci sono lead | Task 10 (+ Task 4 `callNowColumn`) | — |
| §4.4 | "Non risponde" → +1, `nextAt=+30min`, callLog; 3° NR → A1 | Task 10 (`recordLancioCallNowNoAnswer`) + Task 4 (`nextCallNowState`) | Il callLog è un `CALL_LOGGED` con `metadata.source='lancio_call_now'`. |
| §4.4 | "Registra esito" → drawer esiti esistente, `presentedAt` latchato | Task 10 (riuso di `VenditoreDrawer` + `startNegotiation`) | Il latch è nel `saveVenditoreOutcome` esistente: nessun codice nuovo. |
| §4.4 | Niente OutcomeGate, niente multe | Task 10 (Step 5, Step 6) | — |
| §4.5 | Badge "LANCIO" ambra e in cima alla prima chiamata per `app_pomeriggio`/`app_dopodomani`/A1 (stesso meccanismo di "Aveva detto sì") | Task 11 (Step 4, 6, 7) | Sort stabile in server action, come `recoverableFirst`. |
| §4.5 | Info di riscaldamento nel drawer, tab Note, blocco "Dal bot – lancio" | Task 11 (Step 9) | — |
| §4.5 | `app_mattina` in Confermati con badge e venditore, nessuna chiamata | Task 11 (Step 8) | — |
| §4.5 | Il muro di prenotazione resta valido se una Conferma sposta l'ora | — (codice esistente) | `updateLeadDataConferme` → `checkBookingAllowed` già oggi; i mattina hanno `salespersonUserId`, quindi il muro si applica. Nessun task. |
| §4.5 | Ricerca per numero nel pannello del bot | — | Lato bot (B4/B5). |
| §6.2 | Codici di risposta | Global Constraints + Task 6/7/8 | — |

### 2. Scan dei placeholder

Cercati nel piano: `TBD`, `TODO`, `implement later`, `fill in`, `add appropriate`, `handle edge cases`, `Similar to Task`, `write tests for`. Nessuna occorrenza. Ogni step di codice ha il codice; ogni step "Modify" dice riga, cosa togliere e cosa mettere.

### 3. Coerenza dei nomi (nota di riconciliazione + fra i task)

- **Corretto inline in Task 2**: `config.ts` ridefiniva `bucket: 'LANCIO_WEBDEV_2026'` e `funnel: 'Lancio Web Dev AI'` con una nota condizionale ("se `intake.ts` esiste…"). Ora importa e ri-esporta `LANCIO_BUCKET`, `LANCIO_FUNNEL`, `LANCIO_SLUG`, `LANCIO_COMPANY` da `./intake` e `LANCIO_WEBDEV` li usa come valori. Task 0 verifica che `intake.ts` esporti le quattro costanti e ferma il blocco se manca.
- **Corretto inline in Task 2 (Interfaces)**: il blocco diceva `type LancioBotInfo = Record<string, string>` mentre il codice definiva `interface LancioBotInfo { risposte?: string[]; ... }`; Task 10 e Task 11 usano `risposte: string[]`. Ora il blocco Interfaces e il codice coincidono.
- **Corretto inline in Task 6**: `export const FENICE = 'fenice'` → `export const FENICE = LANCIO_COMPANY` (import da `./config`). Il nome `FENICE` resta perché Task 7/8/9 lo consumano già.
- `notifyConfermeLancio(lead: { id; name }, at: Date, titolo: string)`: definita in Task 7, usata in Task 10 con la stessa firma. Tipo notifica `'lancio_appuntamento'` in Task 7 e in Task 11 (Topbar). Tipo `'lancio_call_now'` in Task 8 e in Task 11.
- `CALL_NOW_MAX_ATTEMPTS` (Task 2) usato da Task 4 (`nextCallNowState`), Task 9 (`monitor.ts`) e Task 11 (`isCallNowHandoff`): stessa soglia 3 in tre punti, una costante.
- Passaggio A1 (Task 10) scrive `salespersonUserId=null`, `lancioCallNowAttempts=3`, `CONFERME_DISCARD_RESET` (quindi `confirmationsOutcome=null`): esattamente ciò che `isCallNowHandoff`/`lancioPriority` (Task 11) leggono.
- `Db` (Task 5) usato in Task 7/8 con `tx.execute`: la nota di Task 7 dice come allargare il tipo se `tsc` protesta.
- `computeSlots` restituisce `SlotsResponse | null`; in Task 7 il 409 lo chiama con un `dateStr` già classificato, quindi mai `null`.
- `ShiftKind` definito in Task 2, consumato da Task 5, 9. `LancioCallNowLead.column: CallNowColumn` (Task 10) ↔ `callNowColumn` (Task 4).
- Test runner: ogni `*.test.ts` nuovo (rules, slots, callNow, conferme) ha lo step "aggiungi alla riga `test` di `package.json`", come da nota.
- Migrazione `0037_launch_shifts.sql` come da nota (B1 = `0036`).

### 4. Punti della spec che restano scoperti (da dire al PO)

1. **§4.3 Monitor, contatori del bot** ("benvenuto consegnato", "hanno risposto", "posto bloccato", "link Zoom inviato"): la spec li vuole nel monitor con sorgente `lead-status`; qui si mostrano come "— (dato del bot)". Chiuderlo vuol dire o una lettura dal DB del bot (fuori dal CRM) o un'estensione di `/api/bot/lead-status` che B4/B5 non prevedono. Decisione da prendere, non un'omissione del piano.
2. **§3.1/§4.3 evento `LANCIO_SHIFT_CHANGED`**: non scritto per il vincolo `leadEvents.leadId NOT NULL`; sostituito dal soft delete su `launchShifts`. Se il PO vuole l'evento in un log, serve una tabella senza lead (fuori scope qui).
3. **§4.2 "Se l'ora si è riempita nel frattempo → 409 e il bot ripropone"** è coperto; il caso simmetrico "il turno GIORNO_DOPO è vuoto o nessuno ha compilato il calendario" produce `mattinaEsaurita:true` su `slots` e `409 ora_esaurita` su `book` mattina: è il comportamento voluto (tutto al pomeriggio), ma l'avviso rosso su `/lancio` (Task 9) è l'unico segnale al team. Da controllare la mattina del 5/10.
4. **Tabella "Tabella" della board Conferme** (`viewMode === 'table'`, colonna "Stato"): non porta il badge LANCIO. La spec parla di board (kanban) e Confermati; la tabella è una vista di ricerca. Se serve, è lo stesso blocco `isLeadLancio(item.lead)` dello Step 8 nella colonna "Stato".
5. **Notifiche `lancio_appuntamento` a MANAGER/ADMIN**: `notifyConfermeLancio` scrive solo ai `CONFERME` attivi Fenice (spec: "notifica alle Conferme"). Un manager che vuole vederle non le riceve: coerente con la spec, ma va detto.
