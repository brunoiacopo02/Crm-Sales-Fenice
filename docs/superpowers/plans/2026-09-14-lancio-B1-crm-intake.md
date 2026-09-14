# Lancio Web Dev AI — Blocco B1 (CRM: ingresso lead lancio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** I lead della lista ActiveCampaign "Lancio Web Developer AI" (id 132) entrano nel CRM con funnel `Lancio Web Dev AI` e bucket `LANCIO_WEBDEV_2026`, vengono assegnati al bot (GDO 201) e spinti subito all'intake del bot con il campo `lancio` nel payload; una card su `/import` recupera i lead accumulati in AC, li spinge a lotti e distribuisce ai GDO i lead nel pool.

**Architecture:** Un modulo puro `src/lib/lancio/intake.ts` (costanti, interruttore, decisione "è lancio?", costruttori di riga e di eventi) testato con `node --test`; il webhook AC lo usa in un ramo che sta PRIMA del ramo liste bloccate ed è attivo solo con `LANCIO_WEBDEV_INTAKE=on` (a interruttore spento nulla cambia: la lista resta nel default bloccato). Le scritture bulk (sync di recupero, push a lotti, distribuzione) vivono in `src/app/actions/lancioPoolActions.ts` (clone del pattern Black Summer) e nella card `LancioPoolCard.tsx`. Il contratto bot cresce di un campo opzionale `lancio` (v1.6).

**Tech Stack:** Next.js 16.1.6 (App Router, `after()`), Drizzle ORM 0.45 su Supabase Postgres, migrazioni SQL a mano in `drizzle/migrations/`, test `node --import tsx --test` (lista fissa in `package.json` → `scripts.test`), `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-09-14-lancio-webdev-ottobre-design.md` — sezioni di questo blocco: §3.1 (modello dati CRM, esclusa `launchShifts` che è del B3), §4.1 (ingresso lead lancio), §6.1 (campo `lancio` nell'intake), §4.8 (KPI), §9 riga B1, contratto `docs/bot-fissatore-contract.md` → v1.6 (sola parte intake).

## Global Constraints

- Nomi ESATTI dalla spec: funnel `Lancio Web Dev AI`; bucket `LANCIO_WEBDEV_2026`; slug `webdev-2026-10`; colonne `leads.lancioIngresso`, `lancioScelta`, `lancioSceltaAt`, `lancioCallNowAttempts`, `lancioCallNowNextAt`, `lancioBotInfo`; eventi `LANCIO_INTAKE`, `LANCIO_CALL_NOW_ASSIGNED`, `LANCIO_BOOKED`, `LANCIO_RETURNED_TO_POOL`, `LANCIO_SHIFT_CHANGED` (in questo blocco si SCRIVE solo `LANCIO_INTAKE`; gli altri entrano nel tipo TS per il B3/B5); payload intake `lancio: { slug: 'webdev-2026-10', ingresso: 'lista' | 'pulsante_webinar' }`; riga `launchPools` `('fenice','LANCIO_WEBDEV_2026','LAUNCH','Lancio Web Dev AI 2026')`.
- Lista AC riconosciuta per nome normalizzato `lancio web developer ai` (trim + lowercase; oggi id 132), con lo stesso meccanismo cache 10 minuti delle liste bloccate. MAI l'id hardcoded.
- Interruttore `LANCIO_WEBDEV_INTAKE`: SOLO la stringa esatta `on` accende il ramo; qualunque altro valore o assenza = comportamento attuale (lista bloccata, riga in `acIntakeFailures` con `blocked_list:132`).
- Il ramo lancio bypassa fasce orarie (`getLeadRouting`), tetto giornaliero (`BOT_DAILY_MIN`), finestra ferie (`isBotHolidayWindow`) e `acAutoIntake`. Non si applica il dedup 24h del flusso normale: dedup SOLO su `acContactId` nel bucket (indice unico parziale `leads_company_bucket_accontact_uq` esistente) e telefono nel bucket. Duplicati cross-funnel voluti.
- Il push al bot dal webhook va in `after()` (mai in linea). I push a lotti usano `pushLeadsToBotPaced` (30/min, `remaining`, ripetibile).
- Regola "non si rispinge": un lead con un `BOT_PUSHED` con `result` in `sent`, `duplicate` o `network_error` non viene rispinto dal sync/push a lotti (memoria 2026-09-09: un `network_error` è già arrivato al bot).
- Logica pura (decisione, costruzione payload/righe) in moduli SENZA import di `@/db`, testata con `node --test`. Ogni file di test nuovo va AGGIUNTO alla lista fissa in `package.json` → `scripts.test`, altrimenti `npm test` non lo esegue.
- Nei file `'use server'` (`src/app/actions/*.ts`) si esportano SOLO `async function` ed `export type`: nessun `export const`/`export function` sincrono (rompe a runtime in Next 16). Le costanti stanno in `src/lib/lancio/intake.ts`.
- Eventi in bulk a chunk di 500 righe per insert (sync e distribuzione), mai un insert per lead.
- Migrazione SQL scritta A MANO (`drizzle-kit generate` non si usa) e applicata con l'MCP Supabase `apply_migration` (project id `ncutwzsifzundikwllxp`) PRIMA del deploy del codice che usa le colonne.
- Tailwind: la card usa la palette ambra come `BlackSummerPoolCard` (spec §4.1: "card ambra"). Bottoni mai dentro `<span>`/`<p>`.
- Non toccare `launchShifts`, `/api/bot/lancio/*`, `/api/bot/outcome`, `/api/bot/lead-entrante` (B3/B5). Non toccare il middleware.
- Commit a ogni task, messaggi in italiano con prefisso `feat(lancio):`/`docs(lancio):`, chiusi da:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TqdFfxeDbRPq6iBmWYWSFD
  ```

---

## Decisione: dove sta il ramo lancio rispetto alle liste bloccate

Oggi `BLOCKED_LIST_NAMES_NORMALIZED` (in `src/app/api/webhooks/activecampaign/route.ts:44-49`) contiene nel default `Lancio Web Developer AI` (commit `cbbaa7d`). Scelta di questo piano: **la lista RESTA nel default bloccato e il ramo lancio viene valutato PRIMA del ramo liste bloccate, solo quando `LANCIO_WEBDEV_INTAKE === 'on'`.** Motivi:

1. A interruttore spento il codice che gira è esattamente quello di oggi: rollback = togliere la env, niente da ricordare sulla lista bloccata.
2. Se qualcuno spegnesse l'interruttore a lancio in corso, i lead tornerebbero automaticamente in `acIntakeFailures` (`blocked_list:132`) e il sync di recupero li ripescherebbe: nessun lead va ai GDO per sbaglio.
3. Non serve una env in più per togliere la lista dal blocco (che sarebbe un secondo interruttore da tenere allineato).

Costo: la risoluzione nome→id delle liste AC viene fatta una volta sola per entrambi gli usi (cache condivisa, Task 4), così il ramo lancio non aggiunge chiamate AC. Il payload del webhook porta di solito `list`: in quel caso la decisione lancio è a costo zero; il fallback `/contacts/{id}/contactLists` viene chiamato UNA volta e riusato dal ramo liste bloccate.

## File Structure

| File | Ruolo |
|---|---|
| `drizzle/migrations/0036_lancio_webdev.sql` (nuovo) | 6 colonne `lancio*` su `leads` + riga `launchPools` |
| `src/db/schema.ts` (modifica, tabella `leads`) | le stesse 6 colonne in Drizzle |
| `src/lib/eventLogger.ts` (modifica) | i 5 `eventType` `LANCIO_*` nel tipo |
| `src/lib/lancio/intake.ts` (nuovo, puro) | costanti, `isLancioIntakeEnabled`, `decideLancioIntake`, `lancioPayloadField`, `lancioFieldForLead`, `buildLancioLeadRow`, `buildLancioIntakeEventRows` |
| `src/lib/lancio/intake.test.ts` (nuovo) | test del modulo puro |
| `src/lib/bot-fissatore/types.ts` (modifica) | campo opzionale `lancio` su `BotIntakePayload` |
| `src/lib/bot-fissatore/pushAudit.ts` (modifica) | `NO_REPUSH_RESULTS(_SQL)`, `withLancioAudit` |
| `src/lib/bot-fissatore/pushAudit.test.ts` (modifica) | test delle due aggiunte |
| `src/lib/bot-fissatore/push.ts` (modifica) | `auditPush` scrive `metadata.lancio` |
| `src/app/api/admin/bot-push-leads/route.ts` (modifica) | i lead lancio spinti a mano portano `lancio` |
| `src/app/api/webhooks/activecampaign/route.ts` (modifica) | cache liste condivisa + ramo lancio + `handleLancioIntake` |
| `src/lib/launchPoolShared.ts` (modifica) | `findAcListIdByName`, `assignedAt` con `coalesce` in `pickAndAssignBuckets` |
| `src/app/actions/lancioPoolActions.ts` (nuovo, `'use server'`) | `getLancioPoolStatus`, `syncLancioPool`, `pushLancioPoolToBot`, `assignFromLancioPool` |
| `src/components/LancioPoolCard.tsx` (nuovo) | card ambra su `/import` |
| `src/app/(dashboard)/import/ImportClient.tsx` (modifica) | monta la card |
| `docs/bot-fissatore-contract.md` (modifica) | v1.6: Direzione 1 con `personKey`, `previousLeadIds`, `lancio` |
| `package.json` (modifica) | `intake.test.ts` nella lista `scripts.test` |

---

### Task 1: Migrazione 0036 + schema Drizzle + tipi evento

**Files:**
- Create: `drizzle/migrations/0036_lancio_webdev.sql`
- Modify: `src/db/schema.ts:134-136` (dopo `launchBucket`)
- Modify: `src/lib/eventLogger.ts:27` (unione `eventType`)

**Interfaces:**
- Consumes: tabella `leads`, tabella `launchPools` (`launch_pools_company_bucket_uq` su `companyId,bucket`), `leadEvents.eventType` (text libero nel DB).
- Produces: colonne `leads.lancioIngresso text`, `leads.lancioScelta text`, `leads.lancioSceltaAt timestamptz`, `leads.lancioCallNowAttempts integer not null default 0`, `leads.lancioCallNowNextAt timestamptz`, `leads.lancioBotInfo jsonb`; riga `launchPools` bucket `LANCIO_WEBDEV_2026`; `eventType` TS accetta `'LANCIO_INTAKE' | 'LANCIO_CALL_NOW_ASSIGNED' | 'LANCIO_BOOKED' | 'LANCIO_RETURNED_TO_POOL' | 'LANCIO_SHIFT_CHANGED'`.

- [ ] **Step 1: Scrivere la migrazione**

```sql
-- 0036: lancio "Web Developer AI" (webinar 5/10/2026), spec 2026-09-14 §3.1.
--
-- L'appartenenza al lancio NON ha una colonna sua: basta
-- launchBucket = 'LANCIO_WEBDEV_2026' + funnel = 'Lancio Web Dev AI'.
-- Le colonne qui sotto raccontano COME e' entrato e COSA ha scelto la sera
-- della live. Tutte nullable: sui lead normali restano NULL e non costano.
-- La tabella launchShifts (turni venditori) e' del blocco B3, non di questa
-- migrazione.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioIngresso" text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioScelta" text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioSceltaAt" timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioCallNowAttempts" integer NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioCallNowNextAt" timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioBotInfo" jsonb;

COMMENT ON COLUMN public.leads."lancioIngresso" IS
  'Come e'' entrato nel lancio: lista (AC 132) | pulsante_webinar (wa.me la sera della live).';
COMMENT ON COLUMN public.leads."lancioScelta" IS
  'Scelta dopo il pitch: chiamata_subito | app_mattina | app_pomeriggio | app_dopodomani | followup.';
COMMENT ON COLUMN public.leads."lancioCallNowAttempts" IS
  'Tentativi del venditore sulla chiamata subito (NR = +1, al 3o passa alle Conferme).';
COMMENT ON COLUMN public.leads."lancioBotInfo" IS
  'Risposte alle due domande di riscaldamento del bot, mostrate al venditore.';

-- La card su /import acquisisce "Rimuovi pool" come Black Summer (0023).
INSERT INTO public."launchPools" ("id", "companyId", "bucket", "kind", "label", "monthKey")
VALUES (gen_random_uuid()::text, 'fenice', 'LANCIO_WEBDEV_2026', 'LAUNCH', 'Lancio Web Dev AI 2026', NULL)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Aggiungere le colonne a `src/db/schema.ts`**

Subito dopo la riga `launchBucket: text('launchBucket'),` (riga 136) inserire:

```ts
    // Lancio "Web Developer AI" (ottobre 2026, migr. 0036). L'appartenenza al
    // lancio e' launchBucket='LANCIO_WEBDEV_2026' + funnel='Lancio Web Dev AI';
    // queste dicono come e' entrato e cosa ha scelto la sera della live.
    // Tutte NULL sui lead normali.
    lancioIngresso: text('lancioIngresso'),               // 'lista' | 'pulsante_webinar'
    lancioScelta: text('lancioScelta'),                   // 'chiamata_subito' | 'app_mattina' | 'app_pomeriggio' | 'app_dopodomani' | 'followup'
    lancioSceltaAt: timestamp('lancioSceltaAt', { withTimezone: true, mode: 'date' }),
    lancioCallNowAttempts: integer('lancioCallNowAttempts').default(0).notNull(),
    lancioCallNowNextAt: timestamp('lancioCallNowNextAt', { withTimezone: true, mode: 'date' }),
    lancioBotInfo: jsonb('lancioBotInfo'),
```

- [ ] **Step 3: Estendere il tipo `eventType` in `src/lib/eventLogger.ts`**

Sostituire la riga 27:

```ts
    eventType: 'IMPORTED' | 'ASSIGNED' | 'CALL_LOGGED' | 'SECTION_MOVED' | 'DISCARDED' | 'RECALL_SET' | 'APPOINTMENT_SET' | 'AGENDA_SENT' | 'AGENDA_DELIVERED' | 'AC_UPDATED' | 'BOT_PUSHED' | 'VIDEO_OPENED' | 'RECONCILED' | 'INBOUND_MESSAGE' | 'contact_info_edited'
        // Lancio Web Dev AI (spec 2026-09-14 §3.1). In B1 si scrive solo LANCIO_INTAKE.
        | 'LANCIO_INTAKE' | 'LANCIO_CALL_NOW_ASSIGNED' | 'LANCIO_BOOKED' | 'LANCIO_RETURNED_TO_POOL' | 'LANCIO_SHIFT_CHANGED'
```

- [ ] **Step 4: Compilare**

Run: `npx tsc --noEmit`
Expected: nessun errore (le colonne nuove sono opzionali in `$inferInsert`).

- [ ] **Step 5: Applicare la migrazione su Supabase**

Con l'MCP Supabase `apply_migration`, project id `ncutwzsifzundikwllxp`, name `0036_lancio_webdev`, query = contenuto del file. Poi verificare con `execute_sql`:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'leads' AND column_name LIKE 'lancio%'
ORDER BY column_name;
-- attese 6 righe
SELECT bucket, kind, label, "archivedAt" FROM "launchPools" WHERE bucket = 'LANCIO_WEBDEV_2026';
-- attesa 1 riga, archivedAt NULL
```

- [ ] **Step 6: Commit**

```bash
git add drizzle/migrations/0036_lancio_webdev.sql src/db/schema.ts src/lib/eventLogger.ts
git commit -m "feat(lancio): colonne lancio* su leads, pool LANCIO_WEBDEV_2026 e tipi evento (0036)"
```

---

### Task 2: Modulo puro `src/lib/lancio/intake.ts` (decisione, payload, righe)

**Files:**
- Create: `src/lib/lancio/intake.ts`
- Create: `src/lib/lancio/intake.test.ts`
- Modify: `package.json` (`scripts.test`: aggiungere `src/lib/lancio/intake.test.ts` alla lista)

**Interfaces:**
- Consumes: niente dal DB (modulo puro). Tipo `LeadEventRow` costruito a mano con la stessa shape di `leadEvents.$inferInsert` (come fa `pickAndAssignBuckets` in `launchPoolShared.ts:96-107`).
- Produces (usati da Task 3, 4, 5, 6 e dai blocchi B3/B5):
  ```ts
  export const LANCIO_FUNNEL = 'Lancio Web Dev AI';
  export const LANCIO_BUCKET = 'LANCIO_WEBDEV_2026';
  export const LANCIO_SLUG = 'webdev-2026-10';
  export const LANCIO_LIST_NAME_NORMALIZED = 'lancio web developer ai';
  export const LANCIO_POOL_LABEL = 'Lancio Web Dev AI 2026';
  export const LANCIO_COMPANY = 'fenice';
  export type LancioIngresso = 'lista' | 'pulsante_webinar';
  export interface LancioPayloadField { slug: string; ingresso: LancioIngresso }
  export function isLancioIntakeEnabled(env?: NodeJS.ProcessEnv): boolean;
  export type LancioDecision =
    | { lancio: true; via: 'payload' | 'membership'; listId: string }
    | { lancio: false; motivo: 'spento' | 'lista_sconosciuta' | 'non_in_lista' };
  export function decideLancioIntake(args: { enabled: boolean; lancioListId: string | null; triggerListId: string | null; activeListIds: ReadonlySet<string> | null }): LancioDecision;
  export function lancioPayloadField(ingresso: LancioIngresso): LancioPayloadField;
  export function lancioFieldForLead(lead: { launchBucket: string | null; lancioIngresso: string | null }): LancioPayloadField | undefined;
  export interface LancioLeadInput { id: string; name: string; phone: string; email: string | null; acContactId: string | null; phoneSuspicious: boolean; botId: string | null; now: Date; utm?: { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; utmContent?: string | null; utmTerm?: string | null } }
  export function buildLancioLeadRow(input: LancioLeadInput): LancioLeadRow;
  export function buildLancioIntakeEventRows(args: { leadId: string; botId: string | null; adminId: string | null; acContactId: string | null; source: 'activecampaign' | 'lancio_sync'; via: 'payload' | 'membership' | 'sync'; listId: string | null; now: Date }): LeadEventRow[];
  ```

- [ ] **Step 1: Scrivere i test**

`src/lib/lancio/intake.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LANCIO_FUNNEL, LANCIO_BUCKET, LANCIO_SLUG, LANCIO_LIST_NAME_NORMALIZED,
    isLancioIntakeEnabled, decideLancioIntake, lancioPayloadField, lancioFieldForLead,
    buildLancioLeadRow, buildLancioIntakeEventRows,
} from './intake';

