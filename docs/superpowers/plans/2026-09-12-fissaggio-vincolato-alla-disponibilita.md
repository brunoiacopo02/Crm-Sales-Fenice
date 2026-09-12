# Fissaggio vincolato alla disponibilità — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le Conferme possono fissare un appuntamento a un venditore solo su un'ora che lui ha dichiarato e non ha bloccato; possono forzare scrivendo un motivo, che resta tracciato.

**Architecture:** Una funzione pura decide (`calendarBooking.ts`), tre server action delle Conferme la consultano e accettano un `forceReason`, quattro superfici UI mostrano il campo motivo quando serve, e una scheda nuova in supervisione elenca le forzature. In parallelo si rimuove la lettura degli impegni Google, che non deve più essere una ragione per non fissare.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM su Supabase Postgres, Tailwind v4, test con `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md` — **va aggiornata da questo piano** (Task 2): la decisione "Avviso, non blocco" è stata ribaltata dal PO il 2026-09-12.

## Global Constraints

- **Chi è soggetto al muro: solo il ruolo `CONFERME`.** `ADMIN` e `MANAGER` fissano senza controlli. Il TL Conferme ha un account `CONFERME` ed è quindi soggetto: è voluto.
- **La forzatura richiede un motivo non vuoto.** Senza, l'azione non scrive nulla e torna `needsForce: true`.
- **Fuori griglia = non disponibile.** Un appuntamento prima delle 9, dopo le 21 o di domenica non ha uno slot dichiarabile: richiede sempre una forzatura.
- **Gli appuntamenti già fissati non si toccano**: il vincolo vale sulle assegnazioni nuove e sui cambi di data, mai a ritroso.
- **La creazione degli eventi su Google Calendar resta intatta** (`confermeActions.ts` ~684 e ~1365): si rimuove solo la *lettura* dei busy (`getBusySlotsForUser`). L'appuntamento deve continuare ad arrivare sul calendario del venditore.
- **Una forzatura non può generare multa**: nessun codice nuovo serve: si forza solo su slot non dichiarato o bloccato, e `absenceReportCheck` rifiuta già in entrambi i casi. Non indebolire quel controllo.
- **Regola React del progetto (CLAUDE.md §4.1)**: i bottoni non possono MAI essere figli di `<span>` o `<p>`. Produce white screen in produzione.
- **Nessun `window.confirm`/`alert`/`prompt`**: il campo motivo è inline.
- **Fuso orario**: solo gli helper di `calendarSlots.ts`/`dateUtils.ts`.
- **Multi-tenant**: `currentTenant()` + `assertSalesArea(ctx)`; le tabelle del calendario (`salesAvailabilitySlots`, `salesSlotBlocks`) sono **per-utente, non per-azienda** — non aggiungere filtri `companyId` su quelle.
- **Test**: ogni `*.test.ts` nuovo va aggiunto allo script `test` in `package.json`.

---

## File Structure

**Nuovi:**
- `src/lib/venditore/calendarBooking.ts` — la regola pura e i suoi messaggi.
- `src/lib/venditore/calendarBooking.test.ts`

**Modificati:**
- `src/app/actions/confermeActions.ts` — le tre action, la rimozione dei busy da `getVenditoriAgenda`, l'elenco delle forzature.
- `src/app/actions/salesCalendarAdminActions.ts` — lettura delle forzature per la supervisione.
- `src/components/ConfermeDrawer.tsx`, `ConfermeBoard.tsx`, `ConfermeBoardRow.tsx`, `VenditoriAgendaModal.tsx` — il campo motivo e la rimozione dei busy.
- `src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx` — la scheda "Forzature".
- `docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md`
- `package.json`

---

### Task 1: La regola del fissaggio

