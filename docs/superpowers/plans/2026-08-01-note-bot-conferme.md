# Note del bot verso le Conferme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare alle Conferme un posto dedicato dove leggere quello che il lead ha detto in chat al bot, invece di riceverlo come una notifica generica non cliccabile.

**Architecture:** Le note del bot restano dove sono già — eventi `BOT_NOTE` in `leadEvents` — e nessuna tabella nasce. Il lavoro è tutto in lettura: `getConfermeNotes` unisce eventi e note Conferme in una lista sola, la board attacca l'ultima nota del bot a ogni riga, e la notifica diventa un deep-link verso il lead. In scrittura si aggiunge solo un campo `metadata.supersedes` che collega i re-invii del bot allo stesso capofila, così il rumore si raggruppa in lettura senza perdere una parola.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM su Supabase Postgres, React 19 client components, Tailwind v4, test con `node --import tsx --test` (node:test).

**Spec:** [`docs/superpowers/specs/2026-08-01-note-bot-conferme-design.md`](../specs/2026-08-01-note-bot-conferme-design.md)

## Global Constraints

- Branch di lavoro: `feat/note-bot-conferme` (già creato da `main`).
- **Nessuna migrazione DB.** Nessuna tabella e nessuna colonna nuova: `metadata` di `leadEvents` è già `jsonb`.
- **Nessun cambio al contratto col fornitore bot.** `/api/bot/outcome` continua ad accettare esattamente lo stesso payload; cambia solo cosa ne facciamo.
- Query sui lead sempre filtrate per `ctx.companyId` (multi-tenant Fenice/Serenamente). Le note del bot esistono solo su `fenice`, ma il filtro va messo lo stesso.
- Mai `<span>` come contenitore di elementi interattivi (regola anti-WSOD del progetto): usare `<div>`.
- Verifica di fine task: `npx tsc --noEmit` deve uscire con codice 0.
- Commit in italiano, imperativo, con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` in coda.

## File Structure

| File | Responsabilità |
|---|---|
| `src/lib/bot-fissatore/noteDedup.ts` (nuovo) | Logica pura: estrarre l'intenzione da una nota e dire se due note sono lo stesso fatto. Zero dipendenze da DB o React, così è testabile con node:test. |
| `src/lib/bot-fissatore/noteDedup.test.ts` (nuovo) | Test della logica sopra, sui testi veri visti in produzione. |
| `src/app/api/bot/outcome/route.ts` | Scrive l'evento `BOT_NOTE` con `supersedes` quando è un re-invio, e sopprime la notifica duplicata. |
| `src/app/actions/confermeActions.ts` | `getConfermeNotes` unisce le due sorgenti e raggruppa le catene; `getConfermeAppointments` attacca `lastBotNote` a ogni riga della board. |
| `src/components/ConfermeDrawer.tsx` | Rende le note del bot nel tab Note e accetta `initialTab` per il deep-link. |
| `src/components/ConfermeBoardRow.tsx` | Anteprima 🤖 sulla riga con la pill NUOVA. |
| `src/components/ConfermeBoard.tsx` | Legge `?lead=&tab=` all'apertura e apre il drawer sul lead giusto. |
| `src/components/Topbar.tsx` | La notifica `bot_note` diventa cliccabile. |

Le prime due sono le uniche unità testabili in automatico: tutto il resto è UI o query, e si verifica a mano seguendo gli script indicati nei task.

---

### Task 1: Riconoscere due note come lo stesso fatto

Il bot ri-manda la stessa nota 2-3 volte in pochi minuti, cambiando solo la coda del motivo. Questa unità dice se due testi raccontano la stessa intenzione. È pura di proposito: niente DB, niente React, così i casi veri di produzione si bloccano in un test.

**Files:**
- Create: `src/lib/bot-fissatore/noteDedup.ts`
- Test: `src/lib/bot-fissatore/noteDedup.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: niente.
- Produces:
  - `BOT_NOTE_DEDUP_WINDOW_MS: number` — 900000 (15 minuti)
  - `botNoteIntentKey(text: string): string`
  - `isSameBotNoteIntent(a: string, b: string): boolean`

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `src/lib/bot-fissatore/noteDedup.test.ts`. I testi sono quelli veri arrivati dal bot il 2026-08-01 — se il dedup non li prende, non serve a niente.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { botNoteIntentKey, isSameBotNoteIntent, BOT_NOTE_DEDUP_WINDOW_MS } from './noteDedup';

// Le tre note su Ramona Lazăr, arrivate in 3 minuti il 2026-08-01: stesso
// incipit, motivo riscritto ogni volta. Sono lo stesso fatto.
const RAMONA_1 = "Il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00). Motivo: non ha disponibilità economica al momento, ha chiesto di annullare la call.";
const RAMONA_2 = "Il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00). Motivo: non ha disponibilità economica al momento, neanche a rate.";
const RAMONA_3 = "Il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00). Motivo: non ha budget al momento, situazione economica non permette l'acquisto né le rate.";

