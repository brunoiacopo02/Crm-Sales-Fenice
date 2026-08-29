# Le sette richieste del fornitore bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere i tre anelli aperti fra CRM e bot messaggistica (recupero NR, corsia Conferme sui contatti umani, ritorno degli esiti) e saldare i quattro debiti sul confine fra i due sistemi.

**Architecture:** Nessun endpoint nuovo e nessun segreto nuovo. Le chiamate in uscita verso il fornitore riusano `signPayload` + `BOT_WEBHOOK_SECRET` e partono dentro `after()` di `next/server`, così non bloccano mai l'operatore. Le invarianti condivise fra più file (lead bloccato, corsia di competenza) diventano funzioni pure in `src/lib/bot-fissatore/contactRequests.ts` con test, invece di commenti che promettono di restare allineati.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM su Supabase Postgres, Tailwind, test con `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-29-richieste-fornitore-bot-design.md`

## Global Constraints

- **Il DB si tocca solo con Drizzle** (`src/db/schema.ts`), mai SQL raw nel codice applicativo. Le migrazioni sono l'eccezione e sono file `.sql` scritti **a mano**: `drizzle-kit generate` è inutilizzabile su questo progetto (verificato 2026-07-07). Prossimo numero libero: **0031**.
- **Ogni nuovo file di test va aggiunto a mano** allo script `"test"` in `package.json`: elenca i file uno per uno, non usa glob. Un test non elencato non gira.
- I test girano con `node --import tsx --test <file>` e usano `node:test` + `node:assert/strict`. Si testano **solo funzioni pure**: niente test che toccano il DB.
- **`companyId` sempre esplicito** in ogni query: il CRM è multi-tenant (`fenice`, `serenamente`). Tutto ciò che riguarda il bot è `fenice` e basta.
- **Bottoni mai dentro `<span>` o `<p>`**: causa hydration error e White Screen of Death su Vercel. Usare `<div>`.
- Le date verso il fornitore vanno in **ISO con offset Roma**, via `toRomeIso` da `src/lib/dateUtils.ts`. Mai `.toISOString()` grezzo.
- Ogni chiamata HTTP verso il fornitore **non deve mai lanciare**: un fornitore giù non può impedire a un operatore di esitare un lead.
- Messaggi di commit in italiano, corpo che spiega il *perché*. Footer richiesto:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
  ```

## File Structure

| File | Responsabilità |
|---|---|
| `src/lib/bot-fissatore/contactRequests.ts` *(modifica)* | Aggiunge le due invarianti condivise: `isLeadLocked` e `contactLane`. Già contiene le categorie + ha già un test file. |
| `src/lib/bot-fissatore/callAttempt.ts` *(nuovo)* | Funzione pura `resolveCallAttempt`: dato lo stato NR del lead, dice se e quale tentativo notificare. |
| `src/lib/agendaBot.ts` *(modifica)* | Client HTTP `notifyCallAttemptToBot`, accanto ai due che ci sono già. |
| `src/app/actions/confermeActions.ts` *(modifica)* | Aggancio in `recordConfermeNoAnswer`. |
| `drizzle/migrations/0031_contact_request_outcome.sql` *(nuovo)* | Colonne esito + indice expression sul telefono. |
| `src/db/schema.ts` *(modifica)* | Le tre colonne nuove su `botContactRequests`. |
| `src/app/actions/contactRequestActions.ts` *(modifica)* | Vista role-aware + `takeChargeContactRequest` + `resolveContactRequest`. |
| `src/app/(dashboard)/richieste-contatto/` *(modifica)* | Pagina aperta alle Conferme, UI a due corsie. |
| `src/app/api/bot/lead-status/route.ts` *(modifica)* | Blocco `contattoUmano` nel payload. |
| `src/lib/bot-fissatore/reassign.ts` *(modifica)* | La guardia mancante. |
| `src/app/api/webhooks/activecampaign/route.ts` *(modifica)* | Quarantena telefoni sospetti + finestra dedup a 24h. |
| `src/app/actions/acIntakeActions.ts` *(modifica)* | Lista quarantena + assegnazione manuale. |
| `src/lib/bot-fissatore/push.ts` + `types.ts` *(modifica)* | `personKey` e `previousLeadIds` nel payload di intake. |

---

### Task 1: Le due invarianti condivise

Oggi `contactRequestActions.ts:56` definisce `isLocked` e il commento sopra dichiara che è «la stessa invariante della guardia in /api/bot/outcome». **È falso**: quella guardia protegge solo il ramo `APPUNTAMENTO`, e `reassign.ts` non ne ha nessuna. Un commento non tiene allineate due copie: una funzione sola sì.

**Files:**
- Modify: `src/lib/bot-fissatore/contactRequests.ts`
- Test: `src/lib/bot-fissatore/contactRequests.test.ts`

**Interfaces:**
- Produces: `isLeadLocked(status: string, presentedAt: Date | null): boolean` e `contactLane(leadStatus: string): 'conferme' | 'gdo'`, usate da Task 4, 5 e 8.

- [ ] **Step 1: Scrivi i test che falliscono**

In coda a `src/lib/bot-fissatore/contactRequests.test.ts`:

```ts
import { isLeadLocked, contactLane } from './contactRequests';

test('isLeadLocked: un lead appuntato non si sposta', () => {
    assert.equal(isLeadLocked('APPOINTMENT', null), true);
});

test('isLeadLocked: una presenza latchata blocca anche se lo status e cambiato', () => {
    assert.equal(isLeadLocked('NEW', new Date('2026-07-01T10:00:00Z')), true);
});

test('isLeadLocked: un lead libero si sposta', () => {
    assert.equal(isLeadLocked('NEW', null), false);
    assert.equal(isLeadLocked('IN_PROGRESS', null), false);
    assert.equal(isLeadLocked('REJECTED', null), false);
});

test('contactLane: un lead appuntato e delle Conferme', () => {
    assert.equal(contactLane('APPOINTMENT'), 'conferme');
});

