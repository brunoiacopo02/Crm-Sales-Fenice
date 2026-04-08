# CRM Fenice — Roadmap di Sviluppo Strutturata

**Data creazione:** 2026-04-06  
**Stato:** Approvato per esecuzione  
**Metodo:** Agentic Loop (Claude Code autonomo, fase per fase)

---

## Legenda Stato

- ⬜ Da fare
- 🔄 In corso
- ✅ Completato
- 🔒 Deferito (da affrontare più avanti, su richiesta)

---

## FASE 0 — Verifica & Stabilità Critica

> **Obiettivo:** Assicurarsi che tutto ciò che è già stato fatto funzioni correttamente, fix dei problemi bloccanti, e preparare l'ambiente operativo.

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 0.1 | ⬜ Audit completo feature "verdi" | Ricontrollare sistematicamente che tutte le feature segnate come completate funzionino realmente: notifiche live, KPI conferme, archivio manager, dashboard conferme, account marketing, favicon, realtime DB, notifica richiami GDO | |
| 0.2 | ⬜ Fix integrazione Google Calendar | Il calendar non manda più l'invito via email e non mette più l'appuntamento sul calendario. Debug e fix completo del flusso OAuth → creazione evento → invito partecipanti | |
| 0.3 | ⬜ Setup 16 account GDO funzionanti | Verificare che gli account esistenti (105-119) funzionino tutti. Attualmente testato solo il 114. Creare quelli mancanti per arrivare a 16 account attivi e funzionanti totali | |
| 0.4 | ⬜ Test concurrency multi-utente | Testare che il CRM funzioni correttamente con più persone che lavorano contemporaneamente: pipeline, esiti, notifiche real-time, optimistic locking sui lead | |

---

## FASE 1 — Correzioni & Bug Fix

> **Obiettivo:** Applicare tutte le correzioni dal documento "Correzioni CRM" e i bug noti.

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 1.1 | ⬜ Performance GDO: aggiungere dati mancanti | Nella sezione "Performance GDO" aggiungere: numero dei lead assegnati e percentuale di fissaggio | |
| 1.2 | ⬜ Marketing Analytics: aggiungere dati mancanti | Nella sezione "Marketing Analytics" aggiungere: numero dei lead assegnati e percentuale di fissaggio | |
| 1.3 | ⬜ Riorganizzare Dashboard Operativa | Spostare la tabella "Dashboard operativa aziendale" nella sezione "KPI team GDO". Rimuovere la tabella "classifica GDO" da quella sezione | |
| 1.4 | ⬜ Fix orario KPI Team GDO | Nella tabella "andamento chiamate e appuntamenti" in KPI team GDO, modificare l'orario a 13:30-20:00 | |
| 1.5 | ⬜ Fix Monitor Pause | Il conteggio del tempo in pausa non è corretto. Correggere il calcolo. Aggiungere la possibilità di fare più di 2 pause al giorno | |
| 1.6 | ⬜ Aggiungere esito "Numero inesistente" | Tra le cause di esito lead chiamato, aggiungere l'opzione "Numero inesistente" | |
| 1.7 | ⬜ Fix Import Lead: duplicati e senza nome | Aggiungere opzione per caricare numeri/email duplicati. Permettere di caricare lead senza nome. Più opzioni di caricamento | |

---

## FASE 2 — Feature Core (Dashboard & KPI)

> **Obiettivo:** Completare tutte le dashboard e KPI mancanti, rendere il CRM operativamente completo.

### 2A — Dashboard Sales & Venditori

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 2A.1 | ⬜ Revisione totale dashboard Sales | La dashboard venditori va rivista completamente. I KPI sales mancano totalmente: creare metriche di performance venditori (chiusure, revenue, tasso chiusura, pipeline attiva) | |
| 2A.2 | ⬜ Debug dashboard Sales | Gli appuntamenti confermati non appaiono nella dashboard. Il sistema non li mette più sul calendar quando confermati. Debug e fix completo | |

