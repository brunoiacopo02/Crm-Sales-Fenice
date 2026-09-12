# Calendario disponibilità venditori — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ogni venditore dichiara entro lunedì 14:00 le ore in cui è disponibile; chi non lo fa o non si presenta paga 50 €, e venditori, Conferme e direzione vedono la stessa griglia di copertura incrociata con l'affluenza attesa.

**Architecture:** Due tabelle nuove per la disponibilità (`salesAvailabilitySlots`) e i blocchi (`salesSlotBlocks`), una per il registro della compilazione (`salesWeekPlans`), e l'estensione della tabella multe esistente `salesLatePenalties` con due `kind` nuovi da 50 €. Tutta la matematica degli slot e delle regole vive in moduli puri sotto `src/lib/venditore/` con test `node:test`; le server action fanno solo accesso al DB; tre superfici React consumano lo stesso calcolo di copertura.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM su Supabase Postgres, Tailwind v4, test con `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md`

## Global Constraints

- **Fuso orario**: ogni calcolo su date è Europe/Rome esplicito. Non usare mai `getHours()`/`getDay()` locali del server (su Vercel è UTC). Passare sempre dagli helper di `src/lib/dateUtils.ts` o di `src/lib/venditore/calendarSlots.ts`.
- **Griglia**: ore piene 9:00–21:00 incluse (13 slot), lunedì–sabato (6 giorni), 78 slot a settimana. Domenica e ore fuori range non hanno slot.
- **Importi**: `CALENDAR_PENALTY_EUR = 50`. I 10 € dei ritardi esistenti non si toccano.
- **Scadenza settimanale**: lunedì 14:00 Europe/Rome.
- **Preavviso blocco manuale**: 60 minuti.
- **Finestra segnalazione assenza**: 48 ore dall'inizio dello slot.
- **Finestra stima affluenza**: 8 settimane intere precedenti quella corrente (`DEMAND_WEEKS = 8`).
- **Env**: `SALES_CALENDAR_PENALTIES=off` = kill-switch; `SALES_CALENDAR_PENALTIES_FROM` (ISO) = data di attivazione. Senza la seconda non si registra nulla.
- **Esenzione**: `users.calendarExempt`. Mai confrontare ID o email hardcodate nel codice applicativo.
- **Multi-tenant**: ogni server action passa da `currentTenant()` + `assertSalesArea(ctx)`. Le query che elencano i venditori usano il pattern `allowedCompanies` di `getVenditoriAgenda` (`src/app/actions/confermeActions.ts:1627-1640`), non il solo `companyId`.
- **Migrazioni**: SQL scritto a mano in `drizzle/migrations/`, applicato con l'MCP Supabase (`apply_migration`). `drizzle-kit generate` NON è utilizzabile su questo progetto.
- **Test**: ogni file `*.test.ts` nuovo va aggiunto alla lista dello script `test` in `package.json`, altrimenti non gira.
- **Regola React del progetto** (CLAUDE.md §4.1): i bottoni non possono mai essere figli di `<span>`/`<p>`. Usare `<div>`.

---

## File Structure

**Moduli puri (logica + test):**
- `src/lib/venditore/calendarSlots.ts` — aritmetica degli slot in Europe/Rome. Nessun accesso al DB.
- `src/lib/venditore/calendarRules.ts` — le tre regole decisionali: chi va multato per la settimana, se una segnalazione d'assenza è ammissibile, se un blocco manuale è consentito.
- `src/lib/venditore/calendarCoverage.ts` — copertura per slot e stima affluenza a partire da righe già lette.

**Accesso al DB e cron:**
- `src/lib/venditore/calendarRunner.ts` — giro settimanale delle multe e dei promemoria, chiamato dal cron esistente.
- `src/lib/venditore/calendarBlocks.ts` — creazione/rilascio dei blocchi da follow-up, importato dalle action venditore.

**Server actions:**
- `src/app/actions/salesCalendarActions.ts` — superficie del venditore e lettura della copertura (tutti i ruoli).
- `src/app/actions/salesCalendarAdminActions.ts` — supervisione, segnalazione assenza, annullamento multe, esenzione.

**UI:**
- `src/components/calendar/SlotGrid.tsx` — griglia 6×13 presentazionale, riusata dalle tre viste.
- `src/components/calendar/CoverageLegend.tsx` — legenda colori e stati.
- `src/app/(dashboard)/mio-calendario/page.tsx` + `MioCalendarioClient.tsx`
- `src/app/(dashboard)/calendari-venditori/page.tsx` + `CalendariVenditoriClient.tsx`

**File esistenti modificati:**
- `src/db/schema.ts` — tre tabelle nuove, colonne nuove su `salesLatePenalties` e `users`.
- `src/lib/dateUtils.ts` — esporta `romeOffset` (oggi privata).
- `src/lib/venditore/latePenaltiesRunner.ts` — filtro per `kind`, chiamata al runner calendario.
- `src/app/actions/venditoriMonitorActions.ts` — `leftJoin` sui lead, filtro `kind`, multe nuove nel registro.
- `src/app/(dashboard)/monitor-vendite/MonitorVenditeClient.tsx` — sezione "Ritardi e multe".
- `src/app/actions/venditoreActions.ts` — innesti dei blocchi da follow-up.
- `src/app/actions/confermeActions.ts` — `getVenditoriAgenda` con disponibilità e copertura.
- `src/components/VenditoriAgendaModal.tsx` — riga copertura + bottone "Non c'era".
- `src/components/Sidebar.tsx` — due voci di menu nuove.
- `package.json` — tre file di test nuovi nello script `test`.

---

### Task 1: Aritmetica degli slot

**Files:**
- Create: `src/lib/venditore/calendarSlots.ts`
- Test: `src/lib/venditore/calendarSlots.test.ts`
- Modify: `src/lib/dateUtils.ts` (esportare `romeOffset`)
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `toRomeDateStr`, `romeOffset`, `weekBoundsRome` da `src/lib/dateUtils.ts`
- Produces:
  - `SLOT_FIRST_HOUR = 9`, `SLOT_LAST_HOUR = 21`, `SLOT_HOURS: number[]`, `SLOT_DAYS = 6`, `SLOTS_PER_WEEK = 78`, `WEEKLY_DEADLINE_HOUR = 14`
  - `romeHour(at: Date): number`
  - `romeDow(at: Date): number` (1=lunedì … 7=domenica)
  - `romeInstant(dateStr: string, hour: number): Date`
  - `slotStartFor(at: Date): Date | null`
  - `slotKey(at: Date): string` (`'YYYY-MM-DD@HH'`)
  - `weekStartFor(at: Date): Date`
  - `weekStartKey(at: Date): string` (`'YYYY-MM-DD'` del lunedì)
  - `weekSlots(weekStart: Date): Date[]`
  - `weeklyDeadline(weekStart: Date): Date`
  - `slotLabel(at: Date): string` (`'09:00'`)

- [ ] **Step 1: Esportare `romeOffset` da dateUtils**

In `src/lib/dateUtils.ts` cambiare la riga 20 da `function romeOffset(` a `export function romeOffset(`. Nient'altro: la funzione resta identica, serve solo riusarla senza duplicarla.

- [ ] **Step 2: Scrivere il test che fallisce**

Creare `src/lib/venditore/calendarSlots.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    SLOTS_PER_WEEK,
    romeDow,
    romeHour,
    slotStartFor,
    slotKey,
    weekStartKey,
    weekSlots,
    weeklyDeadline,
    slotLabel,
} from './calendarSlots'

// 2026-09-14 è un lunedì; l'Italia è in ora legale (UTC+2).
const LUN_16_45 = new Date('2026-09-14T16:45:00+02:00')

test('romeDow: lunedi e 1, domenica e 7', () => {
    assert.equal(romeDow(LUN_16_45), 1)
    assert.equal(romeDow(new Date('2026-09-20T10:00:00+02:00')), 7)
})

test('romeHour legge l ora italiana, non quella UTC', () => {
    // 23:30 UTC del 13 settembre e' l'1:30 del 14 a Roma.
    assert.equal(romeHour(new Date('2026-09-13T23:30:00Z')), 1)
})

test('slotStartFor tronca all ora piena', () => {
    const s = slotStartFor(LUN_16_45)
    assert.ok(s)
    assert.equal(s!.toISOString(), '2026-09-14T14:00:00.000Z') // 16:00 Roma
})

test('slotStartFor esclude domenica e le ore fuori griglia', () => {
    assert.equal(slotStartFor(new Date('2026-09-20T15:00:00+02:00')), null) // domenica
    assert.equal(slotStartFor(new Date('2026-09-14T08:59:00+02:00')), null) // prima delle 9
    assert.equal(slotStartFor(new Date('2026-09-14T22:00:00+02:00')), null) // dopo le 21
    assert.ok(slotStartFor(new Date('2026-09-14T21:30:00+02:00')))          // 21:30 -> slot 21
})

test('slotKey e slotLabel sono leggibili in ora italiana', () => {
    assert.equal(slotKey(LUN_16_45), '2026-09-14@16')
    assert.equal(slotLabel(LUN_16_45), '16:00')
})

test('weekStartKey torna il lunedi anche partendo dal sabato', () => {
    assert.equal(weekStartKey(new Date('2026-09-19T20:00:00+02:00')), '2026-09-14')
    assert.equal(weekStartKey(LUN_16_45), '2026-09-14')
})

test('weekSlots produce 78 slot, dal lunedi 9 al sabato 21', () => {
    const slots = weekSlots(new Date('2026-09-14T00:00:00+02:00'))
    assert.equal(slots.length, SLOTS_PER_WEEK)
    assert.equal(slotKey(slots[0]), '2026-09-14@9')
    assert.equal(slotKey(slots[slots.length - 1]), '2026-09-19@21')
})

test('weekSlots regge il cambio di ora legale: la settimana resta di 78 slot', () => {
    // L'ora legale 2026 finisce domenica 25 ottobre, fuori griglia.
    const prima = weekSlots(new Date('2026-10-19T00:00:00+02:00'))
    const dopo = weekSlots(new Date('2026-10-26T00:00:00+01:00'))
    assert.equal(prima.length, SLOTS_PER_WEEK)
    assert.equal(dopo.length, SLOTS_PER_WEEK)
    // Sabato 24/10 alle 21:00 e' CEST (+2) -> 19:00Z
    assert.equal(prima[prima.length - 1].toISOString(), '2026-10-24T19:00:00.000Z')
    // Sabato 31/10 alle 21:00 e' CET (+1) -> 20:00Z
    assert.equal(dopo[dopo.length - 1].toISOString(), '2026-10-31T20:00:00.000Z')
})

test('weeklyDeadline e il lunedi alle 14 italiane', () => {
    const d = weeklyDeadline(new Date('2026-09-14T00:00:00+02:00'))
    assert.equal(d.toISOString(), '2026-09-14T12:00:00.000Z')
})
```

- [ ] **Step 3: Verificare che il test fallisca**

Run: `node --import tsx --test src/lib/venditore/calendarSlots.test.ts`
Expected: FAIL — `Cannot find module './calendarSlots'`

- [ ] **Step 4: Implementare il modulo**

Creare `src/lib/venditore/calendarSlots.ts`:

```ts
/**
 * Aritmetica degli slot del calendario venditori, sempre in Europe/Rome.
 *
 * Uno slot e' un'ora piena fra le 9 e le 21, dal lunedi al sabato: 78 a
 * settimana. Tutto cio' che sta fuori da questa griglia (domenica, notte)
 * semplicemente NON ha slot, e le regole a valle lo trattano come "non
 * misurabile": niente blocchi, niente multe, niente copertura.
 *
 * Nessun altro file del progetto fa aritmetica sulle ore del calendario:
 * il fuso e l'ora legale si sbagliano una volta sola, qui dentro.
 */

import { toRomeDateStr, romeOffset, weekBoundsRome } from '../dateUtils'

export const SLOT_FIRST_HOUR = 9
export const SLOT_LAST_HOUR = 21
export const SLOT_HOURS: number[] = Array.from(
    { length: SLOT_LAST_HOUR - SLOT_FIRST_HOUR + 1 },
    (_, i) => SLOT_FIRST_HOUR + i,
)
/** Lunedi..sabato. La domenica non e' compilabile (zero appuntamenti storici). */
export const SLOT_DAYS = 6
export const SLOTS_PER_WEEK = SLOT_HOURS.length * SLOT_DAYS
export const WEEKLY_DEADLINE_HOUR = 14

const HM = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
})

/** L'ora italiana (0-23) di un istante. */
export function romeHour(at: Date): number {
    return Number(HM.format(at).slice(0, 2))
}

/** Giorno della settimana italiano: 1 = lunedi ... 7 = domenica. */
export function romeDow(at: Date): number {
    const noon = new Date(`${toRomeDateStr(at)}T12:00:00${romeOffset(at)}`)
    const d = noon.getUTCDay() // 0 = domenica
    return d === 0 ? 7 : d
}

/**
 * L'istante corrispondente a una data italiana + ora piena.
 * L'offset si prende a mezzogiorno di quel giorno: i cambi di ora legale
 * avvengono alle 2-3 del mattino, quindi per le ore 9-21 e' sempre corretto.
 */
export function romeInstant(dateStr: string, hour: number): Date {
    const off = romeOffset(new Date(`${dateStr}T12:00:00Z`))
    return new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00${off}`)
}

