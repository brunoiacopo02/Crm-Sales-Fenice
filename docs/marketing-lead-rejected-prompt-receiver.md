# Prompt da consegnare all'IA che lavora sul CRM marketing

Questo file è il **work order autosufficiente** da incollare a Claude (o altra IA) che
ha accesso al repo del CRM marketing. Non richiede il brief né altro contesto: tutto
quello che serve è qui dentro.

La spec canonica lato Fenice resta `docs/marketing-lead-rejected-brief.md`. Se
correggete quella, ricontrollate anche questa: sono due documenti che devono restare
allineati.

---

## ⬇️ DA QUI IN GIÙ È IL PROMPT — copia tutto

Sei incaricato di aggiornare il **receiver dei webhook del CRM marketing**: l'endpoint
`POST /marketing/api/webhooks/crm-fenice` che riceve gli eventi dal CRM Fenice (il CRM
sales, un altro sistema, gestito da un altro team). Nel repo del CRM marketing il
gestore sta in `src/app/api/webhooks/crm-fenice/route.ts` — se il percorso non
corrisponde, cercalo dal nome dell'header `X-CRM-Event-Id` o dalla env var
`WEBHOOK_SECRET_CRM`.

Il CRM Fenice ha finito di sviluppare un **settimo tipo di evento**, `lead.rejected`,
già testato e pronto al deploy. **Non lo accenderanno finché il receiver non lo
accetta.** Il tuo compito è mettere il receiver in condizione di riceverlo e
persisterlo, e poi riferire l'esito.

Lavora sul repo reale. Non inventare campi né endpoint: tutto il contratto è qui sotto
ed è preso dal codice sorgente del sender, non da memoria.

### 1. Cosa NON cambia

Trasporto, autenticazione e formato dell'inviluppo sono **identici** ai sei eventi che
il receiver già gestisce. Stesso URL, stesso secret, stessi header.

- **Metodo:** `POST`, `Content-Type: application/json`
- **User-Agent:** `CrmFenice-Webhooks/1.0`
- **Header `X-CRM-Event-Type`:** `lead.rejected`
- **Header `X-CRM-Event-Id`:** UUID deterministico, chiave di deduplica
- **Header `X-CRM-Signature`:** `sha256=<hex>` dove `<hex>` è
  `HMAC-SHA256(secret, rawBody)` calcolato sul **body grezzo**, **senza** prefisso
  timestamp. Il secret è quello già in uso, nella env `WEBHOOK_SECRET_CRM`.
- **Timeout:** il sender abbandona la richiesta dopo **10 secondi**.

Il blocco `lead` dell'inviluppo è **identico** a quello degli altri sei eventi: stessa
anagrafica, stessi UTM. Se esiste già un modello/tabella per quel blocco, riusalo senza
modifiche. Cambia **solo** il contenuto di `data`.

### 2. ⚠️ La regola più importante: mai rispondere 4xx

Nell'outbox del sender un **4xx non viene mai ritentato**. Al primo tentativo la
consegna passa a `failed_permanent` e l'evento si ferma lì per sempre. La scala di
retry (1m → 5m → 30m → 2h → 6h → dead-letter) vale **solo** per **5xx, timeout e 429**.

Conseguenze operative, da rispettare nel codice che scrivi:

- **Un `eventType` sconosciuto non deve mai produrre un 4xx.** Rispondi 2xx e logga.
- **Un `reasonCode` sconosciuto non deve mai produrre un 4xx.** Vedi §5.
- **Un campo mancante o inatteso dentro `data` non deve mai produrre un 4xx.** Persisti
  quello che c'è, logga il resto.
- Se hai un errore tuo (DB giù, bug) e vuoi che l'evento ti venga **rimandato**,
  rispondi **500**. Quello sì che viene ritentato.
- Rispondi 2xx **appena hai persistito o accodato**, senza aspettare elaborazioni
  lunghe: oltre i 10 secondi scatta il timeout e ti riarriva lo stesso evento.
- Il 4xx resta corretto solo per la **firma non valida**: lì è giusto rifiutare in modo
  definitivo.

Se oggi il receiver ha uno `switch` sull'`eventType` con un `default` che risponde 400 o
422, **quello è il primo bug da chiudere**, indipendentemente dal resto del lavoro.

### 3. Il payload

