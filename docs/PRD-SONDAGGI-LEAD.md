# PRD — Sondaggi Lead

**Autore**: Claude (Opus 4.7)
**Owner**: Bruno Iacopo
**Data**: 2026-04-17
**Stato**: ⏳ In attesa di approvazione Bruno
**Fonte requisiti**: Google Doc "Sondaggi lead" + Q&A 2026-04-17

---

## 1. Value Proposition

Trasformare le risposte che i GDO già raccolgono a voce durante lo script in **dati strutturati**, così da:
1. Dare al GDO uno scaffolding obbligatorio che aumenta la qualità della call (prima del pitch).
2. Dare al team Marketing metriche di qualità lead **per funnel** e un **profilo dei lead che chiudono**.
3. Estendere lo stesso modello a Conferme e Venditori per raccogliere insight lungo tutta la pipeline.
4. Incentivare la compilazione corretta tramite gamification (GDO + Conferme).

---

## 2. Scope

### In scope
- 3 survey (GDO / Conferme / Venditore) con domande definite da Bruno nel doc Drive.
- Integrazione inline in UI esistente: `ScriptWidget` (GDO), `ConfermeDrawer` (popup), `VenditoreDrawer` (condizionale).
- Nuova dashboard "Qualità Lead" per ruolo `MANAGER`.
- Gamification GDO + Conferme (Venditori sospeso).
- Schema DB (3 tabelle nuove) + Drizzle migration.
- Server actions per save/load.

### Out of scope
- Backfill lead esistenti: forward-only dal deploy.
- Editing risposte post-salvataggio (per ora).
- Script dedicato Conferme/Venditori (verrà in futuro — per ora solo le domande).
- Nuovo ruolo MARKETING (non serve: `marketing@fenice.local` ha già `role=MANAGER`).
- Configurabilità domande/opzioni da UI (hardcoded per ora).
- Disclaimer GDPR in UI (consensi già raccolti a lead-gen).

---

## 3. Architettura dati

### 3.1 Tre tabelle dedicate (motivazione: tipo-safe, query analitiche dirette, zero overhead JSONB)

```
gdo_lead_surveys
├── id             uuid pk
├── leadId         uuid fk → leads.id unique
├── gdoUserId      uuid fk → users.id
├── ageRange       text  enum['18-24','25-35','35-45','45-55','55+']
├── occupation     text  enum['disoccupato','studente','full_time','part_time','p_iva','pensionato']
├── requestReason  text[]  multi ['corso','valuta','info','curiosita']
├── expectation    text[]  multi ['info','materiale_gratis','comprare','capire']
├── mainProblem    text  enum['economico','insoddisfatto','tempo','competenze']
├── digitalKnow    text  enum['nulla','ha_visto','conosce','esperto']
├── changeWithin   text  enum['<30gg','30-90gg','indefinito']
├── changeSince    text  enum['<6m','6-12m','>12m']
├── completed      boolean         -- true se tutte le 8 risposte, false se early-exit
├── earlyExitReason text nullable  -- 'no_budget' | 'solo_corso_10h' | 'curioso' | 'altro'
├── fillDurationMs integer         -- antigaming: tempo compilazione
├── createdAt      timestamptz default now()
├── updatedAt      timestamptz default now()
└── invalidatedBy  uuid fk → users.id nullable  -- manager può invalidare
```

```
conferme_lead_surveys
├── id             uuid pk
├── leadId         uuid fk → leads.id unique
├── confermeUserId uuid fk → users.id
├── remembersAppt  boolean
├── watchedVideo   boolean
├── confirmed      boolean
├── whyNot         text nullable enum['non_risponde','non_interessato','no_soldi','posticipa_senza_data']
├── fillDurationMs integer
├── createdAt      timestamptz default now()
└── invalidatedBy  uuid fk → users.id nullable
```

