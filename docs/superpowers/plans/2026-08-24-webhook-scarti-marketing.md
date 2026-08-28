# Webhook scarti verso il marketing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emettere un nuovo evento `lead.rejected` verso il CRM marketing esterno ogni volta che un lead viene scartato, con la causale codificata in modo stabile.

**Architecture:** Si innesta sull'outbox HMAC già in produzione (`src/lib/marketing-webhooks/*`). Un modulo puro traduce la causale italiana in un codice stabile; un builder costruisce l'inviluppo; tre hook nei server action lo accodano dopo l'update riuscito. Nessuna migrazione DB: `leads.discardReason` e `leads.confirmationsDiscardReason` sono già scritti dai flussi esistenti.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM, TypeScript, `node:test` + `tsx` per i test puri.

**Spec:** [2026-08-24-webhook-scarti-marketing-design.md](../specs/2026-08-24-webhook-scarti-marketing-design.md)
**Brief per il receiver:** [docs/marketing-lead-rejected-brief.md](../../marketing-lead-rejected-brief.md)

## Global Constraints

- **Branch:** `feat/webhook-scarti-marketing` (già creato, contiene i due commit di docs).
- **Nessuna migrazione DB.** Se un task sembra richiederne una, fermarsi e segnalare.
- **Ogni hook va DOPO l'update riuscito**, mai prima: se l'update fallisce con `CONCURRENCY_ERROR` non deve partire nessun evento.
- **Ogni hook è `.catch()`-ato e non blocca mai il flusso operativo.** Un marketing giù non deve impedire a un GDO di esitare un lead. Segue il pattern dei sei hook esistenti.
- **Test:** `node:test` + `tsx`, stile `src/lib/bot-fissatore/*.test.ts`. Solo funzioni pure, mai il DB.
- **Comandi di verifica:** `npx tsc --noEmit` deve restare pulito; `npm test` deve restare verde.
- **Lingua:** commenti e commit in italiano, come il resto del repo.
- `lead.rejected` è l'unico nome dell'evento. Mai `lead.discarded`, mai `lead.rejection`.

---

## File Structure

| File | Ruolo |
|---|---|
| `src/lib/surveys/questions.ts` | *(modifica)* Casa unica delle liste di causali. Aggiunge `GDO_DISCARD_REASONS` accanto a `CONFERME_DISCARD_REASONS`. |
| `src/components/GdoQuickActions.tsx` | *(modifica)* Importa la lista invece di ridefinirla. |
| `src/components/OutcomeModal.tsx` | *(modifica)* Idem. |
| `src/lib/marketing-webhooks/discard-reasons.ts` | *(nuovo)* Traduzione causale → codice stabile. Puro, zero dipendenze da DB. |
| `src/lib/marketing-webhooks/discard-reasons.test.ts` | *(nuovo)* Test della traduzione. |
| `src/lib/marketing-webhooks/types.ts` | *(modifica)* `lead.rejected` nella union + `LeadRejectedData`. |
| `src/lib/marketing-webhooks/payload-builders.ts` | *(modifica)* `buildLeadRejected`. |
| `src/lib/marketing-webhooks/payload-builders.test.ts` | *(nuovo)* Test del builder e dell'`eventId`. |
| `src/lib/marketing-webhooks/enqueue.ts` | *(modifica)* Campo `rejection` in input + case nello switch. |
| `src/app/actions/pipelineActions.ts` | *(modifica)* Hook GDO/bot + correzione refuso. |
| `src/app/actions/confermeActions.ts` | *(modifica)* Due hook Conferme. |
| `package.json` | *(modifica)* Registra i due nuovi file di test. |

---

## Task 1: Accentra le causali di scarto dei GDO

Le otto causali sono copiaincollate in due componenti. La mappa dei codici del Task 2 deve coprirle tutte, e con due copie va fuori sincrono in silenzio appena qualcuno tocca una sola tendina.

**Questo task NON cambia niente di visibile.** Stesse stringhe, stesso ordine, stessa resa a schermo. È solo uno spostamento.

**Files:**
- Modify: `src/lib/surveys/questions.ts` (in coda, dopo `CONFERME_PAIN_POINT_OPTIONS`)
- Modify: `src/components/GdoQuickActions.tsx:68-77`
- Modify: `src/components/OutcomeModal.tsx:16-25`

**Interfaces:**
- Produces: `GDO_DISCARD_REASONS: readonly string[]` e `type GdoDiscardReason` da `@/lib/surveys/questions`

- [ ] **Step 1: Aggiungi la lista accentrata**

In coda a `src/lib/surveys/questions.ts`:

```ts
// Causali di scarto dei GDO (tendina "Da scartare" in chiamata).
// Erano duplicate in GdoQuickActions.tsx e OutcomeModal.tsx: due copie e la
// mappa dei codici marketing (src/lib/marketing-webhooks/discard-reasons.ts)
// che le deve coprire entrambe andavano fuori sincrono senza accorgersene.
// Stringhe minuscole: sono anche il valore salvato su leads.discardReason,
// cambiarle significa creare una categoria nuova per il marketing.
export const GDO_DISCARD_REASONS = [
    'non interessato',
    'disoccupato',
    'straniero',
    'solo informazioni',
    "non vuole prendere l'appuntamento",
    'numero inesistente',
    'non ha potere decisionale',
    'non ha soldi',
] as const;
export type GdoDiscardReason = typeof GDO_DISCARD_REASONS[number];
```

- [ ] **Step 2: Sostituisci la copia in GdoQuickActions**

Cancella l'intero blocco `const DISCARD_REASONS = [...]` (righe 68-77) e aggiungi all'import esistente in cima al file:

```ts
import { GDO_DISCARD_REASONS } from "@/lib/surveys/questions"
```

Poi, alla riga dove c'era `{DISCARD_REASONS.map(reason => (`, sostituisci con:

```tsx
{GDO_DISCARD_REASONS.map(reason => (
```

Non toccare nient'altro dentro il `.map`.

- [ ] **Step 3: Sostituisci la copia in OutcomeModal**

Identico: cancella `const DISCARD_REASONS = [...]` (righe 16-25), aggiungi l'import

```ts
import { GDO_DISCARD_REASONS } from "@/lib/surveys/questions"
```

e cambia `{DISCARD_REASONS.map(reason => (` in `{GDO_DISCARD_REASONS.map(reason => (`.

- [ ] **Step 4: Verifica che non resti nessuna copia**

Run: `grep -rn "const DISCARD_REASONS" src/`
Expected: nessun risultato.

Run: `npx tsc --noEmit`
Expected: nessun output (pulito).

- [ ] **Step 5: Commit**

```bash
git add src/lib/surveys/questions.ts src/components/GdoQuickActions.tsx src/components/OutcomeModal.tsx
git commit -m "refactor(scarti): una sola lista di causali GDO

Erano duplicate in due componenti. La mappa dei codici marketing le deve
coprire entrambe: con due copie sarebbe andata fuori sincrono in silenzio
al primo ritocco di una tendina. Nessun cambiamento visibile."
```

---

## Task 2: Traduci la causale in un codice stabile

Il marketing raggrupperà su questo codice. Se raggruppasse sulla stringa italiana, ogni ritocco della tendina spaccherebbe i grafici storici.

**Files:**
- Create: `src/lib/marketing-webhooks/discard-reasons.ts`
- Create: `src/lib/marketing-webhooks/discard-reasons.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `GDO_DISCARD_REASONS`, `CONFERME_DISCARD_REASONS` da `@/lib/surveys/questions`
- Produces:
  - `type DiscardReasonCode` (union di 13 stringhe letterali)
  - `discardReasonCode(raw: string | null | undefined): DiscardReasonCode`
  - `discardReasonLabel(raw: string | null | undefined): string`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `src/lib/marketing-webhooks/discard-reasons.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { discardReasonCode, discardReasonLabel } from './discard-reasons';
import { GDO_DISCARD_REASONS, CONFERME_DISCARD_REASONS } from '@/lib/surveys/questions';