test('la finestra di dedup è di 15 minuti', () => {
    assert.equal(BOT_NOTE_DEDUP_WINDOW_MS, 15 * 60 * 1000);
});

test('i tre re-invii su Ramona sono la stessa intenzione', () => {
    assert.ok(isSameBotNoteIntent(RAMONA_1, RAMONA_2));
    assert.ok(isSameBotNoteIntent(RAMONA_2, RAMONA_3));
    assert.ok(isSameBotNoteIntent(RAMONA_1, RAMONA_3));
});

test('la chiave si ferma prima di "Motivo:"', () => {
    assert.equal(
        botNoteIntentKey(RAMONA_1),
        "il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00)",
    );
});

test('i due re-invii su Micol sono la stessa intenzione', () => {
    const a = "Il lead vuole annullare l'appuntamento. Motivo: lead interessata ma dichiara di non avere disponibilità economica al momento per il corso, disdice l'appuntamento volontariamente.";
    const b = "Il lead vuole annullare l'appuntamento. Motivo: lead interessata ma dichiara di non avere disponibilità economica sufficiente al momento, disdice l'appuntamento.";
    assert.ok(isSameBotNoteIntent(a, b));
});

test('una nota senza "Motivo:" cade sulla prima frase', () => {
    const a = "Il lead ha riconfermato l'appuntamento.";
    assert.equal(botNoteIntentKey(a), "il lead ha riconfermato l'appuntamento");
    assert.ok(isSameBotNoteIntent(a, "Il lead ha riconfermato l'appuntamento."));
});

test('intenzioni diverse restano distinte', () => {
    const annulla = "Il lead vuole annullare l'appuntamento. Motivo: non ha budget.";
    const riconferma = "Il lead ha riconfermato l'appuntamento.";
    assert.equal(isSameBotNoteIntent(annulla, riconferma), false);
});

test('due spostamenti a date diverse sono fatti diversi', () => {
    const a = "Il lead ha chiesto di spostare l'appuntamento alla data indicata (lunedì 10 agosto alle 09:00). Appuntamento mantenuto.";
    const b = "Il lead ha chiesto di spostare l'appuntamento alla data indicata (martedì 4 agosto alle 09:00). Appuntamento mantenuto.";
    assert.equal(isSameBotNoteIntent(a, b), false);
});

test('spaziatura e maiuscole non contano', () => {
    assert.ok(isSameBotNoteIntent(
        "Il lead  ha   RICONFERMATO l'appuntamento.",
        "il lead ha riconfermato l'appuntamento",
    ));
});