// ------------------------------------------------------------ costanti

test('i nomi sono quelli della spec, lettera per lettera', () => {
    assert.equal(LANCIO_FUNNEL, 'Lancio Web Dev AI');
    assert.equal(LANCIO_BUCKET, 'LANCIO_WEBDEV_2026');
    assert.equal(LANCIO_SLUG, 'webdev-2026-10');
    assert.equal(LANCIO_LIST_NAME_NORMALIZED, 'lancio web developer ai');
});

// ------------------------------------------------------------ interruttore

test('l interruttore si accende SOLO con la stringa esatta "on"', () => {
    assert.equal(isLancioIntakeEnabled({ LANCIO_WEBDEV_INTAKE: 'on' }), true);
    for (const v of ['ON', 'On', 'true', '1', 'yes', 'off', '', undefined]) {
        assert.equal(isLancioIntakeEnabled({ LANCIO_WEBDEV_INTAKE: v }), false, `valore ${String(v)}`);
    }
    assert.equal(isLancioIntakeEnabled({}), false);
});

// ------------------------------------------------------------ decisione

const LISTA = '132';

test('spento: mai lancio, anche se la lista combacia', () => {
    const d = decideLancioIntake({ enabled: false, lancioListId: LISTA, triggerListId: LISTA, activeListIds: new Set([LISTA]) });
    assert.deepEqual(d, { lancio: false, motivo: 'spento' });
});

test('acceso ma la lista non esiste su AC: non e lancio e lo dice', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: null, triggerListId: LISTA, activeListIds: null });
    assert.deepEqual(d, { lancio: false, motivo: 'lista_sconosciuta' });
});

test('fastpath: la lista del payload combacia, nessuna membership serve', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: LISTA, triggerListId: LISTA, activeListIds: null });
    assert.deepEqual(d, { lancio: true, via: 'payload', listId: LISTA });
});

test('senza lista nel payload e senza membership ancora letta: non_in_lista (il chiamante deve leggere le membership)', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: LISTA, triggerListId: null, activeListIds: null });
    assert.deepEqual(d, { lancio: false, motivo: 'non_in_lista' });
});

test('membership: il contatto e iscritto alla lista lancio anche se il trigger e un altra lista', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: LISTA, triggerListId: '7', activeListIds: new Set(['7', LISTA]) });
    assert.deepEqual(d, { lancio: true, via: 'membership', listId: LISTA });
});

test('membership letta e la lista lancio non c e: non_in_lista', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: LISTA, triggerListId: '7', activeListIds: new Set(['7']) });
    assert.deepEqual(d, { lancio: false, motivo: 'non_in_lista' });
});

// ------------------------------------------------------------ payload

test('il campo lancio del payload intake porta slug e ingresso', () => {
    assert.deepEqual(lancioPayloadField('lista'), { slug: 'webdev-2026-10', ingresso: 'lista' });
    assert.deepEqual(lancioPayloadField('pulsante_webinar'), { slug: 'webdev-2026-10', ingresso: 'pulsante_webinar' });
});

test('lancioFieldForLead: solo i lead del bucket lancio portano il campo', () => {
    assert.deepEqual(lancioFieldForLead({ launchBucket: 'LANCIO_WEBDEV_2026', lancioIngresso: 'lista' }), { slug: 'webdev-2026-10', ingresso: 'lista' });
    assert.equal(lancioFieldForLead({ launchBucket: 'BLACK_SUMMER', lancioIngresso: null }), undefined);
    assert.equal(lancioFieldForLead({ launchBucket: null, lancioIngresso: null }), undefined);
});

test('lancioFieldForLead: ingresso sconosciuto o assente ricade su "lista" (i lead del bucket nascono dalla lista)', () => {
    assert.deepEqual(lancioFieldForLead({ launchBucket: 'LANCIO_WEBDEV_2026', lancioIngresso: null }), { slug: 'webdev-2026-10', ingresso: 'lista' });
    assert.deepEqual(lancioFieldForLead({ launchBucket: 'LANCIO_WEBDEV_2026', lancioIngresso: 'boh' }), { slug: 'webdev-2026-10', ingresso: 'lista' });
});

// ------------------------------------------------------------ riga lead

const NOW = new Date('2026-09-16T10:00:00Z');

test('riga lead lancio assegnata al bot: funnel, bucket, ingresso, assignedAt = adesso', () => {
    const row = buildLancioLeadRow({
        id: 'L1', name: 'Mario Rossi', phone: '3331234567', email: 'm@x.it',
        acContactId: '999', phoneSuspicious: false, botId: 'BOT', now: NOW,
    });
    assert.equal(row.funnel, 'Lancio Web Dev AI');
    assert.equal(row.launchBucket, 'LANCIO_WEBDEV_2026');
    assert.equal(row.lancioIngresso, 'lista');
    assert.equal(row.source, 'activecampaign');
    assert.equal(row.status, 'NEW');
    assert.equal(row.callCount, 0);
    assert.equal(row.assignedToId, 'BOT');
    assert.equal(row.assignedAt, NOW);
    assert.equal(row.createdAt, NOW);
    assert.equal(row.companyId, 'fenice');
    assert.equal(row.phoneSuspicious, false);
});

test('telefono sospetto o bot assente: la riga resta nel bucket senza padrone e senza assignedAt', () => {
    const sospetto = buildLancioLeadRow({ id: 'L2', name: 'X', phone: '0000000000', email: null, acContactId: '1', phoneSuspicious: true, botId: 'BOT', now: NOW });
    assert.equal(sospetto.assignedToId, null);
    assert.equal(sospetto.assignedAt, null);
    assert.equal(sospetto.phoneSuspicious, true);
    const senzaBot = buildLancioLeadRow({ id: 'L3', name: 'X', phone: '3331234567', email: null, acContactId: '2', phoneSuspicious: false, botId: null, now: NOW });
    assert.equal(senzaBot.assignedToId, null);
    assert.equal(senzaBot.assignedAt, null);
});

// ------------------------------------------------------------ eventi

test('eventi intake con bot: IMPORTED + ASSIGNED(routing=lancio) + LANCIO_INTAKE', () => {
    const rows = buildLancioIntakeEventRows({ leadId: 'L1', botId: 'BOT', adminId: null, acContactId: '999', source: 'activecampaign', via: 'payload', listId: '132', now: NOW });
    assert.deepEqual(rows.map(r => r.eventType), ['IMPORTED', 'ASSIGNED', 'LANCIO_INTAKE']);
    for (const r of rows) {
        assert.equal(r.leadId, 'L1');
        assert.equal(r.companyId, 'fenice');
        assert.equal(r.timestamp, NOW);
        assert.equal(typeof r.id, 'string');
        assert.ok(r.id.length > 10);
    }
    assert.equal(rows[0].toSection, 'Prima Chiamata');
    assert.deepEqual(rows[0].metadata, { source: 'activecampaign', acContactId: '999', provenienza: 'Lancio Web Dev AI', lancio: true });
    assert.deepEqual(rows[1].metadata, { assignedToUser: 'BOT', source: 'activecampaign', routing: 'lancio' });
    assert.deepEqual(rows[2].metadata, { slug: 'webdev-2026-10', ingresso: 'lista', via: 'payload', listId: '132', assegnatoAlBot: true });
});

test('eventi intake senza bot: niente ASSIGNED, LANCIO_INTAKE dice assegnatoAlBot=false', () => {
    const rows = buildLancioIntakeEventRows({ leadId: 'L3', botId: null, adminId: 'ADM', acContactId: null, source: 'lancio_sync', via: 'sync', listId: null, now: NOW });
    assert.deepEqual(rows.map(r => r.eventType), ['IMPORTED', 'LANCIO_INTAKE']);
    assert.equal(rows[0].userId, 'ADM');
    assert.equal(rows[1].userId, 'ADM');
    assert.deepEqual(rows[1].metadata, { slug: 'webdev-2026-10', ingresso: 'lista', via: 'sync', listId: null, assegnatoAlBot: false });
});

test('gli id degli eventi sono tutti diversi (bulk insert su primary key)', () => {
    const rows = buildLancioIntakeEventRows({ leadId: 'L1', botId: 'BOT', adminId: null, acContactId: null, source: 'lancio_sync', via: 'sync', listId: null, now: NOW });
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
});
```

- [ ] **Step 2: Aggiungere il test alla lista in `package.json` e verificare che fallisca**

In `package.json`, `scripts.test`: appendere ` src/lib/lancio/intake.test.ts` in fondo alla stringa (dopo `src/lib/biweeklyCycle.test.ts`).

Run: `node --import tsx --test src/lib/lancio/intake.test.ts`
Expected: FAIL — `Cannot find module './intake'`.

- [ ] **Step 3: Scrivere `src/lib/lancio/intake.ts`**

```ts
/**
 * Lancio "Web Developer AI" — webinar del 5 ottobre 2026 (spec 2026-09-14).
 *
 * Qui sta SOLO logica pura: costanti con i nomi della spec, l'interruttore,
 * la decisione "questo contatto AC e' un lead del lancio?", il campo `lancio`
 * del payload intake e i costruttori delle righe (lead ed eventi) che il
 * webhook e il sync di recupero scrivono. Niente DB, niente rete: e' il
 * pezzo che si puo' sbagliare in silenzio, quindi e' quello testato.
 */

