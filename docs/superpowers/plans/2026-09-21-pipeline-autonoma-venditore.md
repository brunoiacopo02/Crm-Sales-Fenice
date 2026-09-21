# Pipeline autonoma venditore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare a un solo venditore (Sales 002) una pipeline di lead da chiamare a freddo, con cui si fissa gli appuntamenti da solo direttamente sul proprio calendario Google (con Meet e invito al cliente), saltando del tutto le Conferme.

**Architecture:** l'appuntamento autofissato nasce con la sentinella `leads.confirmationsOutcome = 'autofissato'`. Nessuna colonna nuova, nessuna migration: le superfici Conferme filtrano `IS NULL` e quindi lo escludono da sole, e ogni contatore di "conferme" confronta con `= 'confermato'` e quindi non lo conta mai. Il fissaggio riusa il percorso già collaudato del lancio (`bookLancio`): transazione con advisory lock sullo slot, poi Google Calendar in `after()`. Le superfici nuove (board, pagina di regolazione) sono **componenti dedicati**, non modifiche a quelli dei GDO.

**Tech Stack:** Next.js (App Router) · Drizzle ORM su Supabase Postgres · Server Actions · `node --test` con `tsx` sui moduli puri in `src/lib/`.

**Spec:** `docs/superpowers/specs/2026-09-21-pipeline-autonoma-venditore-design.md`

## Global Constraints

- **Il lancio Web Dev AI (5 ottobre) è in corso.** Nessuna modifica può alterarne il percorso. I lead con `launchBucket = 'LANCIO_WEBDEV_2026'` non vanno **mai** dirottati.
- **Non si tocca il middleware** (`src/middleware.ts`).
- **Non si tocca il contratto bot** né si aggiungono chiamate verso il bot da questi percorsi.
- **La board GDO non si tocca.** `getPipelineLeads()`, `PipelineBoard`, `LeadCard`, `GdoQuickActions` e `OutcomeModal` restano invariati: la pipeline del venditore ha componenti propri. Unica eccezione ammessa in tutto il piano su codice GDO: una condizione in `updateLeadOutcome` (Task 5).
- **Una sola riga di codice Conferme cambia**: il bucket `storico` in `confermeActions.ts` (Task 1).
- La sentinella è la stringa esatta **`'autofissato'`**, definita una volta sola e importata ovunque.
- Bottoni interattivi mai dentro `<span>`/`<p>`: solo `<div>` (regola anti-WSOD del progetto).
- Ogni nuovo modulo puro in `src/lib/` ha un `.test.ts` accanto **e va aggiunto allo script `test` in `package.json`**, altrimenti non gira in CI.
- Date sempre Europe/Rome tramite gli helper esistenti (`src/lib/venditore/calendarSlots.ts`, `src/lib/dateUtils.ts`). Mai aritmetica in millisecondi sui giorni.

---

### Task 1: La sentinella e l'uscita dallo storico Conferme

**Files:**
- Create: `src/lib/salesPipeline/sentinel.ts`
- Create: `src/lib/salesPipeline/sentinel.test.ts`
- Modify: `package.json` (script `test`)
- Modify: `src/app/actions/confermeActions.ts:85`

**Interfaces:**
- Consumes: nulla
- Produces: `SELF_BOOKED_OUTCOME: 'autofissato'`, `isSelfBooked(outcome: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/lib/salesPipeline/sentinel.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { SELF_BOOKED_OUTCOME, isSelfBooked } from './sentinel'

test('la sentinella e la stringa esatta attesa dal DB', () => {
    assert.equal(SELF_BOOKED_OUTCOME, 'autofissato')
})

test('riconosce solo la sentinella', () => {
    assert.equal(isSelfBooked('autofissato'), true)
    assert.equal(isSelfBooked('confermato'), false)
    assert.equal(isSelfBooked('scartato'), false)
    assert.equal(isSelfBooked(null), false)
    assert.equal(isSelfBooked(undefined), false)
    assert.equal(isSelfBooked(''), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/salesPipeline/sentinel.test.ts`
Expected: FAIL — `Cannot find module './sentinel'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/salesPipeline/sentinel.ts`:

```ts
/**
 * La sentinella degli appuntamenti autofissati dal venditore.
 *
 * Vive in `leads.confirmationsOutcome` e non e' un esito delle Conferme: e' il
 * segno che quell'appuntamento le Conferme non lo devono vedere e nessuno lo
 * deve contare come conferma.
 *
 * Perche' funziona senza toccare il codice Conferme: nel CRM ci sono due
 * famiglie di lettori di quella colonna, e 'autofissato' cade dalla parte
 * giusta di entrambe.
 *  - "da lavorare dalle Conferme" e' sempre `IS NULL` (board confermeActions,
 *    avviso bloccante richiami, riepilogo azienda): la sentinella non e' NULL,
 *    quindi esce da tutte;
 *  - "e' una conferma" e' sempre `= 'confermato'` (funnelStages, confermeKpi,
 *    gdoPerformance, achievements): la sentinella non e' 'confermato', quindi
 *    non viene contata da nessuna.
 *
 * NON cambiare questa stringa: e' scritta sulle righe gia' in produzione.
 */
export const SELF_BOOKED_OUTCOME = 'autofissato' as const

export function isSelfBooked(outcome: string | null | undefined): boolean {
    return outcome === SELF_BOOKED_OUTCOME
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/salesPipeline/sentinel.test.ts`
Expected: PASS (2 test)

- [ ] **Step 5: Register the test in the npm script**

In `package.json`, nello script `test`, aggiungi `src/lib/salesPipeline/sentinel.test.ts` in fondo alla lista dei file (è una lista di path separati da spazio sulla stessa riga).

Run: `npm test`
Expected: PASS, e il totale dei test cresce di 2.

- [ ] **Step 6: Escludere gli autofissati dallo storico Conferme**

In `src/app/actions/confermeActions.ts`, il bucket `storico` è oggi:

```ts
conditions.push(isNotNull(leads.confirmationsOutcome))
```

Diventa:

```ts
// Gli autofissati del venditore non sono roba delle Conferme: non entrano
// nella loro board (filtrano IS NULL, e la sentinella non e' NULL) e non
// devono comparire nemmeno nel loro storico.
conditions.push(and(
    isNotNull(leads.confirmationsOutcome),
    ne(leads.confirmationsOutcome, SELF_BOOKED_OUTCOME),
)!)
```

Aggiungi in cima al file l'import `import { SELF_BOOKED_OUTCOME } from "@/lib/salesPipeline/sentinel"` e verifica che `ne` sia già importato da `drizzle-orm` (lo è: è usato in `checkBookingAllowed`).

- [ ] **Step 7: Verify the build**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 8: Commit**

```bash
git add src/lib/salesPipeline/sentinel.ts src/lib/salesPipeline/sentinel.test.ts package.json src/app/actions/confermeActions.ts
git commit -m "feat(pipeline-venditore): la sentinella degli appuntamenti autofissati"
```

---

### Task 2: Configurazione della pipeline

**Files:**
- Create: `src/lib/salesPipeline/config.ts`
- Create: `src/lib/salesPipeline/config.test.ts`
- Create: `src/app/actions/salesPipelineConfigActions.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: nulla
- Produces:
  - `type SalesPipelineConfig = { enabled: boolean; salesUserId: string | null; freshCap: number }`
  - `SALES_PIPELINE_CONFIG_KEY = 'sales_pipeline.config'`
  - `DEFAULT_SALES_PIPELINE_CONFIG: SalesPipelineConfig`
  - `parseSalesPipelineConfig(raw: string | null | undefined): SalesPipelineConfig`
  - `canDivertFresh(cfg: SalesPipelineConfig, diverted: number): boolean`
  - action `getSalesPipelineConfig(): Promise<SalesPipelineConfig>`
  - action `setSalesPipelineConfig(next: SalesPipelineConfig): Promise<{ success: boolean; error?: string }>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/salesPipeline/config.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_SALES_PIPELINE_CONFIG,
    parseSalesPipelineConfig,
    canDivertFresh,
} from './config'

test('config assente: pipeline spenta', () => {
    assert.deepEqual(parseSalesPipelineConfig(null), DEFAULT_SALES_PIPELINE_CONFIG)
    assert.equal(DEFAULT_SALES_PIPELINE_CONFIG.enabled, false)
})

test('JSON malformato non accende niente', () => {
    assert.equal(parseSalesPipelineConfig('{questo non e json').enabled, false)
    assert.equal(parseSalesPipelineConfig('[]').enabled, false)
})

test('config valida viene letta', () => {
    const cfg = parseSalesPipelineConfig('{"enabled":true,"salesUserId":"u-1","freshCap":5}')
    assert.deepEqual(cfg, { enabled: true, salesUserId: 'u-1', freshCap: 5 })
})

test('accesa senza venditore = spenta: non si dirotta verso nessuno', () => {
    const cfg = parseSalesPipelineConfig('{"enabled":true,"salesUserId":null,"freshCap":5}')
    assert.equal(cfg.enabled, false)
})

test('freshCap non valido ricade sul default 5', () => {
    assert.equal(parseSalesPipelineConfig('{"enabled":true,"salesUserId":"u-1","freshCap":-3}').freshCap, 5)
    assert.equal(parseSalesPipelineConfig('{"enabled":true,"salesUserId":"u-1","freshCap":"tanti"}').freshCap, 5)
})