test('un testo vuoto non è mai uguale a niente', () => {
    assert.equal(botNoteIntentKey('   '), '');
    assert.equal(isSameBotNoteIntent('   ', '   '), false);
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

```bash
npx tsx --test src/lib/bot-fissatore/noteDedup.test.ts
```

Atteso: FAIL — `Cannot find module './noteDedup'`.

- [ ] **Step 3: Scrivere l'implementazione**

Crea `src/lib/bot-fissatore/noteDedup.ts`:

```ts
// Il bot ri-manda la stessa nota più volte a distanza di minuti, riscrivendo
// ogni volta il motivo ma non il fatto. Qui si estrae il fatto, così i re-invii
// si riconoscono senza buttare via le sfumature del motivo.

/** Entro questa finestra due note con la stessa intenzione sono lo stesso fatto. */
export const BOT_NOTE_DEDUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * L'intenzione di una nota, normalizzata per il confronto.
 *
 * In ordine: il testo fino a "Motivo:" (è lì che i re-invii coincidono e la
 * coda diverge), altrimenti la prima frase, altrimenti i primi 120 caratteri.
 * Ritorna stringa vuota per un testo vuoto — e una chiave vuota non combacia
 * mai con niente, nemmeno con un'altra chiave vuota.
 */
export function botNoteIntentKey(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return '';

    const motivoAt = trimmed.toLowerCase().indexOf('motivo:');
    let head: string;
    if (motivoAt > 0) {
        head = trimmed.slice(0, motivoAt);
    } else {
        const firstSentence = trimmed.match(/^[\s\S]*?\.(?=\s|$)/);
        head = firstSentence ? firstSentence[0] : trimmed.slice(0, 120);
    }

    return head
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[.,;:!?\s]+$/, '')
        .trim();
}

/** Due note raccontano lo stesso fatto? */
export function isSameBotNoteIntent(a: string, b: string): boolean {
    const keyA = botNoteIntentKey(a);
    return keyA.length > 0 && keyA === botNoteIntentKey(b);
}
```

- [ ] **Step 4: Lanciare il test e verificare che passi**

```bash
npx tsx --test src/lib/bot-fissatore/noteDedup.test.ts
```

Atteso: PASS, 9 test.

- [ ] **Step 5: Aggiungere il file allo script `test`**

In `package.json`, lo script `test` elenca i file uno per uno. Aggiungi il nuovo in coda:

```json
"test": "node --import tsx --test src/lib/venditorePerformance/aggregate.test.ts src/lib/venditorePerformance/guard.test.ts src/lib/bot-fissatore/noteDedup.test.ts"
```

Poi verifica che l'intera suite passi:

```bash
npm test
```

Atteso: PASS, nessun test rotto.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot-fissatore/noteDedup.ts src/lib/bot-fissatore/noteDedup.test.ts package.json
git commit -m "feat(bot): riconosci due note del bot come lo stesso fatto"
```

---

### Task 2: Scrivere il duplicato senza rinotificare

Il duplicato entra a database come tutti gli altri — nessuna parola detta in chat va persa — ma eredita `supersedes` dal capofila e non fa suonare una seconda volta la campanella.

**Files:**
- Modify: `src/app/api/bot/outcome/route.ts:153-191` (il blocco `if (typedOutcome === 'NOTA')`)

**Interfaces:**
- Consumes: `BOT_NOTE_DEDUP_WINDOW_MS`, `isSameBotNoteIntent` da `@/lib/bot-fissatore/noteDedup` (Task 1).
- Produces: eventi `BOT_NOTE` il cui `metadata` è `{ note: string }` per il capofila e `{ note: string, supersedes: string }` per i re-invii. Il Task 3 raggruppa su questo campo.

- [ ] **Step 1: Aggiungere gli import**

In cima al file, la riga degli operatori Drizzle oggi è `import { and, eq } from 'drizzle-orm';`. Servono anche `desc` e `gte`:

```ts
import { and, desc, eq, gte } from 'drizzle-orm';
```

E sotto gli altri import del bot:

```ts
import { BOT_NOTE_DEDUP_WINDOW_MS, isSameBotNoteIntent } from '@/lib/bot-fissatore/noteDedup';
```

- [ ] **Step 2: Sostituire il blocco NOTA**

Il blocco attuale (da `if (typedOutcome === 'NOTA') {` fino al suo `return NextResponse.json({ ok: true, noted: true });`) va sostituito integralmente con:

```ts
    if (typedOutcome === 'NOTA') {
        const text = (note ?? '').trim();
        if (!text) {
            return NextResponse.json({ error: 'bad_request', detail: 'note richiesta per esito NOTA' }, { status: 400 });
        }

        // Il bot ri-manda la stessa nota 2-3 volte a distanza di minuti (visti 3
        // invii sullo stesso lead in 3 minuti). L'evento si scrive lo stesso —
        // ogni versione del motivo resta leggibile — ma il re-invio eredita
        // `supersedes` dal capofila e NON fa scattare una seconda notifica.
        const [prev] = await db.select({
            id: leadEvents.id,
            metadata: leadEvents.metadata,
        }).from(leadEvents).where(and(
            eq(leadEvents.leadId, leadId),
            eq(leadEvents.eventType, 'BOT_NOTE'),
            gte(leadEvents.timestamp, new Date(Date.now() - BOT_NOTE_DEDUP_WINDOW_MS)),
        )).orderBy(desc(leadEvents.timestamp)).limit(1);

        const prevMeta = (prev?.metadata ?? {}) as { note?: string; supersedes?: string };
        const isDuplicate = !!prev
            && typeof prevMeta.note === 'string'
            && isSameBotNoteIntent(prevMeta.note, text);

        // Catena piatta: `supersedes` punta sempre al capofila, mai a un anello
        // intermedio. Raggrupparle in lettura resta un group-by, non una risalita.
        const supersedes = isDuplicate ? (prevMeta.supersedes ?? prev.id) : undefined;

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'BOT_NOTE',
            userId: actorUserId,
            timestamp: new Date(),
            metadata: supersedes ? { note: text, supersedes } : { note: text },
            companyId: 'fenice',
        });

        // Una notifica per intenzione, non una per re-invio.
        if (!isDuplicate && lead.status === 'APPOINTMENT') {
            const confermeUsers = await db.select({ id: users.id }).from(users).where(and(
                eq(users.companyId, 'fenice'),
                eq(users.role, 'CONFERME'),
                eq(users.isActive, true),
            ));
            if (confermeUsers.length > 0) {
                const now = new Date();
                await db.insert(notifications).values(confermeUsers.map(u => ({
                    id: crypto.randomUUID(),
                    recipientUserId: u.id,
                    type: 'bot_note',
                    title: '📋 Nota dal Fissatore',
                    body: `${lead.name}: ${text.length > 200 ? text.slice(0, 200) + '…' : text}`,
                    metadata: { leadId },
                    status: 'unread',
                    createdAt: now,
                    companyId: 'fenice',
                }))).catch((e) => console.error('[bot-fissatore] NOTA notify err', e));
            }
        }

        // `deduped` è informativo, non un errore: per il bot l'invio è andato a buon fine.
        return NextResponse.json({ ok: true, noted: true, ...(isDuplicate ? { deduped: true } : {}) });
    }
```

- [ ] **Step 3: Verificare i tipi**

```bash
npx tsc --noEmit
```

Atteso: exit 0.

- [ ] **Step 4: Provare il dedup contro il server locale**

Avvia il dev server (`npm run dev`) e prepara uno script di firma. Serve il valore di `BOT_WEBHOOK_SECRET` dal `.env.local` e l'id di un lead Fenice in stato `APPOINTMENT` assegnato all'account bot.

Crea `scratch-bot-note.mjs` nella cartella scratchpad (NON nel repo):

```js
import crypto from 'node:crypto';

const SECRET = process.env.BOT_WEBHOOK_SECRET;
const LEAD_ID = process.env.LEAD_ID;

async function send(note) {
    const body = JSON.stringify({ leadId: LEAD_ID, outcome: 'NOTA', note });
    const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const res = await fetch('http://localhost:3000/api/bot/outcome', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-signature': sig },
        body,
    });
    console.log(res.status, await res.text());
}