/** Lo slot che contiene `at`, o null se `at` cade fuori dalla griglia. */
export function slotStartFor(at: Date): Date | null {
    if (romeDow(at) === 7) return null
    const hour = romeHour(at)
    if (hour < SLOT_FIRST_HOUR || hour > SLOT_LAST_HOUR) return null
    return romeInstant(toRomeDateStr(at), hour)
}

/** Chiave stabile per Map/Set, leggibile nei log: '2026-09-14@16'. */
export function slotKey(at: Date): string {
    return `${toRomeDateStr(at)}@${romeHour(at)}`
}

/** 'HH:00' italiane. */
export function slotLabel(at: Date): string {
    return `${String(romeHour(at)).padStart(2, '0')}:00`
}

/** Lunedi 00:00 italiane della settimana che contiene `at`. */
export function weekStartFor(at: Date): Date {
    return weekBoundsRome(at).start
}

/** 'YYYY-MM-DD' del lunedi: e' la colonna `weekStart` sul DB. */
export function weekStartKey(at: Date): string {
    return toRomeDateStr(weekStartFor(at))
}

/** I 78 slot della settimana, in ordine: lunedi 9 -> sabato 21. */
export function weekSlots(weekStart: Date): Date[] {
    const out: Date[] = []
    // Mezzogiorno UTC: Roma e' +1/+2, quindi sommare 24h non attraversa mai
    // la mezzanotte italiana nemmeno nella settimana del cambio d'ora.
    const baseNoon = new Date(`${toRomeDateStr(weekStart)}T12:00:00Z`)
    for (let d = 0; d < SLOT_DAYS; d++) {
        const dateStr = toRomeDateStr(new Date(baseNoon.getTime() + d * 86_400_000))
        for (const h of SLOT_HOURS) out.push(romeInstant(dateStr, h))
    }
    return out
}

/** Lunedi 14:00 italiane: la scadenza della compilazione. */
export function weeklyDeadline(weekStart: Date): Date {
    return romeInstant(toRomeDateStr(weekStart), WEEKLY_DEADLINE_HOUR)
}
```

- [ ] **Step 5: Verificare che i test passino**

Run: `node --import tsx --test src/lib/venditore/calendarSlots.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 6: Registrare il test nello script `test`**

In `package.json`, aggiungere ` src/lib/venditore/calendarSlots.test.ts` in coda alla lista di file dello script `test` (subito dopo `src/lib/venditore/latePenalties.test.ts`).

- [ ] **Step 7: Verificare la suite completa**

Run: `npm test`
Expected: PASS, nessuna regressione.

- [ ] **Step 8: Commit**

```bash
git add src/lib/venditore/calendarSlots.ts src/lib/venditore/calendarSlots.test.ts src/lib/dateUtils.ts package.json
git commit -m "feat(calendario): aritmetica degli slot venditori in Europe/Rome"
```

---

### Task 2: Schema e migrazione

**Files:**
- Create: `drizzle/migrations/0034_sales_calendar.sql`
- Modify: `src/db/schema.ts` (in coda, vicino a `salesLatePenalties` che sta a riga 1482)

**Interfaces:**
- Consumes: niente
- Produces: tabelle Drizzle `salesAvailabilitySlots`, `salesSlotBlocks`, `salesWeekPlans`; colonne nuove su `salesLatePenalties` (`reportedBy`, `note`, `voidedAt`, `voidedBy`, `voidReason`) e su `users` (`calendarExempt`).

- [ ] **Step 1: Scrivere la migrazione SQL**

Creare `drizzle/migrations/0034_sales_calendar.sql`:

```sql
-- 0034: calendario disponibilita' venditori (spec PO 2026-09-12).
--
-- Tre tabelle nuove + due multe nuove sul registro esistente.
-- La disponibilita' e' una DICHIARAZIONE: la riga esiste = quell'ora e' offerta.
-- I blocchi sono righe a parte perche' due follow-up possono cadere nella stessa
-- ora e il rilascio deve togliere solo il proprio.

create table if not exists public."salesAvailabilitySlots" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "slotStart"   timestamptz not null,
  "weekStart"   date not null,
  "createdAt"   timestamptz not null default now()
);

create unique index if not exists "sales_availability_slot_uq"
  on public."salesAvailabilitySlots" ("salesUserId", "slotStart");
create index if not exists "sales_availability_week_idx"
  on public."salesAvailabilitySlots" ("companyId", "weekStart");
create index if not exists "sales_availability_slot_idx"
  on public."salesAvailabilitySlots" ("companyId", "slotStart");

create table if not exists public."salesSlotBlocks" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "slotStart"   timestamptz not null,
  "kind"        text not null,
  "leadId"      text references public.leads(id) on delete cascade,
  "note"        text,
  "createdBy"   text references public.users(id),
  "createdAt"   timestamptz not null default now()
);

create index if not exists "sales_slot_blocks_user_slot_idx"
  on public."salesSlotBlocks" ("companyId", "salesUserId", "slotStart");
-- Un lead tiene al massimo uno slot: spostare il follow-up SPOSTA il blocco.
create unique index if not exists "sales_slot_blocks_followup_uq"
  on public."salesSlotBlocks" ("salesUserId", "leadId") where "kind" = 'FOLLOWUP';
-- Un solo blocco manuale per slot.
create unique index if not exists "sales_slot_blocks_manual_uq"
  on public."salesSlotBlocks" ("salesUserId", "slotStart") where "kind" = 'MANUAL';

create table if not exists public."salesWeekPlans" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "weekStart"   date not null,
  "submittedAt" timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now(),
  "slotCount"   integer not null default 0,
  "late"        boolean not null default false
);

create unique index if not exists "sales_week_plans_uq"
  on public."salesWeekPlans" ("salesUserId", "weekStart");
create index if not exists "sales_week_plans_week_idx"
  on public."salesWeekPlans" ("companyId", "weekStart");

-- Multe: le due nuove non hanno un lead (CALENDAR_MISSING) o ce l'hanno solo
-- a volte (ABSENT_SLOT), quindi leadId diventa nullable.
alter table public."salesLatePenalties" alter column "leadId" drop not null;
alter table public."salesLatePenalties" add column if not exists "reportedBy" text references public.users(id);
alter table public."salesLatePenalties" add column if not exists "note" text;
alter table public."salesLatePenalties" add column if not exists "voidedAt" timestamptz;
alter table public."salesLatePenalties" add column if not exists "voidedBy" text references public.users(id);
alter table public."salesLatePenalties" add column if not exists "voidReason" text;

-- L'unique esistente (leadId, kind, dueAt) non protegge le multe nuove: in
-- Postgres due NULL non collidono, e un ABSENT_SLOT con lead e uno senza sullo
-- stesso slot non collidono nemmeno. Per le due multe nuove la chiave e'
-- venditore + tipo + scadenza, il leadId non conta.
create unique index if not exists "sales_penalties_userkind_uq"
  on public."salesLatePenalties" ("salesUserId", "kind", "dueAt")
  where "kind" in ('CALENDAR_MISSING', 'ABSENT_SLOT');

alter table public.users add column if not exists "calendarExempt" boolean not null default false;
update public.users set "calendarExempt" = true where email = 'sales001@fenice.com';

comment on table public."salesAvailabilitySlots" is
  'Disponibilita'' dichiarata dai venditori: una riga = un''ora offerta.';
comment on table public."salesSlotBlocks" is
  'Blocchi su uno slot: MANUAL (imprevisto, min 1h di preavviso) o FOLLOWUP (automatico).';
comment on table public."salesWeekPlans" is
  'Registro della compilazione settimanale: submittedAt e'' la prova per la multa del lunedi.';
comment on column public.users."calendarExempt" is
  'true = niente obbligo di compilare, niente promemoria, niente multe calendario (Sales 001).';
```

- [ ] **Step 2: Applicare la migrazione**

Applicare il file con l'MCP Supabase `apply_migration` (project id `ncutwzsifzundikwllxp`, name `0034_sales_calendar`). `drizzle-kit generate` non va usato.

- [ ] **Step 3: Verificare che le tabelle esistano**

Eseguire con l'MCP Supabase `execute_sql`:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('salesAvailabilitySlots','salesSlotBlocks','salesWeekPlans');
select count(*) as esenti from users where "calendarExempt" = true;
```

Expected: tre tabelle elencate, `esenti = 1`.

- [ ] **Step 4: Aggiungere le tabelle a `src/db/schema.ts`**

Subito dopo il blocco `salesLatePenalties` (che finisce a riga 1506), aggiungere:

```ts
/**
 * Disponibilità dichiarata dai venditori. Una riga = uno slot offerto.
 * Assenza della riga = non disponibile: non serve un booleano.
 */
export const salesAvailabilitySlots = pgTable('salesAvailabilitySlots', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Sempre un'ora piena Europe/Rome (vedi calendarSlots.ts).
    slotStart: timestamp('slotStart', { withTimezone: true, mode: 'date' }).notNull(),
    // Lunedì della settimana: ridondante ma evita di ricalcolarlo in ogni query.
    weekStart: date('weekStart').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => {
    return {
        slotUnique: uniqueIndex('sales_availability_slot_uq').on(table.salesUserId, table.slotStart),
        weekIdx: index('sales_availability_week_idx').on(table.companyId, table.weekStart),
        slotIdx: index('sales_availability_slot_idx').on(table.companyId, table.slotStart),
    };
});

/**
 * Blocchi su uno slot: 'MANUAL' (imprevisto, almeno 1h di preavviso) o
 * 'FOLLOWUP' (automatico, quando il venditore fissa un follow-up).
 * Righe separate perché due follow-up possono cadere nella stessa ora:
 * il rilascio deve togliere solo il proprio blocco.
 */
