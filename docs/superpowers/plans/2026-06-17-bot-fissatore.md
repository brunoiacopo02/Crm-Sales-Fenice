# Bot Fissatore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrare un bot esterno che contatta i lead Fenice via messaggio per fissare appuntamenti, tramite un account GDO "fantasma" (gdo205) con tetto 20 lead/giorno, push HMAC all'assegnazione e callback inbound che porta il lead alle Conferme con un report strutturato di pain point.

**Architecture:** gdo205 è una riga `users` reale flaggata `isBot=true` che partecipa al round-robin AC esistente con un cap giornaliero. All'assegnazione il CRM fa un POST firmato HMAC al webhook del bot. Il bot chatta e richiama `POST /api/bot/outcome` (firmato HMAC) che riusa `updateLeadOutcome` per la transizione di stato (handoff Conferme incluso), salvando il report in `leads.botReport`. Le Conferme vedono il report come card nel ConfermeDrawer e un badge 🤖 in board. La gamification è spenta per gli account bot; i KPI restano attivi.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM (drizzle-kit 0.31.9), Supabase Postgres, HMAC-SHA256 (`node:crypto`), `next/server` `after()` per consegne fire-and-forget.

## Global Constraints

- **No test runner nel repo** (no vitest/jest). Verifica di ogni task = `npm run lint` + `npm run build` (typecheck Next/TS) + un controllo funzionale concreto (curl firmato contro `npm run dev`, query SQL, o Playwright per la UI). Questo è una deviazione deliberata dal TDD di default, imposta da CLAUDE.md ("compila perfettamente al primo colpo") e dall'assenza di infrastruttura di test.
- **Tenant:** tutto è scoped a `companyId='fenice'`. Costante esistente nel webhook: `FENICE_COMPANY = 'fenice'`.
- **Branch di lavoro:** `feat/bot-fissatore` (già creato, contiene la spec). Tutti i commit vanno qui.
- **HMAC scheme (riuso):** firma = `sha256=` + hex(hmac-sha256(rawBody, secret)), header `x-bot-signature`. Helper esistenti: `signPayload(rawBody, secret)` e `verifySignature(rawBody, header, secret)` in `src/lib/marketing-webhooks/signing.ts`.
- **Env nuovi:** `BOT_INTAKE_URL`, `BOT_WEBHOOK_SECRET`, `BOT_INTAKE_ENABLED` (`'true'` per attivare il push). Da configurare su Vercel a deploy.
- **Cap giornaliero bot:** costante `BOT_DAILY_CAP = 20`, finestra = giorno solare `Europe/Rome`.
- **Gamification OFF, KPI ON** per gli account `isBot=true`.
- **Migrazioni:** generare SQL con `npx drizzle-kit generate`, applicare al progetto Supabase via MCP `apply_migration`. Le modifiche sono additive/nullable → non-breaking.

---

## File Structure

- `src/db/schema.ts` — MODIFY: `users.isBot` (boolean), `leads.botReport` (jsonb).
- `src/app/actions/pipelineActions.ts` — MODIFY: `updateLeadOutcome` accetta `serviceCtx` opzionale (bypass tenant/sessione + skip gamification).
- `src/lib/bot-fissatore/push.ts` — CREATE: `pushLeadToBot(...)` push firmato all'assegnazione.
- `src/lib/bot-fissatore/types.ts` — CREATE: tipi condivisi (`BotReport`, payload).
- `src/app/api/webhooks/activecampaign/route.ts` — MODIFY: cap nel round-robin + push post-commit.
- `src/app/api/bot/outcome/route.ts` — CREATE: endpoint inbound bot → CRM.
- `src/components/ConfermeDrawer.tsx` — MODIFY: card "🤖 Report Bot".
- Componente riga board Conferme (da individuare, prob. `src/components/ConfermeBoardRow.tsx`) — MODIFY: badge 🤖.

---

## Task 1: Schema (`isBot`, `botReport`) + seed gdo205

**Files:**
- Modify: `src/db/schema.ts` (users ~riga 84, leads — sezione campi)
- Create: file di migration generato in `drizzle/` (output di drizzle-kit)

**Interfaces:**
- Produces: colonna `users.isBot: boolean` (default false, notNull); colonna `leads.botReport: jsonb` (nullable); riga `users` con `gdoCode=205`, `isBot=true`.

- [ ] **Step 1: Aggiungi `isBot` allo schema users**

In `src/db/schema.ts`, subito dopo `statsActive` (riga ~84), aggiungi:

```ts
    // Account bot (es. bot fissatore gdo205): partecipa al round-robin e ai KPI
    // come un GDO, ma la gamification è disattivata e all'assegnazione il CRM
    // pusha il lead al webhook del bot. Interruttore unico per gamification-off
    // + push + badge report nelle Conferme.
    isBot: boolean('isBot').default(false).notNull(),
```

