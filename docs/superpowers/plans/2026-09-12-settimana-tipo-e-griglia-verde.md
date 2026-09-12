# Settimana tipo e griglia a default verde — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compilare il calendario diventa togliere le ore che non vanno bene invece di aggiungerle una a una, e chi ha un orario stabile lo imposta una volta sola come "settimana tipo" che vale da sé.

**Architecture:** Una tabella nuova tiene il modello settimanale di ogni venditore (giorno × ora). Il cron che gira già lo **materializza** in slot veri per le settimane non ancora compilate, così muro, copertura e multe continuano a leggere la stessa tabella di prima senza sapere nulla del modello. La griglia del venditore cambia default (verde) e il menu per cella diventa una scelta esplicita fra tre stati.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM su Supabase Postgres, Tailwind v4, test con `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md` — **va aggiornata dal Task 5**: la decisione "Basta aver salvato almeno una volta entro lunedì 14:00" cambia, e va documentata la settimana tipo.

## Global Constraints

- **Decisione del PO (opzione B, 2026-09-12): la settimana tipo vale da sola.** Chi ne ha una non prende più la multa del lunedì, perché le sue settimane risultano compilate in automatico. È voluto e non va mitigato con guardie di alcun tipo.
- **Il modello diventa slot veri.** Il muro sul fissaggio, la copertura e la multa da assenza leggono `salesAvailabilitySlots`: il modello non può restare virtuale. Ogni ora materializzata è una dichiarazione a tutti gli effetti, **multabile per assenza**. È corretto.
- **Una settimana già compilata a mano non si tocca mai**: il modello riempie solo le settimane senza riga in `salesWeekPlans`.
- **Le ore già passate non si materializzano e non si modificano**, coerente con la regola già in vigore in `saveCalendarWeek`.
- **Griglia: default verde.** Una cella non toccata è **disponibile**. Premendola diventa **rossa** = non disponibile. **Salva resta obbligatorio**: è il salvataggio a mettere in regola, non l'apertura della pagina.
- **Le tabelle del calendario sono per-utente, non per-azienda**: nessun filtro `companyId` nelle letture (romperebbe Serenamente, dove i venditori sono staff condiviso). La colonna resta in scrittura come provenienza.
- **Regola React del progetto (CLAUDE.md §4.1)**: i bottoni non possono MAI essere figli di `<span>` o `<p>`. Produce white screen in produzione.
- **Nessun `window.confirm`/`alert`/`prompt`**.
- **Fuso orario**: solo gli helper di `calendarSlots.ts`/`dateUtils.ts`, mai `getHours()`/`getDay()` locali.
- **Migrazioni**: SQL scritto a mano in `drizzle/migrations/`, applicato con l'MCP Supabase. `drizzle-kit generate` non è utilizzabile su questo progetto.
- **Test**: ogni `*.test.ts` nuovo va aggiunto allo script `test` in `package.json`.

---

## File Structure

**Nuovi:**
- `drizzle/migrations/0035_sales_week_template.sql`
- `src/lib/venditore/calendarTemplate.ts` — la regola pura: da modello a slot di una settimana.
- `src/lib/venditore/calendarTemplate.test.ts`
- `src/components/calendar/TemplateEditor.tsx` — l'editor della settimana tipo.

**Modificati:**
- `src/db/schema.ts` — tabella `salesWeekTemplateSlots`, colonna `fromTemplate` su `salesWeekPlans`.
- `src/app/actions/salesCalendarActions.ts` — lettura/scrittura del modello, default verde nel salvataggio.
- `src/lib/venditore/calendarRunner.ts` — materializzazione dentro il giro esistente.
- `src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx` — default verde, menu a tre stati, accesso all'editor.
- `src/components/calendar/SlotGrid.tsx` — il menu diventa una scelta fra tre stati.
- `src/app/actions/salesCalendarAdminActions.ts` + `CalendariVenditoriClient.tsx` — "a mano" vs "da settimana tipo" nella scheda Compilazione.
- `docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md`
- `package.json`

