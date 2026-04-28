# HANDOFF — Stato sessione (aggiornato 2026-04-28)

> Ultimo blocco: **Ridistribuzione lead admin** (sezione 3.6).

Bridge fra la sessione che si chiude e quella che parte. Leggilo **tutto**
prima di agire. Questo file vive in `docs/HANDOFF-SESSIONE.md` ed è committato
nel repo: per onorare il flusso di lavoro di Bruno, **aggiornarlo come prima
cosa quando si chiude un blocco di lavoro significativo**.

Sessioni precedenti documentate: 2026-04-17 (cleanup repo + setup MCP — vedi
storia git, commit `f5bcc6b`).

---

## 1. Chi è Bruno e come lavorare con lui

- Product owner del **CRM Fenice** (Next.js 16.1.6 + Drizzle + Supabase Postgres).
- Parla italiano. Comunica veloce, frasi spesso colloquiali — interpreta il senso
  prima di rispondere.
- **Stile preferito:** piano prima → eseguo in autonomia. Per task ambigui
  fai 3-5 domande chiarificatrici, poi parti senza richiedere altre conferme.
- **Regola d'oro:** mai azioni che minino la produzione. Mai `git push --force`
  su main, mai DELETE in DB senza backup mentale del previousState, mai bypass
  hooks. **Verifica build locale prima di push** se hai modifiche grosse.
- **No commit invadenti:** evita di committare `.claude/settings.local.json`
  o file generati dal CLI in scope di feature commit (resetta con `git reset HEAD
  <file>` prima di `git commit`).

---

## 2. Tech stack reale (importante: CLAUDE.md è in parte obsoleto)

| Cosa | Valore reale |
|---|---|
| Next.js | **16.1.6** (Turbopack) — CLAUDE.md dice 14, è vecchio |
| React | 19.2.3 |
| ORM | Drizzle |
| DB | Supabase Postgres (project id `ncutwzsifzundikwllxp`) |
| Hosting | Vercel (team `team_HQ6j7kWTKLK8Hw4Kfv2iElcj`, project `prj_rAcHuOvHJq6vT8xINRVb9JrlFQ5C`) |
| Tailwind | v4 |
| Schema | `src/db/schema.ts` (~700 righe) |
| Routes | ~30 in `src/app/(dashboard)` |

**Quirk Next.js 16:** `dynamic({ ssr: false })` NON è permesso nei Server
Components — solo nei Client. Se serve, importa senza `ssr: false`: il
componente è già `"use client"` e si idrata client-only comunque.

**MCP attivi (verificati funzionanti):**
- `mcp__supabase__*` — esecuzione SQL, migrations
- `mcp__vercel__*` — list/get deployments, build logs
- `mcp__github__*` — non usati spesso, ma disponibili

**Il bash è bash su Windows, non PowerShell.** Usa sintassi Unix.

---

## 3. Lavori completati nelle ultime sessioni (16-27 aprile)

**Tutto live in prod.** Ogni voce è un commit reale, riferimento incluso.

### 3.1 Activecampaign intake (CRITICAL: è la lifeline lead)

- **Webhook AC** in `src/app/api/webhooks/activecampaign/route.ts` con 3 livelli
  di difesa anti-lancio:
  1. Filtro lista bloccata via `payload.list` (fastpath)
  2. Fallback membership: interroga `/contacts/{id}/contactLists` e blocca se
     iscritto a lista bloccata (covers: webhook senza `list` nel payload)
  3. Quarantena funnel: blocca subscribe con `provenienza` in
     `ACTIVECAMPAIGN_QUARANTINED_FUNNELS` (default `'ORG'` durante lancio
     VideoEditor 2026)
- Lista bloccata di default: `'Lead Lancio Video Editor 2026'`. Override env
  `ACTIVECAMPAIGN_BLOCKED_LIST_NAMES` (comma-separated).
- **Race condition risolta:** dedup + round-robin + insert dentro transazione
  con `pg_advisory_xact_lock` (commit `7a2703c`). Niente più 2 GDO che
  ricevono lo stesso lead.
- Notifiche realtime ai GDO quando arriva un lead AC (canale Supabase
  realtime `notifications`, già aggiunto alla publication).
- Stats `/lead-automatici`: card "Lead importati AC oggi/ieri/altro ieri" +
  media per GDO.
- **Quando finisce il lancio:** rimuovi/svuota `ACTIVECAMPAIGN_QUARANTINED_FUNNELS`
  su Vercel per riprendere intake ORG normale.

### 3.2 Conferme — completata roundup miglioramenti

- **Anteprima ultima nota Conferme** sulla riga del board (pill blu compatta,
  sotto confRecallNotes). 1 riga truncata + tooltip full.