- [ ] **Step 2: Aggiungi `botReport` allo schema leads**

In `src/db/schema.ts`, nella definizione di `leads`, vicino agli altri campi nota/Conferme, aggiungi:

```ts
    // Report strutturato scritto dal bot fissatore al momento dell'esito.
    // Forma attesa: { summary, painPoints[], budgetSignal, urgency, objections[], levaConsigliata }.
    // Renderizzato come card "🤖 Report Bot" nel ConfermeDrawer. Nullable: solo i lead bot lo hanno.
    botReport: jsonb('botReport'),
```

Assicurati che `jsonb` sia già importato da `drizzle-orm/pg-core` in cima al file (lo è — `leadEvents.metadata` lo usa). Se non lo fosse, aggiungilo all'import.

- [ ] **Step 3: Genera la migration**

Run: `npx drizzle-kit generate`
Expected: nuovo file SQL in `drizzle/` con `ALTER TABLE "users" ADD COLUMN "isBot" boolean DEFAULT false NOT NULL;` e `ALTER TABLE "leads" ADD COLUMN "botReport" jsonb;`. Apri il file e verifica che contenga **solo** queste due ALTER (nessun drop inatteso). Se drizzle-kit propone modifiche non correlate, interrompi e segnala.

- [ ] **Step 4: Applica la migration al DB**

Applica l'SQL generato al progetto Supabase via MCP `apply_migration` (name: `add_isbot_and_botreport`, query = il contenuto del file SQL generato). Le due ALTER sono additive e non-breaking.

- [ ] **Step 5: Seed dell'account gdo205**

