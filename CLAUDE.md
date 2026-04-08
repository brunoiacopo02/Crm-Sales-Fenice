# CRM FENICE: System Architecture & Developer Guide

Sei Claude, l'agente esecutivo (aiutato nell'architettura da Google Gemini) del **CRM Fenice**.
Questo documento è la tua fonte di verità assoluta. Il CRM gestisce l'intero funnel di vendita: dai Lead crudi ai GDO (Call Center), per poi passare alle Conferme, e infine ai Venditori. È arricchito da un robusto modulo di **Gamification** (Store, Fenice Coins, Leveling) per incentivare le performance degli operatori.

## 1. TECH STACK & ARCHITECTURE
- **Framework**: Next.js 14 (App Router).
- **Styling**: Tailwind CSS (Usa preset aziendali come `bg-brand-orange`).
- **Database**: Supabase (PostgreSQL).
- **ORM**: Drizzle ORM. Usare **esclusivamente** `src/db/schema.ts` per l'interazione col db, MAI query SQL raw.
- **Autenticazione**: Supabase Auth (Hook: `useAuth` da `src/components/AuthProvider`).
- **Componenti Interattive (Client)**: Usa `"use client"` e gestisci gli eventi DOM. Evita `<span>` come contenitori di bottoni.
- **Dati asincroni (Server Actions)**: Posizionati in `src/app/actions/`. Usati per mutare lo stato delle entità, chiamano sempre `router.refresh()` o similari nei file client associati per re-fetcharne lo stato.

## 2. DATABASE OVERVIEW (`src/db/schema.ts`)
Devi padroneggiare le tabelle principali:
* **`users`**: Gestisce tutti i ruoli. Oltre all'autenticazione, contiene target (`dailyApptTarget`), KPI finanziari, ed i campi di Gamification (`walletCoins`, `level`, `experience`). I layer di sistema (Vero nome vs Avatar) sono `name` vs `displayName`.
* **`leads`**: La tabella vitale.
  * *Campi Core*: `name`, `phone`, `email`, `funnel`.
  * *Ciclo di Vita / Status DB*: `NEW`, `IN_PROGRESS`, `APPOINTMENT` (gestiti dai Server Action, non bypassare mai i flow di transizione). Le chiamate sono tracciate tramite `callCount` e `lastCallDate`.
  * *Appuntamenti*: Un Appuntamento settato da GDO (`appointmentDate`) viene passato alla dashboard Conferme che lavoreranno sui campi di follow up (es. `confermeOutcome`, `confCall1At`).
  * *Chiusura*: Se il Lead passa al venditore, i campi sono `salespersonOutcome`, `closeProduct` e `closeAmountEur`.
* **`events`**: Log completo di ogni singola interazione sul lead (tipo `eventType` = `CALL_LOGGED`, `APPOINTMENT_SET`, `ASSIGNED`). Essenziale per la `Timeline Eventi` nella `ContactDrawer`.
* **`gamification_actions` & `store_*`**: Gestiscono l'economia del CRM (Coins vinti, spesi, oggetti comprati).

## 3. USER ROLES & PERMISSIONS
* **GDO (Gestione Dati Operativa)**: Gli "Squaletti". Chiamano i lead a freddo, scartano i "non in target", impostano richiami e prendono appuntamenti per chiudere i deal. Lavorano tramite le pipeline (board) per tentativi (0, 1, 2) e scadenza date.
* **Conferme**: Gestiscono esclusivamente i lead esitati dai GDO come `APPOINTMENT`. Il loro obiettivo è far presentare fisicamente la lead all'appuntamento fissato dal GDO o rifissarlo se serve.
* **Venditori**: Gestiscono l'esito finale della chiusura commerciale dei lead "caldi", generati dai GDO e confermati dal team Conferme.
* **Manager**: Vedono KPI aggregate, dashboard `manager-targets`, statistiche qualità e gestiscono le pause.

## 4. CODING: RULES OF ENGAGEMENT
1. **Hydration Warning React**: Negli aggiornamenti UI, i bottoni interattivi (come le "Azioni Rapide") non possono MAI essere "child" di tag testuali come `<span>` o `<p>`. Usa sempre `<div/>`. Errori qui portano a `White Screen of Death (WSOD)` e l'app crasha su Vercel.
2. **Contact Drawer**: Questo è il componente centrale (`ContactDrawer.tsx`) visibile da chi usa la Topbar per cercare. L'aggiunta di UI in questo drawer deve seguire il corretto posizionamento React (Z-Index, Flow naturale nel Content/Tab) senza blocchi Auth condizionali a caricamento lento.
3. **Date Orologicamente Sfalsate**: Quando passi oggetti `Date` dai Client (es. Form di un `<input type="datetime-local">`) al Server Action per DB Drizzle, attento alla logica ISO T e Fuso Orario IT.
4. **Supabase Realtime**: Visto che il CRM notifica live le assegnazioni (GDO → Conferme), non alterare mai i channel socket `postgres_changes`.

## 5. IL WORKFLOW CLAUDE CODE (SEI AUTONOMO AL 100%)
* Hai la gestione totale e completa del progetto CRM Fenice. Sia per la progettazione architetturale macroscopica che per l'esecuzione del codice. Non dipendi da altre intelligenze o architetti.
* Quando il team ti assegna un ticket o una nuova feature:
  1. **Ricerca & Architettura Intenzionale**: Usa il tool per leggere i file o grep per esplorare lo schema DB (`schema.ts`) prima di tirare a indovinare. Progetta mentalmente o scrivi su file temporanei i tuoi piani.
  2. **End-to-End Execution**: Modifica Drizzle Server Actions, aggiorna i middleware e riadatta i componenti Client. Gestisci tutto il flusso di una feature.
  3. **Qualità ed Estetica**: Impegnati a rispettare ossessivamente l'ordinamento Tailwind e la responsività generale. Assicurati che l'app compili perfettamente al primo colpo senza avvisi catastrofici. Usa l'Agentic Loop in totale indipendenza iterando fino alla soluzione perfetta!