describe('discardReasonCode', () => {
    test('ogni causale della tendina GDO ha un codice suo', () => {
        for (const reason of GDO_DISCARD_REASONS) {
            assert.notStrictEqual(
                discardReasonCode(reason), 'OTHER',
                `"${reason}" non e' mappata: il marketing la vedrebbe come OTHER`,
            );
        }
    });

    test('ogni causale della tendina Conferme ha un codice suo', () => {
        for (const { value } of CONFERME_DISCARD_REASONS) {
            assert.notStrictEqual(
                discardReasonCode(value), 'OTHER',
                `"${value}" non e' mappata: il marketing la vedrebbe come OTHER`,
            );
        }
    });

    test('mappa le causali chiave sui codici concordati col receiver', () => {
        assert.strictEqual(discardReasonCode('non ha soldi'), 'NO_BUDGET');
        assert.strictEqual(discardReasonCode('non interessato'), 'NOT_INTERESTED');
        assert.strictEqual(discardReasonCode('numero inesistente'), 'INVALID_NUMBER');
        assert.strictEqual(discardReasonCode("non vuole prendere l'appuntamento"), 'REFUSED_APPOINTMENT');
        assert.strictEqual(discardReasonCode('attaccato in faccia'), 'HUNG_UP');
        assert.strictEqual(discardReasonCode('posticipa senza data'), 'POSTPONED_NO_DATE');
    });

    describe('auto-scarto per irreperibilita', () => {
        test('la grafia corretta da UNREACHABLE', () => {
            assert.strictEqual(discardReasonCode('irreperibile (3 tentativi vuoti)'), 'UNREACHABLE');
            assert.strictEqual(discardReasonCode('irreperibile (4 tentativi vuoti)'), 'UNREACHABLE');
        });

        test('il vecchio refuso "irriperebile" da comunque UNREACHABLE', () => {
            // Fino al 2026-08-24 il CRM scriveva questa stringa: i lead gia'
            // scartati non vanno persi.
            assert.strictEqual(discardReasonCode('irriperebile (3 tentativi vuoti)'), 'UNREACHABLE');
            assert.strictEqual(discardReasonCode('irriperebile (4 tentativi vuoti)'), 'UNREACHABLE');
        });

        test('anche l auto-scarto delle Conferme e irreperibilita', () => {
            assert.strictEqual(discardReasonCode('3 NR consecutivi'), 'UNREACHABLE');
        });
    });

    describe('robustezza', () => {
        test('una causale sconosciuta da OTHER invece di esplodere', () => {
            assert.strictEqual(discardReasonCode('il cane ha mangiato il contratto'), 'OTHER');
        });

        test('null e stringa vuota danno OTHER', () => {
            assert.strictEqual(discardReasonCode(null), 'OTHER');
            assert.strictEqual(discardReasonCode(undefined), 'OTHER');
            assert.strictEqual(discardReasonCode(''), 'OTHER');
        });

        test('maiuscole e spazi di troppo non cambiano il codice', () => {
            assert.strictEqual(discardReasonCode('  NON HA SOLDI  '), 'NO_BUDGET');
            assert.strictEqual(discardReasonCode('Non Ha Soldi'), 'NO_BUDGET');
        });
    });
});

describe('discardReasonLabel', () => {
    test('per le Conferme usa l etichetta gia definita nella tendina', () => {
        assert.strictEqual(discardReasonLabel('attaccato in faccia'), 'Attaccato in faccia');
        assert.strictEqual(discardReasonLabel('non ha soldi'), 'Non ha soldi');
    });

    test('per una causale fuori tendina restituisce il testo ripulito', () => {
        assert.strictEqual(discardReasonLabel('  irreperibile (3 tentativi vuoti)  '), 'irreperibile (3 tentativi vuoti)');
    });

    test('null da stringa vuota', () => {
        assert.strictEqual(discardReasonLabel(null), '');
    });
});
```

- [ ] **Step 2: Registra il test e verificane il fallimento**

In `package.json`, aggiungi il file in coda allo script `test` (spazio-separato, dopo `src/lib/kpi/periodBounds.test.ts`):

```
src/lib/marketing-webhooks/discard-reasons.test.ts
```

Run: `npx tsx --test src/lib/marketing-webhooks/discard-reasons.test.ts`
Expected: FAIL — `Cannot find module './discard-reasons'`.

- [ ] **Step 3: Scrivi il modulo**

Crea `src/lib/marketing-webhooks/discard-reasons.ts`:

```ts
import { CONFERME_DISCARD_REASONS } from '@/lib/surveys/questions';

/**
 * Codice stabile della causale di scarto, per il CRM marketing.
 *
 * Il marketing raggruppa su questo, mai sulla stringa italiana: le etichette
 * sono testo di UI e cambiano, i codici no. Aggiungere valori e' sicuro,
 * rinominarli spacca i loro grafici storici.
 */
export type DiscardReasonCode =
    | 'NO_BUDGET'
    | 'NOT_INTERESTED'
    | 'UNEMPLOYED'
    | 'FOREIGN'
    | 'INFO_ONLY'
    | 'REFUSED_APPOINTMENT'
    | 'INVALID_NUMBER'
    | 'NO_DECISION_POWER'
    | 'UNREACHABLE'
    | 'NO_ANSWER'
    | 'POSTPONED_NO_DATE'
    | 'HUNG_UP'
    | 'OTHER';

/** Causali a testo esatto, normalizzate in minuscolo. */
const BY_REASON: Record<string, DiscardReasonCode> = {
    'non ha soldi': 'NO_BUDGET',
    'non interessato': 'NOT_INTERESTED',
    'disoccupato': 'UNEMPLOYED',
    'straniero': 'FOREIGN',
    'solo informazioni': 'INFO_ONLY',
    "non vuole prendere l'appuntamento": 'REFUSED_APPOINTMENT',
    'numero inesistente': 'INVALID_NUMBER',
    'non ha potere decisionale': 'NO_DECISION_POWER',
    'non risponde': 'NO_ANSWER',
    'posticipa senza data': 'POSTPONED_NO_DATE',
    'attaccato in faccia': 'HUNG_UP',
    '3 nr consecutivi': 'UNREACHABLE',
};