// Niente `import crypto from 'crypto'`: questo modulo lo importa anche la card
// client (LANCIO_BUCKET) e un builtin Node non entra nel bundle del browser.
// globalThis.crypto.randomUUID c'e' in Node 20 e in tutti i browser.
const uuid = () => globalThis.crypto.randomUUID();

export const LANCIO_FUNNEL = 'Lancio Web Dev AI';
export const LANCIO_BUCKET = 'LANCIO_WEBDEV_2026';
export const LANCIO_SLUG = 'webdev-2026-10';
/** Nome della lista AC (oggi id 132), normalizzato trim+lowercase come le liste bloccate. */
export const LANCIO_LIST_NAME_NORMALIZED = 'lancio web developer ai';
export const LANCIO_POOL_LABEL = 'Lancio Web Dev AI 2026';
/** La lista vive sull'account AC Fenice: il lancio e' solo Fenice. */
export const LANCIO_COMPANY = 'fenice';

export type LancioIngresso = 'lista' | 'pulsante_webinar';

/** Campo opzionale `lancio` di BotIntakePayload (contratto v1.6 §6.1). */
export interface LancioPayloadField {
    slug: string;
    ingresso: LancioIngresso;
}

/**
 * Interruttore del ramo lancio nel webhook AC. SOLO la stringa esatta 'on':
 * una env scritta a meta' ('On', 'true') deve lasciare la lista bloccata,
 * che e' il comportamento sicuro (i lead restano in AC e si recuperano col sync).
 */
export function isLancioIntakeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.LANCIO_WEBDEV_INTAKE === 'on';
}

export type LancioDecision =
    | { lancio: true; via: 'payload' | 'membership'; listId: string }
    | { lancio: false; motivo: 'spento' | 'lista_sconosciuta' | 'non_in_lista' };

/**
 * "E' un lead del lancio?" con le stesse due strade delle liste bloccate:
 * fastpath sul campo `list` del payload, poi le membership del contatto.
 * `activeListIds` a null = membership non ancora lette: il chiamante riceve
 * 'non_in_lista' e decide se pagare la chiamata AC per leggerle.
 */
export function decideLancioIntake(args: {
    enabled: boolean;
    lancioListId: string | null;
    triggerListId: string | null;
    activeListIds: ReadonlySet<string> | null;
}): LancioDecision {
    const { enabled, lancioListId, triggerListId, activeListIds } = args;
    if (!enabled) return { lancio: false, motivo: 'spento' };
    if (!lancioListId) return { lancio: false, motivo: 'lista_sconosciuta' };
    if (triggerListId && String(triggerListId) === lancioListId) {
        return { lancio: true, via: 'payload', listId: lancioListId };
    }
    if (activeListIds && activeListIds.has(lancioListId)) {
        return { lancio: true, via: 'membership', listId: lancioListId };
    }
    return { lancio: false, motivo: 'non_in_lista' };
}

export function lancioPayloadField(ingresso: LancioIngresso): LancioPayloadField {
    return { slug: LANCIO_SLUG, ingresso };
}

/**
 * Il campo `lancio` per un lead letto dal DB: presente solo nel bucket del
 * lancio. Un `lancioIngresso` assente o sconosciuto ricade su 'lista', perche'
 * i lead del bucket nascono tutti dalla lista; 'pulsante_webinar' lo scrive
 * solo /api/bot/lead-entrante (B2/B5).
 */
export function lancioFieldForLead(lead: { launchBucket: string | null; lancioIngresso: string | null }): LancioPayloadField | undefined {
    if (lead.launchBucket !== LANCIO_BUCKET) return undefined;
    const ingresso: LancioIngresso = lead.lancioIngresso === 'pulsante_webinar' ? 'pulsante_webinar' : 'lista';
    return lancioPayloadField(ingresso);
}

export interface LancioLeadInput {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    acContactId: string | null;
    phoneSuspicious: boolean;
    /** null = account bot non trovato: il lead resta nel bucket senza padrone. */
    botId: string | null;
    now: Date;
    utm?: {
        utmSource?: string | null;
        utmMedium?: string | null;
        utmCampaign?: string | null;
        utmContent?: string | null;
        utmTerm?: string | null;
    };
}

/** Shape della riga `leads` che scrivono webhook e sync (sottoinsieme di leads.$inferInsert). */
export interface LancioLeadRow {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    funnel: string;
    source: string;
    acContactId: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    phoneSuspicious: boolean;
    launchBucket: string;
    lancioIngresso: LancioIngresso;
    status: string;
    callCount: number;
    assignedToId: string | null;
    assignedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    companyId: string;
}

/**
 * Riga lead del lancio. Telefono sospetto → nel bucket senza padrone, come
 * la quarantena del flusso normale (una chat su 0000000000 non esiste).
 * Bot assente → idem, il sync lo assegnera' quando l'account c'e'.
 * `assignedAt` = adesso SOLO se assegnato: e' la data con cui il lead viene
 * contato nel mese (regola magazzino, §4.8).
 */
export function buildLancioLeadRow(input: LancioLeadInput): LancioLeadRow {
    const assegnabile = !input.phoneSuspicious && !!input.botId;
    return {
        id: input.id,
        name: input.name,
        phone: input.phone,
        email: input.email,
        funnel: LANCIO_FUNNEL,
        source: 'activecampaign',
        acContactId: input.acContactId,
        utmSource: input.utm?.utmSource ?? null,
        utmMedium: input.utm?.utmMedium ?? null,
        utmCampaign: input.utm?.utmCampaign ?? null,
        utmContent: input.utm?.utmContent ?? null,
        utmTerm: input.utm?.utmTerm ?? null,
        phoneSuspicious: input.phoneSuspicious,
        launchBucket: LANCIO_BUCKET,
        lancioIngresso: 'lista',
        status: 'NEW',
        callCount: 0,
        assignedToId: assegnabile ? input.botId : null,
        assignedAt: assegnabile ? input.now : null,
        createdAt: input.now,
        updatedAt: input.now,
        companyId: LANCIO_COMPANY,
    };
}

/** Stessa shape di leadEvents.$inferInsert, costruita a mano come in pickAndAssignBuckets. */
export interface LeadEventRow {
    id: string;
    leadId: string;
    eventType: 'IMPORTED' | 'ASSIGNED' | 'LANCIO_INTAKE';
    userId: string | null;
    fromSection: string | null;
    toSection: string | null;
    metadata: Record<string, unknown>;
    timestamp: Date;
    companyId: string;
}

/**
 * Gli eventi dell'ingresso di un lead lancio: IMPORTED (come il webhook),
 * ASSIGNED con routing='lancio' (solo se c'e' il bot), LANCIO_INTAKE.
 * Tornano come righe, non vengono scritte: il sync le inserisce a chunk di 500.
 */
export function buildLancioIntakeEventRows(args: {
    leadId: string;
    botId: string | null;
    adminId: string | null;
    acContactId: string | null;
    source: 'activecampaign' | 'lancio_sync';
    via: 'payload' | 'membership' | 'sync';
    listId: string | null;
    now: Date;
}): LeadEventRow[] {
    const base = {
        leadId: args.leadId,
        userId: args.adminId,
        fromSection: null,
        timestamp: args.now,
        companyId: LANCIO_COMPANY,
    };
    const rows: LeadEventRow[] = [{
        ...base,
        id: uuid(),
        eventType: 'IMPORTED',
        toSection: 'Prima Chiamata',
        metadata: { source: args.source, acContactId: args.acContactId, provenienza: LANCIO_FUNNEL, lancio: true },
    }];
    if (args.botId) {
        rows.push({
            ...base,
            id: uuid(),
            eventType: 'ASSIGNED',
            toSection: null,
            metadata: { assignedToUser: args.botId, source: args.source, routing: 'lancio' },
        });
    }
    rows.push({
        ...base,
        id: uuid(),
        eventType: 'LANCIO_INTAKE',
        toSection: null,
        metadata: { slug: LANCIO_SLUG, ingresso: 'lista', via: args.via, listId: args.listId, assegnatoAlBot: !!args.botId },
    });
    return rows;
}
```

- [ ] **Step 4: Eseguire i test**

Run: `node --import tsx --test src/lib/lancio/intake.test.ts`
Expected: tutti PASS (16 test).

Run: `npm test`
Expected: PASS, e il conteggio include i 16 nuovi.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lancio/intake.ts src/lib/lancio/intake.test.ts package.json
git commit -m "feat(lancio): modulo puro di ingresso (interruttore, decisione lista, riga lead, eventi)"
```

---

### Task 3: Campo `lancio` nel payload intake + audit + regola "non si rispinge"

**Files:**
- Modify: `src/lib/bot-fissatore/types.ts:20-38` (`BotIntakePayload`)
- Modify: `src/lib/bot-fissatore/pushAudit.ts` (aggiunte in fondo)
- Modify: `src/lib/bot-fissatore/pushAudit.test.ts` (aggiunte in fondo)
- Modify: `src/lib/bot-fissatore/push.ts:32-45` (`auditPush`)
- Modify: `src/app/api/admin/bot-push-leads/route.ts:51-73`

**Interfaces:**
- Consumes: `LancioPayloadField`, `lancioFieldForLead` da `@/lib/lancio/intake` (Task 2); `DELIVERED_PUSH_RESULTS` esistente.
- Produces:
  ```ts
  // types.ts
  interface BotIntakePayload { ...; lancio?: LancioPayloadField }
  // pushAudit.ts
  export const NO_REPUSH_RESULTS = ['sent', 'duplicate', 'network_error'] as const;
  export const NO_REPUSH_RESULTS_SQL: string; // "'sent', 'duplicate', 'network_error'"
  export function withLancioAudit<T extends object>(meta: T, payload: { lancio?: LancioPayloadField }, at: Date): T & { at: string; lancio?: string };
  ```
  Ogni evento `BOT_PUSHED` di un lead lancio porta `metadata.lancio = 'webdev-2026-10'` (query per il monitor B3: `metadata->>'lancio' = 'webdev-2026-10'`).

- [ ] **Step 1: Aggiungere i test a `pushAudit.test.ts`**

Cambiare l'import in cima al file in:

```ts
import {
    DELIVERED_PUSH_RESULTS, DELIVERED_PUSH_RESULTS_SQL, isDeliveredPushResult,
    NO_REPUSH_RESULTS, NO_REPUSH_RESULTS_SQL, withLancioAudit,
} from './pushAudit'
```

e aggiungere in fondo:

```ts
test('non si rispinge chi e consegnato E chi e finito in network_error (un timeout e gia arrivato)', () => {
    assert.deepEqual([...NO_REPUSH_RESULTS], ['sent', 'duplicate', 'network_error'])
    for (const r of DELIVERED_PUSH_RESULTS) {
        assert.ok((NO_REPUSH_RESULTS as readonly string[]).includes(r), `${r} consegnato deve essere anche non-rispingibile`)
    }
    assert.equal(NO_REPUSH_RESULTS_SQL, "'sent', 'duplicate', 'network_error'")
    assert.ok(NO_REPUSH_RESULTS.every(r => /^[a-z_]+$/.test(r)), 'valori interpolati in sql.raw: solo lettere')
})

test('withLancioAudit: sui lead lancio l audit BOT_PUSHED porta lo slug, sugli altri no', () => {
    const at = new Date('2026-09-16T10:00:00Z')
    const conLancio = withLancioAudit({ result: 'sent', status: 200 }, { lancio: { slug: 'webdev-2026-10', ingresso: 'lista' } }, at)
    assert.deepEqual(conLancio, { result: 'sent', status: 200, at: '2026-09-16T10:00:00.000Z', lancio: 'webdev-2026-10' })
    const senza = withLancioAudit({ result: 'sent', status: 200 }, {}, at)
    assert.deepEqual(senza, { result: 'sent', status: 200, at: '2026-09-16T10:00:00.000Z' })
    assert.equal('lancio' in senza, false)
})
```

- [ ] **Step 2: Verificare che fallisca**

Run: `node --import tsx --test src/lib/bot-fissatore/pushAudit.test.ts`
Expected: FAIL — `NO_REPUSH_RESULTS`/`withLancioAudit` non esportati.

- [ ] **Step 3: `types.ts` — il campo `lancio`**

In cima a `src/lib/bot-fissatore/types.ts`:

```ts
import type { LancioPayloadField } from '@/lib/lancio/intake';
```

In fondo a `BotIntakePayload` (dopo `previousLeadIds?`):

```ts
    /**
     * Lancio (contratto v1.6, spec 2026-09-14 §6.1). Presente SOLO sui lead del
     * lancio: il bot apre con il template di benvenuto del lancio invece
     * dell'apertura di Mario. Assente = flusso attuale, invariato.
     */
    lancio?: LancioPayloadField;
```

- [ ] **Step 4: `pushAudit.ts` — le due aggiunte**

In cima al file (sopra il commento di intestazione):

```ts
import type { LancioPayloadField } from '@/lib/lancio/intake';
```

In fondo al file:

```ts
/**
 * Esiti di push dopo i quali un lead NON va rispinto dai percorsi a lotti
 * (sync di recupero del lancio, push admin). I consegnati ovviamente; e in piu'
 * `network_error`, perche' un timeout nostro non dice che la richiesta non sia
 * arrivata: il 09/09 42 persone hanno ricevuto due aperture WhatsApp proprio
 * cosi'. Un lead in network_error si ripassa a mano, guardando la chat.
 */
export const NO_REPUSH_RESULTS = ['sent', 'duplicate', 'network_error'] as const;

export const NO_REPUSH_RESULTS_SQL = NO_REPUSH_RESULTS
    .map(r => `'${r}'`)
    .join(', ');

/**
 * Metadata dell'evento BOT_PUSHED: l'esito, l'istante e — sui lead del lancio —
 * lo slug, cosi' il monitor del lancio conta i push suoi con una sola query
 * (`metadata->>'lancio' = 'webdev-2026-10'`) senza join sui lead.
 */
export function withLancioAudit<T extends object>(
    meta: T,
    payload: { lancio?: LancioPayloadField },
    at: Date,
): T & { at: string; lancio?: string } {
    return {
        ...meta,
        at: at.toISOString(),
        ...(payload.lancio ? { lancio: payload.lancio.slug } : {}),
    };
}
```

