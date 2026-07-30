# Bot Fissatore — Contratto di Integrazione

> **Destinatari:** team esterno del bot WhatsApp/telefonico.
> **Versione:** 1.3 — 2026-07-29 (aggiunta Direzione 3: invio agenda su richiesta del GDO; `NOTA` ammessa sui lead dei GDO umani).

---

## Indice

1. [Account bot nel CRM](#account-bot-nel-crm)
2. [Variabili d'ambiente richieste](#variabili-dambiente-richieste)
3. [Schema firma HMAC](#schema-firma-hmac)
4. [Direzione 1 — CRM → Bot (push all'assegnazione)](#direzione-1--crm--bot-push-allassegnazione)
5. [Direzione 2 — Bot → CRM (callback outcome)](#direzione-2--bot--crm-callback-outcome)
6. [Direzione 3 — CRM → Bot (invio agenda)](#direzione-3--crm--bot-invio-agenda)
7. [Codici di risposta `/api/bot/outcome`](#codici-di-risposta-apibotoutcome)
8. [Limitazioni note](#limitazioni-note)

---

## Account bot nel CRM

Il CRM Fenice ha un account GDO dedicato al bot:

| Campo | Valore |
|---|---|
| Nome visualizzato | `GDO 201` (appare come un GDO normale nel CRM) |
| Email | `gdo201@fenice.local` (account interno Fenice, non fa login UI) |
| `gdoCode` | `201` |
| Ruolo | GDO |
| Azienda | `fenice` |
| Flag `isBot` | `true` |

Il bot **non deve mai accedere all'interfaccia CRM**. Tutti gli scambi avvengono esclusivamente via API con firma HMAC come descritto di seguito.

---

## Variabili d'ambiente richieste

Le seguenti variabili devono essere impostate **sia su Vercel (lato CRM) sia sul server del bot**:

```dotenv
# Bot Fissatore (test lead Fenice)
BOT_INTAKE_ENABLED=false        # Impostare `true` su Vercel per abilitare il push
BOT_INTAKE_URL=                 # URL pubblico del webhook del bot (Direzione 1)
BOT_WEBHOOK_SECRET=             # Segreto condiviso HMAC-SHA256 (uguale su entrambi i lati)
```

> `BOT_INTAKE_ENABLED=false` è il valore di sicurezza predefinito: il CRM non effettuerà push
> finché non viene esplicitamente abilitato su Vercel.

---

## Schema firma HMAC

Entrambe le direzioni usano lo **stesso schema**:

```
x-bot-signature: sha256=<hex(HMAC-SHA256(rawBody, BOT_WEBHOOK_SECRET))>
```

- La firma viene calcolata sull'**esatto body JSON grezzo in byte** (nessuna rielaborazione).
- L'header da usare è sempre `x-bot-signature`.
- Il confronto deve essere eseguito in modalità **timing-safe** per prevenire timing attacks.

### Snippet Node.js

```js
import crypto from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Genera la firma da aggiungere come header `x-bot-signature`.
 * rawBody deve essere la stringa JSON esatta che verrà inviata come body.
 */
function signPayload(rawBody, secret) {
  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `${SIGNATURE_PREFIX}${hex}`;
}

/**
 * Verifica la firma ricevuta nell'header `x-bot-signature`.
 * Restituisce { valid: true } o { valid: false, reason: '...' }.
 */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return { valid: false, reason: 'missing_signature' };
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return { valid: false, reason: 'bad_prefix' };

  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);

  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(providedHex, 'hex');
  if (a.length !== b.length) return { valid: false, reason: 'length_mismatch' };

  return crypto.timingSafeEqual(a, b)
    ? { valid: true }
    : { valid: false, reason: 'signature_mismatch' };
}

// --- Esempio: bot riceve push dal CRM ---
app.post('/webhook/crm-push', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  const check = verifySignature(rawBody, req.headers['x-bot-signature'], process.env.BOT_WEBHOOK_SECRET);
  if (!check.valid) return res.status(401).json({ error: check.reason });
  const payload = JSON.parse(rawBody);
  // ... elabora payload ...
  res.json({ ok: true });
});

// --- Esempio: bot chiama il CRM con l'outcome ---
async function postOutcome(body) {
  const rawBody = JSON.stringify(body);
  const sig = signPayload(rawBody, process.env.BOT_WEBHOOK_SECRET);
  const res = await fetch('https://crm-sales-fenice.vercel.app/api/bot/outcome', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bot-signature': sig,
    },
    body: rawBody,
  });
  return res.json();
}
```

---

## Direzione 1 — CRM → Bot (push all'assegnazione)

Quando un lead viene assegnato all'account `GDO 201` (gdoCode 201, e `BOT_INTAKE_ENABLED=true`), il CRM
esegue una chiamata **best-effort, no-retry** verso il bot.

### Request

```
POST <BOT_INTAKE_URL>
Content-Type: application/json
x-bot-signature: sha256=<hex(HMAC-SHA256(rawBody, BOT_WEBHOOK_SECRET))>
```

### Body — `BotIntakePayload`

```ts
interface BotIntakePayload {
  leadId:    string;        // UUID del lead nel CRM
  name:      string | null; // Nome del lead (può essere null)
  phone:     string;        // Numero grezzo dal DB — vedere nota sotto
  email:     string | null; // Email del lead (può essere null)
  funnel:    string | null; // Funnel/prodotto di interesse
  companyId: string;        // Sempre "fenice" per i lead del bot
}
```

> **Attenzione — numero di telefono grezzo:** `phone` arriva direttamente dal DB del CRM
> senza normalizzazione (esempi: `"3331234567"`, `"333 123 4567"`, `"+39 333 1234567"`).
> **Il bot è responsabile della normalizzazione al formato E.164** (es. `+393331234567`)
> prima di inviare messaggi WhatsApp o effettuare chiamate.

### Risposta attesa

Il CRM ignora il body di risposta ma si aspetta HTTP `2xx`. In caso di errore lato bot
il push viene comunque considerato completato (no retry automatico).

---

## Direzione 2 — Bot → CRM (callback outcome)

Dopo aver lavorato il lead, il bot chiama l'endpoint CRM per comunicare l'esito.

### Request

```
POST https://crm-sales-fenice.vercel.app/api/bot/outcome
Content-Type: application/json
x-bot-signature: sha256=<hex(HMAC-SHA256(rawBody, BOT_WEBHOOK_SECRET))>
```

### Body

```ts
interface BotOutcomeBody {
  leadId:         string;     // Obbligatorio — UUID ricevuto nel push
  outcome:        BotOutcome; // Obbligatorio — uno dei 6 valori sotto
  date?:          string;     // Obbligatorio per APPUNTAMENTO e RICHIAMO (ISO 8601 con offset)
  note?:          string;     // Note libere sull'interazione (obbligatoria per NOTA)
  discardReason?: string;     // Motivo scarto (usato per DA_SCARTARE)
  report?:        BotReport;  // Report strutturato (opzionale ma raccomandato)
}

type BotOutcome = 'APPUNTAMENTO' | 'DA_SCARTARE' | 'RICHIAMO' | 'NON_RISPOSTO' | 'INTERROTTO' | 'NOTA';
```

### Valori `outcome`

| Valore | Significato | `date` richiesta | Effetto nel CRM |
|---|---|---|---|
| `APPUNTAMENTO` | Lead ha fissato un appuntamento | SI | Passa alle Conferme |
| `RICHIAMO` | Lead vuole essere ricontattato | SI | Richiamo programmato sul bot |
| `DA_SCARTARE` | **Obiezione ferrea reale** (es. "non ho soldi", "non mi interessa") | No | **Scarto definitivo** |
| `NON_RISPOSTO` | Non ha **mai risposto** dopo il ciclo di solleciti | No | **Riassegnato a un operatore umano** (round-robin) |
| `INTERROTTO` | Chat **avviata ma interrotta senza obiezione ferrea** | No | **Riassegnato a un operatore umano** (round-robin) |
| `NOTA` | **Annotazione senza cambio di stato** (es. disdetta o richiesta di spostamento su lead già appuntato) | No | Nota in timeline + **notifica al team Conferme** se il lead è appuntato. Non tocca stato, appuntamento né assegnazione |

> **Importante (cambio rispetto alla v1.0):** `NON_RISPOSTO` non scarta più il lead — lo
> **restituisce** al CRM, che lo riassegna a un GDO umano. Il nuovo esito `INTERROTTO` ha lo
> stesso effetto. Usare `DA_SCARTARE` **solo** quando c'è un'obiezione ferrea reale: tutto ciò
> che non è un "no" netto (silenzio, chat che si spegne, tentennamenti) va in `NON_RISPOSTO` /
> `INTERROTTO` così la persona viene rilavorata a voce da un operatore.

> **Quando usare `NOTA` (nuovo in v1.2):** per far arrivare al team Conferme informazioni su un
> lead **già appuntato** senza registrare un nuovo appuntamento — il caso tipico è la disdetta
> o la richiesta di spostamento comunicata in chat. Il campo `note` è **obbligatorio** (400 se
> vuoto). `NOTA` non modifica MAI lo stato del lead: se il lead vuole rifissare, la nuova data
> va comunicata da una persona (o, quando concordato, con un nuovo `APPUNTAMENTO`). Risposta:
> `{ ok: true, noted: true }`.

> **`NOTA` sui lead dei GDO umani (nuovo in v1.3):** da quando l'agenda parte dal canale
> bot (Direzione 3), il bot conversa anche con lead che **non gli sono assegnati**. Su
> quei lead è ammesso **esclusivamente** l'esito `NOTA`, e solo se per quel lead è
> passata davvero un'agenda dal bot (`leads.agendaStatus` = `consegnato` o `inviato`).
> Ogni altro esito su un lead non assegnato al bot resta **403**, così come la `NOTA` su
> un lead che non ha mai ricevuto l'agenda. Sui lead assegnati all'account bot non cambia
> nulla: tutti gli esiti restano ammessi.

| Assegnatario del lead | Agenda inviata dal bot | Esiti ammessi |
|---|---|---|
| account bot | indifferente | tutti |
| GDO umano | sì | solo `NOTA` |
| GDO umano | no | nessuno (403) |

> **Formato `date`:** ISO 8601 con offset di fuso orario **obbligatorio** (`Z` oppure `±HH:MM`).
> L'endpoint verifica attivamente la presenza dell'offset: una data priva di fuso viene
> rifiutata con **400 `bad_request`** per evitare che gli appuntamenti risultino sfalsati
> sul calendario del team Conferme.
>
> | Esempio | Esito |
> |---|---|
> | `"2026-06-20T15:00:00+02:00"` | Accettata |
> | `"2026-06-20T13:00:00Z"` | Accettata |
> | `"2026-06-20T15:00:00"` | **Rifiutata — 400** (`date deve includere il fuso orario`) |

### Schema `BotReport` (tutti i campi opzionali)

```ts
interface BotReport {
  summary?:         string;    // Sintesi testuale della conversazione
  painPoints?:      string[];  // Pain point emersi (es. ["solitudine", "mobilità ridotta"])
  budgetSignal?:    string;    // Segnale budget (es. "disposto a spendere 200€/mese")
  urgency?:         string;    // Urgenza percepita: 'alta' | 'media' | 'bassa' (non vincolato)
  objections?:      string[];  // Obiezioni sollevate (es. ["già ha un consulente", "aspetta pensione"])
  levaConsigliata?: string;    // Leva commerciale suggerita per il venditore
}
```

Il `report` viene persistito su `leads.botReport` e appare nella card del lead nella
dashboard Conferme. È fortemente raccomandato per aiutare il team Conferme e i Venditori.

---

## Direzione 3 — CRM → Bot (invio agenda)

Dal 2026-07-29 l'agenda che il GDO manda al lead **non passa più da ActiveCampaign/Spoki**
ma dall'endpoint del fornitore. Il contesto operativo è importante: il GDO clicca il
pulsante **mentre è al telefono col lead**, e il lead prenota dall'agenda durante la
chiamata stessa. Serve quindi un esito reale e sincrono, non un'accettazione ottimistica.

### Request

```
POST https://web-app-messaggistica.vercel.app/api/send-agenda
Content-Type: application/json
x-bot-signature: sha256=<hex(HMAC-SHA256(rawBody, BOT_WEBHOOK_SECRET))>
```

Stesso segreto e stesso schema di firma delle altre due direzioni.

### Body

```ts
interface SendAgendaPayload {
  leadId:    string;   // UUID del lead nel CRM
  phone:     string;   // grezzo dal DB — normalizzazione E.164 a carico del bot
  companyId: 'fenice'; // obbligatorio: altri valori → 403
  name?:     string;
  email?:    string;
  funnel?:   string;
  variant: {           // sceglie testo e video; se assente vale tutto false
    lavora:         boolean;
    haFamiglia:     boolean;
    offertaDelMese: boolean;  // prevale sugli altri due
  };
}
```

### Risposta

Sempre **HTTP 200** quando la richiesta è valida: l'esito applicativo sta nel corpo,
non nello stato HTTP. Codici diversi da 200 solo per errori di protocollo
(401 firma, 403 companyId, 400 corpo, 429 rate limit).

```json
{ "ok": true, "esito": "consegnato", "deduplicato": false, "conversationId": 1234, "sid": "SM..." }
```

| `esito` | Significato | Ritentabile |
|---|---|---|
| `consegnato` | Twilio conferma delivered/read | — |
| `inviato` | accettato da Twilio, nessuna conferma entro ~8s (telefono spento/offline) | **NO** — arriverebbe doppio al ritorno online |
| `fallito` | numero non su WhatsApp, template bloccato, Twilio giù | sì |

La risposta arriva entro ~8s; il CRM attende fino a 12s prima di considerarlo un
errore di rete.

**Lato CRM:** `agendaSentAt` viene scritto **solo** su `consegnato` e `inviato`. Su
`fallito` non si scrive e non si logga `AGENDA_SENT` — quell'evento alimenta le
statistiche e conterebbe un invio mai avvenuto. L'esito finisce su `leads.agendaStatus`,
che nella UI del GDO **disabilita il pulsante** quando vale `inviato`.

### Deduplica

Stesso `leadId` entro **15 minuti** → nessun reinvio, risposta con l'esito precedente
e `deduplicato: true`. Non si applica dopo un `fallito`.

> **Richiesta aperta:** includere anche la **variante** nella chiave di deduplica. Se il
> GDO sbaglia a impostare lavora/famiglia e corregge entro 15 minuti, oggi la correzione
> viene deduplicata e il lead resta col video sbagliato.

### Sequenza lato bot

1. Template `fenice_agenda_gdo_v3` (UTILITY) col link di prenotazione, che chiede
   esplicitamente al lead di rispondere.
2. **Alla prima risposta del lead** — qualunque essa sia — il video della variante,
   come testo libero.
3. Da lì il bot gestisce la conversazione sapendo che l'appuntamento è **già fissato**:
   non ripropone la call, non ripete il pitch, non manda solleciti. Il GDO non viene
   mai nominato.

> **Punto fragile noto:** senza una risposta del lead la finestra 24h di WhatsApp resta
> chiusa e **il video non parte**. Dipende da cosa dice il GDO al telefono; il CRM
> mostra un promemoria nel modale al momento dell'invio.

### Cosa il bot NON fa su questi lead

Il lead resta del GDO umano: nessuna transizione di stato, nessun follow-up "prenota",
nessuna classificazione automatica. L'unico ritorno ammesso è `NOTA` (vedi sotto).

---

## Codici di risposta `/api/bot/outcome`

| HTTP | `error` nel body | Significato |
|---|---|---|
| `200` | — (`{ ok: true }`) | Outcome registrato correttamente |
| `400` | `invalid_json` | Body non è JSON valido (parsing fallito) |
| `400` | `bad_request` | `leadId` o `outcome` mancanti/non validi; `date` assente, non ISO 8601, o priva di offset di fuso orario per APPUNTAMENTO/RICHIAMO; `note` vuota per NOTA |
| `401` | `invalid_signature` | Firma HMAC assente o non corrispondente |
| `403` | `forbidden` | Lead non appartiene all'azienda `fenice`, oppure non è assegnato a un account bot |
| `404` | `lead_not_found` | `leadId` non esiste nel DB |
| `409` | `update_failed` | La transizione di stato nel CRM non è riuscita (dettaglio in `detail`) |
| `503` | `not_configured` | `BOT_WEBHOOK_SECRET` non impostato su Vercel — contattare l'admin |

---

## Limitazioni note

### Cap giornaliero di assegnazioni (soft cap)

Il CRM applica un limite di **50 assegnazioni al giorno** all'account bot (`GDO 201`),
calcolato sul fuso orario `Europe/Rome` (alzato da 20 a 50 il 2026-07-24).

**Questo è un soft cap:** in caso di burst di assegnazioni concorrenti, il contatore
potrebbe essere superato di 1–2 lead. Il bot deve essere in grado di gestire volumi
leggermente superiori a 50 senza errori.

### Push best-effort

Il push CRM → Bot (Direzione 1) è **best-effort senza retry automatici**. Se il
server del bot non è raggiungibile al momento del push, il lead non verrà reinviato
automaticamente. Monitorare i log su Vercel (`[bot-fissatore]`) per i push falliti.