/**
 * Prefissi dell'auto-scarto per irreperibilita'. Non e' un match esatto perche'
 * la stringa porta dentro il numero di tentativi, e perche' fino al 2026-08-24
 * il CRM scriveva "irriperebile": i lead scartati prima di quella data devono
 * continuare a produrre UNREACHABLE.
 */
const UNREACHABLE_PREFIXES = ['irreperibile', 'irriperebile'];

function normalize(raw: string): string {
    return raw.trim().toLowerCase();
}

/** Codice stabile della causale. Non lancia mai: il fallback e' OTHER. */
export function discardReasonCode(raw: string | null | undefined): DiscardReasonCode {
    if (!raw) return 'OTHER';
    const n = normalize(raw);
    if (!n) return 'OTHER';
    if (UNREACHABLE_PREFIXES.some(p => n.startsWith(p))) return 'UNREACHABLE';
    return BY_REASON[n] ?? 'OTHER';
}

/**
 * Etichetta leggibile. Per le causali delle Conferme riusa quella gia' scritta
 * nella tendina ("Attaccato in faccia"); per tutto il resto restituisce il
 * testo ripulito dagli spazi.
 */
export function discardReasonLabel(raw: string | null | undefined): string {
    if (!raw) return '';
    const n = normalize(raw);
    const fromConferme = CONFERME_DISCARD_REASONS.find(o => o.value === n);
    return fromConferme?.label ?? raw.trim();
}
```

- [ ] **Step 4: Verifica che i test passino**

Run: `npx tsx --test src/lib/marketing-webhooks/discard-reasons.test.ts`
Expected: PASS, 12 test.

Run: `npx tsc --noEmit`
Expected: pulito.

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketing-webhooks/discard-reasons.ts src/lib/marketing-webhooks/discard-reasons.test.ts package.json
git commit -m "feat(marketing): codice stabile per la causale di scarto

Il marketing raggruppera' su reasonCode e non sulla stringa italiana: le
etichette sono testo di UI e cambiano, i codici no. Il test fallisce se
domani si aggiunge una causale alla tendina senza mapparla."
```

---

## Task 3: Il tipo e il builder dell'evento

**Files:**
- Modify: `src/lib/marketing-webhooks/types.ts`
- Modify: `src/lib/marketing-webhooks/payload-builders.ts`
- Create: `src/lib/marketing-webhooks/payload-builders.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `discardReasonCode`, `discardReasonLabel`, `DiscardReasonCode` dal Task 2
- Produces:
  - `MarketingEventType` include `'lead.rejected'`
  - `interface LeadRejectedData`
  - `interface RejectionContext extends BuildContext { stage: RejectionStage; automatic: boolean; byBot: boolean }`
  - `type RejectionStage = 'GDO' | 'CONFERME'`
  - `buildLeadRejected(ctx: RejectionContext): MarketingWebhookEnvelope`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `src/lib/marketing-webhooks/payload-builders.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildLeadRejected, deterministicEventId } from './payload-builders';
import type { LeadRejectedData } from './types';

// Lead minimo: il builder legge solo i campi qui sotto. Il cast tiene il test
// puro senza dover costruire tutte le ~90 colonne della tabella leads.
function fakeLead(over: Record<string, unknown> = {}) {
    return {
        id: 'lead-1',
        name: 'Mario Rossi',
        email: 'mario@example.com',
        phone: '+393331234567',
        funnel: 'Black Summer',
        source: 'activecampaign',
        createdAt: new Date('2026-08-20T09:14:00Z'),
        utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'bs-agosto',
        utmContent: null, utmTerm: null,
        callCount: 2,
        discardReason: 'non ha soldi',
        confirmationsDiscardReason: null,
        ...over,
    } as never;
}

const ACTOR = { id: 'u-1', displayName: 'GDO 106', name: 'GDO 106', role: 'GDO' } as never;
const AT = new Date('2026-08-24T13:12:00Z');