```json
{
  "eventId": "3f2a91c4-8b7e-4d1a-9f03-6c2e8a4b1d55",
  "eventType": "lead.rejected",
  "occurredAt": "2026-08-24T13:12:00.000Z",
  "apiVersion": "1",
  "lead": {
    "id": "7dc11a19-5776-458e-ab57-6a65380611a7",
    "name": "Mario Rossi",
    "email": "mario.rossi@example.com",
    "phone": "+393331234567",
    "funnel": "Black Summer",
    "source": "activecampaign",
    "createdAt": "2026-08-20T09:14:00.000Z",
    "utm": {
      "source": "facebook",
      "medium": "cpc",
      "campaign": "bs-agosto-freddo",
      "content": "video-3",
      "term": null
    }
  },
  "data": {
    "stage": "GDO",
    "automatic": false,
    "reasonCode": "NO_BUDGET",
    "reasonLabel": "Non ha soldi",
    "rawReason": "non ha soldi",
    "callCount": 2,
    "byBot": false,
    "rejectedAt": "2026-08-24T13:12:00.000Z",
    "rejectedBy": {
      "userId": "a3b7d9da-94b7-4c48-983f-ee42e949c4e5",
      "displayName": "GDO 106",
      "role": "GDO"
    }
  }
}
```

Tipi esatti del blocco `data` (dal sorgente del sender):

```ts
type RejectionStage = 'GDO' | 'CONFERME';

interface LeadRejectedData {
  stage: RejectionStage;
  automatic: boolean;
  reasonCode: DiscardReasonCode;   // vedi §5, lista NON chiusa
  reasonLabel: string;             // può essere stringa VUOTA, mai null
  rawReason: string | null;
  callCount: number;
  byBot: boolean;
  rejectedAt: string;              // ISO 8601 UTC
  rejectedBy: {
    userId: string;
    displayName: string | null;    // può essere null
    role: string;
  } | null;                        // l'oggetto INTERO può essere null
}
```

### 4. Significato dei campi, e le trappole

| Campo | Significato e cosa NON dare per scontato |
|---|---|
| `stage` | Dove è morto il lead. `GDO` = non ha mai voluto l'appuntamento. `CONFERME` = l'appuntamento era fissato ed è saltato prima di svolgersi. **Vedi §6 sul doppio conteggio, riguarda solo `CONFERME`.** |
| `automatic` | `true` **solo** per lo scarto automatico dopo il 3° (o, sul recupero GDO, 4°) tentativo a vuoto. **Questo è l'unico campo da usare per distinguere sistema da umano.** |
| `reasonCode` | Codice stabile. **Raggruppa sempre su questo.** Lista non chiusa, vedi §5. |
| `reasonLabel` | Etichetta italiana per le UI. **Non raggrupparci mai sopra**, è testo che cambia. Attenzione: è `""` (stringa vuota, non `null`) quando la causale a monte è vuota. |
| `rawReason` | La stringa esatta a database. Serve per audit e per recuperare il senso quando `reasonCode` è `OTHER`. **Persistila sempre**, anche quando il codice è mappato. |
| `callCount` | Chiamate **GDO** ricevute dal lead. **Non** conta i tentativi delle Conferme. Su uno scarto `stage: "CONFERME"` può quindi essere basso o `0` e **non** dice quanti tentativi ha fatto l'operatore Conferme. Non usarlo come "sforzo totale sul lead". |
| `byBot` | `true` se a scartare è stato un bot di messaggistica invece di un operatore al telefono. Vedi §7. |
| `rejectedAt` | Istante dello scarto, ISO 8601 UTC. Coincide con `occurredAt`. |
| `rejectedBy` | L'operatore la cui azione ha innescato lo scarto. **Attenzione: è valorizzato anche quando `automatic` è `true`** — è il GDO che stava chiamando quando è scattato il limite di tentativi. È `null` solo se non c'è nessun attore (raro). **Non dedurre l'automatismo da `rejectedBy === null`: usa `automatic`.** |

### 5. I codici causale

| `reasonCode` | Etichetta tipica | Emesso in fase |
|---|---|---|
| `NO_BUDGET` | Non ha soldi | GDO, Conferme |
| `NOT_INTERESTED` | Non interessato | GDO, Conferme |
| `UNEMPLOYED` | Disoccupato | GDO, Conferme |
| `FOREIGN` | Straniero | GDO, Conferme |
| `INFO_ONLY` | Solo informazioni | GDO, Conferme |
| `REFUSED_APPOINTMENT` | Non vuole prendere l'appuntamento | GDO, Conferme |
| `INVALID_NUMBER` | Numero inesistente | GDO, Conferme |
| `NO_DECISION_POWER` | Non ha potere decisionale | GDO, Conferme |
| `UNREACHABLE` | Irreperibile (3 o 4 tentativi vuoti) / 3 NR consecutivi | automatico |
| `NO_ANSWER` | Non risponde | Conferme |
| `POSTPONED_NO_DATE` | Posticipa senza data | Conferme |
| `HUNG_UP` | Attaccato in faccia | Conferme |
| `OTHER` | *(varia, leggi `rawReason`)* | fallback |