**Files:**
- Create: `src/lib/venditore/calendarBooking.ts`
- Test: `src/lib/venditore/calendarBooking.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `slotStartFor`, `slotLabel` da `./calendarSlots`
- Produces:
  - `type BookingRefusal = 'fuori_griglia' | 'non_dichiarato' | 'bloccato'`
  - `type BookingDecision = { ok: true } | { ok: false; reason: BookingRefusal }`
  - `bookingCheck(input: { slot: Date | null; declared: boolean; blocked: boolean }): BookingDecision`
  - `bookingRefusalMessage(reason: BookingRefusal, appointmentAt: Date): string`

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `src/lib/venditore/calendarBooking.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookingCheck, bookingRefusalMessage } from './calendarBooking'
import { slotStartFor } from './calendarSlots'

const SLOT = slotStartFor(new Date('2026-09-16T15:00:00+02:00'))

test('si fissa su uno slot dichiarato e non bloccato', () => {
    assert.deepEqual(bookingCheck({ slot: SLOT, declared: true, blocked: false }), { ok: true })
})

test('non si fissa su uno slot mai dichiarato', () => {
    const d = bookingCheck({ slot: SLOT, declared: false, blocked: false })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'non_dichiarato')
})

test('non si fissa su uno slot bloccato, nemmeno se dichiarato', () => {
    const d = bookingCheck({ slot: SLOT, declared: true, blocked: true })
    assert.equal(d.ok, false)
    assert.equal(d.ok === false && d.reason, 'bloccato')
})

test('un orario fuori griglia non e mai disponibile', () => {
    // slotStartFor torna null per le 22, per le 8 e per la domenica.
    for (const fuori of ['2026-09-16T22:00:00+02:00', '2026-09-16T08:00:00+02:00', '2026-09-20T15:00:00+02:00']) {
        const d = bookingCheck({ slot: slotStartFor(new Date(fuori)), declared: true, blocked: false })
        assert.equal(d.ok, false, fuori)
        assert.equal(d.ok === false && d.reason, 'fuori_griglia', fuori)
    }
})

test('i messaggi dicono l ora e sono leggibili da una Conferma', () => {
    const at = new Date('2026-09-16T15:00:00+02:00')
    assert.match(bookingRefusalMessage('non_dichiarato', at), /15:00/)
    assert.match(bookingRefusalMessage('bloccato', at), /15:00/)
    assert.ok(bookingRefusalMessage('fuori_griglia', at).length > 20)
})
```

- [ ] **Step 2: Verificare che il test fallisca**

Run: `node --import tsx --test src/lib/venditore/calendarBooking.test.ts`
Expected: FAIL — `Cannot find module './calendarBooking'`

- [ ] **Step 3: Implementare il modulo**

```ts
/**
 * Regola del fissaggio: una Conferma può dare un appuntamento a un venditore
 * solo su un'ora che lui ha dichiarato e non ha bloccato.
 *
 * Decisione PO 2026-09-12, che ribalta il precedente "avviso, non blocco":
 * il muro c'è, ma la Conferma può scavalcarlo scrivendo un motivo, che resta
 * tracciato. Admin e manager non sono soggetti.
 *
 * Pura: riceve fatti già letti, non tocca il DB.
 */

import { slotLabel } from './calendarSlots'

export type BookingRefusal = 'fuori_griglia' | 'non_dichiarato' | 'bloccato'

export type BookingDecision = { ok: true } | { ok: false; reason: BookingRefusal }

/**
 * `slot` è il risultato di `slotStartFor(appointmentDate)`: null significa
 * che quell'ora non esiste nella griglia (prima delle 9, dopo le 21, domenica)
 * e quindi nessuno può averla dichiarata.
 */
export function bookingCheck(input: {
    slot: Date | null
    declared: boolean
    blocked: boolean
}): BookingDecision {
    if (!input.slot) return { ok: false, reason: 'fuori_griglia' }
    if (!input.declared) return { ok: false, reason: 'non_dichiarato' }
    if (input.blocked) return { ok: false, reason: 'bloccato' }
    return { ok: true }
}

