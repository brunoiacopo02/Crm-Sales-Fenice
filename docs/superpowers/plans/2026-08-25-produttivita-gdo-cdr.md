# Produttività GDO dai tabulati del centralino — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare i tabulati del centralino FreePBX dentro il CRM e mostrare, per ogni GDO, quanto tempo passa realmente al telefono, quanto tempo perde fra una chiamata e l'altra, e che qualità hanno gli appuntamenti che produce.

**Architecture:** I CSV esportati da FreePBX vengono normalizzati da un parser puro e caricati in una tabella `pbxCalls` con id = `uniqueid` del centralino (import idempotente). Una tabella di mappatura `pbxExtensions` lega ogni interno a un utente del CRM. Un modulo puro calcola le metriche giornaliere da una lista di chiamate; una server action le aggrega per la pagina `/monitor-pause`, riscritta a schede.

**Tech Stack:** Next.js App Router, Drizzle ORM su Supabase Postgres, `node --test` + `tsx` per i test, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-25-produttivita-gdo-design.md`

## Global Constraints

- **Fuso orario**: la giornata operativa è `Europe/Rome`. Ogni raggruppamento per giorno usa `dateLocal` (testo `YYYY-MM-DD`), mai `date_trunc` sul timestamp UTC. Pattern esistente: `getLocalDateRome()` in `src/lib/pauseUtils.ts`.
- **Migrazioni scritte a mano**: `drizzle-kit generate` è inutilizzabile su questo progetto. Il file SQL va scritto e applicato manualmente. Prossimo numero libero: **0028**.
- **Multi-tenant**: ogni tabella nuova ha `companyId text NOT NULL DEFAULT 'fenice' REFERENCES companies(id) ON UPDATE CASCADE`. Le query passano da `currentTenant()` / `companyScope()` di `src/lib/tenancy.ts`.
- **Disk IO**: il progetto ha già ricevuto due alert Supabase Disk IO Budget. Nessuna scrittura ricorrente ad alta frequenza; l'import è batch e idempotente.
- **Dati personali**: i CSV in `data/cdr/` contengono numeri di clienti e sono esclusi da git (`data/cdr/.gitignore`). Non committarli mai, non stamparli nei log.
- **Permessi pagina**: `/monitor-pause` è per `ADMIN`, `MANAGER`, `TL`. Non aggiungere voci di menu nuove e non mostrare nulla ai GDO: il tracciamento non deve essere percepibile.
- **Definizioni KPI**: appuntamenti, presenze e chiusure usano esclusivamente gli helper di `src/lib/kpi/canon.ts` (`apptSetAt`, `isPresenziato`, `isStatsGdo`). Non creare definizioni parallele.
- **Test**: ogni file `*.test.ts` nuovo va aggiunto alla lista dello script `test` in `package.json`, altrimenti non viene eseguito.
- **Mappatura interni**: la regola numerica `10XX`→`1XX` è **falsa**. La mappatura verificata è quella della Task 1 e va tenuta in tabella.

---

### Task 1: Schema e migrazione per i tabulati

**Files:**
- Modify: `src/db/schema.ts` (in fondo, dopo `crmDeals`)
- Create: `drizzle/migrations/0028_pbx_cdr.sql`

**Interfaces:**
- Consumes: niente (prima task)
- Produces: tabelle Drizzle `pbxCalls` e `pbxExtensions`, importabili da `@/db/schema`. Colonne di `pbxCalls`: `id, companyId, calldate, dateLocal, src, dstKey, duration, billsec, disposition, direction, userId`. Colonne di `pbxExtensions`: `extension, companyId, userId, label`.

- [ ] **Step 1: Aggiungere le due tabelle a `src/db/schema.ts`**

In fondo al file:

```ts
// Tabulati (CDR) del centralino FreePBX in ufficio, importati da CSV.
// `id` è l'uniqueid assegnato da Asterisk: rende l'import idempotente
// (ON CONFLICT DO NOTHING) e permette di ricaricare lo stesso file senza
// duplicare nulla. `dstKey` sono le ultime 10 cifre del numero chiamato,
// la chiave con cui si aggancia leads.phone.
export const pbxCalls = pgTable('pbxCalls', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    calldate: timestamp('calldate', { withTimezone: true, mode: 'date' }).notNull(),
    dateLocal: text('dateLocal').notNull(),
    src: text('src').notNull(),
    dstKey: text('dstKey'),
    duration: integer('duration').notNull(),
    billsec: integer('billsec').notNull(),
    disposition: text('disposition').notNull(),
    direction: text('direction').notNull(), // 'out' | 'in'
    userId: text('userId').references(() => users.id),
}, (table) => {
    return {
        userDayIdx: index('pbxcalls_user_day_idx').on(table.companyId, table.userId, table.dateLocal),
        dstKeyIdx: index('pbxcalls_dst_key_idx').on(table.dstKey),
    };
});

// Quale interno del centralino corrisponde a quale utente del CRM.
// NON è derivabile da una regola numerica (1007 = GDO 115, non 107):
// va mantenuta a mano quando cambia una postazione.
export const pbxExtensions = pgTable('pbxExtensions', {
    extension: text('extension').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    label: text('label'),
});
```

- [ ] **Step 2: Scrivere la migrazione `drizzle/migrations/0028_pbx_cdr.sql`**

```sql
CREATE TABLE IF NOT EXISTS "pbxCalls" (
    "id" text PRIMARY KEY NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "calldate" timestamp with time zone NOT NULL,
    "dateLocal" text NOT NULL,
    "src" text NOT NULL,
    "dstKey" text,
    "duration" integer NOT NULL,
    "billsec" integer NOT NULL,
    "disposition" text NOT NULL,
    "direction" text NOT NULL,
    "userId" text REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "pbxcalls_user_day_idx" ON "pbxCalls" ("companyId", "userId", "dateLocal");
CREATE INDEX IF NOT EXISTS "pbxcalls_dst_key_idx" ON "pbxCalls" ("dstKey");

CREATE TABLE IF NOT EXISTS "pbxExtensions" (
    "extension" text PRIMARY KEY NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "label" text
);
```

- [ ] **Step 3: Applicare la migrazione**

Applicare il contenuto del file via MCP Supabase `apply_migration` (name: `0028_pbx_cdr`) sul progetto `ncutwzsifzundikwllxp`.

- [ ] **Step 4: Verificare che le tabelle esistano**

Eseguire via MCP Supabase `execute_sql`:

```sql
select table_name, count(*) colonne from information_schema.columns
where table_name in ('pbxCalls','pbxExtensions') group by 1;
```

Atteso: due righe, `pbxCalls` con 11 colonne e `pbxExtensions` con 4.

- [ ] **Step 5: Popolare la mappatura interni**

Eseguire via MCP Supabase `execute_sql`. La mappatura è stata verificata incrociando i numeri chiamati con `leads.assignedToId` e confermata dal committente:

```sql
insert into "pbxExtensions" ("extension","companyId","userId","label")
select v.ext, 'fenice', u.id, v.nome
from (values
  ('1007','GDO 115','Clara'), ('1008','GDO 109','Giusy'), ('1009','GDO 107','Giulia'),
  ('1010','GDO 118','Fabio'), ('1014','GDO 106','Zora'),  ('1015','GDO 114','Christel'),
  ('1016','GDO 105','Karim'), ('1017','GDO 117','Simone'), ('1019','GDO 119','Riccardo'),
  ('1020','GDO 110','Alessandro'), ('1023','GDO 112', null)
) as v(ext, gdo, nome)
join users u on coalesce(u."displayName", u.name) = v.gdo and u."companyId" = 'fenice'
on conflict ("extension") do update set "userId" = excluded."userId", "label" = excluded."label";

select e.extension, e.label, coalesce(u."displayName",u.name) gdo
from "pbxExtensions" e join users u on u.id = e."userId" order by e.extension;
```

Atteso: 11 righe. Se ne risultano meno, un `displayName` non ha corrisposto: elencare i GDO con `select id, name, "displayName" from users where role='GDO'` e correggere i valori della `values`, non la logica.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/migrations/0028_pbx_cdr.sql
git commit -m "feat(pbx): tabelle pbxCalls e pbxExtensions per i tabulati del centralino"
```

---

### Task 2: Parser dei CSV FreePBX

**Files:**
- Create: `src/lib/cdr/parseCdr.ts`
- Test: `src/lib/cdr/parseCdr.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: niente
- Produces:
  - `export type CdrRow = { id: string; calldate: Date; dateLocal: string; src: string; dstKey: string | null; duration: number; billsec: number; disposition: string; direction: 'out' | 'in' }`
  - `export function parseCdrLine(rec: Record<string,string>): CdrRow | null` — `null` se la riga va scartata
  - `export function dstKeyOf(raw: string): string | null` — ultime 10 cifre, o `null`
  - `export function romeDateKey(d: Date): string` — `YYYY-MM-DD` in Europe/Rome

Le colonne del CSV FreePBX 17 sono: `calldate,clid,src,dst,dcontext,channel,dstchannel,lastapp,lastdata,duration,billsec,disposition,amaflags,accountcode,uniqueid,userfield,did,cnum,cnam,outbound_cnum,outbound_cnam,dst_cnam,recordingfile,linkedid,peeraccount,sequence`. `calldate` è nel formato `2026-03-10 11:34:58`, **ora locale italiana** (il centralino è in ufficio).

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `src/lib/cdr/parseCdr.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCdrLine, dstKeyOf, romeDateKey } from './parseCdr'

