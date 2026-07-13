# Pool Lancio Black Summer — Design Spec (2026-07-13)

## Contesto

Il lancio "Black Summer 2026" ha ~2800-3000 lead in lista d'attesa su ActiveCampaign
(lista `Lead Lancio Black Summer 2026`, bloccata nel webhook Fenice via
`BLOCKED_LIST_NAMES_NORMALIZED` — i webhook subscribe vengono saltati apposta).
Da oggi (2026-07-13) i GDO devono iniziare a chiamarli.

Serve replicare il flusso usato per il lancio Video Editor (maggio 2026):
pool di lead non assegnati in `/import`, l'admin sceglie quantità e GDO destinatari,
split equo round-robin. Differenze rispetto al VE:

1. **Nessuna distinzione webinar / non-webinar** — bucket unico, tutti da lista d'attesa.
2. **I lead NON sono ancora nel CRM** — serve un passo di ingestione (pull diretto
   dall'API AC, deciso con Bruno; alternativa CSV scartata).
3. **Funnel dedicato `Black Summer`** (deciso con Bruno; il VE usava ORG).

## Architettura

### 1. Ingestione — `syncBlackSummerPool()` (server action)

File: `src/app/actions/launchPoolActions.ts` (stessa famiglia).

- Guard: `currentTenant()` + `assertSalesArea(ctx)`; consentita **solo con azienda
  attiva Fenice** (la lista vive sull'account AC Fenice, chiave `ACTIVECAMPAIGN_API_KEY`).
- Risolve l'ID lista per nome normalizzato (`lead lancio black summer 2026`) via
  `GET /lists` paginato — stessa normalizzazione (trim+lowercase) del webhook.
- Scarica i contatti con `GET /contacts?listid=<id>&status=1&limit=100&offset=N`
  (status=1 = iscritti attivi alla lista), con retry/backoff anti-429 come
  l'`acGet` del webhook. ~30 richieste per 3000 contatti; nessuna chiamata per-contatto.
- Mapping per contatto (identico al webhook Fenice):
  - `name` = `firstName + ' ' + lastName` (fallback `'Lead senza nome'`)
  - telefono: `normalizePhoneStrict` → fallback `normalizePhoneLenient`, strip
    prefisso `+39`, `phoneSuspicious = !isPlausiblePhone(strict)`
  - `email`, `acContactId`, `source='activecampaign'`, `funnel='Black Summer'`,
    `launchBucket='BLACK_SUMMER'`, `assignedToId=NULL`, `status='NEW'`,
    `companyId=ctx.companyId`
  - UTM/provenienza: non necessari (lista d'attesa) — omessi.
- **Idempotente**: prima del insert carica gli `acContactId` già presenti per la
  company e salta i duplicati. Ri-cliccabile nei giorni successivi per importare
  i nuovi iscritti. Contatti senza telefono utilizzabile: saltati e contati.
- Insert in batch (chunk ~500). **Nessun evento per-lead alla creazione** (lezione
  Disk IO giugno); gli eventi `ASSIGNED` restano al momento della distribuzione.
- Post-import: marca `resolved` le righe `acIntakeFailures` con reason
  `blocked_list:%` i cui `acContactId` sono stati importati (spariscono dal tab
  "Bloccati" di /lead-automatici).
- Report ritornato: `{ imported, skippedExisting, skippedNoPhone, totalOnList, errors[] }`.
- La lista resta bloccata nel webhook: i nuovi iscritti si accumulano su AC e
  entrano solo via sync.

### 2. Distribuzione — generalizzazione `launchPoolActions`

- `getLaunchPoolStatus()` → include conteggio bucket `BLACK_SUMMER`
  (`blackSummerAvailable`), senza rompere i campi esistenti.
- `assignFromLaunchPool()` → accetta anche `blackSummerCount` e pesca dal bucket
  `BLACK_SUMMER` con la stessa transazione `FOR UPDATE SKIP LOCKED`, FIFO su
  `createdAt`, split equo `previewLeadDistribution`. Metadata evento:
  `{ source: 'launch_pool', bucket: 'BLACK_SUMMER' }`.
- `leads.launchBucket` è `text` libero → **nessuna migrazione DB**.

### 3. UI — `BlackSummerPoolCard` in `/import`

File: `src/components/BlackSummerPoolCard.tsx`, montata in `ImportClient.tsx`
sotto la `LaunchPoolCard` (che resta invariata e continua a nascondersi se vuota).

- Visibile anche a pool vuoto (serve per il primo sync). Nascosta se l'azienda
  attiva non è Fenice.
- Sezione sync: bottone "Sincronizza da ActiveCampaign" + report
  (importati / già presenti / senza telefono / totale lista).
- Sezione distribuzione: contatore "disponibili", un solo input quantità,
  selettore GDO con Tutti/Nessuno (riusa `getActiveGdosForImport`), anteprima
  split, conferma sopra i 100 lead, report per-GDO — pattern identico alla card VE.
- Stile: card arancione/ambra (distinta dal viola VE), Tailwind ordinato,
  bottoni mai figli di tag testuali (regola WSOD).

### 4. Pipeline GDO

Nessuna modifica: i lead assegnati entrano nella board tentativo-0 come lead
normali (tiebreaker sort per `id` già in produzione).

## Error handling

- Lista non trovata su AC → errore esplicito nel report, nessun insert.
- 429/5xx AC → retry con backoff; dopo N tentativi la pagina fallisce e il sync
  si ferma riportando quanto importato fino a quel punto (ri-cliccare riprende
  grazie all'idempotenza).
- Chiave AC mancante → errore esplicito.

## Testing / verifica

- `npm run build` pulito.
- Verifica end-to-end in prod (dopo deploy): sync reale della lista, controllo
  conteggi vs AC, distribuzione di un piccolo batch di prova e verifica board GDO.

## Fuori scope

- Framework generico multi-lancio (tabella `launches`).
- Sblocco della lista nel webhook.
- UTM/provenienza per i lead della lista d'attesa.
