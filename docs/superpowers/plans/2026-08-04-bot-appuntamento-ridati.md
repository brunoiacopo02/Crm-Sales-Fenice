# Appuntamenti sui lead ridati e contatto umano — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Non perdere più un appuntamento perché il bot lo fissa su un lead che aveva restituito, e far arrivare agli admin i lead che chiedono di parlare con una persona.

**Architecture:** Tutto dentro `POST /api/bot/outcome`. Il controllo di autorizzazione sui lead non assegnati al bot smette di essere un sì/no per esito e diventa un controllo di *provenienza*: quel lead è mai stato del bot? Da lì `APPUNTAMENTO` viene accettato riprendendo il lead, e il nuovo `CONTATTO_UMANO` non tocca il lead ma avvisa gli admin.

**Tech Stack:** Next.js 16 route handler, Drizzle su Supabase Postgres, tabelle `leads`, `leadEvents`, `notifications`, `users`.

**Spec:** [`docs/superpowers/specs/2026-08-04-bot-appuntamento-ridati-e-contatto-umano-design.md`](../specs/2026-08-04-bot-appuntamento-ridati-e-contatto-umano-design.md)

## Global Constraints

- Branch di lavoro: `feat/bot-appuntamento-ridati` (già creato da `main`).
- **Nessuna migrazione DB.** Nessuna tabella e nessuna colonna nuova.
- **Il contratto verso il fornitore cresce, non cambia.** `CONTATTO_UMANO` è un valore in più di `outcome`; tutti i payload che funzionano oggi devono continuare a funzionare identici.
- Il bot è Fenice-only: `companyId` resta inchiodato a `'fenice'`, come già fa il resto della route.
- **Minimo privilegio.** Il segreto del bot non deve permettere di scrivere su un lead qualsiasi: ogni scrittura su un lead non assegnato al bot esige la prova di provenienza.
- `npx tsc --noEmit` deve uscire 0 e `npm test` restare a 38/38 a fine task.
- Commit in italiano, imperativo, con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` in coda.
- Repo Windows: per i messaggi di commit multilinea usare un heredoc Bash (`git commit -F - <<'EOF' … EOF`); le here-string PowerShell NON funzionano nel tool Bash.

## File Structure

| File | Responsabilità |
|---|---|
| `src/app/api/bot/outcome/route.ts` | Unico file toccato dai task 1 e 2: la prova di provenienza, la ripresa del lead sull'appuntamento, il nuovo esito `CONTATTO_UMANO`. |
| `src/components/Topbar.tsx` | Rende cliccabile la notifica agli admin (task 2). |

Tutto il resto del flusso (`updateLeadOutcome`, handoff Conferme, webhook marketing, call log) viene riusato senza modifiche: è il motivo per cui questo piano è corto.

---

### Task 1: L'appuntamento su un lead ridato viene accettato

**Files:**
- Modify: `src/app/api/bot/outcome/route.ts:101-107` (il blocco `if (!assigneeIsBot)`) e `:231` (la chiamata a `updateLeadOutcome`)

**Interfaces:**
- Consumes: `updateLeadOutcome(leadId, outcome, note, date, userId, discardReason, currentVersion, scriptCompleted, serviceCtx)` da `@/app/actions/pipelineActions`, già importata e già usata in fondo alla route.
- Produces: una costante booleana `leadWasBotOwned` calcolata nella route, che il Task 2 riusa per `CONTATTO_UMANO`.

- [ ] **Step 1: Sostituire il blocco di autorizzazione**

Il blocco attuale è:

```ts
    if (!assigneeIsBot) {
        if (typedOutcome !== 'NOTA') {
            return NextResponse.json({ error: 'forbidden', detail: 'lead non assegnato a un account bot' }, { status: 403 });
        }
        if (lead.agendaStatus !== 'consegnato' && lead.agendaStatus !== 'inviato') {
            return NextResponse.json({ error: 'forbidden', detail: 'nessuna agenda inviata dal bot per questo lead' }, { status: 403 });
        }
    }
