# PRD: CRM Fenice — Fenice Academy

**Author:** Team Fenice | **Status:** Draft | **Data:** 2026-04-06

---

## 1. Summary

**CRM Fenice** è la piattaforma gestionale proprietaria di Fenice Academy che orchestra l'intero funnel di vendita: dall'acquisizione dei Lead crudi, alla lavorazione da parte dei GDO (Call Center), passando per il team Conferme che valida gli appuntamenti, fino ai Venditori che chiudono i deal. Il sistema è arricchito da un modulo di **Gamification RPG** (Fenice Coins, Leveling, Store, Sprint, Leaderboard) che incentiva le performance degli operatori trasformando il lavoro quotidiano in un'esperienza competitiva e ingaggiante.

Il CRM è attualmente in produzione su Vercel, serve un team operativo composto da GDO, Conferme, Venditori e Manager, e gestisce migliaia di lead con sincronizzazione real-time, integrazione Google Calendar e analytics avanzati.

**Questo PRD** documenta lo stato attuale completo della piattaforma e definisce la roadmap di sviluppo futuro per le prossime iterazioni.

---

## 2. Contacts

| Ruolo | Nome | Responsabilità |
|-------|------|----------------|
| Product Owner | Team Fenice | Decisioni di prodotto, priorità feature |
| Engineering Lead | Claude (AI Agent) | Delivery tecnica, architettura, codice |
| DevOps | Vercel + Supabase | Infrastruttura, hosting, database |

---

## 3. Background

### 3.1 Contesto di Business
Fenice Academy è un'accademia formativa che genera lead tramite campagne marketing multicanale (funnel). Questi lead vengono lavorati da un team interno di operatori telefonici (GDO — "Gestione Dati Operativa") che li qualificano, fissano appuntamenti, e li passano al team vendite per la chiusura commerciale.

### 3.2 Perché è nato CRM Fenice
- **Necessità di controllo end-to-end**: Gestire l'intero ciclo di vita del lead in un'unica piattaforma, dalla prima chiamata alla chiusura del contratto.
- **Motivazione operatori**: Il call center soffriva di turnover e calo motivazionale. La gamification RPG è stata introdotta per trasformare KPI freddi in meccaniche di gioco.
- **Visibilità manageriale**: I manager necessitavano di dashboard real-time per monitorare performance, qualità e colli di bottiglia nel funnel.
- **Coordinamento inter-team**: GDO → Conferme → Venditori richiedeva un passaggio di consegna tracciato e notificato in tempo reale.

### 3.3 Stato Attuale della Piattaforma

#### Tech Stack
| Componente | Tecnologia |
|------------|-----------|
| Framework | Next.js 16 (App Router) |
| Runtime | React 19 |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) |
| ORM | Drizzle ORM |
| Auth | Supabase Auth + SSR Middleware |
| Realtime | Supabase Realtime (WebSocket) |
| Charts | Recharts |
| Calendar | Google Calendar API (OAuth2) |
| Hosting | Vercel |
| Icons | Lucide React |

#### Database: 21 Tabelle
| Dominio | Tabelle |
|---------|---------|
| Core CRM | `users`, `leads`, `callLogs`, `leadEvents` |
| Conferme | `confirmationsNotes` |
| Break | `breakSessions` |
| Notifiche | `notifications`, `internalAlerts` |
| Gamification | `shopItems`, `userPurchases`, `coinTransactions`, `sprints`, `teamGoals`, `weeklyGamificationRules` |
| Calendario | `calendarConnections`, `calendarEvents` |
| Import | `importLogs`, `assignmentSettings` |
| Analytics | `monthlyTargets`, `dailyKpiSnapshots`, `marketingBudgets` |

#### Pagine App: 24 Route Protette + Login
| Area | Route | Ruoli |
|------|-------|-------|
| Pipeline GDO | `/` | GDO |
| Venditori | `/venditore` | VENDITORE, MANAGER, ADMIN |
| Conferme | `/conferme` | CONFERME, MANAGER, ADMIN |
| Team Mgmt | `/team`, `/team/store` | MANAGER, ADMIN |
| KPI | `/kpi-team`, `/kpi-venditori`, `/kpi-gdo`, `/kpi-conferme` | Vari |
| Analytics | `/marketing-analytics`, `/analisi-qualita` | MANAGER, ADMIN |
| Manager | `/manager-targets`, `/manager-gdo-performance`, `/manager-rpg-monitor`, `/monitor-pause` | MANAGER, ADMIN |
| Operativi | `/appuntamenti`, `/richiami`, `/classifica`, `/scartati`, `/archivio` | Vari |
| Gamification | `/store`, `/profilo` | Tutti |
| Import | `/import` | Tutti |

#### Server Actions: 30 File, 80+ Funzioni
Copertura completa di tutte le operazioni CRUD e business logic per ogni dominio del CRM.