- **P2P realtime fixato:** tabella `internalAlerts` aggiunta alla publication
  `supabase_realtime` + `GlobalAlertListener` spostato dal ConfermeBoard al
  `(dashboard)/layout.tsx` (alert globali su qualunque pagina).
- **Annulla scarto:** bottone in tab Esiti del ConfermeDrawer quando lead è
  scartato. Server action `undoConfermeScarto` resetta outcome con concurrency
  check + audit log.
- **Filtro data storico Conferme:** date range "dal/al" sulla tab storico,
  filtra per `confirmationsTimestamp`. Default ultimi 7 giorni.
  Param nuovo `dateFilterField` in `getConfermeAppointments`.
- **Presence affidabile:** heartbeat track ogni 25s + re-track on
  `visibilitychange` + untrack on `pagehide`. Risolto problema "colleghi
  appaiono offline ma sono attivi".
- **Calendario Google freeBusy** nel modal Agenda Venditori: mostra impegni
  esterni (GCal) come celle viola tratteggiate. Funzioni nuove
  `getBusySlotsForUser` + `hasCalendarConnection` in `lib/googleCalendar.ts`.
- **Override festivo Conferme** (auto-disattivante): venerdì 2026-04-24, dato
  che sabato 25 era festa, la tab "Mattina" mostrava lunedì 27 invece di
  sabato. Codice si auto-disattiva dopo il giorno.
- **Visibilità esiti** (commit `acc1d56`):
  - Badge inline nella riga del board: "Confermato"/"Scartato"/"Chiuso"/
    "Presenziato"/"Sparito"
  - Box "Stato attuale" in tab "Dati Lead" del ConfermeDrawer + shortcut
    "Modifica → tab Gestione Esiti"
- **ConfermeScriptWidget:** widget script dedicato per Conferme dentro
  ConfermeDrawer (tab Script) e ContactDrawer (se utente ruolo CONFERME).
  Pannelli emergenza "Gestisci fuga" e "Gestisci obiezione".

### 3.3 KPI & Dashboard

- **Sales Manager** (`/panoramica-generale`, voce sidebar rinominata):
  pagina admin che ora aggrega anche performance venditori, ROAS riassunto
  mensile e pipeline venditori prossimi 14 giorni in un unico colpo d'occhio.
  Riusa `getVenditoriKpi`, `getMarketingStats`, `getVenditoriMonitor`. Niente
  duplicazioni di calcolo. Realtime via `window.realtime_update` event.
- **`/kpi-gdo` unificato** con `/kpi-team`:
  - Toggle "Solo ore lavoro 13:30-20:00" (default ON manager, OFF GDO)
  - Filtro multi-GDO con "Team intero (Aggregato)"
  - Trend chart REALE dal server (non più mock). Auto-switch
    orario↔giornaliero in base al periodo selezionato.
  - `/kpi-team` ora redirect a `/kpi-gdo`.
  - `ManagerOperativaBoard` spostato in nuova pagina `/operativa-team`.
  - **Nuove colonne in tabella ranking:** `% Conferme` e `% Presenziati` per
    ogni GDO (con frazione X/Y, colore semaforo: verde≥70%, giallo≥40%,
    rosso>0%). Visibili a tutti.
- **`/kpi-conferme` (calendario mensile):** "Fissati", "Confermati", "Scartati"
  ora basati su `appointmentDate` invece di `confirmationsTimestamp` /
  `appointmentCreatedAt`. Cella del giorno X = appuntamenti SCHEDULATI per
  quel giorno (qualunque sia il loro stato).
- **`/marketing-analytics`:** rinomino label per chiarire confusione: "% Fiss"
  → "% Fiss su presi", "App %" → "% Fiss su totali", "Lead" → "Lead totali",
  "Lead Assegn." → "Presi in carico". Stessa logica drill-down. Calcolo
  invariato.
- **"Numero inesistente" non più contato come risposta** nel ranking GDO
  e nel pie "Motivi Scarto". Costante `NEVER_ANSWERED_DISCARD_REASONS`
  estendibile.

### 3.4 Costi Operativi (28/04)

- **Costo per Appuntamento** + **Costo per Contratto** in `ManagerOperativaBoard`
  (tab MESE/TRIMESTRE — esclusi da OGGI per non avere metriche esplose con
  contratti=0). Formule:
  - `costoBase = 12.5 €/h × oreLavorate + leadNuoviAssegnati × CPL`
  - `costoPerApp = costoBase / appuntamenti`
  - `costoPerContratto = costoBase / contrattiChiusi`
  - `leadNuoviAssegnati` = lead assegnati nel periodo con `funnel ≠ DATABASE`
    (i lead DB non hanno CPL associato).
- **CPL configurabile** via tabella `appSettings` (key/value). Default `9 €`,
  key `operativa_cpl_eur`. Modifica inline solo per ADMIN dal pannello sopra
  la tabella. Non serve redeploy.