### 2B — Dashboard GDO Miglioramenti

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 2B.1 | ⬜ Dashboard GDO: aggiungere metriche | Aggiungere nella dashboard GDO: numero chiusure, presenze e conferme dei propri lead | |
| 2B.2 | ⬜ Obiettivi giornalieri sempre visibili | Mostrare sempre in evidenza nella dashboard GDO: numero chiamate da fare e numero lead da fissare al giorno per raggiungere l'obiettivo. Nella dashboard Conferme: numero di confermati da fare ogni giorno | |
| 2B.3 | ⬜ KPI GDO: coefficiente produttività | Aggiungere nella dashboard KPI GDO il coefficiente di produttività (chiamate/ora × percentuale fissaggio, o formula migliore da definire) | |

### 2C — Funzionalità Operative

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 2C.1 | ⬜ Scheda lead editabile dalla ricerca | Quando si ricerca un lead dalla Topbar e si apre il ContactDrawer, i dati devono essere editabili direttamente (nome, telefono, email, note) | |
| 2C.2 | ⬜ Giorni mensili manuali | Permettere al manager di impostare manualmente il numero di giorni lavorativi mensili (attualmente calcolati in automatico). Serve per escludere giorni non lavorativi e ricalcolare le medie giornaliere dei target | |
| 2C.3 | ⬜ Storico pause mensile per GDO | Rendere visibile anche ai GDO lo storico delle proprie pause mensili (attualmente visibile solo ai manager) | |
| 2C.4 | ⬜ Aggiungere lead singoli manualmente | Creare sezione/modale per aggiungere manualmente lead singoli organici (non da CSV), con form nome, telefono, email, funnel | |
| 2C.5 | ⬜ Aggiustare caricamento lead CSV | Permettere di caricare lead anche senza nome. Aggiungere più opzioni di caricamento/mapping colonne | |

### 2D — Nuove Sezioni

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 2D.1 | ⬜ Note GDO (sistema HR/formazione) | Nuova sezione dove il Team Leader può scrivere commenti e annotazioni su ogni singolo GDO: storico formazione, aspetti positivi/negativi, richiami disciplinari (giornalieri e mensili). Separato dalle note sui lead | |
| 2D.2 | ⬜ Modalità Team Leader: visione appuntamenti | Il Team Leader deve poter vedere tutti gli appuntamenti dei GDO del proprio team (non solo i propri) | |

### 2E — Revisione Gamification (Esperienza Unica)

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 2E.1 | ⬜ Audit e revisione sistema gamification | Analizzare l'intero sistema RPG attuale (XP, livelli, evoluzione Fenice, coins, store, sprint, leaderboard, team goals, weekly bonus) e identificare punti deboli, meccaniche poco ingaggianti e opportunità di miglioramento. Usare la skill `gamification-loops` come riferimento per best practice | |
| 2E.2 | ⬜ Ottimizzare loop di engagement | Migliorare i loop motivazionali: bilanciamento XP/coins, progressione percepita, reward frequency, feedback visivi su azioni, animazioni celebrative su level-up e achievement, effetto "just one more" | |
| 2E.3 | ⬜ Rendere la gamification visivamente immersiva | Migliorare la presentazione visiva del sistema RPG: avatar Fenice più impattanti, animazioni di evoluzione, effetti particellari su reward, progress bar animate, suoni opzionali, theming RPG coerente in tutta l'app | |
| 2E.4 | ⬜ Nuove meccaniche di gioco | Valutare e implementare meccaniche aggiuntive: streak giornaliere, achievement/badge permanenti, sfide settimanali tematiche, loot box con reward randomici, titoli/ranghi personalizzati, seasonal events framework | |

### 2F — Revisione UI/UX Design & Frontend

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 2F.1 | ⬜ Design system con Google Stitch | Usare Google Stitch (MCP server configurato) per generare un design system coerente: palette colori premium, tipografia, spacing, border radius, shadows, componenti base. Esportare `design.md` come riferimento per tutto il progetto | |
| 2F.2 | ⬜ Redesign dashboard principali | Ridisegnare le schermate core (Pipeline GDO, Conferme Board, Venditore Dashboard, Manager KPI) con un look moderno, professionale e premium. Usare Stitch per prototipare e poi implementare in Tailwind. Mantenere tutto funzionante e compatto | |
| 2F.3 | ⬜ Redesign componenti comuni | Migliorare LeadCard, ContactDrawer, Sidebar, Topbar, modali e drawer con design più curato: micro-interazioni, transizioni fluide, hover states, feedback visivi, gerarchia visiva chiara | |
| 2F.4 | ⬜ Redesign sezioni gamification | Rendere Store, Profilo RPG, Sprint Banner, Leaderboard, Team Goals visivamente coinvolgenti e coerenti con il tema Fenice: colori caldi (arancione/rosso/oro), effetti fuoco, iconografia custom | |
| 2F.5 | ⬜ Verifica coerenza e integrità | Dopo tutti i redesign, verificare che nulla si sia rotto: hydration, responsive, funzionalità, performance. Test completo su tutte le pagine | |