### 3.4 Vincoli e Assunzioni
- **Fuso orario**: Tutte le date sono gestite in timezone `Europe/Rome`.
- **Hydration Safety**: I bottoni interattivi non possono mai essere child di `<span>` o `<p>` (causa WSOD).
- **Supabase Realtime**: I channel `postgres_changes` non devono essere alterati.
- **Concurrency Control**: I lead usano un campo `version` per optimistic locking.
- **Nessun UI Library esterno**: Tutti i componenti sono custom con Tailwind (no shadcn/Radix).

---

## 4. Objective

### 4.1 Obiettivi Primari (Stato Attuale — Consolidamento)

1. **Stabilità e affidabilità al 100%**: Zero WSOD, zero errori di hydration, performance costante su Vercel.
2. **Completezza del funnel end-to-end**: Ogni lead deve essere tracciabile dalla prima chiamata alla chiusura contratto senza buchi nel flusso.
3. **Gamification ingaggiante**: Il sistema RPG deve effettivamente motivare gli operatori GDO, con metriche di engagement misurabili.

### 4.2 Obiettivi Secondari (Sviluppo Futuro — Evoluzione)

4. **Automazione intelligente**: Ridurre il lavoro manuale dei manager con alert automatici, report schedulati e suggerimenti AI-driven.
5. **Mobile-first experience**: Garantire usabilità completa da mobile per venditori e manager in movimento.
6. **Scalabilità team**: Supportare il raddoppio del team operativo senza degradazione delle performance.
7. **Analytics predittivi**: Passare da analytics descrittivi a predittivi (forecasting chiusure, lead scoring).

### 4.3 Non-Goals (Esplicitamente fuori scope)

- **CRM generico multi-tenant**: Fenice è costruito per Fenice Academy, non è un SaaS generico.
- **Integrazione con CRM esterni** (Salesforce, HubSpot): Non prevista.
- **App mobile nativa**: Si punta alla PWA/responsive, non a build native iOS/Android.
- **Supporto multi-lingua**: L'interfaccia resta esclusivamente in italiano.

---

## 5. Market Segments

| Segmento | Dimensione | Priorità | Note |
|----------|-----------|----------|------|
| **GDO (Operatori Call Center)** | 15-20 operatori | P0 — Core | Utenti principali. Effettuano 50-100+ chiamate/giorno. Necessitano di UI veloce, richiami puntuali e motivazione gamificata. |
| **Team Conferme** | 3-5 operatori | P0 — Core | Validano appuntamenti fissati dai GDO. Necessitano di vista per orario, gestione multi-call, snooze. |
| **Venditori (Closer)** | 5-10 venditori | P0 — Core | Chiudono i deal. Necessitano di agenda appuntamenti, esiti rapidi, sync calendario. |
| **Manager / Admin** | 2-4 persone | P0 — Core | Monitorano KPI, gestiscono team, impostano target, controllano qualità e pause. |
| **Marketing** | 1-2 persone | P1 — Important | Analizzano ROAS per funnel, budget mensili, performance per canale di acquisizione. |

---

## 6. Value Propositions

### 6.1 Value Proposition Canvas

| Tipo Utente | Job-to-be-Done | Pain Relieved | Gain Created |
|-------------|---------------|---------------|--------------|
| **GDO** | Chiamare lead, fissare appuntamenti, gestire richiami | Elimina fogli Excel e post-it per tracciare chiamate; riduce il caos delle priorità | Pipeline visuale chiara; gamification che rende il lavoro competitivo e gratificante; notifiche real-time |
| **Conferme** | Validare appuntamenti, richiamare prospect, confermare presenze | Elimina la gestione manuale degli appuntamenti sparsi; riduce i "buchi" (no-show) | Vista Kanban per fascia oraria; tracking multi-chiamata; integrazione Google Calendar automatica |
| **Venditori** | Preparare e chiudere appuntamenti, tracciare esiti | Elimina la perdita di informazioni nel passaggio GDO→Venditore | Profilo lead completo con timeline; agenda sincronizzata; esito rapido con dettaglio prodotto/importo |
| **Manager** | Monitorare performance team, identificare colli di bottiglia, impostare target | Elimina la necessità di report manuali e riunioni per avere visibilità | Dashboard real-time multi-livello; alert automatici su calo performance; gestione target e gamification centralizzata |
| **Marketing** | Analizzare ROI per canale, ottimizzare budget | Elimina il gap informativo tra spesa marketing e conversioni effettive | ROAS per funnel, breakdown per GDO, tracking end-to-end dalla lead alla chiusura |

### 6.2 Differenziatori Chiave
1. **Gamification RPG nativa**: Non un add-on, ma parte integrante dell'esperienza (XP, Livelli, Evoluzione Fenice, Shop, Sprint).
2. **Funnel end-to-end in un'unica piattaforma**: GDO → Conferme → Venditori senza strumenti terzi.
3. **Real-time first**: Ogni azione è visibile istantaneamente a tutto il team tramite Supabase Realtime.
4. **Costruito su misura**: Ogni feature rispecchia esattamente il workflow di Fenice Academy.

