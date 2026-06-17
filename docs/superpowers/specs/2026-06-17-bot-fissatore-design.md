# Bot Fissatore — Design (test su lead Fenice)

**Data:** 2026-06-17
**Stato:** approvato in brainstorming, in attesa di review spec
**Owner:** Bruno

## Obiettivo

Integrare un bot esterno (app di messaggistica già sviluppata, dotata di API Anthropic)
che contatta via messaggio i lead Fenice per fissare appuntamenti, in modalità **test**.
Il bot agisce come un "GDO fantasma" (`gdo205`): riceve lead tramite il round-robin
esistente con un tetto giornaliero, chatta con il lead, e quando fissa rimanda al CRM
l'appuntamento + un **report strutturato con i pain point** che le Conferme possono
sfruttare.

Il principio guida è **riuso massimo della pipeline esistente** (assegnazione, handoff
Conferme, KPI) e **isolamento del test** dietro un singolo account flaggato, così da
poterlo misurare e spegnere facilmente.

## Decisioni di design (dal brainstorming)

1. **Modello di assegnazione: (C)** gdo205 partecipa al round-robin normale insieme
   agli umani, ma esce dalla rotazione quando ha già ricevuto **20 lead nel giorno**.
2. **Canale CRM → bot: (A) Push.** All'assegnazione il CRM fa POST firmato HMAC al
   webhook del bot.
3. **Scope esiti bot → CRM: (C) set completo come un GDO umano** — `APPUNTAMENTO`,
   `DA_SCARTARE`, `RICHIAMO`, `NON_RISPOSTO`. La data appuntamento la decide il bot
   in chat e la manda concreta.
4. **Report: (C) strutturato** — JSON con `summary`, `painPoints[]`, `budgetSignal`,
   `urgency`, `objections[]`, `levaConsigliata`. Card a sezioni nel ConfermeDrawer +
   badge 🤖 sulla card in board. Fallback a testo se la struttura manca.
5. **Gamification: OFF** per il bot. **KPI: ON** (`statsActive=true`, conta nelle medie
   come tutti — su 20 lead la diluizione è trascurabile).