export const salesSlotBlocks = pgTable('salesSlotBlocks', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    slotStart: timestamp('slotStart', { withTimezone: true, mode: 'date' }).notNull(),
    kind: text('kind').notNull(),
    leadId: text('leadId').references(() => leads.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdBy: text('createdBy').references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => {
    return {
        userSlotIdx: index('sales_slot_blocks_user_slot_idx').on(table.companyId, table.salesUserId, table.slotStart),
    };
});

/**
 * Registro della compilazione settimanale. `submittedAt` è il PRIMO salvataggio
 * e non si aggiorna più: è la prova che il cron del lunedì legge.
 */
export const salesWeekPlans = pgTable('salesWeekPlans', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date('weekStart').notNull(),
    submittedAt: timestamp('submittedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    slotCount: integer('slotCount').default(0).notNull(),
    late: boolean('late').default(false).notNull(),
}, (table) => {
    return {
        planUnique: uniqueIndex('sales_week_plans_uq').on(table.salesUserId, table.weekStart),
        weekIdx: index('sales_week_plans_week_idx').on(table.companyId, table.weekStart),
    };
});
```

Gli indici unici parziali (`sales_slot_blocks_followup_uq`, `sales_slot_blocks_manual_uq`, `sales_penalties_userkind_uq`) restano solo nell'SQL: Drizzle non li esprime, e lo schema TS serve alle query, non alla creazione.

Verificare che `date` sia fra gli import da `drizzle-orm/pg-core` in cima al file; se non c'è, aggiungerlo.

- [ ] **Step 5: Aggiungere le colonne nuove a `salesLatePenalties` nello schema**

Dentro il blocco `salesLatePenalties` esistente (riga 1482), rendere `leadId` nullable e aggiungere le cinque colonne:

```ts
    leadId: text('leadId').references(() => leads.id, { onDelete: 'cascade' }),
    // 'ABSENT_SLOT': chi ha premuto "non c'era". Null per le multe automatiche.
    reportedBy: text('reportedBy').references(() => users.id),
    note: text('note'),
    // Annullamento admin: la riga resta a registro, barrata, fuori da ogni totale.
    voidedAt: timestamp('voidedAt', { withTimezone: true, mode: 'date' }),
    voidedBy: text('voidedBy').references(() => users.id),
    voidReason: text('voidReason'),
```

(la riga `leadId` esistente aveva `.notNull()`: va tolto solo quello).

- [ ] **Step 6: Aggiungere `calendarExempt` alla tabella `users`**

Dentro il blocco `users`, subito dopo `statsActive` (riga ~1 del blocco "Statistiche GDO"):

```ts
    // true = esente dal calendario disponibilità: niente obbligo di compilare,
    // niente promemoria, niente multe. Deciso per Sales 001 (PO 2026-09-12).
    calendarExempt: boolean('calendarExempt').default(false).notNull(),
```

- [ ] **Step 7: Verificare i tipi**

Run: `npx tsc --noEmit`
Expected: nessun errore nuovo. Se compaiono errori su `salesLatePenalties.leadId` ora nullable, sono i punti che il Task 9 e il Task 12 devono sistemare: annotarli e proseguire (non silenziarli con `!`).

- [ ] **Step 8: Commit**

```bash
git add drizzle/migrations/0034_sales_calendar.sql src/db/schema.ts
git commit -m "feat(calendario): schema disponibilità, blocchi, piani settimanali e multe da 50 euro"
```

---

### Task 3: Le tre regole decisionali

**Files:**
- Create: `src/lib/venditore/calendarRules.ts`
- Test: `src/lib/venditore/calendarRules.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `weeklyDeadline`, `slotKey` da `./calendarSlots`; `romeMonthKey` da `./latePenalties`
- Produces:
  - `CALENDAR_PENALTY_EUR = 50`, `MANUAL_BLOCK_NOTICE_MINUTES = 60`, `ABSENCE_REPORT_WINDOW_HOURS = 48`
  - `type CalendarPenaltyKind = 'CALENDAR_MISSING' | 'ABSENT_SLOT'`
  - `interface CalendarUserRow { id, companyId, isActive, calendarExempt }`
  - `interface PendingCalendarPenalty { salesUserId, companyId, kind, dueAt, monthKey, amountEur }`
  - `selectMissingCalendarPenalties(users, submittedUserIds, weekStart, now, notBefore): PendingCalendarPenalty[]`
  - `type BlockRefusal`, `manualBlockCheck(input): BlockDecision`, `blockRefusalMessage(reason, slotStart): string`
  - `type AbsenceRefusal`, `absenceReportCheck(input): AbsenceDecision`, `absenceRefusalMessage(reason): string`
  - `calendarRuleState(): PenaltyRuleState` (gemella di `penaltyRuleState`, legge le env del calendario)

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `src/lib/venditore/calendarRules.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    CALENDAR_PENALTY_EUR,
    selectMissingCalendarPenalties,
    manualBlockCheck,
    absenceReportCheck,
    type CalendarUserRow,
} from './calendarRules'

const LUNEDI = new Date('2026-09-14T00:00:00+02:00')
const SCADENZA = new Date('2026-09-14T14:00:00+02:00')
const ATTIVAZIONE = new Date('2026-09-01T00:00:00+02:00')

function utente(over: Partial<CalendarUserRow> = {}): CalendarUserRow {
    return { id: 'sales-2', companyId: 'fenice', isActive: true, calendarExempt: false, ...over }
}

test('dopo le 14 di lunedi chi non ha compilato prende 50 euro', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-14T14:05:00+02:00'), ATTIVAZIONE,
    )
    assert.equal(out.length, 1)
    assert.equal(out[0].amountEur, CALENDAR_PENALTY_EUR)
    assert.equal(out[0].kind, 'CALENDAR_MISSING')
    assert.equal(out[0].monthKey, '2026-09')
    assert.equal(out[0].dueAt.toISOString(), SCADENZA.toISOString())
})

test('prima delle 14 non scatta nulla', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-14T13:59:00+02:00'), ATTIVAZIONE,
    )
    assert.deepEqual(out, [])
})

test('chi ha compilato, chi e esente e chi e disattivato non prendono multe', () => {
    const users = [
        utente({ id: 'ha-compilato' }),
        utente({ id: 'esente', calendarExempt: true }),
        utente({ id: 'spento', isActive: false }),
        utente({ id: 'colpevole' }),
    ]
    const out = selectMissingCalendarPenalties(
        users, new Set(['ha-compilato']), LUNEDI,
        new Date('2026-09-14T18:00:00+02:00'), ATTIVAZIONE,
    )
    assert.deepEqual(out.map(p => p.salesUserId), ['colpevole'])
})

test('senza data di attivazione non si registra nulla', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-14T18:00:00+02:00'), null,
    )
    assert.deepEqual(out, [])
})

test('una scadenza anteriore all attivazione non genera multe retroattive', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-14T18:00:00+02:00'),
        new Date('2026-09-20T00:00:00+02:00'),
    )
    assert.deepEqual(out, [])
})

test('la multa e datata lunedi 14 anche se il cron la trova martedi', () => {
    const out = selectMissingCalendarPenalties(
        [utente()], new Set(), LUNEDI,
        new Date('2026-09-15T09:00:00+02:00'), ATTIVAZIONE,
    )
    assert.equal(out[0].dueAt.toISOString(), SCADENZA.toISOString())
})

// --- blocco manuale ---

const SLOT = new Date('2026-09-16T18:00:00+02:00')

test('blocco consentito a 61 minuti, negato a 59', () => {
    const base = { slotStart: SLOT, declared: true, hasAppointment: false, alreadyBlocked: false }
    assert.equal(manualBlockCheck({ ...base, now: new Date('2026-09-16T16:59:00+02:00') }).ok, true)
    const tardi = manualBlockCheck({ ...base, now: new Date('2026-09-16T17:01:00+02:00') })
    assert.equal(tardi.ok, false)
    assert.equal(tardi.ok === false && tardi.reason, 'preavviso_insufficiente')
})

test('non si blocca uno slot che ha gia un appuntamento', () => {
    const d = manualBlockCheck({
        slotStart: SLOT, now: new Date('2026-09-16T10:00:00+02:00'),
        declared: true, hasAppointment: true, alreadyBlocked: false,
    })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'appuntamento_presente')
})

test('non si blocca uno slot mai dichiarato, ne si blocca due volte', () => {
    const now = new Date('2026-09-16T10:00:00+02:00')
    const nonDichiarato = manualBlockCheck({ slotStart: SLOT, now, declared: false, hasAppointment: false, alreadyBlocked: false })
    assert.equal(nonDichiarato.ok === false && nonDichiarato.reason, 'slot_non_dichiarato')
    const doppio = manualBlockCheck({ slotStart: SLOT, now, declared: true, hasAppointment: false, alreadyBlocked: true })
    assert.equal(doppio.ok === false && doppio.reason, 'gia_bloccato')
})

// --- segnalazione assenza ---

function ctx(over: Partial<Parameters<typeof absenceReportCheck>[0]> = {}) {
    return {
        slotStart: SLOT,
        now: new Date('2026-09-16T19:00:00+02:00'),
        declared: true,
        blocked: false,
        exempt: false,
        alreadyReported: false,
        ...over,
    }
}

test('segnalazione ammessa su uno slot passato, dichiarato e non bloccato', () => {
    assert.equal(absenceReportCheck(ctx()).ok, true)
})

test('niente segnalazione sul futuro, oltre 48 ore, su esenti, fuori disponibilita, su bloccati o gia segnalati', () => {
    const casi: Array<[Parameters<typeof absenceReportCheck>[0], string]> = [
        [ctx({ now: new Date('2026-09-16T17:30:00+02:00') }), 'slot_futuro'],
        [ctx({ now: new Date('2026-09-19T10:00:00+02:00') }), 'finestra_scaduta'],
        [ctx({ exempt: true }), 'venditore_esente'],
        [ctx({ declared: false }), 'non_dichiarato'],
        [ctx({ blocked: true }), 'slot_bloccato'],
        [ctx({ alreadyReported: true }), 'gia_segnalato'],
    ]
    for (const [input, atteso] of casi) {
        const d = absenceReportCheck(input)
        assert.equal(d.ok, false, `atteso rifiuto ${atteso}`)
        assert.equal(d.ok === false && d.reason, atteso)
    }
})
```

- [ ] **Step 2: Verificare che il test fallisca**

Run: `node --import tsx --test src/lib/venditore/calendarRules.test.ts`
Expected: FAIL — `Cannot find module './calendarRules'`

- [ ] **Step 3: Implementare il modulo**

Creare `src/lib/venditore/calendarRules.ts`:

```ts
/**
 * Le tre regole economiche del calendario disponibilità.
 *
 * Tutte pure: nessun accesso al DB, nessun `new Date()` implicito. Chi chiama
 * passa `now`, così le regole sono testabili al minuto e il cron è idempotente
 * per costruzione.
 */

import { weeklyDeadline } from './calendarSlots'
import { romeMonthKey, type PenaltyRuleState } from './latePenalties'

/** Trattenuta delle due multe nuove. I 10 € dei ritardi restano dove sono. */
export const CALENDAR_PENALTY_EUR = 50
/** Preavviso minimo per bloccare uno slot per imprevisto. */
export const MANUAL_BLOCK_NOTICE_MINUTES = 60
/** Oltre questa finestra lo slot è troppo vecchio per essere segnalato. */
export const ABSENCE_REPORT_WINDOW_HOURS = 48

export type CalendarPenaltyKind = 'CALENDAR_MISSING' | 'ABSENT_SLOT'

export interface CalendarUserRow {
    id: string
    companyId: string
    isActive: boolean
    calendarExempt: boolean
}

export interface PendingCalendarPenalty {
    salesUserId: string
    companyId: string
    kind: CalendarPenaltyKind
    dueAt: Date
    monthKey: string
    amountEur: number
}

/**
 * Chi va multato per non aver compilato la settimana.
 *
 * `notBefore` è la data di attivazione della regola: senza, o con una scadenza
 * anteriore, non si registra nulla. È la stessa protezione del malus ritardi —
 * una regola nuova non deve mai poter multare il passato.
 */
export function selectMissingCalendarPenalties(
    users: CalendarUserRow[],
    submittedUserIds: Set<string>,
    weekStart: Date,
    now: Date,
    notBefore: Date | null,
): PendingCalendarPenalty[] {
    if (!notBefore) return []
    const dueAt = weeklyDeadline(weekStart)
    if (now < dueAt) return []
    if (dueAt < notBefore) return []

    return users
        .filter(u => u.isActive && !u.calendarExempt && !submittedUserIds.has(u.id))
        .map(u => ({
            salesUserId: u.id,
            companyId: u.companyId,
            kind: 'CALENDAR_MISSING' as const,
            dueAt,
            monthKey: romeMonthKey(dueAt),
            amountEur: CALENDAR_PENALTY_EUR,
        }))
}

export type BlockRefusal =
    | 'preavviso_insufficiente'
    | 'slot_non_dichiarato'
    | 'appuntamento_presente'
    | 'gia_bloccato'

export type BlockDecision = { ok: true } | { ok: false; reason: BlockRefusal }

/**
 * Un venditore può bloccare uno slot per imprevisto solo con più di un'ora di
 * preavviso e solo se non c'è già un appuntamento dentro: senza quest'ultima
 * guardia basterebbe bloccare a 61 minuti dall'appuntamento per non pagare.
 */
export function manualBlockCheck(input: {
    slotStart: Date
    now: Date
    declared: boolean
    hasAppointment: boolean
    alreadyBlocked: boolean
}): BlockDecision {
    if (!input.declared) return { ok: false, reason: 'slot_non_dichiarato' }
    if (input.alreadyBlocked) return { ok: false, reason: 'gia_bloccato' }
    if (input.hasAppointment) return { ok: false, reason: 'appuntamento_presente' }
    const minutiDiPreavviso = (input.slotStart.getTime() - input.now.getTime()) / 60_000
    if (minutiDiPreavviso <= MANUAL_BLOCK_NOTICE_MINUTES) {
        return { ok: false, reason: 'preavviso_insufficiente' }
    }
    return { ok: true }
}

export function blockRefusalMessage(reason: BlockRefusal, slotStart: Date): string {
    const ora = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(slotStart)
    switch (reason) {
        case 'preavviso_insufficiente':
            return `Troppo tardi: uno slot si blocca almeno un'ora prima. Le ${ora} restano disponibili.`
        case 'slot_non_dichiarato':
            return 'Questo slot non è fra quelli che hai dichiarato disponibili.'
        case 'appuntamento_presente':
            return `C'è un appuntamento alle ${ora}: avvisa le Conferme per spostarlo.`
        case 'gia_bloccato':
            return 'Questo slot è già bloccato.'
    }
}

export type AbsenceRefusal =
    | 'venditore_esente'
    | 'slot_futuro'
    | 'finestra_scaduta'
    | 'non_dichiarato'
    | 'slot_bloccato'
    | 'gia_segnalato'

export type AbsenceDecision = { ok: true } | { ok: false; reason: AbsenceRefusal }

/**
 * Ammissibilità della segnalazione "non c'era". L'ordine dei controlli è
 * l'ordine dei messaggi: si dice per prima la cosa più utile a chi guarda il
 * bottone spento.
 */
export function absenceReportCheck(input: {
    slotStart: Date
    now: Date
    declared: boolean
    blocked: boolean
    exempt: boolean
    alreadyReported: boolean
}): AbsenceDecision {
    if (input.exempt) return { ok: false, reason: 'venditore_esente' }
    if (input.now < input.slotStart) return { ok: false, reason: 'slot_futuro' }
    const oreTrascorse = (input.now.getTime() - input.slotStart.getTime()) / 3_600_000
    if (oreTrascorse > ABSENCE_REPORT_WINDOW_HOURS) return { ok: false, reason: 'finestra_scaduta' }
    if (!input.declared) return { ok: false, reason: 'non_dichiarato' }
    if (input.blocked) return { ok: false, reason: 'slot_bloccato' }
    if (input.alreadyReported) return { ok: false, reason: 'gia_segnalato' }
    return { ok: true }
}

export function absenceRefusalMessage(reason: AbsenceRefusal): string {
    switch (reason) {
        case 'venditore_esente': return 'Questo venditore è esente dal calendario.'
        case 'slot_futuro': return "Lo slot non è ancora iniziato."
        case 'finestra_scaduta': return 'Sono passate più di 48 ore: la segnalazione non è più possibile.'
        case 'non_dichiarato': return 'Questo slot non era dichiarato disponibile: non può generare multa.'
        case 'slot_bloccato': return 'Lo slot era bloccato: il venditore aveva avvisato.'
        case 'gia_segnalato': return 'Assenza già segnalata per questo slot.'
    }
}

/**
 * Stato della regola calendario, gemello di `penaltyRuleState` dei ritardi.
 * Una sezione vuota perché nessuno è in ritardo e una vuota perché la regola
 * non è mai stata accesa si assomigliano troppo: la seconda sembra un guasto.
 */