describe('buildLeadRejected', () => {
    test('scarto GDO a mano: legge la causale da discardReason', () => {
        const env = buildLeadRejected({
            lead: fakeLead(), actor: ACTOR, occurredAt: AT,
            stage: 'GDO', automatic: false, byBot: false,
        });
        const data = env.data as LeadRejectedData;

        assert.strictEqual(env.eventType, 'lead.rejected');
        assert.strictEqual(env.apiVersion, '1');
        assert.strictEqual(data.stage, 'GDO');
        assert.strictEqual(data.automatic, false);
        assert.strictEqual(data.byBot, false);
        assert.strictEqual(data.reasonCode, 'NO_BUDGET');
        assert.strictEqual(data.rawReason, 'non ha soldi');
        assert.strictEqual(data.callCount, 2);
        assert.strictEqual(data.rejectedAt, '2026-08-24T13:12:00.000Z');
        assert.deepStrictEqual(data.rejectedBy, {
            userId: 'u-1', displayName: 'GDO 106', role: 'GDO',
        });
    });

    test('scarto Conferme: legge la causale da confirmationsDiscardReason', () => {
        const env = buildLeadRejected({
            lead: fakeLead({
                discardReason: 'non interessato',              // campo GDO: da ignorare
                confirmationsDiscardReason: 'attaccato in faccia',
            }),
            actor: ACTOR, occurredAt: AT,
            stage: 'CONFERME', automatic: false, byBot: false,
        });
        const data = env.data as LeadRejectedData;

        assert.strictEqual(data.stage, 'CONFERME');
        assert.strictEqual(data.reasonCode, 'HUNG_UP');
        assert.strictEqual(data.rawReason, 'attaccato in faccia');
        assert.strictEqual(data.reasonLabel, 'Attaccato in faccia');
    });

    test('auto-scarto: automatic true e nessun operatore', () => {
        const env = buildLeadRejected({
            lead: fakeLead({ discardReason: 'irreperibile (3 tentativi vuoti)', callCount: 3 }),
            actor: null, occurredAt: AT,
            stage: 'GDO', automatic: true, byBot: false,
        });
        const data = env.data as LeadRejectedData;

        assert.strictEqual(data.automatic, true);
        assert.strictEqual(data.reasonCode, 'UNREACHABLE');
        assert.strictEqual(data.rejectedBy, null);
    });

    test('scarto del bot: byBot true', () => {
        const env = buildLeadRejected({
            lead: fakeLead(), actor: ACTOR, occurredAt: AT,
            stage: 'GDO', automatic: false, byBot: true,
        });
        assert.strictEqual((env.data as LeadRejectedData).byBot, true);
    });

    test('una causale mai vista non fa esplodere il builder', () => {
        const env = buildLeadRejected({
            lead: fakeLead({ discardReason: 'motivo inventato domani' }),
            actor: ACTOR, occurredAt: AT,
            stage: 'GDO', automatic: false, byBot: false,
        });
        const data = env.data as LeadRejectedData;
        assert.strictEqual(data.reasonCode, 'OTHER');
        assert.strictEqual(data.rawReason, 'motivo inventato domani');
    });

    test('porta anagrafica e UTM come gli altri eventi', () => {
        const env = buildLeadRejected({
            lead: fakeLead(), actor: ACTOR, occurredAt: AT,
            stage: 'GDO', automatic: false, byBot: false,
        });
        assert.strictEqual(env.lead.id, 'lead-1');
        assert.strictEqual(env.lead.phone, '+393331234567');
        assert.strictEqual(env.lead.utm.campaign, 'bs-agosto');
    });
});

describe('deterministicEventId per lead.rejected', () => {
    test('lo stesso scarto rimandato produce lo stesso id', () => {
        const a = deterministicEventId('lead.rejected', 'lead-1', AT);
        const b = deterministicEventId('lead.rejected', 'lead-1', new Date(AT));
        assert.strictEqual(a, b);
    });

    test('due scarti dello stesso giorno a secondi diversi sono eventi diversi', () => {
        // Granularita' al secondo, non al giorno: un lead riaperto e riscartato
        // lo stesso giorno e' un fatto nuovo e deve propagarsi.
        const a = deterministicEventId('lead.rejected', 'lead-1', new Date('2026-08-24T13:12:00Z'));
        const b = deterministicEventId('lead.rejected', 'lead-1', new Date('2026-08-24T18:40:00Z'));
        assert.notStrictEqual(a, b);
    });

    test('lead diversi non collidono', () => {
        const a = deterministicEventId('lead.rejected', 'lead-1', AT);
        const b = deterministicEventId('lead.rejected', 'lead-2', AT);
        assert.notStrictEqual(a, b);
    });
});
```

- [ ] **Step 2: Registra il test e verificane il fallimento**

In `package.json` aggiungi `src/lib/marketing-webhooks/payload-builders.test.ts` in coda allo script `test`.

Run: `npx tsx --test src/lib/marketing-webhooks/payload-builders.test.ts`
Expected: FAIL — `buildLeadRejected` non esportato.

- [ ] **Step 3: Aggiungi il tipo**

In `src/lib/marketing-webhooks/types.ts`:

1. In cima, dopo gli import esistenti (se non ce ne sono, come prima riga):

```ts
import type { DiscardReasonCode } from './discard-reasons';
```

2. Aggiungi `'lead.rejected'` in coda alla union `MarketingEventType` e all'array `ALL_EVENT_TYPES`.

3. Dopo `DealClosedLostData`, aggiungi:

```ts
/** Stadio del funnel in cui il lead e' morto. */
export type RejectionStage = 'GDO' | 'CONFERME';