await send("Il lead vuole annullare l'appuntamento. Motivo: non ha budget al momento.");
await send("Il lead vuole annullare l'appuntamento. Motivo: non ha disponibilità economica, neanche a rate.");
await send("Il lead ha riconfermato l'appuntamento.");
```

Attese:
1. `200 {"ok":true,"noted":true}`
2. `200 {"ok":true,"noted":true,"deduped":true}` ← il secondo è un re-invio
3. `200 {"ok":true,"noted":true}` ← intenzione diversa, non è un duplicato

Poi verifica a database che gli eventi siano **tre** e che il secondo punti al primo:

```sql
select id, timestamp, metadata->>'supersedes' as supersedes, left(metadata->>'note', 60) as nota
from "leadEvents"
where "leadId" = '<LEAD_ID>' and "eventType" = 'BOT_NOTE'
order by timestamp desc limit 5;
```

E che le notifiche generate siano **due**, non tre:

```sql
select count(*) from notifications
where type = 'bot_note' and metadata->>'leadId' = '<LEAD_ID>'
  and "createdAt" > now() - interval '10 minutes';
```

Atteso: `2 × (numero di operatori Conferme attivi)`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/bot/outcome/route.ts
git commit -m "feat(bot): collega i re-invii della stessa nota e non rinotificare"
```

---

### Task 3: Il tab Note legge e mostra anche le note del bot

`getConfermeNotes` smette di essere una lettura di `confirmationsNotes` e diventa la lista unica di tutto quello che c'è da leggere su quel lead: gli appunti delle Conferme e il racconto delle chat del bot, in ordine cronologico, con le catene di re-invio già raggruppate. Il drawer la rende.

Server action e drawer stanno nello stesso task perché il drawer è l'unico consumatore della action: cambiarne la forma senza aggiornarlo lascerebbe il branch con errori di tipo aperti, contro i Global Constraints.

**Files:**
- Modify: `src/app/actions/confermeActions.ts:361-381` (`getConfermeNotes`)
- Modify: `src/components/ConfermeDrawer.tsx:72` (stato), `:207` (`handleAddNote`), `:782-828` (render del tab Note)

**Interfaces:**
- Consumes: gli eventi `BOT_NOTE` con `metadata.supersedes` scritti nel Task 2.
- Produces: `getConfermeNotes(leadId: string): Promise<ConfermeNoteItem[]>` con

  ```ts
  export type ConfermeNoteItem = {
      id: string;
      source: 'conferme' | 'bot';
      text: string;
      createdAt: Date;
      authorName: string | null;
      updates: Array<{ id: string; text: string; createdAt: Date }>;
  };
  ```

- [ ] **Step 1: Sostituire `getConfermeNotes`**

La funzione attuale (da `export async function getConfermeNotes` fino alla sua chiusura) va sostituita con:

```ts
/**
 * Una voce del tab Note: un appunto delle Conferme oppure una nota del bot.
 *
 * Le note del bot arrivano come eventi `BOT_NOTE`; i re-invii della stessa
 * intenzione (`metadata.supersedes`) si presentano come una voce sola, col
 * testo più recente in testa e i precedenti in `updates`. Nessun evento viene
 * nascosto: sono tutti lì, solo raggruppati.
 */
export type ConfermeNoteItem = {
    id: string;
    source: 'conferme' | 'bot';
    text: string;
    createdAt: Date;
    authorName: string | null;
    /** Versioni precedenti della stessa nota del bot, dalla più recente. Sempre vuoto per le note Conferme. */
    updates: Array<{ id: string; text: string; createdAt: Date }>;
};

export async function getConfermeNotes(leadId: string): Promise<ConfermeNoteItem[]> {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const [confermeRows, botRows] = await Promise.all([
        db.select({
            id: confirmationsNotes.id,
            text: confirmationsNotes.text,
            createdAt: confirmationsNotes.createdAt,
            authorName: users.name,
            authorDisplayName: users.displayName,
        }).from(confirmationsNotes)
            .leftJoin(users, eq(confirmationsNotes.authorId, users.id))
            .where(and(
                eq(confirmationsNotes.companyId, ctx.companyId),
                eq(confirmationsNotes.leadId, leadId),
            )),
        db.select({
            id: leadEvents.id,
            metadata: leadEvents.metadata,
            timestamp: leadEvents.timestamp,
        }).from(leadEvents)
            .where(and(
                eq(leadEvents.companyId, ctx.companyId),
                eq(leadEvents.leadId, leadId),
                eq(leadEvents.eventType, 'BOT_NOTE'),
            ))
            .orderBy(desc(leadEvents.timestamp)),
    ])

    const items: ConfermeNoteItem[] = confermeRows.map(r => ({
        id: r.id,
        source: 'conferme' as const,
        text: r.text,
        createdAt: r.createdAt,
        authorName: r.authorDisplayName || r.authorName || null,
        updates: [],
    }))

    // Raggruppa per capofila. `botRows` è già dal più recente: il primo di ogni
    // catena diventa la voce mostrata, gli altri finiscono in `updates`.
    const chains = new Map<string, ConfermeNoteItem>()
    for (const r of botRows) {
        const meta = (r.metadata ?? {}) as { note?: string; supersedes?: string }
        const text = typeof meta.note === 'string' ? meta.note.trim() : ''
        if (!text) continue
        const chainId = meta.supersedes ?? r.id
        const head = chains.get(chainId)
        if (!head) {
            chains.set(chainId, {
                id: r.id,
                source: 'bot',
                text,
                createdAt: r.timestamp,
                authorName: null,
                updates: [],
            })
        } else {
            head.updates.push({ id: r.id, text, createdAt: r.timestamp })
        }
    }
    items.push(...chains.values())

    return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}
```

