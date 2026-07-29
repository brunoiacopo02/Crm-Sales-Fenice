# Invio agenda via bot — design

**Data:** 2026-07-29
**Stato:** approvato dal PO (Bruno), pronto per il piano di implementazione

## Problema

L'agenda che il GDO manda al lead durante la chiamata passa oggi da ActiveCampaign
(automazione 248) che spedisce il WhatsApp via **Spoki**. Spoki non funziona più.

Il difetto peggiore non è il canale rotto ma il **falso positivo**: AC risponde `2xx`
al CRM anche quando Spoki non spedisce, quindi `sendAgendaToLead` scrive
`agendaSentAt`, il badge diventa verde e nessuno si accorge di niente.

Misura del danno (30 giorni al 2026-07-28): **2.881 invii su 1.608 lead distinti**,
cioè ~1,8 invii per lead. Il modale avvisa e chiede conferma prima di reinviare,
quindi quei reinvii non sono routine: sono GDO che ricliccano perché il lead, al
telefono, dice di non aver ricevuto nulla. Circa **1.270 invii al mese a vuoto**.

## Flusso operativo (invariato dal punto di vista del GDO)

1. Il GDO è **al telefono** col lead e clicca "Agenda".
2. Il lead riceve l'agenda su WhatsApp e **prenota mentre è ancora in chiamata**.
3. Il GDO chiude la chiamata e registra l'appuntamento nel CRM.
4. Da lì in poi il bot gestisce il post-invio: video, follow-up, conversazione.

Vincolo di prodotto: **i GDO non devono sapere che dietro c'è un bot.** UI identica
a oggi, messaggi d'errore generici, mai la parola "bot" nell'interfaccia.

## Cosa fa il bot (contratto fornitore)

Endpoint: `POST https://web-app-messaggistica.vercel.app/api/send-agenda`
Auth: `x-bot-signature: sha256=<hmac(rawBody, BOT_WEBHOOK_SECRET)>` — stesso segreto
già usato per `/api/bot/intake`, nessun segreto nuovo.

Payload: `leadId`, `phone` (grezzo, normalizzano loro), `companyId: "fenice"`
obbligatori; `name`, `email`, `funnel` opzionali; `variant: { lavora, haFamiglia,
offertaDelMese }` — se assente vale tutto `false` e parte il video di default,
`offertaDelMese` prevale.

Risposta **sincrona entro ~8s**, sempre HTTP 200 quando la richiesta è valida:
l'esito sta nel corpo. HTTP diversi da 200 solo per errori di protocollo
(401 firma, 403 companyId, 400 corpo, 429 rate limit).

| `esito` | Significato | Ritentabile |
|---|---|---|
| `consegnato` | Twilio conferma delivered/read | — |
| `inviato` | accettato da Twilio, nessuna conferma entro ~8s (telefono spento) | **NO** — arriverebbe doppio |
| `fallito` | numero non su WhatsApp, template bloccato, Twilio giù | sì |

Deduplica: stesso `leadId` entro 15 minuti → nessun reinvio, risposta con l'esito
precedente e `deduplicato: true`. Non vale dopo un `fallito`.

Sequenza lato bot: (1) template `fenice_agenda_gdo_v3` (UTILITY) col link di
prenotazione, che chiede esplicitamente al lead di rispondere; (2) **alla prima
risposta del lead** il video della variante come testo libero; (3) da lì gestisce
la conversazione sapendo che l'appuntamento è già fissato — non ripropone la call,
non ripete il pitch, non manda solleciti. Il collega non viene mai nominato.

Il bot non manda esiti al CRM tranne `NOTA`: il lead resta del GDO umano.

## Rischio principale

**Il video parte solo se il lead risponde al primo messaggio.** Prima partiva da
solo dopo 5 minuti. Ora il successo dipende da cosa dice il GDO al telefono, che è
la parte meno controllabile del flusso.

Mitigazione: il modale mostrerà al GDO, nel momento esatto dell'invio, il promemoria
di farsi rispondere dal lead. **Il testo esatto lo decide il PO** — non si tocca di
iniziativa ciò che i GDO dicono ai lead.

## Decisioni del PO

| Decisione | Scelta |
|---|---|
| Email nel modale | **Rimossa del tutto** (il bot non la richiede) |
| Kill-switch | **Sì**, `AGENDA_CHANNEL=bot\|ac` su Vercel, rollback senza deploy |
| Automazione AC 248 | **Spenta dal PO su AC** dopo il go-live |
| Ritorno dal bot | Solo `NOTA`, mai duplicare eventi né toccare l'appuntamento |

Conseguenza nota: col kill-switch su `ac`, i lead **senza email a database**
falliranno, perché il modale non la raccoglie più. Accettabile per una leva
d'emergenza.

## Architettura lato CRM

