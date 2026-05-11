# Conferme — Sezione "Appuntamenti Webinar (self-booked)"

**Data:** 2026-05-12
**Stato:** approvato, pronto per implementazione
**Owner:** Bruno

## Contesto

Il funnel "Webinar Video Editing" porta lead che si prenotano autonomamente. Il 12/05/2026 ci sono 25 appuntamenti già fissati dai lead stessi, da assegnare ai calendari dei venditori. La squadra Conferme è il punto naturale di smistamento perché ha accesso ai calendari venditori e gestisce già il flusso "appuntamento → venditore + GCal".

## Obiettivo

Aggiungere una sezione dedicata nella dashboard Conferme che mostra i lead webinar self-booked non ancora assegnati, con un'azione one-click "Assegna a venditore" che riusa il flusso esistente di sincronizzazione Google Calendar.

## Scope

### In scope
- Migration schema: campo booleano `isSelfBooked` su `leads`.
- Seed dei 25 lead webinar del 12/05/2026 via Supabase MCP.
- Card UI `WebinarSelfBookedSection` in `/conferme`, sopra `ConfermeBoard`.
- Server action `assignWebinarLeadToSalesperson` che riusa `createGoogleCalendarEvent`.
- Eventi marketing webhook `appointment.outcome` + `deal.assigned` (come flusso conferma standard).
- Log `leadEvents` tipo `webinar_lead_assigned`.
- Gamification reward `CONFERMATO` per Conferme user che assegna.

### Out of scope
- Admin UI per import bulk futuri webinar (può arrivare dopo).
- Drag-and-drop calendario venditori.
- Check conflitti slot venditore (orario è fisso al momento dell'auto-prenotazione).
- Estensione di `isSelfBooked` a flussi non-webinar.

## Schema DB

Aggiunta singola colonna in `src/db/schema.ts` tabella `leads`:

```ts
isSelfBooked: boolean('isSelfBooked').default(false).notNull(),
```

Migration generata via `drizzle-kit generate`, applicata via Supabase MCP `apply_migration`.

## Dati seed (25 lead, 12/05/2026)

| Nome | Telefono (nudo) | Orario |
|---|---|---|
| Massimiliano | 3382920075 | 09:00 |
| Salvatore Giulintano | 3280147180 | 09:00 |
| Francesco Calarco | 3891659382 | 10:00 |
| Denisse | 3807822296 | 10:00 |
| Luca | 3338872918 | 10:00 |
| Linda D'Amico | 3279820421 | 10:00 |
| Laura | 3664180650 | 10:00 |
| daniela | 3347331650 | 11:00 |
| Achille | 3393390370 | 11:00 |
| Grajdan Adriana | 3342105627 | 11:00 |
| Ciao mi chiamo Luca | 3338796514 | 11:00 |
| Milena | 3492563843 | 12:00 |
| silva | 3515676930 | 12:00 |
| Leonardo | 3471381823 | 12:00 |
| Massimiliano Bonomo Papotto | 3755379630 | 12:00 |
| Andrea | 3312420082 | 13:00 |
| Marilina | 3292570700 | 13:00 |
| Nicola Sampaolo | 3898855183 | 13:00 |
| Edward Medina | 3287715059 | 13:00 |
| Dave Russell Sabarias | 3474754948 | 14:00 |
| Julia | 3713610141 | 14:00 |
| Gaia | 3282588848 | 14:00 |
| Davide | 3770860619 | 14:00 |
| manuel | 3927556571 | 14:00 |

Note:
- Andrea `3312420082` appariva due volte nella lista sorgente, inserito una volta sola.
- `Grajdan Adriana` arrivava come `3342105627` (10 cifre, già senza prefisso `39`), inserito tale e quale.
- Telefoni salvati nudi (senza `+39` né `39`).

Campi comuni per ogni record:
- `funnel = 'ORG'`
- `status = 'APPOINTMENT'`
- `isSelfBooked = true`
- `appointmentDate = 2026-05-12 HH:00:00 Europe/Rome`
- `appointmentNote = 'Webinar Video Editing — prenotazione autonoma'`
- `assignedToId = null`, `salespersonUserId = null`
- `createdAt = now()`, `version = 1`

## UI

### Componente nuovo: `WebinarSelfBookedSection`

Posizione: `src/components/WebinarSelfBookedSection.tsx`.

Renderizzato in `src/app/(dashboard)/conferme/page.tsx` solo per ruoli `CONFERME | MANAGER | ADMIN`, **sopra** `ConfermeBoard`, sotto gli widget gamification.

Struttura:
- Header con titolo "Appuntamenti Webinar (self-booked)", badge count "N da assegnare".
- Lista lead (server-fetched) ordinata per `appointmentDate`:
  - Nome, telefono cliccabile (`tel:` + WhatsApp), orario app, badge `WEBINAR`.
  - Bottone "Assegna a venditore" → apre dropdown inline con elenco utenti `role='VENDITORE'`.
  - Click su venditore → chiama server action → ottimistic update (la riga sparisce dalla lista).
- Empty state: "Nessun appuntamento webinar in attesa di assegnazione".

Niente paginazione (25 max), niente filtri.

### Filtro lista
```ts
where: isSelfBooked = true AND salespersonUserId IS NULL
order by: appointmentDate ASC
```

## Server actions

In `src/app/actions/confermeActions.ts`.

### `getWebinarSelfBookedLeads()`
Ritorna i lead self-booked non ancora assegnati. Auth: `CONFERME | MANAGER | ADMIN`.

### `assignWebinarLeadToSalesperson(leadId: string, salespersonId: string)`
Auth: `CONFERME | MANAGER | ADMIN`.

Operazioni (in transazione logica con optimistic concurrency su `version`):
1. Update `leads`:
   - `salespersonUserId = salespersonId`
   - `salespersonAssigned = <nome>`
   - `salespersonAssignedAt = now()`
   - `confirmationsOutcome = 'confermato'`
   - `confirmationsUserId = session.user.id`
   - `confirmationsTimestamp = now()`
   - `version = version + 1`, `updatedAt = now()`
2. Webhook marketing: `appointment.outcome` + `deal.assigned`.
3. Crea evento Google Calendar nel calendario del venditore via `createGoogleCalendarEvent` (1h, start = `appointmentDate`).
4. Insert `leadEvents` tipo `webinar_lead_assigned`, metadata `{ salespersonAssigned, source: 'webinar_self_booked' }`.
5. Gamification reward `CONFERMATO` su `session.user.id` (chest, adventure, creature drop).

Errore handling identico al flusso `setConfermeOutcome` esistente (GCal failure non blocca la conferma).

## Telefono — formato

Salvataggio nudo, senza prefisso. Esempio: `3382920075`.

## Stima dimensione

- 1 migration.
- 1 seed (script o SQL via MCP).
- 1 componente client (~150 righe).
- 2 server actions (~120 righe totali).
- Wiring nella page Conferme.
- Build, commit, push, deploy.

Tempo stimato: 1 sessione completa.

## Verifica post-deploy

- Login come utente CONFERME → vedo la card con 25 lead.
- Assegno 1 lead a un venditore reale → riga sparisce, evento appare in Google Calendar del venditore, KPI Conferme scatta +1 conferma.
- TS typecheck pulito, build Vercel verde.