- [ ] **Step 2: Verificare quali errori di tipo restano aperti**

```bash
npx tsc --noEmit
```

Atteso: **due errori in `src/components/ConfermeDrawer.tsx`**, perché il componente usa ancora la forma vecchia (`n.note.text`, `n.author?.name`). Li chiudono gli step qui sotto. Nessun altro file deve comparire — se compare, `getConfermeNotes` ha un altro consumatore da aggiornare e va segnalato prima di proseguire.

- [ ] **Step 3: Tipizzare lo stato delle note**

Sostituisci `const [notes, setNotes] = useState<any[]>([])` con:

```tsx
    const [notes, setNotes] = useState<ConfermeNoteItem[]>([])
    const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
```

E aggiungi l'import del tipo in cima al file, accanto agli altri import da `confermeActions`:

```tsx
import type { ConfermeNoteItem } from "@/app/actions/confermeActions"
```

- [ ] **Step 4: Aggiornare l'inserimento ottimistico**

In `handleAddNote`, la riga `setNotes([{ note, author: currentUser }, ...notes])` non corrisponde più alla forma. Sostituiscila con:

```tsx
            setNotes([{
                id: note.id,
                source: 'conferme',
                text: note.text,
                createdAt: note.createdAt,
                authorName: currentUser?.displayName || currentUser?.name || null,
                updates: [],
            }, ...notes])
```

- [ ] **Step 5: Rendere le due sorgenti**

Sostituisci il blocco `notes.map(...)` (dentro `{activeTab === "note" && ...}`, il ramo `) : (` che oggi mappa `n.note.text`) con:

```tsx
                                        notes.map(n => n.source === 'bot' ? (
                                            <div key={n.id} className="p-4 bg-sky-50 rounded-xl border border-sky-200 shadow-sm">
                                                <div className="flex justify-between items-start mb-3 gap-2">
                                                    <span className="text-xs font-bold text-sky-900 bg-sky-100 px-2 py-1 rounded-md">🤖 Fissatore — dalla chat</span>
                                                    <span className="text-[11px] font-medium text-sky-500 uppercase tracking-wider shrink-0">{format(new Date(n.createdAt), "dd/MM/yy HH:mm")}</span>
                                                </div>
                                                <p className="text-sm text-sky-950 whitespace-pre-wrap leading-relaxed">{n.text}</p>
                                                {n.updates.length > 0 && (
                                                    <div className="mt-3 pt-3 border-t border-sky-200/70">
                                                        <button
                                                            type="button"
                                                            onClick={() => setExpandedNotes(prev => {
                                                                const next = new Set(prev)
                                                                if (next.has(n.id)) next.delete(n.id); else next.add(n.id)
                                                                return next
                                                            })}
                                                            className="text-[11px] font-bold text-sky-700 hover:text-sky-900 cursor-pointer"
                                                        >
                                                            {expandedNotes.has(n.id) ? "▾" : "▸"} +{n.updates.length} {n.updates.length === 1 ? "aggiornamento" : "aggiornamenti"} dal bot
                                                        </button>
                                                        {expandedNotes.has(n.id) && (
                                                            <div className="mt-2 space-y-2">
                                                                {n.updates.map(u => (
                                                                    <div key={u.id} className="text-[12px] text-sky-800/90 flex gap-2">
                                                                        <span className="shrink-0 font-medium text-sky-500">{format(new Date(u.createdAt), "HH:mm")}</span>
                                                                        <span className="whitespace-pre-wrap leading-relaxed">{u.text}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div key={n.id} className="p-4 bg-white rounded-xl border border-ash-200 shadow-sm transition-shadow hover:shadow-md">
                                                <div className="flex justify-between items-start mb-3">
                                                    <span className="text-xs font-bold text-ash-900 bg-ash-100 px-2 py-1 rounded-md">{n.authorName || "Utente"}</span>
                                                    <span className="text-[11px] font-medium text-ash-400 uppercase tracking-wider">{format(new Date(n.createdAt), "dd/MM/yy HH:mm")}</span>
                                                </div>
                                                <p className="text-sm text-ash-700 whitespace-pre-wrap leading-relaxed">{n.text}</p>
                                            </div>
                                        ))
```