const base = {
    calldate: '2026-08-22 16:20:03', clid: '"1007" <1007>', src: '1007',
    dst: '3397605227', dcontext: 'from-internal', duration: '87', billsec: '62',
    disposition: 'ANSWERED', uniqueid: '1787408446.87752',
}

test('riconosce una chiamata in uscita da un interno', () => {
    const r = parseCdrLine(base as any)!
    assert.equal(r.id, '1787408446.87752')
    assert.equal(r.src, '1007')
    assert.equal(r.direction, 'out')
    assert.equal(r.dstKey, '3397605227')
    assert.equal(r.duration, 87)
    assert.equal(r.billsec, 62)
    assert.equal(r.dateLocal, '2026-08-22')
})

test('riconosce una chiamata in entrata verso un interno', () => {
    const r = parseCdrLine({ ...base, src: '393889341296', dst: '1010' } as any)!
    assert.equal(r.direction, 'in')
})

test('scarta le righe senza uniqueid', () => {
    assert.equal(parseCdrLine({ ...base, uniqueid: '' } as any), null)
})

test('scarta le righe interno-a-interno', () => {
    assert.equal(parseCdrLine({ ...base, src: '1007', dst: '1010' } as any), null)
})

test('dstKey prende le ultime 10 cifre e ignora prefissi e simboli', () => {
    assert.equal(dstKeyOf('+39 339 760 5227'), '3397605227')
    assert.equal(dstKeyOf('393397605227'), '3397605227')
    assert.equal(dstKeyOf('123'), null)
})

test('duration e billsec mancanti diventano zero', () => {
    const r = parseCdrLine({ ...base, duration: '', billsec: '' } as any)!
    assert.equal(r.duration, 0)
    assert.equal(r.billsec, 0)
})

test('romeDateKey usa il giorno italiano, non UTC', () => {
    // 2026-08-22 00:30 italiana = 2026-08-21 22:30 UTC
    assert.equal(romeDateKey(new Date('2026-08-21T22:30:00Z')), '2026-08-22')
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --import tsx --test src/lib/cdr/parseCdr.test.ts`
Atteso: FAIL, il modulo `./parseCdr` non esiste.

- [ ] **Step 3: Scrivere l'implementazione**

Creare `src/lib/cdr/parseCdr.ts`:

```ts
/**
 * Parser delle righe CSV esportate da FreePBX 17 (Reports -> CDR Reports,
 * Report Type = CSV File).
 *
 * Attenzione al fuso: `calldate` è già ora locale italiana perché il
 * centralino sta in ufficio. Va quindi interpretata come Europe/Rome e non
 * come UTC, altrimenti tutte le giornate slittano di 1-2 ore e le chiamate
 * serali finiscono nel giorno sbagliato.
 */

export type CdrRow = {
    id: string
    calldate: Date
    dateLocal: string
    src: string
    dstKey: string | null
    duration: number
    billsec: number
    disposition: string
    direction: 'out' | 'in'
}

/** Un interno del centralino: 3 o 4 cifre (1005..1023, 102, 103, 999). */
function isExtension(s: string): boolean {
    return /^\d{3,4}$/.test(s)
}

/** Ultime 10 cifre del numero: la chiave di aggancio con leads.phone. */
export function dstKeyOf(raw: string): string | null {
    const digits = (raw || '').replace(/\D/g, '')
    return digits.length >= 10 ? digits.slice(-10) : null
}

/** Giorno operativo italiano di un istante. */
export function romeDateKey(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

/**
 * "2026-08-22 16:20:03" (ora di Roma) -> Date corretta.
 * Si ricava l'offset confrontando l'istante interpretato come UTC con la
 * sua resa in Europe/Rome: funziona sia con l'ora solare sia con la legale.
 */
function parseRomeTimestamp(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s)
    if (!m) return null
    const [, y, mo, d, h, mi, se] = m
    const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)
    const probe = new Date(asUtc)
    const romeParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(probe).reduce<Record<string, string>>((a, p) => (a[p.type] = p.value, a), {})
    const romeAsUtc = Date.UTC(+romeParts.year, +romeParts.month - 1, +romeParts.day,
        +romeParts.hour % 24, +romeParts.minute, +romeParts.second)
    return new Date(asUtc - (romeAsUtc - asUtc))
}

export function parseCdrLine(rec: Record<string, string>): CdrRow | null {
    const id = (rec.uniqueid || '').trim()
    if (!id) return null

    const src = (rec.src || '').trim()
    const dst = (rec.dst || '').trim()
    if (!src || !dst) return null

    const srcIsExt = isExtension(src)
    const dstIsExt = isExtension(dst)
    // interno->interno: chiamate interne, non ci interessano
    if (srcIsExt && dstIsExt) return null
    if (!srcIsExt && !dstIsExt) return null

    const calldate = parseRomeTimestamp(rec.calldate || '')
    if (!calldate) return null

    const direction: 'out' | 'in' = srcIsExt ? 'out' : 'in'
    return {
        id,
        calldate,
        dateLocal: romeDateKey(calldate),
        src,
        dstKey: direction === 'out' ? dstKeyOf(dst) : dstKeyOf(src),
        duration: Number(rec.duration) || 0,
        billsec: Number(rec.billsec) || 0,
        disposition: (rec.disposition || '').trim(),
        direction,
    }
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --import tsx --test src/lib/cdr/parseCdr.test.ts`
Atteso: 7 test PASS.

- [ ] **Step 5: Registrare il test nello script `test`**

In `package.json`, aggiungere `src/lib/cdr/parseCdr.test.ts` in coda alla lista dello script `test`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cdr/parseCdr.ts src/lib/cdr/parseCdr.test.ts package.json
git commit -m "feat(cdr): parser delle righe CSV FreePBX con fuso Europe/Rome"
```

---

### Task 3: Metriche giornaliere da una lista di chiamate

**Files:**
- Create: `src/lib/cdr/dayMetrics.ts`
- Test: `src/lib/cdr/dayMetrics.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `CdrRow` da `src/lib/cdr/parseCdr.ts` (solo i campi `calldate`, `duration`, `billsec`, `disposition`)
- Produces:
  - `export type DayCall = { calldate: Date; duration: number; billsec: number; disposition: string }`
  - `export type GapBuckets = { under1m: number; m1to3: number; m3to10: number; m10to30: number; over30m: number }` — secondi totali per fascia
  - `export type DayMetrics = { calls: number; answered: number; talkSeconds: number; occupiedSeconds: number; windowSeconds: number; offPhoneSeconds: number; gaps: number[]; buckets: GapBuckets; firstAt: Date; lastAt: Date }`
  - `export function computeDayMetrics(calls: DayCall[]): DayMetrics | null` — `null` se la lista è vuota
  - `export function median(values: number[]): number`
  - `export function emptyBuckets(): GapBuckets`

**Perché le fasce sono obbligatorie e non un abbellimento**: il totale del tempo non telefonico mette sullo stesso piano chi ha un ritmo lento e chi si assenta, che sono due problemi diversi. Misurato su agosto, l'87% dei buchi sta sotto il minuto e vale solo il 24% del tempo (è la compilazione dell'esito, incomprimibile), mentre il 36% del tempo si concentra in 486 buchi da 10–30 minuti. Una pagina che mostrasse solo il totale porterebbe a conclusioni sbagliate sulle persone.

Definizioni (dalla spec, sezione 9):
- **finestra di turno** = dalla prima chiamata alla fine dell'ultima (`calldate + duration`)
- **tempo occupato** = somma delle `duration` (conversazione **più** squilli)
- **tempo al telefono** = somma dei `billsec` (solo conversazione)
- **tempo non telefonico** = finestra − tempo occupato
- **gap** = fra la fine di una chiamata e l'inizio della successiva; i gap negativi (chiamate sovrapposte) vanno **scartati**, non azzerati, perché indicano un dato anomalo

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `src/lib/cdr/dayMetrics.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDayMetrics, median } from './dayMetrics'

const at = (hhmm: string) => new Date(`2026-08-22T${hhmm}:00Z`)

test('lista vuota non produce metriche', () => {
    assert.equal(computeDayMetrics([]), null)
})

test('calcola finestra, tempo al telefono e tempo non telefonico', () => {
    // 13:00 dura 60s (30 di conversazione), 13:10 dura 120s (100 di conversazione)
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
        { calldate: at('13:10'), duration: 120, billsec: 100, disposition: 'ANSWERED' },
    ])!
    assert.equal(m.calls, 2)
    assert.equal(m.talkSeconds, 130)
    assert.equal(m.occupiedSeconds, 180)
    assert.equal(m.windowSeconds, 720)      // 13:00:00 -> 13:12:00
    assert.equal(m.offPhoneSeconds, 540)    // 720 - 180
})