test('contactLane: tutto il resto resta agli admin/GDO', () => {
    assert.equal(contactLane('NEW'), 'gdo');
    assert.equal(contactLane('IN_PROGRESS'), 'gdo');
    assert.equal(contactLane('REJECTED'), 'gdo');
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npm test`
Expected: FAIL — `isLeadLocked is not a function` (l'import non risolve).

- [ ] **Step 3: Implementa**

In coda a `src/lib/bot-fissatore/contactRequests.ts`:

```ts
/**
 * Un lead è bloccato quando ha già prodotto storico: ogni metrica per-GDO legge
 * l'assegnatario ATTUALE, quindi spostarlo cancellerebbe presenze da cicli bonus
 * già pagati e fatturato già riconciliato. `presentedAt` è latchato dal 17/07:
 * una volta vero non torna falso, nemmeno se il follow-up dice "Sparito".
 *
 * Questa funzione è l'UNICA definizione dell'invariante. Prima esisteva in due
 * copie — una in contactRequestActions.ts e una che avrebbe dovuto esserci in
 * reassign.ts e non c'era — con un commento che prometteva di tenerle allineate.
 * Non ha funzionato: un lead ha perso l'appuntamento (0f90aa98, 25/06).
 */
export function isLeadLocked(status: string, presentedAt: Date | null): boolean {
    return status === 'APPOINTMENT' || presentedAt !== null;
}

/**
 * Di chi è la competenza su una richiesta di contatto umano.
 *
 * Derivata e non memorizzata: un lead che passa ad APPOINTMENT cambia corsia da
 * solo, e non c'è nessuno stato da tenere allineato. Sono le 14 richieste su 64
 * (22%) che oggi finiscono in coda per un GDO quando a chiamare quel lead il
 * giorno prima della call sono le Conferme.
 */
export function contactLane(leadStatus: string): 'conferme' | 'gdo' {
    return leadStatus === 'APPOINTMENT' ? 'conferme' : 'gdo';
}
```

- [ ] **Step 4: Verifica che passino**

Run: `npm test`
Expected: PASS su tutti i test del file.

- [ ] **Step 5: Sostituisci la copia esistente**

In `src/app/actions/contactRequestActions.ts`, cancella la funzione locale `isLocked` (righe 44-58, commento incluso) e importa quella condivisa. Aggiungi all'import esistente da `@/lib/bot-fissatore/contactRequests` (se non c'è, crealo):

```ts
import { isLeadLocked, contactLane } from '@/lib/bot-fissatore/contactRequests';
```

Sostituisci le due chiamate a `isLocked(...)` (righe 121 e 186) con `isLeadLocked(...)`.

- [ ] **Step 6: Verifica che compili**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add src/lib/bot-fissatore/contactRequests.ts src/lib/bot-fissatore/contactRequests.test.ts src/app/actions/contactRequestActions.ts
git commit -F - <<'EOF'
refactor(bot): una sola definizione di "lead bloccato"

Il commento in contactRequestActions diceva che l'invariante era la stessa
della guardia in /api/bot/outcome. Non lo era: quella copre solo il ramo
APPUNTAMENTO, e reassign.ts non aveva nessuna guardia. Un lead ci ha perso
l'appuntamento il 25/06.

Ora la regola sta in un posto solo, con i suoi test.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 2: La guardia che manca in `reassign.ts`

`reassignBotLeadToHumanPool` non legge nemmeno il lead prima di sovrascriverlo con `status:'NEW', callCount:0`, e non azzera `appointmentDate` — quindi un lead può restare con un appuntamento appeso mentre è `NEW`, cioè fuori dalla board Conferme, dove nessuno lo chiama.

**Files:**
- Modify: `src/lib/bot-fissatore/reassign.ts:29` (dentro `db.transaction`, prima istruzione)
- Modify: `src/app/api/bot/outcome/route.ts:456-460`

**Interfaces:**
- Consumes: `isLeadLocked` da Task 1.
- Produces: `ReassignResult` guadagna una variante `{ ok: true; assignedToId: null; note: 'locked_appointment' | 'lead_not_found' }`.

- [ ] **Step 1: Allarga il tipo di ritorno**

In `src/lib/bot-fissatore/reassign.ts`, sostituisci il tipo `ReassignResult`:

```ts
type ReassignResult =
    | { ok: true; assignedToId: string }
    | { ok: true; assignedToId: null; note: 'no_eligible_gdo' | 'locked_appointment' | 'already_rejected' | 'lead_not_found' };
```

- [ ] **Step 2: Aggiungi la guardia come prima istruzione della transazione**

Aggiungi l'import in cima al file:

```ts
import { isLeadLocked } from './contactRequests';
```

Poi, dentro `db.transaction(async (tx) => {`, **prima** della select degli `eligible`:

```ts
        // Un lead che ha già un appuntamento o una presenza non torna nel pool:
        // riportarlo a NEW lo fa sparire dalla board Conferme con la data ancora
        // addosso, e la call passa senza che nessuno la faccia. È successo
        // davvero (lead 0f90aa98, 25/06). La guardia sta QUI e non nel route
        // perché così copre anche i chiamanti futuri.
        const [cur] = await tx.select({ status: leads.status, presentedAt: leads.presentedAt })
            .from(leads).where(eq(leads.id, leadId)).limit(1);
        if (!cur) return { ok: true, assignedToId: null, note: 'lead_not_found' as const };
        if (isLeadLocked(cur.status, cur.presentedAt)) {
            return { ok: true, assignedToId: null, note: 'locked_appointment' as const };
        }
        // Uno scarto è una decisione presa: un INTERROTTO che arriva dopo non la
        // annulla. Quattro lead già REJECTED sono stati resuscitati a NEW così
        // (12/07, 27/07, 13/08, 17/08) e sono tornati in pipeline a chiamare
        // gente che qualcuno aveva deciso di non chiamare più.
        //
        // Guardia SEPARATA da isLeadLocked di proposito: quella protegge storico
        // e attribuzione, questa protegge una decisione. In assignContactRequest
        // la resurrezione di un REJECTED è VOLUTA — un lead scartato che chiede
        // di essere richiamato torna in pipeline apposta. Fonderle romperebbe
        // quel flusso.
        if (cur.status === 'REJECTED') {
            return { ok: true, assignedToId: null, note: 'already_rejected' as const };
        }
```

Aggiorna anche la select per leggere lo status (già presente) — nessun campo in più serve.

- [ ] **Step 3: Fai vedere al fornitore che non abbiamo applicato niente**

In `src/app/api/bot/outcome/route.ts`, il ramo `NON_RISPOSTO`/`INTERROTTO` (righe 456-460) oggi risponde sempre `reassigned`. Sostituisci:

```ts
    if (typedOutcome === 'NON_RISPOSTO' || typedOutcome === 'INTERROTTO') {
        const reason = typedOutcome === 'NON_RISPOSTO' ? 'mai_risposto' : 'chat_interrotta';
        const r = await reassignBotLeadToHumanPool(leadId, reason, actorUserId, note);
        // Un 2xx che dice "reassigned: null" e basta è indistinguibile da un
        // successo: il fornitore deve poter leggere DENTRO la risposta che la
        // riassegnazione non è stata applicata, e perché.
        if (r.assignedToId === null && 'note' in r && r.note !== 'no_eligible_gdo') {
            return NextResponse.json({ ok: true, reassigned: null, skipped: r.note });
        }
        return NextResponse.json({ ok: true, reassigned: r.assignedToId });
    }
```

- [ ] **Step 4: Verifica che compili**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot-fissatore/reassign.ts src/app/api/bot/outcome/route.ts
git commit -F - <<'EOF'
fix(bot): un lead appuntato non torna piu' nel pool umano

reassignBotLeadToHumanPool non leggeva nemmeno il lead prima di
sovrascriverlo con status NEW e callCount 0, e non azzerava
appointmentDate: il lead spariva dalla board Conferme con la data ancora
addosso e la call passava senza che nessuno la facesse.

La guardia sta dentro la transazione e non nel route, cosi' copre anche i
chiamanti futuri. E il route ora dice dentro il 2xx che non ha applicato
niente, invece di lasciarlo dedurre da un silenzio.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 3: Quando notificare un tentativo di chiamata

**Files:**
- Create: `src/lib/bot-fissatore/callAttempt.ts`
- Create: `src/lib/bot-fissatore/callAttempt.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces: `resolveCallAttempt(lead: NrState): 1 | 3 | null`, usata da Task 5.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `src/lib/bot-fissatore/callAttempt.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCallAttempt } from './callAttempt';

const D = new Date('2026-08-29T10:00:00Z');

test('primo NR: nessuna chiamata registrata', () => {
    assert.equal(resolveCallAttempt({ confCall1At: null, confCall2At: null, confCall3At: null }), 1);
});

test('secondo NR: non si notifica, il fornitore accetta solo 1 e 3', () => {
    assert.equal(resolveCallAttempt({ confCall1At: D, confCall2At: null, confCall3At: null }), null);
});

test('terzo NR: e l ultima occasione prima dello scarto', () => {
    assert.equal(resolveCallAttempt({ confCall1At: D, confCall2At: D, confCall3At: null }), 3);
});

test('stato impossibile (3 NR gia scritti): non e un tentativo nuovo, non si notifica', () => {
    assert.equal(resolveCallAttempt({ confCall1At: D, confCall2At: D, confCall3At: D }), null);
});
```

- [ ] **Step 2: Verifica che fallisca**

Prima aggiungi il file allo script `test` in `package.json` (in coda alla lista, prima della chiusura delle virgolette):

```
 src/lib/bot-fissatore/callAttempt.test.ts
```

Run: `npm test`
Expected: FAIL — il modulo `./callAttempt` non esiste.

- [ ] **Step 3: Implementa**

Crea `src/lib/bot-fissatore/callAttempt.ts`:

```ts
/**
 * Quale tentativo di chiamata comunicare al bot, dato lo stato NR del lead
 * PRIMA di registrare il mancato contatto.
 *
 * Il fornitore accetta solo il 1° e il 3°: al primo il messaggio chiede se
 * l'orario va bene, al terzo dice che senza risposta l'appuntamento viene
 * annullato. Il secondo non ha un messaggio suo e non va notificato.
 *
 * Il caso "tre date già scritte" è lo stato di transizione dal vecchio sistema
 * a 4 tentativi (vedi recordConfermeNoAnswer): lì non stiamo registrando un
 * tentativo nuovo, stiamo sanando uno stato incoerente. Niente messaggio.
 */
export interface NrState {
    confCall1At: Date | null;
    confCall2At: Date | null;
    confCall3At: Date | null;
}

export function resolveCallAttempt(lead: NrState): 1 | 3 | null {
    if (!lead.confCall1At) return 1;
    if (!lead.confCall2At) return null;
    if (!lead.confCall3At) return 3;
    return null;
}
```

- [ ] **Step 4: Verifica che passi**

Run: `npm test`
Expected: PASS su tutti e quattro.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot-fissatore/callAttempt.ts src/lib/bot-fissatore/callAttempt.test.ts package.json
git commit -F - <<'EOF'
feat(bot): la regola di quale tentativo NR notificare al fornitore

Solo il 1o e il 3o: al primo il messaggio chiede se l'orario va bene, al
terzo dice che senza risposta l'appuntamento viene annullato. Il secondo
non ha un messaggio suo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 4: Il client HTTP verso `/api/bot/call-attempt`

**Files:**
- Modify: `src/lib/agendaBot.ts` (in coda al file)

**Interfaces:**
- Produces: `notifyCallAttemptToBot(input: NotifyCallAttemptInput): Promise<CallAttemptOutcome>`, usata da Task 5.
- `CallAttemptOutcome = { inviato: boolean; ramo?: string; motivo?: string }`

- [ ] **Step 1: Aggiungi la costante URL**

In cima a `src/lib/agendaBot.ts`, sotto `APPOINTMENT_BOT_URL`:

```ts
const CALL_ATTEMPT_BOT_URL = process.env.CALL_ATTEMPT_BOT_URL
    ?? 'https://web-app-messaggistica.vercel.app/api/bot/call-attempt'
```

- [ ] **Step 2: Implementa il client**

In coda a `src/lib/agendaBot.ts`:

```ts
export type NotifyCallAttemptInput = {
    leadId: string
    companyId: string
    /** 1 o 3: il fornitore non ha un messaggio per il secondo tentativo. */
    tentativo: 1 | 3
    /** Istante del mancato contatto: il messaggio funziona finché il lead ha la chiamata persa sul telefono. */
    at: Date
    /** Data e ora della call. Senza, il messaggio diventa generico e recupera molto meno. */
    appointmentAt: Date | null
}

/**
 * Esito applicativo dal corpo della risposta. Il fornitore risponde SEMPRE 200,
 * anche quando non scrive al lead: `inviato: false` con il `motivo` è una
 * risposta valida, non un errore.
 */
export type CallAttemptOutcome = {
    inviato: boolean
    ramo?: string
    motivo?: string
}

/**
 * Comunica al bot che la Conferma ha provato a chiamare il lead senza risposta,
 * così lui glielo scrive nella chat WhatsApp che ha già aperta.
 *
 * Lo scarto per "3 NR consecutivi" vale il 42% degli appuntamenti fissati dal
 * bot e il 44% di quelli fissati dai GDO: ~1.288 appuntamenti persi dal 24
 * giugno. È il collo di bottiglia più grande che abbiamo.
 *
 * NON filtriamo qui: il fornitore ha sette guardie sue (lead non suo, bot fermato
 * a mano, disdetta già chiesta, chat passata a una persona, lead che ha già
 * risposto, appuntamento passato, tentativo già scritto) e dice esplicitamente
 * "chiamateci pure sempre, filtriamo noi". Duplicarle qui significherebbe due
 * copie della stessa regola che divergono al primo cambio da parte loro.
 *
 * Non lancia MAI: un fornitore giù non deve impedire a una Conferma di
 * registrare il mancato contatto.
 */
export async function notifyCallAttemptToBot(input: NotifyCallAttemptInput): Promise<CallAttemptOutcome> {
    // Interruttore dedicato, NON AGENDA_CHANNEL: il recupero serve anche sugli
    // appuntamenti fissati dai GDO, che hanno una chat aperta col bot solo
    // perché l'agenda passa da lì. Vanno potuti spegnere separatamente.
    if (process.env.BOT_CALL_ATTEMPT === 'off') {
        return { inviato: false, motivo: 'kill_switch_off' }
    }
    // Serenamente ha il suo canale Twilio diretto, qui non c'entra.
    if (input.companyId !== 'fenice') {
        return { inviato: false, motivo: 'company_non_fenice' }
    }

    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!secret) {
        console.error('[call-attempt] BOT_WEBHOOK_SECRET non impostato')
        return { inviato: false, motivo: 'missing_secret' }
    }

    const rawBody = JSON.stringify({
        leadId: input.leadId,
        esito: 'no_answer',
        tentativo: input.tentativo,
        at: toRomeIso(input.at),
        appointmentAt: input.appointmentAt ? toRomeIso(input.appointmentAt) : undefined,
    })

    try {
        const res = await fetch(CALL_ATTEMPT_BOT_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-bot-signature': signPayload(rawBody, secret),
            },
            body: rawBody,
            signal: AbortSignal.timeout(8_000),
        })
        const text = await res.text().catch(() => '')
        if (!res.ok) {
            const error = protocolError(res.status, text)
            console.error(`[call-attempt] ${error} (lead ${input.leadId}, tentativo ${input.tentativo})`)
            return { inviato: false, motivo: error }
        }
        let data: any
        try {
            data = JSON.parse(text)
        } catch {
            return { inviato: false, motivo: 'risposta non JSON' }
        }
        return {
            inviato: data?.inviato === true,
            ramo: typeof data?.ramo === 'string' ? data.ramo : undefined,
            motivo: typeof data?.motivo === 'string' ? data.motivo : undefined,
        }
    } catch (e) {
        console.error(`[call-attempt] rete/timeout per lead ${input.leadId}`, e)
        return { inviato: false, motivo: `rete: ${String(e).slice(0, 120)}` }
    }
}
```

- [ ] **Step 3: Verifica che compili**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/lib/agendaBot.ts
git commit -F - <<'EOF'
feat(bot): client verso /api/bot/call-attempt

Quando la Conferma non riesce a parlare al lead, il bot glielo scrive nella
chat WhatsApp gia' aperta. Stesso segreto e stessa firma dell'agenda,
nessun segreto nuovo.

Non filtriamo qui: il fornitore ha sette guardie sue e dice di chiamare
sempre. Due copie della stessa regola divergono al primo loro cambio.

Kill-switch dedicato BOT_CALL_ATTEMPT=off, non AGENDA_CHANNEL: il recupero
serve anche sugli appuntamenti fissati dai GDO.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 5: Aggancio in `recordConfermeNoAnswer`

**Files:**
- Modify: `src/app/actions/confermeActions.ts:904-999`

**Interfaces:**
- Consumes: `resolveCallAttempt` (Task 3), `notifyCallAttemptToBot` (Task 4).

- [ ] **Step 1: Aggiungi gli import**

In cima a `src/app/actions/confermeActions.ts`:

```ts
import { after } from 'next/server';
import { resolveCallAttempt } from '@/lib/bot-fissatore/callAttempt';
import { notifyCallAttemptToBot } from '@/lib/agendaBot';
```

- [ ] **Step 2: Calcola il tentativo prima di scrivere**

In `recordConfermeNoAnswer`, subito dopo il controllo di concorrenza (`if (oldLead.version !== currentVersion) ...`) e prima di `let toUpdate`:

```ts
        // Calcolato PRIMA dell'update: dopo, le date sono già scritte e non si
        // distingue più quale tentativo abbiamo appena registrato.
        const tentativo = resolveCallAttempt(oldLead);
```

- [ ] **Step 3: Notifica dopo la risposta, non prima**

Alla fine della funzione, subito prima di `return { success: true, autoDiscarded: isAutoDiscard }`:

```ts
        // Dentro after(): la scrittura DB e il ritorno alla UI avvengono subito,
        // l'HTTP prosegue dopo la risposta. Una Conferma clicca NR di corsa su
        // una board — un'attesa di qualche secondo per click renderebbe la
        // feature odiata prima ancora che utile. Stessa primitiva con cui
        // enqueueMarketingWebhook consegna i webhook marketing.
        if (tentativo !== null) {
            const attemptAt = new Date();
            after(async () => {
                const outcome = await notifyCallAttemptToBot({
                    leadId,
                    companyId: ctx.companyId,
                    tentativo,
                    at: attemptAt,
                    appointmentAt: oldLead.appointmentDate ?? null,
                });
                // Senza questo evento non sapremmo mai se il recupero funziona —
                // ed è esattamente il rimprovero che il fornitore fa a noi sui
                // contatti umani. Best-effort: un audit fallito non deve
                // propagarsi.
                await db.insert(leadEvents).values({
                    id: crypto.randomUUID(),
                    leadId,
                    eventType: 'BOT_CALL_ATTEMPT',
                    userId: session.user.id,
                    timestamp: new Date(),
                    metadata: {
                        tentativo,
                        inviato: outcome.inviato,
                        ramo: outcome.ramo ?? null,
                        motivo: outcome.motivo ?? null,
                        appointmentAt: oldLead.appointmentDate ? oldLead.appointmentDate.toISOString() : null,
                    },
                    companyId: ctx.companyId,
                }).catch((e) => console.error('[call-attempt] audit err', e));
            });
        }
```

- [ ] **Step 4: Verifica che compili**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Verifica che il build passi**

Run: `npm run build`
Expected: build completato senza errori. `after()` richiede un contesto request-scoped: se il build segnala un uso fuori contesto, la causa è un import sbagliato (`next/server`, non `next/dist/...`).

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/confermeActions.ts
git commit -F - <<'EOF'
feat(conferme): il mancato contatto fa partire il messaggio del bot

I due bottoni "Notifica 1o NR" e "Notifica 3 NR" erano stati tolti il
06/08 lasciando in piedi il gancio, con la nota di riprenderlo quando i
messaggi sarebbero passati dal bot. E' questo momento, e il trigger
diventa automatico: il fornitore ha ragione a dire che il messaggio
funziona finche' il lead ha la chiamata persa sul telefono, e un bottone
in piu' su una board dove si clicca NR di corsa non verrebbe premuto.

La chiamata parte dentro after(): la Conferma non aspetta il fornitore.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 6: Migrazione 0031 — colonne esito e indice telefono

**Files:**
- Create: `drizzle/migrations/0031_contact_request_outcome.sql`
- Modify: `src/db/schema.ts` (tabella `botContactRequests`, dopo `closedByUserId`)

**Interfaces:**
- Produces: `botContactRequests.outcome`, `.outcomeAt`, `.note`; indice `leads_company_phonekey_idx`. Usati da Task 7, 9 e 12.

- [ ] **Step 1: Scrivi la migrazione**

Crea `drizzle/migrations/0031_contact_request_outcome.sql`:

```sql
-- Il ritorno sui contatti umani: chi l'ha presa in carico, quando, com'e' finita.
-- Oggi il fornitore consegna la richiesta e finisce li': il bot resta zitto su
-- quella chat all'infinito anche quando il caso e' chiuso da settimane.
--
-- "presoInCaricoDa"/"Il" NON diventano colonne nuove: sono gia' assignedToId e
-- assignedAt. Due campi che dicono la stessa cosa divergono al primo percorso
-- che ne aggiorna uno solo.

ALTER TABLE "botContactRequests" ADD COLUMN IF NOT EXISTS "outcome" text;
ALTER TABLE "botContactRequests" ADD COLUMN IF NOT EXISTS "outcomeAt" timestamptz;
ALTER TABLE "botContactRequests" ADD COLUMN IF NOT EXISTS "note" text;

-- Chiave persona per il dedup verso il bot: ultime 10 cifre del telefono.
-- Oggi non esiste NESSUN indice su leads.phone, ne' semplice ne' expression:
-- una lookup storica senza finestra temporale sarebbe un seq scan su 59k righe
-- a ogni webhook.
-- 10 cifre e non 9: a 9 si fondono 134 gruppi di numeri realmente diversi
-- (6.565 gruppi a 9 cifre contro 6.459 a 10).
CREATE INDEX IF NOT EXISTS "leads_company_phonekey_idx"
    ON "leads" ("companyId", (right(regexp_replace("phone", '\D', '', 'g'), 10)));
```

- [ ] **Step 2: Applica la migrazione**

Applicala con il tool MCP Supabase `mcp__supabase__apply_migration` sul progetto `ncutwzsifzundikwllxp`, name `0031_contact_request_outcome`, passando il contenuto SQL sopra.

Expected: successo. Verifica con:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'botContactRequests' AND column_name IN ('outcome','outcomeAt','note');
```
Expected: 3 righe.

- [ ] **Step 3: Allinea lo schema Drizzle**

In `src/db/schema.ts`, nella tabella `botContactRequests`, dopo `closedByUserId`:

```ts
    // Il ritorno verso il bot: com'è finita la richiesta. Vocabolario condiviso
    // col fornitore, così non serve tradurre ai due capi.
    // 'chiamato_ok' | 'non_raggiungibile' | 'rifissato' | 'disdetto' | 'non_gestito'
    outcome: text('outcome'),
    outcomeAt: timestamp('outcomeAt', { withTimezone: true, mode: 'date' }),
    note: text('note'),
```

- [ ] **Step 4: Verifica che compili**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0031_contact_request_outcome.sql src/db/schema.ts
git commit -F - <<'EOF'
feat(db): esito dei contatti umani + indice chiave persona (0031)

Tre colonne per dire al bot com'e' finita ogni richiesta. presoInCaricoDa
e presoInCaricoIl restano assignedToId e assignedAt, che esistono gia':
due campi che dicono la stessa cosa divergono al primo percorso che ne
aggiorna uno solo.

L'indice expression sulle ultime 10 cifre del telefono serve al dedup
verso il bot: oggi non c'e' nessun indice su phone, e una lookup storica
sarebbe un seq scan su 59k righe a ogni webhook. Dieci cifre e non nove:
a nove si fondono 134 gruppi di numeri diversi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 7: Le azioni delle Conferme sulla coda

**Files:**
- Modify: `src/app/actions/contactRequestActions.ts`

**Interfaces:**
- Consumes: `isLeadLocked`, `contactLane` (Task 1); colonne di Task 6.
- Produces: `getContactRequests()` con `ContactRequestsView` che guadagna `lane: 'admin' | 'conferme'` e `canAssign: boolean`; `takeChargeContactRequest(requestId)`; `resolveContactRequest(requestId, outcome, note)`; `CONTACT_OUTCOMES`. Usati da Task 8.

- [ ] **Step 1: Sostituisci il gate di ruolo**

Sostituisci `requireAdmin` (righe 12-18) con:

```ts
type Viewer = { id: string; role: string; lane: 'admin' | 'conferme' };

/**
 * Chi può vedere la coda, e quale fetta.
 * - ADMIN: tutto, e può assegnare a un GDO.
 * - CONFERME: solo i lead già appuntati — da lì in poi la competenza è loro,
 *   sono loro a richiamarli il giorno prima della call. Sono le 14 richieste
 *   su 64 (22%) che oggi finiscono in coda per un GDO.
 * Le Conferme NON assegnano: spostare l'assegnatario cambia l'attribuzione dei
 * KPI, e non è il loro mestiere.
 */
async function requireViewer(): Promise<Viewer | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const role = user.user_metadata?.role;
    if (role === 'ADMIN') return { id: user.id, role, lane: 'admin' };
    if (role === 'CONFERME') return { id: user.id, role, lane: 'conferme' };
    return null;
}

async function requireAdmin() {
    const v = await requireViewer();
    return v?.lane === 'admin' ? { id: v.id } : null;
}
```

- [ ] **Step 2: Allarga la view e filtra per corsia**

Aggiungi ai tipi esportati, dopo `ContactRequestRow`:

```ts
export const CONTACT_OUTCOMES = {
    chiamato_ok: 'Parlato, tutto a posto',
    non_raggiungibile: 'Non raggiungibile',
    rifissato: 'Appuntamento rifissato',
    disdetto: 'Ha disdetto',
    non_gestito: 'Non gestito',
} as const;

export type ContactOutcome = keyof typeof CONTACT_OUTCOMES;
```

Aggiungi tre campi a `ContactRequestRow` (dopo `currentOwnerName`):

```ts
    lane: 'conferme' | 'gdo';
    outcome: string | null;
    note: string | null;
```

E due a `ContactRequestsView`:

```ts
    lane: 'admin' | 'conferme';
    canAssign: boolean;
```

In `getContactRequests`, sostituisci `if (!await requireAdmin()) return null;` con:

```ts
    const viewer = await requireViewer();
    if (!viewer) return null;
```

Aggiungi al `selection` object la lettura delle colonne nuove (arrivano già dentro `r: botContactRequests`, quindi non serve toccare `selection`), e in `toRow` aggiungi:

```ts
        lane: contactLane(r.leadStatus),
        outcome: r.r.outcome,
        note: r.r.note,
```

Infine, nel `return`, filtra per corsia e dichiara i permessi:

```ts
    const inLane = (r: ContactRequestRow) => viewer.lane === 'admin' || r.lane === 'conferme';

    return {
        lane: viewer.lane,
        canAssign: viewer.lane === 'admin',
        // Chi aspetta da più tempo sta in cima: è l'unico ordine che impedisce
        // a una richiesta di luglio di scivolare sotto quelle di stamattina.
        pending: all.filter(r => r.r.status === 'pending').map(toRow).filter(inLane)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        handled: all.filter(r => r.r.status !== 'pending').map(toRow).filter(inLane)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        gdos: viewer.lane === 'admin'
            ? gdoRows.map(g => ({ id: g.id, label: g.gdoCode ? `GDO ${g.gdoCode}` : (g.displayName || g.name || g.id) }))
                .sort((a, b) => a.label.localeCompare(b.label, 'it'))
            : [],
    };
```

- [ ] **Step 3: Aggiungi il tocco su `leads.updatedAt`**

Subito sotto `requireAdmin`, aggiungi l'helper che serve a Task 9:

```ts
/**
 * Fa emergere il lead sul cursore di /api/bot/lead-status.
 *
 * Quell'endpoint pagina su leads.updatedAt, ma prendere in carico una richiesta
 * non tocca il lead: senza questo, le righe non uscirebbero MAI e il fornitore
 * vedrebbe silenzio credendo che non le lavoriamo — cioè il problema che
 * volevamo chiudere, con in più la convinzione di averlo chiuso.
 *
 * Semanticamente onesto: dal punto di vista del bot qualcosa su quel lead è
 * davvero cambiato. Volume trascurabile (~64 richieste da luglio).
 */
async function touchLeadForBotCursor(leadId: string): Promise<void> {
    await db.update(leads)
        .set({ updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.companyId, COMPANY)))
        .catch((e) => console.error('[contatto-umano] touch lead err', e));
}
```

Chiamalo in `assignContactRequest` (dopo l'update di `botContactRequests`) e in `closeContactRequest` (dopo l'update, solo se `updated.length > 0`).

- [ ] **Step 4: Aggiungi le due azioni delle Conferme**

In coda al file:

```ts
/**
 * "La prendo io." Non sposta il lead e non tocca l'assegnatario del funnel:
 * dice solo chi se ne sta occupando, così due Conferme non chiamano la stessa
 * persona a cinque minuti di distanza.
 */
export async function takeChargeContactRequest(requestId: string): Promise<{ ok: boolean; error?: string }> {
    const viewer = await requireViewer();
    if (!viewer) return { ok: false, error: 'Non autorizzato.' };

    const [row] = await db.select({ r: botContactRequests, leadStatus: leads.status })
        .from(botContactRequests)
        .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
        .where(eq(botContactRequests.id, requestId))
        .limit(1);
    if (!row) return { ok: false, error: 'Richiesta non trovata.' };
    if (row.r.status !== 'pending') return { ok: false, error: 'Richiesta già gestita.' };
    if (viewer.lane === 'conferme' && contactLane(row.leadStatus) !== 'conferme') {
        return { ok: false, error: 'Questa richiesta non è di competenza delle Conferme.' };
    }

    const now = new Date();
    await db.update(botContactRequests)
        .set({ status: 'assigned', assignedToId: viewer.id, assignedAt: now, updatedAt: now })
        .where(and(eq(botContactRequests.id, requestId), eq(botContactRequests.status, 'pending')));

    await touchLeadForBotCursor(row.r.leadId);
    revalidatePath('/richieste-contatto');
    revalidatePath('/', 'layout');
    return { ok: true };
}

/**
 * Com'è finita. È il segnale che il fornitore ci chiede: finché non esiste, il
 * bot resta zitto su quella chat all'infinito anche quando il caso è chiuso da
 * settimane, e nessuno dei due può dire se la sezione sta funzionando.
 */
export async function resolveContactRequest(
    requestId: string,
    outcome: ContactOutcome,
    note?: string,
): Promise<{ ok: boolean; error?: string }> {
    const viewer = await requireViewer();
    if (!viewer) return { ok: false, error: 'Non autorizzato.' };
    if (!(outcome in CONTACT_OUTCOMES)) return { ok: false, error: 'Esito non valido.' };

    const [row] = await db.select({ r: botContactRequests, leadStatus: leads.status })
        .from(botContactRequests)
        .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
        .where(eq(botContactRequests.id, requestId))
        .limit(1);
    if (!row) return { ok: false, error: 'Richiesta non trovata.' };
    if (viewer.lane === 'conferme' && contactLane(row.leadStatus) !== 'conferme') {
        return { ok: false, error: 'Questa richiesta non è di competenza delle Conferme.' };
    }

    const now = new Date();
    await db.update(botContactRequests)
        .set({
            status: 'closed',
            outcome,
            outcomeAt: now,
            note: note?.trim() || null,
            closedAt: now,
            closedByUserId: viewer.id,
            // Se nessuno l'aveva presa in carico, chi la chiude è chi se n'è occupato.
            ...(row.r.assignedToId ? {} : { assignedToId: viewer.id, assignedAt: now }),
            updatedAt: now,
        })
        .where(eq(botContactRequests.id, requestId));

    await touchLeadForBotCursor(row.r.leadId);
    revalidatePath('/richieste-contatto');
    revalidatePath('/', 'layout');
    return { ok: true };
}
```

- [ ] **Step 5: Verifica che compili**

Run: `npx tsc --noEmit`
Expected: nessun errore. Se `leads` non è importato in questo file, aggiungilo all'import da `@/db/schema` (dovrebbe già esserci).

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/contactRequestActions.ts
git commit -F - <<'EOF'
feat(conferme): corsia Conferme sulla coda dei contatti umani

Le notifiche alle Conferme erano gia' realtime dal 26/08. Le 48 richieste
ferme non aspettavano un avviso: aspettavano una pagina dove atterrare,
perche' la coda era ADMIN-only.

Le Conferme vedono i lead gia' appuntati - da li' in poi la competenza e'
loro - e possono prenderle in carico e chiuderle con un esito. Non
assegnano a un GDO: spostare l'assegnatario cambia l'attribuzione dei KPI.

Ogni mutazione tocca leads.updatedAt, altrimenti il ritorno verso il bot
non uscirebbe mai dal cursore di lead-status.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 8: La pagina per le Conferme

**Files:**
- Modify: `src/app/(dashboard)/richieste-contatto/page.tsx`
- Modify: `src/app/(dashboard)/richieste-contatto/ContactRequestsClient.tsx`
- Modify: `src/components/Sidebar.tsx:175`

**Interfaces:**
- Consumes: `getContactRequests`, `takeChargeContactRequest`, `resolveContactRequest`, `CONTACT_OUTCOMES` (Task 7).

- [ ] **Step 1: Apri la pagina alle Conferme**

In `page.tsx`, sostituisci il gate:

```tsx
// ADMIN e CONFERME. L'admin vede tutta la coda e smista; le Conferme vedono
// solo i lead già appuntati, che da quel momento sono di loro competenza.
// Il doppio controllo (qui e dentro l'action) è voluto: la pagina protegge la
// navigazione, l'action protegge i dati.
export default async function RichiesteContattoPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = user?.user_metadata?.role;
    if (!user || (role !== 'ADMIN' && role !== 'CONFERME')) {
        redirect('/unauthorized');
    }

    const view = await getContactRequests();
    if (!view) redirect('/unauthorized');

    return (
        <div className="p-4 sm:p-6">
            <ContactRequestsClient view={view} />
        </div>
    );
}
```

- [ ] **Step 2: Aggiungi le azioni nel client**

In `ContactRequestsClient.tsx`, aggiungi agli import:

```tsx
import { takeChargeContactRequest, resolveContactRequest, CONTACT_OUTCOMES } from '@/app/actions/contactRequestActions';
import type { ContactOutcome } from '@/app/actions/contactRequestActions';
```

Dentro `RequestCard`, cambia la firma per ricevere i permessi e aggiungi lo stato dell'esito:

```tsx
function RequestCard({ row, gdos, canAssign }: { row: ContactRequestRow; gdos: ContactRequestsView['gdos']; canAssign: boolean }) {
    const [outcome, setOutcome] = useState<ContactOutcome | ''>('');
    const [note, setNote] = useState('');
```

Il blocco di assegnazione al GDO esistente va avvolto in `{canAssign && ( ... )}`. Sotto, per tutti, aggiungi il blocco azioni — **`<div>`, mai `<span>`, altrimenti hydration error e WSOD su Vercel**:

```tsx
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        {row.status === 'pending' && (
                            <button
                                onClick={() => startTransition(async () => {
                                    const r = await takeChargeContactRequest(row.id);
                                    if (!r.ok) setError(r.error ?? 'Errore');
                                })}
                                disabled={isPending}
                                className="rounded-full border border-brand-orange/30 bg-brand-orange/10 px-3 py-1.5 text-xs font-semibold text-brand-orange transition-colors hover:bg-brand-orange/20 disabled:opacity-50"
                            >
                                La prendo io
                            </button>
                        )}
                        {row.status !== 'closed' && (
                            <>
                                <select
                                    value={outcome}
                                    onChange={(e) => setOutcome(e.target.value as ContactOutcome | '')}
                                    className="rounded-lg border border-ash-300 px-2 py-1.5 text-xs"
                                >
                                    <option value="">Esito…</option>
                                    {Object.entries(CONTACT_OUTCOMES).map(([k, label]) => (
                                        <option key={k} value={k}>{label}</option>
                                    ))}
                                </select>
                                <input
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="Nota (facoltativa)"
                                    className="min-w-0 flex-1 rounded-lg border border-ash-300 px-2 py-1.5 text-xs"
                                />
                                <button
                                    onClick={() => startTransition(async () => {
                                        if (!outcome) { setError('Scegli un esito.'); return; }
                                        const r = await resolveContactRequest(row.id, outcome, note);
                                        if (!r.ok) setError(r.error ?? 'Errore');
                                    })}
                                    disabled={isPending || !outcome}
                                    className="rounded-full bg-ash-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-ash-800 disabled:opacity-40"
                                >
                                    Chiudi
                                </button>
                            </>
                        )}
                        {row.outcome && (
                            <div className="text-xs text-ash-500">
                                Esito: <strong>{CONTACT_OUTCOMES[row.outcome as ContactOutcome] ?? row.outcome}</strong>
                                {row.note ? ` — ${row.note}` : ''}
                            </div>
                        )}
                    </div>
```

Nel componente `ContactRequestsClient`, passa `canAssign={view.canAssign}` a ogni `<RequestCard>`, e cambia il titolo in base alla corsia:

```tsx
    const title = view.lane === 'conferme'
        ? 'Lead che ti hanno cercato'
        : 'Richieste di contatto';
    const subtitle = view.lane === 'conferme'
        ? 'Lead con un appuntamento fissato che hanno scritto al bot chiedendo di parlare con una persona.'
        : 'Chi ha chiesto di parlare con una persona. In cima chi aspetta da più tempo.';
```

- [ ] **Step 3: Voce in Sidebar per le Conferme**

In `src/components/Sidebar.tsx:175`, sostituisci la riga:

```tsx
                        ...(role === "ADMIN" || role === "CONFERME"
                            ? [{ name: role === "CONFERME" ? "Ti hanno cercato" : "Richieste di Contatto", href: "/richieste-contatto", icon: PhoneIncoming }]
                            : []),
```

- [ ] **Step 4: Verifica che compili e builda**

Run: `npx tsc --noEmit && npm run build`
Expected: nessun errore, build completato.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/richieste-contatto/page.tsx" "src/app/(dashboard)/richieste-contatto/ContactRequestsClient.tsx" src/components/Sidebar.tsx
git commit -F - <<'EOF'
feat(conferme): la pagina dove atterrare quando il lead ti cerca

Le Conferme ricevevano la notifica realtime e non avevano dove cliccare:
la coda era ADMIN-only. Ora vedono i lead gia' appuntati che hanno chiesto
di parlare con una persona, li prendono in carico e li chiudono con un
esito.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 9: Il blocco `contattoUmano` su `lead-status`

**Files:**
- Modify: `src/app/api/bot/lead-status/route.ts`

**Interfaces:**
- Consumes: colonne di Task 6, tocco su `leads.updatedAt` di Task 7.

- [ ] **Step 1: Aggiungi l'import della tabella**

In `src/app/api/bot/lead-status/route.ts`, aggiungi `botContactRequests` e `users` all'import da `@/db/schema`, e `desc`, `inArray` a quello da `drizzle-orm`.

- [ ] **Step 2: Carica le richieste dei lead della pagina**

Dopo il calcolo di `page` (subito dopo `const page = hasMore ? rows.slice(0, limit) : rows;`):

```ts
    // Il ritorno che il fornitore ci chiede: chi l'ha presa, quando, com'è
    // finita. Caricato solo per i lead di QUESTA pagina — una join sul cursore
    // moltiplicherebbe le righe per i lead con più richieste.
    // La più recente per lead: se il lead ha richiesto di essere richiamato di
    // nuovo dopo giorni, è quella nuova che conta.
    const pageLeadIds = page.map(r => r.leadId);
    const requestRows = pageLeadIds.length > 0
        ? await db.select({
            leadId: botContactRequests.leadId,
            assignedAt: botContactRequests.assignedAt,
            outcome: botContactRequests.outcome,
            outcomeAt: botContactRequests.outcomeAt,
            note: botContactRequests.note,
            status: botContactRequests.status,
            createdAt: botContactRequests.createdAt,
            operatorName: users.name,
            operatorDisplayName: users.displayName,
        })
            .from(botContactRequests)
            .leftJoin(users, eq(users.id, botContactRequests.assignedToId))
            .where(and(
                eq(botContactRequests.companyId, 'fenice'),
                inArray(botContactRequests.leadId, pageLeadIds),
            ))
            .orderBy(desc(botContactRequests.createdAt))
        : [];

    const contactByLead = new Map<string, typeof requestRows[number]>();
    for (const r of requestRows) {
        if (!contactByLead.has(r.leadId)) contactByLead.set(r.leadId, r);
    }
```

- [ ] **Step 3: Aggiungi il blocco al payload**

Dentro `page.map(r => ({ ... }))`, in coda ai campi esistenti (dopo `updatedAt: iso(r.updatedAt)`):

```ts
        // null per i lead che non hanno mai chiesto di parlare con una persona.
        // Una richiesta ancora `pending` esce con esito null: dice al bot che
        // l'abbiamo ricevuta ma non ancora lavorata, che è già più di quello
        // che sa oggi.
        contattoUmano: (() => {
            const c = contactByLead.get(r.leadId);
            if (!c) return null;
            return {
                presoInCaricoDa: c.operatorName || c.operatorDisplayName || null,
                presoInCaricoIl: iso(c.assignedAt),
                esito: c.outcome,
                esitoIl: iso(c.outcomeAt),
                nota: c.note,
                stato: c.status,          // 'pending' | 'assigned' | 'closed'
                richiestaIl: iso(c.createdAt),
            };
        })(),
```

- [ ] **Step 4: Aggiorna il commento del contratto**

Nel blocco di documentazione in cima al file, dopo la riga `Reply: ...`, aggiungi:

```
 * Ogni riga porta anche `contattoUmano`: chi ha preso in carico la richiesta di
 * parlare con una persona, quando, e com'è finita (null se il lead non ne ha
 * mai fatta una). Le mutazioni della coda toccano `leads.updatedAt` apposta,
 * altrimenti quelle righe non uscirebbero mai da questo cursore.
```

- [ ] **Step 5: Verifica che compili e builda**

Run: `npx tsc --noEmit && npm run build`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/bot/lead-status/route.ts
git commit -F - <<'EOF'
feat(bot): lead-status dice che fine fa ogni richiesta di contatto

Il fornitore consegnava la richiesta e finiva li': il bot restava zitto su
quella chat all'infinito anche quando il caso era chiuso da settimane.

Sulle righe che gia' serviamo, nessun endpoint nuovo e nessun segreto
nuovo, come chiedevano loro. L'arretrato delle 48 richieste esce da solo
man mano che viene lavorato, perche' il cursore e' a scorrimento.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 10: Quarantena dei telefoni inventati

**Files:**
- Modify: `src/app/api/webhooks/activecampaign/route.ts` (transazione + coda)
- Modify: `src/app/actions/acIntakeActions.ts` (in coda)

**Interfaces:**
- Produces: `listQuarantinedLeads(): Promise<QuarantinedLeadRow[]>` e `assignQuarantinedLead(leadId, gdoId)`, usate da Task 11.

- [ ] **Step 1: Non assegnare i telefoni sospetti**

In `src/app/api/webhooks/activecampaign/route.ts`, dentro la transazione, **subito dopo** la guardia cross-azienda (`if (crossCompany) { ... }`) e **prima** del blocco `// ===== A chi va questo lead`:

```ts
            // Telefono inventato (000, 3, 0000000000): il lead entra, ma non va
            // a nessuno. Bruciare il tempo di un GDO su un numero che non esiste
            // è un costo certo; scartarlo automaticamente sarebbe più pulito nei
            // numeri ma perderebbe un lead pagato ogni volta che isPlausiblePhone
            // sbaglia — e sbaglia, per esempio sui formati esteri. Resta in una
            // lista admin su /lead-automatici, da bonificare a mano.
            // assignedAt resta null di proposito: il lead NON è entrato in circolo.
            if (phoneSuspicious) {
                await tx.insert(leads).values({
                    id: newLeadId,
                    name: fullName,
                    phone: phoneFinal,
                    email,
                    funnel,
                    source: 'activecampaign',
                    acContactId: contactId,
                    utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
                    phoneSuspicious: true,
                    status: 'NEW',
                    callCount: 0,
                    assignedToId: null,
                    assignedAt: null,
                    createdAt: now,
                    updatedAt: now,
                    companyId: FENICE_COMPANY,
                });
                return { kind: 'quarantined' as const };
            }
```

- [ ] **Step 2: Gestisci l'esito fuori dalla transazione**

Dopo il blocco `if (txResult.kind === 'no_gdo') { ... }` e **prima** di `const assignedGdoId = txResult.assignedGdoId;`:

```ts
        if (txResult.kind === 'quarantined') {
            // Niente push al bot: una chat WhatsApp su 0000000000 non esiste.
            // Niente evento ASSIGNED e niente notifica: non è di nessuno.
            await logLeadEvent({
                leadId: newLeadId,
                eventType: 'IMPORTED',
                toSection: 'Quarantena telefono',
                metadata: {
                    source: 'activecampaign',
                    acContactId: contactId,
                    provenienza: provenienza || null,
                    phoneSuspicious: true,
                    phoneRaw: rawPhone,
                    quarantined: true,
                },
                companyId: FENICE_COMPANY,
            });
            return NextResponse.json({
                success: true,
                leadId: newLeadId,
                funnel,
                phoneSuspicious: true,
                quarantined: true,
                assignedTo: null,
            });
        }
```

- [ ] **Step 3: La lista admin e l'assegnazione manuale**

In coda a `src/app/actions/acIntakeActions.ts`:

```ts
export interface QuarantinedLeadRow {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    funnel: string | null;
    createdAt: string;
    /** Il numero grezzo che era arrivato da AC, se lo abbiamo. */
    phoneRaw: string | null;
}

/**
 * I lead entrati con un telefono che non è un numero e lasciati senza
 * assegnatario. Il fornitore ne ha contati 21 su 177: sono telefonate che
 * nessuno può fare, e ore di GDO buttate se le assegniamo.
 */
export async function listQuarantinedLeads(): Promise<QuarantinedLeadRow[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = user?.user_metadata?.role;
    if (!user || !['ADMIN', 'MANAGER', 'TL'].includes(role)) return [];

    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        createdAt: leads.createdAt,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, 'fenice'),
            eq(leads.phoneSuspicious, true),
            isNull(leads.assignedToId),
            eq(leads.status, 'NEW'),
        ))
        .orderBy(desc(leads.createdAt))
        .limit(200);

    return rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        funnel: r.funnel,
        createdAt: r.createdAt.toISOString(),
        phoneRaw: null,
    }));
}

/**
 * L'admin ha corretto il numero a mano (o ha deciso che è buono) e lo manda a
 * un GDO. `assignedAt` parte adesso: è ora che il lead entra davvero in circolo.
 */
export async function assignQuarantinedLead(leadId: string, gdoId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') {
        return { success: false, error: 'Solo gli ADMIN possono assegnare un lead in quarantena.' };
    }

    const [gdo] = await db.select({ id: users.id, role: users.role, isActive: users.isActive })
        .from(users).where(and(eq(users.id, gdoId), eq(users.companyId, 'fenice'))).limit(1);
    if (!gdo || gdo.role !== 'GDO' || !gdo.isActive) return { success: false, error: 'GDO non valido o non attivo.' };

    const now = new Date();
    const updated = await db.update(leads)
        .set({ assignedToId: gdoId, assignedAt: now, updatedAt: now, phoneSuspicious: false })
        .where(and(eq(leads.id, leadId), eq(leads.companyId, 'fenice'), isNull(leads.assignedToId)))
        .returning({ id: leads.id });
    if (updated.length === 0) return { success: false, error: 'Lead non trovato o già assegnato.' };

    await logLeadEvent({
        leadId,
        eventType: 'ASSIGNED',
        userId: user.id,
        metadata: { assignedToUser: gdoId, source: 'quarantena_telefono' },
        companyId: 'fenice',
    });

    revalidatePath('/lead-automatici');
    return { success: true };
}
```

Verifica che `isNull` sia importato da `drizzle-orm` in cima al file; se manca, aggiungilo.

- [ ] **Step 4: Verifica che compili e builda**

Run: `npx tsc --noEmit && npm run build`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/activecampaign/route.ts src/app/actions/acIntakeActions.ts
git commit -F - <<'EOF'
feat(intake): i telefoni inventati non vanno a nessun operatore

phoneSuspicious esisteva gia' su tutti e tre gli intake ma non aveva
nessun effetto: il lead veniva assegnato normalmente e bruciava il tempo
di un GDO su un numero che non esiste. Ne aveva contati 21 su 177 il
fornitore.

Non scartati: isPlausiblePhone sbaglia sui formati esteri, e un lead
scartato in automatico e' un lead pagato che nessuno sapra' mai di aver
perso. Restano in una lista admin, senza assegnatario e senza assignedAt
- non sono entrati in circolo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 11: La scheda quarantena su `/lead-automatici`

**Files:**
- Modify: `src/app/(dashboard)/lead-automatici/page.tsx`
- Modify: `src/app/(dashboard)/lead-automatici/LeadAutomaticiClient.tsx`

**Interfaces:**
- Consumes: `listQuarantinedLeads`, `assignQuarantinedLead` (Task 10), `listGdosForAcIntake` (esistente).

- [ ] **Step 1: Carica i dati nella pagina**

In `page.tsx`, aggiungi `listQuarantinedLeads` all'import da `@/app/actions/acIntakeActions`, aggiungilo al `Promise.all` e passalo al client:

```tsx
    const [rows, webhooksRes, failures, stats, routingStatus, quarantined] = await Promise.all([
        listGdosForAcIntake(),
        listAcWebhooks(),
        listAcFailures(true),
        getAcIntakeStats(),
        getBotRoutingStatus(),
        listQuarantinedLeads(),
    ]);
```

e nel JSX: `initialQuarantined={quarantined}`.

- [ ] **Step 2: Aggiungi la scheda al client**

In `LeadAutomaticiClient.tsx`, aggiungi alla firma delle props:

```tsx
    initialQuarantined: QuarantinedLeadRow[]
```

con l'import dei tipi e dell'azione:

```tsx
import { assignQuarantinedLead } from '@/app/actions/acIntakeActions';
import type { QuarantinedLeadRow } from '@/app/actions/acIntakeActions';
```

E una sezione nel JSX, dopo il blocco dei fallimenti AC. **Solo `<div>` come contenitore dei bottoni**:

```tsx
            {initialQuarantined.length > 0 && (
                <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
                    <div className="mb-1 text-sm font-bold text-amber-900">
                        ⚠️ Telefoni da verificare ({initialQuarantined.length})
                    </div>
                    <p className="mb-3 text-xs text-amber-800">
                        Lead entrati con un numero che non sembra un telefono. Non sono assegnati
                        a nessuno: correggi il numero dalla scheda del lead e poi mandalo a un GDO.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-xs">
                            <thead className="text-amber-900/70">
                                <tr>
                                    <th className="pb-2 font-semibold">Nome</th>
                                    <th className="pb-2 font-semibold">Numero</th>
                                    <th className="pb-2 font-semibold">Funnel</th>
                                    <th className="pb-2 font-semibold">Arrivato</th>
                                    <th className="pb-2 font-semibold">Assegna a</th>
                                </tr>
                            </thead>
                            <tbody>
                                {initialQuarantined.map(q => (
                                    <tr key={q.id} className="border-t border-amber-200/70">
                                        <td className="py-2 pr-3 font-medium text-ash-900">{q.name}</td>
                                        <td className="py-2 pr-3 font-mono text-amber-900">{q.phone}</td>
                                        <td className="py-2 pr-3 text-ash-600">{q.funnel ?? '—'}</td>
                                        <td className="py-2 pr-3 text-ash-500">
                                            {new Date(q.createdAt).toLocaleDateString('it-IT')}
                                        </td>
                                        <td className="py-2">
                                            <select
                                                defaultValue=""
                                                onChange={(e) => {
                                                    const gdoId = e.target.value;
                                                    if (!gdoId) return;
                                                    startTransition(async () => {
                                                        await assignQuarantinedLead(q.id, gdoId);
                                                        router.refresh();
                                                    });
                                                }}
                                                className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs"
                                            >
                                                <option value="">Scegli GDO…</option>
                                                {initialRows.map(g => (
                                                    <option key={g.userId} value={g.userId}>{g.label}</option>
                                                ))}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
```

Se `initialRows` usa nomi di campo diversi da `userId`/`label`, adattali leggendo l'interfaccia `GdoAcIntakeRow` in `acIntakeActions.ts:26`. Se `startTransition` o `router` non sono già presenti nel componente, aggiungi `const [isPending, startTransition] = useTransition()` e `const router = useRouter()`.

- [ ] **Step 3: Verifica che compili e builda**

Run: `npx tsc --noEmit && npm run build`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/lead-automatici/page.tsx" "src/app/(dashboard)/lead-automatici/LeadAutomaticiClient.tsx"
git commit -F - <<'EOF'
feat(intake): scheda "telefoni da verificare" su /lead-automatici

I lead in quarantena vanno guardati da qualcuno, altrimenti la quarantena
e' solo un modo elegante di perderli. La sala di controllo dell'intake e'
gia' questa pagina.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 12: Chiave persona e storico verso il bot

Il fornitore deduplica per numero, noi creiamo un lead nuovo a ogni rientro. Il merge retroattivo è escluso (1.708 gruppi toccano presenze e fatturato, 5.251 l'attribuzione GDO): gli diamo invece quello che gli serve per capirlo da solo.

**Files:**
- Modify: `src/lib/bot-fissatore/types.ts`
- Modify: `src/lib/bot-fissatore/push.ts`
- Modify: `src/app/api/webhooks/activecampaign/route.ts` (chiamata a `pushLeadToBot`)
- Modify: `src/app/actions/pipelineActions.ts:227,271` (9 → 10 cifre)

**Interfaces:**
- Consumes: indice `leads_company_phonekey_idx` (Task 6).
- Produces: `BotIntakePayload` con `personKey` e `previousLeadIds`.

- [ ] **Step 1: Correggi il detector duplicati da 9 a 10 cifre**

In `src/app/actions/pipelineActions.ts`, sostituisci **tutte e tre** le occorrenze della chiave a 9 cifre:

- riga ~227: `right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9)` → `..., 10)`
- riga ~239: `.slice(-9)` → `.slice(-10)`
- riga ~271 (dentro `getLeadsWithSamePhone`): `.slice(-9)` → `.slice(-10)` e l'espressione SQL `, 9)` → `, 10)`

Aggiorna i due commenti che dicono «ultime 9 cifre» in «ultime 10 cifre», aggiungendo la ragione:

```ts
    // Detector duplicati telefono (non bloccante): numeri normalizzati alle
    // ultime 10 cifre presenti su più lead della company. Dieci e non nove: a
    // nove si fondono 134 gruppi di numeri realmente diversi (6.565 gruppi a 9
    // cifre contro 6.459 a 10).
```

- [ ] **Step 2: Allarga il payload di intake**

In `src/lib/bot-fissatore/types.ts`, sostituisci `BotIntakePayload`:

```ts
/** Un lead precedente con lo stesso numero: al bot serve per capire che è la stessa chat. */
export interface PreviousLeadRef {
    leadId: string;
    status: string;
    outcome: string | null;
    createdAt: string;
}

/** Payload inviato al webhook del bot quando un lead viene assegnato all'account bot. */
export interface BotIntakePayload {
    leadId: string;
    name: string | null;
    phone: string;
    email: string | null;
    funnel: string | null;
    companyId: string;
    /**
     * Ultime 10 cifre del telefono normalizzato: la stessa persona ha sempre la
     * stessa chiave, anche quando da noi diventa un lead nuovo. Il fornitore
     * deduplica per numero e non può fare altrimenti — una persona ha una chat
     * sola. Con questa capisce da solo che è la stessa conversazione.
     * `acContactId` non basterebbe: copre il 52% dei casi, gli import manuali
     * e i CSV non ce l'hanno.
     */
    personKey?: string;
    /** I lead precedenti con la stessa personKey, dal più recente. Max 10. */
    previousLeadIds?: PreviousLeadRef[];
}
```

- [ ] **Step 3: Calcola chiave e storico dentro il push**

In `src/lib/bot-fissatore/push.ts`, aggiungi gli import:

```ts
import { db } from '@/db';
import { leads } from '@/db/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
```

E, prima di `pushLeadToBot`:

```ts
/** Ultime 10 cifre: la chiave persona che il bot usa per riconoscere la chat. */
export function personKeyOf(phone: string | null): string | null {
    const digits = (phone || '').replace(/\D/g, '').slice(-10);
    return digits.length >= 9 ? digits : null;
}

/**
 * I lead precedenti della stessa persona. Non li fondiamo — un merge
 * retroattivo toccherebbe 1.708 gruppi con presenze e fatturato e 5.251 con
 * attribuzioni GDO diverse — ma il bot ha il diritto di sapere che quella chat
 * l'ha già avuta, e con che esito. È l'unica cosa che sblocca i ~60 lead che
 * gli risultano fermi in NEW mentre lui li aveva già lavorati.
 *
 * Best-effort: se la query fallisce il push parte comunque senza storico.
 */
export async function previousLeadsFor(leadId: string, phone: string | null, companyId: string) {
    const key = personKeyOf(phone);
    if (!key) return { personKey: undefined, previousLeadIds: undefined };
    try {
        const rows = await db.select({
            leadId: leads.id,
            status: leads.status,
            outcome: leads.discardReason,
            createdAt: leads.createdAt,
        })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                ne(leads.id, leadId),
                sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10) = ${key}`,
            ))
            .orderBy(desc(leads.createdAt))
            .limit(10);
        return {
            personKey: key,
            previousLeadIds: rows.map(r => ({
                leadId: r.leadId,
                status: r.status,
                outcome: r.outcome,
                createdAt: r.createdAt.toISOString(),
            })),
        };
    } catch (e) {
        console.error('[bot-fissatore] previousLeadsFor failed', e);
        return { personKey: key, previousLeadIds: undefined };
    }
}
```

- [ ] **Step 4: Arricchisci il payload prima di firmarlo**

Dentro `pushLeadToBot`, subito dopo il controllo di `url`/`secret` e **prima** di `const rawBody = JSON.stringify(payload);`:

```ts
    // Lo storico si calcola qui e non nel chiamante: così ogni percorso di push
    // (webhook AC, backfill, riassegnazione) lo porta senza doverselo ricordare.
    const enriched: BotIntakePayload = payload.personKey
        ? payload
        : { ...payload, ...(await previousLeadsFor(payload.leadId, payload.phone, payload.companyId)) };