---

### Task 1: Il modello e la sua materializzazione (regola pura)

**Files:**
- Create: `src/lib/venditore/calendarTemplate.ts`, `src/lib/venditore/calendarTemplate.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `weekSlots`, `romeDow`, `romeHour`, `SLOT_HOURS`, `SLOT_DAYS` da `./calendarSlots`
- Produces:
  - `interface TemplateSlot { dow: number; hour: number }` (dow 1=lunedì … 6=sabato)
  - `templateKey(dow: number, hour: number): string`
  - `isValidTemplateSlot(s: TemplateSlot): boolean`
  - `slotsFromTemplate(template: TemplateSlot[], weekStart: Date, now: Date): Date[]` — gli istanti della settimana che il modello dichiara, **escluse le ore già passate**

- [ ] **Step 1: Scrivere il test che fallisce**

`src/lib/venditore/calendarTemplate.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotsFromTemplate, isValidTemplateSlot, templateKey } from './calendarTemplate'
import { slotKey } from './calendarSlots'

const LUN = new Date('2026-09-14T00:00:00+02:00')   // lunedì
const PRIMA = new Date('2026-09-13T12:00:00+02:00') // domenica: tutta la settimana e' futura

test('il modello si espande sugli stessi giorni di tutte le settimane', () => {
    // 15:00 il lunedi (1) e il mercoledi (3)
    const slots = slotsFromTemplate([{ dow: 1, hour: 15 }, { dow: 3, hour: 15 }], LUN, PRIMA)
    assert.deepEqual(slots.map(slotKey), ['2026-09-14@15', '2026-09-16@15'])
})

test('le ore gia passate non si materializzano', () => {
    // meta' settimana: martedi 16 alle 16:30
    const meta = new Date('2026-09-15T16:30:00+02:00')
    const slots = slotsFromTemplate(
        [{ dow: 1, hour: 15 }, { dow: 2, hour: 15 }, { dow: 2, hour: 18 }, { dow: 3, hour: 15 }],
        LUN, meta,
    )
    // lunedi 15 e martedi 15 sono passate; restano martedi 18 e mercoledi 15
    assert.deepEqual(slots.map(slotKey), ['2026-09-15@18', '2026-09-16@15'])
})

test('un modello vuoto non produce niente', () => {
    assert.deepEqual(slotsFromTemplate([], LUN, PRIMA), [])
})

test('le voci fuori griglia sono scartate, non esplodono', () => {
    const slots = slotsFromTemplate(
        [{ dow: 7, hour: 15 }, { dow: 1, hour: 22 }, { dow: 1, hour: 8 }, { dow: 1, hour: 15 }],
        LUN, PRIMA,
    )
    assert.deepEqual(slots.map(slotKey), ['2026-09-14@15'])
})

test('isValidTemplateSlot accetta solo la griglia 1-6 / 9-21', () => {
    assert.equal(isValidTemplateSlot({ dow: 1, hour: 9 }), true)
    assert.equal(isValidTemplateSlot({ dow: 6, hour: 21 }), true)
    assert.equal(isValidTemplateSlot({ dow: 7, hour: 15 }), false)
    assert.equal(isValidTemplateSlot({ dow: 0, hour: 15 }), false)
    assert.equal(isValidTemplateSlot({ dow: 1, hour: 22 }), false)
    assert.equal(isValidTemplateSlot({ dow: 1, hour: 8 }), false)
})

test('templateKey e stabile e leggibile', () => {
    assert.equal(templateKey(3, 15), '3@15')
})
```

- [ ] **Step 2: Verificare che fallisca**

Run: `node --import tsx --test src/lib/venditore/calendarTemplate.test.ts`
Expected: FAIL — `Cannot find module './calendarTemplate'`

- [ ] **Step 3: Implementare**

```ts
/**
 * La "settimana tipo" di un venditore: quali ore offre di solito.
 *
 * Decisione PO 2026-09-12 (opzione B): il modello vale da sé — le settimane di
 * chi ne ha uno risultano compilate in automatico, e quindi non producono la
 * multa del lunedì. Per far funzionare muro, copertura e multa da assenza senza
 * riscriverli, il modello non resta virtuale: viene MATERIALIZZATO in slot veri
 * dal giro di cron. Un'ora materializzata è una dichiarazione a tutti gli
 * effetti, multabile per assenza: è il senso della scelta, non un effetto
 * collaterale.
 *
 * Puro: nessun accesso al DB, `now` arriva da fuori.
 */

