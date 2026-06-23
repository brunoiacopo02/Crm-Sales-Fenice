# Bot Fissatore — Contratto di Integrazione

> **Destinatari:** team esterno del bot WhatsApp/telefonico.
> **Versione:** 1.1 — 2026-06-23 (aggiunto esito `INTERROTTO`; `NON_RISPOSTO` ora riassegna a operatore umano).

---

## Indice

1. [Account bot nel CRM](#account-bot-nel-crm)
2. [Variabili d'ambiente richieste](#variabili-dambiente-richieste)
3. [Schema firma HMAC](#schema-firma-hmac)
4. [Direzione 1 — CRM → Bot (push all'assegnazione)](#direzione-1--crm--bot-push-allassegnazione)
5. [Direzione 2 — Bot → CRM (callback outcome)](#direzione-2--bot--crm-callback-outcome)
6. [Codici di risposta `/api/bot/outcome`](#codici-di-risposta-apibotoutcome)
7. [Limitazioni note](#limitazioni-note)

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
  outcome:        BotOutcome; // Obbligatorio — uno dei 5 valori sotto
  date?:          string;     // Obbligatorio per APPUNTAMENTO e RICHIAMO (ISO 8601 con offset)
  note?:          string;     // Note libere sull'interazione
  discardReason?: string;     // Motivo scarto (usato per DA_SCARTARE)
  report?:        BotReport;  // Report strutturato (opzionale ma raccomandato)
}

type BotOutcome = 'APPUNTAMENTO' | 'DA_SCARTARE' | 'RICHIAMO' | 'NON_RISPOSTO' | 'INTERROTTO';
```

### Valori `outcome`

| Valore | Significato | `date` richiesta | Effetto nel CRM |
|---|---|---|---|
| `APPUNTAMENTO` | Lead ha fissato un appuntamento | SI | Passa alle Conferme |
| `RICHIAMO` | Lead vuole essere ricontattato | SI | Richiamo programmato sul bot |
| `DA_SCARTARE` | **Obiezione ferrea reale** (es. "non ho soldi", "non mi interessa") | No | **Scarto definitivo** |
| `NON_RISPOSTO` | Non ha **mai risposto** dopo il ciclo di solleciti | No | **Riassegnato a un operatore umano** (round-robin) |
| `INTERROTTO` | Chat **avviata ma interrotta senza obiezione ferrea** | No | **Riassegnato a un operatore umano** (round-robin) |

> **Importante (cambio rispetto alla v1.0):** `NON_RISPOSTO` non scarta più il lead — lo
> **restituisce** al CRM, che lo riassegna a un GDO umano. Il nuovo esito `INTERROTTO` ha lo
> stesso effetto. Usare `DA_SCARTARE` **solo** quando c'è un'obiezione ferrea reale: tutto ciò
> che non è un "no" netto (silenzio, chat che si spegne, tentennamenti) va in `NON_RISPOSTO` /
> `INTERROTTO` così la persona viene rilavorata a voce da un operatore.

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

## Codici di risposta `/api/bot/outcome`

| HTTP | `error` nel body | Significato |
|---|---|---|
| `200` | — (`{ ok: true }`) | Outcome registrato correttamente |
| `400` | `invalid_json` | Body non è JSON valido (parsing fallito) |
| `400` | `bad_request` | `leadId` o `outcome` mancanti/non validi; `date` assente, non ISO 8601, o priva di offset di fuso orario per APPUNTAMENTO/RICHIAMO |
| `401` | `invalid_signature` | Firma HMAC assente o non corrispondente |
| `403` | `forbidden` | Lead non appartiene all'azienda `fenice`, oppure non è assegnato a un account bot |
| `404` | `lead_not_found` | `leadId` non esiste nel DB |
| `409` | `update_failed` | La transizione di stato nel CRM non è riuscita (dettaglio in `detail`) |
| `503` | `not_configured` | `BOT_WEBHOOK_SECRET` non impostato su Vercel — contattare l'admin |

---

## Limitazioni note

### Cap giornaliero di assegnazioni (soft cap)

Il CRM applica un limite di **20 assegnazioni al giorno** all'account bot (`GDO 201`),
calcolato sul fuso orario `Europe/Rome`.

**Questo è un soft cap:** in caso di burst di assegnazioni concorrenti, il contatore
potrebbe essere superato di 1–2 lead. Questo è accettabile nella fase di test.
Il bot deve essere in grado di gestire volumi leggermente superiori a 20 senza errori.

### Push best-effort

Il push CRM → Bot (Direzione 1) è **best-effort senza retry automatici**. Se il
server del bot non è raggiungibile al momento del push, il lead non verrà reinviato
automaticamente. Monitorare i log su Vercel (`[bot-fissatore]`) per i push falliti.