export interface LeadRejectedData {
    stage: RejectionStage;
    /** true solo per l'auto-scarto dopo il terzo tentativo a vuoto. */
    automatic: boolean;
    reasonCode: DiscardReasonCode;
    reasonLabel: string;
    /** La stringa esatta a DB. Serve quando reasonCode e' OTHER. */
    rawReason: string | null;
    callCount: number;
    /** true se a scartare e' stato il bot fissatore e non un operatore. */
    byBot: boolean;
    rejectedAt: string;
    rejectedBy: ActorRef | null;
}
```

4. Aggiungi `| LeadRejectedData` in coda alla union `EventData`.

- [ ] **Step 4: Aggiungi il builder**

In `src/lib/marketing-webhooks/payload-builders.ts`:

1. Aggiungi agli import di tipo esistenti: `LeadRejectedData`, `RejectionStage`.
2. Aggiungi un import nuovo:

```ts
import { discardReasonCode, discardReasonLabel } from './discard-reasons';
```

3. In coda al file:

```ts
export interface RejectionContext extends BuildContext {
    stage: RejectionStage;
    automatic: boolean;
    byBot: boolean;
}

/**
 * Evento canonico "questo lead e' morto, ed ecco perche'".
 *
 * La causale sta su due colonne diverse a seconda dello stadio: i GDO scrivono
 * leads.discardReason, le Conferme leads.confirmationsDiscardReason. Un lead
 * scartato dalle Conferme puo' avere valorizzate entrambe (e' passato per i GDO
 * prima), quindi lo stage decide quale leggere — non si puo' fare COALESCE.
 */
export function buildLeadRejected(ctx: RejectionContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date(), stage, automatic, byBot } = ctx;
    const raw = stage === 'CONFERME' ? lead.confirmationsDiscardReason : lead.discardReason;

    const data: LeadRejectedData = {
        stage,
        automatic,
        reasonCode: discardReasonCode(raw),
        reasonLabel: discardReasonLabel(raw),
        rawReason: raw,
        callCount: lead.callCount,
        byBot,
        rejectedAt: occurredAt.toISOString(),
        rejectedBy: actorFromUser(actor),
    };

    return {
        eventId: deterministicEventId('lead.rejected', lead.id, occurredAt),
        eventType: 'lead.rejected',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}
```

- [ ] **Step 5: Verifica che i test passino**

Run: `npx tsx --test src/lib/marketing-webhooks/payload-builders.test.ts`
Expected: PASS, 9 test.

Run: `npx tsc --noEmit`
Expected: pulito.

> Se `tsc` lamenta che lo `switch` in `enqueue.ts` non copre `'lead.rejected'`, è atteso: lo chiude il Task 4. Se invece è un errore di tipo su `EventData` o `LeadRejectedData`, fermarsi e correggere qui.

- [ ] **Step 6: Commit**

```bash
git add src/lib/marketing-webhooks/types.ts src/lib/marketing-webhooks/payload-builders.ts src/lib/marketing-webhooks/payload-builders.test.ts package.json
git commit -m "feat(marketing): inviluppo dell evento lead.rejected

La causale sta su due colonne diverse a seconda dello stadio, quindi lo
stage decide quale leggere: un lead scartato dalle Conferme e' passato per
i GDO prima e puo' averle valorizzate entrambe.

eventId al secondo e non al giorno: un lead riaperto e riscartato lo stesso
giorno e' un fatto nuovo e deve arrivare."
```

---

## Task 4: `enqueueMarketingWebhook` accetta lo scarto

**Files:**
- Modify: `src/lib/marketing-webhooks/enqueue.ts:16-25` (interfaccia) e lo `switch` a `:60`

**Interfaces:**
- Consumes: `buildLeadRejected`, `RejectionStage` dal Task 3
- Produces: campo opzionale `rejection` su `EnqueueInput`

- [ ] **Step 1: Estendi l'input**

In `src/lib/marketing-webhooks/enqueue.ts`, dentro `interface EnqueueInput`, dopo `newAppointmentDate?: Date;`:

```ts
    // Solo per lead.rejected: contesto che non e' derivabile dalla riga del
    // lead. La causale invece si legge dal lead, non va passata qui.
    rejection?: {
        stage: RejectionStage;
        automatic: boolean;
        byBot?: boolean;
    };