test('il tetto dei freschi si rispetta, e il confine e stretto', () => {
    const cfg = { enabled: true, salesUserId: 'u-1', freshCap: 5 }
    assert.equal(canDivertFresh(cfg, 0), true)
    assert.equal(canDivertFresh(cfg, 4), true)
    assert.equal(canDivertFresh(cfg, 5), false)
    assert.equal(canDivertFresh(cfg, 6), false)
})

test('pipeline spenta non dirotta mai, nemmeno a zero dirottati', () => {
    assert.equal(canDivertFresh({ enabled: false, salesUserId: 'u-1', freshCap: 5 }, 0), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/salesPipeline/config.test.ts`
Expected: FAIL — `Cannot find module './config'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/salesPipeline/config.ts`:

```ts
/**
 * Configurazione della pipeline autonoma del venditore.
 *
 * Vive in `appSettings` (tabella chiave-valore gia' usata per il CPL), non in
 * una env: il PO deve poterla spegnere da una pagina, senza deploy.
 *
 * Puro: qui dentro non si tocca il DB. Il lettore sta in
 * `salesPipelineConfigActions.ts`.
 */

export const SALES_PIPELINE_CONFIG_KEY = 'sales_pipeline.config'

export interface SalesPipelineConfig {
    enabled: boolean
    /** Il venditore a cui e' accesa la pipeline. Uno solo, per ora. */
    salesUserId: string | null
    /** Quanti lead freschi in arrivo da AC dirottargli, in tutto. */
    freshCap: number
}

const DEFAULT_FRESH_CAP = 5

export const DEFAULT_SALES_PIPELINE_CONFIG: SalesPipelineConfig = {
    enabled: false,
    salesUserId: null,
    freshCap: DEFAULT_FRESH_CAP,
}

/**
 * Qualunque cosa non sia una config valida e accesa su un venditore vero
 * ricade su "spenta". Una config rotta non deve poter dirottare lead a
 * nessuno: il fallimento va verso il comportamento di sempre.
 */
export function parseSalesPipelineConfig(raw: string | null | undefined): SalesPipelineConfig {
    if (!raw) return DEFAULT_SALES_PIPELINE_CONFIG
    let obj: unknown
    try {
        obj = JSON.parse(raw)
    } catch {
        return DEFAULT_SALES_PIPELINE_CONFIG
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return DEFAULT_SALES_PIPELINE_CONFIG
    const o = obj as Record<string, unknown>

    const salesUserId = typeof o.salesUserId === 'string' && o.salesUserId.trim() !== ''
        ? o.salesUserId.trim()
        : null
    const capRaw = o.freshCap
    const freshCap = typeof capRaw === 'number' && Number.isFinite(capRaw) && capRaw >= 0
        ? Math.floor(capRaw)
        : DEFAULT_FRESH_CAP

    // Accesa senza venditore non e' uno stato: e' spenta.
    const enabled = o.enabled === true && salesUserId !== null

    return { enabled, salesUserId, freshCap }
}

/** Si dirotta solo se la pipeline e' accesa e il tetto non e' ancora pieno. */
export function canDivertFresh(cfg: SalesPipelineConfig, diverted: number): boolean {
    return cfg.enabled && cfg.salesUserId !== null && diverted < cfg.freshCap
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/salesPipeline/config.test.ts`
Expected: PASS (7 test)

- [ ] **Step 5: Register the test in the npm script**

Aggiungi `src/lib/salesPipeline/config.test.ts` allo script `test` in `package.json`.

Run: `npm test` → PASS.

- [ ] **Step 6: Lettura e scrittura su appSettings**

Create `src/app/actions/salesPipelineConfigActions.ts`:

```ts
"use server"

import { db } from "@/db"
import { appSettings } from "@/db/schema"
import { eq } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import {
    SALES_PIPELINE_CONFIG_KEY,
    DEFAULT_SALES_PIPELINE_CONFIG,
    parseSalesPipelineConfig,
    type SalesPipelineConfig,
} from "@/lib/salesPipeline/config"

/**
 * Lettura senza sessione: la usa anche il webhook AC, che gira senza utente.
 * Non fallisce mai: se il DB non risponde, la pipeline risulta spenta e il
 * routing di sempre prosegue indisturbato.
 */
export async function readSalesPipelineConfig(): Promise<SalesPipelineConfig> {
    try {
        const rows = await db.select().from(appSettings)
            .where(eq(appSettings.key, SALES_PIPELINE_CONFIG_KEY))
        return parseSalesPipelineConfig(rows[0]?.value)
    } catch (e) {
        console.error('[sales-pipeline] lettura config fallita, pipeline considerata spenta', e)
        return DEFAULT_SALES_PIPELINE_CONFIG
    }
}

export async function getSalesPipelineConfig(): Promise<SalesPipelineConfig> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!['ADMIN', 'MANAGER'].includes(ctx.role)) {
        return DEFAULT_SALES_PIPELINE_CONFIG
    }
    return await readSalesPipelineConfig()
}

export async function setSalesPipelineConfig(
    next: SalesPipelineConfig,
): Promise<{ success: boolean; error?: string; config?: SalesPipelineConfig }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!['ADMIN', 'MANAGER'].includes(ctx.role)) {
        return { success: false, error: 'Solo ADMIN e MANAGER possono cambiare questa configurazione.' }
    }
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Non autenticato.' }

    // Si normalizza con lo stesso parser della lettura: cosi' quello che si
    // salva e quello che si rilegge non possono divergere.
    const clean = parseSalesPipelineConfig(JSON.stringify(next))
    if (next.enabled && !clean.enabled) {
        return { success: false, error: 'Per accendere la pipeline serve scegliere un venditore.' }
    }

    await db.insert(appSettings).values({
        key: SALES_PIPELINE_CONFIG_KEY,
        value: JSON.stringify(clean),
        updatedBy: user.id,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify(clean), updatedBy: user.id, updatedAt: new Date() },
    })

    return { success: true, config: clean }
}
```

- [ ] **Step 7: Verify the build**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 8: Commit**

```bash
git add src/lib/salesPipeline/config.ts src/lib/salesPipeline/config.test.ts src/app/actions/salesPipelineConfigActions.ts package.json
git commit -m "feat(pipeline-venditore): configurazione su appSettings, spenta di default"
```

---

### Task 3: La regola del fissaggio autonomo

**Files:**
- Create: `src/lib/salesPipeline/selfBooking.ts`
- Create: `src/lib/salesPipeline/selfBooking.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `bookingCheck`, `BookingRefusal` da `src/lib/venditore/calendarBooking.ts`; `slotLabel` da `src/lib/venditore/calendarSlots.ts`
- Produces:
  - `type SelfBookingDecision = { ok: true } | { ok: false; reason: 'fuori_griglia' | 'bloccato' | 'gia_occupato'; message: string }`
  - `selfBookingCheck(input: { slot: Date | null; blocked: boolean; occupied: boolean; at: Date }): SelfBookingDecision`

- [ ] **Step 1: Write the failing test**

Create `src/lib/salesPipeline/selfBooking.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { selfBookingCheck } from './selfBooking'

// Mercoledi 23 settembre 2026, ore 16 italiane.
const at = new Date('2026-09-23T16:00:00+02:00')
const slot = new Date('2026-09-23T16:00:00+02:00')

test('ora libera: si fissa', () => {
    assert.deepEqual(selfBookingCheck({ slot, blocked: false, occupied: false, at }), { ok: true })
})

test("un'ora NON dichiarata si puo comunque fissare: e il suo calendario", () => {
    // La differenza voluta rispetto al muro delle Conferme: qui 'non_dichiarato'
    // non esiste come rifiuto, perche' il venditore non deve andare a compilare
    // la griglia mentre ha il cliente al telefono.
    assert.deepEqual(selfBookingCheck({ slot, blocked: false, occupied: false, at }), { ok: true })
})

test('ora gia occupata: blocco secco', () => {
    const d = selfBookingCheck({ slot, blocked: false, occupied: true, at })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'gia_occupato')
    assert.match(d.ok === false ? d.message : '', /16:00/)
})

test('ora bloccata dal venditore: blocco secco', () => {
    const d = selfBookingCheck({ slot, blocked: true, occupied: false, at })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'bloccato')
})

test('fuori dalla griglia (domenica o notte): blocco secco', () => {
    const d = selfBookingCheck({ slot: null, blocked: false, occupied: false, at })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'fuori_griglia')
})

test('occupato vince su bloccato: si legge la causa piu grave per il cliente', () => {
    const d = selfBookingCheck({ slot, blocked: true, occupied: true, at })
    assert.equal(d.ok === false && d.reason, 'bloccato')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/salesPipeline/selfBooking.test.ts`
Expected: FAIL — `Cannot find module './selfBooking'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/salesPipeline/selfBooking.ts`:

```ts
/**
 * Il muro del fissaggio per il venditore che si prenota da solo.
 *
 * E' il muro delle Conferme (`bookingCheck`) meno un rifiuto: 'non_dichiarato'
 * non si applica. Un'ora che il venditore non ha dichiarato resta prenotabile
 * da lui, perche' e' il suo calendario e mandarlo a compilare la griglia
 * mentre ha il cliente al telefono farebbe perdere l'appuntamento. Restano
 * duri gli altri tre: fuori griglia, bloccata, gia' occupata — quelli non sono
 * preferenze, sono ore in cui l'appuntamento non si terrebbe.
 *
 * Puro: riceve fatti gia' letti, non tocca il DB.
 */

import { bookingCheck } from '../venditore/calendarBooking'
import { slotLabel } from '../venditore/calendarSlots'

export type SelfBookingRefusal = 'fuori_griglia' | 'bloccato' | 'gia_occupato'

export type SelfBookingDecision =
    | { ok: true }
    | { ok: false; reason: SelfBookingRefusal; message: string }

export function selfBookingCheck(input: {
    slot: Date | null
    blocked: boolean
    occupied: boolean
    at: Date
}): SelfBookingDecision {
    // `declared: true` disattiva il solo rifiuto che qui non vogliamo, e ci
    // lascia l'ordine dei controlli gia' collaudato del muro delle Conferme.
    const base = bookingCheck({
        slot: input.slot,
        declared: true,
        blocked: input.blocked,
        occupied: input.occupied,
    })
    if (base.ok) return { ok: true }

    const reason = base.reason as SelfBookingRefusal
    const ora = input.slot ? slotLabel(input.slot) : slotLabel(input.at)
    const message = (() => {
        switch (reason) {
            case 'fuori_griglia':
                return "Quest'ora e' fuori dal calendario (si fissa dalle 9 alle 21, da lunedi a sabato)."
            case 'bloccato':
                return `Hai bloccato le ${ora}: sbloccale dal tuo calendario, oppure scegli un'altra ora.`
            case 'gia_occupato':
                return `Hai gia' un appuntamento alle ${ora}.`
        }
    })()
    return { ok: false, reason, message }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/salesPipeline/selfBooking.test.ts`
Expected: PASS (6 test)

- [ ] **Step 5: Register the test in the npm script**

Aggiungi `src/lib/salesPipeline/selfBooking.test.ts` allo script `test` in `package.json`.

Run: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/salesPipeline/selfBooking.ts src/lib/salesPipeline/selfBooking.test.ts package.json
git commit -m "feat(pipeline-venditore): muro del fissaggio autonomo, senza il vincolo dell'ora dichiarata"
```

---

### Task 4: Il fissaggio — `setSalesSelfAppointment`

**Files:**
- Create: `src/app/actions/salesPipelineActions.ts`

**Interfaces:**
- Consumes: `SELF_BOOKED_OUTCOME` (Task 1), `readSalesPipelineConfig` (Task 2), `selfBookingCheck` (Task 3)
- Produces:
  - `setSalesSelfAppointment(input: { leadId: string; currentVersion: number; at: Date; note?: string }): Promise<{ success: boolean; error?: string; alreadyBooked?: boolean }>`
  - `requireSalesPipelineUser(): Promise<{ userId: string; companyId: string; name: string } | null>`

- [ ] **Step 1: Guardia di accesso e gancio alla config**

Create `src/app/actions/salesPipelineActions.ts` con la sola guardia, per prima:

```ts
"use server"

import crypto from "crypto"
import { after } from "next/server"
import { addHours } from "date-fns"
import { and, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { callLogs, leadEvents, leads, salesSlotBlocks, users } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { createGoogleCalendarEvent } from "@/lib/googleCalendar"
import { enqueueMarketingWebhook } from "@/lib/marketing-webhooks/enqueue"
import { romeInstant, slotKey, slotStartFor } from "@/lib/venditore/calendarSlots"
import { toRomeDateStr } from "@/lib/dateUtils"
import { SELF_BOOKED_OUTCOME } from "@/lib/salesPipeline/sentinel"
import { selfBookingCheck } from "@/lib/salesPipeline/selfBooking"
import { readSalesPipelineConfig } from "./salesPipelineConfigActions"

/**
 * Chi puo' usare la pipeline autonoma: il venditore configurato, e nessun
 * altro. Ritorna null se la pipeline e' spenta o se non e' lui.
 */
export async function requireSalesPipelineUser(): Promise<
    { userId: string; companyId: string; name: string } | null
> {
    const cfg = await readSalesPipelineConfig()
    if (!cfg.enabled || !cfg.salesUserId) return null

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    if (user.id !== cfg.salesUserId) return null
    if ((user.user_metadata as any)?.role !== 'VENDITORE') return null

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const row = (await db.select({ name: users.name, displayName: users.displayName })
        .from(users).where(eq(users.id, user.id)))[0]

    return {
        userId: user.id,
        companyId: ctx.companyId,
        name: row?.name || row?.displayName || 'Venditore',
    }
}
```

- [ ] **Step 2: L'azione di fissaggio**

Aggiungi nello stesso file:

```ts
/**
 * Il venditore si fissa l'appuntamento da solo.
 *
 * Modellata su `bookLancio` (src/lib/lancio/booking.ts), che e' il precedente
 * esatto: un appuntamento che nasce gia' fuori dal giro delle Conferme.
 *
 * Tre cose per cui esiste il lock e non basta il controllo ottimistico:
 *  - lo slot e' una risorsa condivisa col resto del CRM (una Conferma puo'
 *    assegnargli un lead sulla stessa ora nello stesso istante), e oggi nel
 *    CRM NON esiste nessuna prenotazione atomica: due scritture sullo stesso
 *    slot passano entrambe e il doppio booking si scopre solo dopo;
 *  - a valle di questa scrittura parte un invito vero a un cliente vero;
 *  - l'evento Google non e' idempotente: due giri = due inviti.
 */
export async function setSalesSelfAppointment(input: {
    leadId: string
    currentVersion: number
    at: Date
    note?: string
}): Promise<{ success: boolean; error?: string; alreadyBooked?: boolean }> {
    const me = await requireSalesPipelineUser()
    if (!me) return { success: false, error: 'Pipeline non attiva per questo utente.' }

    const at = new Date(input.at)
    if (Number.isNaN(at.getTime())) return { success: false, error: 'Data non valida.' }

    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, me.companyId),
        eq(leads.id, input.leadId),
    )))[0]
    if (!lead) return { success: false, error: 'Lead non trovato.' }
    if (lead.assignedToId !== me.userId) {
        return { success: false, error: 'Questo lead non e\' nella tua pipeline.' }
    }
    if (lead.version !== input.currentVersion) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    // Guardia anti-doppio-fissaggio. E' il difetto noto di updateLeadOutcome
    // (il bot ha la sua guardia, l'UI GDO no): qui due clic significano due
    // eventi Google Calendar e due inviti allo stesso cliente.
    if (lead.status === 'APPOINTMENT' && lead.appointmentDate) {
        return { success: true, alreadyBooked: true }
    }

    const slot = slotStartFor(at)
    const dayStart = romeInstant(toRomeDateStr(at), 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    const now = new Date()
    const key = slot ? slotKey(slot) : `fuori-griglia:${at.toISOString()}`

    const esito = await db.transaction(async (tx) => {
        // Lock per ORA, non globale: serializza solo chi vuole lo stesso slot.
        // Seed 4 = pipeline venditore (0 telefono, 1 contatto AC, 2 push, 3 lancio).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'sales-self:' + me.userId + ':' + key}, 4))`)

        // Blocchi e appuntamenti si rileggono QUI DENTRO, dopo il lock: quello
        // che si e' visto un minuto fa non e' una promessa.
        // Niente filtro companyId sugli appuntamenti, come in checkBookingAllowed:
        // il venditore e' una persona sola, un appuntamento su un'altra azienda
        // gli occupa l'ora lo stesso.
        const [dayBlocks, dayAppointments] = await Promise.all([
            tx.select({ slotStart: salesSlotBlocks.slotStart }).from(salesSlotBlocks).where(and(
                eq(salesSlotBlocks.salesUserId, me.userId),
                gte(salesSlotBlocks.slotStart, dayStart),
                lt(salesSlotBlocks.slotStart, dayEnd),
            )),
            tx.select({ appointmentDate: leads.appointmentDate }).from(leads).where(and(
                eq(leads.salespersonUserId, me.userId),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, dayStart),
                lt(leads.appointmentDate, dayEnd),
                ne(leads.id, input.leadId),
            )),
        ])

        const decision = selfBookingCheck({
            slot,
            blocked: !!slot && dayBlocks.some(b => slotKey(b.slotStart) === key),
            occupied: !!slot && dayAppointments.some(a => slotKey(a.appointmentDate!) === key),
            at,
        })
        if (!decision.ok) return { ok: false as const, error: decision.message }

        const updated = await tx.update(leads).set({
            status: 'APPOINTMENT',
            appointmentDate: at,
            appointmentCreatedAt: now,
            appointmentNote: input.note?.trim() || null,
            callCount: lead.callCount + 1,
            lastCallDate: now,
            lastCallNote: input.note?.trim() || null,
            recallDate: null,
            recallNote: null,
            recallMissedAt: null,
            // Il perno. NON 'confermato': cosi' esce dalle board Conferme
            // (filtrano IS NULL) e non viene contato come conferma da nessuno
            // (tutti confrontano con 'confermato').
            confirmationsOutcome: SELF_BOOKED_OUTCOME,
            // Restano NULL di proposito: nessuno delle Conferme ha lavorato
            // questo lead, e valorizzarli lo farebbe entrare nelle query di
            // attribuzione per-operatore.
            confirmationsUserId: null,
            confirmationsTimestamp: null,
            salespersonUserId: me.userId,
            salespersonAssigned: me.name,
            salespersonAssignedAt: now,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(
            eq(leads.id, input.leadId),
            eq(leads.version, lead.version),
        )).returning({ id: leads.id })

        if (updated.length === 0) return { ok: false as const, error: 'CONCURRENCY_ERROR' }

        await tx.insert(callLogs).values({
            id: crypto.randomUUID(),
            leadId: input.leadId,
            userId: me.userId,
            outcome: 'APPUNTAMENTO',
            note: input.note?.trim() || null,
            companyId: me.companyId,
        })

        await tx.insert(leadEvents).values([
            {
                id: crypto.randomUUID(), leadId: input.leadId, eventType: 'APPOINTMENT_SET',
                userId: me.userId, timestamp: now,
                metadata: { source: 'sales_pipeline', at: at.toISOString() },
                companyId: me.companyId,
            },
            {
                id: crypto.randomUUID(), leadId: input.leadId, eventType: 'SALES_SELF_BOOKED',
                userId: me.userId, timestamp: now,
                metadata: { at: at.toISOString(), slot: slot ? slotKey(slot) : null },
                companyId: me.companyId,
            },
        ])

        return { ok: true as const }
    })

    if (!esito.ok) return { success: false, error: esito.error }

    // Calendar e webhook fuori dalla risposta: le API di Google non devono
    // poter far aspettare (o fallire) un appuntamento gia' scritto.
    after(async () => {
        await createGoogleCalendarEvent(
            me.userId,
            {
                summary: `Appuntamento CRM: ${lead.name}`,
                description: `Lead: ${lead.name}\nTelefono: ${lead.phone}\nEmail: ${lead.email || 'N/A'}\nFunnel: ${lead.funnel || 'N/A'}\nOrigine: pipeline autonoma venditore\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
                startTime: at,
                endTime: addHours(at, 1),
                attendees: lead.email ? [{ email: lead.email }] : [],
            },
            input.leadId,
            'appointment',
        ).catch((e: any) => console.error('[sales-pipeline] Google Calendar fallito:', e?.message ?? e))

        // appointment.set e deal.assigned SI: l'appuntamento esiste e ha un
        // venditore. appointment.outcome NO: non c'e' nessun esito Conferme da
        // comunicare, e mandarlo farebbe contare una conferma a valle.
        for (const eventType of ['appointment.set', 'deal.assigned'] as const) {
            await enqueueMarketingWebhook({ eventType, leadId: input.leadId, actorUserId: me.userId })
                .catch((e: unknown) => console.error(`[sales-pipeline] webhook ${eventType} err:`, e))
        }

        // NESSUN notifyAppointmentToBot: in questa pipeline l'agenda la manda
        // il venditore in autonomia (decisione PO 2026-09-21). Aggiungerlo
        // farebbe scrivere il bot su WhatsApp a un lead gestito a voce.
    })

    return { success: true }
}
```

- [ ] **Step 3: Lo spostamento dell'appuntamento**

Aggiungi nello stesso file l'azione per quando il cliente chiede di spostare. Il punto delicato è l'evento Google: va **cancellato e ricreato**, altrimenti il cliente resta con l'invito vecchio in calendario. È lo stesso pattern già in uso nelle Conferme (`confermeActions.ts:1598` e `:1608`).

```ts
/**
 * Sposta un appuntamento autofissato. L'evento Google si cancella e si
 * ricrea: un patch della sola data lascerebbe il vecchio Meet valido, e il
 * cliente si presenterebbe su una stanza che il venditore non apre.
 */
export async function moveSalesSelfAppointment(input: {
    leadId: string
    currentVersion: number
    at: Date
    note?: string
}): Promise<{ success: boolean; error?: string }> {
    const me = await requireSalesPipelineUser()
    if (!me) return { success: false, error: 'Pipeline non attiva per questo utente.' }

    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, me.companyId),
        eq(leads.id, input.leadId),
    )))[0]
    if (!lead) return { success: false, error: 'Lead non trovato.' }
    if (lead.salespersonUserId !== me.userId || lead.confirmationsOutcome !== SELF_BOOKED_OUTCOME) {
        return { success: false, error: 'Questo appuntamento non e\' tuo da spostare.' }
    }
    if (lead.version !== input.currentVersion) return { success: false, error: 'CONCURRENCY_ERROR' }

    const at = new Date(input.at)
    const slot = slotStartFor(at)
    const dayStart = romeInstant(toRomeDateStr(at), 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const key = slot ? slotKey(slot) : `fuori-griglia:${at.toISOString()}`
    const now = new Date()

    const esito = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'sales-self:' + me.userId + ':' + key}, 4))`)

        const [dayBlocks, dayAppointments] = await Promise.all([
            tx.select({ slotStart: salesSlotBlocks.slotStart }).from(salesSlotBlocks).where(and(
                eq(salesSlotBlocks.salesUserId, me.userId),
                gte(salesSlotBlocks.slotStart, dayStart),
                lt(salesSlotBlocks.slotStart, dayEnd),
            )),
            tx.select({ appointmentDate: leads.appointmentDate }).from(leads).where(and(
                eq(leads.salespersonUserId, me.userId),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, dayStart),
                lt(leads.appointmentDate, dayEnd),
                ne(leads.id, input.leadId),
            )),
        ])

        const decision = selfBookingCheck({
            slot,
            blocked: !!slot && dayBlocks.some(b => slotKey(b.slotStart) === key),
            occupied: !!slot && dayAppointments.some(a => slotKey(a.appointmentDate!) === key),
            at,
        })
        if (!decision.ok) return { ok: false as const, error: decision.message }

        const updated = await tx.update(leads).set({
            appointmentDate: at,
            appointmentNote: input.note?.trim() || lead.appointmentNote,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, input.leadId), eq(leads.version, lead.version)))
            .returning({ id: leads.id })
        if (updated.length === 0) return { ok: false as const, error: 'CONCURRENCY_ERROR' }

        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(), leadId: input.leadId,
            eventType: 'SALES_SELF_BOOKED', userId: me.userId, timestamp: now,
            metadata: { at: at.toISOString(), moved: true, from: lead.appointmentDate?.toISOString() ?? null },
            companyId: me.companyId,
        })
        return { ok: true as const }
    })

    if (!esito.ok) return { success: false, error: esito.error }

    after(async () => {
        // Cancella il vecchio evento, poi ricrea. `calendarEvents` tiene il
        // legame lead -> googleEventId.
        const old = await db.select().from(calendarEvents).where(and(
            eq(calendarEvents.leadId, input.leadId),
            eq(calendarEvents.userId, me.userId),
        ))
        for (const e of old) {
            await deleteGoogleCalendarEvent(me.userId, e.googleEventId)
                .catch((err: any) => console.error('[sales-pipeline] delete GCal fallita:', err?.message ?? err))
            await db.delete(calendarEvents).where(eq(calendarEvents.id, e.id))
        }
        await createGoogleCalendarEvent(
            me.userId,
            {
                summary: `Appuntamento CRM: ${lead.name}`,
                description: `Lead: ${lead.name}\nTelefono: ${lead.phone}\nEmail: ${lead.email || 'N/A'}\nFunnel: ${lead.funnel || 'N/A'}\nOrigine: pipeline autonoma venditore (spostato)\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
                startTime: at,
                endTime: addHours(at, 1),
                attendees: lead.email ? [{ email: lead.email }] : [],
            },
            input.leadId,
            'appointment',
        ).catch((e: any) => console.error('[sales-pipeline] Google Calendar fallito:', e?.message ?? e))
    })

    return { success: true }
}
```

Aggiungi `calendarEvents` all'import da `@/db/schema` e `deleteGoogleCalendarEvent` a quello da `@/lib/googleCalendar`.

- [ ] **Step 4: Verify the build**

Run: `npx tsc --noEmit`
Expected: nessun errore. Se `callLogs` o `leadEvents` richiedono colonne non passate, apri `src/db/schema.ts` e aggiungi i campi mancanti con gli stessi default usati in `pipelineActions.ts:453`.

- [ ] **Step 5: Verifica manuale del percorso felice**

Con la pipeline accesa su un utente di prova e un lead assegnato a lui:
1. chiama l'azione con un'ora libera dentro la griglia → `{ success: true }`
2. sul DB: `SELECT status, "confirmationsOutcome", "confirmationsUserId", "salespersonUserId" FROM leads WHERE id = '<lead>'` → `APPOINTMENT`, `autofissato`, `NULL`, l'id del venditore
3. richiama l'azione sullo stesso lead → `{ success: true, alreadyBooked: true }` e **nessun secondo evento** in `calendarEvents`

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/salesPipelineActions.ts
git commit -m "feat(pipeline-venditore): il venditore si fissa l'appuntamento e se lo mette in agenda"
```

---

### Task 5: La board `/mia-pipeline`

**Files:**
- Modify: `src/app/actions/salesPipelineActions.ts` (aggiunta di `getSalesPipelineLeads`)
- Create: `src/app/(dashboard)/mia-pipeline/page.tsx`
- Create: `src/app/(dashboard)/mia-pipeline/MiaPipelineClient.tsx`
- Modify: `src/app/actions/pipelineActions.ts:553` (una condizione)
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `requireSalesPipelineUser`, `setSalesSelfAppointment` (Task 4)
- Produces: `getSalesPipelineLeads(): Promise<{ firstCall: any[]; secondCall: any[]; thirdCall: any[]; recalls: any[] }>`

**Perché componenti nuovi e non `PipelineBoard`:** la board GDO è la superficie più usata dell'app e i suoi componenti (`LeadCard`, `GdoQuickActions`, `OutcomeModal`) montano il pulsante Agenda, la gamification e il percorso APPUNTAMENTO sbagliato per questo caso. Infilarci un `mode` significherebbe rischiare la board di otto persone per il test di una. Qui si scrive un client dedicato e più semplice.

- [ ] **Step 1: La query della pipeline**

In `src/app/actions/salesPipelineActions.ts` aggiungi:

```ts
/**
 * I lead nella pipeline del venditore. Stesse esclusioni della board GDO
 * (pipelineActions.ts:107) — e stesso tiebreaker su `id`, senza il quale i
 * lead importati in blocco ballano fra un caricamento e l'altro.
 */
export async function getSalesPipelineLeads(): Promise<{
    firstCall: any[]; secondCall: any[]; thirdCall: any[]; recalls: any[]
}> {
    const me = await requireSalesPipelineUser()
    if (!me) return { firstCall: [], secondCall: [], thirdCall: [], recalls: [] }

    const base = [
        eq(leads.companyId, me.companyId),
        eq(leads.assignedToId, me.userId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
    ]

    const [pipeline, recalls] = await Promise.all([
        db.select().from(leads)
            .where(and(...base, isNull(leads.recallDate), lt(leads.callCount, 3)))
            .orderBy(desc(leads.createdAt), leads.id),
        db.select().from(leads)
            .where(and(...base, isNotNull(leads.recallDate)))
            .orderBy(leads.recallDate),
    ])

    return {
        firstCall: pipeline.filter(l => l.callCount === 0),
        secondCall: pipeline.filter(l => l.callCount === 1),
        thirdCall: pipeline.filter(l => l.callCount === 2),
        recalls,
    }
}
```

Aggiungi `desc` e `isNull` all'import da `drizzle-orm` in cima al file.

- [ ] **Step 2: Spegnere la gamification sui suoi esiti**

In `src/app/actions/pipelineActions.ts`, il blocco che premia ogni chiamata è:

```ts
if (effectiveUserId && !isBotActor) {
    incrementChestProgress(effectiveUserId, 'chiamate', 1).catch(...)
    ...
}
```

Diventa:

```ts
// La gamification e' l'economia dei GDO. Un venditore che lavora la sua
// pipeline registra gli stessi esiti, ma non entra in forzieri, boss e duelli:
// falserebbe classifiche costruite su un'altra gara.
if (effectiveUserId && !isBotActor && actorRole === 'GDO') {
    ...
}
```

`actorRole` va ricavato **senza query aggiuntive**, dalla sessione che la funzione legge già. In cima a `updateLeadOutcome`, dove oggi si costruisce `session`, aggiungi accanto a `isBotActor`:

```ts
let actorRole: string | undefined
```

e valorizzalo nei due rami:

```ts
if (serviceCtx) {
    ...
    isBotActor = serviceCtx.isBot
    actorRole = 'GDO'   // il bot e' un account GDO mascherato: il ramo e' gia' gestito da isBotActor
} else {
    ...
    actorRole = session?.user?.role
    ...
}
```

Così il percorso dei GDO non paga nemmeno una lettura in più, e un attore che non sia GDO (il venditore, oggi; chiunque altro domani) resta fuori dalla gamification per costruzione.

- [ ] **Step 3: La pagina**

Create `src/app/(dashboard)/mia-pipeline/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { getSalesPipelineLeads, requireSalesPipelineUser } from "@/app/actions/salesPipelineActions"
import MiaPipelineClient from "./MiaPipelineClient"

export default async function MiaPipelinePage() {
    const me = await requireSalesPipelineUser()
    if (!me) redirect("/")

    const { firstCall, secondCall, thirdCall, recalls } = await getSalesPipelineLeads()

    return (
        <div className="min-h-screen bg-ash-50/50 p-4 sm:p-6 lg:p-8">
            <MiaPipelineClient
                firstCall={firstCall}
                secondCall={secondCall}
                thirdCall={thirdCall}
                recalls={recalls}
            />
        </div>
    )
}
```

- [ ] **Step 4: Il client**

Create `src/app/(dashboard)/mia-pipeline/MiaPipelineClient.tsx`. Questo è lo scheletro da completare con lo stile del progetto (classi Tailwind come nelle altre board): la struttura, il cablaggio delle azioni e le guardie sono quelle da rispettare.

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { setSalesSelfAppointment } from "@/app/actions/salesPipelineActions"
import { updateLeadOutcome } from "@/app/actions/pipelineActions"
import { GDO_DISCARD_REASONS } from "@/lib/surveys/questions"

type Lead = any
type Tab = 'first' | 'second' | 'third' | 'recalls'

export default function MiaPipelineClient({ firstCall, secondCall, thirdCall, recalls }: {
    firstCall: Lead[]; secondCall: Lead[]; thirdCall: Lead[]; recalls: Lead[]
}) {
    const router = useRouter()
    const [tab, setTab] = useState<Tab>('first')
    const [busyId, setBusyId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const lists: Record<Tab, Lead[]> = { first: firstCall, second: secondCall, third: thirdCall, recalls }
    const tabs: { key: Tab; label: string }[] = [
        { key: 'first', label: '1ª chiamata' },
        { key: 'second', label: '2ª chiamata' },
        { key: 'third', label: '3ª chiamata' },
        { key: 'recalls', label: 'Richiami' },
    ]

    /** Un solo punto di uscita per tutte le azioni: un lead alla volta, errore visibile, refresh. */
    async function run(leadId: string, fn: () => Promise<{ success: boolean; error?: string }>) {
        if (busyId) return              // niente doppio invio mentre una parte
        setBusyId(leadId); setError(null)
        try {
            const res = await fn()
            // I messaggi del muro del fissaggio dicono gia' cosa fare: si mostrano
            // come arrivano, senza riscriverli.
            if (!res.success) setError(res.error || 'Operazione non riuscita.')
            else router.refresh()
        } finally {
            setBusyId(null)
        }
    }

    const fissa = (lead: Lead, whenLocal: string, note: string) =>
        run(lead.id, () => setSalesSelfAppointment({
            leadId: lead.id,
            currentVersion: lead.version,
            // `datetime-local` non porta il fuso: la Date nasce nell'ora locale
            // del browser, ed e' il server a ragionare in Europe/Rome.
            at: new Date(whenLocal),
            note,
        }))

    const richiamo = (lead: Lead, whenLocal: string, note: string) =>
        run(lead.id, () => updateLeadOutcome(lead.id, 'RICHIAMO', note, new Date(whenLocal), undefined, undefined, lead.version))

    const nonRisposto = (lead: Lead, note: string) =>
        run(lead.id, () => updateLeadOutcome(lead.id, 'NON_RISPOSTO', note, undefined, undefined, undefined, lead.version))

    const scarta = (lead: Lead, motivo: string, note: string) =>
        run(lead.id, () => updateLeadOutcome(lead.id, 'DA_SCARTARE', note, undefined, undefined, motivo, lead.version))

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                {tabs.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className={tab === t.key ? 'rounded-lg bg-brand-orange px-3 py-1.5 text-sm font-bold text-white' : 'rounded-lg border border-ash-200 bg-white px-3 py-1.5 text-sm font-medium text-ash-600'}>
                        {t.label} ({lists[t.key].length})
                    </button>
                ))}
            </div>

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
            )}

            {lists[tab].length === 0 ? (
                <div className="rounded-2xl border border-ash-200 bg-white p-8 text-center text-sm text-ash-500">
                    Niente da chiamare qui.
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {lists[tab].map(lead => (
                        <SalesLeadCard
                            key={lead.id}
                            lead={lead}
                            busy={busyId === lead.id}
                            onFissa={fissa}
                            onRichiamo={richiamo}
                            onNonRisposto={nonRisposto}
                            onScarta={scarta}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
```

E la card, nello stesso file:

```tsx
function SalesLeadCard({ lead, busy, onFissa, onRichiamo, onNonRisposto, onScarta }: {
    lead: Lead; busy: boolean
    onFissa: (l: Lead, when: string, note: string) => void
    onRichiamo: (l: Lead, when: string, note: string) => void
    onNonRisposto: (l: Lead, note: string) => void
    onScarta: (l: Lead, motivo: string, note: string) => void
}) {
    const [azione, setAzione] = useState<null | 'app' | 'rich' | 'scarto'>(null)
    const [when, setWhen] = useState('')
    const [note, setNote] = useState('')
    const [motivo, setMotivo] = useState(GDO_DISCARD_REASONS[0])

    return (
        <div className="rounded-2xl border border-ash-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-bold text-ash-900">{lead.name}</div>
            {/* Il telefono si vede subito: qui si chiama a freddo. In /venditore
                e' nascosto fino al check-in di trattativa, ma questa e' un'altra
                superficie e un altro momento. */}
            <a href={`tel:${lead.phone}`} className="text-lg font-bold text-brand-orange">{lead.phone}</a>
            <div className="mt-1 text-xs text-ash-500">
                {lead.funnel || 'Senza funnel'} · tentativi: {lead.callCount}
                {lead.email ? ` · ${lead.email}` : ''}
            </div>
            {lead.lastCallNote && (
                <div className="mt-2 rounded-lg bg-ash-50 px-2 py-1 text-xs text-ash-600">{lead.lastCallNote}</div>
            )}

            {/* Contenitori <div>, mai <span>/<p>: bottoni dentro tag testuali
                mandano l'app in schermata bianca su Vercel. */}
            <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => setAzione('app')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Appuntamento</button>
                <button disabled={busy} onClick={() => setAzione('rich')} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Richiamo</button>
                <button disabled={busy} onClick={() => onNonRisposto(lead, note)} className="rounded-lg border border-ash-200 px-3 py-1.5 text-xs font-medium text-ash-700 disabled:opacity-50">Non risposto</button>
                <button disabled={busy} onClick={() => setAzione('scarto')} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 disabled:opacity-50">Da scartare</button>
            </div>

            {azione && (
                <div className="mt-3 space-y-2 border-t border-ash-100 pt-3">
                    {(azione === 'app' || azione === 'rich') && (
                        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
                            className="w-full rounded-lg border border-ash-200 px-2 py-1.5 text-sm" />
                    )}
                    {azione === 'scarto' && (
                        <select value={motivo} onChange={e => setMotivo(e.target.value)}
                            className="w-full rounded-lg border border-ash-200 px-2 py-1.5 text-sm">
                            {GDO_DISCARD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    )}
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Nota"
                        className="w-full rounded-lg border border-ash-200 px-2 py-1.5 text-sm" />
                    <div className="flex gap-2">
                        <button
                            disabled={busy || ((azione === 'app' || azione === 'rich') && !when)}
                            onClick={() => {
                                if (azione === 'app') onFissa(lead, when, note)
                                else if (azione === 'rich') onRichiamo(lead, when, note)
                                else onScarta(lead, motivo, note)
                                setAzione(null)
                            }}
                            className="rounded-lg bg-ash-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                            {busy ? 'Salvo…' : 'Conferma'}
                        </button>
                        <button disabled={busy} onClick={() => setAzione(null)}
                            className="rounded-lg border border-ash-200 px-3 py-1.5 text-xs font-medium text-ash-600">Annulla</button>
                    </div>
                </div>
            )}
        </div>
    )
}
```

Da rispettare comunque, oltre allo scheletro:

- **Nessun pulsante "Invia agenda"** (decisione PO): non importarlo proprio.
- Verifica che `GDO_DISCARD_REASONS` sia esportato come array di stringhe da `@/lib/surveys/questions:207`; se è un oggetto, adatta la `<select>` di conseguenza.

- [ ] **Step 5: La voce di menu**

In `src/components/Sidebar.tsx`, accanto alle voci del ruolo VENDITORE, aggiungi "La mia pipeline" → `/mia-pipeline`. Mostrala solo se la pipeline è accesa per quell'utente: passa il flag dal layout, oppure lascia che la pagina rediriga e mostra la voce a tutti i VENDITORE — **scegli la prima**, perché una voce di menu che rimanda alla home è un difetto che il PO vedrà subito.

- [ ] **Step 6: Verify the build**

Run: `npx tsc --noEmit && npm run lint`
Expected: nessun errore.

- [ ] **Step 7: Verifica manuale**

1. Con la pipeline **spenta**: `/mia-pipeline` rimanda alla home e la voce di menu non c'è.
2. Accesa su un utente di prova con 2 lead: compaiono in 1ª chiamata.
3. "Non risposto" → il lead passa in 2ª chiamata, `callCount` = 1.
4. **La board di un GDO non è cambiata**: apri la home con un account GDO e verifica che le tre colonne e i conteggi siano identici a prima.

- [ ] **Step 8: Commit**

```bash
git add src/app/actions/salesPipelineActions.ts src/app/\(dashboard\)/mia-pipeline src/app/actions/pipelineActions.ts src/components/Sidebar.tsx
git commit -m "feat(pipeline-venditore): la board dei lead da chiamare, con i suoi esiti"
```

---

### Task 6: "Di cui autofissati" nel Pannello Sales Manager

**Files:**
- Modify: `src/app/actions/panoramicaActions.ts:839-852, 894-960, 1209, 1345`
- Modify: `src/app/(dashboard)/panoramica-generale/SalesManagerView.tsx`

**Interfaces:**
- Consumes: `isSelfBooked` (Task 1)
- Produces: `CrmCounts` guadagna il campo `self: StageCounts`

- [ ] **Step 1: Estendere il tipo dei conteggi**

In `src/app/actions/panoramicaActions.ts`, il tipo è oggi:

```ts
type CrmCounts = StageCounts & { nuovi: StageCounts; db: StageCounts };
```

Diventa:

```ts
// `self` NON e' una terza origine come nuovi/db: quelle dicono da dove viene
// il lead, questa dice chi ha fissato. Un autofissato conta sia nella sua
// origine sia qui, e per questo si somma a parte e non dentro lo split.
type CrmCounts = StageCounts & { nuovi: StageCounts; db: StageCounts; self: StageCounts };
```

Aggiorna `emptyCrmCounts()` aggiungendo `self: emptyStageCounts()` (usa la stessa funzione che già inizializza `nuovi` e `db`).

- [ ] **Step 2: Accumulare il di-cui**

In `getCrmFunnelCounts`, dentro il ciclo sui lead, subito dopo la riga che calcola `const split = ...`, aggiungi:

```ts
// Il di-cui autofissati: stessa regola di conteggio del totale, applicata ai
// soli lead con la sentinella. `conferme` non si incrementa mai perche'
// stageHits lo calcola su 'confermato', che un autofissato non ha: la colonna
// resta vuota per costruzione, ed e' la decisione del PO.
const self: StageCounts | null = isSelfBooked(l.confirmationsOutcome) ? bucket.self : null;
```

e in ognuno dei quattro rami `if (hits.X)` aggiungi la riga gemella di quella dello split:

```ts
if (hits.app) { bucket.app++; if (split) split.app++; if (self) self.app++; }
if (hits.conferme) { bucket.conferme++; if (split) split.conferme++; if (self) self.conferme++; }
if (hits.trattative) { bucket.trattative++; if (split) split.trattative++; if (self) self.trattative++; }
if (hits.close) {
    bucket.close++; bucket.fatturato += hits.fatturato;
    if (split) { split.close++; split.fatturato += hits.fatturato; }
    if (self) { self.close++; self.fatturato += hits.fatturato; }
}
```

Aggiungi l'import `import { isSelfBooked } from "@/lib/salesPipeline/sentinel"`.

- [ ] **Step 3: Portare il dato fino alla riga della tabella**

Alle righe dove si legge `crmMap.get(funnelName) || emptyCrmCounts()` (due punti: ~1209 e ~1345), propaga `crm.self` nell'oggetto della riga insieme agli altri conteggi, con lo stesso nome `self`. Segui esattamente la forma con cui `nuovi` e `db` viaggiano già fino al client: stessa struttura, stessi nomi di campo.

- [ ] **Step 4: Mostrarlo**

In `SalesManagerView.tsx`, nelle celle App / Trattative / Chiusure / Fatturato della tabella funnel, sotto il numero grande aggiungi una riga piccola visibile **solo se il valore è > 0**:

```tsx
{row.self.app > 0 && (
    <div className="text-[11px] font-medium text-violet-600">di cui {row.self.app} autofissati</div>
)}
```

(lo stesso per `trattative`, `close` e `fatturato`; per il fatturato formatta in euro con lo stesso helper già usato nella cella).

Sotto Conferme **non** va messo nulla: quella colonna è vuota per costruzione, e una riga "di cui 0" sarebbe rumore.

- [ ] **Step 5: Verify the build**

Run: `npx tsc --noEmit`
Expected: nessun errore. Se altri file leggono `CrmCounts`, il compilatore li segnala: aggiungi `self` anche lì.

- [ ] **Step 6: Verifica manuale**

Apri `/panoramica-generale` su un mese senza autofissati: **nessun numero deve cambiare** rispetto a prima della modifica. Questa è la verifica che conta: il pannello è il documento su cui si prendono decisioni.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/panoramicaActions.ts src/app/\(dashboard\)/panoramica-generale/SalesManagerView.tsx
git commit -m "feat(pipeline-venditore): il di-cui autofissati nel Pannello Sales Manager"
```

---

### Task 7: Alimentazione — i 5 ridati e i 5 freschi

**Files:**
- Create: `src/lib/salesPipeline/feeding.ts`
- Create: `src/lib/salesPipeline/feeding.test.ts`
- Modify: `package.json` (script `test`)
- Modify: `src/app/actions/salesPipelineActions.ts` (azione admin)
- Modify: `src/app/api/webhooks/activecampaign/route.ts` (passo di dirottamento)

**Interfaces:**
- Consumes: `canDivertFresh` (Task 2)
- Produces:
  - `pickMostLoadedGdo(rows: { gdoId: string; nuovi: number }[]): string[]`
  - `shouldDivertFreshLead(input: { cfg: SalesPipelineConfig; diverted: number; launchBucket: string | null; phoneSuspicious: boolean }): boolean`
  - action `assignBotReturnsToSalesPipeline(count: number)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/salesPipeline/feeding.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickMostLoadedGdo, shouldDivertFreshLead } from './feeding'

test('i GDO escono dal piu carico al meno carico', () => {
    assert.deepEqual(
        pickMostLoadedGdo([
            { gdoId: 'a', nuovi: 12 },
            { gdoId: 'b', nuovi: 40 },
            { gdoId: 'c', nuovi: 31 },
        ]),
        ['b', 'c', 'a'],
    )
})

test('a parita di carico l ordine e stabile sull id', () => {
    assert.deepEqual(
        pickMostLoadedGdo([{ gdoId: 'z', nuovi: 5 }, { gdoId: 'a', nuovi: 5 }]),
        ['a', 'z'],
    )
})

test('nessun GDO: lista vuota, non un errore', () => {
    assert.deepEqual(pickMostLoadedGdo([]), [])
})

const cfgOn = { enabled: true, salesUserId: 'marco', freshCap: 5 }

test('lead fresco sotto tetto: si dirotta', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 0, launchBucket: null, phoneSuspicious: false,
    }), true)
})