test('il gap si misura dalla FINE della chiamata precedente', () => {
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
        { calldate: at('13:10'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
    ])!
    assert.deepEqual(m.gaps, [540])  // fine 13:01, inizio 13:10
})

test('scarta i gap negativi delle chiamate sovrapposte', () => {
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 600, billsec: 500, disposition: 'ANSWERED' },
        { calldate: at('13:05'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
    ])!
    assert.deepEqual(m.gaps, [])
})

test('ordina le chiamate anche se arrivano disordinate', () => {
    const m = computeDayMetrics([
        { calldate: at('14:00'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
        { calldate: at('13:00'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
    ])!
    assert.equal(m.firstAt.getTime(), at('13:00').getTime())
    assert.equal(m.windowSeconds, 3630)
})

test('conta le sole chiamate con risposta', () => {
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
        { calldate: at('13:05'), duration: 60, billsec: 40, disposition: 'ANSWERED' },
        { calldate: at('13:10'), duration: 10, billsec: 0, disposition: 'BUSY' },
    ])!
    assert.equal(m.answered, 1)
})

test('la mediana funziona su liste pari e dispari', () => {
    assert.equal(median([10, 20, 30]), 20)
    assert.equal(median([10, 20, 30, 40]), 25)
    assert.equal(median([]), 0)
})

test('distribuisce i buchi nelle cinque fasce, per secondi totali', () => {
    // buchi attesi: 30s, 120s, 600s (esattamente al confine: va in 10-30)
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 0, billsec: 0, disposition: 'NO ANSWER' },
        { calldate: at('13:00'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },  // gap 30s da 13:00:00
        { calldate: at('13:02'), duration: 0, billsec: 0, disposition: 'NO ANSWER' },   // gap 90s
        { calldate: at('13:12'), duration: 0, billsec: 0, disposition: 'NO ANSWER' },   // gap 600s
    ])!
    assert.equal(m.buckets.under1m, 30)
    assert.equal(m.buckets.m1to3, 90)
    assert.equal(m.buckets.m3to10, 0)
    assert.equal(m.buckets.m10to30, 600)   // 600 è il confine: appartiene alla fascia superiore
    assert.equal(m.buckets.over30m, 0)
})