6. **Scope sorgente lead: solo ActiveCampaign.** Il round-robin automatico gira solo nel
   webhook AC; i lead da CSV/import manuale non passano da qui e quindi non vanno al bot.
   Accettato per il test (lead freschi AC = caso d'uso pulito).
7. **Marketing webhook `appointment.set`: resta acceso** anche per i lead del bot
   (è un appuntamento reale).

## Architettura

Tre pezzi nuovi, ben isolati, innestati su componenti esistenti.

```
ActiveCampaign ──webhook──> CRM round-robin ──assegna a gdo205 (cap 20/g)──┐
                                                                            │ push HMAC
                                                                            ▼
                                                                      Bot (app msg)
                                                                            │ chatta
                                                                            │ esito + report
                                                                            ▼ POST HMAC
        Conferme  <──handoff (status=APPOINTMENT)── updateLeadOutcome <── /api/bot/outcome
           ▲                                                                │
           └──── card "🤖 Report Bot" (legge leads.botReport) ─────────────┘
```

### Componente 1 — Account gdo205

Riga `users` reale:

| campo | valore |
|-------|--------|
| `role` | `'GDO'` |
| `companyId` | `'fenice'` |
| `gdoCode` | `205` |
| `isActive` | `true` |
| `acAutoIntake` | `true` (entra nel round-robin AC) |
| `statsActive` | `true` (conta nelle medie manager) |
| `isBot` | `true` **(nuovo flag)** |

`isBot` è l'interruttore unico per: (a) spegnere la gamification, (b) abilitare il
push verso il bot all'assegnazione, (c) marcare i lead per il badge 🤖.

**Schema change:** aggiungere `users.isBot` boolean default `false`.

### Componente 2 — Round-robin con tetto 20/giorno

File: `src/app/api/webhooks/activecampaign/route.ts` (query `eligible`, ~riga 516).

gdo205 partecipa normalmente al pool `eligible`. Si aggiunge una condizione che lo
**esclude quando ha già ≥20 assegnazioni oggi**:

- Conteggio: numero di `leadEvents` con `eventType='ASSIGNED'` e `userId=gdo205`
  con `timestamp >= mezzanotte ora Italia (Europe/Rome)`.
- Se il conteggio ≥ 20, gdo205 viene escluso dalla `WHERE` del pool eligible (gli umani
  restano). Domani il conteggio riparte da zero.
- Implementazione: la condizione si applica **solo** ai GDO con `isBot=true`, così la
  logica resta inerte per tutti gli account umani.

Nota: il limite è per-bot generico (gate su `isBot`), non hardcodato sul singolo
`gdoCode=205`, per non legare il codice a un id specifico.

### Componente 3 — Push CRM → bot all'assegnazione

Dentro il webhook AC, **dopo il commit** della transazione, se il lead è stato assegnato
a un utente con `isBot=true`, si invia (fire-and-forget via `after()`, stesso pattern del
marketing webhook) un POST al bot:

```
POST  $BOT_INTAKE_URL
headers:
  content-type: application/json
  x-bot-signature: sha256=<HMAC-SHA256(body, BOT_WEBHOOK_SECRET)>
body:
  { leadId, name, phone, email, funnel, companyId: 'fenice' }
```

- Kill-switch: se `BOT_INTAKE_ENABLED !== 'true'` non si invia nulla.
- Firma HMAC con la stessa utility di signing dei marketing webhook (riuso di
  `src/lib/marketing-webhooks/signing.ts` o helper equivalente condiviso).
- Best-effort: un fallimento di consegna **non** deve far fallire/rollbackare l'intake
  del lead. (Per il test è accettabile no-retry; un eventuale outbox+retry è un'estensione
  futura, non in scope.)

**Nuovi env:**
- `BOT_INTAKE_URL` — endpoint del bot
- `BOT_WEBHOOK_SECRET` — segreto condiviso HMAC (usato in entrambe le direzioni)
- `BOT_INTAKE_ENABLED` — kill-switch (`'true'` per attivare)

### Componente 4 — Inbound bot → CRM (esito + report)

Nuova route **`POST /api/bot/outcome`**.

**Auth:** header `x-bot-signature: sha256=<hmac>` verificato contro
`BOT_WEBHOOK_SECRET` sul raw body. Rifiuto `401` se non valido.

**Body:**
```jsonc
{
  "leadId": "…",
  "outcome": "APPUNTAMENTO" | "DA_SCARTARE" | "RICHIAMO" | "NON_RISPOSTO",
  "date": "2026-06-20T15:00:00+02:00",   // richiesto per APPUNTAMENTO e RICHIAMO
  "note": "…",                            // opzionale
  "discardReason": "…",                   // per DA_SCARTARE
  "report": {                             // opzionale, tipicamente con APPUNTAMENTO
    "summary": "…",
    "painPoints": ["…", "…"],
    "budgetSignal": "…",
    "urgency": "alta|media|bassa",
    "objections": ["…"],
    "levaConsigliata": "…"
  }
}
```

**Logica della route:**
1. Verifica HMAC sul raw body → `401` se invalido.
2. Carica il lead. Validazioni: deve esistere, `companyId='fenice'`, `assignedToId`
   deve essere un utente con `isBot=true`. Altrimenti `403/404`.
3. Se presente `report`, salva l'oggetto in **`leads.botReport` (jsonb)** (nuovo campo).
4. Chiama l'esistente **`updateLeadOutcome(leadId, outcome, note, date, gdo205Id,
   discardReason)`** — riuso totale della transizione di stato, handoff Conferme,
   marketing webhook. Nessuna logica di stato duplicata nella route.
5. Logga un `leadEvents` con `eventType='BOT_REPORT'` e `metadata=report` per audit.
6. Risposta `200 { ok: true }`.

**Schema change:** aggiungere `leads.botReport` jsonb nullable.

### Componente 5 — Visibilità Conferme

- **ConfermeDrawer** (`src/components/ConfermeDrawer.tsx`): se `lead.botReport` è
  presente, mostra una card **"🤖 Report Bot"**:
  - `summary` in testa,
  - `painPoints[]` come elenco puntato / chip,
  - `levaConsigliata` **in evidenza** (box accentato),
  - `budgetSignal` e `urgency` come tag,
  - `objections[]` come lista secondaria.
  - Fallback: se `botReport` è una stringa o manca la struttura attesa, render del
    testo grezzo.
- **Card in board Conferme:** badge **🤖** quando `lead.botReport` è non-null.

### Componente 6 — Gamification OFF per il bot

File: `src/app/actions/pipelineActions.ts`, `updateLeadOutcome` (blocco gamification
~righe 471-493).

Prima del blocco gamification: caricare/conoscere `isBot` dell'attore e, se `true`,
**saltare interamente** il blocco (XP, coins, chest, boss attack, creature drop, duel
score, team goal). Tutto il resto (transizione stato, `appointmentDate`, event log,
marketing webhook) procede normalmente.

## Sicurezza

- Entrambe le direzioni firmate **HMAC-SHA256** con `BOT_WEBHOOK_SECRET`.
- La route inbound valida che il lead appartenga a un account bot Fenice prima di mutare
  stato (no mutazioni arbitrarie su lead altrui).
- Kill-switch indipendenti: `BOT_INTAKE_ENABLED` (push) e implicitamente la presenza del
  secret (inbound).
- Nessun bypass dei flow di transizione: la route inbound passa **sempre** da
  `updateLeadOutcome`.

## Cosa NON è in scope (YAGNI)

- Outbox + retry/backoff per il push al bot (per il test basta best-effort no-retry).
- Inclusione dei lead da CSV/import manuale (solo AC).
- Login UI / dashboard dedicata per il bot (gdo205 non opera da interfaccia).
- Configurabilità del tetto da UI (20 è costante; eventualmente env/costante nel codice).
- Gestione conversazione/chat lato bot (è l'app esterna, fuori da questo CRM).

## Schema changes riepilogo

1. `users.isBot` — boolean, default `false`.
2. `leads.botReport` — jsonb, nullable.

## Env riepilogo

| env | uso |
|-----|-----|
| `BOT_INTAKE_URL` | endpoint del bot per il push all'assegnazione |
| `BOT_WEBHOOK_SECRET` | segreto HMAC condiviso (push + inbound) |
| `BOT_INTAKE_ENABLED` | kill-switch del push (`'true'` per attivare) |

## Criteri di successo

- gdo205 riceve al massimo 20 lead Fenice/giorno via round-robin AC, senza sottrarre
  agli umani oltre la sua quota.
- Ogni lead assegnato a gdo205 genera un push HMAC valido al bot.
- Il bot può registrare tutti e 4 gli esiti via `/api/bot/outcome`; un `APPUNTAMENTO`
  porta il lead in `status=APPOINTMENT` visibile alle Conferme.
- Il report strutturato è visibile come card nel ConfermeDrawer e segnalato col badge 🤖.
- Il bot non guadagna XP/coins e non appare nelle classifiche; appare invece nelle medie
  KPI manager come un GDO normale.