---

## 7. Solution

### 7.1 Feature Attualmente Implementate (AS-IS)

---

#### DOMINIO A: Pipeline GDO & Gestione Lead

**A1. Pipeline Board Kanban** — `P0 Must Have` ✅ Implementato
> Come GDO, voglio vedere i miei lead organizzati per tentativo di chiamata (1°, 2°, 3°, 4° chiamata + Richiami), così da sapere sempre chi chiamare per primo.

Acceptance Criteria:
- [x] Board Kanban con colonne per stage di chiamata (Prima, Seconda, Terza, Quarta Chiamata)
- [x] Sezione Richiami separata con scadenze
- [x] Lead Card con info contatto, badge stato, azioni rapide
- [x] Watcher per richiami scaduti con alert visivo
- [x] Bottone copia numero telefono visibile

**A2. Esito Chiamata (OutcomeModal + QuickActions)** — `P0 Must Have` ✅ Implementato
> Come GDO, voglio registrare rapidamente l'esito di ogni chiamata (non risposto, richiamo, appuntamento, scarto), così che il lead avanzi automaticamente nello stage corretto.

Acceptance Criteria:
- [x] Modal con 4 esiti: NON_RISPOSTO, RICHIAMO (con data), APPUNTAMENTO (con data/nota), DA_SCARTARE (con motivo)
- [x] Quick Actions inline sulle LeadCard per azioni rapide
- [x] Avanzamento automatico del lead nello stage successivo
- [x] Incremento `callCount` e aggiornamento `lastCallDate`
- [x] Log evento in `leadEvents` per audit trail

**A3. Gestione Richiami** — `P0 Must Have` ✅ Implementato
> Come GDO, voglio un'agenda dei richiami con evidenza di quelli scaduti, così da non perdere mai un follow-up.

Acceptance Criteria:
- [x] RecallBoard con separazione Scaduti (rosso) vs Prossimi
- [x] Ordinamento per data di richiamo
- [x] Badge conteggio richiami visibile nel Sidebar
- [x] Possibilità di esitare direttamente dalla lista richiami

**A4. Gestione Appuntamenti** — `P0 Must Have` ✅ Implementato
> Come GDO, voglio vedere i miei appuntamenti futuri e passati, e poterli modificare se necessario.

Acceptance Criteria:
- [x] AppointmentBoard con tab Prossimi / Passati
- [x] EditAppointmentModal per modifica data/ora/note
- [x] Conteggio totale appuntamenti

**A5. Quarta Chiamata (Recovery)** — `P1 Should Have` ✅ Implementato
> Come GDO con performance sotto il 14% nell'ultima settimana, voglio accedere alla colonna "4° Chiamata" per recuperare lead non contattati.

Acceptance Criteria:
- [x] Verifica automatica eligibilità basata su performance 7 giorni
- [x] Colonna 4° Chiamata visibile solo se eligibile

**A6. Ricerca Lead Globale** — `P0 Must Have` ✅ Implementato
> Come utente, voglio cercare qualsiasi lead per nome, telefono o email dalla Topbar, così da accedere rapidamente al suo profilo.

Acceptance Criteria:
- [x] Barra di ricerca nella Topbar
- [x] Ricerca full-text su name, phone, email
- [x] Apertura ContactDrawer con profilo completo e timeline eventi
- [x] Azioni rapide nel ContactDrawer per esiti

---

#### DOMINIO B: Conferme

**B1. Board Conferme Multi-Vista** — `P0 Must Have` ✅ Implementato
> Come operatore Conferme, voglio gestire gli appuntamenti da confermare con vista Kanban per fascia oraria, così da organizzare le chiamate di conferma in modo efficiente.

Acceptance Criteria:
- [x] ConfermeBoard con vista Kanban raggruppata per ora
- [x] Filtri per fascia oraria e stato
- [x] Vista tabellare alternativa
- [x] Gestione timezone Europe/Rome

**B2. Workflow Conferme Completo** — `P0 Must Have` ✅ Implementato
> Come operatore Conferme, voglio poter confermare, scartare, snoozare o richiamare un appuntamento, con tracking di fino a 3 tentativi di chiamata.

Acceptance Criteria:
- [x] ConfermeDrawer con tab dati lead, note, esiti
- [x] Esito Conferma: assegna a venditore, crea evento Google Calendar, check FreeBusy
- [x] Esito Scarto: con motivo
- [x] Snooze con flag VSL (Video Sales Letter)
- [x] Richiamo con rischedulazione e aggiornamento calendario
- [x] Tracking fino a 3 tentativi di non-risposta
- [x] Note collaborative del team Conferme
- [x] Optimistic concurrency control su modifica dati lead

**B3. KPI Conferme** — `P1 Should Have` ✅ Implementato
> Come operatore Conferme o Manager, voglio vedere le metriche di conferma giornaliere/settimanali con target a tier.