---

## FASE 3 — Pre-Lancio

> **Obiettivo:** Ottimizzazione performance e pulizia finale prima del go-live completo.

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 3.1 | ⬜ Velocizzare software | Ottimizzazione performance generale: lazy loading, code splitting, query optimization, caching dove appropriato | |
| 3.2 | ⬜ Debug generale | Pass completo di debug: console errors, warning React, edge case, error handling, UX polish | |

---

## 🔒 DEFERITE — Da affrontare più avanti (su richiesta)

> **Queste task verranno sbloccate solo quando il resto sarà completato e Bruno lo richiederà esplicitamente.**

| # | Task | Note |
|---|------|------|
| D.1 | Dashboard GDO TL come file Excel | Layout, variazione %, alert singoli — servono specifiche dal file Excel |
| D.2 | Costo appuntamento e costo chiusura | Serve la formula di Fede |
| D.3 | Database clienti per follow up | Tabella nuova per clienti post-chiusura |

---

## 🔵 POST-LANCIO — Future (non bloccanti)

> **Non necessarie per lanciare e testare. Da pianificare dopo il go-live.**

| # | Task | Note |
|---|------|------|
| F.1 | Script (?) | Da definire |
| F.2 | Dashboard amministrazione | Pannello admin avanzato |
| F.3 | Buste paga nel software | Caricamento e gestione buste paga |
| F.4 | Cybersecurity | Hardening sicurezza (2FA, RLS, audit) |
| F.5 | Migliorare gamification | Evoluzioni sistema RPG |
| F.6 | Notifiche pagamenti critici venditori | Alert solleciti pagamento |
| F.7 | Pacchetto clienti 24 mesi / commissioni | Analytics clienti e calcolo commissioni |
| F.8 | Link utili per i sales | Sezione risorse/link per venditori |
| F.9 | Integrazione Spoki (WhatsApp) | 🔴 Da capire come fare — piattaforma WhatsApp marketing |

---

## Ordine di Esecuzione Consigliato

```
FASE 0 (Stabilità)       ████████░░  → Prima di tutto
FASE 1 (Bug Fix)         ████████░░  → Subito dopo
FASE 2A (Sales)          ██████░░░░  → Core mancante
FASE 2B (GDO KPI)        ██████░░░░  → Miglioramenti visibilità
FASE 2C (Operativo)      ██████░░░░  → Feature operative
FASE 2D (Nuove Sez.)     ████░░░░░░  → Nuove aree
FASE 2E (Gamification)   ██████░░░░  → Esperienza unica RPG
FASE 2F (UI/UX Design)   ██████░░░░  → Redesign premium con Stitch
FASE 3 (Pre-Lancio)      ████░░░░░░  → Polish finale
DEFERITE                 ░░░░░░░░░░  → Su richiesta
POST-LANCIO              ░░░░░░░░░░  → Dopo go-live
```

---

## Note per l'Esecuzione in Agentic Loop

- Ogni fase va completata e testata prima di passare alla successiva
- Per ogni task: leggere il codice esistente → implementare → verificare compilazione → test manuale
- Rispettare le regole di CLAUDE.md (no `<button>` in `<span>`, timezone Rome, Drizzle ORM only)
- Non toccare i channel Supabase Realtime esistenti
- Commit atomici per ogni task completata
- Le task DEFERITE (D.1, D.2, D.3) NON vanno toccate finché Bruno non lo richiede

---

*Piano creato il 2026-04-06. Aggiornato il 2026-04-06 con Fase 2E (Gamification) e 2F (UI/UX Design).*  
*Totale task operative: 31 (Fase 0-3) + 3 deferite + 9 future.*  
*Tool installati: skill `gamification-loops`, MCP server `stitch-mcp` (Google Stitch).*