```

E aggiungi ai type import in cima:

```ts
import type { MarketingEventType, MarketingWebhookEnvelope, RejectionStage } from './types';
```

(sostituisce l'import esistente da `'./types'`, mantenendo i simboli già presenti).

- [ ] **Step 2: Aggiungi il case allo switch**

Nello `switch (input.eventType)`, accanto agli altri case:

```ts
        case 'lead.rejected': {
            if (!input.rejection) {
                console.error(`[marketing-webhooks] lead.rejected senza rejection per ${input.leadId}, skip`);
                return;
            }
            envelope = buildLeadRejected({
                ...ctx,
                stage: input.rejection.stage,
                automatic: input.rejection.automatic,
                byBot: input.rejection.byBot ?? false,
            });
            break;
        }
```

Aggiungi `buildLeadRejected` all'import da `'./payload-builders'`.

> `return` e non `throw`: un chiamante che dimentica il contesto non deve far fallire l'esito di un lead. Gli altri hook seguono la stessa filosofia.

- [ ] **Step 3: Verifica**

Run: `npx tsc --noEmit`
Expected: pulito.

Run: `npm test`
Expected: tutti verdi.

- [ ] **Step 4: Commit**

```bash
git add src/lib/marketing-webhooks/enqueue.ts
git commit -m "feat(marketing): enqueue accetta il contesto dello scarto