Acceptance Criteria:
- [x] Stats giornaliere e settimanali
- [x] Target Tier 1 e Tier 2 con varianza
- [x] Alert badge su performance
- [x] Ranking venditori per conferme assegnate

---

#### DOMINIO C: Venditori

**C1. Dashboard Venditore** — `P0 Must Have` ✅ Implementato
> Come Venditore, voglio vedere i miei appuntamenti confermati, registrare gli esiti e tracciare le mie performance.

Acceptance Criteria:
- [x] Lista appuntamenti con filtri
- [x] Vista agenda
- [x] VenditoreDrawer per registrare esito: Chiuso (prodotto + importo), Non chiuso (motivo), Sparito
- [x] Integrazione Google Calendar (OAuth2)
- [x] Notifiche a GDO e Conferme su esito registrato

**C2. KPI Venditori** — `P1 Should Have` ✅ Implementato
> Come Manager, voglio monitorare le performance di chiusura dei venditori per periodo.

Acceptance Criteria:
- [x] Metriche per periodo (oggi, settimana, mese)
- [x] Tasso di chiusura
- [x] Revenue totale
- [x] Breakdown per venditore

---

#### DOMINIO D: Gamification RPG

**D1. Sistema XP & Leveling** — `P0 Must Have` ✅ Implementato
> Come GDO, voglio guadagnare XP per ogni azione di valore (fissare appuntamento, lead presenziato, deal chiuso), così da salire di livello e sentirmi ricompensato.

Acceptance Criteria:
- [x] XP Awards: FISSATO (10 XP), PRESENZIATO (50 XP), CHIUSO (200 XP + 50 coins), BONUS_SETTIMANALE (500 XP + 100 coins)
- [x] Curva esponenziale: TargetXP = 100 × Level^1.5
- [x] 5 stadi evolutivi: Uovo → Pulcino → Fenice Giovane → Fenice di Fuoco → Divinità Fenice
- [x] Milestone coins: Lvl 5 (30), Lvl 10 (100), Lvl 20 (300), Lvl 30 (1000), Lvl 50 (5000)
- [x] Profilo RPG visuale con avatar evoluzione

**D2. Fenice Store** — `P1 Should Have` ✅ Implementato
> Come GDO, voglio spendere le mie Fenice Coins in oggetti cosmetici (skin, badge, sfondi) per personalizzare il mio profilo.

Acceptance Criteria:
- [x] Shop con items acquistabili
- [x] Wallet coins visibile nella Topbar
- [x] Inventario personale
- [x] Equip/Unequip skin con CSS personalizzato
- [x] Admin panel per gestione items (crea, modifica, attiva/disattiva)
- [x] Transaction log per ogni acquisto

**D3. Sprint Competitivi** — `P1 Should Have` ✅ Implementato
> Come Manager, voglio lanciare Sprint a tempo (es. 2 ore) dove i GDO competono per il maggior numero di appuntamenti, con premio in coins per il vincitore.

Acceptance Criteria:
- [x] SprintBanner con countdown real-time
- [x] Leaderboard sprint live con skin equipaggiate
- [x] Auto-completamento alla scadenza
- [x] Premio coins al vincitore (supporto multi-vincitori in caso di pareggio)
- [x] Start/Stop manuale da Manager

**D4. Leaderboard & Classifica** — `P1 Should Have` ✅ Implementato
> Come GDO, voglio vedere la classifica giornaliera/settimanale/mensile per sapere come mi posiziono rispetto ai colleghi.

Acceptance Criteria:
- [x] Classifica per oggi, settimana, mese
- [x] Ranking per appuntamenti fissati
- [x] Tie-breaking per appuntamento più recente
- [x] Notifica quando qualcuno ti supera in classifica

**D5. Team Goals** — `P1 Should Have` ✅ Implementato
> Come Manager, voglio creare obiettivi di team con deadline e ricompensa in coins, distribuita a tutti i GDO attivi al raggiungimento.

Acceptance Criteria:
- [x] Creazione goal con titolo, target, deadline, reward
- [x] Progress bar visuale (TeamGoalBanner)
- [x] Auto-valutazione al nuovo appuntamento
- [x] Distribuzione coins e notifica a tutti i GDO attivi

**D6. Weekly Bonus** — `P1 Should Have` ✅ Implementato
> Come GDO, voglio vedere il mio progresso verso il bonus settimanale con target a tier.

Acceptance Criteria:
- [x] Widget bonus settimanale con progresso
- [x] Target Tier 1 e Tier 2 configurabili dal Manager
- [x] Reward EUR per tier raggiunto

---

#### DOMINIO E: Manager & Analytics

**E1. Dashboard KPI Team** — `P0 Must Have` ✅ Implementato
> Come Manager, voglio una dashboard aggregata con KPI di team, ranking per GDO e trend temporali.

Acceptance Criteria:
- [x] KPI aggregati (chiamate, risposte, appuntamenti, tassi conversione)
- [x] Ranking GDO per performance
- [x] Grafici trend (LineChart per chiamate/appuntamenti per ora/giorno)