/** Messaggi scritti per la Conferma che li legge, non per chi legge i log. */
export function bookingRefusalMessage(reason: BookingRefusal, appointmentAt: Date): string {
    const ora = slotLabel(appointmentAt)
    switch (reason) {
        case 'fuori_griglia':
            return "Quest'ora è fuori dal calendario dei venditori (si dichiara dalle 9 alle 21, da lunedì a sabato): nessuno può averla resa disponibile."
        case 'non_dichiarato':
            return `Il venditore non ha dichiarato disponibile le ${ora}.`
        case 'bloccato':
            return `Il venditore ha bloccato le ${ora}.`
    }
}
```

Nota: `slotLabel` legge l'ora dall'istante ricevuto, quindi su un orario fuori griglia stampa comunque l'ora vera — ma quel ramo non la usa.

- [ ] **Step 4: Verificare che i test passino**

Run: `node --import tsx --test src/lib/venditore/calendarBooking.test.ts`
Expected: PASS, 5 test.

- [ ] **Step 5: Registrare il test e girare la suite**

Aggiungere ` src/lib/venditore/calendarBooking.test.ts` allo script `test` di `package.json`.
Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/venditore/calendarBooking.ts src/lib/venditore/calendarBooking.test.ts package.json
git commit -m "feat(fissaggio): la regola che lega l'appuntamento alla disponibilità dichiarata"
```

---

### Task 2: Le tre server action delle Conferme

**Files:**
- Modify: `src/app/actions/confermeActions.ts`
- Modify: `docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md`

**Interfaces:**
- Consumes: `bookingCheck`, `bookingRefusalMessage` (Task 1); `slotStartFor` da `calendarSlots`
- Produces:
  - un helper interno `async function checkBookingAllowed(salesUserId, appointmentAt, role): Promise<BookingDecision>` che legge i fatti e chiama la regola (ritorna sempre `{ ok: true }` se il ruolo non è `CONFERME`)
  - `setConfermeOutcome(..., forceReason?: string)`
  - `updateLeadDataConferme(leadId, currentVersion, data, forceReason?: string)`
  - `scheduleConfermeRecall(leadId, currentVersion, payload, forceReason?: string)`
  - tutte e tre, sul rifiuto, tornano `{ success: false, error: <messaggio>, needsForce: true }`

- [ ] **Step 1: Scrivere l'helper**

In `confermeActions.ts`, sopra le tre action:

```ts
/**
 * Il muro del fissaggio. Solo le Conferme ci sbattono contro: admin e manager
 * fissano dove vogliono (decisione PO 2026-09-12).
 *
 * Le tabelle del calendario sono per-utente e non per-azienda: nessun filtro
 * companyId qui, sarebbe un bug su Serenamente.
 */
async function checkBookingAllowed(
    salesUserId: string | null | undefined,
    appointmentAt: Date | null | undefined,
    role: string | undefined,
): Promise<BookingDecision> {
    if (role !== 'CONFERME') return { ok: true }
    if (!salesUserId || !appointmentAt) return { ok: true }

    const slot = slotStartFor(new Date(appointmentAt))
    if (!slot) return { ok: false, reason: 'fuori_griglia' }

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

    return bookingCheck({ slot, declared: !!declared, blocked: !!blocked })
}
```

- [ ] **Step 2: Innestare nelle tre action**

In ciascuna, **prima di qualunque scrittura**, subito dopo che sono noti il venditore e la data:

- `setConfermeOutcome`: solo quando `outcome === 'confermato'` e c'è un `salespersonAssigned`; la data è `oldLead.appointmentDate`.
- `updateLeadDataConferme`: venditore = `oldLead.salespersonUserId`, data = `data.appointmentDate`.
- `scheduleConfermeRecall`: venditore = `oldLead.salespersonUserId`, data = `payload.newAppointmentDate` (solo se valorizzata).

Lo schema in tutte e tre:

```ts
    const gate = await checkBookingAllowed(<venditore>, <data>, role)
    if (!gate.ok) {
        const motivo = forceReason?.trim()
        if (!motivo) {
            return {
                success: false,
                error: bookingRefusalMessage(gate.reason, new Date(<data>)),
                needsForce: true,
            }
        }
        forcedBooking = { reason: gate.reason, motivo }
    }
```

dove `forcedBooking` è una variabile locale usata nello step 3. Il tipo di ritorno dichiarato di ciascuna action va esteso con `needsForce?: boolean`.