test('la somma delle fasce corrisponde alla somma dei gap', () => {
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
        { calldate: at('13:05'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
        { calldate: at('14:00'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
    ])!
    const sommaFasce = m.buckets.under1m + m.buckets.m1to3 + m.buckets.m3to10 + m.buckets.m10to30 + m.buckets.over30m
    assert.equal(sommaFasce, m.gaps.reduce((a, b) => a + b, 0))
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --import tsx --test src/lib/cdr/dayMetrics.test.ts`
Atteso: FAIL, modulo inesistente.

- [ ] **Step 3: Scrivere l'implementazione**

Creare `src/lib/cdr/dayMetrics.ts`:

```ts
/**
 * Metriche di una giornata di lavoro di una postazione, ricavate dai
 * tabulati del centralino.
 *
 * Il "tempo non telefonico" NON è tempo di pausa: contiene anche la
 * compilazione degli esiti e la scelta del lead. Va sempre letto per
 * confronto con il migliore del gruppo, mai contro lo zero.
 */

export type DayCall = {
    calldate: Date
    duration: number   // secondi totali, squilli inclusi
    billsec: number    // secondi di conversazione effettiva
    disposition: string
}

/**
 * Secondi totali di buco, divisi per durata del singolo buco.
 * Serve a non confondere il ritmo lento con l'assenza: sotto il minuto è
 * la compilazione dell'esito (incomprimibile), sopra i 10 minuti è altro.
 */
export type GapBuckets = {
    under1m: number
    m1to3: number
    m3to10: number
    m10to30: number
    over30m: number
}

export function emptyBuckets(): GapBuckets {
    return { under1m: 0, m1to3: 0, m3to10: 0, m10to30: 0, over30m: 0 }
}

export type DayMetrics = {
    calls: number
    answered: number
    talkSeconds: number
    occupiedSeconds: number
    windowSeconds: number
    offPhoneSeconds: number
    gaps: number[]
    buckets: GapBuckets
    firstAt: Date
    lastAt: Date
}

export function median(values: number[]): number {
    if (!values.length) return 0
    const s = [...values].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function computeDayMetrics(calls: DayCall[]): DayMetrics | null {
    if (!calls.length) return null

    const sorted = [...calls].sort((a, b) => a.calldate.getTime() - b.calldate.getTime())
    const endOf = (c: DayCall) => c.calldate.getTime() + c.duration * 1000

    const firstAt = sorted[0].calldate
    const lastAt = new Date(Math.max(...sorted.map(endOf)))
    const windowSeconds = Math.round((lastAt.getTime() - firstAt.getTime()) / 1000)

    let talkSeconds = 0, occupiedSeconds = 0, answered = 0
    for (const c of sorted) {
        talkSeconds += c.billsec
        occupiedSeconds += c.duration
        if (c.disposition === 'ANSWERED') answered += 1
    }

    // Gap fra la fine di una chiamata e l'inizio della successiva.
    // I negativi indicano chiamate sovrapposte (dato anomalo): si scartano.
    const gaps: number[] = []
    const buckets = emptyBuckets()
    for (let i = 1; i < sorted.length; i++) {
        const gap = Math.round((sorted[i].calldate.getTime() - endOf(sorted[i - 1])) / 1000)
        if (gap < 0) continue
        gaps.push(gap)
        if (gap < 60) buckets.under1m += gap
        else if (gap < 180) buckets.m1to3 += gap
        else if (gap < 600) buckets.m3to10 += gap
        else if (gap < 1800) buckets.m10to30 += gap
        else buckets.over30m += gap
    }

    return {
        calls: sorted.length,
        answered,
        talkSeconds,
        occupiedSeconds,
        windowSeconds,
        offPhoneSeconds: Math.max(0, windowSeconds - occupiedSeconds),
        gaps,
        buckets,
        firstAt,
        lastAt,
    }
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --import tsx --test src/lib/cdr/dayMetrics.test.ts`
Atteso: 9 test PASS.

- [ ] **Step 5: Registrare il test nello script `test` e lanciare l'intera suite**

Aggiungere `src/lib/cdr/dayMetrics.test.ts` allo script `test` in `package.json`, poi `npm test`.
Atteso: tutti i test del progetto passano.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cdr/dayMetrics.ts src/lib/cdr/dayMetrics.test.ts package.json
git commit -m "feat(cdr): metriche giornaliere (turno, tempo al telefono, gap)"
```

---

### Task 4: Script di import dei CSV nel database

**Files:**
- Create: `scripts/import-cdr.ts`
- Modify: `package.json` (nuovo script `import:cdr`)

**Interfaces:**
- Consumes: `parseCdrLine` da `src/lib/cdr/parseCdr.ts`, tabelle `pbxCalls` e `pbxExtensions` da `@/db/schema`
- Produces: righe in `pbxCalls`. Nessuna funzione esportata: è un eseguibile da riga di comando.

I sei CSV sono già in `data/cdr/cdr-2026-03.csv` … `cdr-2026-08.csv` (marzo–agosto 2026, 144.163 righe totali).

- [ ] **Step 1: Verificare che esista un parser CSV fra le dipendenze**

Run: `node -e "require.resolve('csv-parse/sync'); console.log('ok')"`

Se fallisce con MODULE_NOT_FOUND: `npm install --save-dev csv-parse`. Serve un parser vero — il campo `lastdata` dei CDR contiene virgole dentro le virgolette, quindi uno `split(',')` produce dati sbagliati in silenzio.

- [ ] **Step 2: Scrivere lo script**

Creare `scripts/import-cdr.ts`:

```ts
/**
 * Import dei tabulati del centralino FreePBX.
 *
 *   npm run import:cdr -- data/cdr/cdr-2026-08.csv
 *   npm run import:cdr -- data/cdr/*.csv
 *
 * Idempotente: la chiave primaria è l'uniqueid assegnato da Asterisk, quindi
 * ricaricare lo stesso file non duplica nulla (ON CONFLICT DO NOTHING).
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { db } from '../src/db'
import { pbxCalls, pbxExtensions } from '../src/db/schema'
import { parseCdrLine } from '../src/lib/cdr/parseCdr'

const BATCH = 1000

async function main() {
    const files = process.argv.slice(2)
    if (!files.length) {
        console.error('Uso: npm run import:cdr -- <file.csv> [altri.csv]')
        process.exit(1)
    }

    const extMap = new Map<string, string>()
    for (const e of await db.select().from(pbxExtensions)) extMap.set(e.extension, e.userId)
    console.log(`Mappatura interni caricata: ${extMap.size} postazioni`)

    for (const file of files) {
        const records: Record<string, string>[] = parse(readFileSync(file), {
            columns: true, skip_empty_lines: true, relax_column_count: true,
        })

        const rows = []
        let scartate = 0
        for (const rec of records) {
            const r = parseCdrLine(rec)
            if (!r) { scartate++; continue }
            rows.push({
                id: r.id,
                companyId: 'fenice',
                calldate: r.calldate,
                dateLocal: r.dateLocal,
                src: r.src,
                dstKey: r.dstKey,
                duration: r.duration,
                billsec: r.billsec,
                disposition: r.disposition,
                direction: r.direction,
                userId: r.direction === 'out' ? (extMap.get(r.src) ?? null) : null,
            })
        }

        let inserite = 0
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH)
            const res = await db.insert(pbxCalls).values(chunk).onConflictDoNothing().returning({ id: pbxCalls.id })
            inserite += res.length
        }
        const senzaUtente = rows.filter(r => r.direction === 'out' && !r.userId).length
        console.log(`${file}: ${records.length} righe, ${rows.length} valide, ${scartate} scartate, ${inserite} nuove, ${senzaUtente} uscite senza postazione mappata`)
    }
    process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Aggiungere lo script a `package.json`**

Negli `scripts`: `"import:cdr": "node --import tsx scripts/import-cdr.ts"`

- [ ] **Step 4: Importare un solo mese e verificare**

Run: `npm run import:cdr -- data/cdr/cdr-2026-03.csv`
Atteso: `3448 righe, N valide, ... nuove`. Marzo è il mese più piccolo: se qualcosa è storto si vede qui col minor danno.

Poi via MCP Supabase `execute_sql`:

```sql
select direction, count(*), min("dateLocal"), max("dateLocal"), count("userId") con_utente
from "pbxCalls" group by 1;
```

Atteso: le date stanno fra `2026-03-10` e `2026-03-31`. Se `min` fosse `2026-03-09`, il fuso è sbagliato: tornare alla Task 2.

- [ ] **Step 5: Verificare l'idempotenza**

Rilanciare lo **stesso** comando dello Step 4.
Atteso: `0 nuove`. Se ne inserisce altre, la chiave primaria non funziona: fermarsi e correggere prima di procedere.

- [ ] **Step 6: Importare i restanti cinque mesi**

Run: `npm run import:cdr -- data/cdr/cdr-2026-04.csv data/cdr/cdr-2026-05.csv data/cdr/cdr-2026-06.csv data/cdr/cdr-2026-07.csv data/cdr/cdr-2026-08.csv`

Poi verificare che il totale sia coerente:

```sql
select left("dateLocal",7) mese, direction, count(*) from "pbxCalls" group by 1,2 order by 1,2;
```

Atteso: sei mesi, con le uscite nettamente prevalenti sulle entrate.

- [ ] **Step 7: Commit**

```bash
git add scripts/import-cdr.ts package.json
git commit -m "feat(cdr): script di import idempotente dei tabulati FreePBX"
```

---

### Task 5: Server action per la produttività da tabulati

**Files:**
- Create: `src/app/actions/productivityActions.ts`

**Interfaces:**
- Consumes: `computeDayMetrics`, `median`, `DayCall` da `src/lib/cdr/dayMetrics.ts`; `pbxCalls`, `users` da `@/db/schema`; `currentTenant`, `assertSalesArea`, `companyScope` da `@/lib/tenancy`
- Produces:
  - `export type PhoneProductivityRow = { userId: string; gdo: string; days: number; callsPerDay: number; talkMinPerDay: number; offPhoneMinPerDay: number; offPhonePct: number; avgGapSeconds: number; medianGapSeconds: number; ritmoMinPerDay: number; assenzeMinPerDay: number }`

`ritmoMinPerDay` sono i minuti al giorno in buchi **sotto i 3 minuti** (compilazione esito e passaggio al numero successivo: incomprimibili). `assenzeMinPerDay` sono quelli in buchi **oltre i 10 minuti**: è il numero da portare in una discussione con la persona, perché il totale mescola cose diverse. La fascia 3–10 minuti resta fuori da entrambi: è zona grigia e va mostrata come tale.
  - `export async function getPhoneProductivity(fromDateLocal: string, toDateLocal: string): Promise<{ rows: PhoneProductivityRow[]; benchmarkMin: number }>`

`benchmarkMin` è il minor `offPhoneMinPerDay` del gruppo: è il riferimento contro cui leggere gli altri, come stabilito nella spec (non lo zero).

- [ ] **Step 1: Scrivere la server action**

Creare `src/app/actions/productivityActions.ts`:

```ts
"use server"

/**
 * Produttività telefonica dei GDO dai tabulati del centralino (tabella
 * pbxCalls, alimentata da scripts/import-cdr.ts).
 *
 * Il "tempo non telefonico" comprende la compilazione degli esiti e la
 * scelta del lead: non è tempo di pausa. Va confrontato col migliore del
 * gruppo (benchmarkMin), mai con lo zero.
 */

import { db } from "@/db"
import { pbxCalls, users } from "@/db/schema"
import { and, gte, lte, eq, isNotNull } from "drizzle-orm"
import { currentTenant, assertSalesArea, companyScope } from "@/lib/tenancy"
import { computeDayMetrics, median, type DayCall } from "@/lib/cdr/dayMetrics"

/** Sotto questa soglia la giornata non è rappresentativa (mezze giornate, assenze). */
const MIN_CALLS_PER_DAY = 40

export type PhoneProductivityRow = {
    userId: string
    gdo: string
    days: number
    callsPerDay: number
    talkMinPerDay: number
    offPhoneMinPerDay: number
    offPhonePct: number
    avgGapSeconds: number
    medianGapSeconds: number
}

export async function getPhoneProductivity(
    fromDateLocal: string,
    toDateLocal: string,
): Promise<{ rows: PhoneProductivityRow[]; benchmarkMin: number }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const raw = await db.select({
        userId: pbxCalls.userId,
        dateLocal: pbxCalls.dateLocal,
        calldate: pbxCalls.calldate,
        duration: pbxCalls.duration,
        billsec: pbxCalls.billsec,
        disposition: pbxCalls.disposition,
        name: users.name,
        displayName: users.displayName,
    })
        .from(pbxCalls)
        .innerJoin(users, eq(users.id, pbxCalls.userId))
        .where(and(
            companyScope(ctx, pbxCalls.companyId),
            eq(pbxCalls.direction, 'out'),
            isNotNull(pbxCalls.userId),
            gte(pbxCalls.dateLocal, fromDateLocal),
            lte(pbxCalls.dateLocal, toDateLocal),
        ))

    // Raggruppa per (utente, giorno)
    const byDay = new Map<string, { userId: string; gdo: string; calls: DayCall[] }>()
    for (const r of raw) {
        const key = `${r.userId}|${r.dateLocal}`
        let slot = byDay.get(key)
        if (!slot) {
            slot = { userId: r.userId!, gdo: r.displayName || r.name || r.userId!, calls: [] }
            byDay.set(key, slot)
        }
        slot.calls.push({
            calldate: r.calldate,
            duration: r.duration,
            billsec: r.billsec,
            disposition: r.disposition,
        })
    }

    // Aggrega per utente sulle sole giornate rappresentative
    const byUser = new Map<string, {
        gdo: string; days: number; calls: number; talk: number
        offPhone: number; window: number; gaps: number[]
        ritmo: number; grigia: number; assenze: number
    }>()
    for (const slot of byDay.values()) {
        if (slot.calls.length < MIN_CALLS_PER_DAY) continue
        const m = computeDayMetrics(slot.calls)
        if (!m) continue
        let u = byUser.get(slot.userId)
        if (!u) {
            u = { gdo: slot.gdo, days: 0, calls: 0, talk: 0, offPhone: 0, window: 0, gaps: [], ritmo: 0, grigia: 0, assenze: 0 }
            byUser.set(slot.userId, u)
        }
        u.days += 1
        u.calls += m.calls
        u.talk += m.talkSeconds
        u.offPhone += m.offPhoneSeconds
        u.window += m.windowSeconds
        u.gaps.push(...m.gaps)
        u.ritmo += m.buckets.under1m + m.buckets.m1to3
        u.grigia += m.buckets.m3to10
        u.assenze += m.buckets.m10to30 + m.buckets.over30m
    }

    const rows: PhoneProductivityRow[] = [...byUser.entries()].map(([userId, u]) => ({
        userId,
        gdo: u.gdo,
        days: u.days,
        callsPerDay: Math.round(u.calls / u.days),
        talkMinPerDay: Math.round(u.talk / u.days / 60),
        offPhoneMinPerDay: Math.round(u.offPhone / u.days / 60),
        offPhonePct: u.window ? Math.round((100 * u.offPhone) / u.window) : 0,
        avgGapSeconds: u.gaps.length ? Math.round(u.gaps.reduce((a, b) => a + b, 0) / u.gaps.length) : 0,
        medianGapSeconds: Math.round(median(u.gaps)),
        ritmoMinPerDay: Math.round(u.ritmo / u.days / 60),
        assenzeMinPerDay: Math.round(u.assenze / u.days / 60),
    })).sort((a, b) => b.assenzeMinPerDay - a.assenzeMinPerDay)

    // Il riferimento è il migliore del gruppo sulle assenze, non sul totale.
    const benchmarkMin = rows.length ? Math.min(...rows.map(r => r.assenzeMinPerDay)) : 0
    return { rows, benchmarkMin }
}
```

- [ ] **Step 2: Verificare che compili**

Run: `npx tsc --noEmit`
Atteso: nessun errore nei file nuovi. (Se il progetto ha già errori preesistenti altrove, verificare solo che nessuno riguardi `src/lib/cdr/` o `productivityActions.ts`.)

- [ ] **Step 3: Verificare i numeri contro la baseline della spec**

Eseguire via MCP Supabase `execute_sql` la stessa aggregazione in SQL, per agosto:

```sql
with d as (
  select "userId", "dateLocal", count(*) n, sum(billsec) talk, sum(duration) occ,
         extract(epoch from (max(calldate + (duration || ' seconds')::interval) - min(calldate))) win
  from "pbxCalls" where direction='out' and "userId" is not null
    and "dateLocal" between '2026-08-01' and '2026-08-31'
  group by 1,2 having count(*) >= 40
)
select coalesce(u."displayName",u.name) gdo, count(*) gg,
       round(avg(n)) chiamate, round(avg(talk)/60) tel_min,
       round(avg(win-occ)/60) morto_min, round(100*sum(win-occ)/sum(win)) pct
from d join users u on u.id=d."userId" group by 1 order by morto_min desc;
```

Atteso: gli stessi valori della tabella nella sezione 9 della spec — GDO 117 (Simone) ~191 min al telefono e ~100 min non telefonici al 29%, GDO 115 (Clara) ~114 e ~212 al 59%. Se divergono di più di un paio di minuti, l'errore è nella server action: confrontare passo per passo con questa query prima di proseguire.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/productivityActions.ts
git commit -m "feat(produttivita): server action tempo al telefono e tempo non telefonico per GDO"
```

---

### Task 6: Scheda "Tempo al telefono" in /monitor-pause

**Files:**
- Create: `src/components/PhoneProductivityTab.tsx`
- Modify: `src/components/ManagerPauseView.tsx` (aggiunta della scheda alla barra esistente)
- Modify: `src/app/(dashboard)/monitor-pause/page.tsx:24-26` (testo descrittivo)

**Interfaces:**
- Consumes: `getPhoneProductivity`, `PhoneProductivityRow` da `@/app/actions/productivityActions`
- Produces: componente `export function PhoneProductivityTab()`

`ManagerPauseView.tsx` ha già `type Tab = 'giornaliero' | 'settimanale' | 'mensile'` (riga 9) e una barra di schede. Va esteso, non riscritto.

- [ ] **Step 1: Creare il componente della scheda**

Creare `src/components/PhoneProductivityTab.tsx`:

```tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { getPhoneProductivity, type PhoneProductivityRow } from "@/app/actions/productivityActions"
import { Phone, RefreshCw } from "lucide-react"

function monthBounds(offset: number): { from: string; to: string; label: string } {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    return {
        from: fmt(d), to: fmt(last),
        label: d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }),
    }
}

export function PhoneProductivityTab() {
    const [offset, setOffset] = useState(0)
    const [data, setData] = useState<{ rows: PhoneProductivityRow[]; benchmarkMin: number } | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const period = monthBounds(offset)

    const fetchData = useCallback(async () => {
        setIsLoading(true)
        try {
            setData(await getPhoneProductivity(period.from, period.to))
        } catch (e) {
            console.error(e)
        } finally {
            setIsLoading(false)
        }
    }, [period.from, period.to])

    useEffect(() => { fetchData() }, [fetchData])

    if (isLoading && !data) return <div className="p-8 text-center text-ash-500">Carico i tabulati...</div>
    if (!data || !data.rows.length) {
        return <div className="p-8 text-center text-ash-500">Nessun tabulato per {period.label}.</div>
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button onClick={() => setOffset(offset - 1)} className="px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50">←</button>
                    <div className="text-sm font-semibold text-ash-700 capitalize min-w-40 text-center">{period.label}</div>
                    <button onClick={() => setOffset(Math.min(0, offset + 1))} disabled={offset >= 0}
                        className="px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50 disabled:opacity-40">→</button>
                </div>
                <button onClick={fetchData} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50">
                    <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
                </button>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                <div>
                    Il tempo fuori dalle telefonate va letto scomposto, non come totale.
                    <strong> Ritmo</strong> sono i buchi sotto i 3 minuti: compilare l'esito e passare al numero dopo,
                    tempo di lavoro che non si comprime.
                    <strong> Assenze</strong> sono i buchi oltre i 10 minuti: è questo il numero da discutere.
                </div>
                <div>Il riferimento è il migliore del gruppo: {data.benchmarkMin} min al giorno di assenze.</div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-ash-50 text-ash-600">
                        <tr>
                            <th className="text-left px-4 py-3 font-semibold">GDO</th>
                            <th className="text-right px-4 py-3 font-semibold">Giornate</th>
                            <th className="text-right px-4 py-3 font-semibold">Chiamate/gg</th>
                            <th className="text-right px-4 py-3 font-semibold">Al telefono</th>
                            <th className="text-right px-4 py-3 font-semibold" title="Buchi sotto i 3 minuti">Ritmo</th>
                            <th className="text-right px-4 py-3 font-semibold" title="Buchi oltre i 10 minuti">Assenze</th>
                            <th className="text-right px-4 py-3 font-semibold">Oltre il migliore</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.map(r => {
                            const excess = r.assenzeMinPerDay - data.benchmarkMin
                            return (
                                <tr key={r.userId} className="border-t border-ash-100">
                                    <td className="px-4 py-3 font-semibold text-ash-800">{r.gdo}</td>
                                    <td className="px-4 py-3 text-right text-ash-500">{r.days}</td>
                                    <td className="px-4 py-3 text-right tabular-nums">{r.callsPerDay}</td>
                                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{r.talkMinPerDay} min</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-ash-500">{r.ritmoMinPerDay} min</td>
                                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{r.assenzeMinPerDay} min</td>
                                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${excess > 45 ? 'text-red-600' : excess > 20 ? 'text-amber-600' : 'text-ash-400'}`}>
                                        {excess > 0 ? `+${excess} min` : '—'}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center gap-2 text-xs text-ash-400">
                <Phone className="w-3 h-3" />
                Giornate con almeno 40 chiamate. Fonte: tabulati del centralino.
                Il tempo non telefonico totale è {Math.round(data.rows.reduce((a, r) => a + r.offPhoneMinPerDay, 0) / data.rows.length)} min al giorno in media.
            </div>
        </div>
    )
}
```

- [ ] **Step 2: Agganciare la scheda in `ManagerPauseView.tsx`**

Quattro modifiche puntuali.

1. Import in testa al file:

```tsx
import { PhoneProductivityTab } from "./PhoneProductivityTab"
```

2. Riga 9 il tipo, riga 15 lo stato iniziale:

```tsx
type Tab = 'telefono' | 'giornaliero' | 'settimanale' | 'mensile'
// ...
const [tab, setTab] = useState<Tab>('telefono')
```

3. Nella barra delle schede, come **primo** pulsante (adattare le classi a quelle già usate dagli altri pulsanti del file, se differiscono). Aggiungere `Phone` all'import di `lucide-react` già presente alla riga 7:

```tsx
<button
    onClick={() => setTab('telefono')}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        tab === 'telefono' ? 'bg-brand-orange text-white' : 'text-ash-500 hover:bg-ash-100'
    }`}
>
    <Phone className="w-4 h-4" /> Tempo al telefono
</button>
```

E nel corpo, prima del rendering delle viste esistenti:

```tsx
{tab === 'telefono' && <PhoneProductivityTab />}
```

4. `fetchReport` (riga 23) gira su un timer da 60 secondi: va fermato quando la scheda attiva non è una di quelle delle pause, altrimenti interroga il database a vuoto ogni minuto. Come **prima riga** dentro il `try`:

```tsx
if (tab === 'telefono') { setIsLoading(false); return }
```

- [ ] **Step 3: Aggiornare il testo della pagina**

In `src/app/(dashboard)/monitor-pause/page.tsx`, sostituire il paragrafo descrittivo (righe 24-26) con:

```tsx
<p className="text-sm text-gray-500 mt-1">
    Tempo al telefono, tempi morti e break dei GDO.
</p>
```

- [ ] **Step 4: Verificare a schermo**

Run: `npm run dev`, aprire `http://localhost:3000/monitor-pause` da un account ADMIN.
Atteso: la scheda "Tempo al telefono" è la prima e si apre di default; la tabella mostra i GDO ordinati per tempo non telefonico decrescente; i valori coincidono con quelli verificati nella Task 5; il selettore del mese naviga indietro e non oltre il mese corrente.

- [ ] **Step 5: Verificare che ai GDO non cambi nulla**

Aprire il CRM da un account GDO.
Atteso: nessuna voce di menu nuova, nessun elemento nuovo in pagina. `/monitor-pause` reindirizza alla home come già oggi.

- [ ] **Step 6: Commit**

```bash
git add src/components/PhoneProductivityTab.tsx src/components/ManagerPauseView.tsx "src/app/(dashboard)/monitor-pause/page.tsx"
git commit -m "feat(monitor-pause): scheda Tempo al telefono dai tabulati del centralino"
```

---

### Task 7: Volume minimo di chiamate parametrico

**Files:**
- Modify: `src/app/actions/gdoPerformanceActions.ts:591`
- Modify: `src/app/actions/managerAdvancedActions.ts` (nuova chiave in `appSettings`)

**Interfaces:**
- Consumes: `appSettings` da `@/db/schema`
- Produces:
  - `export async function getMinCallsPerDay(): Promise<number>` in `managerAdvancedActions.ts`
  - `export async function setMinCallsPerDay(value: number): Promise<void>`

Il valore `90` è oggi scritto nel codice e viene superato da tutti tutti i giorni: non misura nulla. Il nuovo default è **140**, deciso dal committente.

- [ ] **Step 1: Leggere il pattern esistente**

Aprire `src/app/actions/managerAdvancedActions.ts:40-85`: c'è già la coppia lettura/scrittura su `appSettings` per il CPL (`APP_SETTING_KEY_CPL`). Le due funzioni nuove devono seguire quel pattern, incluso il commento sul fatto che `appSettings` è globale e non filtrata per `companyId`.

- [ ] **Step 2: Aggiungere lettura e scrittura del minimo**

In `managerAdvancedActions.ts`, accanto a quelle del CPL:

```ts
const APP_SETTING_KEY_MIN_CALLS = 'gdo_min_calls_per_day'
const DEFAULT_MIN_CALLS = 140

export async function getMinCallsPerDay(): Promise<number> {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, APP_SETTING_KEY_MIN_CALLS))
    const parsed = Number(rows[0]?.value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_CALLS
}

export async function setMinCallsPerDay(value: number): Promise<void> {
    const v = Math.max(1, Math.round(value))
    await db.insert(appSettings)
        .values({ key: APP_SETTING_KEY_MIN_CALLS, value: String(v) })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: String(v) } })
}
```

Se `appSettings` ha colonne diverse da `key`/`value`, adeguarsi a quelle usate dal CPL nello stesso file.

- [ ] **Step 3: Usare il parametro al posto del numero fisso**

In `src/app/actions/gdoPerformanceActions.ts`, importare `getMinCallsPerDay` e sostituire, nel `return` di `getGdoDailyObjectives` (riga 591):

```ts
        callsTarget: await getMinCallsPerDay(),
```

- [ ] **Step 4: Verificare**

Run: `npx tsc --noEmit` — nessun errore nuovo.

Poi `npm run dev` e aprire la dashboard da un account GDO.
Atteso: l'obiettivo chiamate mostra **140** al posto di 90.

Poi impostare un valore diverso e verificare che si rifletta:

```sql
insert into "appSettings" (key, value) values ('gdo_min_calls_per_day','150')
on conflict (key) do update set value = excluded.value;
```

Ricaricare la dashboard GDO: deve mostrare 150. Riportare poi a 140.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/managerAdvancedActions.ts src/app/actions/gdoPerformanceActions.ts
git commit -m "feat(kpi): volume minimo chiamate parametrico, default 140 al posto del 90 fisso"
```

---

### Task 8: Scheda "Qualità appuntamenti"

**Files:**
- Modify: `src/app/actions/productivityActions.ts` (nuova funzione)
- Create: `src/components/ApptQualityTab.tsx`
- Modify: `src/components/ManagerPauseView.tsx` (quarta scheda)

**Interfaces:**
- Consumes: `apptSetAt`, `isPresenziato`, `isStatsGdo` da `@/lib/kpi/canon`; `leads`, `users` da `@/db/schema`
- Produces:
  - `export type ApptQualityRow = { userId: string; gdo: string; app: number; presenziati: number; chiusi: number; fatturato: number; presenzaPct: number; chiusuraPct: number; euroPerApp: number }`
  - `export async function getApptQuality(fromDateLocal: string, toDateLocal: string): Promise<ApptQualityRow[]>`

La cascata è: appuntamenti fissati → presenziati → chiusi → fatturato → € per appuntamento fissato. **Le date non sono la stessa**: l'appuntamento si conta a `appointmentCreatedAt`, la presenza a `presentedAt`, la chiusura a `salespersonOutcomeAt`. Sommarle sulla stessa data è l'errore da non fare — è il motivo per cui esiste `src/lib/kpi/canon.ts`.

- [ ] **Step 1: Aggiungere la funzione alla server action**

In fondo a `src/app/actions/productivityActions.ts`:

```ts
export type ApptQualityRow = {
    userId: string
    gdo: string
    app: number
    presenziati: number
    chiusi: number
    fatturato: number
    presenzaPct: number
    chiusuraPct: number
    euroPerApp: number
}

/**
 * Cascata di qualità degli appuntamenti per GDO.
 *
 * Attenzione alle date: l'appuntamento si conta al momento in cui è stato
 * fissato, la presenza al giorno in cui il lead si è presentato, la chiusura
 * alla data dell'esito del venditore. Sono tre date diverse: gli appuntamenti
 * di fine mese si presentano e si chiudono nel mese successivo, quindi la
 * cascata dell'ultimo mese è sempre parziale. Va detto nella UI.
 */
export async function getApptQuality(
    fromDateLocal: string,
    toDateLocal: string,
): Promise<ApptQualityRow[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const from = new Date(`${fromDateLocal}T00:00:00+02:00`)
    const to = new Date(`${toDateLocal}T23:59:59+02:00`)

    const rows = await db.select({
        userId: leads.assignedToId,
        name: users.name,
        displayName: users.displayName,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeAt: leads.salespersonOutcomeAt,
        closeAmountEur: leads.closeAmountEur,
    })
        .from(leads)
        .innerJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            companyScope(ctx, leads.companyId),
            eq(users.role, 'GDO'),
            sql`coalesce(${users.isBot}, false) = false`,
        ))

    const agg = new Map<string, ApptQualityRow>()
    const slot = (id: string, gdo: string) => {
        let s = agg.get(id)
        if (!s) {
            s = { userId: id, gdo, app: 0, presenziati: 0, chiusi: 0, fatturato: 0, presenzaPct: 0, chiusuraPct: 0, euroPerApp: 0 }
            agg.set(id, s)
        }
        return s
    }
    const inRange = (d: Date | null) => !!d && d >= from && d <= to

    for (const r of rows) {
        if (!r.userId) continue
        const s = slot(r.userId, r.displayName || r.name || r.userId)
        if (inRange(apptSetAt(r))) s.app += 1
        if (inRange(r.presentedAt)) s.presenziati += 1
        if (r.salespersonOutcome?.toLowerCase() === 'chiuso' && inRange(r.salespersonOutcomeAt)) {
            s.chiusi += 1
            s.fatturato += r.closeAmountEur || 0
        }
    }

    return [...agg.values()]
        .filter(s => s.app > 0)
        .map(s => ({
            ...s,
            fatturato: Math.round(s.fatturato),
            presenzaPct: s.app ? Math.round((100 * s.presenziati) / s.app) : 0,
            chiusuraPct: s.presenziati ? Math.round((100 * s.chiusi) / s.presenziati) : 0,
            euroPerApp: s.app ? Math.round(s.fatturato / s.app) : 0,
        }))
        .sort((a, b) => b.euroPerApp - a.euroPerApp)
}
```

Aggiungere agli import in testa al file: `leads` da `@/db/schema`, `sql` da `drizzle-orm`, e `import { apptSetAt } from "@/lib/kpi/canon"`.

`isPresenziato` **non** serve qui: la presenza si conta da `presentedAt`, che è il latch immutabile introdotto a luglio, non dall'esito del venditore.

- [ ] **Step 2: Creare la scheda**

Creare `src/components/ApptQualityTab.tsx`:

```tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { getApptQuality, type ApptQualityRow } from "@/app/actions/productivityActions"
import { Target, RefreshCw } from "lucide-react"