**E2. Gestione Team** — `P0 Must Have` ✅ Implementato
> Come Manager, voglio creare e gestire gli account del team, impostare target individuali e modificare profili.

Acceptance Criteria:
- [x] Seed account GDO (105-119) con password
- [x] Lista team con editing inline (display name, avatar, stato attivo)
- [x] Target giornalieri appuntamenti e settimanali confermati per GDO
- [x] Target tier Conferme

**E3. Manager Targets & Forecast** — `P0 Must Have` ✅ Implementato
> Come Manager, voglio impostare target mensili aziendali e vedere il confronto actual vs target con forecast.

Acceptance Criteria:
- [x] Target mensili: appuntamenti fissati, confermati, trattative, chiusi, valore contratti
- [x] Dashboard actual vs target con medie giornaliere
- [x] Alert automatico quando performance -20% per 7+ giorni consecutivi
- [x] Board operativa con dettaglio per GDO

**E4. Analytics Qualità** — `P1 Should Have` ✅ Implementato
> Come Manager, voglio analizzare i motivi di scarto, i tassi di conversione per stage e identificare i colli di bottiglia.

Acceptance Criteria:
- [x] Analisi funnel conversione
- [x] Ranking motivi di scarto
- [x] Identificazione bottleneck
- [x] Filtri per GDO e per funnel

**E5. Marketing Analytics** — `P1 Should Have` ✅ Implementato
> Come responsabile Marketing, voglio vedere il ROAS per funnel, tracciare il budget speso e correlare investimento a chiusure.

Acceptance Criteria:
- [x] ROAS per funnel (lead → appuntamento → conferma → show-up → chiuso → revenue)
- [x] Budget mensile per funnel
- [x] Breakdown per GDO
- [x] Vista dedicata per utente Marketing

**E6. Monitor Pause** — `P1 Should Have` ✅ Implementato
> Come Manager, voglio monitorare le pause dei GDO in real-time, con report giornaliero e tracking sforamenti.

Acceptance Criteria:
- [x] Dashboard pause con stato real-time per GDO
- [x] Report giornaliero aggregato
- [x] Tracking sforamenti con secondi eccedenti
- [x] Override manuale con motivo

**E7. RPG Monitor** — `P2 Nice to Have` ✅ Implementato
> Come Manager, voglio monitorare i profili RPG di tutti i GDO e poter assegnare coins manualmente.

Acceptance Criteria:
- [x] Vista tutti i profili RPG ordinati per livello
- [x] Modifica salario base
- [x] Assegnazione manuale coins

**E8. GDO Performance Mensile** — `P1 Should Have` ✅ Implementato
> Come Manager, voglio tabelle di performance mensile per GDO con breakdown per funnel e settimane.

Acceptance Criteria:
- [x] Tabelle mensili per GDO
- [x] Conversione per funnel
- [x] Filtro per mese

---

#### DOMINIO F: Infrastruttura & Sistema

**F1. Import Lead CSV** — `P0 Must Have` ✅ Implementato
> Come Manager/Admin, voglio importare lead da CSV con distribuzione automatica tra i GDO.

Acceptance Criteria:
- [x] Upload CSV con parsing (Papa Parse)
- [x] Mapping colonne (nome, cognome, email, telefono)
- [x] Deduplicazione su telefono
- [x] Distribuzione: modalità equal o quota personalizzata
- [x] Preview distribuzione prima di importare
- [x] Log import con statistiche (importati, duplicati, invalidi)

**F2. Notifiche Real-Time** — `P0 Must Have` ✅ Implementato
> Come utente, voglio ricevere notifiche in tempo reale quando un lead mi viene assegnato, quando qualcuno mi supera in classifica, o quando un goal di team viene raggiunto.

Acceptance Criteria:
- [x] Supabase Realtime WebSocket
- [x] Toast notification su eventi
- [x] Badge unread nella Topbar
- [x] Mark as read singolo e batch

**F3. Alert Interni** — `P1 Should Have` ✅ Implementato
> Come Manager, voglio inviare alert broadcast o targettizzati al team.

Acceptance Criteria:
- [x] Alert broadcast (a tutti) o targeted (a singolo utente)
- [x] Modal bloccante con acknowledgment
- [x] Auto-cleanup alert > 1 giorno
- [x] Queue management per alert multipli

**F4. Google Calendar Sync** — `P1 Should Have` ✅ Implementato
> Come Venditore/Conferme, voglio che gli appuntamenti confermati vengano sincronizzati automaticamente con Google Calendar.

Acceptance Criteria:
- [x] OAuth2 Google per connessione calendario
- [x] Creazione evento automatica su conferma appuntamento
- [x] Check FreeBusy prima di conferma
- [x] Aggiornamento/cancellazione evento su rischedulazione