test('i lead del lancio NON si dirottano mai', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 0, launchBucket: 'LANCIO_WEBDEV_2026', phoneSuspicious: false,
    }), false)
})

test('nessun lead con launchBucket si dirotta: i pool hanno un loro giro', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 0, launchBucket: 'DB_2026_04', phoneSuspicious: false,
    }), false)
})

test('telefono sospetto resta in quarantena', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 0, launchBucket: null, phoneSuspicious: true,
    }), false)
})

test('tetto raggiunto: torna tutto al routing di sempre', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: cfgOn, diverted: 5, launchBucket: null, phoneSuspicious: false,
    }), false)
})

test('pipeline spenta: non si dirotta niente', () => {
    assert.equal(shouldDivertFreshLead({
        cfg: { enabled: false, salesUserId: 'marco', freshCap: 5 },
        diverted: 0, launchBucket: null, phoneSuspicious: false,
    }), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/salesPipeline/feeding.test.ts`
Expected: FAIL — `Cannot find module './feeding'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/salesPipeline/feeding.ts`:

```ts
/**
 * Da dove arrivano i lead della pipeline del venditore.
 *
 * Puro: decide, non scrive. Il DB lo tocca chi chiama.
 */

import { canDivertFresh, type SalesPipelineConfig } from './config'

/** Il bucket del lancio in corso: i suoi lead non si dirottano MAI. */
export const LANCIO_BUCKET = 'LANCIO_WEBDEV_2026'

/**
 * I GDO dal piu' carico al meno carico, per andare a prendere i ridati da chi
 * e' ingolfato e non da chi sta smaltendo. `gdoId` come tiebreaker: senza, due
 * GDO con lo stesso carico si scambiano di posto a ogni giro e la stessa
 * richiesta pesca lead diversi.
 */
export function pickMostLoadedGdo(rows: { gdoId: string; nuovi: number }[]): string[] {
    return [...rows]
        .sort((a, b) => b.nuovi - a.nuovi || a.gdoId.localeCompare(b.gdoId))
        .map(r => r.gdoId)
}

/**
 * Si dirotta questo lead fresco al venditore?
 *
 * Tutto cio' che non e' un lead fresco e pulito passa oltre e segue il routing
 * di sempre. In particolare qualunque `launchBucket` esclude: i pool (lancio,
 * database mensili, Black Summer) hanno un giro loro, e un lead pescato via da
 * li' sparirebbe da conteggi che qualcun altro sta guardando.
 */
export function shouldDivertFreshLead(input: {
    cfg: SalesPipelineConfig
    diverted: number
    launchBucket: string | null
    phoneSuspicious: boolean
}): boolean {
    if (input.launchBucket) return false
    if (input.phoneSuspicious) return false
    return canDivertFresh(input.cfg, input.diverted)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/salesPipeline/feeding.test.ts`
Expected: PASS (9 test)

- [ ] **Step 5: Register the test and commit the pure part**

Aggiungi `src/lib/salesPipeline/feeding.test.ts` allo script `test`.

```bash
npm test
git add src/lib/salesPipeline/feeding.ts src/lib/salesPipeline/feeding.test.ts package.json
git commit -m "feat(pipeline-venditore): regole di alimentazione della pipeline"
```

- [ ] **Step 6: L'azione admin per i ridati**

In `src/app/actions/salesPipelineActions.ts` aggiungi:

```ts
/**
 * Sposta `count` lead ridati dal bot nella pipeline del venditore, prendendoli
 * dal GDO piu' carico. Si toglie lavoro a chi e' ingolfato, non a chi sta
 * girando bene.
 *
 * "Ridato dal bot" e' l'evento REASSIGNED_FROM_BOT, non `callCount = 0`: un
 * rimbalzo del bot azzera il contatore e sembrerebbe un lead mai chiamato.
 */
export async function assignBotReturnsToSalesPipeline(
    count: number,
): Promise<{ success: boolean; error?: string; moved?: number }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== 'ADMIN' && ctx.role !== 'MANAGER') {
        return { success: false, error: 'Solo ADMIN e MANAGER possono assegnare lead alla pipeline.' }
    }
    const cfg = await readSalesPipelineConfig()
    if (!cfg.enabled || !cfg.salesUserId) return { success: false, error: 'Pipeline spenta.' }
    if (!Number.isInteger(count) || count < 1 || count > 50) {
        return { success: false, error: 'Quantita non valida (1-50).' }
    }

    const target = cfg.salesUserId
    const now = new Date()

    // Carico per GDO: lead nuovi ancora da chiamare.
    const carico = await db.select({
        gdoId: leads.assignedToId,
        nuovi: sql<number>`count(*)::int`,
    }).from(leads).innerJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(users.role, 'GDO'),
            eq(users.isActive, true),
            eq(users.isBot, false),
            eq(leads.callCount, 0),
            ne(leads.status, 'REJECTED'),
            ne(leads.status, 'APPOINTMENT'),
        )).groupBy(leads.assignedToId)

    const ordered = pickMostLoadedGdo(
        carico.filter(r => r.gdoId).map(r => ({ gdoId: r.gdoId as string, nuovi: r.nuovi })),
    )

    let moved = 0
    for (const gdoId of ordered) {
        if (moved >= count) break
        const candidates = await db.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.assignedToId, gdoId),
            ne(leads.status, 'REJECTED'),
            ne(leads.status, 'APPOINTMENT'),
            sql`exists (select 1 from "leadEvents" e where e."leadId" = ${leads.id} and e."eventType" = 'REASSIGNED_FROM_BOT')`,
        )).orderBy(leads.createdAt, leads.id).limit(count - moved)

        for (const c of candidates) {
            await db.transaction(async (tx) => {
                await tx.update(leads).set({
                    assignedToId: target,
                    // assignedAt e' il latch della PRIMA presa in carico: non si riscrive.
                    updatedAt: now,
                }).where(eq(leads.id, c.id))
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: c.id,
                    eventType: 'SALES_PIPELINE_ASSIGNED',
                    userId: target, timestamp: now,
                    metadata: { source: 'bot_return', fromGdoId: gdoId },
                    companyId: ctx.companyId,
                })
            })
            moved++
        }
    }

    return { success: true, moved }
}