```
sales_lead_surveys
├── id             uuid pk
├── leadId         uuid fk → leads.id unique
├── salesUserId    uuid fk → users.id
├── problemSignals text[]  multi ['problema_specifico','gia_provato','situazione_concreta','nessuna']
├── urgencySignals text[]  multi ['entro_3m','non_sostenibile','data_certa','nessuna']
├── priceReaction  text  enum['avanti','modalita_pagamento','alto','non_posso','evita']
├── fillDurationMs integer
├── createdAt      timestamptz default now()
└── invalidatedBy  uuid fk → users.id nullable
```

**Nota**: `unique(leadId)` per ogni tabella → al massimo 1 survey per ruolo per lead. Retry/modifiche = UPDATE in-place (solo admin/manager via "invalidatedBy").

**Index**: `(createdAt, leadId)` per dashboard; `leadId` per join; `gdoUserId/confermeUserId/salesUserId` per leaderboard gamification.

### 3.2 Filtro "escludi provenienza database"
Tutte le UI e la dashboard filtrano: `leads.funnel != 'database'`. I lead con `funnel='database'` non mostrano il widget survey e non contribuiscono ai coins.

### 3.3 Condizione Survey Venditore
Compare nel `VenditoreDrawer` SOLO se l'operatore sta esitando con `outcome = 'Non chiuso'`. Gli outcome `'Chiuso'` e `'Sparito'` NON richiedono survey.

---

## 4. UX — 3 punti d'integrazione

### 4.1 GDO — inline in `ScriptWidget.tsx`

**Meccanica**: Lo script ha 11 blocchi. Le 8 domande sono distribuite nei blocchi dove è naturale chiederle (es. occupazione nel blocco "Analisi problema", urgenza nel blocco "Urgenza/Timing"). Ogni domanda è inline sotto le istruzioni del blocco, con radio/checkbox.

**Obbligatorietà soft**: Il bottone "Avanti" del blocco è **disabled** finché la domanda non ha una risposta. MA è sempre disponibile un bottone **"Chiudi script prima della fine"** (esistente o da aggiungere) → apre dialog con:
- Motivo rifiuto articolato (single-choice): `no_budget` / `solo_corso_10h` / `curioso` / `altro`
- Le risposte date finora vengono salvate con `completed=false` + `earlyExitReason`
- I motivi futili ("attaccato in faccia") restano come **pulsanti rapidi esterni** allo script (nella pipeline).

**Dati già nel lead (readonly)**: `email` e `funnel` mostrati nell'intestazione del widget come badge (auto-popolati).

### 4.2 Conferme — popup in `ConfermeDrawer.tsx`