**`OTHER` è un valore atteso, non un errore.** Significa che l'operatore ha usato una
causale non ancora mappata dal sender; `rawReason` porta il testo integro.

**La lista non è chiusa:** il sender aggiungerà codici nel tempo. Il tuo schema di
persistenza deve accettare una stringa qualsiasi. Se modelli questo campo come enum
stretto a livello di DB o di validazione, si romperà al primo codice nuovo — e si
romperà rispondendo 4xx, cioè perdendo eventi per sempre (§2). **Usa una colonna
testuale**, e semmai fai la validazione solo a livello di reportistica.

⚠️ **Su `byBot: true` aspettati `OTHER` come maggioranza, non come eccezione.** Dato
misurato in produzione sugli ultimi 90 giorni: gli scarti degli operatori umani sono
mappati al 100% (17.806 su 17.806), quelli del bot solo al 24% (260 su 1.074). Il
fornitore del bot manda frasi libere invece di causali da lista — cose come *"lead ha
risposto NO esplicitamente, non interessato"* — che il mapper del sender non riconosce.
Il dato non è perso (`rawReason` è integro), è solo non categorizzato. È un problema a
monte, lato fornitore del bot, e non si risolverà a breve. **Non costruire dashboard che
presumono `OTHER` residuale su quel sottoinsieme.**

### 6. ⚠️ Doppio conteggio degli scarti Conferme

Gli scarti con `stage: "CONFERME"` arrivano al receiver **anche** dentro l'evento
`appointment.outcome` che già ricevete, che porta un proprio campo `discardReason`.

Il sender mantiene `appointment.outcome` invariato per retrocompatibilità: resta
l'evento del ciclo di vita dell'appuntamento.

**Conseguenza: conta gli scarti SOLO da `lead.rejected`.** Se sommi le due fonti, i
numeri delle Conferme raddoppiano. **Verifica se esistono già report o query che
contano gli scarti da `appointment.outcome`: se ci sono, vanno migrati o esclusi**, ed è
parte del lavoro, non un dettaglio da rimandare.

### 7. `byBot` e `automatic`: due cose diverse, entrambe da rendere filtrabili

- `automatic: true` è **irreperibilità**, non un giudizio sulla qualità del lead: il
  numero può essere ottimo e la persona semplicemente non ha risposto. Quando si misura
  la qualità di una campagna va tenuto **separato** dagli scarti qualitativi,
  altrimenti una campagna che gira in orari sbagliati sembra una campagna che porta
  lead scadenti. Esponilo come categoria a sé nei report, non nel calderone.
- `byBot: true` sono lead reali con causali valide, ma il bot ha un tasso di scarto
  strutturalmente diverso da quello umano: mescolarli sposta le medie. Rendilo
  **filtrabile**, non nasconderlo.

### 8. Annullamento di uno scarto: non arriva nessun evento

Un lead scartato può essere riaperto internamente nel CRM Fenice e tornare in lavoro.
**Questo annullamento non genera alcun evento verso il receiver.** Non esiste un
`lead.rejected` con segno opposto né altro segnale di rettifica. L'unico evento che
resta è lo scarto originale.

Sono numeri piccoli, ma se costruisci logiche che presumono "uno scarto è definitivo"
troverai un disallineamento su quei lead. **È per design, non è un bug da segnalare.**

### 9. Verifica della firma: vettore di test

Puoi testare la tua funzione di verifica HMAC senza conoscere il secret di produzione.
Con secret `test-secret-non-usare-in-prod` e questo body **esatto** (751 byte, una sola
riga, nessuno spazio dopo i due punti):

```
{"eventId":"3f2a91c4-8b7e-4d1a-9f03-6c2e8a4b1d55","eventType":"lead.rejected","occurredAt":"2026-08-24T13:12:00.000Z","apiVersion":"1","lead":{"id":"7dc11a19-5776-458e-ab57-6a65380611a7","name":"Mario Rossi","email":"mario.rossi@example.com","phone":"+393331234567","funnel":"Black Summer","source":"activecampaign","createdAt":"2026-08-20T09:14:00.000Z","utm":{"source":"facebook","medium":"cpc","campaign":"bs-agosto-freddo","content":"video-3","term":null}},"data":{"stage":"GDO","automatic":false,"reasonCode":"NO_BUDGET","reasonLabel":"Non ha soldi","rawReason":"non ha soldi","callCount":2,"byBot":false,"rejectedAt":"2026-08-24T13:12:00.000Z","rejectedBy":{"userId":"a3b7d9da-94b7-4c48-983f-ee42e949c4e5","displayName":"GDO 106","role":"GDO"}}}
```