- [ ] **Step 6: Verificare i tipi**

```bash
npx tsc --noEmit
```

Atteso: exit 0 — i due errori visti allo Step 2 sono chiusi.

- [ ] **Step 7: Verifica a mano**

Con `npm run dev`, entra come utente Conferme (o admin) su `/conferme`, apri un lead che ha ricevuto note dal bot e vai sul tab **Note**.

Attese:
- le note del bot appaiono su sfondo azzurro con l'intestazione 🤖, quelle scritte dalle Conferme restano bianche;
- sono ordinate insieme, dalla più recente;
- un lead con re-invii mostra **una** card e il pulsante `+N aggiornamenti dal bot`, che aperto elenca le versioni precedenti con l'orario;
- il contatore accanto al nome del tab somma le due sorgenti;
- scrivere una nota nuova la fa comparire in cima senza ricaricare.

Per trovare un lead con re-invii:

```sql
select "leadId", count(*) from "leadEvents"
where "eventType" = 'BOT_NOTE' and metadata->>'supersedes' is not null
group by 1 order by 2 desc limit 5;
```

Se la query non torna niente (il Task 2 è appena andato in locale e in produzione non ci sono ancora catene), usa lo script del Task 2 Step 4 per crearne una su un lead di test.

- [ ] **Step 8: Commit**

```bash
git add src/app/actions/confermeActions.ts src/components/ConfermeDrawer.tsx
git commit -m "feat(conferme): le note del bot nel tab Note del drawer"
```

---

### Task 4: L'anteprima sulla riga della board

Senza questo, la nota si vede solo aprendo il lead. Qui l'operatore la vede scorrendo la board, e capisce se qualcuno l'ha già raccolta.

