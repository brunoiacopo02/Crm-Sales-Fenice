# Design — "Inizia trattativa" sempre accessibile dalla scheda del lead

**Data:** 2026-06-27
**Contesto:** feature Scheda Trattativa (merge `2d847dd`). Segnalazione: il venditore (Sales 008, lead Monica Rita) non vede come avviare/proseguire la trattativa quando apre il lead. Oggi il bottone "▶ Inizia trattativa" vive solo nella riga della lista e sparisce dopo il primo check-in; la riga di un lead non avviato non è cliccabile; il briefing non viene ri-mostrato riaprendo un lead già avviato.

## Obiettivo
Rendere l'azione di check-in trattativa **sempre raggiungibile dalla scheda (drawer) del lead**, mantenendo il bottone anche nella riga (doppio punto d'accesso), senza alterare le guardie server né la regola "remoto-only" (telefono gated dietro il check-in).

## Decisioni approvate dall'utente
1. **Doppio punto d'accesso:** bottone "▶ Inizia trattativa" sia nella **riga** sia dentro la **scheda**; la riga diventa **sempre cliccabile** (apre il drawer anche se la trattativa non è avviata).
2. **Telefono pre-check-in: nascosto** nella scheda finché non si fa il check-in (coerente con remoto-only).

## Comportamento

### `VenditoreDashboardClient.tsx`
- Riga: rimuovere il guard `if (!isGated)` su `onClick` → la riga apre **sempre** `setSelectedLead(app)`. Cursore sempre `pointer`.
- Mantenere il bottone "▶ Inizia trattativa" nella colonna Stato per i lead non avviati (con `stopPropagation`).
- All'apertura del drawer per un lead **già avviato** (`negotiationStartedAt` valorizzato), caricare il briefing via `getLeadBriefing(app.id)` così la card briefing riappare (fix bug noto).
- Passare al drawer una callback `onStartNegotiation(leadId)` che esegue lo stesso flusso di `handleStartNegotiation` (check-in + carica briefing + sblocca telefono) e aggiorna lo stato locale del lead selezionato.

### `VenditoreDrawer.tsx`
- Calcolare `isStarted = !!lead.negotiationStartedAt` (riflette anche l'avvio appena fatto dalla scheda).
- **Se NON avviata:**
  - Bandella/box in cima con bottone grande **"▶ Inizia trattativa"** → chiama `onStartNegotiation(lead.id)`.
  - Telefono **nascosto** (placeholder tipo "Numero visibile dopo l'avvio della trattativa").
  - Form esito (select esito, sottoform, sondaggio, note, bottone Salva) **bloccato/nascosto** finché non parte la trattativa.
- **Se avviata:** comportamento attuale invariato (telefono visibile, form esito, sondaggio obbligatorio, ecc.).

## Cosa NON cambia
- Guardie server `saveVenditoreOutcome` (esige check-in + sondaggio), esenzione MANAGER/ADMIN.
- `OutcomeGate` (overlay esiti arretrati), sondaggio obbligatorio, logica KPI/gamification.
- Server action `startNegotiation` e `getLeadBriefing` (riuso, nessuna modifica di firma necessaria salvo verifica role guard già presente).

## File toccati
- `src/components/VenditoreDashboardClient.tsx`
- `src/components/VenditoreDrawer.tsx`

## Test manuale (Sales 008)
1. Lead non avviato: la riga è cliccabile → scheda mostra "▶ Inizia trattativa", telefono nascosto, form bloccato. Click → telefono+briefing+form compaiono.
2. Bottone nella riga: continua a funzionare (apre scheda già avviata con briefing).
3. Lead già avviato (Monica Rita): riapertura mostra briefing + telefono + form esito.
4. Salvataggio esito: invariato (sondaggio obbligatorio per Chiuso/Non chiuso, funnel≠database).