import { weekSlots, romeDow, romeHour, SLOT_FIRST_HOUR, SLOT_LAST_HOUR, SLOT_DAYS } from './calendarSlots'

/** dow: 1 = lunedì … 6 = sabato. La domenica non è compilabile. */
export interface TemplateSlot {
    dow: number
    hour: number
}

export function templateKey(dow: number, hour: number): string {
    return `${dow}@${hour}`
}

export function isValidTemplateSlot(s: TemplateSlot): boolean {
    return Number.isInteger(s.dow) && s.dow >= 1 && s.dow <= SLOT_DAYS
        && Number.isInteger(s.hour) && s.hour >= SLOT_FIRST_HOUR && s.hour <= SLOT_LAST_HOUR
}

/**
 * Gli istanti che il modello dichiara nella settimana data, escluse le ore già
 * trascorse: materializzare un'ora passata sarebbe una dichiarazione che nessuno
 * ha potuto onorare, e la regola "le ore passate non si modificano" la
 * renderebbe pure incancellabile.
 */
export function slotsFromTemplate(template: TemplateSlot[], weekStart: Date, now: Date): Date[] {
    const voluti = new Set(template.filter(isValidTemplateSlot).map(s => templateKey(s.dow, s.hour)))
    if (voluti.size === 0) return []
    return weekSlots(weekStart).filter(slot =>
        voluti.has(templateKey(romeDow(slot), romeHour(slot))) && slot > now,
    )
}
```

- [ ] **Step 4: Verificare che passi**

Run: `node --import tsx --test src/lib/venditore/calendarTemplate.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 5: Registrare il test e girare la suite**

Aggiungere ` src/lib/venditore/calendarTemplate.test.ts` allo script `test`.
Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/venditore/calendarTemplate.ts src/lib/venditore/calendarTemplate.test.ts package.json
git commit -m "feat(settimana-tipo): la regola che espande il modello in ore di una settimana"
```

---

### Task 2: Schema e migrazione

**Files:**
- Create: `drizzle/migrations/0035_sales_week_template.sql`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Scrivere la migrazione**

```sql
-- 0035: settimana tipo dei venditori (decisione PO 2026-09-12, opzione B).
--
-- Il modello e' per-utente come le altre tabelle del calendario: il calendario
-- di una persona e' suo, non dell'azienda su cui ha fatto login. companyId
-- resta come provenienza, non come filtro.
--
-- `fromTemplate` su salesWeekPlans distingue una settimana compilata a mano da
-- una materializzata dal modello: senza, la scheda Compilazione diventa un muro
-- di spunte verdi e si perde di vista chi si occupa davvero del proprio calendario.

create table if not exists public."salesWeekTemplateSlots" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "dow"         integer not null,
  "hour"        integer not null,
  "createdAt"   timestamptz not null default now()
);

create unique index if not exists "sales_week_template_uq"
  on public."salesWeekTemplateSlots" ("salesUserId", "dow", "hour");

alter table public."salesWeekPlans" add column if not exists "fromTemplate" boolean not null default false;

comment on table public."salesWeekTemplateSlots" is
  'Settimana tipo: le ore che un venditore offre di solito. Materializzata in salesAvailabilitySlots dal cron.';
comment on column public."salesWeekPlans"."fromTemplate" is
  'true = settimana compilata dal modello, non a mano.';