- [ ] **Step 5: `push.ts` — usare `withLancioAudit` in `auditPush`**

Aggiungere l'import `import { withLancioAudit } from './pushAudit';` e sostituire il corpo di `auditPush`:

```ts
async function auditPush(payload: BotIntakePayload, meta: PushResult): Promise<void> {
    try {
        await logLeadEvent({
            leadId: payload.leadId,
            eventType: 'BOT_PUSHED',
            companyId: payload.companyId,
            metadata: withLancioAudit(meta, payload, new Date()),
        });
    } catch (e) {
        console.error('[bot-fissatore] audit log failed', e);
    }
}
```

Nota: `pushLeadToBot` costruisce `enriched = { ...payload, ... }` e serializza `enriched`: il campo `lancio` viaggia nel body senza altre modifiche. `pushLeadsToBotPaced` passa i payload così come sono: nessuna modifica.

- [ ] **Step 6: `bot-push-leads/route.ts` — i lead lancio spinti a mano portano `lancio`**

Aggiungere l'import `import { lancioFieldForLead } from '@/lib/lancio/intake';`. Nella select dei candidati aggiungere le colonne:

```ts
        launchBucket: leads.launchBucket,
        lancioIngresso: leads.lancioIngresso,
```

e nel map del push:

```ts
    const { results, remaining } = await pushLeadsToBotPaced(candidates.map(c => ({
        leadId: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        funnel: c.funnel,
        companyId: c.companyId,
        // Un lead del lancio spinto a mano deve arrivare al bot come lancio,
        // altrimenti riceve l'apertura di Mario invece del benvenuto del lancio.
        lancio: lancioFieldForLead(c),
    })));
```

- [ ] **Step 7: Test e compilazione**

Run: `node --import tsx --test src/lib/bot-fissatore/pushAudit.test.ts`
Expected: PASS (7 test).

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 8: Commit**

```bash
git add src/lib/bot-fissatore/types.ts src/lib/bot-fissatore/pushAudit.ts src/lib/bot-fissatore/pushAudit.test.ts src/lib/bot-fissatore/push.ts src/app/api/admin/bot-push-leads/route.ts
git commit -m "feat(lancio): campo lancio nel payload intake, slug nell'audit BOT_PUSHED, regola non-rispingere"
```

---

### Task 4: Webhook AC — ramo lancio prima delle liste bloccate

**Files:**
- Modify: `src/app/api/webhooks/activecampaign/route.ts` (righe 16-25 import; 97-152 cache liste; 303-351 ramo liste bloccate; nuova funzione `handleLancioIntake` prima di `POST`)

**Interfaces:**
- Consumes: `isLancioIntakeEnabled`, `decideLancioIntake`, `buildLancioLeadRow`, `buildLancioIntakeEventRows`, `lancioPayloadField`, `LANCIO_LIST_NAME_NORMALIZED`, `LANCIO_BUCKET`, `LANCIO_FUNNEL`, `LancioDecision` (Task 2); `pushLeadToBot` con `lancio` (Task 3); `leads`, `leadEvents`, `users` dallo schema; `normalizePhoneStrict/Lenient`, `isPlausiblePhone`, `recordFailure`, `readFieldLocal`, `UTM_FIELD_IDS` già nel file.
- Produces: risposte JSON nuove del webhook: `{ success: true, leadId, lancio: true, funnel, phoneSuspicious, assignedTo: <botId|null>, via }`, `{ skipped: 'lancio_duplicate', acContactId, existingLeadId }`, `{ skipped: 'lancio_update', acContactId }`; eventi `IMPORTED` + `ASSIGNED` (`metadata.routing='lancio'`) + `LANCIO_INTAKE`; evento `BOT_PUSHED` con `metadata.lancio`.

- [ ] **Step 1: Import**

Sostituire le righe 16-25 con:

```ts
import { after, NextRequest, NextResponse } from "next/server";
import { pushLeadToBot } from "@/lib/bot-fissatore/push";
import { isBotHolidayWindow } from "@/lib/bot-fissatore/holidayWindow";
import { getLeadRouting, BOT_DAILY_MIN, type LeadRouting } from "@/lib/bot-fissatore/leadRouting";
import {
    isLancioIntakeEnabled, decideLancioIntake, buildLancioLeadRow, buildLancioIntakeEventRows,
    lancioPayloadField, LANCIO_LIST_NAME_NORMALIZED, LANCIO_BUCKET, LANCIO_FUNNEL, type LancioDecision,
} from "@/lib/lancio/intake";
import { db } from "@/db";
import { leads, leadEvents, users, acIntakeFailures, notifications } from "@/db/schema";
import { eq, and, asc, sql, isNull, gte, desc, or, like } from "drizzle-orm";
import crypto from "crypto";
import { logLeadEvent } from "@/lib/eventLogger";
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize";
```

- [ ] **Step 2: Cache liste condivisa (sostituisce `getBlockedListIds` + `isContactInBlockedList`, righe 97-152)**

```ts
// Cache in-memory nome-normalizzato → id di TUTTE le liste AC. Si ripopola
// da AC ogni 10 min per tollerare rinomine/aggiunte senza redeploy. Pagina
// fino a 500 liste (5 pagine da 100). Serve sia alle liste bloccate sia alla
// lista del lancio: una sola chiamata AC per entrambe.
let listIdsByNameCache: { byName: Map<string, string>; expires: number } | null = null;
async function getListIdsByName(): Promise<Map<string, string>> {
    const now = Date.now();
    if (listIdsByNameCache && listIdsByNameCache.expires > now) {
        return listIdsByNameCache.byName;
    }
    const byName = new Map<string, string>();
    try {
        for (let offset = 0; offset < 500; offset += 100) {
            const res = await acGet(`/lists?limit=100&offset=${offset}`);
            const lists = Array.isArray(res.lists) ? res.lists : [];
            if (lists.length === 0) break;
            for (const l of lists) {
                const nameNorm = String(l?.name ?? '').trim().toLowerCase();
                if (nameNorm && l?.id != null) byName.set(nameNorm, String(l.id));
            }
            if (lists.length < 100) break;
        }
    } catch (e) {
        console.error('[AC webhook] getListIdsByName error:', e);
    }
    listIdsByNameCache = { byName, expires: now + 10 * 60 * 1000 };
    return byName;
}

async function getBlockedListIds(): Promise<Set<string>> {
    if (BLOCKED_LIST_NAMES_NORMALIZED.size === 0) return new Set();
    const byName = await getListIdsByName();
    const ids = new Set<string>();
    for (const name of BLOCKED_LIST_NAMES_NORMALIZED) {
        const id = byName.get(name);
        if (id) ids.add(id);
    }
    return ids;
}

/** Id della lista del lancio (per nome normalizzato), o null se su AC non c'e'. */
async function getLancioListId(): Promise<string | null> {
    const byName = await getListIdsByName();
    return byName.get(LANCIO_LIST_NAME_NORMALIZED) ?? null;
}

/**
 * Le liste a cui il contatto e' iscritto con stato attivo (status '1'), via
 * /contacts/{id}/contactLists. Una chiamata sola, riusata dal ramo lancio e
 * dal ramo liste bloccate. In errore torna un set vuoto (come prima: il
 * contatto passa, non e' bloccato).
 */
async function getContactActiveListIds(contactId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
        const res = await acGet(`/contacts/${contactId}/contactLists`);
        const memberships = Array.isArray(res.contactLists) ? res.contactLists : [];
        for (const m of memberships) {
            const listId = String(m?.list ?? '');
            const status = String(m?.status ?? '');
            if (listId && status === '1') ids.add(listId);
        }
    } catch (e) {
        console.error(`[AC webhook] getContactActiveListIds error for contact ${contactId}:`, e);
    }
    return ids;
}

/** La prima lista bloccata fra le membership attive del contatto, o null. */
function blockedListOf(activeListIds: Set<string>, blocked: Set<string>): string | null {
    for (const id of activeListIds) if (blocked.has(id)) return id;
    return null;
}
```

- [ ] **Step 3: Il ramo nel `POST` (sostituisce le righe 303-351)**

```ts
        const triggerListId = rawPayload['list'] || rawPayload['list[id]'] || null;

        // ===== RAMO LANCIO (spec 2026-09-14 §4.1) — PRIMA delle liste bloccate =====
        // La lista del lancio sta ANCHE nel default di BLOCKED_LIST_NAMES_NORMALIZED:
        // a interruttore spento (LANCIO_WEBDEV_INTAKE != 'on') si cade nel ramo
        // sotto e il contatto finisce in acIntakeFailures come oggi, da dove il
        // sync di recupero su /import lo ripesca. Le membership del contatto si
        // leggono UNA volta e si riusano per il controllo delle liste bloccate.
        const lancioEnabled = isLancioIntakeEnabled();
        const lancioListId = lancioEnabled ? await getLancioListId() : null;
        let activeListIds: Set<string> | null = null;
        let lancioDecision: LancioDecision = decideLancioIntake({
            enabled: lancioEnabled, lancioListId, triggerListId, activeListIds: null,
        });
        if (!lancioDecision.lancio && lancioDecision.motivo === 'non_in_lista') {
            activeListIds = await getContactActiveListIds(contactId);
            lancioDecision = decideLancioIntake({ enabled: lancioEnabled, lancioListId, triggerListId, activeListIds });
        }
        if (lancioDecision.lancio) {
            if (eventType === 'update') {
                // Un update su un contatto del lancio non ha niente da aggiornare
                // (il funnel non e' SCONOSCIUTO) e NON deve produrre una riga
                // blocked_list in /lead-automatici.
                return NextResponse.json({ skipped: 'lancio_update', acContactId: contactId });
            }
            return await handleLancioIntake(contactId, rawPayload, lancioDecision);
        }

        // Lista sorgente del subscribe: se corrisponde a una lista
        // bloccata (es. campagna lancio futuro) skippiamo senza creare
        // lead né failure record. Non è un errore: è intenzionale.
        //
        // Strategia a 2 livelli:
        // 1. Prima fastpath: se il payload include `list` e matcha una
        //    lista bloccata, skippa subito senza chiamate extra.
        // 2. Fallback: interroga /contacts/{id}/contactLists. Necessario
        //    perché alcune configurazioni AC (o trigger indiretti tipo
        //    automazione che aggiunge il contatto alla lista) NON
        //    includono `list` nel payload webhook — si era visto su 2
        //    lead della lista 'Lead Lancio Video Editor 2026' passati
        //    al CRM il 2026-04-24 nonostante il filtro.
        const blocked = await getBlockedListIds();
        if (triggerListId && blocked.has(String(triggerListId))) {
            console.log(`[AC webhook] skip contact ${contactId} — lista bloccata (payload) ${triggerListId}`);
            // Tracciato in acIntakeFailures (reason 'blocked_list:<id>') così l'admin
            // lo vede in /lead-automatici invece che sparire in silenzio. Escluso da
            // "Riprova tutti" (rifinirebbe bloccato in loop): recuperabile solo col
            // retry singolo, per quando la lista viene sbloccata. Con dedup: eventi
            // ripetuti sullo stesso contatto non accumulano righe.
            await recordBlockedListSkip(contactId, String(triggerListId), rawPayload);
            return NextResponse.json({
                skipped: 'blocked_list',
                listId: String(triggerListId),
                acContactId: contactId,
                via: 'payload',
            });
        }

        // Fallback membership check (run sempre, sia con che senza triggerListId,
        // perché il trigger potrebbe essere una lista non bloccata ma il
        // contatto potrebbe essere ANCHE in una bloccata).
        if (blocked.size > 0) {
            if (activeListIds === null) activeListIds = await getContactActiveListIds(contactId);
            const blockedListId = blockedListOf(activeListIds, blocked);
            if (blockedListId) {
                console.log(`[AC webhook] skip contact ${contactId} — lista bloccata (membership) ${blockedListId}`);
                await recordBlockedListSkip(contactId, blockedListId, rawPayload);
                return NextResponse.json({
                    skipped: 'blocked_list',
                    listId: blockedListId,
                    acContactId: contactId,
                    via: 'membership',
                });
            }
        }
```

Rimuovere la dichiarazione originale `const triggerListId = ...` (riga 316: ora sta sopra il ramo lancio). Il resto del `POST` (fetch contatto, update, subscribe, transazione con routing) resta identico.

- [ ] **Step 4: `handleLancioIntake` (nuova funzione, inserita prima di `export async function POST`)**