Attenzione: `setConfermeOutcome` legge il ruolo dalla sessione Supabase; le altre due potrebbero non farlo — leggerlo dove manca, con lo stesso pattern già usato nel file.

- [ ] **Step 3: Registrare la forzatura**

Quando `forcedBooking` è valorizzato, dopo la scrittura andata a buon fine, nello stesso punto dove l'action già inserisce i suoi `leadEvents`:

```ts
    if (forcedBooking) {
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'appointment_forced',
            userId: session.user.id,
            timestamp: new Date(),
            metadata: {
                salesUserId: <venditore>,
                appointmentAt: <data>,
                reason: forcedBooking.reason,
                motivo: forcedBooking.motivo,
            },
            companyId: ctx.companyId,
        })
    }
```

- [ ] **Step 4: Aggiornare la spec**

Nel documento di spec:
- nella tabella §2, la riga "Vincolo sulle Conferme" passa da *"Avviso, non blocco"* a *"Blocco con forzatura motivata (decisione PO 2026-09-12, ribalta la scelta iniziale). Admin e manager esenti."*;
- in §4.7 e §6.3, dove si dice che le Conferme possono fissare fuori disponibilità, aggiungere che da oggi serve una forzatura motivata, e che uno slot forzato continua a non poter generare multa.

Non riscrivere il resto del documento: aggiungi e correggi solo dove il fatto è cambiato, lasciando leggibile che c'è stato un ripensamento e quando.

- [ ] **Step 5: Verificare**

Run: `npx tsc --noEmit && npm test`
Expected: zero errori, suite verde.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/confermeActions.ts docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md
git commit -m "feat(fissaggio): le Conferme fissano solo su ore dichiarate, o forzano con motivo"
```

---

### Task 3: Via la lettura degli impegni Google

**Files:**
- Modify: `src/app/actions/confermeActions.ts` (`getVenditoriAgenda`)
- Modify: `src/components/VenditoriAgendaModal.tsx`

- [ ] **Step 1: Togliere i busy dalla action**

In `getVenditoriAgenda`: rimuovere la chiamata a `getBusySlotsForUser`, i campi `busySlots` e `hasGoogleCalendar` dal tipo di ritorno e dalla costruzione della risposta, e la logica che filtrava i busy coincidenti con gli appuntamenti CRM. Rimuovere gli import diventati inutilizzati (`getBusySlotsForUser`, e `hasCalendarConnection` se non serve altrove nel file — **verificare**).

**Non toccare** `createGoogleCalendarEvent` e `deleteGoogleCalendarEvent`: l'appuntamento deve continuare ad arrivare sul calendario del venditore.

- [ ] **Step 2: Togliere i busy dal modale**

In `VenditoriAgendaModal.tsx`: rimuovere il tipo `BusySlot`, i campi dal tipo `Venditore`, la pastiglia "GCal · libero / N impegni ext" (righe ~320-322) e il filtro dei busy per giornata (~332). Rimuovere dalla legenda la voce relativa, se c'è.

- [ ] **Step 3: Verificare**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: tutto pulito. Se `tsc` segnala un import inutilizzato o un campo rimasto, è parte di questo task.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/confermeActions.ts src/components/VenditoriAgendaModal.tsx
git commit -m "feat(fissaggio): l'agenda non mostra più gli impegni esterni di Google"
```

---

### Task 4: Il campo motivo nelle quattro superfici

**Files:**
- Modify: `src/components/ConfermeDrawer.tsx`, `ConfermeBoard.tsx`, `ConfermeBoardRow.tsx`, `VenditoriAgendaModal.tsx`

- [ ] **Step 1: Rendere il rifiuto visibile e recuperabile**

In ogni punto che chiama una delle tre action, quando la risposta ha `needsForce: true`:

1. mostrare il messaggio d'errore **per intero** (arriva già scritto per l'utente: non riassumerlo);
2. mostrare sotto un campo di testo "Motivo" e un bottone **"Fissa comunque"**;
3. alla pressione, richiamare la stessa action con `forceReason` valorizzato;
4. il bottone resta disabilitato finché il motivo è vuoto.