/** Quanti lead freschi sono gia' stati dirottati alla pipeline, in tutto. */
export async function countDivertedFresh(companyId: string): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` })
        .from(leadEvents).where(and(
            eq(leadEvents.companyId, companyId),
            eq(leadEvents.eventType, 'SALES_PIPELINE_ASSIGNED'),
            sql`${leadEvents.metadata}->>'source' = 'fresh'`,
        ))
    return rows[0]?.n ?? 0
}
```

Aggiungi gli import `pickMostLoadedGdo` da `@/lib/salesPipeline/feeding` e `innerJoin`/`groupBy` se servono.

- [ ] **Step 7: Il dirottamento nel webhook AC**

In `src/app/api/webhooks/activecampaign/route.ts`, **dentro** la transazione, subito **prima** del blocco che calcola `eligible` (la riga `let eligible: { id: string; isBot: boolean }[];`), inserisci:

```ts
// Pipeline autonoma venditore: i primi N lead freschi vanno a lui, poi tutto
// torna esattamente come prima. A tetto raggiunto questo blocco e' due
// letture e un return: il percorso normale non paga quasi nulla.
// Il lock e' sul contatore, non sul lead: senza, due webhook nello stesso
// istante leggono entrambi "4 dirottati" e ne dirottano un sesto.
let divertedTo: string | null = null;
{
    const cfg = await readSalesPipelineConfig();
    if (cfg.enabled && cfg.salesUserId) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('sales-pipeline:fresh', 4))`);
        // Il conteggio va fatto su `tx`, non su `db`: il lock vive nella
        // transazione, e contare da un'altra connessione mentre si tiene il
        // lock qui e' proprio il modo di leggere un numero vecchio.
        const divertedRows = await tx.select({ n: sql<number>`count(*)::int` })
            .from(leadEvents).where(and(
                eq(leadEvents.companyId, FENICE_COMPANY),
                eq(leadEvents.eventType, 'SALES_PIPELINE_ASSIGNED'),
                sql`${leadEvents.metadata}->>'source' = 'fresh'`,
            ));
        const diverted = divertedRows[0]?.n ?? 0;
        if (shouldDivertFreshLead({ cfg, diverted, launchBucket: null, phoneSuspicious })) {
            divertedTo = cfg.salesUserId;
        }
    }
}
```

Poi, dove oggi si fa `const assignedGdoId = eligible[0].id;`, il blocco del calcolo di `eligible` e il `return { kind: 'no_gdo' }` vanno **saltati** se `divertedTo` è valorizzato. Il modo più semplice e meno invasivo:

```ts
const assignedGdoId = divertedTo ?? eligible[0].id;
```

e avvolgere il calcolo di `eligible` in `if (!divertedTo) { ...tutto il blocco di oggi, invariato... }`, dichiarando `let eligible: { id: string; isBot: boolean }[] = [];`.

Dopo l'insert del lead, l'update `acLastAssignedAt` e il `return`:

```ts
if (divertedTo) {
    // Il round robin dei GDO non si muove: questo lead non e' passato di li'.
    await tx.insert(leadEvents).values({
        id: crypto.randomUUID(), leadId: newLeadId,
        eventType: 'SALES_PIPELINE_ASSIGNED',
        userId: divertedTo, timestamp: now,
        metadata: { source: 'fresh' },
        companyId: FENICE_COMPANY,
    });
    return { kind: 'created' as const, assignedGdoId, assignedGdoIsBot: false, routing, holidayWindow, fallbackUsed: false };
}
await tx.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, assignedGdoId));
```

`assignedGdoIsBot: false` è ciò che impedisce al `after(() => pushLeadToBot(...))` a valle di partire: il lead è di una persona, non del bot.

- [ ] **Step 8: Verify the build**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tutto verde.

- [ ] **Step 9: Verifica manuale del percorso normale**

**Questa è la verifica più importante del piano.** Con la pipeline **spenta**, manda un lead di prova al webhook AC e verifica che venga assegnato esattamente come prima (stesso GDO che avrebbe ricevuto, `acLastAssignedAt` aggiornato, push al bot se destinato al bot). Il dirottamento non deve avere alcun effetto osservabile quando è spento.

- [ ] **Step 10: Commit**

```bash
git add src/app/actions/salesPipelineActions.ts src/app/api/webhooks/activecampaign/route.ts
git commit -m "feat(pipeline-venditore): 5 ridati dal GDO piu carico e i primi 5 freschi dirottati"
```

---

### Task 8: La pagina di regolazione `/pipeline-venditore`

**Files:**
- Create: `src/app/(dashboard)/pipeline-venditore/page.tsx`
- Create: `src/app/(dashboard)/pipeline-venditore/PipelineVenditoreClient.tsx`
- Modify: `src/app/actions/salesPipelineActions.ts` (una lettura di riepilogo)
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `getSalesPipelineConfig`, `setSalesPipelineConfig` (Task 2), `assignBotReturnsToSalesPipeline`, `countDivertedFresh` (Task 7)
- Produces: `getSalesPipelineOverview()` → `{ config, divertedFresh, botReturns, leads: Array<{ id, name, phone, status, callCount, appointmentDate, confirmationsOutcome }> }`

- [ ] **Step 1: La lettura di riepilogo**

In `src/app/actions/salesPipelineActions.ts` aggiungi `getSalesPipelineOverview()`: legge la config, i due contatori (freschi dirottati e ridati assegnati, entrambi contando gli eventi `SALES_PIPELINE_ASSIGNED` per `metadata->>'source'`), e l'elenco dei lead con `assignedToId = cfg.salesUserId` **oppure** `salespersonUserId = cfg.salesUserId AND confirmationsOutcome = 'autofissato'` (così restano visibili anche dopo che sono diventati appuntamenti). Guardia: ADMIN/MANAGER.

- [ ] **Step 2: La pagina**

Create `src/app/(dashboard)/pipeline-venditore/page.tsx`, gate `["ADMIN","MANAGER"]` letto da `user_metadata.role` con redirect a `/` (stesso schema di `lead-automatici/page.tsx`), che carica `getSalesPipelineOverview()` e la lista dei venditori con `listVenditori()` da `@/app/actions/salesWeeklyFocusActions`.

- [ ] **Step 3: Il client**

Create `PipelineVenditoreClient.tsx` con:

- **Interruttore acceso/spento** in cima, grande, con lo stato scritto a parole ("Pipeline spenta: i lead seguono il giro di sempre").
- **Selettore del venditore** (dalla lista passata) e **campo tetto freschi** (numero).
- **Contatori in chiaro**: "Freschi dirottati: 3 / 5" e "Ridati assegnati: 5".
- **Pulsante "Assegna N ridati dal GDO più carico"** con campo quantità → `assignBotReturnsToSalesPipeline(n)`; a operazione finita mostra quanti ne ha spostati davvero.
- **Tabella dei lead in pipeline**: nome, telefono, tentativi, stato, e se autofissato la data dell'appuntamento con un badge.
- Contenitori dei bottoni: `<div>`, mai `<span>`/`<p>`.

- [ ] **Step 4: La voce di menu**

In `src/components/Sidebar.tsx`, nel gruppo ADMIN/MANAGER, aggiungi "Pipeline venditore" → `/pipeline-venditore`.

- [ ] **Step 5: Verify the build**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 6: Verifica manuale**

1. Accendi la pipeline scegliendo il venditore → ricarica → lo stato è persistito.
2. Prova ad accendere **senza** scegliere il venditore → errore leggibile, niente accensione.
3. Spegni → la voce "La mia pipeline" sparisce dal menu del venditore e la pagina rimanda alla home.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/pipeline-venditore src/app/actions/salesPipelineActions.ts src/components/Sidebar.tsx
git commit -m "feat(pipeline-venditore): pagina di regolazione, interruttore e assegnazione lead"
```