Solo stage e automatic vanno passati: la causale sta gia' sulla riga del
lead che enqueue carica comunque. Contesto mancante = skip con log, mai
un throw che farebbe fallire l esito di un lead."
```

---

## Task 5: Aggancia lo scarto dei GDO e del bot

Un solo hook copre tre casi: scarto a mano del GDO, auto-scarto al terzo tentativo vuoto, e scarto del bot — perché `/api/bot/outcome` richiama la stessa `updateLeadOutcome` con un `serviceCtx`.

**Files:**
- Modify: `src/app/actions/pipelineActions.ts` — blocco auto-scarto (~riga 375) e dopo il blocco `if (outcome === 'APPUNTAMENTO')` (~riga 495)

**Interfaces:**
- Consumes: `enqueueMarketingWebhook` con `rejection` dal Task 4 (import già presente nel file)

- [ ] **Step 1: Correggi il refuso**

Nel ramo `else if (outcome === 'NON_RISPOSTO')`, sostituisci le due stringhe:

```ts
        if (newCallCount >= 4) {
            newStatus = 'REJECTED'
            discardReason = "irreperibile (4 tentativi vuoti)"
        } else if (newCallCount === 3) {
            newStatus = 'REJECTED'
            discardReason = "irreperibile (3 tentativi vuoti)"
        } else {
```

Erano `"irriperebile"`. La mappa del Task 2 riconosce entrambe le grafie, quindi i lead già scartati continuano a produrre `UNREACHABLE`.

- [ ] **Step 2: Aggiungi l'hook**

Subito **dopo** la chiusura del blocco `if (outcome === 'APPUNTAMENTO') { … }` (quello che contiene l'hook `appointment.set` e `notifyAppointmentToBot`), aggiungi:

```ts
    // Marketing: il lead e' morto qui. Copre i tre casi che passano da questa
    // funzione — scarto a mano del GDO, auto-scarto al terzo tentativo vuoto,
    // e scarto del bot, che richiama updateLeadOutcome con serviceCtx.
    if (newStatus === 'REJECTED' && (outcome === 'DA_SCARTARE' || outcome === 'NON_RISPOSTO')) {
        await enqueueMarketingWebhook({
            eventType: 'lead.rejected',
            leadId,
            actorUserId: effectiveUserId ?? null,
            rejection: {
                stage: 'GDO',
                automatic: outcome === 'NON_RISPOSTO',
                byBot: isBotActor,
            },
        }).catch((e: unknown) => console.error("Marketing webhook (lead.rejected GDO) err:", e));
    }
```

> Il vincolo sull'`outcome` non è ridondante: senza, un lead già `REJECTED` che riceve un esito che non cambia stato rimanderebbe l'evento.

- [ ] **Step 3: Verifica che l'hook sia dopo l'update**

Run: `grep -n "CONCURRENCY_ERROR\|lead.rejected GDO" src/app/actions/pipelineActions.ts`
Expected: la riga `lead.rejected GDO` ha un numero **maggiore** di quella del `return { success: false, error: 'CONCURRENCY_ERROR' }` che segue `updated.length === 0`. Se non è così, l'hook è nel posto sbagliato: spostarlo.

Run: `npx tsc --noEmit`
Expected: pulito.

Run: `npm test`
Expected: tutti verdi.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/pipelineActions.ts
git commit -m "feat(marketing): gli scarti dei GDO e del bot arrivano al marketing

Un hook solo per tre casi: scarto a mano, auto-scarto al terzo tentativo
vuoto e scarto del bot, che passa dalla stessa updateLeadOutcome.

Corretto anche il refuso 'irriperebile' -> 'irreperibile'. La mappa dei
codici riconosce entrambe le grafie: i lead gia' scartati non si perdono."
```

---

## Task 6: Aggancia lo scarto delle Conferme

Le Conferme hanno **due** punti di scarto: quello a mano e un auto-scarto al terzo mancato contatto, con causale `'3 NR consecutivi'`.

**Files:**
- Modify: `src/app/actions/confermeActions.ts` — dopo l'hook `appointment.outcome` in `setConfermeOutcome` (~riga 610) e dopo quello in `recordConfermeNoAnswer` (~riga 948)

**Interfaces:**
- Consumes: `enqueueMarketingWebhook` con `rejection` dal Task 4 (import già presente nel file)

- [ ] **Step 1: Aggancia lo scarto a mano**

In `setConfermeOutcome`, subito **dopo** il blocco `await enqueueMarketingWebhook({ eventType: 'appointment.outcome', … })` e **prima** dell'`if (salespersonAssigned)`:

```ts
        // Marketing: evento canonico dello scarto. Convive con appointment.outcome
        // qui sopra, che resta per retrocompatibilita' — il receiver e' avvisato
        // di contare gli scarti solo da lead.rejected (vedi il brief).
        if (outcome === 'scartato') {
            await enqueueMarketingWebhook({
                eventType: 'lead.rejected',
                leadId,
                actorUserId: session.user.id,
                rejection: { stage: 'CONFERME', automatic: false, byBot: false },
            }).catch((e: unknown) => console.error("Marketing webhook (lead.rejected Conferme) err:", e));
        }
```

- [ ] **Step 2: Aggancia l'auto-scarto al 3° NR**

In `recordConfermeNoAnswer`, **dentro** il blocco `if (isAutoDiscard) { … }` che già emette `appointment.outcome`, subito dopo quella chiamata:

```ts
            await enqueueMarketingWebhook({
                eventType: 'lead.rejected',
                leadId,
                actorUserId: session.user.id,
                rejection: { stage: 'CONFERME', automatic: true, byBot: false },
            }).catch((e: unknown) => console.error("Marketing webhook (lead.rejected Conferme auto) err:", e));
```

- [ ] **Step 3: Verifica**

Run: `grep -c "lead.rejected" src/app/actions/confermeActions.ts`
Expected: `2`.

Run: `npx tsc --noEmit`
Expected: pulito.

Run: `npm test`
Expected: tutti verdi.

Run: `npm run build`
Expected: build completata senza errori.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/confermeActions.ts
git commit -m "feat(marketing): gli scarti delle Conferme arrivano al marketing

Due punti: lo scarto a mano e l auto-scarto al terzo mancato contatto,
che porta causale '3 NR consecutivi' e mappa su UNREACHABLE.

appointment.outcome resta intatto: il receiver e' avvisato di contare gli
scarti da lead.rejected soltanto, altrimenti raddoppia i numeri Conferme."
```

---

## Verifica finale (dopo il Task 6)

- [ ] `npm test` — tutti verdi, inclusi i 21 test nuovi (12 sulla mappa, 9 sul builder)
- [ ] `npx tsc --noEmit` — pulito
- [ ] `npm run build` — build di produzione OK
- [ ] `grep -rn "const DISCARD_REASONS" src/` — nessun risultato (nessuna copia superstite)
- [ ] `grep -rn "irriperebile" src/` — solo in `discard-reasons.ts`, come grafia storica riconosciuta

**Non fare il merge in `main` senza avere prima la conferma dal receiver.** L'evento parte appena il codice è in produzione, e se il loro endpoint lo rifiuta gli eventi finiscono in DLQ. La checklist di accettazione a sette punti è in `docs/marketing-lead-rejected-brief.md` §9.

Se serve andare in produzione prima della loro conferma: si mergia e si tiene `MARKETING_WEBHOOK_ENABLED=false` su Vercel finché non sono pronti — ma attenzione, quel flag spegne **tutti e sette** gli eventi, non solo il nuovo.