export function calendarRuleState(): PenaltyRuleState {
    const raw = process.env.SALES_CALENDAR_PENALTIES_FROM
    const from = raw ? new Date(raw) : null
    const valid = from && !isNaN(from.getTime()) ? from : null
    if (process.env.SALES_CALENDAR_PENALTIES === 'off') {
        return { active: false, reason: 'kill_switch', from: valid }
    }
    if (!valid) return { active: false, reason: 'not_activated', from: null }
    return { active: true, from: valid }
}
```

- [ ] **Step 4: Verificare che i test passino**

Run: `node --import tsx --test src/lib/venditore/calendarRules.test.ts`
Expected: PASS, 10 test.

- [ ] **Step 5: Registrare il test e girare la suite**

Aggiungere ` src/lib/venditore/calendarRules.test.ts` allo script `test` di `package.json`.
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/venditore/calendarRules.ts src/lib/venditore/calendarRules.test.ts package.json
git commit -m "feat(calendario): regole di multa, blocco manuale e segnalazione assenza"
```

---

### Task 4: Copertura e stima affluenza

**Files:**
- Create: `src/lib/venditore/calendarCoverage.ts`
- Test: `src/lib/venditore/calendarCoverage.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `slotKey`, `romeDow`, `romeHour` da `./calendarSlots`
- Produces:
  - `DEMAND_WEEKS = 8`
  - `interface DemandSample { appointmentAt: Date; presented: boolean }`
  - `interface DemandStat { dow: number; hour: number; expected: number; showRate: number; expectedPeople: number }`
  - `buildDemand(samples: DemandSample[], weeks?: number): DemandStat[]`
  - `type CoverageStatus = 'rosso' | 'ambra' | 'verde' | 'neutro'`
  - `coverageStatus(available: number, expectedPeople: number): CoverageStatus`
  - `interface CoverageCell { slotKey, slotStart, dow, hour, available: string[], blocked: string[], busy: Array<{ salesUserId, leadId, leadName }>, expectedPeople, showRate, status }`
  - `buildCoverage(params): CoverageCell[]`

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `src/lib/venditore/calendarCoverage.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDemand, buildCoverage, coverageStatus } from './calendarCoverage'
import { weekSlots } from './calendarSlots'

const LUNEDI = new Date('2026-09-14T00:00:00+02:00')

test('coverageStatus: rosso senza nessuno, ambra se scarsi, verde se coperti, neutro se non arriva nessuno', () => {
    assert.equal(coverageStatus(0, 2.4), 'rosso')
    assert.equal(coverageStatus(1, 2.4), 'ambra')
    assert.equal(coverageStatus(3, 2.4), 'verde')
    assert.equal(coverageStatus(0, 0), 'neutro')
})

test('buildDemand media sugli slot e calcola la percentuale di presenza', () => {
    // 4 appuntamenti di mercoledi alle 15 su 8 settimane, 3 presentati.
    const samples = [
        { appointmentAt: new Date('2026-08-19T15:00:00+02:00'), presented: true },
        { appointmentAt: new Date('2026-08-26T15:00:00+02:00'), presented: true },
        { appointmentAt: new Date('2026-09-02T15:00:00+02:00'), presented: true },
        { appointmentAt: new Date('2026-09-09T15:00:00+02:00'), presented: false },
    ]
    const stats = buildDemand(samples, 8)
    const mer15 = stats.find(s => s.dow === 3 && s.hour === 15)
    assert.ok(mer15)
    assert.equal(mer15!.expected, 0.5)          // 4 appuntamenti / 8 settimane
    assert.equal(mer15!.showRate, 0.75)         // 3 su 4
    assert.equal(mer15!.expectedPeople, 0.375)
})

test('buildDemand ignora gli appuntamenti fuori griglia', () => {
    const stats = buildDemand([
        { appointmentAt: new Date('2026-09-13T15:00:00+02:00'), presented: true }, // domenica
        { appointmentAt: new Date('2026-09-14T23:00:00+02:00'), presented: true }, // fuori orario
    ], 8)
    assert.deepEqual(stats, [])
})

test('buildCoverage incrocia disponibili, bloccati, appuntamenti e attesi', () => {
    const slots = weekSlots(LUNEDI)
    const cells = buildCoverage({
        slots,
        availability: [
            { salesUserId: 's2', slotKey: '2026-09-14@15' },
            { salesUserId: 's3', slotKey: '2026-09-14@15' },
            { salesUserId: 's4', slotKey: '2026-09-14@15' },
        ],
        blocks: [{ salesUserId: 's4', slotKey: '2026-09-14@15' }],
        appointments: [{ salesUserId: 's2', slotKey: '2026-09-14@15', leadId: 'l1', leadName: 'Mario Rossi' }],
        demand: [{ dow: 1, hour: 15, expected: 3, showRate: 0.8, expectedPeople: 2.4 }],
    })
    const cell = cells.find(c => c.slotKey === '2026-09-14@15')!
    assert.deepEqual(cell.available.sort(), ['s2', 's3'])  // s4 e' bloccato
    assert.deepEqual(cell.blocked, ['s4'])
    assert.equal(cell.busy.length, 1)
    assert.equal(cell.busy[0].leadName, 'Mario Rossi')
    assert.equal(cell.expectedPeople, 2.4)
    assert.equal(cell.status, 'ambra')                     // 2 disponibili < 2.4 attesi
})

test('buildCoverage restituisce una cella per ogni slot della settimana', () => {
    const cells = buildCoverage({
        slots: weekSlots(LUNEDI), availability: [], blocks: [], appointments: [], demand: [],
    })
    assert.equal(cells.length, 78)
    assert.ok(cells.every(c => c.status === 'neutro'))
})
```

- [ ] **Step 2: Verificare che il test fallisca**

Run: `node --import tsx --test src/lib/venditore/calendarCoverage.test.ts`
Expected: FAIL — `Cannot find module './calendarCoverage'`

- [ ] **Step 3: Implementare il modulo**

Creare `src/lib/venditore/calendarCoverage.ts`:

```ts
/**
 * Copertura per slot e stima dell'affluenza.
 *
 * Un solo calcolo per tre viste (venditore, Conferme, direzione): se i numeri
 * divergessero fra le schermate, la prima discussione sul perché costerebbe più
 * di questa astrazione.
 *
 * Puro: riceve righe già lette dal DB, non ne legge nessuna.
 */

import { slotKey, romeDow, romeHour } from './calendarSlots'

/** Settimane intere guardate all'indietro per la media (quella in corso esclusa). */
export const DEMAND_WEEKS = 8

export interface DemandSample {
    appointmentAt: Date
    /** `leads.presentedAt` valorizzato: la presenza latchata al giorno dell'appuntamento. */
    presented: boolean
}

export interface DemandStat {
    dow: number
    hour: number
    /** Appuntamenti fissati in quella fascia, per settimana. */
    expected: number
    /** Quota di quelli che si presentano. */
    showRate: number
    /** `expected * showRate`: persone che ci si aspetta davvero. */
    expectedPeople: number
}

export function buildDemand(samples: DemandSample[], weeks: number = DEMAND_WEEKS): DemandStat[] {
    const acc = new Map<string, { dow: number; hour: number; total: number; presented: number }>()
    for (const s of samples) {
        const dow = romeDow(s.appointmentAt)
        const hour = romeHour(s.appointmentAt)
        // Fuori griglia: non è una fascia che il calendario possa coprire.
        if (dow === 7 || hour < 9 || hour > 21) continue
        const k = `${dow}-${hour}`
        const cur = acc.get(k) || { dow, hour, total: 0, presented: 0 }
        cur.total += 1
        if (s.presented) cur.presented += 1
        acc.set(k, cur)
    }

    return [...acc.values()].map(v => {
        const expected = v.total / weeks
        const showRate = v.total > 0 ? v.presented / v.total : 0
        return { dow: v.dow, hour: v.hour, expected, showRate, expectedPeople: expected * showRate }
    })
}

export type CoverageStatus = 'rosso' | 'ambra' | 'verde' | 'neutro'

export function coverageStatus(available: number, expectedPeople: number): CoverageStatus {
    if (expectedPeople <= 0) return 'neutro'
    if (available === 0) return 'rosso'
    if (available < expectedPeople) return 'ambra'
    return 'verde'
}

export interface CoverageCell {
    slotKey: string
    /** ISO dell'istante d'inizio: il client lo riconverte per l'etichetta. */
    slotStart: string
    dow: number
    hour: number
    /** Chi è davvero disponibile: dichiarato e non bloccato. */
    available: string[]
    /** Chi ha dichiarato ma è bloccato (follow-up o imprevisto). */
    blocked: string[]
    busy: Array<{ salesUserId: string; leadId: string; leadName: string }>
    expectedPeople: number
    showRate: number
    status: CoverageStatus
}

export function buildCoverage(params: {
    slots: Date[]
    availability: Array<{ salesUserId: string; slotKey: string }>
    blocks: Array<{ salesUserId: string; slotKey: string }>
    appointments: Array<{ salesUserId: string; slotKey: string; leadId: string; leadName: string }>
    demand: DemandStat[]
}): CoverageCell[] {
    const declaredBy = new Map<string, Set<string>>()
    for (const a of params.availability) {
        if (!declaredBy.has(a.slotKey)) declaredBy.set(a.slotKey, new Set())
        declaredBy.get(a.slotKey)!.add(a.salesUserId)
    }
    const blockedBy = new Map<string, Set<string>>()
    for (const b of params.blocks) {
        if (!blockedBy.has(b.slotKey)) blockedBy.set(b.slotKey, new Set())
        blockedBy.get(b.slotKey)!.add(b.salesUserId)
    }
    const busyBy = new Map<string, CoverageCell['busy']>()
    for (const a of params.appointments) {
        if (!busyBy.has(a.slotKey)) busyBy.set(a.slotKey, [])
        busyBy.get(a.slotKey)!.push({ salesUserId: a.salesUserId, leadId: a.leadId, leadName: a.leadName })
    }
    const demandBy = new Map(params.demand.map(d => [`${d.dow}-${d.hour}`, d]))

    return params.slots.map(slot => {
        const key = slotKey(slot)
        const dow = romeDow(slot)
        const hour = romeHour(slot)
        const declared = declaredBy.get(key) || new Set<string>()
        const blockedSet = blockedBy.get(key) || new Set<string>()
        const available = [...declared].filter(u => !blockedSet.has(u))
        const blocked = [...declared].filter(u => blockedSet.has(u))
        const d = demandBy.get(`${dow}-${hour}`)
        const expectedPeople = d?.expectedPeople ?? 0
        return {
            slotKey: key,
            slotStart: slot.toISOString(),
            dow,
            hour,
            available,
            blocked,
            busy: busyBy.get(key) || [],
            expectedPeople,
            showRate: d?.showRate ?? 0,
            status: coverageStatus(available.length, expectedPeople),
        }
    })
}
```

- [ ] **Step 4: Verificare che i test passino**

Run: `node --import tsx --test src/lib/venditore/calendarCoverage.test.ts`
Expected: PASS, 5 test.

- [ ] **Step 5: Registrare il test e girare la suite**

Aggiungere ` src/lib/venditore/calendarCoverage.test.ts` allo script `test`.
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/venditore/calendarCoverage.ts src/lib/venditore/calendarCoverage.test.ts package.json
git commit -m "feat(calendario): copertura per slot e stima affluenza su 8 settimane"
```

---

### Task 5: Server action del venditore

**Files:**
- Create: `src/app/actions/salesCalendarActions.ts`

**Interfaces:**
- Consumes: `calendarSlots`, `calendarRules`, `calendarCoverage` dai Task 1/3/4; tabelle del Task 2; `currentTenant`/`assertSalesArea` da `@/lib/tenancy`
- Produces:
  - `getCalendarWeek(input?: { weekStartIso?: string; salesUserId?: string }): Promise<CalendarWeekView>`
  - `saveCalendarWeek(weekStartIso: string, slotKeys: string[]): Promise<{ success: boolean; error?: string; late?: boolean }>`
  - `blockSlot(slotIso: string, note?: string): Promise<{ success: boolean; error?: string }>`
  - `unblockSlot(slotIso: string): Promise<{ success: boolean; error?: string }>`
  - `interface CalendarWeekView { weekStartIso, deadlineIso, editable, readOnlyReason, isExempt, mySlots: string[], myBlocks: Array<{slotKey, kind, leadId, leadName}>, myAppointments: Array<{slotKey, leadId, leadName}>, submittedAtIso, slotCount, late, penaltyIso, coverage: CoverageCell[], venditori: Array<{id,name}> }`

- [ ] **Step 1: Scrivere il file**

Creare `src/app/actions/salesCalendarActions.ts`. Struttura obbligatoria:

```ts
"use server"

import { db } from "@/db"
import {
    leads, users, salesAvailabilitySlots, salesSlotBlocks, salesWeekPlans, salesLatePenalties,
} from "@/db/schema"
import { and, eq, gte, lt, inArray, isNotNull, or, sql } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea, type TenantContext } from "@/lib/tenancy"
import { toRomeDateStr } from "@/lib/dateUtils"
import {
    weekSlots, weekStartFor, weekStartKey, weeklyDeadline, slotKey, slotStartFor, romeInstant,
} from "@/lib/venditore/calendarSlots"
import { manualBlockCheck, blockRefusalMessage } from "@/lib/venditore/calendarRules"
import { buildCoverage, buildDemand, DEMAND_WEEKS, type CoverageCell } from "@/lib/venditore/calendarCoverage"
import { revalidatePath } from "next/cache"
```