**F5. Event Logging & Audit Trail** — `P0 Must Have` ✅ Implementato
> Come sistema, ogni interazione su un lead deve essere loggata per tracciabilità e compliance.

Acceptance Criteria:
- [x] Event types: IMPORTED, ASSIGNED, CALL_LOGGED, SECTION_MOVED, DISCARDED, RECALL_SET, APPOINTMENT_SET
- [x] Tracking sezione from/to
- [x] User attribution
- [x] Metadata JSONB flessibile
- [x] Timeline visibile nel ContactDrawer

**F6. Archivio & Export** — `P1 Should Have` ✅ Implementato
> Come Manager, voglio accedere all'archivio dei lead chiusi con filtri avanzati e possibilità di export.

Acceptance Criteria:
- [x] Filtri: range date, GDO, venditore, esito
- [x] Paginazione
- [x] Export lead scartati con email per campagne re-marketing

---

### 7.2 Feature da Sviluppare (TO-BE — Roadmap)

---

#### DOMINIO G: Automazione & Intelligenza

**G1. Lead Scoring AI-Driven** — `P1 Should Have` 🔲 Da sviluppare
> Come GDO, voglio che i lead nella mia pipeline abbiano un punteggio di qualità predittivo, così da chiamare per primi quelli con più probabilità di conversione.

Acceptance Criteria:
- [ ] Modello di scoring basato su: funnel di provenienza, storico conversioni per funnel, fascia oraria, numero tentativi
- [ ] Badge visuale sul LeadCard (🔥 Hot, ⚡ Warm, ❄️ Cold)
- [ ] Ordinamento pipeline per score
- [ ] Aggiornamento score in background dopo ogni interazione

**G2. Report Automatici Schedulati** — `P2 Nice to Have` 🔲 Da sviluppare
> Come Manager, voglio ricevere report giornalieri/settimanali automatici via email o alert interno con le metriche chiave.

Acceptance Criteria:
- [ ] Configurazione frequenza (giornaliero, settimanale)
- [ ] Template report con KPI principali
- [ ] Invio via email o alert interno
- [ ] Highlight anomalie e trend negativi

**G3. Alert Intelligenti su Anomalie** — `P1 Should Have` 🔲 Da sviluppare
> Come Manager, voglio essere avvisato automaticamente quando un GDO ha un calo improvviso di performance, un picco di scarti, o un pattern anomalo.

Acceptance Criteria:
- [ ] Monitoraggio continuo vs media mobile 7 giorni
- [ ] Alert su: calo >30% chiamate, tasso scarto >50%, zero appuntamenti per 2+ giorni
- [ ] Notifica push al Manager
- [ ] Suggerimento azione correttiva

**G4. Auto-Riassegnazione Lead Inattivi** — `P2 Nice to Have` 🔲 Da sviluppare
> Come sistema, voglio riassegnare automaticamente i lead non lavorati da più di X giorni a GDO attivi, così da non sprecare opportunità.

Acceptance Criteria:
- [ ] Configurazione soglia inattività (es. 3, 5, 7 giorni)
- [ ] Riassegnazione round-robin tra GDO attivi
- [ ] Notifica al GDO originale e al nuovo assegnatario
- [ ] Log evento di riassegnazione

---

#### DOMINIO H: UX & Mobile

**H1. Responsive Mobile-First** — `P1 Should Have` 🔲 Da sviluppare
> Come Venditore in movimento, voglio poter usare il CRM dal telefono con un'esperienza ottimizzata, senza dover fare zoom o scroll orizzontale.

Acceptance Criteria:
- [ ] Sidebar collassabile o bottom navigation su mobile
- [ ] Card e drawer ottimizzati per touch
- [ ] Tabelle responsive (scroll orizzontale o card view)
- [ ] Font size e touch target conformi alle guidelines mobile

**H2. PWA (Progressive Web App)** — `P2 Nice to Have` 🔲 Da sviluppare
> Come utente, voglio installare il CRM come app sul mio dispositivo con supporto offline per le informazioni base.

Acceptance Criteria:
- [ ] Manifest.json e Service Worker
- [ ] Installabile su Android/iOS
- [ ] Cache offline per profilo e ultimo stato pipeline
- [ ] Sync automatico al ritorno online

**H3. Dark Mode** — `P3 Future` 🔲 Da sviluppare
> Come utente, voglio poter attivare la dark mode per ridurre l'affaticamento visivo nelle sessioni serali.

Acceptance Criteria:
- [ ] Toggle dark/light nella Topbar o profilo
- [ ] Tutti i componenti con varianti dark
- [ ] Persistenza preferenza utente

---

#### DOMINIO I: Comunicazione & Collaborazione

**I1. Chat Interna Team** — `P2 Nice to Have` 🔲 Da sviluppare
> Come membro del team, voglio poter inviare messaggi rapidi ai colleghi direttamente dal CRM, senza dover uscire dall'app.