---

### Task 9: Pulizia di `/lead-automatici`

**Files:**
- Modify: `src/app/(dashboard)/lead-automatici/page.tsx:15-31`
- Modify: `src/app/(dashboard)/lead-automatici/LeadAutomaticiClient.tsx`

- [ ] **Step 1: Togliere le tre sezioni dal client**

In `LeadAutomaticiClient.tsx` rimuovi per intero:

1. la `<section>` **"Lead non importati"** (commento `{/* Lead non importati */}`)
2. la `<section>` **"Bloccati da lista"** (commento `{/* Bloccati da lista ... */}`)
3. il blocco **"Telefoni da verificare"** (commento `{/* Quarantena telefoni: ... */}`)

Rimuovi anche tutto ciò che serviva solo a loro e ora è morto: gli stati `failures`, i memo `realFailures`/`blockedFailures`, le funzioni `refreshFailures`, il retry singolo, il "Riprova tutti", il "Risolto", le prop `initialFailures` e `initialQuarantined` (e i loro tipi), e gli import ora inutilizzati (`listAcFailures`, `retryAllAcFailures`, le icone `AlertTriangle`/`Ban` se non usate altrove nel file).

- [ ] **Step 2: Alleggerire la pagina**

In `page.tsx` togli `listAcFailures` e `listQuarantinedLeads` dall'import e dal `Promise.all`, e le due prop dal componente. Restano `listGdosForAcIntake`, `listAcWebhooks`, `getAcIntakeStats`, `getBotRoutingStatus`.