**Files:**
- Modify: `src/app/actions/confermeActions.ts:222-248` (blocco "Attach ultima nota Conferme")
- Modify: `src/components/ConfermeBoardRow.tsx:492-503` (dopo l'anteprima nota Conferme)

**Interfaces:**
- Consumes: eventi `BOT_NOTE` (Task 2); `lastConfermeNote` già esistente.
- Produces: su ogni riga della board, `item.lastBotNote: { text: string; createdAt: Date; isNew: boolean } | null`.

- [ ] **Step 1: Attaccare `lastBotNote` alle righe**

In `getConfermeAppointments`, subito **dopo** il blocco che riempie `notesMap` e **prima** di `type RowWithNote = ...`, inserisci:

```ts
    // Ultima nota del bot per lead (anteprima 🤖 nella riga board). Una query
    // sola su tutti i leadId, come per le note Conferme.
    const botNotesMap = new Map<string, { text: string; createdAt: Date }>();
    if (leadIds.length > 0) {
        const botRows = await db.select({
            leadId: leadEvents.leadId,
            metadata: leadEvents.metadata,
            timestamp: leadEvents.timestamp,
        }).from(leadEvents)
            .where(and(
                eq(leadEvents.companyId, ctx.companyId),
                eq(leadEvents.eventType, 'BOT_NOTE'),
                inArray(leadEvents.leadId, leadIds),
            ))
            .orderBy(desc(leadEvents.timestamp));
        for (const r of botRows) {
            if (botNotesMap.has(r.leadId)) continue;
            const text = (r.metadata as { note?: string } | null)?.note;
            if (typeof text === 'string' && text.trim()) {
                botNotesMap.set(r.leadId, { text: text.trim(), createdAt: r.timestamp });
            }
        }
    }
```

Poi sostituisci la dichiarazione di `RowWithNote` e la costruzione di `withNotes` con:

```ts
    type RowWithNote = (typeof results)[number] & {
        lastConfermeNote: { text: string; createdAt: Date; authorId: string } | null;
        lastBotNote: { text: string; createdAt: Date; isNew: boolean } | null;
    };
    const withNotes: RowWithNote[] = results.map(r => {
        const lastConfermeNote = notesMap.get(r.lead.id) ?? null;
        const bot = botNotesMap.get(r.lead.id) ?? null;
        // "Nuova" = arrivata dopo l'ultima volta che le Conferme hanno toccato
        // il lead. Si spegne da sola appena qualcuno ci lavora: nessun campo di
        // stato da azzerare a mano.
        const lastTouch = [
            r.lead.confCall1At,
            r.lead.confCall2At,
            r.lead.confCall3At,
            lastConfermeNote?.createdAt ?? null,
        ].filter((d): d is Date => !!d).map(d => new Date(d).getTime());
        return {
            ...r,
            lastConfermeNote,
            lastBotNote: bot
                ? { ...bot, isNew: lastTouch.length === 0 || bot.createdAt.getTime() > Math.max(...lastTouch) }
                : null,
        };
    });
```

- [ ] **Step 2: Rendere l'anteprima sulla riga**

In `ConfermeBoardRow.tsx`, subito **dopo** il blocco `{item.lastConfermeNote && (...)}` e prima della chiusura del componente, inserisci:

```tsx
            {/* Ultima nota del bot (anteprima compatta). Viola per non confondersi
                con il blu della nota Conferme qui sopra. */}
            {item.lastBotNote && (
                <div className="w-full mt-1 pointer-events-none">
                    <div
                        className="text-[11px] text-violet-700 bg-violet-50/80 py-1 px-2 rounded-md flex items-center gap-1.5 border border-violet-100/80"
                        title={item.lastBotNote.text}
                    >
                        <span className="font-bold text-violet-800 shrink-0 uppercase tracking-wide text-[9px]">🤖 Fissatore:</span>
                        <span className="truncate flex-1">{item.lastBotNote.text}</span>
                        {item.lastBotNote.isNew && (
                            <span className="shrink-0 bg-amber-500 text-white font-bold uppercase tracking-wide text-[9px] px-1.5 py-0.5 rounded">Nuova</span>
                        )}
                    </div>
                </div>
            )}
```

- [ ] **Step 3: Verificare i tipi**

```bash
npx tsc --noEmit
```

Atteso: exit 0.

- [ ] **Step 4: Verifica a mano**

Su `/conferme` con un lead che ha una nota del bot:
- la riga mostra la striscia viola 🤖 con l'anteprima troncata su una riga sola;
- la pill arancione **NUOVA** c'è se nessuno ha ancora chiamato o annotato quel lead dopo la nota;
- dopo aver registrato una chiamata (o scritto una nota) su quel lead e ricaricato, la pill sparisce ma la striscia resta;
- un lead senza note del bot non mostra niente di nuovo;
- la riga non cresce in altezza al punto da rompere il layout della board.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/confermeActions.ts src/components/ConfermeBoardRow.tsx
git commit -m "feat(conferme): anteprima della nota del bot sulla riga della board"
```

---

### Task 5: La notifica porta al lead

Oggi il click sulla notifica non fa niente. Qui diventa il percorso più corto tra "il bot ha scritto qualcosa" e "l'operatore lo sta leggendo".

**Files:**
- Modify: `src/components/ConfermeDrawer.tsx:54` (firma) e `:139` (reset del tab)
- Modify: `src/components/ConfermeBoard.tsx:60-61` (stato), `:808-817` (mount del drawer), + nuovo effetto
- Modify: `src/components/Topbar.tsx:112-129` (`handleNotifClick`)

**Interfaces:**
- Consumes: `notifications.metadata.leadId` scritto dal Task 2.
- Produces: `/conferme?lead=<id>&tab=note` come deep-link utilizzabile.

- [ ] **Step 1: `ConfermeDrawer` accetta il tab iniziale**

Cambia la firma:

```tsx
export function ConfermeDrawer({ isOpen, onClose, item, currentUser, onRefresh, initialTab }: any) {
```

e **nell'effetto che resetta il form all'apertura** (riga 139, dentro l'effetto che dipende da `[isOpen, lead?.id, lead?.version]`) sostituisci `setActiveTab("dati")` con:

```tsx
            setActiveTab(initialTab || "dati")
```

Attenzione: nel file ci sono altre due occorrenze di `setActiveTab("dati")` che **non vanno toccate** — riga 239 è la redirezione di validazione quando manca l'email in `handleSaveOutcome`, riga 597 è il click sul bottone del tab. Cambia solo quella dentro l'effetto di apertura.

- [ ] **Step 2: `ConfermeBoard` apre il lead richiesto dalla query string**

Accanto a `const [isDrawerOpen, setIsDrawerOpen] = useState(false)` aggiungi:

```tsx
    const [drawerInitialTab, setDrawerInitialTab] = useState<string | undefined>(undefined)
    const [pendingDeepLink, setPendingDeepLink] = useState<{ leadId: string; tab?: string } | null>(null)
```

Subito sotto le dichiarazioni di stato, aggiungi l'effetto che legge la query string una volta sola. Si legge da `window.location.search` e non con `useSearchParams` di proposito: `useSearchParams` obbliga a un boundary Suspense e farebbe rendere l'intera board sul client.

```tsx
    // Deep-link dalla notifica "Nota dal Fissatore": /conferme?lead=<id>&tab=note.
    // I parametri si tolgono subito dall'URL, così un refresh non riapre il drawer.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const leadId = params.get('lead')
        if (!leadId) return
        setPendingDeepLink({ leadId, tab: params.get('tab') ?? undefined })
        window.history.replaceState({}, '', window.location.pathname)
    }, [])