Acceptance Criteria:
- [ ] Chat 1:1 tra utenti
- [ ] Chat di gruppo per team (GDO, Conferme, Venditori)
- [ ] Real-time tramite Supabase Realtime
- [ ] Notifica su nuovo messaggio
- [ ] Storico messaggi persistente

**I2. Note Collaborative sui Lead** — `P1 Should Have` 🔲 Da sviluppare
> Come team cross-funzionale (GDO + Conferme + Venditori), voglio che le note su un lead siano visibili a tutti i ruoli coinvolti, non solo al team Conferme.

Acceptance Criteria:
- [ ] Sistema note unificato accessibile da ContactDrawer, ConfermeDrawer e VenditoreDrawer
- [ ] Attributo ruolo e autore su ogni nota
- [ ] Timeline note integrata nella timeline eventi

**I3. Integrazione WhatsApp/SMS** — `P2 Nice to Have` 🔲 Da sviluppare
> Come GDO, voglio poter inviare un messaggio WhatsApp o SMS precompilato al lead direttamente dal CRM.

Acceptance Criteria:
- [ ] Link WhatsApp `wa.me/{phone}` con testo precompilato
- [ ] Template messaggi configurabili dal Manager
- [ ] Log invio nella timeline eventi

---

#### DOMINIO J: Analytics Avanzati

**J1. Dashboard Forecasting** — `P2 Nice to Have` 🔲 Da sviluppare
> Come Manager, voglio una proiezione a fine mese basata sul trend attuale, con scenario best/worst/expected.

Acceptance Criteria:
- [ ] Proiezione lineare basata su media ultimi 7/14/30 giorni
- [ ] Tre scenari: ottimista, realistico, pessimista
- [ ] Grafico proiezione vs target
- [ ] Alert se forecast < 80% del target

**J2. Funnel Analysis Interattivo** — `P2 Nice to Have` 🔲 Da sviluppare
> Come Manager/Marketing, voglio un grafico a imbuto interattivo che mostri le conversioni stage by stage con drill-down.

Acceptance Criteria:
- [ ] Visualizzazione funnel: Lead → Chiamato → Appuntamento → Confermato → Presenziato → Chiuso
- [ ] Click su stage per drill-down
- [ ] Filtri per periodo, funnel, GDO
- [ ] Confronto tra periodi

**J3. Heatmap Attività** — `P3 Future` 🔲 Da sviluppare
> Come Manager, voglio vedere una heatmap delle attività per ora/giorno per capire quando il team è più produttivo.

Acceptance Criteria:
- [ ] Matrice giorni × ore con intensità colore
- [ ] Metriche: chiamate, appuntamenti, chiusure
- [ ] Filtro per GDO singolo o aggregato

---

#### DOMINIO K: Gamification Avanzata

**K1. Achievement & Badge System** — `P2 Nice to Have` 🔲 Da sviluppare
> Come GDO, voglio sbloccare achievement permanenti (es. "100 Appuntamenti", "Prima Chiusura", "Streak 5 giorni") che celebrano i miei traguardi.

Acceptance Criteria:
- [ ] Catalogo achievement con icone e descrizioni
- [ ] Unlock automatico al raggiungimento condizione
- [ ] Notifica celebrativa con animazione
- [ ] Vetrina achievement nel profilo

**K2. Sfide 1v1** — `P3 Future` 🔲 Da sviluppare
> Come GDO, voglio poter sfidare un collega in una competizione 1v1 a tempo, per rendere la giornata più stimolante.

Acceptance Criteria:
- [ ] Invio sfida a collega
- [ ] Durata configurabile (1h, 2h, giornata)
- [ ] Metrica: appuntamenti o chiamate
- [ ] Premio coins al vincitore
- [ ] Storico sfide nel profilo

**K3. Seasonal Events** — `P3 Future` 🔲 Da sviluppare
> Come Manager, voglio lanciare eventi stagionali (es. "Settimana Infuocata", "Black Friday Challenge") con regole e premi speciali.

Acceptance Criteria:
- [ ] Template evento con nome, durata, regole, premi
- [ ] Moltiplicatore XP/Coins durante evento
- [ ] Banner evento nella dashboard
- [ ] Leaderboard evento separata

---

### 7.3 Requisiti Non-Funzionali (NFR)

| Categoria | Requisito Attuale | Target Futuro |
|-----------|------------------|---------------|
| **Performance** | Page load ~2-3s | < 1.5s al p95 |
| **Scalabilità** | 20-30 utenti concorrenti | 100+ utenti concorrenti |
| **Disponibilità** | 99.5% (Vercel + Supabase) | 99.9% uptime |
| **Sicurezza** | Supabase Auth + SSR, password bcrypt | + 2FA, audit log accessi, RLS Supabase |
| **Accessibilità** | Base (keyboard navigation parziale) | WCAG 2.1 AA |
| **Backup** | Supabase automatic daily | + Point-in-time recovery, backup cross-region |
| **Monitoring** | Console logs | Sentry error tracking, Vercel Analytics |

### 7.4 Dipendenze