```ts
/**
 * Ingresso di un lead del lancio (spec §4.1). Bypassa fasce orarie, tetto del
 * bot, finestra ferie e acAutoIntake: va al bot e basta, e il bot lo riceve
 * subito con provenienza lancio. Dedup solo dentro il bucket (acContactId o
 * telefono): un contatto gia' lead di un altro funnel entra lo stesso
 * (duplicati cross-funnel voluti, decisione 14/09 n.1).
 */
async function handleLancioIntake(
    contactId: string,
    rawPayload: Record<string, string>,
    decision: Extract<LancioDecision, { lancio: true }>,
): Promise<NextResponse> {
    let contact: any = null;
    let fieldValues: Array<{ field: string; value: string | null }> = [];
    try {
        const [contactResp, fvResp] = await Promise.all([
            acGet(`/contacts/${contactId}`),
            acGet(`/contacts/${contactId}/fieldValues`),
        ]);
        contact = contactResp.contact;
        fieldValues = fvResp.fieldValues || [];
    } catch (apiErr) {
        await recordFailure({
            reason: `Errore fetch AC API: ${apiErr instanceof Error ? apiErr.message.substring(0, 200) : String(apiErr)}`,
            acContactId: contactId,
            payload: rawPayload,
        });
        return NextResponse.json({ error: 'ac api failure', retryable: true }, { status: 502 });
    }
    if (!contact) {
        await recordFailure({ reason: 'Contatto non trovato su AC', acContactId: contactId, payload: rawPayload });
        return NextResponse.json({ error: 'contact not found' }, { status: 404 });
    }

    const firstName = String(contact.firstName || '').trim();
    const lastName = String(contact.lastName || '').trim();
    const email = String(contact.email || '').trim() || null;
    const rawPhone = String(contact.phone || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome';

    if (!rawPhone) {
        await recordFailure({ reason: 'Telefono assente', acContactId: contactId, provenienza: LANCIO_FUNNEL, email, phoneRaw: null, payload: rawPayload });
        return NextResponse.json({ skipped: 'missing phone', lancio: true });
    }
    const phoneStrict = normalizePhoneStrict(rawPhone);
    const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone);
    const phoneFinal = phoneFinalNormalized?.startsWith('+39') ? phoneFinalNormalized.slice(3) : phoneFinalNormalized;
    if (!phoneFinal) {
        await recordFailure({ reason: `Telefono non utilizzabile (nessuna cifra): "${rawPhone}"`, acContactId: contactId, provenienza: LANCIO_FUNNEL, email, phoneRaw: rawPhone, payload: rawPayload });
        return NextResponse.json({ skipped: 'invalid phone', lancio: true });
    }
    const phoneSuspicious = !isPlausiblePhone(phoneStrict);

    const utm = {
        utmSource: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmSource),
        utmMedium: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmMedium),
        utmCampaign: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmCampaign),
        utmContent: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmContent),
        utmTerm: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmTerm),
    };

    const now = new Date();
    const newLeadId = crypto.randomUUID();

    const txResult = await db.transaction(async (tx) => {
        // Stessi lock del flusso normale: due webhook sullo stesso contatto o
        // numero non devono creare due lead nel bucket.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${phoneFinal}, 0))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contactId}, 1))`);

        const [existing] = await tx.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, FENICE_COMPANY),
            eq(leads.launchBucket, LANCIO_BUCKET),
            or(eq(leads.acContactId, contactId), eq(leads.phone, phoneFinal)),
        )).limit(1);
        if (existing) return { kind: 'duplicate' as const, existingLeadId: existing.id };

        const [bot] = await tx.select({ id: users.id }).from(users).where(and(
            eq(users.companyId, FENICE_COMPANY),
            eq(users.role, 'GDO'),
            eq(users.isBot, true),
            eq(users.isActive, true),
        )).limit(1);
        const botId = bot?.id ?? null;

        const row = buildLancioLeadRow({
            id: newLeadId, name: fullName, phone: phoneFinal, email,
            acContactId: contactId, phoneSuspicious, botId, now, utm,
        });
        await tx.insert(leads).values(row);
        if (row.assignedToId) {
            await tx.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, row.assignedToId));
        }
        return { kind: 'created' as const, assignedToId: row.assignedToId };
    });

    if (txResult.kind === 'duplicate') {
        return NextResponse.json({ skipped: 'lancio_duplicate', acContactId: contactId, existingLeadId: txResult.existingLeadId });
    }

    // Il push parte in after() a risposta inviata. Niente notifica al bot:
    // non legge la UI.
    if (txResult.assignedToId) {
        after(() => pushLeadToBot({
            leadId: newLeadId,
            name: fullName,
            phone: phoneFinal,
            email,
            funnel: LANCIO_FUNNEL,
            companyId: FENICE_COMPANY,
            lancio: lancioPayloadField('lista'),
        }));
    } else if (!phoneSuspicious) {
        console.error(`[AC webhook] lancio: account bot non trovato, lead ${newLeadId} nel bucket senza padrone`);
    }

    await db.insert(leadEvents).values(buildLancioIntakeEventRows({
        leadId: newLeadId,
        botId: txResult.assignedToId,
        adminId: null,
        acContactId: contactId,
        source: 'activecampaign',
        via: decision.via,
        listId: decision.listId,
        now,
    }));

    return NextResponse.json({
        success: true,
        leadId: newLeadId,
        lancio: true,
        funnel: LANCIO_FUNNEL,
        phoneSuspicious,
        assignedTo: txResult.assignedToId,
        via: decision.via,
    });
}
```

- [ ] **Step 5: Compilare e verificare che i test esistenti non cambino**

Run: `npx tsc --noEmit`
Expected: nessun errore. La riga `void isNull;` in fondo al file resta com'è.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verifica dal vivo in locale (interruttore spento = comportamento di oggi)**

Con `npm run dev` e `.env` locale (servono `ACTIVECAMPAIGN_WEBHOOK_SECRET` e `ACTIVECAMPAIGN_API_KEY`), SENZA `LANCIO_WEBDEV_INTAKE`. Prendere un contatto reale della lista 132 dalla tab Bloccati di `/lead-automatici` (colonna acContactId), poi:

```bash
curl -s -X POST "http://localhost:3000/api/webhooks/activecampaign?secret=$ACTIVECAMPAIGN_WEBHOOK_SECRET" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'type=subscribe&contact[id]=<ID>&list=132'
```

Expected: `{"skipped":"blocked_list","listId":"132","acContactId":"<ID>","via":"payload"}` — identico a oggi.

- [ ] **Step 7: Verifica dal vivo in locale (interruttore acceso)**

Aggiungere `LANCIO_WEBDEV_INTAKE=on` e `BOT_INTAKE_ENABLED=false` (per non spingere davvero) nel `.env` locale, riavviare `npm run dev`, ripetere la stessa curl.

Expected: `{"success":true,"leadId":"...","lancio":true,"funnel":"Lancio Web Dev AI","phoneSuspicious":false,"assignedTo":"<id GDO 201>","via":"payload"}`. Poi in SQL:

```sql
SELECT funnel, "launchBucket", "lancioIngresso", "assignedToId", "assignedAt" FROM leads WHERE id = '<leadId>';
SELECT "eventType", metadata FROM "leadEvents" WHERE "leadId" = '<leadId>' ORDER BY timestamp;
-- attesi: IMPORTED, ASSIGNED (routing=lancio), LANCIO_INTAKE (via=payload),
--         BOT_PUSHED (result=skipped_disabled, lancio=webdev-2026-10)
```

Ripetere la curl una seconda volta: expected `{"skipped":"lancio_duplicate",...}`. Ripetere con un altro contatto SENZA `list=132` (solo `type=subscribe&contact[id]=<ID2>`): expected `"via":"membership"`. Cancellare i lead di prova (`DELETE FROM leads WHERE id IN (...)`: gli eventi vanno in cascade) e togliere `LANCIO_WEBDEV_INTAKE` dal `.env`.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/webhooks/activecampaign/route.ts
git commit -m "feat(lancio): ramo lancio nel webhook AC prima delle liste bloccate, dietro LANCIO_WEBDEV_INTAKE"
```

---

### Task 5: Pool lancio — sync di recupero, push a lotti, distribuzione ai GDO

**Files:**
- Modify: `src/lib/launchPoolShared.ts` (aggiunta `findAcListIdByName`; `assignedAt` con `coalesce` in `pickAndAssignBuckets`, riga 74-76)
- Create: `src/app/actions/lancioPoolActions.ts`

**Interfaces:**
- Consumes: `LANCIO_FUNNEL`, `LANCIO_BUCKET`, `LANCIO_COMPANY`, `LANCIO_LIST_NAME_NORMALIZED`, `buildLancioLeadRow`, `buildLancioIntakeEventRows`, `lancioPayloadField` (Task 2); `pushLeadsToBotPaced` (push.ts); `NO_REPUSH_RESULTS_SQL` (Task 3); `pickAndAssignBuckets`, `acGet`, `AC_KEY` (launchPoolShared); `currentTenant`, `assertSalesArea`, `assertSingleCompany` (tenancy); `archiveLaunchPool` (databasePoolActions, esistente, riusato dalla card).
- Produces:
  ```ts
  // launchPoolShared.ts
  export async function findAcListIdByName(nameNormalized: string): Promise<string | null>;
  // lancioPoolActions.ts ('use server', solo async + type)
  export type LancioPoolStatus = { nelPool: number; alBot: number; spinti: number; restituiti: number; aiGdo: number; totale: number; intakeAttivo: boolean };
  export async function getLancioPoolStatus(): Promise<LancioPoolStatus | null>;   // null = azienda ≠ Fenice o pool archiviato
  export type LancioSyncReport = { ok: boolean; imported: number; skippedExisting: number; skippedNoPhone: number; totalOnList: number; senzaBot: number; errors: string[] };
  export async function syncLancioPool(): Promise<LancioSyncReport>;
  export type LancioPushReport = { ok: boolean; candidati: number; inviati: number; remaining: number; summary: Record<string, number>; errors: string[] };
  export async function pushLancioPoolToBot(): Promise<LancioPushReport>;
  export type LancioAssignReport = { ok: boolean; errors: string[]; perGdo: Record<string, { count: number; name: string }>; totalAssigned: number };
  export async function assignFromLancioPool(input: { count: number; gdoIds: string[] }): Promise<LancioAssignReport>;
  ```

- [ ] **Step 1: `launchPoolShared.ts` — `findAcListIdByName` e `assignedAt` che non si riscrive**

In fondo al file:

```ts
/**
 * Id di una lista AC dato il nome normalizzato (trim + lowercase), o null.
 * Stessa paginazione difensiva del webhook (5 pagine da 100).
 */
export async function findAcListIdByName(nameNormalized: string): Promise<string | null> {
    for (let offset = 0; offset < 500; offset += 100) {
        const res = await acGet(`/lists?limit=100&offset=${offset}`)
        const lists = Array.isArray(res.lists) ? res.lists : []
        if (lists.length === 0) break
        for (const l of lists) {
            const nameNorm = String(l?.name ?? '').trim().toLowerCase()
            if (nameNorm === nameNormalized && l?.id != null) return String(l.id)
        }
        if (lists.length < 100) break
    }
    return null
}
```

In `pickAndAssignBuckets`, sostituire `.set({ assignedToId: gdoId, assignedAt: new Date(), updatedAt: new Date() })` con:

```ts
                    // `assignedAt` è la data con cui il lead viene contato nel
                    // mese: qui è il momento vero di ingresso nel funnel, non
                    // l'import nel pool (che può essere di mesi prima).
                    // COALESCE: un lead che era già stato assegnato (il bot lo ha
                    // restituito al pool, spec lancio §4.6) era già stato contato
                    // quando è entrato in circolo la prima volta — regola 0027.
                    // Sui pool di oggi è un no-op: i lead non assegnati hanno
                    // assignedAt NULL.
                    .set({
                        assignedToId: gdoId,
                        assignedAt: sql`coalesce(${leads.assignedAt}, now())`,
                        updatedAt: new Date(),
                    })
```

- [ ] **Step 2: Scrivere `src/app/actions/lancioPoolActions.ts`**