Funzioni interne da implementare in questo ordine:

1. `async function requireSalesSession()` — legge la sessione Supabase, torna `{ userId, role, email, ctx }`. Lancia `new Error("Unauthorized")` se manca l'utente. Nessun filtro di ruolo qui: i filtri stanno nelle funzioni esportate.

2. `async function activeVenditori(ctx: TenantContext)` — elenco venditori con il pattern multi-tenant di `getVenditoriAgenda`:

```ts
const rows = await db.select({
    id: users.id, name: users.name, displayName: users.displayName,
    calendarExempt: users.calendarExempt,
}).from(users).where(and(
    or(
        sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
        and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
    ),
    eq(users.role, 'VENDITORE'),
    eq(users.isActive, true),
))
return rows.map(r => ({ id: r.id, name: r.displayName || r.name || 'Venditore', calendarExempt: r.calendarExempt }))
```

3. `async function weekCoverage(ctx, weekStart: Date): Promise<CoverageCell[]>` — legge in parallelo, per l'intervallo `[weekStart, weekStart+7gg)`:
   - `salesAvailabilitySlots` filtrata per `companyId` e `weekStart = toRomeDateStr(weekStart)`
   - `salesSlotBlocks` filtrata per `companyId` e `slotStart` nell'intervallo
   - appuntamenti: `leads` con `salespersonUserId` e `appointmentDate` nell'intervallo
   - domanda: `leads` con `appointmentDate` nelle 8 settimane intere precedenti quella **corrente** (non quella richiesta: la stima è storica e non cambia navigando le settimane future)

   Poi mappa ogni riga con `slotKey(...)` — per gli appuntamenti si passa da `slotStartFor(appointmentDate)` e si scartano i `null` — e chiama `buildCoverage({ slots: weekSlots(weekStart), ... })`.

   L'intervallo della domanda si calcola così:

```ts
const currentWeekStart = weekStartFor(new Date())
const demandEnd = currentWeekStart
const demandStart = new Date(currentWeekStart.getTime() - DEMAND_WEEKS * 7 * 86_400_000)
```

4. `export async function getCalendarWeek(input)` — ruoli ammessi: tutti quelli autenticati in area sales (la copertura è pubblica internamente). `salesUserId` diverso dal proprio è consentito solo a `ADMIN`, `MANAGER`, `CONFERME`; altrimenti si ignora e si usa il proprio.
   - `weekStart = input?.weekStartIso ? weekStartFor(new Date(input.weekStartIso)) : weekStartFor(new Date())`
   - `editable = weekStart >= weekStartFor(new Date()) && targetUserId === userId && role === 'VENDITORE'`; `readOnlyReason` = `'settimana_passata'` o `'altro_venditore'` o `null`
   - `mySlots`: `slotKey` delle righe di `salesAvailabilitySlots` del target nella settimana
   - `myBlocks`: righe di `salesSlotBlocks` del target nella settimana, con `leadName` via join su `leads`
   - `myAppointments`: lead del target con `appointmentDate` nella settimana, mappati a slot
   - `submittedAtIso`, `slotCount`, `late` dalla riga `salesWeekPlans`
   - `penaltyIso`: `dueAt` dell'eventuale `CALENDAR_MISSING` non annullata per quel venditore e quella scadenza
   - `coverage`: `weekCoverage(ctx, weekStart)`
   - `venditori`: `activeVenditori(ctx)` ridotto a `{ id, name }`, serve al client per rendere i nomi nella copertura

5. `export async function saveCalendarWeek(weekStartIso, slotKeys)` — solo `VENDITORE`, solo il proprio calendario.
   - Rifiuta con `'Le settimane passate non si modificano.'` se `weekStartFor(new Date(weekStartIso)) < weekStartFor(new Date())`
   - Valida ogni `slotKey` ricostruendolo: `const [dateStr, h] = key.split('@')`, poi `romeInstant(dateStr, Number(h))`, e scarta tutto ciò che non appartiene a `weekSlots(weekStart)` (confronto su `slotKey`). Gli slot inventati dal client non devono poter entrare nel DB.
   - In transazione: `delete` delle righe di quella settimana per quel venditore, `insert` delle nuove, upsert su `salesWeekPlans`:

```ts
await tx.insert(salesWeekPlans).values({
    id: crypto.randomUUID(),
    companyId: ctx.companyId,
    salesUserId: userId,
    weekStart: toRomeDateStr(weekStart),
    submittedAt: now,
    updatedAt: now,
    slotCount: valid.length,
    late: now > weeklyDeadline(weekStart),
}).onConflictDoUpdate({
    target: [salesWeekPlans.salesUserId, salesWeekPlans.weekStart],
    // submittedAt e late NON si toccano: sono la prova del primo salvataggio.
    set: { slotCount: valid.length, updatedAt: now },
})
```

   - `revalidatePath('/mio-calendario')`

6. `export async function blockSlot(slotIso, note)` — solo `VENDITORE`, solo il proprio.
   - `const slot = slotStartFor(new Date(slotIso))`; se `null` → `{ success:false, error:'Ora fuori dal calendario.' }`
   - Legge in parallelo: esistenza della disponibilità, esistenza di un blocco su quello slot, esistenza di un appuntamento del venditore in quello slot (lead con `appointmentDate` fra `slot` e `slot+1h`)
   - `const d = manualBlockCheck({ slotStart: slot, now: new Date(), declared, hasAppointment, alreadyBlocked })`; se `!d.ok` → `{ success:false, error: blockRefusalMessage(d.reason, slot) }`
   - Inserisce la riga `kind:'MANUAL'`, `createdBy: userId`, `note`
   - `revalidatePath('/mio-calendario')`

7. `export async function unblockSlot(slotIso)` — cancella il solo blocco `MANUAL` del venditore su quello slot. I blocchi `FOLLOWUP` non si tolgono da qui: si tolgono spostando o esitando il follow-up. Se l'utente prova, tornare `{ success:false, error:'Questo slot è occupato da un follow-up: spostalo o registrane l'esito.' }`.

- [ ] **Step 2: Verificare i tipi**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Verifica manuale contro il DB**

Con l'MCP Supabase controllare che, dopo un salvataggio dall'app (Task 6), le righe compaiano. In questo momento basta verificare che il file compili e che le query siano scritte con `eq(salesAvailabilitySlots.companyId, ctx.companyId)` ovunque: una query senza filtro di tenant è un bug di sicurezza, non uno stilistico.

Run: `grep -n "companyId" src/app/actions/salesCalendarActions.ts | wc -l`
Expected: almeno una occorrenza per ogni `db.select`/`db.insert`/`db.delete` del file.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/salesCalendarActions.ts
git commit -m "feat(calendario): server action del venditore (settimana, salvataggio, blocchi)"
```

---

### Task 6: Griglia condivisa e pagina `/mio-calendario`

**Files:**
- Create: `src/components/calendar/SlotGrid.tsx`
- Create: `src/components/calendar/CoverageLegend.tsx`
- Create: `src/app/(dashboard)/mio-calendario/page.tsx`
- Create: `src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `getCalendarWeek`, `saveCalendarWeek`, `blockSlot`, `unblockSlot` (Task 5); `SLOT_HOURS`, `slotKey`, `slotLabel` (Task 1)
- Produces:
  - `SlotGrid` con props `{ weekStartIso: string; cells: Map<string, SlotCellView>; onCellClick?: (slotKey: string) => void; onCellMenu?: (slotKey: string) => void; readOnly?: boolean }`
  - `type SlotCellView = { state: 'libero' | 'disponibile' | 'occupato' | 'bloccato'; badge?: string; subtitle?: string; tone?: CoverageStatus; title?: string }`

- [ ] **Step 1: Creare la griglia presentazionale**

`src/components/calendar/SlotGrid.tsx`, `"use client"`. Regole di resa:

- Tabella 7 colonne (ora + 6 giorni) × 13 righe, `overflow-x-auto` sul contenitore: sotto i 640px la griglia scorre in orizzontale invece di comprimersi.
- Intestazione colonne: `Lun 14/09`, `Mar 15/09`, … derivate da `weekStartIso`.
- Prima colonna: `09:00` … `21:00`.
- Ogni cella è un `<button type="button">` (mai dentro `<span>`/`<p>`: regola CLAUDE.md §4.1) con `aria-label` = `"Lunedì 14 settembre alle 15:00 — disponibile"`.
- Colori per `state`: `libero` = `bg-white border-ash-200 text-ash-400`; `disponibile` = `bg-emerald-50 border-emerald-300 text-emerald-800`; `occupato` = `bg-sky-50 border-sky-300 text-sky-900`; `bloccato` = `bg-ash-100 border-ash-300 text-ash-500 line-through`.
- Se `tone` è valorizzato, una barretta di 3px in cima alla cella: `rosso` = `bg-rose-500`, `ambra` = `bg-amber-400`, `verde` = `bg-emerald-500`, `neutro` = trasparente.
- `badge` in alto a destra (piccolo, `text-[10px]`), `subtitle` sotto il contenuto principale.
- `readOnly` → `disabled` su tutti i bottoni e `cursor-default`.

- [ ] **Step 2: Creare la legenda**

`src/components/calendar/CoverageLegend.tsx`: riga di pastiglie con i quattro stati colore e i quattro stati cella, testo italiano breve. Nessuna logica.

- [ ] **Step 3: Creare la pagina server**

`src/app/(dashboard)/mio-calendario/page.tsx`, sul modello di `src/app/(dashboard)/monitor-vendite/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getCalendarWeek } from "@/app/actions/salesCalendarActions"
import { MioCalendarioClient } from "./MioCalendarioClient"

export default async function MioCalendarioPage({
    searchParams,
}: { searchParams: Promise<{ venditore?: string; settimana?: string }> }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string) || ""
    if (!user || !["VENDITORE", "ADMIN", "MANAGER", "CONFERME"].includes(role)) redirect("/")

    const sp = await searchParams
    const initial = await getCalendarWeek({ weekStartIso: sp.settimana, salesUserId: sp.venditore })

    return (
        <div className="min-h-screen p-4 sm:p-6">
            <MioCalendarioClient initial={initial} role={role} />
        </div>
    )
}
```

- [ ] **Step 4: Creare il client**

`src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx`, `"use client"`. Contenuto:

1. **Striscia di stato** in cima, tre varianti mutuamente esclusive:
   - non compilata e scadenza futura: fondo ambra, `"Compila entro lunedì 14:00 — mancano 2g 4h"`, countdown ricalcolato ogni minuto con `useEffect` + `setInterval`;
   - non compilata e scadenza passata con multa registrata: fondo rosa, `"Calendario non compilato: multa di 50 € registrata lunedì 14/09. Puoi compilare comunque."`;
   - compilata: fondo verde, `"Compilato lunedì 14/09 alle 11:20 — 28 ore dichiarate"`, con `"(in ritardo)"` se `late`.
   - Se `isExempt`: fondo neutro, `"Sei esente dall'obbligo di compilazione."` e nessun countdown.

2. **Selettore settimana**: frecce avanti/indietro + etichetta `"14 – 19 settembre"`. Indietro oltre la settimana corrente è consentito ma la griglia diventa `readOnly` con la nota `"Settimana passata: sola lettura."`. Avanti fino a 3 settimane.

3. **Interruttore** `Il mio calendario` / `Copertura squadra` (due bottoni in un contenitore `<div>`).

4. **Vista "Il mio calendario"**: `SlotGrid` con `cells` derivate così, per ogni slot della settimana:
   - se c'è un mio appuntamento → `state:'occupato'`, `subtitle` = nome lead;
   - altrimenti se c'è un mio blocco → `state:'bloccato'`, `subtitle` = `'Follow-up: <lead>'` o `'Bloccato'`;
   - altrimenti se lo slot è fra i miei → `state:'disponibile'`;
   - altrimenti `state:'libero'`.
   - `badge` = numero di colleghi disponibili in quello slot (`coverage.available.length` meno me stesso se presente), mostrato solo se > 0.
   - `tone` = `coverage.status` dello slot.
   - Click su una cella modificabile: alterna `disponibile`/`libero` in uno stato locale `selected: Set<string>`; su cella `occupato` o `bloccato` non fa nulla.
   - Bottone **Salva** attivo solo se `selected` differisce dallo stato salvato; chiama `saveCalendarWeek` e poi ricarica via `getCalendarWeek`. Etichetta con il conteggio: `"Salva (28 ore)"`.
   - Menu per slot (click destro o bottone "⋯" visibile sulle celle disponibili future): `"Blocca per imprevisto"` → `blockSlot`; sulle celle già bloccate manualmente: `"Sblocca"` → `unblockSlot`. L'errore tornato dall'action si mostra in un banner sotto la griglia, testuale e per intero: i messaggi di `blockRefusalMessage` sono già scritti per essere letti dall'utente.

5. **Vista "Copertura squadra"**: `SlotGrid` in `readOnly` dove ogni cella mostra `subtitle` = `"3 disp · ≈2,4"` e `title` (tooltip) con i nomi da `venditori`. Sotto la griglia, il riquadro **"Fasce scoperte questa settimana"**: elenco delle celle `rosso` e `ambra` in ordine cronologico, formato `"Giovedì 17 alle 20:00 — nessuno disponibile, ≈2,4 attesi"`. Se non ce ne sono: `"Nessuna fascia scoperta."`.

Numeri: `expectedPeople` si mostra con una cifra decimale e la virgola (`toLocaleString('it-IT', { maximumFractionDigits: 1 })`).

- [ ] **Step 5: Aggiungere la voce di menu**

In `src/components/Sidebar.tsx`, nel ramo `role === "VENDITORE"` (riga ~146):

```ts
            { name: "Il mio Calendario", href: "/mio-calendario", icon: CalendarClock },