- Costo orario GDO `12.5 €/h` resta hardcoded come da formula concordata
  (se servirà parametrizzarlo, usare la stessa tabella `appSettings`).
- `OperativaDataRow` esteso con: `leadNuoviAssegnati`, `costoBaseEur`,
  `costoPerAppuntamentoEur`, `costoPerContrattoEur`.
- Server actions nuove in `managerAdvancedActions.ts`:
  `getOperativaCostSettings()` (anyone) e `setOperativaCplEur(value)` (ADMIN).

### 3.6 Ridistribuzione lead esistenti (28/04 — sessione ripresa post-crash)

- Card admin-only **"Ridistribuisci lead esistenti"** in fondo a `/import`. Sposta
  in blocco i lead "in coda" da un GDO sorgente (sommerso o assente) a uno o
  più destinatari, **preservando tutto lo stato** (`callCount`, `recallDate`,
  note, eventi). Cambia solo `assignedToId` + bumpa `version`.
- **Sezioni supportate** (mappate su pipeline GDO):
  - `'1'` Prima chiamata: `callCount=0`, no recall, status NEW/IN_PROGRESS
  - `'2'` Seconda chiamata: `callCount=1`, no recall
  - `'3'` Terza chiamata: `callCount=2`, no recall
  - `'recall'` Richiami: `recallDate IS NOT NULL`
  - Sempre escluso `status='REJECTED'` e `status='APPOINTMENT'`
- **Filtro funnel** opzionale (chip multi-select con conteggi reali).
- **Quanti**: tutti i match o N specifico → presi i più nuovi prima
  (`createdAt DESC`), così se chiedi "20 dei 50 della 1ª" prendi i 20 freschi.