Esegui via MCP Supabase `execute_sql` (l'account non fa mai login UI → basta la riga DB, nessun account Supabase Auth):

```sql
INSERT INTO users (id, name, "displayName", email, password, role, "companyId",
                   area, "gdoCode", "isActive", "acAutoIntake", "statsActive", "isBot")
VALUES (gen_random_uuid()::text, 'Bot Fissatore', 'Bot Fissatore 🤖',
        'gdo205@fenice.local', 'BOT_NO_LOGIN', 'GDO', 'fenice',
        'sales', 205, true, true, true, true)
ON CONFLICT ("gdoCode") DO UPDATE SET "isBot" = true, "acAutoIntake" = true;
```

- [ ] **Step 6: Verifica colonne e riga**

Via `execute_sql`:
```sql
SELECT id, "gdoCode", "isBot", "acAutoIntake", "statsActive", role, "companyId"
FROM users WHERE "gdoCode" = 205;
```
Expected: una riga, `isBot=true`, `acAutoIntake=true`, `statsActive=true`, role `GDO`, companyId `fenice`. Annota lo `id` restituito (servirà per i test manuali).

- [ ] **Step 7: Lint + build**

Run: `npm run lint && npm run build`
Expected: nessun errore di tipo sulle nuove colonne.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(bot-fissatore): schema users.isBot + leads.botReport + seed gdo205"
```

---

## Task 2: `updateLeadOutcome` con service context (tenant bypass + gamification off)

**Files:**
- Modify: `src/app/actions/pipelineActions.ts:295-497` (`updateLeadOutcome`)

**Interfaces:**
- Consumes: niente di nuovo.
- Produces: nuovo parametro opzionale finale `serviceCtx?: { companyId: string; actorUserId: string; isBot: boolean }`. Quando presente: salta `currentTenant()`/`assertSalesArea()` e usa `serviceCtx.companyId` come tenant e `serviceCtx.actorUserId` come attore; se `serviceCtx.isBot` è true, salta TUTTA la gamification (chest, boss, XP/coins, duelli, team goal, loot, creature). La transizione di stato, il call log, l'event log e il marketing webhook restano invariati. Firma usata dalla route inbando in Task 5: `updateLeadOutcome(leadId, outcome, note, date, undefined, discardReason, undefined, undefined, serviceCtx)`.

- [ ] **Step 1: Estendi la firma**

Modifica la firma (riga 295-304) aggiungendo l'ultimo parametro:

```ts
export async function updateLeadOutcome(
    leadId: string,
    outcome: 'DA_SCARTARE' | 'NON_RISPOSTO' | 'RICHIAMO' | 'APPUNTAMENTO',
    note: string,
    date?: Date, // recallDate or appointmentDate
    userId?: string,
    discardReason?: string, // New field
    currentVersion?: number, // Optimistic locking
    scriptCompleted?: boolean, // Script tracking
    serviceCtx?: { companyId: string; actorUserId: string; isBot: boolean } // Bot/service-account bypass
) {
```

- [ ] **Step 2: Risolvi attore e tenant con bypass**

Sostituisci il blocco righe 306-312 (da `const supabase = await createClient()` fino a `assertSalesArea(ctx)`) con:

```ts
    let ctx: { companyId: string }
    let effectiveUserId: string | undefined
    let isBotActor = false

    if (serviceCtx) {
        // Service account (bot fissatore): nessuna sessione Supabase, tenant esplicito.
        ctx = { companyId: serviceCtx.companyId }
        effectiveUserId = serviceCtx.actorUserId
        isBotActor = serviceCtx.isBot
    } else {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        effectiveUserId = userId || session?.user?.id

        const tenant = await currentTenant()
        assertSalesArea(tenant)
        ctx = { companyId: tenant.companyId }
    }
```

Nota: `ctx` viene usato nel resto della funzione solo come `ctx.companyId` (righe 315, 344, 421, 457, 473), quindi `{ companyId }` è sufficiente.

- [ ] **Step 3: Salta la gamification "chiamate" per il bot**

Il blocco righe 435-441 (chest chiamate + boss + duel) deve diventare condizionato anche su `!isBotActor`. Sostituisci `if (effectiveUserId) {` (riga 435) con:

```ts
    if (effectiveUserId && !isBotActor) {
```

- [ ] **Step 4: Salta la gamification "fissaggio"/team per il bot**

Nel blocco `if (outcome === 'APPUNTAMENTO')` (righe 443-494), la logica di stato/evento/marketing webhook resta. Devono invece essere saltate quando `isBotActor`:
- l'`if (effectiveUserId)` interno con `awardXpAndCoins` + chest fissaggi + boss + duel (righe 472-480) → cambia in `if (effectiveUserId && !isBotActor) {`
- `evaluateTeamGoals` (righe 481-483) → avvolgi in `if (!isBotActor) { ... }`
- il blocco loot/boss (righe 485-493) → cambia `if (effectiveUserId)` in `if (effectiveUserId && !isBotActor) {`

Lascia invariati: `conferme_scarto_reset` event (righe 445-462) e `enqueueMarketingWebhook` (righe 464-469) — valgono anche per i lead bot (appuntamento reale).

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: nessun errore. Il path umano (senza `serviceCtx`) è invariato: stesso comportamento di prima.

- [ ] **Step 6: Verifica non-regressione del path umano**

Avvia `npm run dev`, fai login come un GDO reale e fissa un appuntamento da UI. Verifica che il lead passi a APPOINTMENT e che la gamification (XP/coins) scatti come prima. (Questo conferma che il branch `else` non è stato rotto.)

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/pipelineActions.ts
git commit -m "feat(bot-fissatore): updateLeadOutcome accetta serviceCtx (tenant bypass + gamification off per bot)"
```

---

## Task 3: Push CRM → bot all'assegnazione

**Files:**
- Create: `src/lib/bot-fissatore/types.ts`
- Create: `src/lib/bot-fissatore/push.ts`
- Test (manuale): mock endpoint locale

**Interfaces:**
- Consumes: `signPayload` da `src/lib/marketing-webhooks/signing.ts`.
- Produces:
  - `types.ts`: `interface BotReport { summary?: string; painPoints?: string[]; budgetSignal?: string; urgency?: string; objections?: string[]; levaConsigliata?: string }` e `interface BotIntakePayload { leadId: string; name: string | null; phone: string; email: string | null; funnel: string | null; companyId: string }`.
  - `push.ts`: `pushLeadToBot(payload: BotIntakePayload): Promise<void>` — fire-and-forget, no-op se `BOT_INTAKE_ENABLED !== 'true'`.

- [ ] **Step 1: Crea i tipi condivisi**

Crea `src/lib/bot-fissatore/types.ts`:

```ts
/** Report strutturato che il bot scrive su leads.botReport (tutti i campi opzionali). */
export interface BotReport {
    summary?: string;
    painPoints?: string[];
    budgetSignal?: string;
    urgency?: string;       // 'alta' | 'media' | 'bassa' (libero, non vincolato a livello tipo)
    objections?: string[];
    levaConsigliata?: string;
}

/** Payload inviato al webhook del bot quando un lead viene assegnato a gdo205. */
export interface BotIntakePayload {
    leadId: string;
    name: string | null;
    phone: string;
    email: string | null;
    funnel: string | null;
    companyId: string;
}
```

- [ ] **Step 2: Crea il modulo push**

Crea `src/lib/bot-fissatore/push.ts`:

```ts
import { signPayload } from '@/lib/marketing-webhooks/signing';
import type { BotIntakePayload } from './types';

/**
 * Notifica il bot esterno che un lead gli è stato assegnato. Best-effort,
 * no-retry (per il test): un fallimento NON deve impattare l'intake del lead.
 * Kill-switch: BOT_INTAKE_ENABLED !== 'true' → no-op.
 */
export async function pushLeadToBot(payload: BotIntakePayload): Promise<void> {
    if (process.env.BOT_INTAKE_ENABLED !== 'true') return;

    const url = process.env.BOT_INTAKE_URL;
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!url || !secret) {
        console.error('[bot-fissatore] missing env: BOT_INTAKE_URL or BOT_WEBHOOK_SECRET');
        return;
    }

    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody, secret);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-bot-signature': signature,
            },
            body: rawBody,
        });
        if (!res.ok) {
            console.error(`[bot-fissatore] push non-2xx: ${res.status} for lead ${payload.leadId}`);
        }
    } catch (e) {
        console.error(`[bot-fissatore] push failed for lead ${payload.leadId}`, e);
    }
}
```

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: nessun errore.

- [ ] **Step 4: Test manuale del push (firma)**

Crea un mock endpoint con un piccolo script che verifica la firma. In un terminale separato:

```bash
node -e '
const http=require("http"),crypto=require("crypto");
const SECRET="test-secret";
http.createServer((req,res)=>{let b="";req.on("data",c=>b+=c);req.on("end",()=>{
  const sig=req.headers["x-bot-signature"];
  const exp="sha256="+crypto.createHmac("sha256",SECRET).update(b).digest("hex");
  console.log("match:", sig===exp, "body:", b);
  res.end("ok");
});}).listen(4555,()=>console.log("mock bot on :4555"));
'
```

Poi in un secondo terminale, con un piccolo runner che importa il modulo non è pratico (ESM/Next). In alternativa testa direttamente la firma:

```bash
node -e '
const crypto=require("crypto");
const SECRET="test-secret";
const body=JSON.stringify({leadId:"x",name:"Mario",phone:"+39333",email:null,funnel:"TG",companyId:"fenice"});
const sig="sha256="+crypto.createHmac("sha256",SECRET).update(body).digest("hex");
require("http").request({host:"127.0.0.1",port:4555,method:"POST",headers:{"content-type":"application/json","x-bot-signature":sig}},r=>{}).end(body);
'
```

Expected: il mock stampa `match: true`. (Conferma che lo schema di firma combacia con quello che il bot dovrà verificare.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot-fissatore/
git commit -m "feat(bot-fissatore): modulo push firmato HMAC verso il webhook del bot"
```

---

## Task 4: Round-robin con cap 20/giorno per gli account bot

**Files:**
- Modify: `src/app/api/webhooks/activecampaign/route.ts:516-528` (query `eligible` + selezione)

**Interfaces:**
- Consumes: nessuna nuova dipendenza.
- Produces: gli account `isBot=true` vengono esclusi dal pool round-robin quando hanno ≥ `BOT_DAILY_CAP` lead Fenice assegnati nel giorno solare `Europe/Rome`. Gli account umani non sono mai toccati dalla condizione.

- [ ] **Step 1: Aggiungi la costante del cap**

In cima a `route.ts` vicino a `FENICE_COMPANY` (riga ~34), aggiungi:

```ts
const BOT_DAILY_CAP = 20; // max lead/giorno (Europe/Rome) per account isBot nel round-robin
```

- [ ] **Step 2: Calcola la data odierna Italia prima della tx**

Subito prima di `const txResult = await db.transaction(...)` (riga ~480), aggiungi:

```ts
        // Giorno solare corrente in Europe/Rome (per il cap giornaliero dei bot).
        // Lasciamo a Postgres la conversione tz: confronto createdAt >= today 00:00 Rome.
        const todayRome = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(now); // 'YYYY-MM-DD'
```

(`now` è già definito nello scope del handler — è lo stesso usato per `createdAt`.)

- [ ] **Step 3: Aggiungi la condizione cap alla query eligible**

Sostituisci la query `eligible` (righe 516-523) con:

```ts
            const eligible = await tx.select({
                id: users.id,
                isBot: users.isBot,
            }).from(users).where(and(
                eq(users.companyId, FENICE_COMPANY),
                eq(users.role, 'GDO'),
                eq(users.isActive, true),
                eq(users.acAutoIntake, true),
                // Cap giornaliero: gli account bot escono dal pool a quota BOT_DAILY_CAP.
                // Gli umani (isBot=false) passano sempre il filtro.
                sql`(${users.isBot} = false OR (
                    SELECT count(*) FROM leads l
                    WHERE l."assignedToId" = ${users.id}
                      AND l."companyId" = ${FENICE_COMPANY}
                      AND l."createdAt" >= (${todayRome} || ' 00:00')::timestamp AT TIME ZONE 'Europe/Rome'
                ) < ${BOT_DAILY_CAP})`,
            )).orderBy(asc(sql`coalesce(${users.acLastAssignedAt}, 'epoch'::timestamptz)`), asc(users.id));
```

Nota: il conteggio si basa su `leads.createdAt`/`assignedToId` (i lead AC nascono con `createdAt=now` e `assignedToId` impostato nella stessa tx), non su `leadEvents` — il webhook AC non scrive un evento ASSIGNED.

- [ ] **Step 4: Propaga `isBot` dal risultato della tx**

Nel `return { kind: 'created' as const, assignedGdoId }` (riga 554), includi anche il flag bot:

```ts
            return { kind: 'created' as const, assignedGdoId, assignedGdoIsBot: eligible[0].isBot };
```

(Serve in Task 4-bis/Task 3-wiring per decidere il push. Lo cabliamo nel prossimo step.)

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: nessun errore. La sottoquery SQL è valida (count su leads scoping tenant + giorno Rome).

- [ ] **Step 6: Verifica funzionale del cap (DB)**

Con `npm run dev` attivo, simula 21 lead assegnati a gdo205 oggi inserendo 20 righe fittizie e poi controllando l'esclusione. Più semplice: inserisci 20 lead fittizi assegnati a gdo205 con createdAt=now, poi esegui la stessa sottoquery per confermare che restituisce 20 e che `20 < 20` è false:

```sql
-- (sostituisci :BOT_ID con l'id di gdo205 dal Task 1 Step 6)
SELECT count(*) FROM leads l
WHERE l."assignedToId" = ':BOT_ID' AND l."companyId"='fenice'
  AND l."createdAt" >= (to_char(now() AT TIME ZONE 'Europe/Rome','YYYY-MM-DD') || ' 00:00')::timestamp AT TIME ZONE 'Europe/Rome';
```

Expected: il conteggio riflette i lead odierni del bot. Quando ≥20, gdo205 non comparirà più in `eligible`. Cancella i lead fittizi dopo il test.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/webhooks/activecampaign/route.ts
git commit -m "feat(bot-fissatore): cap 20 lead/giorno (Europe/Rome) per account bot nel round-robin AC"
```

---

## Task 5: Wiring del push post-commit nel webhook AC

**Files:**
- Modify: `src/app/api/webhooks/activecampaign/route.ts` (dopo `txResult.kind === 'created'`)

**Interfaces:**
- Consumes: `pushLeadToBot` (Task 3), `assignedGdoIsBot` dal `txResult` (Task 4 Step 4), `after` da `next/server`.
- Produces: quando un lead viene assegnato a un account bot, dopo il commit parte `pushLeadToBot(...)` non bloccante.

- [ ] **Step 1: Importa le dipendenze**

In cima a `route.ts`, aggiungi (se non già presenti):

```ts
import { after } from 'next/server';
import { pushLeadToBot } from '@/lib/bot-fissatore/push';
```

(Verifica con `grep -n "from 'next/server'" route.ts` se `after` è già importato; in caso unisci l'import.)

- [ ] **Step 2: Push dopo commit per i lead bot**

Trova il blocco che gestisce `txResult.kind === 'created'` (dopo riga 555, prima della NextResponse di successo). Subito dopo aver accertato `kind==='created'`, aggiungi:

```ts
        if (txResult.kind === 'created' && txResult.assignedGdoIsBot) {
            after(() => pushLeadToBot({
                leadId: newLeadId,
                name: fullName,
                phone: phoneFinal,
                email,
                funnel,
                companyId: FENICE_COMPANY,
            }));
        }
```

(`newLeadId`, `fullName`, `phoneFinal`, `email`, `funnel` sono già in scope nel handler — sono i valori usati nell'insert riga 530-550.)

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: nessun errore.

- [ ] **Step 4: Test end-to-end del push (mock bot)**

Avvia il mock bot del Task 3 Step 4 su `:4555`. In `.env.local` imposta:
```
BOT_INTAKE_ENABLED=true
BOT_INTAKE_URL=http://127.0.0.1:4555
BOT_WEBHOOK_SECRET=test-secret
```
Riavvia `npm run dev`. Manda un POST di test al webhook AC (con `ACTIVECAMPAIGN_WEBHOOK_SECRET` corretto e un funnel non in quarantena) che assegni il lead a gdo205 (per forzarlo: in staging metti `acAutoIntake=false` su tutti gli altri GDO Fenice, così solo gdo205 è eligible). Expected: il lead viene creato e il mock bot stampa `match: true` con il payload del lead. Ripristina gli `acAutoIntake` dopo il test.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/activecampaign/route.ts
git commit -m "feat(bot-fissatore): push post-commit al bot quando il lead è assegnato a un account bot"
```

---

## Task 6: Endpoint inbound `POST /api/bot/outcome`

**Files:**
- Create: `src/app/api/bot/outcome/route.ts`

**Interfaces:**
- Consumes: `verifySignature` (signing.ts), `updateLeadOutcome` con `serviceCtx` (Task 2), `BotReport` (types.ts), tabelle `leads`/`users`/`leadEvents`.
- Produces: endpoint HTTP che, dato un esito firmato dal bot, salva il report e fa transitare il lead via `updateLeadOutcome`.

- [ ] **Step 1: Crea la route**

Crea `src/app/api/bot/outcome/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db';
import { leads, users, leadEvents } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { updateLeadOutcome } from '@/app/actions/pipelineActions';
import type { BotReport } from '@/lib/bot-fissatore/types';

const VALID_OUTCOMES = ['APPUNTAMENTO', 'DA_SCARTARE', 'RICHIAMO', 'NON_RISPOSTO'] as const;
type BotOutcome = typeof VALID_OUTCOMES[number];

interface BotOutcomeBody {
    leadId?: string;
    outcome?: string;
    date?: string;        // ISO 8601 con offset, es. 2026-06-20T15:00:00+02:00
    note?: string;
    discardReason?: string;
    report?: BotReport;
}

export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[bot-fissatore] missing BOT_WEBHOOK_SECRET');
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const rawBody = await req.text();
    const sig = req.headers.get('x-bot-signature') ?? '';
    const check = verifySignature(rawBody, sig, secret);
    if (!check.valid) {
        return NextResponse.json({ error: 'invalid_signature', reason: check.reason }, { status: 401 });
    }

    let body: BotOutcomeBody;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const { leadId, outcome, note, discardReason, report } = body;
    if (!leadId || !outcome || !VALID_OUTCOMES.includes(outcome as BotOutcome)) {
        return NextResponse.json({ error: 'bad_request', detail: 'leadId e outcome validi richiesti' }, { status: 400 });
    }
    const typedOutcome = outcome as BotOutcome;

    // Data richiesta per APPUNTAMENTO e RICHIAMO.
    let date: Date | undefined;
    if (typedOutcome === 'APPUNTAMENTO' || typedOutcome === 'RICHIAMO') {
        if (!body.date) {
            return NextResponse.json({ error: 'bad_request', detail: 'date richiesta per APPUNTAMENTO/RICHIAMO' }, { status: 400 });
        }
        date = new Date(body.date);
        if (isNaN(date.getTime())) {
            return NextResponse.json({ error: 'bad_request', detail: 'date non valida (atteso ISO 8601)' }, { status: 400 });
        }
    }

    // Carica il lead + verifica che appartenga a un account bot Fenice.
    const [lead] = await db.select({
        id: leads.id,
        companyId: leads.companyId,
        assignedToId: leads.assignedToId,
    }).from(leads).where(eq(leads.id, leadId)).limit(1);

    if (!lead) {
        return NextResponse.json({ error: 'lead_not_found' }, { status: 404 });
    }
    if (lead.companyId !== 'fenice') {
        return NextResponse.json({ error: 'forbidden', detail: 'lead non Fenice' }, { status: 403 });
    }

    const [assignee] = lead.assignedToId
        ? await db.select({ id: users.id, isBot: users.isBot }).from(users).where(eq(users.id, lead.assignedToId)).limit(1)
        : [undefined];
    if (!assignee || !assignee.isBot) {
        return NextResponse.json({ error: 'forbidden', detail: 'lead non assegnato a un account bot' }, { status: 403 });
    }

    // Persisti il report (se presente) e logga un evento di audit.
    if (report) {
        await db.update(leads).set({ botReport: report }).where(eq(leads.id, leadId));
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'BOT_REPORT',
            userId: assignee.id,
            timestamp: new Date(),
            metadata: report as Record<string, unknown>,
            companyId: 'fenice',
        }).catch((e) => console.error('[bot-fissatore] BOT_REPORT event err', e));
    }

    // Transizione di stato via riuso totale di updateLeadOutcome (handoff Conferme,
    // call log, marketing webhook). serviceCtx bypassa sessione/tenant e spegne la gamification.
    const result = await updateLeadOutcome(
        leadId,
        typedOutcome,
        note ?? '',
        date,
        undefined,            // userId (non usato: passiamo serviceCtx)
        discardReason,
        undefined,            // currentVersion (no optimistic lock dal bot)
        undefined,            // scriptCompleted
        { companyId: 'fenice', actorUserId: assignee.id, isBot: true },
    );

    if (!result || result.success !== true) {
        return NextResponse.json({ error: 'update_failed', detail: result?.error ?? 'unknown' }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: nessun errore. Verifica in particolare che `updateLeadOutcome` accetti 9 argomenti (Task 2).

- [ ] **Step 3: Test end-to-end inbound (curl firmato)**

Con `npm run dev` e `BOT_WEBHOOK_SECRET=test-secret` in `.env.local`. Prendi l'id di un lead Fenice assegnato a gdo205 (creane uno via il test del Task 5, oppure assegna manualmente un lead a gdo205 via SQL). Poi:

```bash
node -e '
const crypto=require("crypto"),http=require("http");
const SECRET="test-secret";
const body=JSON.stringify({
  leadId:"<LEAD_ID>",
  outcome:"APPUNTAMENTO",
  date:"2026-06-20T15:00:00+02:00",
  note:"Fissato dal bot in test",
  report:{summary:"Lead caldo, separazione recente",painPoints:["solitudine","ricostruire autostima"],budgetSignal:"medio-alto",urgency:"alta",objections:["prezzo"],levaConsigliata:"leva sul percorso di rinascita personale"}
});
const sig="sha256="+crypto.createHmac("sha256",SECRET).update(body).digest("hex");
const r=http.request({host:"127.0.0.1",port:3000,path:"/api/bot/outcome",method:"POST",headers:{"content-type":"application/json","x-bot-signature":sig}},res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>console.log(res.statusCode,d));});
r.end(body);
'
```

Expected: `200 {"ok":true}`. Poi via SQL verifica: il lead è `status='APPOINTMENT'`, `appointmentDate` impostata, `botReport` popolato, ed esiste un `leadEvents` `BOT_REPORT`. Testa anche un body con firma errata → `401`, e un lead non-bot → `403`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bot/outcome/route.ts
git commit -m "feat(bot-fissatore): endpoint inbound /api/bot/outcome (HMAC + report + riuso updateLeadOutcome)"
```

---

## Task 7: Card "🤖 Report Bot" nel ConfermeDrawer + badge in board

**Files:**
- Modify: `src/components/ConfermeDrawer.tsx`
- Modify: componente riga board Conferme (individuare con grep, prob. `src/components/ConfermeBoardRow.tsx`)
- Possibile modify: la fetch dei lead Conferme, per includere `botReport` se seleziona colonne esplicite

**Interfaces:**
- Consumes: `lead.botReport` (tipo `BotReport | null`), tipo `BotReport` da `src/lib/bot-fissatore/types.ts`.
- Produces: UI che mostra il report alle Conferme.

- [ ] **Step 1: Verifica che `botReport` arrivi al client**

Run: `grep -rn "botReport\|select({" src/app/actions | grep -i conferme` e individua la query che alimenta la board/drawer Conferme.
- Se usa `db.select().from(leads)` (intera riga) → `botReport` è già incluso, nessuna modifica.
- Se elenca colonne esplicite → aggiungi `botReport: leads.botReport,` alla select.
Annota il file e la forma del tipo `lead` passato al ConfermeDrawer.

- [ ] **Step 2: Aggiungi la card report nel ConfermeDrawer**

In `src/components/ConfermeDrawer.tsx`, importa il tipo:

```ts
import type { BotReport } from '@/lib/bot-fissatore/types';
```

Nel corpo del drawer (sezione contenuto del tab principale, vicino alle note appuntamento), aggiungi un blocco che renderizza il report quando presente. Usa un `<div>` come contenitore (mai `<span>`/`<p>` attorno a contenuti interattivi — regola CLAUDE.md). Esempio:

```tsx
{lead.botReport && (() => {
    const r = lead.botReport as BotReport | string;
    // Fallback: se è una stringa (struttura mancante), mostra testo grezzo.
    if (typeof r === 'string') {
        return (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div className="mb-1 text-sm font-semibold text-amber-800">🤖 Report Bot</div>
                <div className="whitespace-pre-wrap text-sm text-gray-700">{r}</div>
            </div>
        );
    }
    return (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="mb-2 text-sm font-semibold text-amber-800">🤖 Report Bot</div>
            {r.summary && <p className="mb-2 text-sm text-gray-700">{r.summary}</p>}
            {r.levaConsigliata && (
                <div className="mb-2 rounded-md bg-amber-100 px-2 py-1 text-sm font-medium text-amber-900">
                    Leva consigliata: {r.levaConsigliata}
                </div>
            )}
            <div className="mb-2 flex flex-wrap gap-1">
                {r.budgetSignal && <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 ring-1 ring-amber-200">Budget: {r.budgetSignal}</span>}
                {r.urgency && <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 ring-1 ring-amber-200">Urgenza: {r.urgency}</span>}
            </div>
            {r.painPoints && r.painPoints.length > 0 && (
                <div className="mb-2">
                    <div className="text-xs font-semibold text-gray-500">Pain point</div>
                    <ul className="ml-4 list-disc text-sm text-gray-700">
                        {r.painPoints.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                </div>
            )}
            {r.objections && r.objections.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-gray-500">Obiezioni</div>
                    <ul className="ml-4 list-disc text-sm text-gray-600">
                        {r.objections.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                </div>
            )}
        </div>
    );
})()}
```

Adatta `className`/posizionamento allo stile esistente del drawer (controlla i blocchi vicini per coerenza Tailwind).

- [ ] **Step 3: Aggiungi il badge 🤖 sulla card in board**

Nel componente riga board (da Step 1, prob. `ConfermeBoardRow.tsx`), dove vengono mostrati i badge/indicatori del lead, aggiungi:

```tsx
{lead.botReport && (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800" title="Lead con report bot">🤖</span>
)}
```

Posizionalo accanto agli altri badge esistenti, dentro un contenitore `<div>` già presente.

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: nessun errore. Attenzione a eventuali errori di tipo su `lead.botReport` (potrebbe essere `unknown`/`jsonb` → castalo a `BotReport | string`).

- [ ] **Step 5: Verifica visiva (Playwright)**

Con `npm run dev`, usa il lead di test del Task 6 (che ora ha `botReport` + status APPOINTMENT). Fai login come account Conferme Fenice, apri la board Conferme: verifica il badge 🤖 sulla card. Apri il lead nel ConfermeDrawer: verifica la card "🤖 Report Bot" con summary, leva consigliata in evidenza, pain point come elenco, tag budget/urgenza. Cattura uno screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/components/ConfermeDrawer.tsx src/components/ConfermeBoardRow.tsx
git commit -m "feat(bot-fissatore): card Report Bot nel ConfermeDrawer + badge in board"
```

---

## Task 8: Documentazione env + handoff contratto bot

**Files:**
- Modify: `.env.example` (se esiste; altrimenti crea una nota in `docs/`)
- Create: `docs/bot-fissatore-contract.md` (snippet pronti per il team del bot)

- [ ] **Step 1: Documenta gli env**

Se esiste `.env.example`, aggiungi:
```
# Bot Fissatore (test lead Fenice)
BOT_INTAKE_ENABLED=false
BOT_INTAKE_URL=
BOT_WEBHOOK_SECRET=
```
Altrimenti aggiungi questa sezione a `docs/bot-fissatore-contract.md` (Step 2).

- [ ] **Step 2: Scrivi il contratto per il bot**

Crea `docs/bot-fissatore-contract.md` con: schema firma HMAC (`sha256=hex(hmac-sha256(rawBody, BOT_WEBHOOK_SECRET))`, header `x-bot-signature`), payload del push in entrata (`BotIntakePayload`), payload dell'outcome in uscita verso `POST /api/bot/outcome` (con i 4 outcome, requisito `date` ISO 8601 con offset per APPUNTAMENTO/RICHIAMO, e lo schema `report`), URL di produzione `https://crm-sales-fenice.vercel.app/api/bot/outcome`, e la nota che il telefono arriva grezzo (il bot normalizza a E.164). Copia gli snippet dai Task 3 e 6.

- [ ] **Step 3: Commit**

```bash
git add docs/bot-fissatore-contract.md .env.example
git commit -m "docs(bot-fissatore): contratto HMAC + payload per il team del bot"
```

---

## Self-Review (eseguita)

**Spec coverage:**
- gdo205 account + isBot → Task 1 ✅
- Round-robin cap 20/giorno Europe/Rome → Task 4 ✅
- Push HMAC all'assegnazione (kill-switch) → Task 3 + Task 5 ✅
- Inbound /api/bot/outcome HMAC, 4 esiti, riuso updateLeadOutcome → Task 6 ✅
- Report strutturato su leads.botReport + leadEvents BOT_REPORT → Task 1 (schema) + Task 6 (persistenza) ✅
- Card report ConfermeDrawer + badge board → Task 7 ✅
- Gamification OFF + KPI ON → Task 2 (isBot skip) + Task 1 (statsActive=true) ✅
- Marketing webhook acceso anche per bot → Task 2 Step 4 (lasciato invariato) ✅
- Sicurezza HMAC bidirezionale + verifica lead bot Fenice → Task 3/6 ✅

**Type consistency:** `serviceCtx: { companyId, actorUserId, isBot }` definito in Task 2 e usato identico in Task 6. `BotReport`/`BotIntakePayload` definiti in Task 3, consumati in Task 6/7. `pushLeadToBot(payload)` firma coerente tra Task 3 (def) e Task 5 (uso). `verifySignature`/`signPayload` firme dal file esistente.

**Note di scope:** lead da CSV/import manuale fuori (solo AC), come da spec. Push best-effort no-retry, come da spec.