```

fra "Dashboard Vendite" e "Portafoglio Clienti". Importare `CalendarClock` da `lucide-react` in cima al file.

- [ ] **Step 6: Verificare build e tipi**

Run: `npx tsc --noEmit && npm run build`
Expected: build pulita, nessun warning nuovo.

- [ ] **Step 7: Verifica manuale**

Avviare `npm run dev`, entrare con un account venditore di test, aprire `/mio-calendario`:
1. spuntare 5 slot, salvare, ricaricare la pagina: gli slot sono ancora spuntati e la striscia dice "compilato";
2. controllare con l'MCP Supabase: `select count(*) from "salesAvailabilitySlots" where "salesUserId" = '<id>'` → 5;
3. provare a bloccare uno slot che inizia fra meno di un'ora: il bottone è spento con il messaggio del preavviso;
4. passare a "Copertura squadra": la griglia si popola e le fasce scoperte sono elencate.

- [ ] **Step 8: Commit**

```bash
git add src/components/calendar src/app/\(dashboard\)/mio-calendario src/components/Sidebar.tsx
git commit -m "feat(calendario): pagina Il mio Calendario con griglia, blocchi e copertura squadra"
```

---

### Task 7: Blocchi automatici da follow-up

**Files:**
- Create: `src/lib/venditore/calendarBlocks.ts`
- Modify: `src/app/actions/venditoreActions.ts`
- Modify: `src/app/actions/confermeActions.ts` (percorso di riassegnazione venditore, riga ~604-626)

**Interfaces:**
- Consumes: `slotStartFor` (Task 1), tabella `salesSlotBlocks` (Task 2)
- Produces:
  - `syncFollowUpBlock(tx, params: { companyId: string; salesUserId: string; leadId: string; followUpAt: Date | null; actorId: string }): Promise<void>`
  - `releaseFollowUpBlock(tx, params: { leadId: string; salesUserId?: string }): Promise<void>`

Entrambe accettano una transazione Drizzle o `db`: si chiamano dentro le transazioni esistenti delle action, non dopo.

- [ ] **Step 1: Scrivere il modulo**

Creare `src/lib/venditore/calendarBlocks.ts`:

```ts
/**
 * Blocchi automatici del calendario a partire dai follow-up.
 *
 * Un follow-up fissato alle 18:00 occupa lo slot delle 18: le Conferme lo
 * vedono occupato e nessuno ci fissa sopra un appuntamento. Quando il follow-up
 * si sposta, il blocco si sposta; quando il lead va "In lavorazione" o riceve un
 * esito, il blocco cade.
 *
 * Il blocco si crea anche su uno slot che il venditore non aveva dichiarato:
 * disponibilità e occupazione sono due fatti distinti.
 */

import { salesSlotBlocks } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { slotStartFor } from './calendarSlots'

type Db = { insert: any; update: any; delete: any; select: any }

/**
 * Allinea il blocco FOLLOWUP di un lead alla sua data di follow-up.
 * `followUpAt` null, o fuori dalla griglia oraria, significa nessun blocco.
 */
export async function syncFollowUpBlock(tx: Db, params: {
    companyId: string
    salesUserId: string
    leadId: string
    followUpAt: Date | null
    actorId: string
}): Promise<void> {
    const slot = params.followUpAt ? slotStartFor(params.followUpAt) : null
    if (!slot) {
        await releaseFollowUpBlock(tx, { leadId: params.leadId })
        return
    }
    // L'unique parziale (salesUserId, leadId) where kind='FOLLOWUP' garantisce
    // che un lead tenga un solo slot: qui si aggiorna, non si accumula.
    const updated = await tx.update(salesSlotBlocks)
        .set({ slotStart: slot, salesUserId: params.salesUserId })
        .where(and(
            eq(salesSlotBlocks.leadId, params.leadId),
            eq(salesSlotBlocks.kind, 'FOLLOWUP'),
        ))
        .returning({ id: salesSlotBlocks.id })

    if (updated.length === 0) {
        await tx.insert(salesSlotBlocks).values({
            id: crypto.randomUUID(),
            companyId: params.companyId,
            salesUserId: params.salesUserId,
            slotStart: slot,
            kind: 'FOLLOWUP',
            leadId: params.leadId,
            createdBy: params.actorId,
        }).onConflictDoNothing()
    }
}

/** Toglie il blocco follow-up di un lead (esito registrato, park, riassegnazione). */
export async function releaseFollowUpBlock(tx: Db, params: {
    leadId: string
    salesUserId?: string
}): Promise<void> {
    const conds = [
        eq(salesSlotBlocks.leadId, params.leadId),
        eq(salesSlotBlocks.kind, 'FOLLOWUP'),
    ]
    if (params.salesUserId) conds.push(eq(salesSlotBlocks.salesUserId, params.salesUserId))
    await tx.delete(salesSlotBlocks).where(and(...conds))
}
```

- [ ] **Step 2: Innestare in `rescheduleFollowUp`**

In `src/app/actions/venditoreActions.ts`, dentro la transazione di `rescheduleFollowUp` (riga ~565, subito dopo l'`update` di `salesAttempts`), aggiungere:

```ts
        await syncFollowUpBlock(tx, {
            companyId: ctx.companyId,
            salesUserId: lead.salespersonUserId!,
            leadId,
            followUpAt: newDate,
            actorId: userId,
        })
```

Importare `syncFollowUpBlock` e `releaseFollowUpBlock` in cima al file.

- [ ] **Step 3: Innestare in `parkLead`**

Dentro la transazione di `parkLead` (riga ~603 e seguenti), dopo l'update del lead:

```ts
        // "In lavorazione" = nessuna data precisa: lo slot torna libero.
        await releaseFollowUpBlock(tx, { leadId })
```

- [ ] **Step 4: Innestare in `saveVenditoreOutcome`**

Nella transazione di `saveVenditoreOutcome` (riga ~335, dove "qualunque esito toglie il lead da In lavorazione"), aggiungere dopo la scrittura dell'esito:

```ts
        // Esito registrato: il vecchio slot si libera. Se l'esito fissa un nuovo
        // follow-up, syncFollowUpBlock lo riaggancia allo slot nuovo.
        await syncFollowUpBlock(tx, {
            companyId: ctx.companyId,
            salesUserId: lead.salespersonUserId!,
            leadId,
            followUpAt: nextFollowUpDate ?? null,
            actorId: userId,
        })
```

Usare il nome della variabile locale che in quella funzione contiene la data del prossimo follow-up; se l'esito non ne prevede, passare `null`.

- [ ] **Step 5: Innestare nella riassegnazione venditore**

In `src/app/actions/confermeActions.ts`, dove si rileva il cambio di venditore (riga 604: `salespersonAssigned !== oldLead.salespersonUserId`), nel blocco che già azzera esito e follow-up del precedente, aggiungere:

```ts
            await releaseFollowUpBlock(tx, { leadId, salesUserId: oldLead.salespersonUserId! })
```

- [ ] **Step 6: Verificare i tipi e la build**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 7: Verifica manuale end-to-end**

Con un account venditore di test:
1. fissare un follow-up a domani alle 16:00;
2. `select * from "salesSlotBlocks" where "leadId" = '<id>'` → una riga `FOLLOWUP` con `slotStart` = domani 16:00;
3. spostare il follow-up alle 18:00 → la stessa riga ha ora `slotStart` = 18:00 (non due righe);
4. mettere il lead "In lavorazione" → zero righe;
5. su `/mio-calendario` lo slot delle 18:00 risulta bloccato con il nome del lead, poi torna libero.

- [ ] **Step 8: Commit**

```bash
git add src/lib/venditore/calendarBlocks.ts src/app/actions/venditoreActions.ts src/app/actions/confermeActions.ts
git commit -m "feat(calendario): i follow-up bloccano e liberano lo slot in automatico"
```

---

### Task 8: Cron settimanale — multe e promemoria

**Files:**
- Create: `src/lib/venditore/calendarRunner.ts`
- Modify: `src/lib/venditore/latePenaltiesRunner.ts`
- Modify: `src/app/api/cron/sales-late-penalties/route.ts`

**Interfaces:**
- Consumes: `selectMissingCalendarPenalties`, `calendarRuleState` (Task 3); `weekStartFor`, `weeklyDeadline` (Task 1)
- Produces:
  - `runCalendarWeekly(now?: Date): Promise<{ registered: number; reminders: number; skipped: string | null }>`

- [ ] **Step 1: Correggere il filtro per `kind` nel runner esistente**

In `src/lib/venditore/latePenaltiesRunner.ts`:

1. in `existingKeys`, aggiungere il filtro di tipo alla `where`:

```ts
    }).from(salesLatePenalties).where(and(
        inArray(salesLatePenalties.leadId, leadIds),
        inArray(salesLatePenalties.kind, ['APPOINTMENT', 'FOLLOWUP']),
    ))
```

e mappare con `leadId: r.leadId!` — ora la colonna è nullable ma queste righe hanno sempre il lead.

2. in `resolveLatePenalties`, aggiungere lo stesso filtro: senza, registrare un esito su un lead marcherebbe `resolvedAt` anche sulla multa `ABSENT_SLOT` di quel lead, che non ha niente a che vedere con i ritardi.

```ts
        .where(and(
            eq(salesLatePenalties.leadId, leadId),
            inArray(salesLatePenalties.kind, ['APPOINTMENT', 'FOLLOWUP']),
            isNull(salesLatePenalties.resolvedAt),
        ))
```

- [ ] **Step 2: Scrivere il runner del calendario**

Creare `src/lib/venditore/calendarRunner.ts`:

```ts
/**
 * Giro settimanale del calendario: multa chi non ha compilato e manda i due
 * promemoria del lunedì.
 *
 * Gira dentro il cron dei ritardi (ogni 30 minuti). Il controllo è "il lunedì
 * di questa settimana è già passato?", non "oggi è lunedì": così se il cron
 * salta il pomeriggio di lunedì la multa arriva comunque, sempre datata
 * lunedì 14:00.
 */

import { db } from '@/db'
import { users, salesWeekPlans, salesLatePenalties, notifications } from '@/db/schema'
import { and, eq, inArray, isNull, gte } from 'drizzle-orm'
import { toRomeDateStr } from '../dateUtils'
import { weekStartFor, weeklyDeadline, romeHour, romeDow } from './calendarSlots'
import { selectMissingCalendarPenalties, calendarRuleState, type CalendarUserRow } from './calendarRules'

export interface CalendarRunnerResult {
    registered: number
    reminders: number
    skipped: string | null
}

/** Ore italiane in cui parte un promemoria del lunedì. */
const REMINDER_HOURS = [10, 13]

export async function runCalendarWeekly(now: Date = new Date()): Promise<CalendarRunnerResult> {
    const state = calendarRuleState()
    if (!state.active) {
        return { registered: 0, reminders: 0, skipped: state.reason }
    }

    const weekStart = weekStartFor(now)
    const weekKey = toRomeDateStr(weekStart)

    const venditori: CalendarUserRow[] = (await db.select({
        id: users.id,
        companyId: users.companyId,
        isActive: users.isActive,
        calendarExempt: users.calendarExempt,
    }).from(users).where(eq(users.role, 'VENDITORE')))

    const plans = await db.select({ salesUserId: salesWeekPlans.salesUserId })
        .from(salesWeekPlans)
        .where(eq(salesWeekPlans.weekStart, weekKey))
    const submitted = new Set(plans.map(p => p.salesUserId))

    const pending = selectMissingCalendarPenalties(venditori, submitted, weekStart, now, state.from)

    let registered = 0
    if (pending.length > 0) {
        // onConflictDoNothing + unique parziale (salesUserId, kind, dueAt):
        // il cron può girare venti volte, la multa resta una.
        const inserted = await db.insert(salesLatePenalties).values(pending.map(p => ({
            id: crypto.randomUUID(),
            companyId: p.companyId,
            salesUserId: p.salesUserId,
            leadId: null,
            kind: p.kind,
            dueAt: p.dueAt,
            detectedAt: now,
            amountEur: p.amountEur,
            monthKey: p.monthKey,
            note: `Calendario della settimana del ${weekKey} non compilato entro lunedì 14:00.`,
        }))).onConflictDoNothing().returning({ id: salesLatePenalties.id, salesUserId: salesLatePenalties.salesUserId })
        registered = inserted.length

        for (const row of inserted) {
            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: row.salesUserId,
                type: 'calendar_penalty',
                title: 'Multa: calendario non compilato',
                body: `Non hai compilato le disponibilità entro lunedì 14:00: trattenuta di 50 €. Puoi compilare comunque.`,
                metadata: { weekStart: weekKey },
                companyId: venditori.find(v => v.id === row.salesUserId)?.companyId ?? 'fenice',
            })
        }
    }

    const reminders = await sendMondayReminders(now, weekStart, weekKey, venditori, submitted)
    return { registered, reminders, skipped: null }
}