| Dipendenza | Owner | Stato | Note |
|------------|-------|-------|------|
| Supabase (DB + Auth + Realtime) | Supabase Inc. | ✅ Attivo | Piano Pro consigliato per produzione |
| Vercel (Hosting) | Vercel Inc. | ✅ Attivo | Deploy automatico da Git |
| Google Calendar API | Google | ✅ Attivo | OAuth2, necessita rinnovo credenziali periodico |
| Domini/DNS | Team Fenice | ✅ Attivo | — |

### 7.5 Rischi & Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|-------------|---------|------------|
| **WSOD da hydration error** | Media | Alto (app inaccessibile) | Regola rigida: mai `<button>` dentro `<span>`/`<p>`. Test pre-deploy. |
| **Supabase Realtime disconnection** | Bassa | Medio (dati non aggiornati) | Reconnect automatico + fallback polling ogni 30s |
| **Google OAuth token expiry** | Media | Medio (calendario non sincronizzato) | Refresh token automatico, alert su failure |
| **Concurrency conflict su lead** | Media | Basso (retry utente) | Optimistic locking con campo `version` |
| **Performance degradation con crescita dati** | Media | Medio | Indici DB su colonne query, paginazione, archivio lead vecchi |
| **Vendor lock-in Supabase** | Bassa | Alto | Schema Drizzle portabile, PostgreSQL standard |

---

## 8. Release Plan

### 8.1 Milestone

| Fase | Milestone | Stato | Priorità |
|------|-----------|-------|----------|
| **v1.0 — Foundation** | Pipeline GDO, Esiti, Richiami, Import CSV | ✅ Completato | P0 |
| **v1.1 — Conferme & Venditori** | Board Conferme, Dashboard Venditore, Google Calendar | ✅ Completato | P0 |
| **v1.2 — Gamification Core** | XP/Leveling, Store, Sprint, Leaderboard, Team Goals | ✅ Completato | P0 |
| **v1.3 — Analytics & Manager** | KPI multi-livello, Marketing Analytics, Monitor Pause, Target | ✅ Completato | P1 |
| **v1.4 — Polish & Stability** | Fix hydration, Quick Actions, ContactDrawer enhancement | ✅ Completato | P0 |
| **v2.0 — Intelligence** | Lead Scoring, Alert Intelligenti, Note Collaborative | 🔲 Pianificato | P1 |
| **v2.1 — Mobile & UX** | Responsive mobile-first, PWA | 🔲 Pianificato | P1 |
| **v2.2 — Communication** | WhatsApp link, Chat interna, SMS template | 🔲 Pianificato | P2 |
| **v2.3 — Advanced Analytics** | Forecasting, Funnel interattivo, Heatmap | 🔲 Pianificato | P2 |
| **v2.4 — Gamification+** | Achievement, Sfide 1v1, Seasonal Events | 🔲 Pianificato | P3 |

### 8.2 Success Metrics

| Metrica | Attuale (Baseline) | Target v2.0 | Timeline |
|---------|-------------------|-------------|----------|
| Tasso di appuntamenti fissati / lead lavorati | Da misurare | +15% | Q3 2026 |
| Tasso di show-up (presenze effettive) | Da misurare | +20% | Q3 2026 |
| Tasso di chiusura venditori | Da misurare | +10% | Q4 2026 |
| Tempo medio per esitare un lead | Da misurare | -30% | Q3 2026 |
| Engagement gamification (% GDO che interagisce con store/sprint) | Da misurare | >80% | Q3 2026 |
| Uptime piattaforma | ~99.5% | 99.9% | Q3 2026 |
| NPS operatori interni | Da misurare | >50 | Q4 2026 |

---

## Appendici

### A. Glossario

| Termine | Definizione |
|---------|------------|
| **GDO** | Gestione Dati Operativa — Operatori call center che lavorano i lead |
| **Conferme** | Team che valida e conferma gli appuntamenti fissati dai GDO |
| **Venditori / Closer** | Persone che effettuano l'incontro di vendita e chiudono il deal |
| **Lead** | Contatto acquisito tramite campagne marketing |
| **Funnel** | Canale/campagna di acquisizione marketing del lead |
| **ROAS** | Return On Ad Spend — Ritorno sull'investimento pubblicitario |
| **Fenice Coins** | Valuta virtuale del sistema di gamification |
| **Sprint** | Competizione a tempo tra GDO con premio al vincitore |
| **WSOD** | White Screen of Death — Crash dell'app visibile all'utente |
| **Pipeline** | Flusso visuale di avanzamento dei lead per stage |

### B. Mappa Ruoli ↔ Pagine

Vedi tabella completa nella Sezione 3.3.

### C. Schema Database

Documentazione completa delle 21 tabelle in `src/db/schema.ts`. Riferirsi alla sezione 3.3 per overview e al file sorgente per i dettagli.

---

*Documento generato il 2026-04-06. Prossima revisione pianificata: al completamento della fase v2.0.*