### 1. Client firmato — `src/lib/agendaBot.ts`

Riusa `signPayload` da `@/lib/marketing-webhooks/signing` (stessa funzione del push
esistente). Timeout client **12s**, superiore agli ~8s del fornitore, così un loro
ritardo non diventa un nostro errore di rete. Ritorna un risultato tipizzato che
distingue esito applicativo ed errore di trasporto.

### 2. `sendAgendaToLead` — riscrittura

Smette di parlare con ActiveCampaign quando `AGENDA_CHANNEL !== 'ac'`. Ordine:
guardia tenant (resta: i non-Fenice non passano di qui), fetch lead, chiamata al
bot, e **solo in base all'esito** scrittura di `agendaSentAt` + `agendaStatus`.

Regola centrale: **`agendaSentAt` si scrive solo su `consegnato` e `inviato`.**
Su `fallito` non si scrive nulla — è esattamente il bug di oggi e non va replicato.

L'evento `AGENDA_SENT` porta in metadata `channel`, `esito`, `deduplicato`,
`conversationId`, `sid`.

### 3. Colonna nuova — `leads.agendaStatus`

`text` nullable, valori `consegnato | inviato | fallito`. Serve perché la UI deve
sapere *come* è andato l'invio, non solo *quando*: su `inviato` il pulsante va
disabilitato. Migrazione **scritta a mano** (`drizzle-kit generate` è inutilizzabile
su questo progetto).

### 4. `AgendaButton` — tre stati

| Stato | Colore | Etichetta | Reinvio |
|---|---|---|---|
| mai inviata | blu | "Agenda" | sì |
| `consegnato` | verde | "Agenda inviata" | sì, con conferma |
| `inviato` | ambra | "Consegna non confermata" | **no, disabilitato** |
| `fallito` | rosso | "Invio fallito, riprova" | sì |

Nessun riferimento al bot. Il campo email sparisce dal modale.

### 5. `/api/bot/outcome` — apertura della NOTA

Oggi: 403 se il lead non è assegnato a un account bot. Serve accettare `NOTA` sui
lead di GDO umani, senza aprire tutto il resto.

Autorizzazione, in ordine:
- lead non Fenice → 403 (invariato)
- assegnatario è un bot → tutti gli esiti (invariato)
- assegnatario **non** è un bot → **solo `NOTA`**, e **solo se `agendaStatus` non è
  null** (cioè per quel lead è passata un'agenda dal bot). Qualunque altro esito → 403.

Il principio è il minimo privilegio: il segreto è già fidato per operazioni
distruttive sui lead del bot, ma non deve poter scrivere su qualunque lead a
database.

`userId` dell'evento: sui lead umani non esiste un `assignee.isBot` da usare come
autore. Si usa l'account bot Fenice (`isBot = true`, `companyId = 'fenice'`) come
autore dell'evento, coerente con come già appaiono le note del fissatore.

### 6. Documentazione

`docs/bot-fissatore-contract.md` → v1.3: nuova sezione `/send-agenda`, i tre esiti,
la deduplica, e la regola di autorizzazione della `NOTA`.

## Rollout

1. Merge + deploy con `AGENDA_CHANNEL=bot` **non ancora impostata** (default `ac`):
   il codice è in produzione ma il comportamento non cambia.
2. Invio di prova col fornitore su numeri nostri, per vedere tutti e tre gli esiti
   nella UI reale: `consegnato` su numero attivo, `inviato` su telefono spento,
   `fallito` su numero non WhatsApp.
3. `AGENDA_CHANNEL=bot` su Vercel → il canale passa al bot senza deploy.
4. Il PO spegne l'automazione 248 su ActiveCampaign.
5. Monitoraggio del primo giorno: distribuzione dei tre esiti, e soprattutto
   **quanti lead rispondono** al primo messaggio (è la metrica che dice se il video
   sta arrivando o no).

## Punti aperti verso il fornitore

- Conferma allineamento `BOT_WEBHOOK_SECRET` via fingerprint `sha256` (primi 8 hex),
  senza scambiarsi il valore.
- Richiesta: includere la **variante** nella chiave di deduplica, altrimenti una
  correzione del GDO entro 15 minuti lascia il lead col video sbagliato.
- Richiesta: un webhook a posteriori per gli `inviato` poi consegnati, così quello
  stato ambiguo si chiude invece di restare tale per sempre.

## Fuori scope (deliberatamente)

- Tracking della percentuale di video guardato: richiede una pagina con player
  incorporato al posto del redirect. Rimandato, vedi `src/lib/videoLinks.ts` e
  `src/app/v/[slug]/route.ts` già scritti ma non ancora deployati.
- Badge "video visto" per le Conferme e endpoint perché il bot sappia chi non ha
  guardato: da disegnare insieme, quando il tracking sarà attivo.
