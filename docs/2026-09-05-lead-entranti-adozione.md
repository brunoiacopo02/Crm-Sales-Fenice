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
| Adozione condivisa dai due canali (dedup, lock, eventi) | `src/lib/bot-fissatore/adozione.ts` |
| Rotta admin — lettura della lista (anteprima + esecuzione) | `src/app/api/admin/lead-entranti/route.ts` |
| Rotta che riceve il push dal bot | `src/app/api/bot/lead-entrante/route.ts` |

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
  "soloChatVive": false,       // restringe alle chat 'active'/'replying' (non è la protezione)
  "applicaAppuntamenti": false // registra l'appuntamento che il bot aveva già fissato
}
```

## Il push dal bot

`POST /api/bot/lead-entrante` — un lead per chiamata, firma HMAC identica a `/api/bot/outcome`, il
middleware lascia già passare `/api/bot/*`. URL da mettere nelle loro env
(`CRM_LEAD_ENTRANTE_URL`): `https://crm-sales-fenice.vercel.app/api/bot/lead-entrante`.

Corpo: gli stessi nomi di campo di una riga della lista, meno `statoBot`/`esito`/`appuntamento`,
che al momento dell'adozione non esistono ancora. Risposta:

```jsonc
{ "ok": true,  "leadId": "uuid", "creato": true,  "nomeAggiornato": false }  // lead nuovo
{ "ok": true,  "leadId": "uuid", "creato": false, "nomeAggiornato": true }   // numero già nostro
{ "ok": false, "motivo": "altra_azienda" }          // NON scrivere crm_lead_id
{ "ok": false, "motivo": "telefono_non_valido" }
```

**Il nome, oggi, non arriva mai.** Non è che arriva tardi: nel repo della messaggistica niente
estrae il nome dalla conversazione — lo riempiono solo ActiveCampaign, le campagne e il nostro
intake. Quando una persona scrive "Piacere sono Monia" nel secondo messaggio, quella parola resta
dentro il testo e non diventa un dato da nessuna parte. Quindi `nome: null` è **definitivo**, non
una promessa: se una card resta senza nome, oggi non c'è niente in coda che la riempirà.

La rotta è comunque arricchibile e pronta: ripetere la stessa chiamata col nome dentro riempie il
buco — il lead è lo stesso (dedup per numero) e `nomeAggiornato` dice se è servito. Solo un buco,
mai una sovrascrittura: un nome vero già in anagrafica vince sempre. Serve perché un lead che torna
al pool umano non si presenti a un GDO come "Lead senza nome", che è la differenza fra una chiamata
e una card che nessuno prende. L'ipotesi in piedi dall'altro lato è far estrarre il nome al modello
alla chiusura della conversazione: decisione del PO, perché un'estrazione sbagliata ("sono la mamma
di Luca" → Luca) mette il nome di un'altra persona davanti a chi chiama.

Nel frattempo `nome` viene validato in ingresso (`nomePlausibile`): cifre, URL, email, stringhe
lunghissime e frasi (più di quattro parole) ricadono sul fallback invece di finire sulla card. È un
pavimento, non una garanzia — "Piacere sono Monia" passa, e quella è qualità dell'estrazione.

**Da qui non parte nessun intake, ed è deliberato.** L'intake serve a dire al bot che un lead è
suo; qui è già suo e gli manca solo l'id, che si prende dalla risposta. Mandarglielo sarebbe anche
pericoloso: arriverebbe *prima* che il bot abbia scritto in quella chat — vedi sotto.

Il canale non sostituisce la lista: il loro push è fire-and-forget dentro il webhook Twilio e non
ritenta, quindi un push perso è un caso reale e la lista è la rete che lo ripesca.

## Cosa può far arrivare un messaggio a una persona

Solo il push dell'intake dalla rotta admin, e solo in un caso preciso.

La guardia dall'altro lato (`apreSopraChatViva`, letta nel loro codice il 05/09) salta l'apertura
su **qualunque** conversazione senza `crm_lead_id`, non solo sulle chat vive — `closed` e `booked`
inclusi — e nel ramo che salta scrive comunque `crm_lead_id`, quindi l'intake fa il suo lavoro
senza spedire niente. Ma la sua prima riga è:

```ts
if (aiOwner !== 'mario' || !haOutboundPartito) return false;
```

Con zero outbound esce subito e **l'apertura parte**. Di norma quella finestra dura qualche decina
di secondi: la risposta a testo libero non passa dal gate 08:30–20:30, che vale per i template.
Ma non ha limite superiore — se il loro drain si pianta (modello irraggiungibile, credito a zero:
già successo) la conversazione resta adottata e muta per ore.

Da qui la condizione, che è **dura e non un'opzione**: l'intake parte solo con
`botHaRisposto: true` (loro commit `d58d2d6`). `spingiIntake` non la scavalca, `soloChatVive` non
c'entra — in quella finestra lo stato È `active`, quindi guardare lo stato non protegge da niente.
Il campo assente (deploy vecchio, rollback) blocca come `false`, ma resta contato a parte nel
riepilogo: è un guasto da guardare, non un lead da aspettare.

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

1. **`altra_azienda`: il bot di Fenice sta parlando con un cliente di Serenamente.** Quando il
   numero è già lead di un'altra azienda non creiamo un doppione e non diamo un `leadId` — ma
   l'adozione e la risposta sono già partite prima del nostro verdetto. Lasciarlo parlare, fermarlo
   a metà frase o passarlo a un umano è una decisione commerciale del PO. Lato loro registrano un
   evento e un marcatore così il caso è visibile lo stesso giorno.
3. **`booked` e la guardia sull'apertura** — riguarda i lead che il CRM possiede **già** e che
   vengono ri-arruolati, non quelli di questa lista: lì l'apertura parte, ed è il comportamento su
   cui si appoggia il rifissaggio del contratto v1.5. Decisione del PO, lato loro.
4. **Il testo del riaggancio per i 29** — decisione del PO, lato loro.
5. **Template UTILITY.** Prima di accendere qualunque cosa: verificare che il template di
   riaggancio sia UTILITY o dentro `UTILITY_ONLY_ALLOW` in produzione. Il numero Fenice è a
   qualità LOW e c'è un precedente — il 24/08 dei template erano in env ma mai in allow-list, e
   27 lead sono rimasti muti per quattro giorni.
6. **Regime continuo — deciso e implementato il 05/09: push dal bot.** Il flusso accelera (23 aperture in tutto
   agosto, 20 nei primi quattro giorni di settembre). Invece di un cron che rilegge la lista — cioè
   polling, tre giorni dopo aver tagliato $324 di overage Vercel — il bot pusha nel momento in cui
   adotta la chat. Da sapere: il lead nasce più povero (solo numero e primo messaggio, il bot non
   ha ancora parlato) e il push è fire-and-forget dentro il webhook Twilio, quindi un push perso è
   un caso reale. **La lista resta come rete di recupero**, non è ridondanza.