/**
 * Promemoria delle 10 e delle 13 del lunedì a chi non ha ancora compilato.
 * Idempotenti: si guarda se esiste già una notifica dello stesso tipo per quella
 * settimana e quella fascia.
 */
async function sendMondayReminders(
    now: Date,
    weekStart: Date,
    weekKey: string,
    venditori: CalendarUserRow[],
    submitted: Set<string>,
): Promise<number> {
    if (romeDow(now) !== 1) return 0
    const hour = romeHour(now)
    const slot = REMINDER_HOURS.find(h => hour === h)
    if (slot === undefined) return 0
    if (now >= weeklyDeadline(weekStart)) return 0

    const target = venditori.filter(v => v.isActive && !v.calendarExempt && !submitted.has(v.id))
    if (target.length === 0) return 0

    const already = await db.select({
        recipientUserId: notifications.recipientUserId,
        metadata: notifications.metadata,
    }).from(notifications).where(and(
        eq(notifications.type, 'calendar_reminder'),
        inArray(notifications.recipientUserId, target.map(t => t.id)),
        gte(notifications.createdAt, weekStart),
    ))
    const done = new Set(
        already
            .filter(a => (a.metadata as any)?.slot === slot && (a.metadata as any)?.weekStart === weekKey)
            .map(a => a.recipientUserId),
    )

    const da = target.filter(t => !done.has(t.id))
    if (da.length === 0) return 0

    await db.insert(notifications).values(da.map(t => ({
        id: crypto.randomUUID(),
        recipientUserId: t.id,
        type: 'calendar_reminder',
        title: 'Calendario da compilare',
        body: slot === 10
            ? 'Ricordati di dichiarare le tue disponibilità della settimana: scadenza oggi alle 14:00.'
            : 'Ultimo avviso: mancano meno di due ore alla scadenza delle 14:00. Senza calendario scatta la multa da 50 €.',
        metadata: { weekStart: weekKey, slot },
        companyId: t.companyId,
    })))

    return da.length
}
```

- [ ] **Step 3: Chiamare il runner dal cron**

In `src/app/api/cron/sales-late-penalties/route.ts`, sostituire il finale della `GET`:

```ts
    const result = await runLatePenalties();
    // Il giro del calendario ha kill-switch e attivazione propri: gira anche
    // quando i ritardi sono sospesi, e viceversa.
    const calendar = await runCalendarWeekly();
    return NextResponse.json({ ...result, calendar });
```

Attenzione: i due `return` anticipati per il kill-switch dei ritardi (righe 22-29) devono comunque far girare il calendario. Ristrutturare così:

```ts
    const calendar = await runCalendarWeekly();

    if (process.env.SALES_LATE_PENALTIES === 'off') {
        return NextResponse.json({ skipped: true, reason: 'kill_switch_off', calendar });
    }
    if (!activationDate()) {
        return NextResponse.json({ skipped: true, reason: 'missing_activation_date', calendar });
    }

    const result = await runLatePenalties();
    return NextResponse.json({ ...result, calendar });
```

- [ ] **Step 4: Verificare i tipi e la suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Verifica manuale del cron in locale**

Con `npm run dev` attivo e `.env` che contiene `CRON_SECRET`, `SALES_CALENDAR_PENALTIES_FROM=2026-09-01T00:00:00+02:00`:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sales-late-penalties
```

Expected: JSON con `calendar: { registered: N, reminders: M, skipped: null }`. Rilanciare subito: `registered` deve tornare `0` (idempotenza). Verificare poi con l'MCP Supabase:

```sql
select "salesUserId", kind, "dueAt", "amountEur" from "salesLatePenalties"
where kind = 'CALENDAR_MISSING' order by "dueAt" desc limit 10;
```

Nessuna riga deve avere `salesUserId` di un venditore con `calendarExempt = true`.

- [ ] **Step 6: Ripulire i dati di prova**

```sql
delete from "salesLatePenalties" where kind = 'CALENDAR_MISSING';
delete from notifications where type in ('calendar_reminder','calendar_penalty');
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/venditore/calendarRunner.ts src/lib/venditore/latePenaltiesRunner.ts src/app/api/cron/sales-late-penalties/route.ts
git commit -m "feat(calendario): multa del lunedì e promemoria dentro il cron esistente"
```

---

### Task 9: Superficie Conferme — copertura e segnalazione assenza

**Files:**
- Create: `src/app/actions/salesCalendarAdminActions.ts`
- Modify: `src/app/actions/confermeActions.ts` (`getVenditoriAgenda`, riga 1592)
- Modify: `src/components/VenditoriAgendaModal.tsx`

**Interfaces:**
- Consumes: `absenceReportCheck`, `absenceRefusalMessage`, `CALENDAR_PENALTY_EUR` (Task 3); `slotStartFor`, `slotKey`, `weekSlots` (Task 1); `buildCoverage` (Task 4)
- Produces:
  - `reportSalesAbsence(salesUserId: string, slotIso: string, note?: string): Promise<{ success: boolean; error?: string }>`
  - `getVenditoriAgenda` arricchita: ogni venditore guadagna `declaredSlots: string[]` (slotKey) e `blockedSlots: string[]`; la risposta guadagna `coverage: CoverageCell[]` e `reportedSlots: string[]` (`'<salesUserId>|<slotKey>'` già segnalati)

- [ ] **Step 1: Scrivere `reportSalesAbsence`**

Creare `src/app/actions/salesCalendarAdminActions.ts` con questa prima funzione:

```ts
"use server"

import { db } from "@/db"
import { leads, users, salesAvailabilitySlots, salesSlotBlocks, salesLatePenalties, notifications } from "@/db/schema"
import { and, eq, gte, lt } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { slotStartFor, slotLabel } from "@/lib/venditore/calendarSlots"
import { absenceReportCheck, absenceRefusalMessage, CALENDAR_PENALTY_EUR } from "@/lib/venditore/calendarRules"
import { romeMonthKey } from "@/lib/venditore/latePenalties"
import { formatRomeAppointmentLabel } from "@/lib/dateUtils"
import { revalidatePath } from "next/cache"

/**
 * "Il venditore aveva lo slot libero e non c'era": multa da 50 €, subito.
 * L'admin può annullarla (voidCalendarPenalty): attrito zero per chi segnala,
 * controllo a posteriori per chi decide.
 */
export async function reportSalesAbsence(
    salesUserId: string,
    slotIso: string,
    note?: string,
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !role || !["CONFERME", "ADMIN"].includes(role)) {
        return { success: false, error: "Non autorizzato." }
    }
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const slot = slotStartFor(new Date(slotIso))
    if (!slot) return { success: false, error: "Ora fuori dal calendario." }
    const slotEnd = new Date(slot.getTime() + 3_600_000)

    const [venditore] = await db.select({ calendarExempt: users.calendarExempt, name: users.name })
        .from(users).where(eq(users.id, salesUserId))
    if (!venditore) return { success: false, error: "Venditore non trovato." }

    const [declared] = await db.select({ id: salesAvailabilitySlots.id })
        .from(salesAvailabilitySlots).where(and(
            eq(salesAvailabilitySlots.salesUserId, salesUserId),
            eq(salesAvailabilitySlots.slotStart, slot),
        ))
    const [blocked] = await db.select({ id: salesSlotBlocks.id })
        .from(salesSlotBlocks).where(and(
            eq(salesSlotBlocks.salesUserId, salesUserId),
            eq(salesSlotBlocks.slotStart, slot),
        ))
    const [reported] = await db.select({ id: salesLatePenalties.id })
        .from(salesLatePenalties).where(and(
            eq(salesLatePenalties.salesUserId, salesUserId),
            eq(salesLatePenalties.kind, 'ABSENT_SLOT'),
            eq(salesLatePenalties.dueAt, slot),
        ))

    const decision = absenceReportCheck({
        slotStart: slot,
        now: new Date(),
        declared: !!declared,
        blocked: !!blocked,
        exempt: venditore.calendarExempt,
        alreadyReported: !!reported,
    })
    if (!decision.ok) return { success: false, error: absenceRefusalMessage(decision.reason) }

    // Il lead dell'eventuale appuntamento in quello slot: serve a chi legge la
    // multa per capire quale appuntamento è saltato.
    const [appuntamento] = await db.select({ id: leads.id })
        .from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, salesUserId),
            gte(leads.appointmentDate, slot),
            lt(leads.appointmentDate, slotEnd),
        ))

    await db.insert(salesLatePenalties).values({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        salesUserId,
        leadId: appuntamento?.id ?? null,
        kind: 'ABSENT_SLOT',
        dueAt: slot,
        detectedAt: new Date(),
        amountEur: CALENDAR_PENALTY_EUR,
        monthKey: romeMonthKey(slot),
        reportedBy: user.id,
        note: note || null,
    }).onConflictDoNothing()

    await db.insert(notifications).values({
        id: crypto.randomUUID(),
        recipientUserId: salesUserId,
        type: 'calendar_penalty',
        title: 'Multa: assenza su slot disponibile',
        body: `Segnalata assenza ${formatRomeAppointmentLabel(slot)}: trattenuta di ${CALENDAR_PENALTY_EUR} €.`,
        metadata: { slot: slot.toISOString() },
        companyId: ctx.companyId,
    })

    revalidatePath('/conferme')
    revalidatePath('/calendari-venditori')
    return { success: true }
}
```

- [ ] **Step 2: Arricchire `getVenditoriAgenda`**

In `src/app/actions/confermeActions.ts`, dentro `getVenditoriAgenda` (riga 1592):

1. leggere disponibilità e blocchi nell'intervallo richiesto, filtrati per `companyId`;
2. aggiungere a ogni venditore `declaredSlots: string[]` e `blockedSlots: string[]` (chiavi `slotKey`);
3. aggiungere alla risposta `coverage: CoverageCell[]` calcolata con `buildCoverage` sugli slot della settimana richiesta, e `reportedSlots: string[]` con le chiavi `'<salesUserId>|<slotKey>'` delle `ABSENT_SLOT` non annullate nell'intervallo.

Aggiornare il tipo di ritorno dichiarato della funzione di conseguenza.

- [ ] **Step 3: Aggiornare il modal**

In `src/components/VenditoriAgendaModal.tsx`:

1. **Riga di copertura** in cima a ogni giornata, prima della lista degli appuntamenti: tre pastiglie `9–13`, `14–17`, `18–21` con il numero di venditori disponibili (minimo fra gli slot della fascia, che è il dato onesto: "in quella fascia c'è sempre almeno N"). Colore: rosso se 0, ambra se sotto la media attesa della fascia, altrimenti neutro. `title` con i nomi.

2. **Slot non dichiarati**: negli appuntamenti già presenti, se lo slot dell'appuntamento non è fra i `declaredSlots` del venditore, mostrare una pastiglia ambra `Fuori disponibilità` con `title` "Il venditore non aveva dichiarato quest'ora: questo slot non può generare multa."

