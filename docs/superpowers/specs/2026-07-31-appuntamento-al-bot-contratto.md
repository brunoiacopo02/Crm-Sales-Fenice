# Contratto: data e ora dell'appuntamento verso il bot (v1.3)

Data: 2026-07-31 · Stato: implementato lato CRM, **in attesa dell'endpoint lato fornitore**

## Perché una chiamata separata

Il bot deve conoscere data e ora dell'appuntamento del lead. Non possono viaggiare
nel payload di `/api/send-agenda`: quando il GDO invia l'agenda è ancora al
telefono e registra l'esito `APPUNTAMENTO` subito dopo.

Misura sui 4 giorni precedenti (274 agende inviate):

| | |
|---|---|
| Appuntamento registrato **dopo** l'invio dell'agenda | 265 (97%) — in media 65 s dopo |
| Registrato prima | 3 |
| Nessun appuntamento (lead poi non fissato) | 18 |

Quindi: campo opzionale in `send-agenda` per il 3%, chiamata dedicata per il resto.

## Endpoint richiesto al fornitore

`POST /api/appointment-set` — stessa autenticazione dell'agenda: header
`x-bot-signature: sha256=<hmac-sha256(rawBody, BOT_WEBHOOK_SECRET)>`. Nessun
segreto nuovo.

```json
{
  "leadId": "24df64ee-4ccc-4f47-a040-b595abf9a1d8",
  "phone": "3476525616",
  "companyId": "fenice",
  "name": "Mario Rossi",
  "funnel": "CORSO 10 ORE",
  "appointmentAt": "2026-08-04T15:00:00+02:00",
  "appointmentLabel": "martedì 4 agosto alle 15:00",
  "trigger": "fissato"
}
```

- `appointmentAt` — ISO 8601 con offset esplicito, mai `Z` implicito. È lo stesso
  formato che il fornitore già pretende da noi su `/api/bot/outcome`.
- `appointmentLabel` — stessa data già scritta in italiano (Europe/Rome), pronta
  da inserire nel messaggio. Serve a non far riformattare l'ora a mano: è lì che
  nascono gli orari sfalsati di un'ora.
- `trigger` — `fissato` (prima volta) oppure `spostato` (data cambiata). Un lead
  può ricevere più chiamate: **vale sempre l'ultima**.

Risposta attesa: `200` con qualsiasi corpo. Un `leadId` sconosciuto (agenda mai
partita dal bot) può essere ignorato con `200`.

## Comportamento lato CRM

Chiamata a ogni punto in cui la data nasce o cambia:

| Evento | File |
|---|---|
| Nuovo appuntamento del GDO | `pipelineActions.ts` → `updateLeadOutcome` |
| Spostamento dal GDO | `appointmentActions.ts` → `updateGdoAppointment` |
| Modifica dati dalle Conferme | `confermeActions.ts` → `updateLeadDataConferme` |
| Rifissaggio delle Conferme | `confermeActions.ts` → `setConfermeOutcome` |

Non viene inviata quando: l'appuntamento lo fissa il bot stesso (la data l'ha
mandata lui), il lead non è Fenice (Serenamente ha il canale Twilio), manca il
telefono, oppure `AGENDA_CHANNEL` non è `bot` — lo stesso interruttore del canale
agenda, così il rollback resta "togliere la env".

`notifyAppointmentToBot` non lancia mai eccezioni e non scrive nulla sul lead:
un fornitore giù o un 404 producono solo una riga di log, senza impedire al GDO
di esitare il lead né far divergere i dati del CRM. Timeout 6 s.

Vedi [`2026-07-29-agenda-via-bot-design.md`](./2026-07-29-agenda-via-bot-design.md).
