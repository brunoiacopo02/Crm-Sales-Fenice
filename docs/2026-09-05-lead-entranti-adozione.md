# Lead che scrivono per primi — lato CRM

Risposta operativa al documento della sessione messaggistica
(`Software Messaggistica/docs/crm/2026-09-04-lead-che-scrivono-per-primi.md`).

Il problema, in una riga: 43 persone hanno scritto per prime sul numero Fenice fra il 26/08 e
il 04/09, 29 non hanno mai ricevuto risposta perché nel CRM non esistevano, e un lead che il
bot adotta non ha un `leadId` — quindi il suo esito, appuntamento compreso, non ha dove tornare.

## Cosa c'è adesso

| Pezzo | File |
|---|---|
| Client HMAC + normalizzazione del contratto (puro) | `src/lib/bot-fissatore/leadEntranti.ts` |
| Test della normalizzazione e della dedup | `src/lib/bot-fissatore/leadEntranti.test.ts` |
| Chiave persona, estratta da `push.ts` per non trascinare il DB nei moduli puri | `src/lib/bot-fissatore/personKey.ts` |
| Rotta admin (anteprima + esecuzione) | `src/app/api/admin/lead-entranti/route.ts` |

Env: `BOT_WEBHOOK_SECRET` (già presente, è lo stesso di intake e agenda) e, opzionale,
`BOT_LEAD_ENTRANTI_URL` per puntare altrove. Default:
`https://web-app-messaggistica.vercel.app/api/bot/lead-entranti`.

## Come si usa

**Anteprima — non scrive niente, non manda niente.** Apribile dal browser da un account ADMIN:

```
GET /api/admin/lead-entranti?limit=500
```

Restituisce: quanti lead sono da creare, quanti sono già nostri (dedup per numero, sulle ultime
10 cifre, la stessa chiave che usa il bot), quanti sono bloccati perché hanno già un appuntamento
o una presenza, la ripartizione per `statoBot` e per `provenienza`, e — riga per riga — il primo
messaggio, quando è stato scritto e se c'è un appuntamento già fissato.

**Esecuzione.** `POST /api/admin/lead-entranti` con, come minimo, `{"conferma": true}`.

```jsonc
{
  "conferma": true,            // obbligatorio, non c'è un default
  "limit": 500,
  "spingiIntake": false,       // manda l'intake al bot: è l'unica cosa che riempie crm_lead_id
  "soloChatVive": false,       // uscita di sicurezza: limita alle chat 'active'/'replying'
  "applicaAppuntamenti": false // registra l'appuntamento che il bot aveva già fissato
}
```

## Cosa può far arrivare un messaggio a una persona

Solo il push dell'intake — e sui lead di questa lista non parte niente.

La guardia dall'altro lato (`apreSopraChatViva`, letta nel loro codice il 05/09) salta l'apertura
su **qualunque** conversazione senza `crm_lead_id`, non solo sulle chat vive. Le righe della lista
hanno quel campo nullo per definizione, altrimenti non ci sarebbero: `closed` e `booked` inclusi.
E nel ramo che salta l'apertura scrivono comunque `crm_lead_id`, quindi l'intake fa il suo lavoro
senza spedire niente.

Resta **un** caso in cui l'apertura partirebbe: la guardia pretende anche che il bot abbia già
mandato almeno un messaggio in quella chat. Fuori dalla fascia 08:30–20:30 la loro risposta è
differita al cron, quindi fra l'adozione e la prima risposta c'è una finestra in cui un lead sta
nella lista senza outbound. Il payload non dice se l'outbound è partito — richiesta girata a loro
il 05/09. `soloChatVive: true` è l'uscita di sicurezza finché quella finestra non è chiusa.

`conferma: true` da solo **crea i lead e basta**: nessun messaggio, a nessuno. `spingiIntake`
resta false di default.

`handed_off` viene scartato anche se comparisse nella lista: quella chat è in mano a una persona.

## Scelte fatte, e perché

**I lead nascono assegnati all'account bot.** La conversazione è già sua; darli a un GDO umano
gli toglierebbe una chat che sta conducendo lui, e romperebbe la prova di appartenenza che
`/api/bot/outcome` pretende per accettare un appuntamento.

**`createdAt` = quando ha scritto, `assignedAt` = adesso.** La persona è arrivata il giorno in cui
ha scritto e le analisi di funnel devono vederla lì; entra in circolo oggi, ed è da `assignedAt`
che il CRM conta i lead assegnati dalla migrazione 0027.

**`provenienza` resta grezza** (uppercase e basta): `TELEGRAM`, `INBOUND` o un funnel del CRM per
chi era già stato arruolato in passato. Tradurla appiattirebbe una distinzione che sulle
statistiche di funnel deve restare vera.

**L'appuntamento si accetta solo con `esito === 'APPUNTAMENTO'` e fuso orario esplicito.** Il
contratto lo garantisce già, ma un ISO senza offset arriverebbe alle Conferme sfalsato di due ore
e una data su un RICHIAMO diventerebbe una call che non esiste. Quando la data non passa il
controllo non viene scartata in silenzio: finisce in `appuntamentiSospetti` nel riepilogo.
La registrazione passa da `updateLeadOutcome` col `serviceCtx` del bot — lo stesso percorso di
`/api/bot/outcome`, con eventi, notifiche e passaggio alle Conferme — e mai su un lead che ha già
un appuntamento o una presenza latchata.

**Il primo messaggio finisce sulla timeline del lead** come evento `INBOUND_MESSAGE`
("💬 Ha scritto lui su WhatsApp" nella ContactDrawer). È l'unico contesto che quella persona ha
dato. Idempotente: su un lead che ce l'ha già non si riscrive.

**Creazione sotto advisory lock sul numero**, con ricontrollo dentro la transazione: senza, un
webhook AC in arrivo sullo stesso numero nello stesso istante creerebbe un secondo lead.

## Aperto

1. **La finestra "adottato e non ancora risposto"** — chiesto all'altro lato di esporre se
   l'outbound è già partito (o di escludere quelle righe dalla lista). È l'unico caso residuo in
   cui un intake da qui farebbe partire un'apertura.
2. **`booked` e la guardia sull'apertura** — riguarda i lead che il CRM possiede **già** e che
   vengono ri-arruolati, non quelli di questa lista: lì l'apertura parte, ed è il comportamento su
   cui si appoggia il rifissaggio del contratto v1.5. Decisione del PO, lato loro.
3. **Il testo del riaggancio per i 29** — decisione del PO, lato loro.
4. **Template UTILITY.** Prima di accendere qualunque cosa: verificare che il template di
   riaggancio sia UTILITY o dentro `UTILITY_ONLY_ALLOW` in produzione. Il numero Fenice è a
   qualità LOW e c'è un precedente — il 24/08 dei template erano in env ma mai in allow-list, e
   27 lead sono rimasti muti per quattro giorni.
5. **Regime continuo — deciso il 05/09: push dal bot.** Il flusso accelera (23 aperture in tutto
   agosto, 20 nei primi quattro giorni di settembre). Invece di un cron che rilegge la lista — cioè
   polling, tre giorni dopo aver tagliato $324 di overage Vercel — il bot pusha nel momento in cui
   adotta la chat. Da sapere: il lead nasce più povero (solo numero e primo messaggio, il bot non
   ha ancora parlato) e il push è fire-and-forget dentro il webhook Twilio, quindi un push perso è
   un caso reale. **La lista resta come rete di recupero**, non è ridondanza.
