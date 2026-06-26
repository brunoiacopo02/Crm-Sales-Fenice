# Scheda Trattativa & Forzatura Venditori — Design

**Data:** 2026-06-26
**Stato:** Approvato in brainstorming, in attesa di review spec → writing-plans
**Autore:** Claude (CRM Fenice)

## 1. Problema

Due falle operative simultanee sui **venditori**:

1. **Non aggiornano gli esiti.** Le lead con appuntamento già passato restano senza `salespersonOutcome`: i dati di chiusura non esistono.
2. **Non fanno il sondaggio** qualità lead — e oggi i venditori **non entrano proprio nel CRM**: fanno la trattativa "fuori".

Inoltre il **sondaggio Conferme** è oggi opzionale e fatto di soli flag: non produce nessun briefing utile per il venditore, e le Conferme spesso non lo compilano.

L'obiettivo è un meccanismo che **costringa** strutturalmente entrambi i ruoli a passare dal CRM, chiudendo il loop dato → trattativa → esito.

## 2. Idea centrale: la "Scheda Trattativa"

Un unico oggetto strutturato, compilato dalle **Conferme** al momento dell'handoff, che svolge **tre lavori**:

1. È il **sondaggio Conferme** (qualità lead, gamification invariata).
2. È il **briefing** che il venditore legge nel CRM per fare la trattativa.
3. Essendo accessibile **solo nel CRM**, è il **carrot** che costringe il venditore a entrare.

La Scheda riusa la forma del **report del bot fissatore** (`leads.botReport`: `{summary, painPoints[], budgetSignal, urgency, objections[], levaConsigliata}`), così la stessa UI di briefing normalizza due fonti (bot per lead-bot, Conferme per lead-umane).

### Il loop chiuso

```
CONFERME                          VENDITORE (entra nel CRM per forza)
─────────                         ──────────────────────────────────
Esito appuntamento                1. Lista lead → solo logistica
   │  (sondaggio OBBLIGATORIO)       (nome, indirizzo, ora, telefono)
   ▼                              2. "Inizia trattativa" (check-in)
[Scheda Trattativa]  ───briefing──►   timbra negotiationStartedAt,
 Parte A: diagnosi/qualifica          apre workspace: briefing + script
 Parte B: briefing venditore       3. Fine trattativa → ESITO + SONDAGGIO
   │                                   (gate obbliga, server verifica)
   ▼
salespersonUserId assegnato (solo se confermato)
```

### Tre punti di forzatura, due ruoli

1. **Conferme** — non possono dare esito a un appuntamento senza completare la Scheda. → il venditore ha *sempre* un briefing, e le Conferme fanno *sempre* il sondaggio.
2. **Venditore (entrata)** — il briefing vive solo nel CRM; per vederlo deve entrare e premere "Inizia trattativa".
3. **Venditore (uscita)** — gate bloccante sugli esiti arretrati + server rifiuta l'esito senza check-in e senza sondaggio.

## 3. Sezione A — Gate esiti arretrati (lato venditore)

**Comportamento.** All'apertura di `/venditore`, il server conta le lead "arretrate" del venditore. Se > 0:

- **Overlay a tutto schermo non chiudibile** (no backdrop click, no ESC, no X) sopra la dashboard. Titolo: *"Hai N esiti da registrare prima di continuare"*.
- Lista delle arretrate (nome, telefono, data/ora appuntamento) con pulsante **"Registra esito"** che apre il `VenditoreDrawer` esistente.
- Al salvataggio → `router.refresh()`: la lead esce, il contatore scende. A **0** l'overlay sparisce.

**Definizione "lead arretrata":** assegnata a questo venditore (`salespersonUserId`), `appointmentDate` nel passato oltre **2h di grazia** (`OVERDUE_GRACE_HOURS = 2`, costante in codice), `salespersonOutcome` vuoto. Su **Sparito** serve comunque l'esito (ma niente sondaggio), così i no-show vengono chiusi.

**Scope del blocco:** solo la sezione `/venditore` (Approccio A — choke point sulla dashboard operativa). L'enforcement server chiude comunque il buco anche da altri percorsi.

## 4. Sezione B — Scheda Trattativa (lato Conferme)

### Modello dati

Estendere `confermeLeadSurveys` con i campi-briefing nella stessa forma del `botReport`, mantenendo i flag di qualifica esistenti. La Scheda è divisa logicamente in due parti:

- **Parte A – Diagnosi/qualifica** (per *ogni* esito):
  - `remembersAppt`, `watchedVideo` (esistenti)
  - **`works`** boolean — "lavora / non lavora" (NUOVO, idea TL #3)
  - `confirmed` boolean — la domanda cardine "ha confermato?"
  - motivo (vedi sotto) quando `confirmed = false`
- **Parte B – Briefing venditore** (solo se `confirmed = true`):
  - `summary` text, `painPoints` text[], `urgency` text, `budgetSignal` text, `objections` text[], `levaConsigliata` text

Campi anti-gaming/audit invariati: `fillDurationMs`, `suspicious`, `invalidatedBy`, `invalidatedAt`.

### Flusso obbligatorio (idee TL Conferme integrate)

**Idea #1 — sondaggio obbligatorio anche sullo scarto.** Il sondaggio diventa obbligatorio su **entrambi** gli esiti, fondendo sondaggio e scarto in un unico flusso:
- **Scarto** → richiede solo **Parte A**.
- **Conferma** → richiede **Parte A + Parte B**.

**Idea #2 — "ha confermato?" come bivio con dentro i motivi di scarto.**
- `confirmed = true` → prosegue alla Parte B → conferma + assegna `salespersonUserId`.
- `confirmed = false` → mostra il **set unico di motivi** (fusione dei `whyNot` del sondaggio con i motivi del dialog di scarto attuale in un'unica lista canonica) → il motivo popola direttamente `confirmationsDiscardReason` → scarta.
- Risultato: **niente più dialog di scarto separato** — il sondaggio *è* lo scarto. Zero doppia digitazione.

**Idea #3 — "lavora / non lavora".** Campo `works` in Parte A, mostrato **anche nel briefing** al venditore (incide su budget/pitch).

### Enforcement server

In `setConfermeOutcome` (`confermeActions.ts`):
- esito `confermato` → **rifiuta** se Parte A o Parte B incomplete. **Eccezione:** se la lead ha già `botReport`, il briefing esiste già → le Conferme non devono ricompilarlo da zero (validano/integrano).
- esito `scartato` → **rifiuta** se Parte A incompleta; il motivo di scarto deve provenire dalla Scheda.

Gamification (coin/XP) e anti-gaming `suspicious` restano come oggi.

### Briefing normalizzato (lato venditore)

Una card "Briefing" che legge da una fonte unica normalizzata:
- lead umane → campi-briefing di `confermeLeadSurveys`
- lead-bot → `leads.botReport`
Stessa forma, stessa UI.

## 5. Sezione C — Accesso venditore (gating dell'informazione)

Le trattative sono **solo da remoto** (telefono/video): il venditore non deve raggiungere fisicamente nessuno, quindi **gateiamo tutto** dietro il check-in, **telefono incluso**. Forzatura massima — senza "Inizia trattativa" non ha nemmeno il numero per chiamare.

- **Prima del check-in** (lista `/venditore`): solo l'**indispensabile per sapere qual è il prossimo appuntamento** — nome lead e data/ora appuntamento. **Niente telefono, niente briefing, niente script.**
- **Pulsante "Inizia trattativa"** → timbra `negotiationStartedAt = now` e apre il **workspace trattativa**:
  - scheda lead completa + **telefono** (rivelato solo qui)
  - **briefing** normalizzato (vedi 4)
  - slot **script di vendita** (riusa pattern `ScriptWidget`; contenuto venditore = step successivo)
  - **form esito + sondaggio venditore**
- **Check-in libero ma timbrato** (visibile al manager; nessuna finestra oraria rigida in v1, per non bloccare appuntamenti slittati).

### Nuovo campo

`leads.negotiationStartedAt` timestamp (nullable).

## 6. Sezione D — Enforcement esito venditore

In `saveVenditoreOutcome` (`venditoreActions.ts`), **rifiuta** l'esito se:
1. `negotiationStartedAt` è null (nessun check-in), **oppure**
2. esito ∈ {Chiuso, Non chiuso} con funnel ≠ `database` e manca un sondaggio venditore completato (e non `suspicious`).

**Ordine atomico:** il drawer salva prima il sondaggio venditore (`saveSalesSurvey`), poi chiama `saveVenditoreOutcome` che verifica l'esistenza del sondaggio prima di committare l'esito. Reordering rispetto all'attuale (oggi l'esito si salva prima del sondaggio).

Lato client (`VenditoreDrawer`): il sondaggio inline va mostrato e validato anche per esito **Chiuso** (oggi solo "Non chiuso").

## 7. File coinvolti (mappa)

**Schema** — `src/db/schema.ts`:
- `leads`: aggiungere `negotiationStartedAt`. (`botReport`, `salespersonUserId`, `salespersonOutcome` già esistenti.)
- `confermeLeadSurveys` (righe ~808-828): aggiungere `works`, `summary`, `painPoints`, `urgency`, `budgetSignal`, `objections`, `levaConsigliata`, motivo scarto canonico.

**Server actions:**
- `src/app/actions/confermeActions.ts` — `setConfermeOutcome` (~418-574): enforcement Scheda su conferma/scarto; popolare `confirmationsDiscardReason` dalla Scheda.
- `src/app/actions/surveyActions.ts` — `saveConfermeSurvey` (~288-373): nuovi campi + validazione Parte A/B; `saveSalesSurvey` (~392-452); `getSalesSurveyByLead`.
- `src/app/actions/venditoreActions.ts` — `saveVenditoreOutcome` (~54-165): guardie check-in + sondaggio; nuova action `startNegotiation(leadId)` per il check-in.

**Client:**
- `src/app/(dashboard)/venditore/page.tsx` — query arretrati + render gate.
- nuovo `OutcomeGate` (overlay bloccante).
- `src/components/VenditoreDashboardClient.tsx` — lista pre-check-in (solo logistica) + pulsante "Inizia trattativa".
- nuovo workspace trattativa (briefing + script + esito) oppure estensione `VenditoreDrawer.tsx` (~1-425): sondaggio anche su Chiuso, gating briefing dietro check-in.
- `src/components/surveys/ConfermeSurveyDialog.tsx` (~1-162): Parte A + Parte B, bivio "ha confermato?", motivi unificati.
- `src/components/ConfermeDrawer.tsx`: la Scheda diventa lo step obbligatorio dell'esito (sostituisce il dialog scarto separato).
- card briefing normalizzata (riusa il rendering "🤖 Report Bot", `ConfermeDrawer.tsx` ~723).

**Costanti/lib:**
- `src/lib/surveys/questions.ts`: opzioni nuove (`works`, lista motivi canonica, campi briefing), `EXCLUDED_FUNNEL = 'database'` invariato.
- `OVERDUE_GRACE_HOURS = 2`.

## 8. Edge cases

- **Funnel `database`**: niente sondaggio venditore; il gate richiede solo l'esito.
- **Sparito**: esito obbligatorio, sondaggio no.
- **Lead-bot** (con `botReport`): briefing già presente; Conferme non ricompilano da zero.
- **Appuntamento slittato**: check-in libero, nessuna finestra rigida → non blocca.
- **Sondaggio salvato ma esito rifiutato**: stato non corrotto, il venditore ritenta (sondaggio idempotente su `unique(leadId)`).
- **Performance gate**: query arretrati a ogni load `/venditore`; indice su `(salespersonUserId, appointmentDate, salespersonOutcome)`.

## 9. Fasi di implementazione suggerite

1. **Schema + migrazioni**: `negotiationStartedAt`, campi briefing su `confermeLeadSurveys`, indice arretrati.
2. **Conferme**: Scheda Trattativa (Parte A+B), bivio "ha confermato?", fusione scarto, enforcement `setConfermeOutcome`, `works`.
3. **Venditore entrata**: `startNegotiation`, lista pre-check-in, workspace + briefing normalizzato.
4. **Venditore uscita**: gate arretrati + enforcement `saveVenditoreOutcome` (check-in + sondaggio su Chiuso).
5. **Script venditore** (contenuto): step successivo, fuori da questa spec.

## 10. Decisioni aperte (da confermare in review)

- ~~Trattative di persona vs da remoto~~ → **DECISO: solo da remoto.** Si gateia tutto dietro il check-in, telefono incluso (vedi §5).
- Elenco **esatto** dei motivi di scarto attuali, da fondere con i `whyNot` nella lista canonica (verifica in fase di piano).
- Scope `/venditore` (Approccio A) confermato; non si blocca l'intero CRM.

## 11. Testing

- Unit: query arretrati rispetta la grazia; guardie server (conferma/scarto senza Scheda; esito senza check-in; esito Chiuso senza sondaggio).
- Integrazione: scarto via Scheda popola `confirmationsDiscardReason`; briefing normalizzato rende identico bot vs Conferme.
- Manuale E2E: venditore con arretrato vede il gate; "Inizia trattativa" rivela il briefing e timbra; esito+sondaggio sbloccano.