```

Poi l'effetto che apre il drawer appena il lead compare tra quelli caricati:

```tsx
    // Il lead può stare in una qualsiasi delle liste caricate a seconda della
    // vista attiva. Se non c'è (già esitato, fuori finestra) non si apre nulla.
    useEffect(() => {
        if (!pendingDeepLink) return
        const pools = [kanbanData.flatList, kanbanData.daDefinire, tableData, storicoData, oggiLeads, domaniLeads]
        for (const pool of pools) {
            const found = pool.find((i: any) => i?.lead?.id === pendingDeepLink.leadId)
            if (found) {
                setSelectedLead(found)
                setDrawerInitialTab(pendingDeepLink.tab)
                setIsDrawerOpen(true)
                setPendingDeepLink(null)
                return
            }
        }
    }, [pendingDeepLink, kanbanData, tableData, storicoData, oggiLeads, domaniLeads])
```

Infine passa il tab al drawer e azzeralo alla chiusura:

```tsx
            {isDrawerOpen && selectedLead && (
                <ConfermeDrawer
                    isOpen={true}
                    item={selectedLead}
                    currentUser={currentUser}
                    initialTab={drawerInitialTab}
                    onRefresh={() => fetchLeads(false)}
                    onClose={() => {
                        setIsDrawerOpen(false)
                        setDrawerInitialTab(undefined)
                        fetchLeads(false)
                    }}
                />
            )}
```

- [ ] **Step 3: La notifica diventa cliccabile**

In `handleNotifClick`, aggiungi un ramo prima di quello `appointment_confirmed`:

```tsx
        if (notif.type === 'leaderboard_overtaken') {
            router.push(`/classifica?period=${meta?.period || 'today'}`)
        } else if (notif.type === 'bot_note') {
            // Le note del bot si leggono nella board Conferme, non nel drawer
            // della ricerca: è lì che l'operatore lavora il lead.
            if (meta?.leadId) router.push(`/conferme?lead=${meta.leadId}&tab=note`)
        } else if (notif.type === 'appointment_confirmed' || notif.type === 'sales_outcome_set' || notif.type === 'appointment_assigned') {
```

- [ ] **Step 4: Verificare i tipi**

```bash
npx tsc --noEmit
```

Atteso: exit 0.

- [ ] **Step 5: Verifica a mano**

Da un account Conferme, con una notifica *"📋 Nota dal Fissatore"* non letta nella campanella:
- il click porta su `/conferme` col drawer del lead giusto aperto sul tab **Note**;
- l'URL nella barra torna pulito (`/conferme` senza query), e un refresh non riapre il drawer;
- chiudendo e riaprendo il lead dalla board a mano, il drawer si apre sul tab **Dati** come sempre;
- una notifica su un lead che non è nella vista corrente (es. già confermato mentre si guarda "da lavorare") non apre niente e non rompe la pagina;
- gli altri tipi di notifica continuano a comportarsi come prima.

- [ ] **Step 6: Commit**

```bash
git add src/components/ConfermeDrawer.tsx src/components/ConfermeBoard.tsx src/components/Topbar.tsx
git commit -m "feat(conferme): la notifica del Fissatore apre il lead sul tab Note"
```

---

### Task 6: Verifica finale e build

**Files:** nessuna modifica prevista. Se emergono correzioni, si committano qui.

- [ ] **Step 1: Suite di test**

```bash
npm test
```

Atteso: PASS.

- [ ] **Step 2: Build di produzione**

```bash
npm run build
```

Atteso: build completata senza errori. È il controllo che conta: `tsc --noEmit` non intercetta i problemi di boundary client/server né gli errori di prerendering di Next.

- [ ] **Step 3: Giro completo sui casi della spec**

Con `npm run dev`, ripercorri la sezione *Verifica* della spec:
- tre note stessa intenzione entro 15 minuti → tre eventi, una notifica, una card con `+2 aggiornamenti`;
- stessa intenzione dopo 20 minuti → due card, due notifiche;
- "vuole annullare" seguita da "ha riconfermato" entro 15 minuti → due card distinte;
- nota senza `"Motivo:"` → dedup funzionante lo stesso;
- tab Note con entrambe le sorgenti in ordine e contatore corretto;
- pill NUOVA che compare e si spegne dopo una chiamata;
- notifica che apre il lead sul tab Note.

- [ ] **Step 4: Push**

```bash
git push -u origin feat/note-bot-conferme
```

---

## Note per chi implementa

- **Il fornitore non va toccato.** Se durante il lavoro sembra necessario chiedergli una modifica, il design è stato frainteso: rileggi la spec.
- **`metadata` di `leadEvents` è `jsonb` senza schema.** Ogni lettura va difesa (`typeof meta.note === 'string'`): in produzione esistono eventi `BOT_NOTE` scritti prima di questa feature, con `{ note }` e basta. Devono continuare a leggersi — e infatti si leggono come catene da un elemento solo.
- **Ordine dei task.** Il Task 3 tocca la server action e il suo unico consumatore insieme, di proposito: a metà task il branch non compila, a fine task sì. I task 4 e 5 sono indipendenti tra loro.
- **Le note del bot esistono solo su Fenice.** Su Serenamente le query tornano vuote e la UI non mostra niente: è il comportamento voluto, non un bug da "sistemare".