la firma attesa è:

```
sha256=7000150fb4278a977dafa1f881a0b8bb7dca7ae1784a3f4ef64d188a23acbf62
```

**Firma sempre sul body grezzo ricevuto**, mai su un oggetto ri-serializzato: un
`JSON.parse` seguito da `JSON.stringify` può cambiare ordine delle chiavi o escaping e
farti fallire la verifica su payload perfettamente validi. Se il framework consuma il
body prima che tu possa leggerlo raw, risolvi quello per primo. Usa un confronto
timing-safe.

### 10. Cosa devi consegnare

Il receiver è pronto quando tutti questi punti passano. Verificali davvero, con test o
con richieste reali: non limitarti a leggere il codice.

1. Accetta `eventType: "lead.rejected"` e risponde **2xx**
2. Verifica la firma HMAC come già fa per gli altri sei eventi, sul body grezzo
3. Deduplica su `X-CRM-Event-Id` (stessa logica di idempotenza già esistente)
4. Persiste **tutti** i campi di `data`, `rawReason` compreso
5. Non fallisce su un `reasonCode` sconosciuto, `OTHER` incluso — e la colonna è
   testuale, non un enum stretto
6. Non fallisce se `rejectedBy` è `null`, né se `displayName` è `null`, né se
   `reasonLabel` è stringa vuota
7. Non conteggia due volte gli scarti Conferme (§6): i report esistenti che contano da
   `appointment.outcome` sono stati migrati o esclusi
8. Nessun percorso del gestore risponde 4xx a un input inatteso che non sia una firma
   invalida (§2)

### 11. Cosa NON fare

- **Non** modificare la logica dei sei eventi esistenti al di fuori di quanto serve per
  i punti 7 e 8.
- **Non** cambiare il formato della firma né lo schema degli header: il sender è già in
  produzione con altri eventi e non cambia.
- **Non** implementare un endpoint di test nuovo: la prova si fa sull'endpoint vero
  (vedi §12).
- **Non** rifiutare eventi con campi in più: il sender potrà aggiungerne.

### 12. Come si fa la prova insieme

Quando hai finito, la sequenza concordata è questa:

1. Voi indicate **un URL** su cui puntare — il receiver vero o una sua copia di staging
   — e confermate con quale secret sta a sentire. Nota: lato Fenice esiste **una sola**
   env var per l'URL e **una sola** per il secret, condivise da tutti e sette gli
   eventi: non possono mandare in parallelo su due destinazioni. Se avete un path di
   test dedicato e volete usare quello, va detto esplicitamente perché richiede di
   ripuntare la loro configurazione.
2. Loro ripuntano la env var su quell'URL (non serve un deploy di codice).
3. Loro sparano **un evento reale a comando** da un tool di debug interno: arriva
   firmato esattamente come in produzione, così verificate parsing, firma e
   persistenza senza aspettare uno scarto vero.
4. Voi confermate che è arrivato e salvato correttamente.
5. Loro ripuntano l'URL sulla produzione e accendono il traffico reale.

**Volumi attesi**, per dimensionare: qualche centinaio di eventi al giorno nei picchi,
concentrati nella fascia 13:30–20:00 ora italiana. Sono parecchi più numerosi degli
`appointment.set`, perché gli scarti sono la maggioranza degli esiti del funnel.
**Nessun burst iniziale: non verrà inviato storico**, gli eventi partono dal go-live in
avanti.

### 13. Cosa riferire alla fine

Rispondi con:

- **Esito punto per punto** della checklist §10 (1-8), con come hai verificato ciascuno
- **File modificati** e cosa fa ciascuna modifica
- Se al punto 7 hai trovato report che contavano gli scarti da `appointment.outcome`:
  **quali erano e cosa hai fatto**
- **L'URL** da usare per la prova e con quale secret sta a sentire (serve al passo 1 del
  §12)
- Qualunque punto del contratto qui sopra che **non torna** con quello che vedi nel
  codice reale del receiver: meglio segnalarlo prima dell'accensione che scoprirlo con
  gli eventi in volo