3. **Bottone "Non c'era"**: su ogni appuntamento il cui slot è già iniziato, e in fondo a ogni giornata passata un elenco degli slot dichiarati e vuoti con lo stesso bottone. Il bottone chiama `reportSalesAbsence(venditore.id, slotIso)`; su successo ricarica l'agenda; su errore mostra il messaggio tornato. Disabilitato (con `title` = messaggio) quando `reportedSlots` contiene già la chiave.

   Prima di registrare, una conferma inline (non `window.confirm`, che blocca l'estensione e non è nello stile del progetto): il bottone diventa `Confermi? 50 €` e va premuto una seconda volta entro 5 secondi.

- [ ] **Step 4: Verificare build e tipi**

Run: `npx tsc --noEmit && npm run build`
Expected: pulito.

- [ ] **Step 5: Verifica manuale**

Da un account Conferme di test, con un venditore che ha dichiarato ieri alle 15:00:
1. aprire l'agenda venditori, andare a ieri: la riga di copertura mostra i numeri;
2. premere "Non c'era" sullo slot delle 15:00, confermare: compare la multa;
3. ripremere: il bottone è spento con "Assenza già segnalata per questo slot";
4. provare su uno slot non dichiarato: bottone spento con il messaggio giusto;
5. verificare con l'MCP Supabase che esista **una** sola riga `ABSENT_SLOT`.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/salesCalendarAdminActions.ts src/app/actions/confermeActions.ts src/components/VenditoriAgendaModal.tsx
git commit -m "feat(calendario): le Conferme vedono la copertura e segnalano le assenze"
```

---

### Task 10: Supervisione — `/calendari-venditori`

**Files:**
- Modify: `src/app/actions/salesCalendarAdminActions.ts` (tre funzioni in più)
- Create: `src/app/(dashboard)/calendari-venditori/page.tsx`
- Create: `src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `getCalendarWeek`/`weekCoverage` (Task 5), `SlotGrid` (Task 6)
- Produces:
  - `getCalendarSupervision(weekStartIso?: string, monthKey?: string): Promise<SupervisionView>`
  - `voidCalendarPenalty(penaltyId: string, reason: string): Promise<{ success: boolean; error?: string }>`
  - `setCalendarExempt(salesUserId: string, exempt: boolean): Promise<{ success: boolean; error?: string }>`
  - `interface SupervisionView { weekStartIso, coverage: CoverageCell[], venditori: Array<{id,name,calendarExempt}>, matrix: Array<{ salesUserId, slotKeys: string[] }>, compilation: Array<{ salesUserId, submittedAtIso, slotCount, late, penalised }>, penalties: Array<{ id, salesUserId, kind, dueAt, amountEur, note, reportedByName, voidedAtIso, voidReason, leadName }>, monthKey, totalEur }`

- [ ] **Step 1: Aggiungere le tre funzioni alle action admin**

In `src/app/actions/salesCalendarAdminActions.ts`:

- `requireCalendarSupervisor()` — ammette `ADMIN`, `MANAGER` in scrittura e `CONFERME` in sola lettura; torna `{ userId, role, canWrite: role === 'ADMIN', ctx }`. L'annullamento delle multe e l'esenzione sono di solo `ADMIN` (spec §7).
- `getCalendarSupervision(weekStartIso, monthKey)` — legge le quattro cose del tipo `SupervisionView`. Le multe sono quelle con `kind in ('CALENDAR_MISSING','ABSENT_SLOT')` del `monthKey` richiesto (default: mese corrente), con `leftJoin` su `leads` per il nome e un secondo `leftJoin` su `users` per `reportedByName`. `totalEur` somma solo le righe con `voidedAt` null.
- `voidCalendarPenalty(penaltyId, reason)` — solo `ADMIN`; `reason` vuoto → `{ success:false, error:'Serve un motivo.' }`; scrive `voidedAt`, `voidedBy`, `voidReason`; non cancella nulla.
- `setCalendarExempt(salesUserId, exempt)` — solo `ADMIN`; aggiorna `users.calendarExempt`.

- [ ] **Step 2: Creare la pagina server**

`src/app/(dashboard)/calendari-venditori/page.tsx`, stesso schema del Task 6 step 3, con guardia:

```tsx
    if (!user || !["ADMIN", "MANAGER", "CONFERME"].includes(role)) redirect("/")
```

- [ ] **Step 3: Creare il client con tre schede**

`src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx`, `"use client"`, tre schede (bottoni in un `<div>`, non `<span>`):

1. **Copertura** — `SlotGrid` in `readOnly` identica a quella del venditore (stesse celle, stessi colori), sopra il selettore settimana. Sotto, la **matrice venditore × slot**: una riga per venditore, 78 caselle piccole (6px) verdi/grigie, con il totale ore a destra. Serve a vedere a colpo d'occhio chi si accumula sulle stesse ore.

2. **Compilazione** — tabella: Venditore · Compilato · Quando · Ore dichiarate · Ritardo · Multa · Esente. `Compilato` è una pastiglia verde/rossa. `Esente` è uno switch che chiama `setCalendarExempt` (solo ADMIN; per gli altri è una pastiglia statica). Ordinamento: prima i non compilati.

3. **Multe calendario** — tabella con selettore mese: Venditore · Tipo · Quando · Segnalata da · Nota · Importo · Stato. Le righe annullate hanno `line-through` e mostrano il motivo. Bottone `Annulla` (solo ADMIN) che apre un campo motivo inline e chiama `voidCalendarPenalty`. In testa il totale del mese, che esclude le annullate.

Per `CONFERME` la terza scheda non si mostra (spec §6.2).

- [ ] **Step 4: Aggiungere le voci di menu**

In `src/components/Sidebar.tsx`:
- nel gruppo `Venditori` di ADMIN/MANAGER (riga ~230), dopo "Monitor Vendite": `{ name: "Calendari Venditori", href: "/calendari-venditori", icon: CalendarClock },`
- nel ramo `role === "CONFERME"` (riga ~126), dopo "Dashboard Conferme": `{ name: "Calendari Venditori", href: "/calendari-venditori", icon: CalendarClock },`

- [ ] **Step 5: Verificare build e tipi**

Run: `npx tsc --noEmit && npm run build`
Expected: pulito.

- [ ] **Step 6: Verifica manuale**

Da admin: aprire `/calendari-venditori`, controllare che le tre schede si aprano, che Sales 001 risulti esente, che l'annullamento di una multa la barri e abbassi il totale. Da un account Conferme: la terza scheda non c'è e gli switch sono statici.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/salesCalendarAdminActions.ts src/app/\(dashboard\)/calendari-venditori src/components/Sidebar.tsx
git commit -m "feat(calendario): supervisione con copertura, compilazione e multe annullabili"
```

---

### Task 11: Monitor Vendite — "Ritardi e multe"

**Files:**
- Modify: `src/app/actions/venditoriMonitorActions.ts`
- Modify: `src/app/(dashboard)/monitor-vendite/MonitorVenditeClient.tsx`

**Interfaces:**
- Consumes: tutto quanto sopra
- Produces: `latePenalties` con `kind` esteso, `amountEur`, `note`, `reportedByName`, `voidedAtIso`; `latePenaltySummary` che somma le quattro famiglie escludendo le annullate

- [ ] **Step 1: Correggere il join che nasconderebbe le multe senza lead**

In `src/app/actions/venditoriMonitorActions.ts` alla riga 173, `innerJoin` diventa `leftJoin`:

```ts
      .leftJoin(leads, eq(leads.id, salesLatePenalties.leadId))
```

Senza questa modifica le `CALENDAR_MISSING` (che non hanno lead) sparirebbero in silenzio dalla sezione: è esattamente il tipo di bug che non dà errori e che si scopre a fine mese contando i soldi.

- [ ] **Step 2: Isolare le chiavi dei ritardi**

Sempre in quel punto, `penalisedKeys` deve considerare solo i ritardi, perché serve a togliere le scadenze dalle liste operative:

```ts
    const penalisedKeys = new Set(penaltyRows
        .filter(r => r.leadId && (r.kind === 'APPOINTMENT' || r.kind === 'FOLLOWUP'))
        .map(r => penaltyKey({ leadId: r.leadId!, kind: r.kind as PenaltyKind, dueAt: r.dueAt })))
```

- [ ] **Step 3: Aggiungere i campi nuovi alla select e al sommario**

Alla `select` delle multe aggiungere `note`, `reportedBy`, `voidedAt`, `voidReason`, più un `leftJoin` su `users` per il nome di chi ha segnalato. Nel sommario del mese, escludere le annullate e separare i totali:

```ts
    const attive = penaltyRows.filter(r => !r.voidedAt && r.monthKey === penaltyMonthKey)
    const latePenaltySummary = {
        count: attive.length,
        totalEur: attive.reduce((s, r) => s + (r.amountEur || 0), 0),
        byKind: {
            APPOINTMENT: attive.filter(r => r.kind === 'APPOINTMENT').length,
            FOLLOWUP: attive.filter(r => r.kind === 'FOLLOWUP').length,
            CALENDAR_MISSING: attive.filter(r => r.kind === 'CALENDAR_MISSING').length,
            ABSENT_SLOT: attive.filter(r => r.kind === 'ABSENT_SLOT').length,
        },
    }
```

- [ ] **Step 4: Escludere le annullate dal badge del venditore**

In `getMyLatePenalties` (riga ~381) aggiungere `isNull(salesLatePenalties.voidedAt)` alla `where`: una multa annullata non deve continuare a pesare sul badge di chi l'ha ricevuta.

- [ ] **Step 5: Aggiornare la sezione nel client**

In `src/app/(dashboard)/monitor-vendite/MonitorVenditeClient.tsx`, sezione che inizia a riga 254:

- titolo da `Ritardi` a `Ritardi e multe`;
- sotto il titolo, quattro pastiglie con i conteggi per tipo (`Appuntamenti`, `Follow-up`, `Calendario`, `Assenze`), cliccabili come filtro;
- colonna `Tipo` con le quattro etichette italiane: `Appuntamento`, `Follow-up`, `Calendario non compilato`, `Assente allo slot`;
- colonna `Lead` mostra `—` quando `leadName` è null;
- colonna `Segnalata da` (vuota per le automatiche);
- righe annullate in `line-through text-ash-400` con `title` = motivo;
- il totale in testa somma i 10 € e i 50 € attivi.

- [ ] **Step 6: Verificare build, tipi e suite**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tutto pulito.

- [ ] **Step 7: Verifica manuale**

Da admin su `/monitor-vendite`: inserire a mano una `CALENDAR_MISSING` di prova con l'MCP Supabase, ricaricare, verificare che compaia con lead `—` e che il totale la includa; annullarla da `/calendari-venditori` e verificare che qui risulti barrata e fuori dal totale. Poi cancellare la riga di prova.

- [ ] **Step 8: Commit**

```bash
git add src/app/actions/venditoriMonitorActions.ts src/app/\(dashboard\)/monitor-vendite/MonitorVenditeClient.tsx
git commit -m "feat(calendario): il Monitor Vendite mostra ritardi e multe in un registro unico"
```

---

### Task 12: Verifica finale e attivazione

**Files:** nessuno nuovo.

- [ ] **Step 1: Suite completa e build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tutto verde. Nessun warning nuovo in build.

- [ ] **Step 2: Giro manuale sui tre ruoli**

Con `npm run dev`, sulla settimana corrente:

1. **Venditore**: compila, salva, blocca uno slot a più di un'ora, prova a bloccarne uno a meno di un'ora (rifiutato), prova a bloccare uno slot con appuntamento (rifiutato con il messaggio delle Conferme), apre "Copertura squadra" e vede le fasce scoperte.
2. **Conferme**: apre l'agenda, vede la riga di copertura, segnala un'assenza su uno slot passato e dichiarato, riprova (bloccato).
3. **Admin**: apre `/calendari-venditori`, vede chi non ha compilato, annulla una multa con motivo, verifica che sparisca dai totali anche su `/monitor-vendite`.

- [ ] **Step 3: Verifica dei dati reali**

Con l'MCP Supabase:

```sql
select kind, count(*), sum("amountEur") from "salesLatePenalties"
where "voidedAt" is null group by kind;
select count(*) from "salesSlotBlocks" where kind = 'FOLLOWUP';
select "salesUserId", "weekStart", "slotCount", late from "salesWeekPlans" order by "weekStart" desc limit 10;
```

Controllare che non ci siano blocchi `FOLLOWUP` orfani (lead già esitati): 

```sql
select b.id from "salesSlotBlocks" b
join leads l on l.id = b."leadId"
where b.kind = 'FOLLOWUP' and l."salespersonOutcome" is not null and l."followUp1Date" is null;
```

Expected: zero righe.

- [ ] **Step 4: Ripulire i dati di prova e committare**

Cancellare eventuali righe di test create a mano, poi:

```bash
git status
git commit -am "chore(calendario): verifica finale" || true
```

- [ ] **Step 5: Deploy e attivazione (richiede l'ok del PO)**

1. `git push origin main` e attendere il deploy Vercel.
2. Applicare la migrazione 0034 sul DB di produzione (se non già applicata al Task 2).
3. **Non** impostare subito le env delle multe: la regola nasce spenta. Quando il PO dà l'ok, impostare su Vercel (progetto `crm-sales-fenice`, team `team_HQ6j7kWTKLK8Hw4Kfv2iElcj`):
   - `SALES_CALENDAR_PENALTIES_FROM` = il lunedì da cui la regola vale, formato ISO con offset (es. `2026-09-21T00:00:00+02:00`);
   - `SALES_CALENDAR_PENALTIES` non va impostata (serve solo per spegnere: `off`).
4. Ricordare al PO che finché quella env non è in produzione la sezione multe resta vuota **per progetto**, non per guasto — è la lezione del malus ritardi di settembre.

---

## Self-Review

**Copertura della spec:**

| Sezione spec | Task |
|---|---|
| §3.1 `salesAvailabilitySlots` | 2 |
| §3.2 `salesSlotBlocks` | 2 |
| §3.3 `salesWeekPlans` | 2 |
| §3.4 `salesLatePenalties` estesa + filtri `kind` | 2, 8, 11 |
| §3.5 `users.calendarExempt` | 2 |
| §4.1 slot | 1 |
| §4.2 disponibilità effettiva | 4 |
| §4.3 compilazione settimanale | 5, 6 |
| §4.4 blocco manuale | 3, 5, 6 |
| §4.5 blocco da follow-up | 7 |
| §4.6 multa calendario non compilato | 3, 8 |
| §4.7 multa assenza | 3, 9 |
| §4.8 annullamento | 10 |
| §5.1 copertura | 4, 6, 9, 10 |
| §5.2 stima affluenza | 4 |
| §6.1 `/mio-calendario` | 6 |
| §6.2 `/calendari-venditori` | 10 |
| §6.3 agenda Conferme | 9 |
| §6.4 Monitor Vendite | 11 |
| §6.5 notifiche | 8, 9 |
| §7 autorizzazioni | 5, 9, 10 |
| §8 casi limite | 1 (ora legale), 3 (regole), 7 (doppio follow-up), 12 (verifica) |
| §9 test | 1, 3, 4 |
| §10 fuori scope | — |

Nessuna sezione della spec resta senza task.

**Note di coerenza verificate:**
- `slotKey` ha la stessa forma (`'YYYY-MM-DD@HH'`) in tutti i task che la usano (1, 4, 5, 6, 9, 10).
- `CoverageCell` è definita una volta sola (Task 4) e importata da 6, 9, 10.
- `salesUserId` è il nome della colonna ovunque; `salespersonUserId` resta il nome sul lead — sono due cose diverse e non vanno confuse.
- I `kind` delle multe sono quattro stringhe fisse, scritte identiche in SQL (Task 2), regole (Task 3), runner (Task 8), action (Task 9) e UI (Task 11).