```

Va sostituito con:

```ts
    // Su un lead non assegnato al bot serve la prova che quel lead sia stato
    // suo: il segreto è fidato per operare sui lead del bot, non deve diventare
    // il permesso di scrivere su qualunque riga della tabella. Prova = il push
    // al bot è avvenuto, oppure un'agenda è uscita dal suo canale.
    let leadWasBotOwned = assigneeIsBot;
    if (!assigneeIsBot) {
        const [pushed] = await db.select({ id: leadEvents.id })
            .from(leadEvents)
            .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.eventType, 'BOT_PUSHED')))
            .limit(1);
        leadWasBotOwned = !!pushed
            || lead.agendaStatus === 'consegnato'
            || lead.agendaStatus === 'inviato';

        if (!leadWasBotOwned) {
            return NextResponse.json({ error: 'forbidden', detail: 'lead mai passato dal bot' }, { status: 403 });
        }
        // Il lead è di un GDO umano. NOTA annota e basta. APPUNTAMENTO viene
        // accettato e il lead torna al bot (vedi sotto): un appuntamento fissato
        // è troppo caro per buttarlo via. Tutto il resto no — uno scarto o un
        // richiamo dal bot sovrascriverebbe il lavoro di chi ce l'ha in mano.
        if (typedOutcome !== 'NOTA' && typedOutcome !== 'APPUNTAMENTO') {
            return NextResponse.json({ error: 'forbidden', detail: 'lead non assegnato a un account bot' }, { status: 403 });
        }
    }
```

- [ ] **Step 2: Riprendere il lead prima di registrare l'appuntamento**

Subito **prima** della chiamata a `updateLeadOutcome` (che oggi sta a riga 231, dopo il blocco `NON_RISPOSTO`/`INTERROTTO`), inserisci:

```ts
    // Appuntamento su un lead che il bot ci aveva restituito: lo riprende.
    // La riassegnazione va PRIMA di updateLeadOutcome, così l'appuntamento è
    // attribuito al bot — che è già escluso dai KPI per GDO — e non al GDO che
    // non l'ha fissato. Il GDO che lo perde viene avvisato: un lead che sparisce
    // dalla pipeline senza spiegazione è un reclamo che abbiamo già inseguito.
    if (typedOutcome === 'APPUNTAMENTO' && !assigneeIsBot) {
        const previousOwnerId = lead.assignedToId;

        await db.update(leads)
            .set({ assignedToId: actorUserId })
            .where(eq(leads.id, leadId));

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'REASSIGNED_TO_BOT',
            userId: actorUserId,
            timestamp: new Date(),
            metadata: { fromUserId: previousOwnerId, reason: 'appuntamento_dal_bot' },
            companyId: 'fenice',
        }).catch((e) => console.error('[bot-fissatore] REASSIGNED_TO_BOT event err', e));

        if (previousOwnerId) {
            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: previousOwnerId,
                type: 'bot_took_lead',
                title: '🤖 Il Fissatore ha fissato questo lead',
                body: `${lead.name}: il bot ha chiuso l'appuntamento in chat, quindi il lead è tornato a lui.`,
                metadata: { leadId },
                status: 'unread',
                createdAt: new Date(),
                companyId: 'fenice',
            }).catch((e) => console.error('[bot-fissatore] bot_took_lead notify err', e));
        }
    }
```

Nota: `actorUserId` è già l'id dell'account bot in questo ramo — quando `assigneeIsBot` è falso la route lo risolve cercando l'account `isBot` di Fenice. Non ricalcolarlo.

- [ ] **Step 3: Verificare gli import**

La route importa già `leads, users, leadEvents, notifications` da `@/db/schema` e `and, desc, eq, gte` da `drizzle-orm`. Verifica che sia ancora così dopo le modifiche e aggiungi solo ciò che manca davvero.

```bash
npx tsc --noEmit
```

Atteso: exit 0.

- [ ] **Step 4: Test**

```bash
npm test
```

Atteso: 38/38.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/bot/outcome/route.ts
git commit -m "feat(bot): accetta l'appuntamento sui lead che il bot aveva ridato"
```

---

### Task 2: `CONTATTO_UMANO` arriva agli admin

**Files:**
- Modify: `src/app/api/bot/outcome/route.ts:16` (lista esiti) e il corpo della `POST`
- Modify: `src/components/Topbar.tsx` (`handleNotifClick`)

**Interfaces:**
- Consumes: `leadWasBotOwned` e il blocco di autorizzazione del Task 1.
- Produces: notifiche di tipo `bot_contatto_umano` con `metadata: { leadId }`.

- [ ] **Step 1: Aggiungere l'esito alla lista**

```ts
const VALID_OUTCOMES = ['APPUNTAMENTO', 'DA_SCARTARE', 'RICHIAMO', 'NON_RISPOSTO', 'INTERROTTO', 'NOTA', 'CONTATTO_UMANO'] as const;
```

Aggiorna anche il commento sopra la costante aggiungendo una riga:

```ts
// CONTATTO_UMANO: il lead ha chiesto di parlare con una persona. Segnalazione
// agli admin, nessuna transizione di stato: decide un umano a chi darla.
```

- [ ] **Step 2: Permettere l'esito sui lead non del bot**

Nel blocco di autorizzazione scritto nel Task 1, la riga che rifiuta gli altri esiti va estesa a `CONTATTO_UMANO`, che come `NOTA` non modifica il lead:

```ts
        if (typedOutcome !== 'NOTA' && typedOutcome !== 'APPUNTAMENTO' && typedOutcome !== 'CONTATTO_UMANO') {
            return NextResponse.json({ error: 'forbidden', detail: 'lead non assegnato a un account bot' }, { status: 403 });
        }
```

- [ ] **Step 3: Gestire l'esito**

Subito **dopo** il blocco `if (typedOutcome === 'NOTA') { … }` e prima del blocco `NON_RISPOSTO`/`INTERROTTO`, inserisci:

```ts
    // Il lead ha chiesto di parlare con una persona. Non è una transizione di
    // stato: il lead resta dov'è ed è un admin a decidere a chi darlo. Va agli
    // admin e non al GDO assegnato per decisione del PO — su un lead ridato il
    // GDO potrebbe non essere quello giusto a cui affidarlo.
    if (typedOutcome === 'CONTATTO_UMANO') {
        const text = (note ?? '').trim();
        if (!text) {
            return NextResponse.json({ error: 'bad_request', detail: 'note richiesta per esito CONTATTO_UMANO' }, { status: 400 });
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'BOT_CONTACT_REQUEST',
            userId: actorUserId,
            timestamp: new Date(),
            metadata: { note: text },
            companyId: 'fenice',
        });

        const admins = await db.select({ id: users.id }).from(users).where(and(
            eq(users.companyId, 'fenice'),
            eq(users.role, 'ADMIN'),
            eq(users.isActive, true),
        ));
        if (admins.length > 0) {
            const now = new Date();
            await db.insert(notifications).values(admins.map(a => ({
                id: crypto.randomUUID(),
                recipientUserId: a.id,
                type: 'bot_contatto_umano',
                title: '☎️ Il lead vuole essere richiamato',
                body: `${lead.name}: ${text.length > 200 ? text.slice(0, 200) + '…' : text}`,
                metadata: { leadId },
                status: 'unread',
                createdAt: now,
                companyId: 'fenice',
            }))).catch((e) => console.error('[bot-fissatore] CONTATTO_UMANO notify err', e));
        }

        return NextResponse.json({ ok: true, noted: true });
    }
```

- [ ] **Step 4: Rendere cliccabile la notifica**

In `Topbar.tsx`, dentro `handleNotifClick`, il ramo che apre la scheda del lead elenca oggi `appointment_confirmed`, `sales_outcome_set` e `appointment_assigned`. Aggiungi i due tipi nuovi allo stesso ramo — gli admin lavorano dalla ricerca, non dalla board Conferme, quindi il `ContactDrawer` è il posto giusto:

```tsx
        } else if (notif.type === 'appointment_confirmed' || notif.type === 'sales_outcome_set' || notif.type === 'appointment_assigned' || notif.type === 'bot_contatto_umano' || notif.type === 'bot_took_lead') {
```

Non toccare il ramo `bot_note`, che porta alla board Conferme: quello è per le Conferme, questi sono per admin e GDO.

- [ ] **Step 5: Verifiche**

```bash
npx tsc --noEmit
npm test
```

Attesi: exit 0 e 38/38.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/bot/outcome/route.ts src/components/Topbar.tsx
git commit -m "feat(bot): le richieste di contatto umano arrivano agli admin"
```

---

### Task 3: Build e prova end-to-end

**Files:** nessuna modifica prevista.

- [ ] **Step 1: Build**

```bash
npm run build
```

Atteso: build completata. È il controllo che `tsc` non fa.

- [ ] **Step 2: Prova live**

Questo step è del controller, non di un subagent: richiede il database di produzione e lead creati e cancellati a mano. Chi implementa lo salti.

Casi da coprire (dalla Verifica della spec): appuntamento su lead ridato accettato con notifica e riassegnazione, lead mai passato dal bot rifiutato, altri esiti ancora `403`, lead già del bot invariato, `CONTATTO_UMANO` con e senza nota.

---

## Note per chi implementa

- **La route è già lunga.** Non riorganizzarla: i blocchi per esito sono in fila e questo piano ne aggiunge uno nella stessa forma degli altri. Un refactor qui renderebbe il diff illeggibile in review.
- **`updateLeadOutcome` non si tocca.** Tutta l'attribuzione, l'handoff alle Conferme e i webhook derivano da `leads.assignedToId` al momento in cui viene chiamata: per questo la riassegnazione va prima, e non serve altro.
- **La guardia di idempotenza esistente resta prima di tutto.** Il bot ri-manda `APPUNTAMENTO` ogni ora sui lead già appuntati; quel `return { deduped: true }` è a monte e non va spostato dopo le modifiche.