function monthBounds(offset: number): { from: string; to: string; label: string } {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    return {
        from: fmt(d), to: fmt(last),
        label: d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }),
    }
}

const eur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function ApptQualityTab() {
    const [offset, setOffset] = useState(0)
    const [rows, setRows] = useState<ApptQualityRow[] | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const period = monthBounds(offset)

    const fetchData = useCallback(async () => {
        setIsLoading(true)
        try {
            setRows(await getApptQuality(period.from, period.to))
        } catch (e) {
            console.error(e)
        } finally {
            setIsLoading(false)
        }
    }, [period.from, period.to])

    useEffect(() => { fetchData() }, [fetchData])

    if (isLoading && !rows) return <div className="p-8 text-center text-ash-500">Carico gli appuntamenti...</div>
    if (!rows || !rows.length) return <div className="p-8 text-center text-ash-500">Nessun appuntamento per {period.label}.</div>

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button onClick={() => setOffset(offset - 1)} className="px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50">←</button>
                    <div className="text-sm font-semibold text-ash-700 capitalize min-w-40 text-center">{period.label}</div>
                    <button onClick={() => setOffset(Math.min(0, offset + 1))} disabled={offset >= 0}
                        className="px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50 disabled:opacity-40">→</button>
                </div>
                <button onClick={fetchData} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-ash-300 hover:bg-ash-50">
                    <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
                </button>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Gli appuntamenti fissati a fine mese si presentano e si chiudono nel mese successivo:
                presenze, chiusure e fatturato del mese in corso sono <strong>sempre parziali</strong>.
            </div>

            <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-ash-50 text-ash-600">
                        <tr>
                            <th className="text-left px-4 py-3 font-semibold">GDO</th>
                            <th className="text-right px-4 py-3 font-semibold">Fissati</th>
                            <th className="text-right px-4 py-3 font-semibold">Presenziati</th>
                            <th className="text-right px-4 py-3 font-semibold">Chiusi</th>
                            <th className="text-right px-4 py-3 font-semibold">Fatturato</th>
                            <th className="text-right px-4 py-3 font-semibold">€ per appuntamento</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.userId} className="border-t border-ash-100">
                                <td className="px-4 py-3 font-semibold text-ash-800">{r.gdo}</td>
                                <td className="px-4 py-3 text-right tabular-nums">{r.app}</td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                    {r.presenziati} <span className="text-ash-400">({r.presenzaPct}%)</span>
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                    {r.chiusi} <span className="text-ash-400">({r.chiusuraPct}%)</span>
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">{eur(r.fatturato)}</td>
                                <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">{eur(r.euroPerApp)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center gap-2 text-xs text-ash-400">
                <Target className="w-3 h-3" />
                Ordinati per euro prodotti da ogni appuntamento fissato.
            </div>
        </div>
    )
}
```

- [ ] **Step 3: Agganciare la quarta scheda**

In `src/components/ManagerPauseView.tsx`, estendere il tipo delle schede e aggiungere l'import:

```tsx
type Tab = 'telefono' | 'qualita' | 'giornaliero' | 'settimanale' | 'mensile'
```

```tsx
import { ApptQualityTab } from "./ApptQualityTab"
```

Aggiungere `Target` all'import di `lucide-react` e inserire il pulsante subito dopo quello "Tempo al telefono":

```tsx
<button
    onClick={() => setTab('qualita')}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        tab === 'qualita' ? 'bg-brand-orange text-white' : 'text-ash-500 hover:bg-ash-100'
    }`}
>
    <Target className="w-4 h-4" /> Qualità appuntamenti
</button>
```