```

e usa `enriched` al posto di `payload` nelle due righe successive (`JSON.stringify` e le chiamate ad `auditPush`).

- [ ] **Step 5: Verifica che compili e builda**

Run: `npx tsc --noEmit && npm run build`
Expected: nessun errore.

- [ ] **Step 6: Verifica che l'indice venga usato**

Con il tool MCP Supabase esegui:

```sql
EXPLAIN ANALYZE
SELECT id FROM leads
WHERE "companyId" = 'fenice'
  AND right(regexp_replace(phone, '\D', '', 'g'), 10) = '3331234567'
LIMIT 10;
```

Expected: il piano usa `leads_company_phonekey_idx`, non un `Seq Scan`. Se fa Seq Scan, l'espressione dell'indice non combacia con quella della query: allineale carattere per carattere.

- [ ] **Step 7: Commit**

```bash
git add src/lib/bot-fissatore/types.ts src/lib/bot-fissatore/push.ts src/app/actions/pipelineActions.ts
git commit -F - <<'EOF'
feat(bot): chiave persona e storico dei lead precedenti nel push

Il fornitore deduplica per numero e non puo' fare altrimenti: una persona
ha una chat sola. Noi creiamo un lead nuovo a ogni rientro, e cosi' ~60
lead gli risultano fermi in NEW mentre lui li aveva gia' lavorati sotto
il leadId precedente.