```ts
"use server"

// Pool del lancio "Web Developer AI" (spec 2026-09-14 §4.1). Clone del
// pattern Black Summer con due differenze: i lead importati dal sync nascono
// ASSEGNATI AL BOT (non nel pool), e c'e' un'azione di push a lotti verso il
// bot. Il pool (lead non assegnati) contiene solo i telefoni sospetti, i lead
// entrati senza account bot e — dal B5 — i lead che il bot restituisce.
// Solo async function ed export type qui: e' un file 'use server'.

import { db } from "@/db"
import { leads, leadEvents, acIntakeFailures, launchPools, users } from "@/db/schema"
import { and, eq, isNull, sql, like, inArray, asc } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"
import crypto from "crypto"
import { currentTenant, assertSalesArea, assertSingleCompany } from "@/lib/tenancy"
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize"
import { pickAndAssignBuckets, acGet, AC_KEY, findAcListIdByName } from "@/lib/launchPoolShared"
import { pushLeadsToBotPaced } from "@/lib/bot-fissatore/push"
import { NO_REPUSH_RESULTS_SQL, DELIVERED_PUSH_RESULTS_SQL } from "@/lib/bot-fissatore/pushAudit"
import {
    LANCIO_BUCKET, LANCIO_COMPANY, LANCIO_LIST_NAME_NORMALIZED,
    isLancioIntakeEnabled, buildLancioLeadRow, buildLancioIntakeEventRows, lancioFieldForLead,
} from "@/lib/lancio/intake"

export type LancioPoolStatus = {
    /** Nel bucket, senza padrone: pescabili verso i GDO. */
    nelPool: number
    /** Assegnati al bot (consegnati o no). */
    alBot: number
    /** Con almeno un BOT_PUSHED consegnato (sent/duplicate). */
    spinti: number
    /** Eventi LANCIO_RETURNED_TO_POOL (scritti dal B5; qui vale 0 finche' non esiste). */
    restituiti: number
    /** Assegnati a un GDO umano. */
    aiGdo: number
    totale: number
    /** LANCIO_WEBDEV_INTAKE === 'on' sul server: la card lo mostra. */
    intakeAttivo: boolean
}

async function findBotId(): Promise<string | null> {
    const [bot] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, LANCIO_COMPANY),
        eq(users.role, 'GDO'),
        eq(users.isBot, true),
        eq(users.isActive, true),
    )).limit(1)
    return bot?.id ?? null
}

export async function getLancioPoolStatus(): Promise<LancioPoolStatus | null> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.companyId !== LANCIO_COMPANY) return null

    const [poolRow] = await db.select({ archivedAt: launchPools.archivedAt })
        .from(launchPools)
        .where(and(eq(launchPools.companyId, ctx.companyId), eq(launchPools.bucket, LANCIO_BUCKET)))
        .limit(1)
    if (poolRow?.archivedAt) return null

    const botId = await findBotId()
    const [counts] = await db.select({
        totale: sql<number>`count(*)::int`,
        nelPool: sql<number>`count(*) filter (where ${leads.assignedToId} is null)::int`,
        alBot: botId
            ? sql<number>`count(*) filter (where ${leads.assignedToId} = ${botId})::int`
            : sql<number>`0`,
        aiGdo: botId
            ? sql<number>`count(*) filter (where ${leads.assignedToId} is not null and ${leads.assignedToId} <> ${botId})::int`
            : sql<number>`count(*) filter (where ${leads.assignedToId} is not null)::int`,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.launchBucket, LANCIO_BUCKET),
    ))

    const [spintiRow] = await db.select({
        n: sql<number>`count(distinct ${leadEvents.leadId})::int`,
    }).from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.launchBucket, LANCIO_BUCKET),
            eq(leadEvents.eventType, 'BOT_PUSHED'),
            sql`${leadEvents.metadata}->>'result' IN (${sql.raw(DELIVERED_PUSH_RESULTS_SQL)})`,
        ))

    const [restituitiRow] = await db.select({
        n: sql<number>`count(distinct ${leadEvents.leadId})::int`,
    }).from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.launchBucket, LANCIO_BUCKET),
            eq(leadEvents.eventType, 'LANCIO_RETURNED_TO_POOL'),
        ))

    return {
        nelPool: counts?.nelPool ?? 0,
        alBot: counts?.alBot ?? 0,
        spinti: spintiRow?.n ?? 0,
        restituiti: restituitiRow?.n ?? 0,
        aiGdo: counts?.aiGdo ?? 0,
        totale: counts?.totale ?? 0,
        intakeAttivo: isLancioIntakeEnabled(),
    }
}

export type LancioSyncReport = {
    ok: boolean
    imported: number
    skippedExisting: number
    skippedNoPhone: number
    totalOnList: number
    /** Importati senza account bot: sono nel pool, non al bot. */
    senzaBot: number
    errors: string[]
}

/**
 * Sync di recupero dalla lista AC del lancio. Idempotente (dedup bucket +
 * telefono nel bucket, indice unico parziale sul re-check). I lead nuovi
 * nascono assegnati al bot; il push e' un'azione separata (pushLancioPoolToBot),
 * perche' il download AC puo' durare un minuto e il push a 30/min altri
 * quattro: insieme sforerebbero i 300 s della pagina.
 */
export async function syncLancioPool(): Promise<LancioSyncReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: LancioSyncReport = {
        ok: false, imported: 0, skippedExisting: 0, skippedNoPhone: 0, totalOnList: 0, senzaBot: 0, errors: [],
    }
    try {
        assertSingleCompany(ctx)
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== LANCIO_COMPANY) {
        report.errors.push("Il sync del lancio è disponibile solo con azienda attiva Fenice.")
        return report
    }
    if (!AC_KEY) {
        report.errors.push("ACTIVECAMPAIGN_API_KEY non configurata sul server.")
        return report
    }

    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const adminId = supabaseUser?.id ?? null

    let listId: string | null = null
    try {
        listId = await findAcListIdByName(LANCIO_LIST_NAME_NORMALIZED)
    } catch (e: any) {
        report.errors.push(`Errore AC durante la ricerca della lista: ${e?.message || e}`)
        return report
    }
    if (!listId) {
        report.errors.push(`Lista "Lancio Web Developer AI" non trovata su ActiveCampaign.`)
        return report
    }

    const botId = await findBotId()

    // Dedup SOLO dentro il bucket (acContactId e telefono): i duplicati
    // cross-funnel sono voluti (decisione 14/09 n.1).
    const existingRows = await db
        .select({ acContactId: leads.acContactId, phone: leads.phone })
        .from(leads)
        .where(and(eq(leads.companyId, ctx.companyId), eq(leads.launchBucket, LANCIO_BUCKET)))
    const existingIds = new Set(existingRows.map(r => r.acContactId).filter((x): x is string => !!x))
    const existingPhones = new Set(existingRows.map(r => r.phone))

    const now = new Date()
    const toInsert: ReturnType<typeof buildLancioLeadRow>[] = []
    const importedContactIds: string[] = []

    let hitPaginationCap = true
    try {
        // status=-1 = qualunque stato di iscrizione, unsubscribed inclusi (come
        // Black Summer). Hard-cap 20.000 contatti.
        for (let offset = 0; offset < 20000; offset += 100) {
            const page = await acGet(`/contacts?listid=${listId}&status=-1&limit=100&offset=${offset}`)
            const contacts = Array.isArray(page.contacts) ? page.contacts : []
            if (offset === 0) report.totalOnList = Number(page?.meta?.total ?? contacts.length) || contacts.length
            if (contacts.length === 0) { hitPaginationCap = false; break }

            for (const c of contacts) {
                const contactId = String(c?.id ?? '')
                if (!contactId) continue
                if (existingIds.has(contactId)) { report.skippedExisting++; continue }

                const rawPhone = String(c?.phone || '').trim()
                const phoneStrict = normalizePhoneStrict(rawPhone)
                const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone)
                const phoneFinal = phoneFinalNormalized?.startsWith('+39')
                    ? phoneFinalNormalized.slice(3)
                    : phoneFinalNormalized
                if (!rawPhone || !phoneFinal) { report.skippedNoPhone++; continue }
                if (existingPhones.has(phoneFinal)) { report.skippedExisting++; continue }

                const firstName = String(c?.firstName || '').trim()
                const lastName = String(c?.lastName || '').trim()
                const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome'
                const email = String(c?.email || '').trim() || null

                existingIds.add(contactId)
                existingPhones.add(phoneFinal)
                importedContactIds.push(contactId)
                toInsert.push(buildLancioLeadRow({
                    id: crypto.randomUUID(),
                    name: fullName,
                    phone: phoneFinal,
                    email,
                    acContactId: contactId,
                    phoneSuspicious: !isPlausiblePhone(phoneStrict),
                    botId,
                    now,
                }))
            }
            if (contacts.length < 100) { hitPaginationCap = false; break }
        }
        if (hitPaginationCap) {
            report.errors.push('Attenzione: raggiunto il limite di sicurezza di 20.000 contatti — lista non scaricata per intero, riclicca per verificare.')
        }
    } catch (e: any) {
        report.errors.push(`Errore AC durante il download dei contatti: ${e?.message || e} — importati quelli scaricati finora, riclicca per riprendere.`)
    }

    // Insert a chunk da 500 con ON CONFLICT DO NOTHING sull'indice parziale
    // leads_company_bucket_accontact_uq: un webhook o un secondo sync che ha
    // vinto la corsa non fa fallire questo. Gli eventi si scrivono SOLO per le
    // righe davvero inserite (returning).
    const insertedIds = new Set<string>()
    for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500)
        const inserted = await db.insert(leads).values(chunk)
            .onConflictDoNothing()
            .returning({ id: leads.id })
        for (const r of inserted) insertedIds.add(r.id)
        report.imported += inserted.length
        report.skippedExisting += chunk.length - inserted.length
    }

    // Eventi IMPORTED + ASSIGNED + LANCIO_INTAKE, bulk a chunk di 500 righe.
    const eventRows = toInsert
        .filter(row => insertedIds.has(row.id))
        .flatMap(row => buildLancioIntakeEventRows({
            leadId: row.id,
            botId: row.assignedToId,
            adminId,
            acContactId: row.acContactId,
            source: 'lancio_sync',
            via: 'sync',
            listId,
            now,
        }))
    for (let i = 0; i < eventRows.length; i += 500) {
        await db.insert(leadEvents).values(eventRows.slice(i, i + 500))
    }
    report.senzaBot = toInsert.filter(row => insertedIds.has(row.id) && !row.assignedToId && !row.phoneSuspicious).length
    if (report.senzaBot > 0) {
        report.errors.push(`${report.senzaBot} lead importati nel pool senza assegnazione: account bot (GDO 201) non trovato o disattivo.`)
    }

    // Il bot ha preso in carico questi lead adesso: allinea il round-robin.
    if (botId && report.imported > 0) {
        await db.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, botId))
    }

    // Risolvi le failure blocked_list dei contatti ora importati (spariscono
    // dal tab Bloccati di /lead-automatici).
    if (importedContactIds.length > 0) {
        for (let i = 0; i < importedContactIds.length; i += 500) {
            await db.update(acIntakeFailures)
                .set({ resolvedAt: new Date(), resolvedBy: adminId })
                .where(and(
                    eq(acIntakeFailures.companyId, ctx.companyId),
                    like(acIntakeFailures.reason, 'blocked_list:%'),
                    isNull(acIntakeFailures.resolvedAt),
                    inArray(acIntakeFailures.acContactId, importedContactIds.slice(i, i + 500)),
                ))
        }
    }

    revalidatePath('/', 'layout')
    report.ok = report.errors.length === 0
    return report
}

export type LancioPushReport = {
    ok: boolean
    /** Lead al bot, NEW, mai consegnati ne' in network_error: quelli da spingere. */
    candidati: number
    inviati: number
    /** Candidati non inviati per budget o rate limit: ricliccare. */
    remaining: number
    summary: Record<string, number>
    errors: string[]
}

/**
 * Spinge al bot, a 30/min, i lead del lancio assegnati al bot che non gli
 * sono mai arrivati. Ripetibile: ogni click riparte dai mancanti. Un lead
 * con BOT_PUSHED in sent/duplicate/network_error NON si rispinge
 * (NO_REPUSH_RESULTS); un http_error/rate_limited/skipped_disabled si'.
 * Massimo 500 candidati per click: con budget 240 s ne partono ~120.
 */
export async function pushLancioPoolToBot(): Promise<LancioPushReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: LancioPushReport = { ok: false, candidati: 0, inviati: 0, remaining: 0, summary: {}, errors: [] }
    try {
        assertSingleCompany(ctx)
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== LANCIO_COMPANY) {
        report.errors.push("Il push del lancio è disponibile solo con azienda attiva Fenice.")
        return report
    }
    const botId = await findBotId()
    if (!botId) {
        report.errors.push("Account bot (GDO 201) non trovato o disattivo.")
        return report
    }

    const candidates = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        companyId: leads.companyId,
        launchBucket: leads.launchBucket,
        lancioIngresso: leads.lancioIngresso,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.launchBucket, LANCIO_BUCKET),
        eq(leads.assignedToId, botId),
        eq(leads.status, 'NEW'),
        eq(leads.phoneSuspicious, false),
        sql`NOT EXISTS (
            SELECT 1 FROM "leadEvents" e
            WHERE e."leadId" = ${leads.id}
              AND e."eventType" = 'BOT_PUSHED'
              AND e.metadata->>'result' IN (${sql.raw(NO_REPUSH_RESULTS_SQL)})
        )`,
    )).orderBy(asc(leads.createdAt), asc(leads.id)).limit(500)

    report.candidati = candidates.length
    if (candidates.length === 0) { report.ok = true; return report }

    const { results, remaining } = await pushLeadsToBotPaced(candidates.map(c => ({
        leadId: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        funnel: c.funnel,
        companyId: c.companyId,
        lancio: lancioFieldForLead(c),
    })), { budgetMs: 240_000 })

    report.inviati = results.length
    report.remaining = remaining.length
    for (const r of results) report.summary[r.result] = (report.summary[r.result] ?? 0) + 1
    if (report.summary.skipped_disabled) {
        report.errors.push(`BOT_INTAKE_ENABLED non è 'true' sul server: ${report.summary.skipped_disabled} push saltati.`)
    }
    if (report.summary.rate_limited) {
        report.errors.push(`Il bot ha risposto 429 su ${report.summary.rate_limited} lead: aspetta un minuto e riclicca.`)
    }

    revalidatePath('/', 'layout')
    report.ok = report.errors.length === 0
    return report
}

export type LancioAssignReport = {
    ok: boolean
    errors: string[]
    perGdo: Record<string, { count: number, name: string }>
    totalAssigned: number
}

/** Distribuzione FIFO dei lead del pool (non assegnati) ai GDO scelti — come Black Summer. */
export async function assignFromLancioPool(input: { count: number; gdoIds: string[] }): Promise<LancioAssignReport> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const report: LancioAssignReport = { ok: false, errors: [], perGdo: {}, totalAssigned: 0 }
    try {
        assertSingleCompany(ctx)
    } catch (e: any) {
        report.errors.push(String(e?.message || e)); return report
    }
    if (ctx.companyId !== LANCIO_COMPANY) {
        report.errors.push("Il pool del lancio è disponibile solo con azienda attiva Fenice.")
        return report
    }
    const count = Math.max(0, Math.floor(input.count || 0))
    if (count === 0) {
        report.errors.push("Devi specificare almeno 1 lead da pescare.")
        return report
    }
    if (!input.gdoIds || input.gdoIds.length === 0) {
        report.errors.push("Devi selezionare almeno 1 GDO destinatario.")
        return report
    }

    const selectedGdos = (await db.select().from(users).where(and(
        eq(users.companyId, ctx.companyId),
        inArray(users.id, input.gdoIds),
        eq(users.role, 'GDO'),
        eq(users.isActive, true),
        // Mai il bot: dal pool si distribuisce agli umani.
        eq(users.isBot, false),
    )))
    if (selectedGdos.length === 0) {
        report.errors.push("Nessuno dei GDO selezionati è attivo.")
        return report
    }
    if (selectedGdos.length !== input.gdoIds.length) {
        report.errors.push(`${input.gdoIds.length - selectedGdos.length} GDO selezionati ignorati perché non attivi.`)
    }

    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const adminId = supabaseUser?.id

    for (const g of selectedGdos) {
        report.perGdo[g.id] = { count: 0, name: g.displayName || g.name || g.id }
    }

    const result = await pickAndAssignBuckets({
        companyId: ctx.companyId,
        requests: [{ bucket: LANCIO_BUCKET, count }],
        selectedGdos,
        adminId,
    })
    for (const [gdoId, n] of Object.entries(result.assigned[LANCIO_BUCKET] ?? {})) {
        report.perGdo[gdoId].count += n
    }
    report.totalAssigned = result.totalAssigned

    revalidatePath('/', 'layout')
    report.ok = report.totalAssigned > 0
    if (report.totalAssigned === 0 && report.errors.length === 0) {
        report.errors.push("Nessun lead pescato (il pool potrebbe essere vuoto).")
    }
    return report
}
```