```

- [ ] **Step 2: Applicare la migrazione**

Con l'MCP Supabase `apply_migration`, project id `ncutwzsifzundikwllxp`, name `0035_sales_week_template`.

- [ ] **Step 3: Verificare**

```sql
select column_name, data_type from information_schema.columns
where table_name = 'salesWeekTemplateSlots' order by ordinal_position;
select column_name from information_schema.columns
where table_name = 'salesWeekPlans' and column_name = 'fromTemplate';
```

Expected: la tabella con le sei colonne, e `fromTemplate` presente.

- [ ] **Step 4: Aggiungere allo schema TS**

Dopo il blocco `salesWeekPlans`:

```ts
/**
 * Settimana tipo: le ore che un venditore offre di solito.
 * Materializzata in `salesAvailabilitySlots` dal giro di cron — vedi
 * `calendarTemplate.ts` per il perché non resta virtuale.
 */
export const salesWeekTemplateSlots = pgTable('salesWeekTemplateSlots', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // 1 = lunedì … 6 = sabato.
    dow: integer('dow').notNull(),
    hour: integer('hour').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => {
    return {
        templateUnique: uniqueIndex('sales_week_template_uq').on(table.salesUserId, table.dow, table.hour),
    };
});
```

e dentro `salesWeekPlans`, dopo `late`:

```ts
    // true = settimana compilata dal modello, non a mano.
    fromTemplate: boolean('fromTemplate').default(false).notNull(),
```

- [ ] **Step 5: Verificare i tipi**

Run: `npx tsc --noEmit` — Expected: zero errori.

- [ ] **Step 6: Commit**

```bash
git add drizzle/migrations/0035_sales_week_template.sql src/db/schema.ts
git commit -m "feat(settimana-tipo): tabella del modello e flag di provenienza sui piani settimanali"
```

---

### Task 3: Materializzazione nel cron

**Files:**
- Modify: `src/lib/venditore/calendarRunner.ts`

**Interfaces:**
- Produces: `materializeTemplates(now?: Date): Promise<{ weeks: number; slots: number }>`, chiamata da `runCalendarWeekly` **prima** del calcolo delle multe.

- [ ] **Step 1: Scrivere la funzione**

In `calendarRunner.ts`, una funzione nuova che, per ogni venditore `isActive` con almeno una riga di modello:

1. per la settimana corrente e le tre successive;
2. se **non** esiste già una riga `salesWeekPlans` per quella settimana (una settimana compilata a mano non si tocca **mai**);
3. calcola `slotsFromTemplate(template, weekStart, now)`;
4. se il risultato non è vuoto: inserisce gli slot con `onConflictDoNothing()` e scrive `salesWeekPlans` con `submittedAt = now`, `slotCount`, `late = false`, **`fromTemplate = true`**.

Nessun filtro `companyId` nelle letture delle tabelle del calendario; `companyId` in scrittura preso dall'utente.

**L'ordine conta**: `materializeTemplates` va chiamata **prima** di `selectMissingCalendarPenalties` dentro `runCalendarWeekly`, altrimenti il primo giro del lunedì dopo le 14 multerebbe qualcuno un istante prima di compilargli la settimana.

- [ ] **Step 2: Verificare**

Run: `npx tsc --noEmit && npm test`
Expected: pulito, suite verde.

- [ ] **Step 3: Verifica di sicurezza sui dati**

Con l'MCP Supabase, **sola lettura**:

```sql
select count(*) as piani_a_mano from "salesWeekPlans" where "fromTemplate" = false;
select count(*) as modelli from "salesWeekTemplateSlots";
```

Annotare i numeri nel report: dopo il primo giro del cron, i piani a mano non devono essere diminuiti.

- [ ] **Step 4: Commit**

```bash
git add src/lib/venditore/calendarRunner.ts
git commit -m "feat(settimana-tipo): il cron materializza il modello nelle settimane non compilate"
```

---

### Task 4: Le action del modello e il default verde

**Files:**
- Modify: `src/app/actions/salesCalendarActions.ts`

**Interfaces:**
- Produces:
  - `getMyTemplate(): Promise<TemplateSlot[]>`
  - `saveMyTemplate(slots: TemplateSlot[]): Promise<{ success: boolean; error?: string }>`
  - `clearMyTemplate(): Promise<{ success: boolean; error?: string }>`
  - `CalendarWeekView` guadagna `template: TemplateSlot[]` e `fromTemplate: boolean`

- [ ] **Step 1: Le tre action del modello**

Solo ruolo `VENDITORE`, solo il proprio modello. `saveMyTemplate` valida ogni voce con `isValidTemplateSlot` e scarta le altre; sostituisce in transazione (delete + insert). `try/catch` che torna la forma dichiarata, come le action sorelle del file.

**Dopo un salvataggio del modello**, materializzare subito le settimane future non ancora compilate dello stesso venditore, riusando la funzione del Task 3: altrimenti chi imposta il modello mercoledì non vede effetto fino al giro di cron successivo.

- [ ] **Step 2: Il default verde nel salvataggio**

`saveCalendarWeek` oggi riceve gli slot da dichiarare. Con il default verde la semantica non cambia — il client manda comunque l'elenco delle ore verdi — ma `getCalendarWeek` deve dire al client **da cosa partire** quando la settimana non è ancora stata compilata:

- se esiste una riga `salesWeekPlans` → `mySlots` come oggi (ciò che è stato salvato);
- se **non** esiste e il venditore ha un modello → `mySlots` = le ore del modello per quella settimana;
- se **non** esiste e non c'è modello → `mySlots` = **tutte** le ore future della settimana (il default verde).

Il campo `fromTemplate` della vista dice al client se la settimana è stata compilata dal modello.

**Attenzione**: `getCalendarWeek` non deve **scrivere** niente. Il pre-riempimento è una proposta al client, non una dichiarazione: finché il venditore non preme Salva, a DB non c'è nulla — è quello che tiene in piedi la differenza fra "compilato" e "non compilato" per chi non ha un modello.

- [ ] **Step 3: Verificare**

Run: `npx tsc --noEmit && npm test` — Expected: pulito.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/salesCalendarActions.ts
git commit -m "feat(settimana-tipo): action del modello e pre-riempimento della griglia"
```

