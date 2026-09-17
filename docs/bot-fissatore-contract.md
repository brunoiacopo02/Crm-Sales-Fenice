# Bot Fissatore — Contratto di Integrazione

> **Destinatari:** team esterno del bot WhatsApp/telefonico.
> **Versione:** 1.7 — 2026-09-17. Cosa cambia rispetto alla 1.6:
> - **Ritorno al pool confermato dal CRM.** `NON_RISPOSTO`/`INTERROTTO` su un lead del
>   lancio ancora in mano al bot non fanno più round robin verso un GDO: tornano nel
>   pool di `/import` (bucket lancio). La frase "arriva con la v1.7" della 1.6 è
>   sostituita dal comportamento reale: risposta `{ ok: true, returnedToPool: true,
>   motivo }` oppure `{ ok: true, returnedToPool: false, skipped: '<motivo>' }` —
>   vedi [§4.6.1](#lead-del-lancio-nuovo-in-v16) e i [codici di risposta](#codici-di-risposta-apibotoutcome).
> - **Documentate per la prima volta le tre rotte `/api/bot/lancio/*`** (slot,
>   prenotazione, chiamata subito): erano già in produzione ma assenti da questo
>   contratto. Vedi [Direzione 6](#direzione-6--bot--crm-prenotazione-lancio-slot-prenotazione-chiamata-subito--nuovo-in-v17).
> - **Pulsante webinar**: interruttore lato bot `app_settings.lancio_pulsante_attivo`
>   e provenienza `"Lancio Web Dev AI"` su `/api/bot/lead-entrante` solo quando la
>   chat viene adottata in quel momento (non sul canale a lista `/api/admin/lead-entranti`).
> - **"Offerta del mese"**: nel CRM la checkbox è diventata un pulsante in cima alla
>   modale Agenda, ma il payload di `/api/send-agenda` **non cambia**
>   (`variant.offertaDelMese` invariato). Il bot manda il video di una sua
>   impostazione: se vuota, l'agenda parte senza video e il bot logga un warning
>   suo — il CRM non lo sa e non ha nulla da fare qui.
> - **Intake**: la risposta del bot a `/api/bot/intake` può portare
>   `apertura: "saltata_chat_in_corso"` quando il lead ha già una chat viva. Il CRM
>   **non legge** questo campo (guarda solo `duplicato`): è documentato qui per
>   chiarezza, non richiede né richiederà una modifica lato CRM.
>
> Versione precedente: 1.6 — 2026-09-14 (intake: campo opzionale `lancio` per i lead del lancio "Web Developer AI"; documentati `personKey` e `previousLeadIds`, già in produzione dal 2026-08-29).
> Versione precedente ancora: 1.5 — 2026-08-26 (`CONTATTO_UMANO` porta motivo e contesto e finisce in una coda vera; `RICHIAMO` senza data certa; `APPUNTAMENTO` con data diversa = rifissaggio invece di scarto silenzioso).
>
> **Il contratto cresce, non cambia.** Ogni payload valido nella v1.6 resta valido:
> la v1.7 aggiunge la semantica di ritorno del §4.6, documenta tre rotte già live e
> annota due comportamenti lato bot che non toccano il CRM.

---

## Indice

1. [Account bot nel CRM](#account-bot-nel-crm)
2. [Variabili d'ambiente richieste](#variabili-dambiente-richieste)
3. [Schema firma HMAC](#schema-firma-hmac)
4. [Direzione 1 — CRM → Bot (push all'assegnazione)](#direzione-1--crm--bot-push-allassegnazione)
5. [Direzione 2 — Bot → CRM (callback outcome)](#direzione-2--bot--crm-callback-outcome)
6. [Direzione 3 — CRM → Bot (invio agenda)](#direzione-3--crm--bot-invio-agenda)
7. [Direzione 4 — CRM → Bot (data dell'appuntamento)](#direzione-4--crm--bot-data-dellappuntamento)
8. [Direzione 5 — Bot → CRM (cosa succede dopo l'appuntamento)](#direzione-5--bot--crm-cosa-succede-dopo-lappuntamento--nuovo-in-v15)
9. [Direzione 6 — Bot → CRM (prenotazione lancio: slot, prenotazione, chiamata subito)](#direzione-6--bot--crm-prenotazione-lancio-slot-prenotazione-chiamata-subito--nuovo-in-v17)
10. [Codici di risposta `/api/bot/outcome`](#codici-di-risposta-apibotoutcome)
11. [Limitazioni note](#limitazioni-note)

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

# Canale agenda e appuntamenti (solo lato CRM)
AGENDA_CHANNEL=bot              # `bot` = agenda dal canale fornitore (Direzione 3).
                                # Toglierla fa tornare l'agenda su ActiveCampaign e
                                # spegne anche la Direzione 4: è il rollback completo.
AGENDA_BOT_URL=                 # Default: https://web-app-messaggistica.vercel.app/api/send-agenda
APPOINTMENT_BOT_URL=            # Default: https://web-app-messaggistica.vercel.app/api/appointment-set

# Lancio Web Developer AI (solo lato CRM, v1.6)
LANCIO_WEBDEV_INTAKE=           # `on` = i lead della lista AC "Lancio Web Developer AI"
                                # entrano nel CRM e vanno al bot con il campo `lancio`.
                                # Qualunque altro valore o assenza = lista bloccata
                                # (comportamento del 14/09), recupero dal sync su /import.
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

  // Dal 2026-08-29 (documentati qui in v1.6)
  personKey?:       string;            // ultime 10 cifre del numero: la stessa persona ha sempre la stessa chiave
  previousLeadIds?: PreviousLeadRef[]; // i lead precedenti con la stessa personKey, dal più recente, max 10

  // v1.6 — SOLO sui lead del lancio (assente = flusso attuale, invariato)
  lancio?: {
    slug:     string;                        // 'webdev-2026-10' per il lancio di ottobre 2026
    ingresso: 'lista' | 'pulsante_webinar';  // come è entrato: lista AC 132, o pulsante WhatsApp la sera della live
  };
}

interface PreviousLeadRef {
  leadId:    string;
  status:    string;         // 'NEW' | 'IN_PROGRESS' | 'APPOINTMENT' | 'REJECTED'
  outcome:   string | null;  // discardReason del lead precedente, se scartato
  createdAt: string;         // ISO
}
```

> **Attenzione — numero di telefono grezzo:** `phone` arriva direttamente dal DB del CRM
> senza normalizzazione (esempi: `"3331234567"`, `"333 123 4567"`, `"+39 333 1234567"`).
> **Il bot è responsabile della normalizzazione al formato E.164** (es. `+393331234567`)
> prima di inviare messaggi WhatsApp o effettuare chiamate.

### Lead del lancio (nuovo in v1.6)

Quando `lancio` è presente il bot NON manda l'apertura di Mario: apre con il **template
di benvenuto del lancio** e la conversazione entra nel modo lancio (`lancio_slug`,
`lancio_fase='attesa'`). Cosa cambia per il bot, in breve:

- `funnel` vale `"Lancio Web Dev AI"` e `companyId` `"fenice"`.
- `lancio.ingresso = 'lista'` è l'unico valore che il CRM manda dall'intake: i lead della
  lista AC arrivano dal webhook (uno alla volta, appena si iscrivono) o dal sync di recupero
  su `/import` (a lotti, 30/min, stesso payload). `'pulsante_webinar'` è riservato ai lead che
  scrivono per primi dal pulsante della live: quelli NON passano dall'intake, ma da
  `POST /api/bot/lead-entrante` (nuovo in v1.7, stessa auth HMAC delle altre rotte).
  Il bot manda `provenienza: "Lancio Web Dev AI"` — testo esatto, il CRM lo confronta
  case-insensitive — **solo quando adotta la chat in quel momento** (il lead scrive,
  il bot lo riconosce e chiama subito questa rotta): sul canale a lista
  `/api/admin/lead-entranti` (il polling di recupero) la stessa provenienza non fa
  entrare nel bucket del lancio, perché quel canale non distingue "adesso" da "prima".
  Un interruttore lato bot (`app_settings.lancio_pulsante_attivo`) decide se il
  pulsante della live è attivo: a interruttore spento il bot non lo propone e questa
  provenienza non arriva mai. Il lead nasce assegnato **direttamente** all'account
  bot (`lancioIngresso='pulsante_webinar'`), senza passare dall'intake.
- Idempotenza come oggi: stesso `leadId` o stessa `personKey` con chat viva → `duplicato:true`,
  nessun secondo benvenuto, ma `lancio_*` vanno valorizzati lo stesso.
- Timeout e regola "un `network_error` è già arrivato" (15 s, 2026-09-10): invariati.

#### `NON_RISPOSTO` / `INTERROTTO` sui lead del lancio (nuovo in v1.7)

Gli esiti restano gli stessi sette valori di `/api/bot/outcome`, ma su un lead del
lancio **ancora in mano al bot** (`launchBucket = LANCIO_WEBDEV_2026`, assegnatario =
account bot) `NON_RISPOSTO` e `INTERROTTO` **non** fanno il round robin verso un GDO
umano: rimettono il lead nel pool di `/import` (`assignedToId = null`, `status = 'NEW'`,
`callCount = 0`, richiami azzerati), da dove gli admin lo ridistribuiscono ai GDO come
per Black Summer. `assignedAt` **non** si tocca: il lead conta dal giorno in cui è
entrato al bot.

Il **motivo** del ritorno lo legge dal testo di `note` (case-insensitive, trattino
opzionale), in quest'ordine:

| Pattern in `note` | `motivo` restituito |
|---|---|
| `follow-up non inviato` / `followup non inviato` | `followup_non_inviato` — non è freddezza del lead, è un nostro follow-up mai partito |
| `silenzio dopo il follow-up` | `silenzio_dopo_followup` |
| `mai risposto` | `mai_risposto` |
| nessuno dei precedenti | `INTERROTTO` → `silenzio_dopo_followup`; `NON_RISPOSTO` → `mai_risposto` |

Risposta:

- Ritorno effettuato: `{ ok: true, returnedToPool: true, motivo: '<uno dei tre sopra>' }`.
- Ritorno **non** effettuato: `{ ok: true, returnedToPool: false, skipped: '<motivo>' }`,
  sempre `200`, mai una scrittura. `skipped` può valere:
  - `already_returned` — il lead è **già** tornato nel pool (un secondo invio dello
    stesso esito, o il cron di restituzione che ritenta): non è un abuso, è un
    doppione riconosciuto. Prima di questa deroga il secondo tentativo prendeva un
    403 fuorviante e il cron ritentava ogni ora all'infinito.
  - `already_rejected` — il lead è `REJECTED`: una decisione presa non si annulla.
  - `locked_appointment` — il lead ha già una call in agenda o una presenza
    registrata: non torna mai nel pool.
  - `scelta_fatta` — il lead ha scelto la sera del lancio (`lancioScelta` valorizzato):
    è di un venditore o delle Conferme, vicolo cieco voluto anche se il bot ritenta.
  - `lead_not_found` — il lead non esiste più al momento della scrittura.
- Su un lead del lancio **già passato a un GDO umano** questi due esiti non arrivano
  nemmeno a questo ramo: il blocco di autorizzazione (sopra, invariato) risponde
  `403 forbidden` — `NON_RISPOSTO`/`INTERROTTO` non sono fra gli esiti ammessi
  (`NOTA`/`APPUNTAMENTO`/`CONTATTO_UMANO`) su un lead assegnato a un umano.
  Un lead **che non è del bucket lancio** (un lead ordinario del bot) segue invece
  la strada di sempre — round robin verso un GDO umano via
  `reassignBotLeadToHumanPool` — perché la guardia `launchBucket === bucket lancio`
  non lo fa entrare in questo ramo.

### Risposta attesa

Il CRM legge dal corpo di risposta solo `duplicato: true` (il fornitore riconosce il
lead come già entrato — risposta a un nostro ritento, non un lead nuovo né uno scarto)
e si aspetta comunque HTTP `2xx`. In caso di errore lato bot il push viene considerato
completato (no retry automatico).

> **Campo `apertura` (nuovo in v1.7, informativo).** Il bot può rispondere anche con
> `apertura: "saltata_chat_in_corso"` quando il lead che gli abbiamo appena pushato ha
> già una conversazione viva (es. ci ha scritto lui per primo ed è stato adottato da
> `/api/bot/lead-entrante` un attimo prima). **Il CRM non legge questo campo**: non
> cambia `result` nell'audit `BOT_PUSHED` né alcun altro comportamento. È documentato
> qui solo perché il fornitore lo manda — non perché il CRM debba reagirci.

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
  outcome:        BotOutcome; // Obbligatorio — uno dei 7 valori sotto
  date?:          string;     // Obbligatorio per APPUNTAMENTO; per RICHIAMO se manca `periodo` (ISO 8601 con offset)
  periodo?:       string;     // v1.5 — RICHIAMO senza data certa, testo libero ("a settembre")
  note?:          string;     // Note libere sull'interazione (obbligatoria per NOTA e CONTATTO_UMANO)
  discardReason?: string;     // Motivo scarto (usato per DA_SCARTARE)
  motivo?:        string;     // v1.5 — CONTATTO_UMANO: categoria chiusa del motivo
  info?:          object;     // v1.5 — CONTATTO_UMANO: contesto sul lead (vedi sotto)
  report?:        BotReport;  // Report strutturato (opzionale ma raccomandato)
}

type BotOutcome = 'APPUNTAMENTO' | 'DA_SCARTARE' | 'RICHIAMO' | 'NON_RISPOSTO' | 'INTERROTTO' | 'NOTA' | 'CONTATTO_UMANO';
```

### Valori `outcome`

| Valore | Significato | `date` richiesta | Effetto nel CRM |
|---|---|---|---|
| `APPUNTAMENTO` | Lead ha fissato un appuntamento | SI | Passa alle Conferme |
| `RICHIAMO` | Lead vuole essere ricontattato | SI, oppure `periodo` | Richiamo programmato sul bot |
| `DA_SCARTARE` | **Obiezione ferrea reale** (es. "non ho soldi", "non mi interessa") | No | **Scarto definitivo** |
| `NON_RISPOSTO` | Non ha **mai risposto** dopo il ciclo di solleciti | No | **Riassegnato a un operatore umano** (round-robin) |
| `INTERROTTO` | Chat **avviata ma interrotta senza obiezione ferrea** | No | **Riassegnato a un operatore umano** (round-robin) |
| `NOTA` | **Annotazione senza cambio di stato** (es. disdetta o richiesta di spostamento su lead già appuntato) | No | Nota in timeline + **notifica al team Conferme** se il lead è appuntato. Non tocca stato, appuntamento né assegnazione |
| `CONTATTO_UMANO` | Il lead **chiede espressamente di parlare con una persona** | No | Segnalazione in timeline + **notifica agli amministratori** (e alle Conferme se il lead è appuntato). Non tocca stato, appuntamento né assegnazione |

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

> **Quando usare `CONTATTO_UMANO` (nuovo in v1.4):** quando il lead chiede di parlare con
> una persona e il bot promette il richiamo. Prima quella richiesta non arrivava a
> nessuno. Il campo `note` è **obbligatorio** (400 se vuoto): è la richiesta del lead, e
> senza il testo la segnalazione non serve a niente.
>
> Non è un `RICHIAMO`: quello lascerebbe il lead sull'account bot, dove nessun umano
> guarda. `CONTATTO_UMANO` **non cambia stato, non riassegna, non tocca l'appuntamento** —
> è una segnalazione, il lead resta dov'è. Il CRM scrive un evento in timeline e manda una
> notifica cliccabile a tutti gli amministratori attivi; se il lead è già in `APPOINTMENT`
> la ricevono anche le Conferme, che sono quelle che lo richiamano il giorno prima.
>
> **Riemissione libera.** Il bot può riemettere l'esito a ogni messaggio del lead: l'evento
> viene sempre scritto (ogni riformulazione resta leggibile in timeline), ma la notifica è
> soppressa se sullo stesso lead ce n'è già stata una nelle **24 ore** precedenti — in quel
> caso la risposta contiene `notifySuppressed: true`. La finestra è di 24h e non di pochi
> minuti di proposito: copre il tempo entro cui un admin prende in carico la richiesta. Se
> il lead richiede di essere richiamato la settimana dopo, è una richiesta nuova e notifica
> di nuovo. Risposta: `{ ok: true, noted: true }`.

### `CONTATTO_UMANO`: motivo e contesto (nuovo in v1.5)

Dal 26/08 la richiesta non è più solo una notifica: entra in una **coda** che un
amministratore vede su `/richieste-contatto` e da cui assegna il lead al GDO che lo
richiama. Perché quella coda sia lavorabile servono due campi in più — entrambi
**opzionali** (una richiesta senza di essi entra comunque in coda), ma senza i quali
chi chiama parte alla cieca:

```ts
{
  outcome: 'CONTATTO_UMANO',
  leadId:  '…',
  note:    'Mi puoi chiamare? Vorrei capire meglio i costi',   // le parole del lead
  motivo:  'prezzo',                                            // categoria chiusa
  info: {
    sintesi:           'Interessata al percorso, blocco sul prezzo',
    disponibilita:     'dopo le 18',
    telefonoPreferito: '+39…',      // se diverso da quello che abbiamo
    urgenza:           'alta',      // 'alta' | 'media' | 'bassa'
    argomenti:         ['rateizzazione', 'durata']
  }
}
```

**Categorie di `motivo`.** Il CRM normalizza: maiuscole, spazi e trattini non contano, e
un valore che non riconosce diventa `altro` — **mai un 400**, una categoria sbagliata è
un fastidio ma una richiesta persa è un lead perso.

| Categoria | Quando |
|---|---|
| `richiamo` | Vuole essere richiamato, senza un tema preciso |
| `prezzo` | Costi, rateizzazione, pagamenti |
| `programma` | Come funziona il percorso, durata, contenuti |
| `sfiducia_bot` | Non si fida della chat, vuole una persona vera |
| `problema_tecnico` | Link o video che non funzionano |
| `disdetta` | Vuole disdire o spostare un appuntamento |
| `altro` | Tutto il resto |

**Riemissione:** invariata (l'evento si scrive sempre, la notifica è soppressa entro 24h),
ma in coda resta **una sola riga per lead**: la riemissione aggiorna il motivo di quella
riga e ne incrementa il contatore, non ne crea una seconda. Una richiesta già gestita non
si riapre: se il lead torna a chiedere dopo giorni, torna in cima come richiesta nuova.

### `RICHIAMO` senza data certa (nuovo in v1.5)

Quando il lead dice "ci risentiamo a settembre" non esiste un istante da scrivere. Fino
alla v1.4 la route pretendeva un ISO su ogni `RICHIAMO`, e il risultato era che il bot
**inventava** giorno e ora: su 26 richiami, 22 cadevano su ore tonde che nessun lead aveva
mai detto. Ora `periodo` è un'alternativa a `date`:

```json
{ "leadId": "…", "outcome": "RICHIAMO", "periodo": "a settembre", "note": "Riprende dopo le ferie" }
```

Il lead va `IN_PROGRESS` senza data di richiamo e il periodo finisce nella nota che il GDO
legge in pipeline. Se mandi `date` valgono le regole di sempre (ISO con offset). Se non
mandi né `date` né `periodo`: `400`.

### `APPUNTAMENTO` con data diversa = rifissaggio (nuovo in v1.5)

Dal 10/07 un `APPUNTAMENTO` su un lead già appuntato riceveva `{ ok: true, deduped: true }`
senza scritture: serviva a fermare il re-invio orario dello stesso esito. L'effetto
collaterale era che **un cambio di data concordato in chat lo perdevamo in silenzio**, e le
Conferme chiamavano per un orario che il lead aveva già spostato.

Ora conta la data:

- **stessa data** (entro un minuto) → `{ ok: true, deduped: true }`, come prima;
- **data diversa** → aggiorniamo `appointmentDate`, scriviamo un evento
  `BOT_APPOINTMENT_RESCHEDULED` e **notifichiamo le Conferme**. Risposta:
  `{ ok: true, rescheduled: true }`.

Il rifissaggio **non** viene contato come un fissaggio nuovo (non ritimbriamo la data di
creazione dell'appuntamento): altrimenti un lead spostato tre volte comparirebbe tre volte
tra gli appuntamenti presi oggi. Il campo `noteOnly` che avete proposto non serve.

> **`NOTA` sui lead dei GDO umani (nuovo in v1.3):** da quando l'agenda parte dal canale
> bot (Direzione 3), il bot conversa anche con lead che **non gli sono assegnati**. Su
> quei lead non è ammesso tutto: serve la prova che il lead sia davvero passato dal bot.
> Ogni altro esito resta **403**.

> **`APPUNTAMENTO` sui lead che il bot aveva restituito (nuovo in v1.4):** se il bot ci ha
> ridato un lead (`INTERROTTO` / `NON_RISPOSTO`) e poi la conversazione riprende e si
> chiude con un appuntamento, quell'esito **ora viene accettato** invece di tornare `403`.
> Il CRM riprende il lead sull'account bot **prima** di registrare l'esito, così
> l'appuntamento resta attribuito al bot e non al GDO che non l'ha fissato. Da lì l'esito
> segue la strada di sempre: handoff alle Conferme, call log e webhook marketing identici.
> Il payload non cambia.
>
> Vale **solo per `APPUNTAMENTO`**: uno scarto o un richiamo su un lead che sta lavorando
> una persona ne sovrascriverebbe il lavoro, e restano `403`.
>
> **Due prove diverse, non una.** Il segreto condiviso non è il permesso di scrivere su
> qualunque riga del database:
>
> - **soglia bassa** — il lead *è passato* dal bot: esiste un `BOT_PUSHED` andato a buon
>   fine **oppure** l'agenda è stata recapitata dal canale bot (`agendaStatus` =
>   `consegnato` / `inviato`). Basta per `NOTA` e `CONTATTO_UMANO`, che non spostano nulla.
> - **soglia alta** — il lead *è stato lavorato* dal bot: esiste un `BOT_PUSHED` andato a
>   buon fine. Serve per `APPUNTAMENTO`. Un'agenda recapitata non è mai stata una
>   conversazione del bot da chiudere, e un GDO che ha fissato lui l'appuntamento non deve
>   vederselo portare via.

| Assegnatario del lead | Prova di provenienza | Esiti ammessi |
|---|---|---|
| account bot | — | tutti |
| GDO umano | `BOT_PUSHED` riuscito | `NOTA`, `CONTATTO_UMANO`, `APPUNTAMENTO` |
| GDO umano | solo agenda recapitata | `NOTA`, `CONTATTO_UMANO` |
| GDO umano | nessuna | nessuno (403) |

> **Eccezione sui lead che hanno già prodotto storico.** Se il lead ha già una presenza
> registrata, l'appuntamento **viene comunque accettato** ma il lead **non** passa
> all'account bot: resta al GDO umano che ce l'ha. Spostarlo cancellerebbe a posteriori una
> presenza da un ciclo bonus già chiuso e pagato. Dal punto di vista del bot non cambia
> nulla: la risposta è `200` in entrambi i casi.

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

### Deduplica e correzione della variante

Stesso `leadId` entro **15 minuti** → nessun reinvio, risposta con l'esito precedente
e `deduplicato: true`. Non si applica dopo un `fallito`.

La variante **non** entra nella chiave di deduplica, di proposito: entrarci farebbe
partire due volte lo stesso identico messaggio di agenda. Il fornitore aggiorna invece
il **video** che partirà alla risposta del lead, e lo comunica con due campi:

| Campo | Significato | Cosa fa il CRM |
|---|---|---|
| `varianteAggiornata: true` | correzione applicata, il lead riceverà il video giusto | messaggio "Variante aggiornata" nel modale |
| `videoGiaInviato: true` | il lead aveva già risposto e il video **sbagliato è già partito** | avviso rosso a tutto schermo, la modale **non si chiude da sola**: il GDO deve dirlo al lead mentre è in chiamata |

Il secondo caso non è recuperabile via software ed è giusto che il CRM lo dica invece
di aggiornare una colonna facendo finta di aver risolto.

> **"Offerta del mese" (v1.7, solo UI CRM).** Nel modale Agenda del GDO la checkbox
> `offertaDelMese` è diventata un pulsante a tutta larghezza in cima al modale
> (toggle evidente invece di una checkbox tra le altre): cambia solo la UI, il
> payload resta **esattamente** questo, `variant.offertaDelMese: boolean` come già
> documentato — nessun campo nuovo. Il video che parte per questa variante è
> un'impostazione **del bot**, non del CRM: se quell'impostazione è vuota il bot
> manda comunque l'agenda ma senza video, e logga un avviso dalla sua parte. Il CRM
> non lo sa e non ha alcuna azione da fare — lo documentiamo qui solo per chiarezza.

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

### Avviso di consegna a posteriori — Bot → CRM

Un'agenda uscita con esito `inviato` resterebbe in quello stato per sempre, e con essa
il blocco del reinvio nella UI. Quando quel messaggio viene poi consegnato davvero, il
bot chiama:

```
POST https://crm-sales-fenice.vercel.app/api/bot/agenda-delivery
x-bot-signature: sha256=<hex(HMAC-SHA256(rawBody, BOT_WEBHOOK_SECRET))>

{ "leadId": "...", "esito": "consegnato", "sid": "SM...", "at": "2026-07-30T18:00:00.000Z" }
```

L'endpoint agisce **solo** sulla transizione `inviato` → `consegnato`. Qualunque altro
stato (già consegnato, fallito, mai inviato) risponde `200 { ok: true, ignored: true }`
senza scrivere: un retry non è mai un problema.

| HTTP | Significato |
|---|---|
| `200 { ok: true, updated: true }` | stato aggiornato, reinvio sbloccato |
| `200 { ok: true, ignored: true }` | avviso ripetuto o fuori tempo — nessuna azione |
| `400` | `leadId` mancante o `esito` diverso da `"consegnato"` |
| `401` | firma non valida |
| `403` | lead non Fenice |
| `404` | lead inesistente |

### Cosa il bot NON fa su questi lead

Il lead resta del GDO umano: nessuna transizione di stato, nessun follow-up "prenota",
nessuna classificazione automatica. Gli unici ritorni ammessi sono `NOTA` e
`CONTATTO_UMANO` (vedi la tabella degli esiti ammessi nella Direzione 2).

---

## Direzione 4 — CRM → Bot (data dell'appuntamento)

> **Stato: endpoint non ancora disponibile lato fornitore.** Il CRM effettua già le
> chiamate; finché l'endpoint non risponde, falliscono in silenzio e restano solo nei log.

Il payload di `/api/send-agenda` **non può** portare la data dell'appuntamento: quando il
GDO manda l'agenda, l'appuntamento quasi sempre non esiste ancora. Misurato su quattro
giorni di produzione: **su 274 casi, in 265 la data è stata registrata DOPO l'invio
dell'agenda**, in media 65 secondi dopo. Serve quindi una seconda chiamata, fatta nel
momento in cui la data esiste davvero e ripetuta a ogni spostamento — altrimenti il bot
resta con la data vecchia e la dice sbagliata al lead.

### Request

```
POST https://web-app-messaggistica.vercel.app/api/appointment-set
Content-Type: application/json
x-bot-signature: sha256=<hex(HMAC-SHA256(rawBody, BOT_WEBHOOK_SECRET))>
```

Stessa firma HMAC dell'agenda. L'URL è configurabile lato CRM con `APPOINTMENT_BOT_URL`.

### Body

```ts
interface AppointmentSetBody {
  leadId:           string;  // UUID del lead nel CRM
  phone:            string;  // Telefono del lead
  companyId:        'fenice';
  name?:            string;
  funnel?:          string;
  appointmentAt:    string;  // ISO 8601 con offset esplicito, es. "2026-08-12T15:00:00+02:00"
  appointmentLabel: string;  // Etichetta pronta da leggere, es. "mercoledì 12 agosto alle 15:00"
  trigger:          'fissato' | 'spostato';
}
```

`appointmentLabel` è già formattata in italiano e nel fuso `Europe/Rome`: serve perché il
bot non debba riformattare la data (e sbagliarla) per dirla al lead.

### Quando parte

Ai quattro punti in cui la data nasce o cambia: nuovo appuntamento del GDO, spostamento
del GDO, modifica dati dalle Conferme, rifissaggio delle Conferme. **Non** parte quando è
il bot stesso a fissare — la data l'ha mandata lui.

### Risposta attesa

Un `200` qualunque è sufficiente. Il CRM **non** legge il corpo della risposta e **non**
scrive nulla sul lead in base a questa chiamata: un fornitore giù non deve impedire a un
GDO di esitare il lead. Il timeout è di **6 secondi** (più stretto dei 12s dell'agenda,
perché qui siamo dentro l'esito del GDO che non deve restare appeso).

---

## Direzione 5 — Bot → CRM (cosa succede dopo l'appuntamento) — nuovo in v1.5

Il database del bot si ferma al momento in cui l'appuntamento viene preso. Senza sapere
chi si presenta e chi compra, l'unica cosa che il bot può ottimizzare è il **numero** di
appuntamenti: può farlo crescere e peggiorare il risultato senza che nessuno se ne
accorga. Questo endpoint chiude il cerchio.

È un canale **in lettura e in pull**, non un webhook: nessuna coda di consegna da
mantenere, nessun evento perso se il ricevente è giù, nessun ordine da ricostruire. Il
bot chiede "cosa è cambiato da questo istante", riceve le righe in ordine di
aggiornamento e riparte dall'ultimo `nextSince`.

### Request

```
POST https://crm-sales-fenice.vercel.app/api/bot/lead-status
x-bot-signature: sha256=<hmac del body grezzo, stesso BOT_WEBHOOK_SECRET>
Content-Type: application/json

{ "since": "2026-08-26T00:00:00+02:00", "limit": 200 }
```

`limit` è opzionale: default 200, massimo 1000.

### Risposta

```jsonc
{
  "leads": [
    {
      "leadId": "…",
      "status": "APPOINTMENT",              // stato nel CRM
      "appointmentDate": "2026-08-28T17:00:00.000Z",
      "appointmentCreatedAt": "2026-08-26T09:12:00.000Z",
      "confermeOutcome": "confermato",      // confermato | scartato | da_rifissare | null
      "confermeOutcomeAt": "2026-08-27T10:03:00.000Z",
      "confermeDiscardReason": null,
      "presented": true,                    // si è presentato alla call
      "presentedAt": "2026-08-28T17:00:00.000Z",
      "salesOutcome": "Chiuso",             // Chiuso | Non chiuso | Sparito | null
      "salesOutcomeAt": "2026-08-28T18:20:00.000Z",
      "sold": true,
      "soldProduct": "gold",
      "soldAmountEur": 3500,
      "discardReason": null,
      "agendaStatus": "consegnato",
      "updatedAt": "2026-08-28T18:20:00.000Z"
    }
  ],
  "nextSince": "2026-08-28T18:20:00.000Z",
  "hasMore": false
}
```

### Come si consuma

1. Si parte da un `since` qualunque (per il primo giro, la data di go-live del bot).
2. Finché `hasMore` è `true`, si richiama subito con `since = nextSince`.
3. Quando `hasMore` è `false`, si salva `nextSince` e si ripassa più tardi — un giro
   ogni 15-30 minuti è più che sufficiente.

`nextSince` è l'`updatedAt` dell'ultima riga servita, **non** "adesso": ripartire da
adesso salterebbe tutto ciò che cambia mentre si scorrono le pagine.

### Perimetro

Escono **solo** i lead che il bot ha davvero lavorato: quelli che gli abbiamo pushato
(`BOT_PUSHED` consegnato) o di cui ha recapitato l'agenda. Non è un export del CRM.

### Avvertenze

- `presented` è **latchato**: una volta vero non torna falso. Uno "Sparito" a un
  follow-up successivo non cancella una presenza già avvenuta.
- Una riga può ricomparire più volte nel tempo: ogni modifica al lead ne aggiorna
  `updatedAt`. Va trattata come uno stato corrente da sovrascrivere, non come un evento
  da accumulare.
- `salesOutcome` può cambiare dopo la prima registrazione (correzioni, follow-up): vale
  sempre l'ultimo valore letto.

---

## Direzione 6 — Bot → CRM (prenotazione lancio: slot, prenotazione, chiamata subito) — nuovo in v1.7

Tre rotte, tutte già in produzione dal blocco lancio di metà settembre 2026 ma mai
descritte in questo contratto fino ad ora. Servono **solo** i lead del bucket del
lancio "Web Developer AI" (`launchBucket = 'LANCIO_WEBDEV_2026'`), la sera del
webinar (5/10/2026) e il giorno dopo. Fuori da quella finestra e da quel bucket
queste rotte non si usano.

### Auth e guardia comune

Stessa firma HMAC delle altre rotte bot (`x-bot-signature`, stesso
`BOT_WEBHOOK_SECRET`), verificata sul corpo grezzo. Errori comuni alle tre rotte:

| HTTP | `motivo` | Quando |
|---|---|---|
| `401` | `invalid_signature` | Firma assente o non corrispondente |
| `400` | `invalid_json` | Corpo non JSON valido |
| `503` | `not_configured` | `BOT_WEBHOOK_SECRET` non impostato |
| `503` | `bot_account_not_found` | Account bot Fenice non trovato |
| `404` | `lead_not_found` | `leadId` inesistente (solo `/book` e `/call-now`) |
| `403` | `forbidden` — `lead non del lancio o non in mano al bot` | Il lead non è del bucket lancio, oppure non è assegnato all'account bot **e** non è entrato dal pulsante webinar (`lancioIngresso !== 'pulsante_webinar'`) |
| `403` | `forbidden` — `lead già presentato` | (solo `/book` e `/call-now`) `presentedAt` è valorizzato: la trattativa è già cominciata, il bot non tocca più questo lead |

### `POST /api/bot/lancio/slots`

Body: `{ "date": "2026-10-06" }` (formato `YYYY-MM-DD`; solo le due date del lancio
sono valide — il giorno dopo il webinar e il giorno successivo — altrimenti
`422 { ok:false, motivo:'fuori_regole' }`; un formato data sbagliato è
`400 bad_request`).

Risposta `200`:

```jsonc
{
  "ok": true,
  "date": "2026-10-06",
  "mattina": [ { "hour": 9, "liberi": 2 }, { "hour": 10, "liberi": 0 }, "…" ],
  "pomeriggio": { "aperto": true, "ore": [15, 16, 17, 18, 19, 20] },
  "mattinaEsaurita": false,
  "oreAmmesse": [9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
}
```

- **Giorno dopo (6/10):** `mattina` è la copertura reale dei venditori di turno
  (9-14, round robin): `liberi` conta chi ha dichiarato quell'ora libera nel proprio
  calendario, non bloccata e non già occupata da un altro appuntamento (gli esenti
  dal calendario contano libere tutte le ore del turno). `mattinaEsaurita: true`
  quando **ogni** ora ha zero liberi. `pomeriggio` (15-20) va invece alle Conferme,
  senza venditore assegnato.
- **Dopodomani (7/10):** `mattina` vale la stringa letterale `"conferme"` (non c'è
  più copertura venditori il secondo giorno) e `pomeriggio.aperto` è sempre `false`.
- **Soglia di preavviso identica a `/book`.** Ogni ora che esce da qui — mattina e
  pomeriggio — è già filtrata dalla stessa soglia di un'ora di anticipo che `/book`
  applica (`classifyAt`): un'ora mostrata da `/slots` non verrà mai rifiutata da
  `/book` con `fuori_regole`. `oreAmmesse` è l'unione delle ore ammesse per quella
  data, comoda per validare lato bot prima di chiamare `/book`.

### `POST /api/bot/lancio/book`

Body: `{ "leadId": "…", "at": "2026-10-06T10:00:00+02:00", "info"?: {...}, "note"?: "…" }`.

- `at` **deve** avere l'offset di fuso esplicito (altrimenti `400 bad_request`,
  stessa regola di `/api/bot/outcome`), essere un'ora tonda italiana con almeno
  un'ora di anticipo, e cadere in una delle fasce ammesse per quella data — altrimenti
  `422 { ok:false, motivo:'fuori_regole' }`.
- `info.risposte` (se presente) deve essere un array di sole stringhe, ripulito e
  troncato a 6 elementi × 300 caratteri; `note` è una stringa fino a 1000 caratteri.
  Un tipo sbagliato è `400 { ok:false, motivo:'info_non_valida', detail }` — niente
  salvataggio parziale.
- **Una prenotazione per lead (ruling R-rebook).** Se il lead ha già una
  prenotazione del lancio (`lancioScelta` ∈ `app_mattina`/`app_pomeriggio`/
  `app_dopodomani` con `appointmentDate` valorizzato):
  - stesso istante (±60s, cioè un ritento) → `200`, deduplicato: per la mattina
    `{ ok:true, kind:'mattina', venditore:{id,nome}, deduped:true }`, per
    pomeriggio/dopodomani `{ ok:true, kind, deduped:true }` (nessun venditore);
  - istante diverso → **non si sposta nulla**: `409 { ok:false, motivo:'gia_prenotato',
    appointmentAt: '<ISO con offset italiano>', kind }`. Il bot lo dice al lead; lo
    spostamento lo fanno le Conferme, non questa rotta.
- **Mattina (9-14, 6/10):** lock per ora (nessuna doppia assegnazione sulla stessa
  ora), disponibilità riletta dentro il lock, round robin fra i venditori liberi.
  Nessun venditore libero → `409 { ok:false, motivo:'ora_esaurita', slots: <stessa
  forma di /slots> }`. Riuscita: appuntamento **già confermato** (le Conferme non
  chiamano), evento `APPOINTMENT_SET` + `LANCIO_BOOKED`, evento Google Calendar e
  webhook marketing (`appointment.set`, `appointment.outcome`, `deal.assigned`) in
  background. Risposta `{ ok:true, kind:'mattina', venditore:{id,nome} }`.
- **Pomeriggio (15-20, 6/10) e dopodomani (9-14, 7/10):** nessun venditore —
  l'appuntamento va alle Conferme come un `APPUNTAMENTO` qualunque del bot (reset
  incondizionato di un eventuale scarto/venditore residuo), notifica
  `lancio_appuntamento` alle Conferme attive, webhook `appointment.set`. Risposta
  `{ ok:true, kind:'pomeriggio'|'dopodomani' }`.
- Scrittura concorrente sullo stesso lead (versione cambiata sotto i piedi) →
  `409 { ok:false, motivo:'conflitto' }`: il bot ritenta una volta.

### `POST /api/bot/lancio/call-now`

Body: `{ "leadId": "…", "info"?: {...}, "note"?: "…" }` — nessun `at`: è "adesso",
arrotondato al minuto. Stessa validazione di `info`/`note` di `/book`.

- Ha già scelto "chiamami adesso" **e** ha un venditore assegnato → `200` deduplicato,
  `{ ok:true, venditore:{id,nome}, deduped:true }`.
- Ha già un'ALTRA prenotazione del lancio (mattina/pomeriggio/dopodomani) →
  stessa regola di `/book`: `409 { ok:false, motivo:'gia_prenotato', appointmentAt, kind }`
  — la chiamata subito non toglie il lead al venditore che ha già l'appuntamento.
- Altrimenti: lock unico sul turno SERA (round robin, senza controllo di calendario —
  chi è di turno è lì apposta), nessun venditore di turno → `409 { ok:false,
  motivo:'nessun_venditore' }` — **il bot ripiega su `/book`**. Riuscita: appuntamento
  "adesso" già confermato, contatore NR a zero (lo scala la scheda venditore),
  eventi `APPOINTMENT_SET` + `LANCIO_CALL_NOW_ASSIGNED`, notifica realtime al
  venditore, webhook marketing (`appointment.set`, `appointment.outcome`,
  `deal.assigned`). **Nessun evento Google Calendar** (è adesso, non domani).
  Risposta `{ ok:true, venditore:{id,nome} }`.
- Scrittura concorrente → `409 { ok:false, motivo:'conflitto' }`.

---

## Codici di risposta `/api/bot/outcome`

| HTTP | `error` nel body | Significato |
|---|---|---|
| `200` | — (`{ ok: true }`) | Outcome registrato correttamente |
| `400` | `invalid_json` | Body non è JSON valido (parsing fallito) |
| `200` | — (`{ ok: true, noted: true }`) | `NOTA` / `CONTATTO_UMANO` registrata. Può contenere `deduped: true` (nota riconosciuta come re-invio) o `notifySuppressed: true` (notifica già mandata nelle 24h) |
| `200` | — (`{ ok: true, returnedToPool: true, motivo }`) | **v1.7** — `NON_RISPOSTO`/`INTERROTTO` su un lead del lancio ancora al bot: torna nel pool di `/import`. `motivo` ∈ `mai_risposto` \| `silenzio_dopo_followup` \| `followup_non_inviato` (vedi [§4.6.1](#lead-del-lancio-nuovo-in-v16)) |
| `200` | — (`{ ok: true, returnedToPool: false, skipped }`) | **v1.7** — Il lead del lancio non è tornato nel pool. `skipped` ∈ `already_returned` \| `already_rejected` \| `locked_appointment` \| `scelta_fatta` \| `lead_not_found` |
| `200` | — (`{ ok: true, reassigned: <userId | null> }`) | `NON_RISPOSTO`/`INTERROTTO` su un lead **non** del lancio: riassegnato via round robin AC. `reassigned: null` con `skipped: '<motivo>'` se non c'era un GDO eleggibile |
| `200` | — (`{ ok: true, deduped: true }`) | `APPUNTAMENTO` ripetuto sullo stesso lead con la stessa data: no-op |
| `200` | — (`{ ok: true, rescheduled: true }`) | `APPUNTAMENTO` con data diversa su un lead già `APPOINTMENT`: rifissaggio, Conferme notificate |
| `400` | `bad_request` | `leadId` o `outcome` mancanti/non validi; `date` assente, non ISO 8601, o priva di offset di fuso orario per APPUNTAMENTO/RICHIAMO; `note` vuota per NOTA o CONTATTO_UMANO |
| `401` | `invalid_signature` | Firma HMAC assente o non corrispondente |
| `403` | `forbidden` | Lead non appartiene all'azienda `fenice` (`lead non Fenice`) |
| `403` | `forbidden` | `lead mai passato dal bot` — nessun `BOT_PUSHED` riuscito e nessuna agenda recapitata |
| `403` | `forbidden` | `lead non assegnato a un account bot` — esito diverso da `NOTA` / `CONTATTO_UMANO` / `APPUNTAMENTO` su un lead di un GDO umano |
| `403` | `forbidden` | `agenda recapitata dal bot ma lead mai lavorato da lui` — `APPUNTAMENTO` senza `BOT_PUSHED` |
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