Nel corpo, accanto al rendering della scheda telefono:

```tsx
{tab === 'qualita' && <ApptQualityTab />}
```

E allargare il guard del timer dentro `fetchReport`, che ora deve fermarsi su entrambe le schede nuove:

```tsx
if (tab === 'telefono' || tab === 'qualita') { setIsLoading(false); return }
```

- [ ] **Step 4: Verificare contro un mese chiuso**

Aprire la scheda e selezionare **luglio 2026** (mese chiuso, quindi cascata completa).
Confrontare i totali con `/panoramica-generale` per lo stesso mese: gli appuntamenti fissati e il fatturato devono coincidere. Se divergono, il sospetto è sempre lo stesso: una delle tre date usata al posto di un'altra.

- [ ] **Step 5: Verificare l'intera suite e la build**

Run: `npm test` — tutti verdi.
Run: `npm run build` — build pulita, nessun errore di tipo.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/productivityActions.ts src/components/ApptQualityTab.tsx src/components/ManagerPauseView.tsx
git commit -m "feat(monitor-pause): scheda qualita appuntamenti con cascata fino a euro per appuntamento"
```

---

## Scostamenti dichiarati rispetto alla spec

- **La scheda "Volume" separata non viene fatta.** La spec (sezione 3) la
  prevedeva, ma i dati misurati nella sezione 9 mostrano che il numero di
  chiamate non predice gli appuntamenti (256 chiamate/giorno producono 4,0
  appuntamenti, 102 ne producono 6,8). Una scheda dedicata a quella metrica
  darebbe importanza a un numero fuorviante. Il volume resta come colonna
  "Chiamate/gg" nella scheda Tempo al telefono, e come soglia di allarme nel
  parametro della Task 7. Se il committente la rivuole separata, è mezza
  giornata di lavoro.
- **I parametri "soglia buco" e "tetto conversazione" non vengono creati.**
  Servivano alle euristiche sui `callLogs`, cadute con l'arrivo dei tabulati.
  L'unico parametro configurabile resta il volume minimo.

## Fuori da questo piano

- **Invio automatico dei tabulati**: un agente sul PC dell'ufficio che legge i CDR e li spedisce firmati al CRM ogni notte (stesso schema HMAC del bot fissatore). Finché non c'è, l'aggiornamento è manuale: export CSV dal pannello + `npm run import:cdr`.
- **Tracker dentro il CRM**: costo di compilazione degli esiti, lead aperti e mai chiamati. Da valutare dopo aver usato questa pagina: i tabulati potrebbero già bastare.
- **Chiamate in entrata perse**: i clienti che richiamano e non trovano risposta sono già in `pbxCalls` con `direction='in'`. Non è nel perimetro, ma il dato è a disposizione.
- **Sicurezza del centralino**: firewall disattivato e password deboli sugli interni. Non è lavoro da CRM, ma va fatto fare a chi lo amministra.