**Meccanica**: UN solo pulsante **"Compila sondaggio esito"** (visibile quando l'operatore sta per esitare — cioè prima di cliccare Conferma/Scarta finale). Al click apre `<Dialog>` con le 4 domande. Il popup si chiude con "Salva" (tutte le risposte obbligatorie) o "Annulla".

**Trigger**: Solo all'esito finale. Se l'operatore clicca "Conferma" o "Scarta" **senza** aver aperto il sondaggio → toast di avviso + possibilità di aprirlo. Non blocca (soft).

### 4.3 Venditore — condizionale in `VenditoreDrawer.tsx`

**Meccanica**: Quando l'operatore seleziona `outcome='Non chiuso'`, sotto il select compare la sezione "Sondaggio — aiutaci a capire perché" con i 3 blocchi (checkbox blocchi 1-2, radio blocco 3). Obbligatorio per salvare (Venditore non ha gamification per ora, ma la compilazione è requisito operativo).

---

## 5. Dashboard Qualità Lead

### 5.1 Route & accesso
- Nuova route: `src/app/(dashboard)/manager/qualita-lead/page.tsx`
- Accesso: tutti gli utenti con `role='MANAGER'` (include `marketing@fenice.local`).
- Link visibile nella navigazione MANAGER.

### 5.2 Filtri (top bar)
- **Ruolo**: GDO | Conferme | Venditore | (tutti)
- **Funnel**: multi-select dei valori distinct (`SELECT DISTINCT funnel FROM leads WHERE funnel != 'database'`)
- **Range date**: preset (7gg / 30gg / 90gg / custom)

### 5.3 Viste
1. **Breakdown per domanda**: per ogni domanda del ruolo selezionato, grafico a barre % risposte.
2. **Percentuali per funnel**: per ogni funnel, la distribuzione delle risposte. Serve per confrontare quali funnel portano lead con profili più "caldi".
3. **Profilo dei chiusi**: filtro automatico su lead con `salespersonOutcome='Chiuso'`, mostra breakdown survey GDO di quei lead → risponde alla domanda "che tipo di lead chiude?"
4. **KPI riepilogativi**: numero survey compilate, % lead con survey completa, tempo medio compilazione.

### 5.4 Export CSV
Singolo pulsante **"Esporta resoconto CSV"**. Esporta **aggregato** (non singole risposte): una riga per combinazione `(funnel, domanda, opzione)` con count e %.

---

## 6. Gamification (GDO + Conferme)

Audit della gamification esistente: il sistema ha `quests`, `achievements`, `coinTransactions`, `lootDrops`, `userAchievements`, `weeklyGamificationRules`. Riutilizziamo tutto.

### 6.1 Coins & XP (reward immediati)

**GDO**:
- Survey completa al 100% (tutte 8 risposte, `completed=true`): **+15 coins, +30 xp**
- Survey con early-exit valido (motivo articolato salvato): **+5 coins, +10 xp** (premio per aver comunque provato)
- Early-exit senza motivo / survey abbandonata: 0

**Conferme**:
- Sondaggio compilato all'esito: **+8 coins, +15 xp**

**Fonte**: via `coinTransactions` con `reason='survey_completed'` / `'survey_partial'` / `'conferme_survey'`.

### 6.2 Achievements (progressive, 3 tier)

Sfrutta il sistema a tier esistente (`achievements.tier1Target`, `tier2Target`, `tier3Target`).

**GDO — "Analista Seniore"** *(metric: `gdo_surveys_completed`)*
- Tier 1: 25 survey → badge + 50 coins
- Tier 2: 100 survey → badge + 200 coins
- Tier 3: 500 survey → badge + titolo profilo + 1000 coins

**GDO — "Profiler"** *(metric: `gdo_surveys_streak_daily`)*
- Tier 1: 5 giorni consecutivi con ≥3 survey/giorno → badge
- Tier 2: 15 giorni → badge + 300 coins
- Tier 3: 30 giorni → badge + loot drop raro

**Conferme — "Radar"** *(metric: `conferme_surveys_completed`)*
- Tier 1: 15 → badge + 40 coins
- Tier 2: 60 → badge + 150 coins
- Tier 3: 200 → badge + 500 coins

### 6.3 Quest settimanali
Sfrutta `weeklyGamificationRules` / `quests`:
- "Profilo perfetto settimanale" — 20 survey GDO complete in 7gg → 100 coins + loot drop comune
- "Esito chiaro" — 12 survey Conferme in 7gg → 60 coins

### 6.4 Anti-gaming

**Controlli automatici** (calcolati in server action al save):
1. **Tempo minimo**: `fillDurationMs < 5000` (5 sec) → flag `suspicious=true`, 0 reward, segnalato in dashboard Manager.
2. **Pattern monotono**: se un GDO compila ≥3 survey consecutive con **identiche** risposte → stesso flag.
3. **Timestamp cluster**: ≥5 survey compilate entro 2 min → flag.

**Controllo manuale Manager**:
- Sezione dashboard "Survey sospette": lista dei flag. Manager può **Invalidare** (set `invalidatedBy`): revoca coins, non conta più per achievement/quest.
- **Penalità opzionale**: -20 coins per ogni survey invalidata (`coinTransactions` negativa).

---

## 7. Files / Implementazione

### Nuovi files
- `src/db/schema.ts` → aggiungo 3 tabelle + export types
- `drizzle/NNNN_sondaggi_lead.sql` → migration auto-generata
- `src/lib/surveys/questions.ts` → costanti domande/opzioni per i 3 ruoli (i18n IT)
- `src/lib/surveys/rewards.ts` → costanti gamification (coins/xp per evento)
- `src/components/surveys/GdoSurveyInline.tsx` → blocchi domanda inline per lo ScriptWidget
- `src/components/surveys/GdoEarlyExitDialog.tsx` → dialog motivo rifiuto articolato
- `src/components/surveys/ConfermeSurveyDialog.tsx` → popup 4 domande
- `src/components/surveys/VenditoreSurveyInline.tsx` → blocchi condizionali
- `src/app/actions/surveyActions.ts` → save/get/invalidate + reward dispatcher
- `src/app/(dashboard)/manager/qualita-lead/page.tsx` → server component
- `src/app/(dashboard)/manager/qualita-lead/QualitaLeadClient.tsx` → client con filtri/grafici
- `src/app/(dashboard)/manager/qualita-lead/actions.ts` → aggregazioni SQL + export CSV
- `src/components/surveys/SuspiciousSurveysSection.tsx` → sezione anti-gaming per Manager

### Files modificati
- `src/components/ScriptWidget.tsx` → integrazione inline survey GDO + early-exit
- `src/components/ConfermeDrawer.tsx` → bottone "Compila sondaggio" + dialog
- `src/components/VenditoreDrawer.tsx` → render condizionale survey
- `src/components/ContactDrawer.tsx` → nuova tab "Sondaggi" (read-only view delle risposte)
- `src/db/schema.ts` → 3 nuove tabelle + relazioni
- Sidebar Manager → nuova voce "Qualità Lead"

### Migration plan
1. `npx drizzle-kit generate` → produce SQL
2. `npx drizzle-kit migrate` su staging/local
3. Review SQL output (Bruno può dare un'occhiata)
4. Apply su prod via `mcp__supabase__apply_migration` **solo dopo conferma**

---

## 8. User stories & Acceptance Criteria

### US-1: GDO compila survey inline durante script
**As** un operatore GDO
**I want** vedere le 8 domande del sondaggio integrate nei blocchi dello script
**So that** raccolgo i dati mentre parlo, senza un passaggio extra dopo la call

**AC**:
- Le domande sono distribuite nei blocchi pertinenti, non tutte insieme.
- Il bottone "Avanti" del blocco è disabled finché la domanda non ha risposta.
- È sempre disponibile "Chiudi script prima della fine" → dialog motivo rifiuto → salva parziale.
- A script completato, la survey è salvata con `completed=true` e l'operatore riceve 15 coins + 30 xp.
- Email e funnel del lead sono mostrati readonly nel widget.
- Lead con `funnel='database'` non mostrano la survey.

### US-2: Operatore Conferme compila survey via popup
**As** operatore Conferme
**I want** un pulsante singolo che apre un popup col sondaggio
**So that** compilo velocemente senza frammentare la UI del drawer

**AC**:
- Pulsante "Compila sondaggio esito" visibile nel ConfermeDrawer.
- Click → Dialog con 4 domande (3 si/no + 1 single-choice condizionale "perché no" se confirmed=false).
- Salva + chiude. +8 coins, +15 xp.
- Se l'operatore esita confermato/scartato senza aver compilato → toast "Vuoi compilare il sondaggio prima?" con link.

### US-3: Venditore compila survey solo se lead non chiuso
**As** venditore
**I want** vedere il sondaggio solo quando esito "Non chiuso"
**So that** non perdo tempo sui chiusi vinti o sui Spariti

**AC**:
- Survey visibile nel VenditoreDrawer solo se `outcome='Non chiuso'`.
- Obbligatorio compilare per salvare.
- Nessuna gamification per venditori.

### US-4: Manager/Marketing vede dashboard qualità lead
**As** MANAGER (incluso marketing@fenice.local)
**I want** una dashboard con filtri ruolo/funnel/data
**So that** analizzo la qualità dei lead per ottimizzare il marketing

**AC**:
- Route `/manager/qualita-lead` accessibile solo a role=MANAGER.
- Filtri funzionanti.
- Grafici % per domanda, per funnel.
- Sezione "Profilo dei chiusi" = breakdown GDO-survey dei lead `Chiuso`.
- Export CSV aggregato funzionante.
- Sezione "Survey sospette" con bottone Invalida.

### US-5: Anti-gaming GDO
**As** MANAGER
**I want** vedere e invalidare survey sospette
**So that** la gamification non viene aggirata

**AC**:
- Survey con `fillDurationMs<5000` o pattern monotono flaggate `suspicious=true`.
- Lista visibile nella dashboard Manager.
- Invalida → imposta `invalidatedBy=managerId`, revoca coins via `coinTransactions` negativa.

---

## 9. Rollout

### Fase 1 — DB + backend (nessun impatto UI)
- Schema.ts + migration + apply in Supabase
- Server actions (save/get/invalidate/aggregate)
- Build verde, commit atomico

### Fase 2 — UI integration (3 drawer)
- ScriptWidget GDO inline
- ConfermeDrawer popup
- VenditoreDrawer condizionale
- ContactDrawer tab Sondaggi (read-only)
- Build verde, commit atomico

### Fase 3 — Dashboard
- Route /manager/qualita-lead
- Filtri + grafici + export CSV
- Sezione anti-gaming
- Build verde, commit atomico

### Fase 4 — Gamification
- Costanti rewards
- Dispatch in save actions
- Achievements seeding
- Quest weekly
- Build verde, commit atomico

### Fase 5 — Deploy
- Verifica build + typecheck verdi
- Push su main → deploy Vercel automatico
- Monitor con `mcp__vercel__get_deployment_build_logs`

**Zero impatto su operatività**: la feature è additiva, nessuna tabella esistente modificata.

---

## 10. Assunzioni esplicite (da confermare o correggere da Bruno)

1. **Stack tecnologia**: ok continuare con Drizzle `pgTable` + Supabase DB + Next.js App Router.
2. **Domande GDO distribuite nei blocchi script**: decido io la distribuzione contestuale (età → blocco apertura/intro; occupazione → blocco "analisi situazione"; conoscenza digitale → blocco professione; urgenza → blocco "urgenza timing"). Bruno può rivedere in review.
3. **Early-exit motivi**: `no_budget` / `solo_corso_10h` / `curioso` / `altro` — derivati dalla frase di Bruno. Se vuoi aggiungere opzioni dimmelo.
4. **Coins balance**: 15/8/5 e achievements a 25/100/500 sono una prima calibrazione. Se troppo generoso/stretto dopo 1 settimana, si modifica in `rewards.ts`.
5. **Sidebar Manager**: aggiungo voce "Qualità Lead" nel menu esistente. Nessun redesign.
6. **Nessun email/notifica**: non mando alert Slack o email per survey sospette — solo sezione dashboard.

---

## 11. Rischi & mitigazioni

| Rischio | Mitigazione |
|---|---|
| GDO rifiutano di compilare → script più lento | Gamification + soft-blocking (solo bottone disabled, non modale intrusiva) |
| Survey compilate a caso per i coins | Anti-gaming automatico + Manager invalida |
| Dashboard troppo lenta su volumi alti | Index su `(createdAt, leadId)` + materializedview se servisse in futuro |
| Rompo ScriptWidget esistente | Branching su file + prima test in dev + rollback facile |
| Migration blocca prod | Migration additiva pura (CREATE TABLE), zero rischio di lock |

---

## 12. Prossimi step (post-approvazione)

1. Creo branch `feature/sondaggi-lead`
2. Fase 1 → schema + migration + server actions
3. Fase 2-4 → UI + dashboard + gamification
4. Fase 5 → deploy
5. Aggiorno memoria Claude: marco come "implementato"

**Stima**: ~2-3 sessioni per completo rollout a produzione.

---

# ⏳ DECISIONE BRUNO

Scegli una delle 3:
- **A. Approvato tutto, procedi**: vado nell'ordine della Fase 1→5.
- **B. Approvato con modifiche**: scrivimi le modifiche e le applico.
- **C. Rifiutato / rivediamo**: dimmi cosa cambiare.