---

### Task 5: La griglia verde, il menu a tre stati, l'editor

**Files:**
- Create: `src/components/calendar/TemplateEditor.tsx`
- Modify: `src/components/calendar/SlotGrid.tsx`, `src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx`
- Modify: `docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md`

- [ ] **Step 1: Il rosso e il verde**

Oggi lo stato `libero` (bianco) significa "non dichiarata". Con il default verde una cella non selezionata è una scelta esplicita: **rossa**, "non disponibile". Cambiare le classi dello stato `libero` in `SlotGrid.tsx` da bianco a rosso tenue (`bg-rose-50 border-rose-200 text-rose-700`) e aggiornare la legenda: **Disponibile** (verde) · **Non disponibile** (rosso) · **Occupato** (azzurro) · **Bloccato** (grigio).

- [ ] **Step 2: Il menu a tre stati**

Oggi il menu per cella è un'azione sola (blocca, o sblocca) e nei casi impossibili è un bottone spento con un `title` — che in Chrome sui bottoni disabilitati **non si vede**, difetto noto.

Sostituirlo con un menu che si apre e mostra tre voci, ciascuna con il suo stato (attiva o spenta **con la ragione scritta nel menu**, non in un tooltip):

- **Disponibile** — rende la cella verde
- **Imprevisto** — blocca lo slot (vale la regola dei 60 minuti e il rifiuto se c'è già un appuntamento)
- **Non disponibile** — rende la cella rossa

Quando una voce non è possibile, la riga del menu resta visibile con la spiegazione accanto: è la stessa filosofia del bottone spento, ma leggibile.

Il menu è un `<div>` con dentro `<button>`, mai dentro `<span>`/`<p>`. Si chiude cliccando fuori o con Esc.

- [ ] **Step 3: L'editor della settimana tipo**

`TemplateEditor.tsx`: una griglia 6 × 13 identica per forma a `SlotGrid` ma senza date — solo giorno della settimana e ora. Si spuntano le ore, si salva. Sopra, una riga che spiega: *"Vale ogni settimana. Le settimane che non hai ancora compilato si riempiono da sola."*

Azioni rapide: click sull'etichetta di un'ora seleziona/deseleziona l'intera riga (tutti i giorni); click sull'intestazione di un giorno fa lo stesso sulla colonna. È ciò che rende immediato *"solo 15, 16 e 19, tutti i giorni tranne sabato"*.

Un bottone "Cancella la settimana tipo" che chiama `clearMyTemplate`, con conferma **inline**.

L'editor si apre da `/mio-calendario` con un terzo pulsante accanto a "Il mio calendario" / "Copertura squadra".

- [ ] **Step 4: La striscia di stato**

Quando `fromTemplate` è vero, la striscia in cima dice che la settimana è stata compilata dalla settimana tipo e che si può modificare comunque — con un link all'editor.

- [ ] **Step 5: Aggiornare la spec**

Nella tabella §2: la riga *Soglia "compilato"* va corretta — chi ha una settimana tipo risulta compilato in automatico e non prende la multa del lunedì (decisione PO 2026-09-12, opzione B). Aggiungere una sezione breve sulla settimana tipo e sul default verde, con la stessa convenzione già usata per marcare i ripensamenti.

- [ ] **Step 6: Verificare**

Run: `npx tsc --noEmit && npm run build && npm test` — Expected: tutto pulito.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar "src/app/(dashboard)/mio-calendario" docs/superpowers/specs
git commit -m "feat(settimana-tipo): griglia a default verde, menu a tre stati, editor della settimana tipo"
```

---

### Task 6: "A mano" contro "da settimana tipo" in supervisione

**Files:**
- Modify: `src/app/actions/salesCalendarAdminActions.ts`, `src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx`

- [ ] **Step 1: Il campo**

`getCalendarSupervision` porta `fromTemplate` su ogni riga della scheda Compilazione.

- [ ] **Step 2: La colonna**

Nella scheda Compilazione, la pastiglia "Compilato" distingue **A mano** da **Da settimana tipo**. Chi è esente resta "Esente" come adesso.

- [ ] **Step 3: Verificare**

Run: `npx tsc --noEmit && npm run build && npm test` — Expected: pulito.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/salesCalendarAdminActions.ts "src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx"
git commit -m "feat(settimana-tipo): la supervisione distingue chi compila a mano da chi usa il modello"
```

---

### Task 7: Verifica finale

- [ ] **Step 1: Suite, tipi, build**

Run: `npm test && npx tsc --noEmit && npm run build` — Expected: tutto verde.

- [ ] **Step 2: Controlli sui dati**

```sql
select count(*) from "salesWeekTemplateSlots";
select "fromTemplate", count(*) from "salesWeekPlans" group by 1;
-- nessuno slot materializzato nel passato:
select count(*) from "salesAvailabilitySlots" where "slotStart" < now() - interval '1 day';
```

- [ ] **Step 3: Cosa resta da verificare a mano**

Scrivere l'elenco per il controller: impostare un modello e vedere le settimane future riempirsi; compilare a mano una settimana e verificare che il modello **non** la sovrascriva; il menu a tre stati su una cella libera, una occupata, una bloccata e una passata; il default verde alla prima apertura; la scheda Compilazione che distingue le due provenienze.

---

## Self-Review

| Requisito | Task |
|---|---|
| Default verde, rosso premendo, Salva obbligatorio | 4, 5 |
| Menu a tre stati con le ragioni leggibili | 5 |
| Settimana tipo con azioni rapide riga/colonna | 5 |
| Il modello vale da sé (opzione B) | 1, 3 |
| Le settimane compilate a mano non si toccano | 3 |
| Le ore passate non si materializzano | 1, 3 |
| La supervisione distingue le due provenienze | 2, 6 |
| Spec aggiornata | 5 |