Il merge retroattivo e' escluso: 1.708 gruppi toccano presenze e
fatturato, 5.251 l'attribuzione GDO. Gli diamo invece la chiave e lo
storico, e decide lui. Il contratto degli esiti resta identico.

Il detector duplicati passa da 9 a 10 cifre: a nove fondeva 134 gruppi di
numeri realmente diversi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 13: Finestra di dedup a 24 ore

**Files:**
- Modify: `src/app/api/webhooks/activecampaign/route.ts:523`

- [ ] **Step 1: Allarga la finestra**

Sostituisci la riga `const dedupCutoff = new Date(now.getTime() - 10 * 60 * 1000);` con:

```ts
        // 24 ore e non 10 minuti: le ricomparse entro un giorno sono doppi
        // submit veri (439 misurate), non persone che rientrano. Oltre, chi
        // rientra È un lead nuovo e va richiamato — la mediana fra una
        // comparsa e l'altra è di 10,8 giorni.
        // Vale solo per questo flusso: i pool database e Black Summer
        // duplicano di proposito (decisione PO 20/07) e non passano di qui.
        const dedupCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
```

- [ ] **Step 2: Verifica che compili**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Verifica il costo della query**

La dedup usa `createdAt >= dedupCutoff` su `leads_company_created_idx`. Con il tool MCP Supabase:

```sql
EXPLAIN ANALYZE
SELECT id, "assignedToId" FROM leads
WHERE "companyId" = 'fenice'
  AND "createdAt" >= now() - interval '24 hours'
  AND ("acContactId" = 'x' OR phone = '3331234567')
ORDER BY "createdAt" DESC LIMIT 1;
```

Expected: index scan, tempi sotto i 10ms. Se il piano peggiora sensibilmente, riportare la finestra a 6 ore e annotarlo nel commit.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/activecampaign/route.ts
git commit -F - <<'EOF'
fix(intake): finestra di dedup AC da 10 minuti a 24 ore

Le ricomparse entro un giorno sono doppi submit veri, 439 misurate. Oltre,
chi rientra E' un lead nuovo e va richiamato: la mediana fra una comparsa
e l'altra e' di 10,8 giorni. I pool duplicano di proposito e non passano
da qui.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017ET4VWeAXPLeQgF1Y2D7PK
EOF
```

---

### Task 14: Verifica finale e deploy

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: tutti i test passano, inclusi i nuovi di Task 1 e Task 3.

- [ ] **Step 2: Type-check e build**

Run: `npx tsc --noEmit && npm run build`
Expected: nessun errore, nessun warning catastrofico.

- [ ] **Step 3: Verifica le env su Vercel**

Run: `vercel env ls production`
Expected: `BOT_WEBHOOK_SECRET` presente (riusato, non nuovo). `BOT_CALL_ATTEMPT` e `CALL_ATTEMPT_BOT_URL` **non** devono esistere: il primo è un kill-switch che agisce solo se vale `off`, il secondo ha un default nel codice. Se `BOT_CALL_ATTEMPT` esiste con valore `off`, il recupero NR resta spento — verificare che sia voluto.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Verifica il deploy**

Run: `vercel ls --prod` (oppure controlla il progetto su Vercel)
Expected: ultimo deploy in stato READY.

- [ ] **Step 6: Fumo in produzione**

Con il tool MCP Supabase, dopo che una Conferma ha registrato almeno un NR:

```sql
SELECT metadata FROM "leadEvents"
WHERE "eventType" = 'BOT_CALL_ATTEMPT'
ORDER BY timestamp DESC LIMIT 5;
```

Expected: righe con `tentativo`, `inviato`, `ramo`, `motivo`. Se `inviato` è sempre `false` con `motivo` che parla di firma o di 401, il `BOT_WEBHOOK_SECRET` è disallineato col fornitore.

---

## Cosa questo piano NON fa

- **Nessun merge retroattivo dei duplicati.** Task 12 dà al bot la chiave e lo storico; i lead restano separati.
- **Nessuna riapertura automatica di uno scarto 3NR.** Decisione PO del 29/08: se il lead risponde, la richiesta arriva in corsia Conferme (Task 7-8) e sono loro a riaprire con «Annulla NR».
- **Nessuno scarto automatico dei telefoni sospetti.** Task 10 li mette in quarantena, non li butta.
- **Punto 7 della richiesta del fornitore (i dieci esiti rifiutati)** non è implementabile: serve la loro lista di `leadId`. Va chiesta nel messaggio di risposta.
- **La bonifica dei 7 lead del 24/08** non è in questo piano: dipende dall'esito della verifica avversaria e comunque è un'operazione manuale sui dati, non codice.