- [ ] **Step 3: Non toccare il lato server**

**Le server action `listAcFailures`, `retryAllAcFailures`, `listQuarantinedLeads` e `assignQuarantinedLead` in `acIntakeActions.ts` restano dove sono, invariate**, e così il meccanismo che mette i lead in quarantena nel webhook. Si smette solo di mostrarli: il PO li guarderà per conto proprio, e cancellare la logica renderebbe irreversibile una scelta di sola presentazione.

- [ ] **Step 4: Verify the build**

Run: `npx tsc --noEmit && npm run lint`
Expected: nessun errore, nessun warning di variabile o import inutilizzato.

- [ ] **Step 5: Verifica manuale**

Apri `/lead-automatici`: restano i pool GDO, il collegamento webhook, le statistiche e lo stato del routing bot. Le tre sezioni sono sparite e la pagina non ha buchi di layout.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/lead-automatici
git commit -m "chore(lead-automatici): via le tre sezioni di recupero import, il meccanismo resta"
```

---

## Verifica finale prima di accendere in produzione

Da fare in quest'ordine, dopo il deploy e **prima** di mettere `enabled: true`:

- [ ] `npm test` e `npx tsc --noEmit` verdi
- [ ] con pipeline spenta: un lead fresco da AC segue il routing di sempre, la board GDO è identica, `/panoramica-generale` non cambia di un numero
- [ ] accendi la pipeline su Sales 002 con `freshCap: 5`
- [ ] assegna 5 ridati dal GDO più carico e verifica che compaiano in `/mia-pipeline`
- [ ] fai fissare un appuntamento di prova: l'evento esiste sul Google di Sales 002, **ha il link Meet**, e l'invito è arrivato all'indirizzo del lead
- [ ] lo stesso lead **non** compare nella board Conferme, né nel loro storico, né fa scattare l'avviso bloccante dei richiami
- [ ] `/panoramica-generale`: +1 App e "di cui 1 autofissati"; **la colonna Conferme non si muove**
- [ ] registra un esito Chiuso: +1 trattativa, +1 chiusura, fatturato aggiornato, sempre con il di-cui
- [ ] i KPI GDO del giorno precedente sono identici a prima
- [ ] arrivati 5 freschi, il sesto torna al routing di sempre

## Note per chi implementa

- **`callLogs` riceve righe con `userId` = un VENDITORE.** Tutte le query KPI dei GDO passano da `users.role = 'GDO'` e quindi lo escludono, ma vale la pena verificarlo una volta su `/kpi-gdo`, `/monitor-pause` e `/manager-gdo-performance` dopo i primi esiti registrati: è l'unico punto del piano in cui un dato del venditore entra in una tabella storicamente dei GDO.
- **`appointment.outcome` non viene emesso** da questo percorso. Prima di accendere, conferma col ricevitore crm-marketing che l'assenza di quell'evento non gli lasci un appuntamento appeso: se gli servisse, la risposta giusta è un evento nuovo, non riusare quello delle Conferme.
- **Se serve spegnere tutto in fretta:** `enabled: false` dalla pagina. Non servono deploy né modifiche alle env.