- [ ] **Step 3: Compilare e testare**

Run: `npx tsc --noEmit`
Expected: nessun errore.

Run: `npm test`
Expected: PASS (nessun test tocca il DB).

- [ ] **Step 4: Verifica della regola magazzino (§4.8) — solo lettura, nessuna modifica attesa**

Run: `grep -rn "isNull(leads.launchBucket), isNotNull(leads.assignedToId)\|launchBucket} IS NULL\`, isNotNull(leads.assignedToId)" src/app/actions`
Expected: 6 occorrenze (`managerAdvancedActions.ts:210`, `managerOverviewActions.ts:215`, `marketingActions.ts:87` e `:247`, `panoramicaActions.ts:145` e `:969`, `targetActions.ts:322`). In tutte la condizione è `launchBucket IS NULL OR assignedToId IS NOT NULL`: un lead lancio assegnato al bot conta (il bot è un assegnatario, come dice la spec), un lead nel pool no. Con `assignedAt = now` alla prima assegnazione (Task 2 `buildLancioLeadRow`) e `coalesce` alla distribuzione (Step 1) la data di conteggio è quella del primo ingresso in circolo. Non serve alcuna modifica: annotarlo nel messaggio di commit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/launchPoolShared.ts src/app/actions/lancioPoolActions.ts
git commit -m "feat(lancio): sync di recupero dalla lista AC, push a lotti al bot e distribuzione dal pool

La regola magazzino (launchBucket IS NULL OR assignedToId IS NOT NULL) regge
senza modifiche: i lead lancio contano dall'assegnazione al bot, assignedAt
non si riscrive alla distribuzione (coalesce)."
```

---

### Task 6: Card "Pool Lancio Web Dev AI" su `/import`

**Files:**
- Create: `src/components/LancioPoolCard.tsx`
- Modify: `src/app/(dashboard)/import/ImportClient.tsx:20-21` (import) e `:541` (montaggio)

**Interfaces:**
- Consumes: `getLancioPoolStatus`, `syncLancioPool`, `pushLancioPoolToBot`, `assignFromLancioPool` e i loro tipi (Task 5); `getActiveGdosForImport` (importLeads); `archiveLaunchPool` (databasePoolActions); `LANCIO_BUCKET` (Task 2, importabile in un client component: modulo puro senza DB).
- Produces: componente `LancioPoolCard` (default export nominato), montato dopo `BlackSummerPoolCard`.

- [ ] **Step 1: Scrivere `src/components/LancioPoolCard.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Rocket, RefreshCw, Send, Users, AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react"
import {
    getLancioPoolStatus,
    syncLancioPool,
    pushLancioPoolToBot,
    assignFromLancioPool,
    type LancioPoolStatus,
    type LancioSyncReport,
    type LancioPushReport,
    type LancioAssignReport,
} from "@/app/actions/lancioPoolActions"
import { getActiveGdosForImport } from "@/app/actions/importLeads"
import { archiveLaunchPool } from "@/app/actions/databasePoolActions"
import { LANCIO_BUCKET } from "@/lib/lancio/intake"

type GdoInfo = { id: string, name: string | null, displayName: string | null, gdoCode: string | null, isActive: boolean | null }

/** Quanti giri di push a lotti consecutivi al massimo per un click (~120 lead a giro). */
const MAX_PUSH_ROUNDS = 10