- **Modalità distribuzione**: equa (round-robin) o quote custom (con fallback
  round-robin sull'eccedenza se la somma quote < totale).
- **Anteprima live** con bar chart per destinatario prima di confermare.
- **Audit completo**: 1 evento `leadEvents` per lead con
  `eventType='REASSIGNED_ADMIN'` + metadata (from/to assignee, sezione, mode,
  funnels). 1 notifica aggregata per GDO destinatario
  (`type='lead_assignment'`).
- **Doppia protezione**: `assertAdmin()` server-side + guard client che nasconde
  la card ai non-admin (anche se la pagina `/import` è accessibile a manager).
- File:
  - `src/app/actions/redistributeLeadsActions.ts` (4 server action: get gdos,
    get funnel, preview, execute)
  - `src/components/LeadRedistributionCard.tsx`
  - `src/app/(dashboard)/import/page.tsx` (mount card)

### 3.5 Admin tools

- **Cancella SOLO appuntamento** (admin/manager): bottone "Cancella App" in
  `/appuntamenti-oggi`. Reset campi appointment + esiti, `callCount`
  preservato, status → `IN_PROGRESS`. Audit log con `previousState`.
  Server action `cancelLeadAppointment`.
- **Cancella LEAD definitivo** (solo ADMIN): cestino rosso nell'header del
  `ContactDrawer`. Doppia conferma (popup + prompt "ELIMINA"). DELETE con
  cascade automatico. Server action `deleteLeadCompletely`.
- **Monitor Vendite** (`/monitor-vendite`, ADMIN/MANAGER): nuova pagina con
  appuntamenti + follow-up + scaduti per ogni venditore. Filtro range +
  multi-venditore.
- **Agenda Venditori** dal ConfermeBoard (modal): vista settimanale del
  carico per ogni venditore + impegni esterni Google.

---

## 4. Schema DB — campi importanti da ricordare

In `leads`:
- **Ciclo vita:** `status` (`NEW`/`IN_PROGRESS`/`APPOINTMENT`), `callCount`,
  `lastCallDate`.
- **Appuntamento:** `appointmentDate`, `appointmentNote`, `appointmentCreatedAt`.
- **Conferme:** `confirmationsOutcome` (`'confermato'`/`'scartato'`),
  `confirmationsDiscardReason`, `confirmationsUserId`, `confirmationsTimestamp`,
  `confNeedsReschedule`, `confSnoozeAt`, `confRecallNotes`.
- **Vendita:** `salespersonUserId`, `salespersonAssigned` (nome stringa),
  `salespersonOutcome` (`'Chiuso'`/`'Non chiuso'`/`'Sparito'`/
  `'Lead non presenziato'`), `closeAmountEur`, `followUp1Date`,
  `followUp2Date`.
- **Concurrency:** `version` (integer, optimistic lock).
- **Source AC:** `source = 'activecampaign'`, `acContactId`, `phoneSuspicious`.

Tabelle utili:
- `leadEvents` — audit log con metadata jsonb. Cascade su delete lead.
- `confirmationsNotes` — note Conferme per lead.
- `internalAlerts` — P2P P2P (P2P notifications). Realtime publication: ✅.
- `notifications` — sistema notifiche generiche. Realtime publication: ✅.
- `acIntakeFailures` — log dei lead AC NON importati (con `payload` raw).

---

## 5. Cose da NON toccare senza chiedere

- **Realtime publications** Supabase (`leads`, `notifications`, `breakSessions`,
  `internalAlerts`, `teamGoals`). Sono configurate. Toccare può rompere
  notifiche live.
- **Default `ACTIVECAMPAIGN_QUARANTINED_FUNNELS=ORG`** finché Bruno non dice
  che il lancio VideoEditor è finito.
- **`pg_advisory_xact_lock`** nel webhook AC: tienilo, è anti race-condition.
- **`confermeStatus='storico'`** semantica: filter su `confirmationsTimestamp`,
  non `appointmentDate`. È intenzionale.
- **`KpiTeamDashboard.tsx` + `kpiTeamActions.ts`** sono dead code. Non sono
  importati ma li lasciamo come fallback per qualche giorno. Bruno ha detto:
  rimuovere fisicamente "alla prossima passata di manutenzione".

---

## 6. Cose in roadmap che Bruno potrebbe chiedere ancora

In ordine di probabilità che vengano fuori:

- **Modifica appuntamento** lato Manager dal ContactDrawer (data/ora/venditore).
  Oggi c'è solo da ConfermeDrawer per lead in stato APPOINTMENT.
- **Claude Design integration** (annunciato 17/04/2026): Bruno potrebbe
  passarti un "handoff bundle" da claude.ai/design per restyling UI.
  Quando l'MCP server Claude Design è disponibile, agganciarlo qui.
- **Rimozione fisica `kpiTeamActions.ts` + `KpiTeamDashboard.tsx`** (dead code).
- **Estensione gamification** a Conferme e Venditori (memory file:
  `project_gamification_conferme_venditori.md`).
- **Rebalance store items** (memory file: `project_store_items_rebalance.md`).

---

## 7. Bug noti / debiti tecnici

- `WORKING_HOURS_PER_DAY = 6.5` hardcoded in `kpiAdvancedActions.ts`. Quando
  toggle "Solo ore lavoro" è OFF, le 6.5h sono fuorvianti per il calcolo
  `chiamate/ora`. Bruno lo sa, lasciato così per non rompere metriche.
- `KpiTeamDashboard.tsx` + `kpiTeamActions.ts` non più usati ma in repo
  (vedi sezione 5).

---

## 8. Workflow standard quando arriva una richiesta

1. **Capisci il problema reale.** Se ambiguo, chiedi 3-5 domande mirate.
2. **Esplora il codice** prima di scrivere (non dare per scontato schema/UI
   senza grep).
3. **Pianifica il diff in testa.** Per refactor grossi, dividi in commit
   separati con scope chiaro.
4. **Modifica + typecheck (`npx tsc --noEmit`)** prima di committare.
5. **Build locale (`npx next build`)** se hai toccato layout, server actions
   pesanti, o file con import dinamici. Bruno ha sofferto deploy ERROR
   evitabili — meglio prevenire.
6. **Commit message in italiano**, prefisso convenzionale (`feat:`/`fix:`/
   `refactor:`/`chore:`), corpo che spiega il **perché** del fix non solo
   il what. Co-Authored-By in coda.
7. **Push** + **monitor deploy Vercel** via MCP. Se ERROR, leggi build logs
   e fixa subito.
8. **Aggiorna questo handoff** se è stato un blocco di lavoro significativo.

---

## 9. Memory files persistenti (lato Claude Code, non in repo)

Path: `~/.claude/projects/C--Users-bruno-Desktop-CRM-GDO/memory/MEMORY.md`
+ singoli file `*.md` nello stesso path.

Già presenti (verificare/aggiornare se obsoleti):
- `user_bruno.md` — profilo Bruno
- `feedback_dev_approach.md` — pianifica → esegui in autonomia
- `project_roadmap.md` — 4 fasi, possibilmente obsoleto
- `project_env_quirks.md` — Next.js 16.1.6 reale, NEXTAUTH_URL legacy
- `project_sondaggi_lead.md` — feature deployata 2026-04-17
- altri (gamification, store, sales script)

---

## 10. Status corrente (snapshot 2026-04-27)

- **Branch main:** ultimi commit live in prod, deploy Vercel `dpl_D3s2w`
  (commit `289a0ed`) READY.
- **Lavori in pausa:** nessuno aperto. Sessione conclusa pulita.
- **Da chiedere a Bruno alla prossima:** se vuole il rename `kpiTeamActions`
  rimosso, e se il lancio VideoEditor è finito (per togliere quarantena ORG).