Regole del progetto: nessun `window.confirm`, e nessun bottone figlio di `<span>`/`<p>` (usare `<div>`).

Se una delle quattro superfici non chiama direttamente l'action ma passa da un handler condiviso, innestare lì una volta sola invece di quattro: **dirlo nel report**.

- [ ] **Step 2: Verificare**

Run: `npx tsc --noEmit && npm run build`
Expected: pulito.

- [ ] **Step 3: Commit**

```bash
git add src/components
git commit -m "feat(fissaggio): campo motivo e \"Fissa comunque\" dove si fissa un appuntamento"
```

---

### Task 5: La scheda "Forzature" in supervisione

**Files:**
- Modify: `src/app/actions/salesCalendarAdminActions.ts`
- Modify: `src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx`

**Interfaces:**
- Produces: `getForcedBookings(monthKey?: string): Promise<Array<{ id, at, leadId, leadName, salesName, confermaName, appointmentAt, reason, motivo }>>`

- [ ] **Step 1: Leggere le forzature**

In `salesCalendarAdminActions.ts`, una funzione nuova che legge da `leadEvents` le righe con `eventType = 'appointment_forced'` del mese richiesto (default: mese corrente), filtrate per `companyId`, con `leftJoin` su `leads` per il nome del lead e su `users` per il nome di chi ha forzato. Il nome del venditore si ricava da `metadata.salesUserId`.

Autorizzazione: la stessa `requireCalendarSupervisor` già presente nel file. La scheda è visibile anche alle Conferme — sono loro a produrre le forzature e vederle scoraggia l'abuso.

- [ ] **Step 2: La scheda**

Quarta scheda in `CalendariVenditoriClient.tsx`, accanto a Copertura / Compilazione / Multe. Tabella: Quando · Conferma · Lead · Venditore · Ora dell'appuntamento · Motivo del rifiuto · Motivo scritto. Selettore mese come nella scheda Multe. Stato vuoto: "Nessuna forzatura questo mese."

I bottoni delle schede sono dentro un `<div>`, non un `<span>`.

- [ ] **Step 3: Verificare**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: pulito.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/salesCalendarAdminActions.ts "src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx"
git commit -m "feat(fissaggio): la supervisione elenca le forzature del mese"
```

---

### Task 6: Verifica finale

- [ ] **Step 1: Suite, tipi, build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tutto verde, zero errori.

- [ ] **Step 2: Controllo che l'integrazione Google sia intatta**

Run: `grep -n "createGoogleCalendarEvent\|deleteGoogleCalendarEvent" src/app/actions/confermeActions.ts`
Expected: le chiamate di creazione e cancellazione sono ancora lì, entrambe. Se sono sparite, il piano è stato eseguito male: l'appuntamento non arriverebbe più sul calendario del venditore.

Run: `grep -rn "getBusySlotsForUser" src/`
Expected: nessuna occorrenza fuori da `src/lib/googleCalendar.ts`.

- [ ] **Step 3: Cosa resta da verificare a mano**

Scrivere nel report l'elenco per il controller: fissaggio su ora dichiarata (passa), su ora non dichiarata (muro + motivo), su ora bloccata (muro), fuori griglia (muro), da account admin (nessun muro), e che l'evento compaia nella scheda Forzature e sul Google Calendar del venditore.

---

## Self-Review

| Requisito | Task |
|---|---|
| Muro su slot non dichiarato o bloccato | 1, 2 |
| Fuori griglia non è mai disponibile | 1, 2 |
| Forzatura con motivo obbligatorio | 2, 4 |
| Solo le Conferme sono soggette | 2 |
| Tracciamento della forzatura | 2, 5 |
| Via gli impegni Google dall'agenda | 3 |
| L'appuntamento arriva sul Google Calendar del venditore | 3 (non regredire), 6 (verifica) |
| Una forzatura non genera multa | nessuno: vale già, non indebolire `absenceReportCheck` |
| Spec aggiornata | 2 |