export function LancioPoolCard() {
    const router = useRouter()
    const [status, setStatus] = useState<LancioPoolStatus | null | undefined>(undefined)
    const [gdos, setGdos] = useState<GdoInfo[]>([])
    const [count, setCount] = useState<number>(0)
    const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [pushing, setPushing] = useState(false)
    const [pushRound, setPushRound] = useState(0)
    const [archiving, setArchiving] = useState(false)
    const [report, setReport] = useState<LancioAssignReport | null>(null)
    const [syncReport, setSyncReport] = useState<LancioSyncReport | null>(null)
    const [pushReport, setPushReport] = useState<LancioPushReport | null>(null)

    useEffect(() => {
        Promise.all([getLancioPoolStatus(), getActiveGdosForImport()])
            .then(([s, g]) => { setStatus(s); setGdos(g as GdoInfo[]) })
    }, [])

    // undefined = loading, null = azienda ≠ Fenice o pool rimosso → card nascosta.
    // Resta visibile a pool vuoto: serve per il primo sync.
    if (status === undefined || status === null) return null

    const busy = loading || syncing || pushing || archiving
    const canSubmit = !busy && count > 0 && selectedGdoIds.size > 0
    const previewPerGdo = selectedGdoIds.size > 0 ? Math.round(count / selectedGdoIds.size) : 0

    const refresh = async () => {
        const fresh = await getLancioPoolStatus()
        setStatus(fresh)
        router.refresh()
    }

    const toggleGdo = (id: string) => {
        const next = new Set(selectedGdoIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedGdoIds(next)
    }
    const selectAll = () => setSelectedGdoIds(new Set(gdos.map(g => g.id)))
    const clearAll = () => setSelectedGdoIds(new Set())

    const handleSync = async () => {
        if (busy) return
        setSyncing(true)
        setSyncReport(null)
        try {
            const res = await syncLancioPool()
            setSyncReport(res)
            await refresh()
        } catch (e) {
            setSyncReport({ ok: false, imported: 0, skippedExisting: 0, skippedNoPhone: 0, totalOnList: 0, senzaBot: 0, errors: ['Errore imprevisto durante il sync: ' + String(e)] })
        } finally {
            setSyncing(false)
        }
    }

    // Un click = piu' giri finche' remaining torna 0 o compare un errore:
    // ogni giro e' una server action da ~4 minuti, il resto lo dichiara lui.
    const handlePush = async () => {
        if (busy) return
        setPushing(true)
        setPushReport(null)
        const totale: LancioPushReport = { ok: true, candidati: 0, inviati: 0, remaining: 0, summary: {}, errors: [] }
        try {
            for (let round = 1; round <= MAX_PUSH_ROUNDS; round++) {
                setPushRound(round)
                const res = await pushLancioPoolToBot()
                totale.candidati = Math.max(totale.candidati, res.candidati)
                totale.inviati += res.inviati
                totale.remaining = res.remaining
                for (const [k, v] of Object.entries(res.summary)) totale.summary[k] = (totale.summary[k] ?? 0) + v
                totale.errors.push(...res.errors)
                totale.ok = totale.ok && res.ok
                setPushReport({ ...totale })
                if (!res.ok || res.remaining === 0) break
            }
            await refresh()
        } catch (e) {
            setPushReport({ ...totale, ok: false, errors: [...totale.errors, 'Errore imprevisto durante il push: ' + String(e)] })
        } finally {
            setPushing(false)
            setPushRound(0)
        }
    }

    const handleAssign = async () => {
        if (!canSubmit) return
        if (count > 100 && !confirm(`Stai per assegnare ${count} lead in un colpo solo. Continuare?`)) return
        setLoading(true)
        setReport(null)
        try {
            const res = await assignFromLancioPool({ count, gdoIds: Array.from(selectedGdoIds) })
            setReport(res)
            if (res.ok) {
                setCount(0)
                await refresh()
            }
        } catch (e) {
            setReport({ ok: false, errors: ['Errore imprevisto durante l\'assegnazione: ' + String(e)], perGdo: {}, totalAssigned: 0 })
        } finally {
            setLoading(false)
        }
    }

    const handleArchive = async () => {
        if (busy || status.nelPool > 0) return
        if (!confirm("Rimuovere il pool del lancio da /import? I lead già assegnati e le loro statistiche restano intatti.")) return
        setArchiving(true)
        try {
            const res = await archiveLaunchPool(LANCIO_BUCKET)
            if (!res.ok) alert(res.error || 'Rimozione non riuscita.')
            else { setStatus(null); router.refresh() }
        } finally {
            setArchiving(false)
        }
    }

    const tiles: Array<{ label: string, value: number }> = [
        { label: 'Nel pool', value: status.nelPool },
        { label: 'Al bot', value: status.alBot },
        { label: 'Consegnati al bot', value: status.spinti },
        { label: 'Restituiti', value: status.restituiti },
        { label: 'Ai GDO', value: status.aiGdo },
    ]

    return (
        <div className="bg-gradient-to-br from-amber-50 to-white rounded-xl border-2 border-amber-300 shadow-sm p-6 space-y-5 mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                        <Rocket className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-ash-900">Pool Lancio Web Dev AI 2026</h2>
                        <p className="text-xs text-ash-500">
                            Lista AC &quot;Lancio Web Developer AI&quot; — funnel Lancio Web Dev AI, i lead vanno al bot.
                            {' '}Ingresso automatico dal webhook:{' '}
                            <span className={status.intakeAttivo ? 'font-bold text-green-700' : 'font-bold text-red-700'}>
                                {status.intakeAttivo ? 'ACCESO' : 'SPENTO'}
                            </span>
                            {' '}(LANCIO_WEBDEV_INTAKE)
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleArchive}
                        disabled={busy || status.nelPool > 0}
                        title={status.nelPool > 0 ? "Assegna tutti i lead del pool per poter rimuovere la card" : "Rimuovi il pool da questa pagina"}
                        className="flex items-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <Trash2 className="h-3.5 w-3.5" /> Rimuovi pool
                    </button>
                    <button
                        onClick={handleSync}
                        disabled={busy}
                        className="flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {syncing
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sincronizzazione...</>
                            : <><RefreshCw className="h-3.5 w-3.5" /> Sincronizza lista lancio da ActiveCampaign</>}
                    </button>
                    <button
                        onClick={handlePush}
                        disabled={busy || status.alBot === 0}
                        title={status.alBot === 0 ? "Nessun lead assegnato al bot da spingere" : "Spinge al bot (30/min) i lead che non gli sono ancora arrivati"}
                        className="flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold text-white bg-amber-600 border border-amber-700 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {pushing
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Push in corso (giro {pushRound})...</>
                            : <><Send className="h-3.5 w-3.5" /> Spingi al bot i mancanti</>}
                    </button>
                </div>
            </div>

            {syncReport && (
                <div className={`p-3 rounded-lg border text-xs ${syncReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {syncReport.ok ? 'Sync completato' : 'Sync con avvisi'}
                        {' — '}{syncReport.imported} importati (al bot), {syncReport.skippedExisting} già presenti, {syncReport.skippedNoPhone} senza telefono (lista AC: {syncReport.totalOnList})
                    </div>
                    {syncReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                    {syncReport.imported > 0 && <div className="mt-1">Ora premi &quot;Spingi al bot i mancanti&quot; per consegnarli.</div>}
                </div>
            )}

            {pushReport && (
                <div className={`p-3 rounded-lg border text-xs ${pushReport.ok ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <div className="font-semibold mb-1">
                        {pushReport.ok ? 'Push completato' : 'Push con avvisi'}
                        {' — '}{pushReport.inviati} inviati su {pushReport.candidati} da spingere, {pushReport.remaining} ancora da fare
                    </div>
                    <div>
                        {Object.entries(pushReport.summary).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                    </div>
                    {pushReport.errors.map((e, i) => <div key={i}>{e}</div>)}
                    {pushReport.remaining > 0 && pushReport.ok && <div className="mt-1">Riclicca per continuare.</div>}
                </div>
            )}

            {/* Stat tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {tiles.map(t => (
                    <div key={t.label} className="bg-white rounded-lg border border-amber-100 p-3">
                        <p className="text-[10px] uppercase text-ash-500 tracking-wider font-semibold">{t.label}</p>
                        <p className="text-2xl font-black text-ash-900">{t.value}</p>
                    </div>
                ))}
            </div>

            {/* Quantità */}
            <div>
                <label className="text-xs font-semibold text-ash-700 mb-1 block">Quanti lead del pool distribuire ai GDO</label>
                <input
                    type="number"
                    min={0}
                    max={status.nelPool}
                    value={count}
                    disabled={status.nelPool === 0}
                    onChange={(e) => setCount(Math.max(0, Math.min(status.nelPool, parseInt(e.target.value) || 0)))}
                    className="w-full h-10 px-3 border border-amber-200 rounded-md text-sm focus:ring-amber-500 focus:border-amber-500 disabled:bg-ash-100 disabled:cursor-not-allowed"
                />
            </div>

            {/* GDO selection */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-ash-700 flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        GDO destinatari ({selectedGdoIds.size} su {gdos.length} selezionati)
                    </label>
                    <div className="flex gap-2 text-xs">
                        <button onClick={selectAll} className="text-amber-700 hover:underline font-medium">Tutti</button>
                        <button onClick={clearAll} className="text-ash-500 hover:underline">Nessuno</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto p-1">
                    {gdos.map(g => (
                        <label key={g.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${selectedGdoIds.has(g.id) ? 'bg-amber-50 border-amber-300' : 'bg-white border-ash-200 hover:bg-ash-50'}`}>
                            <input
                                type="checkbox"
                                checked={selectedGdoIds.has(g.id)}
                                onChange={() => toggleGdo(g.id)}
                                className="h-3.5 w-3.5 rounded text-amber-600 border-ash-300 focus:ring-amber-500"
                            />
                            <span className="truncate font-medium text-ash-800">{g.displayName || g.name || g.id.slice(0, 6)}</span>
                        </label>
                    ))}
                    {gdos.length === 0 && (
                        <p className="text-xs text-red-600 col-span-full">Nessun GDO attivo a sistema.</p>
                    )}
                </div>
            </div>

            {count > 0 && selectedGdoIds.size > 0 && (
                <div className="bg-amber-100/60 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                        <strong>{count} lead</strong> verranno divisi in modo equo tra <strong>{selectedGdoIds.size} GDO</strong> selezionati ({previewPerGdo} per GDO ca.).
                    </div>
                </div>
            )}

            <div className="flex justify-end pt-2">
                <button
                    onClick={handleAssign}
                    disabled={!canSubmit}
                    className="flex items-center gap-2 py-3 px-6 rounded-lg shadow-md text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg"
                >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Assegnazione in corso...</> : <>Esegui Assegnazione</>}
                </button>
            </div>

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
                            {Object.entries(report.perGdo).filter(([, v]) => v.count > 0).map(([id, v]) => (
                                <div key={id} className="bg-white px-2.5 py-1 rounded-md border border-green-200 text-ash-600 font-medium shadow-sm">
                                    {v.name}: <strong className="text-amber-700">{v.count}</strong>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Montare la card in `ImportClient.tsx`**

Import (dopo `BlackSummerPoolCard`):

```tsx
import { LancioPoolCard } from "@/components/LancioPoolCard"
```

Montaggio (dopo `<BlackSummerPoolCard />`, riga 541):

```tsx
            <BlackSummerPoolCard />
            <LancioPoolCard />
            <DatabasePoolSection />
```

- [ ] **Step 3: Compilare, poi verificare dal vivo**

Run: `npx tsc --noEmit`
Expected: nessun errore.

Con `npm run dev`, login ADMIN Fenice, aprire `http://localhost:3000/import`:
- La card ambra "Pool Lancio Web Dev AI 2026" compare sotto Black Summer con 5 tile a 0 e "Ingresso automatico dal webhook: SPENTO".
- Click "Sincronizza lista lancio da ActiveCampaign" (con `BOT_INTAKE_ENABLED=false` nel `.env` locale): il report dice `N importati (al bot)`; le tile "Al bot" e "Nel pool" si aggiornano; in `/lead-automatici` tab Bloccati i contatti importati spariscono.
- Click "Spingi al bot i mancanti": il report mostra `skipped_disabled: N` e l'avviso su `BOT_INTAKE_ENABLED`; ricliccando i candidati sono di nuovo N (skipped_disabled NON è in NO_REPUSH_RESULTS: giusto).
- Se il DB locale è quello di produzione, cancellare i lead di prova: `DELETE FROM leads WHERE "launchBucket" = 'LANCIO_WEBDEV_2026'` e riaprire le failure: `UPDATE "acIntakeFailures" SET "resolvedAt" = NULL, "resolvedBy" = NULL WHERE reason = 'blocked_list:132' AND "resolvedAt" > now() - interval '1 hour'`. Se invece si vuole tenere l'import (i lead sono veri), lasciarli: il push vero partirà col B1 acceso.
- Con `status.nelPool > 0` il bottone "Rimuovi pool" è disabilitato; con il pool a 0 la card sparisce dopo la conferma (riprovare poi con `UPDATE "launchPools" SET "archivedAt" = NULL WHERE bucket = 'LANCIO_WEBDEV_2026'`).
- Larghezza 400px (devtools): i bottoni dell'header vanno a capo, le tile su 2 colonne.

- [ ] **Step 4: Commit**

```bash
git add src/components/LancioPoolCard.tsx "src/app/(dashboard)/import/ImportClient.tsx"
git commit -m "feat(lancio): card Pool Lancio Web Dev AI su /import (sync, push al bot, distribuzione)"
```

---

### Task 7: Contratto bot v1.6 (sola parte intake) e env

**Files:**
- Modify: `docs/bot-fissatore-contract.md` (righe 1-9 header; 142-178 Direzione 1; 43-64 variabili d'ambiente)

**Interfaces:**
- Consumes: `BotIntakePayload` finale (Task 3).
- Produces: contratto v1.6 pubblicato al bot (il repo del bot lo legge per `lib/bot-contract.ts`).

- [ ] **Step 1: Header (righe 3-9)**

Sostituire con:

```markdown
> **Destinatari:** team esterno del bot WhatsApp/telefonico.
> **Versione:** 1.6 — 2026-09-14 (intake: campo opzionale `lancio` per i lead del lancio "Web Developer AI"; documentati `personKey` e `previousLeadIds`, già in produzione dal 2026-08-29).
> Versione precedente: 1.5 — 2026-08-26 (`CONTATTO_UMANO` porta motivo e contesto e finisce in una coda vera; `RICHIAMO` senza data certa; `APPUNTAMENTO` con data diversa = rifissaggio invece di scarto silenzioso).
>
> **Il contratto cresce, non cambia.** Ogni payload valido nella v1.5 resta valido: la
> novità della v1.6 è un solo campo opzionale sull'intake (`lancio`). Le rotte
> `/api/bot/lancio/*` (slot, prenotazione, chiamata subito) arrivano con la v1.7.
```

- [ ] **Step 2: Direzione 1 — body `BotIntakePayload` (righe 155-171)**

Sostituire il blocco `ts` con:

```ts
interface BotIntakePayload {
  leadId:    string;        // UUID del lead nel CRM
  name:      string | null; // Nome del lead (può essere null)
  phone:     string;        // Numero grezzo dal DB — vedere nota sotto
  email:     string | null; // Email del lead (può essere null)
  funnel:    string | null; // Funnel/prodotto di interesse
  companyId: string;        // Sempre "fenice" per i lead del bot

  // Dal 2026-08-29 (documentati qui in v1.6)
  personKey?:       string;            // ultime 10 cifre del numero: la stessa persona ha sempre la stessa chiave
  previousLeadIds?: PreviousLeadRef[]; // i lead precedenti con la stessa personKey, dal più recente, max 10

  // v1.6 — SOLO sui lead del lancio (assente = flusso attuale, invariato)
  lancio?: {
    slug:     string;                        // 'webdev-2026-10' per il lancio di ottobre 2026
    ingresso: 'lista' | 'pulsante_webinar';  // come è entrato: lista AC 132, o pulsante WhatsApp la sera della live
  };
}

interface PreviousLeadRef {
  leadId:    string;
  status:    string;         // 'NEW' | 'IN_PROGRESS' | 'APPOINTMENT' | 'REJECTED'
  outcome:   string | null;  // discardReason del lead precedente, se scartato
  createdAt: string;         // ISO
}
```

Aggiungere subito dopo la nota sul telefono grezzo:

```markdown
### Lead del lancio (nuovo in v1.6)

Quando `lancio` è presente il bot NON manda l'apertura di Mario: apre con il **template
di benvenuto del lancio** e la conversazione entra nel modo lancio (`lancio_slug`,
`lancio_fase='attesa'`). Cosa cambia per il bot, in breve:

- `funnel` vale `"Lancio Web Dev AI"` e `companyId` `"fenice"`.
- `lancio.ingresso = 'lista'` è l'unico valore che il CRM manda dall'intake: i lead della
  lista AC arrivano dal webhook (uno alla volta, appena si iscrivono) o dal sync di recupero
  su `/import` (a lotti, 30/min, stesso payload). `'pulsante_webinar'` è riservato ai lead che
  scrivono per primi dal pulsante della live: quelli NON passano dall'intake (`/api/bot/lead-entrante`).
- Idempotenza come oggi: stesso `leadId` o stessa `personKey` con chat viva → `duplicato:true`,
  nessun secondo benvenuto, ma `lancio_*` vanno valorizzati lo stesso.
- Gli esiti (`/api/bot/outcome`) restano gli stessi. Per i lead lancio `NON_RISPOSTO` e
  `INTERROTTO` NON rimandano il lead a un GDO ma lo rimettono nel pool: la semantica
  arriva con la v1.7 (blocco B5), fino ad allora il bot NON deve mandare quei due esiti
  sui lead lancio.
- Timeout e regola "un `network_error` è già arrivato" (15 s, 2026-09-10): invariati.
```

- [ ] **Step 3: Variabili d'ambiente (blocco `dotenv`, righe 45-64)**

Aggiungere in fondo al blocco:

```dotenv
# Lancio Web Developer AI (solo lato CRM, v1.6)
LANCIO_WEBDEV_INTAKE=           # `on` = i lead della lista AC "Lancio Web Developer AI"
                                # entrano nel CRM e vanno al bot con il campo `lancio`.
                                # Qualunque altro valore o assenza = lista bloccata
                                # (comportamento del 14/09), recupero dal sync su /import.
```

- [ ] **Step 4: Rileggere la Direzione 1 per intero**

Run: `sed -n 142,215p docs/bot-fissatore-contract.md`
Expected: header v1.6, body con i tre gruppi di campi, sezione "Lead del lancio" senza riferimenti a rotte che non esistono ancora se non come "arrivano con la v1.7".

- [ ] **Step 5: Commit**

```bash
git add docs/bot-fissatore-contract.md
git commit -m "docs(lancio): contratto bot v1.6, campo lancio nell'intake e env LANCIO_WEBDEV_INTAKE"
```

---

### Task 8: Verifica finale e accensione (checklist, nessun codice nuovo)

**Files:** nessuno da modificare.

**Interfaces:**
- Consumes: tutto quanto sopra.
- Produces: main verde, produzione con migrazione applicata, interruttore ancora SPENTO (si accende quando il bot è pronto, spec §9 riga B1: `LANCIO_WEBDEV_INTAKE=on` CRM + `lancio_attivo=1` bot).

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS, con `src/lib/lancio/intake.test.ts` (16) e `pushAudit.test.ts` (7) nel conteggio.

Run: `npx tsc --noEmit`
Expected: nessun errore.

Run: `npm run build`
Expected: build ok, nessun errore `"use server" file can only export async functions` (è il sintomo di un `export const` in `lancioPoolActions.ts`).

- [ ] **Step 2: Migrazione in produzione**

Confermare con `execute_sql` (project `ncutwzsifzundikwllxp`) che le 6 colonne e la riga `launchPools` ci sono (query del Task 1 Step 5). Se la migrazione era stata applicata in Task 1 su quel progetto, è già fatto.

- [ ] **Step 3: Push su main e deploy**

```bash
git log --oneline main..HEAD   # 7 commit feat/docs(lancio)
git push origin main
```

Vercel deploya al push. Poi su `https://<prod>/import` (memoria `reference_infra_ids.md` per l'URL canonico) la card lancio compare con "SPENTO" e tile a 0: nessun lead entra finché `LANCIO_WEBDEV_INTAKE` non vale `on` in Vercel.

- [ ] **Step 4: Prova a freddo del sync in produzione (senza push)**

Con `BOT_INTAKE_ENABLED` com'è oggi in produzione (`true`), NON premere "Spingi al bot" finché il bot non ha il template di benvenuto approvato (spec §10). Il solo "Sincronizza" è sicuro: importa e assegna al bot senza spingere. Decidere con Bruno se farlo subito (i lead risultano "al bot" nel CRM ma il bot non li ha) o aspettare il B1 lato bot. Annotare la decisione nella memoria del progetto.

- [ ] **Step 5: Accensione (quando il bot è pronto)**

Vercel → env `LANCIO_WEBDEV_INTAKE=on` (Production) → redeploy. Poi: "Sincronizza" e "Spingi al bot i mancanti" dalla card, ripetendo finché `remaining = 0`. Verifica: `SELECT count(*) FROM "leadEvents" WHERE "eventType"='BOT_PUSHED' AND metadata->>'lancio'='webdev-2026-10' AND metadata->>'result' IN ('sent','duplicate')`.

Rollback: togliere la env (o metterla a `off`) → la lista torna bloccata al primo webhook, senza deploy di codice.

---

## Self-review (fatto scrivendo il piano)

**Copertura spec:**
- §3.1 colonne `leads` → Task 1; riga `launchPools` → Task 1; eventi `LANCIO_*` nel tipo → Task 1; `launchShifts` esclusa per istruzione (B3).
- §4.1 webhook (ramo prima del routing, bypass fasce/tetto/ferie/acAutoIntake, dedup bucket, telefono sospetto nel bucket, `after()`) → Task 4; interruttore → Task 2 + 4; sync di recupero (status=-1, dedup bucket+telefono, risoluzione `blocked_list`, assegna al bot) → Task 5; push a lotti `pushLeadsToBotPaced` con `remaining`, idempotente sui consegnati → Task 3 (regola) + 5 (query); card con nel pool / al bot / restituiti / ai GDO + distribuzione → Task 6.
- §6.1 payload `lancio` → Task 3 (types, push audit, bot-push-leads), Task 4 (webhook), Task 5 (sync/push).
- §4.8 regola magazzino → Task 5 Step 4 (verificata, nessuna modifica) + coalesce su `assignedAt`.
- Contratto v1.6 intake → Task 7.
- Non coperto DI PROPOSITO (altri blocchi): `/api/bot/lead-entrante` con `provenienza='Lancio Web Dev AI'` (B2/B5), ritorno al pool su `NON_RISPOSTO`/`INTERROTTO` (B5), `launchShifts` e `/lancio` (B3). La costante `LANCIO_BUCKET`, `lancioFieldForLead` e `NO_REPUSH_RESULTS` sono già pronte per loro.

**Placeholder:** nessun "TBD/TODO"; ogni step con codice ha il codice.

**Coerenza nomi fra task:** `LANCIO_FUNNEL/BUCKET/SLUG/LIST_NAME_NORMALIZED/POOL_LABEL/COMPANY`, `isLancioIntakeEnabled`, `decideLancioIntake`, `lancioPayloadField`, `lancioFieldForLead`, `buildLancioLeadRow`, `buildLancioIntakeEventRows` (Task 2) usati con questi nomi in Task 3, 4, 5, 6; `NO_REPUSH_RESULTS_SQL`, `withLancioAudit` (Task 3) in Task 5 e push.ts; `findAcListIdByName` (Task 5) in `syncLancioPool`; report type `LancioPoolStatus/LancioSyncReport/LancioPushReport/LancioAssignReport` (Task 5) in Task 6.
