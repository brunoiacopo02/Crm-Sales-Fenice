# Pool Database mensili da ActiveCampaign — Design

**Data**: 2026-07-20
**Stato**: Approvato dal PO (design verbale in sessione)
**Pattern di riferimento**: Pool Black Summer (spec 2026-07-13, `launchPoolActions.ts`)

## Obiettivo

Il TL deve poter caricare su /import dei pool di lead "Database" pescandoli
direttamente da ActiveCampaign, divisi per **mese di creazione del contatto AC**
(si parte con **settembre 2025** e **aprile 2026**), escludendo i **già clienti**
(identificati da tag/liste AC). I lead importati hanno provenienza canonica
`funnel = 'Database'`. Ogni pool ha una mini tabella performance (stile Monitor
Lancio BS) per confrontare la resa dei mesi. Quando un pool è esaurito (tutti
assegnati) il TL può rimuoverlo e caricare un altro mese.

## Decisioni PO (2026-07-20)

1. **Già clienti**: esplorazione AC (tag + liste) → proposta → conferma PO.
   La config è per NOME normalizzato (tag e liste), risolta a ID a runtime.
2. **Dedup verso il CRM: NO** — un contatto già presente nel CRM da altri
   funnel (o da vecchi import database) va importato comunque, come per BS.
   Dedup SOLO dentro al bucket (acContactId + telefono) per idempotenza re-sync.
3. **Selettore mese generico** — il TL sceglie mese/anno qualsiasi; si parte
   caricando set 2025 e apr 2026.
4. **Rimozione pool**: pulsante attivo SOLO con 0 lead disponibili (tutto
   assegnato). Non cancella lead: archivia il pool (sparisce la card).
   Lo stesso pulsante va aggiunto alla card Black Summer.

## Architettura

### 1. Schema: nuova tabella `launchPools` (migrazione `0023_launch_pools.sql`)

| Colonna | Tipo | Note |
|---|---|---|
| `id` | text PK | uuid |
| `companyId` | text NOT NULL | tenant (`fenice`) |
| `bucket` | text NOT NULL | es. `DB_2025_09`; UNIQUE (companyId, bucket) |
| `kind` | text NOT NULL | `DATABASE_MONTH` \| `LAUNCH` |
| `label` | text NOT NULL | es. "Database Settembre 2025" |
| `monthKey` | text | `2025-09`; null per i lanci |
| `createdAt` / `createdBy` | timestamptz / text | |
| `archivedAt` / `archivedBy` | timestamptz nullable / text | archiviato = card nascosta |

Backfill nella migrazione: riga `BLACK_SUMMER` (kind `LAUNCH`, company fenice)
così la card BS acquisisce il pulsante di rimozione. I bucket VE legacy
(`WEBINAR`/`NO_WEBINAR`) restano fuori dal registro (card `LaunchPoolCard`
invariata).

Le migrazioni si applicano A MANO via `mcp__supabase__apply_migration`
(drizzle-kit generate inutilizzabile — lezione admin-review luglio).

### 2. Server actions (`src/app/actions/databasePoolActions.ts`)

Tutte: `currentTenant()` + `assertSalesArea` + **solo company `fenice`** +
ruolo ADMIN/MANAGER/TL (stesso perimetro della pagina /import).

- **`syncDatabaseMonthPool(monthKey: string)`**
  1. Valida `monthKey` (`YYYY-MM`), calcola range [1° del mese, 1° del mese dopo).
  2. Risolve gli ID dei tag/liste "già clienti" dai nomi in
     `CLIENT_TAG_NAMES_NORMALIZED` / `CLIENT_LIST_NAMES_NORMALIZED`
     (costanti nel codice, come `BLOCKED_LIST_NAMES_NORMALIZED` del webhook).
  3. Scarica UNA VOLTA i membri di quei tag/liste (paginato) → `Set<contactId>`
     di esclusione. (Niente lookup per-contatto: 6300 contatti × 1 call sarebbero
     20+ minuti a 5 req/s.)
  4. Scarica i contatti del mese: `GET /contacts?filters[created_after]=...&
     filters[created_before]=...&limit=100&offset=...` con backoff anti-429
     (riuso `acGet`), hard-cap 20.000.
  5. Filtra: senza telefono → skip (contati); nel Set clienti → skip (contati);
     già nel bucket per acContactId o telefono → skip (idempotenza).
  6. Insert a chunk da 500: `funnel: 'Database'`, `source: 'activecampaign'`,
     `acContactId`, `launchBucket: 'DB_YYYY_MM'`, `status: 'NEW'`,
     `assignedToId: null`, `companyId: 'fenice'`. Re-check pre-insert anti
     doppio-sync (stesso pattern BS).
  7. Upsert riga `launchPools` (se archiviata e ri-sincronizzata: de-archivia).
  8. Report: `{ imported, skippedClienti, skippedExisting, skippedNoPhone,
     totalMonth, errors[] }`.
- **`getDatabasePools()`** → pool `DATABASE_MONTH` non archiviati con conteggio
  disponibili (unassigned) ciascuno.
- **`assignFromDatabasePool({ bucket, count, gdoIds })`** → valida che il bucket
  sia un pool `DATABASE_MONTH` attivo, poi riusa `pickAndAssignBuckets`
  (FIFO + FOR UPDATE SKIP LOCKED + eventi ASSIGNED a chunk).
- **`archiveLaunchPool(bucket)`** → guardia server: rifiuta se esistono lead
  del bucket con `assignedToId IS NULL`. Setta `archivedAt/By`. Vale sia per
  i pool database sia per `BLACK_SUMMER`.
- **`getDatabasePoolStats()`** → per TUTTI i pool `DATABASE_MONTH` (anche
  archiviati, servono al confronto storico): una riga per pool con
  `{ totale, assegnati, disponibili, chiamati, fissati, confermati, chiusi,
  fatturatoEur, archived }`. Scope = `launchBucket = bucket` (company fenice) —
  NON per funnel, per non contare i ~17k lead database storici. Definizioni
  identiche a `blackSummerStats` (canon: fissati = `appointmentCreatedAt`,
  confermati = `confirmationsOutcome='confermato'`, chiusi =
  `salespersonOutcome='Chiuso'`, fatturato = somma `closeAmountEur`).

`pickAndAssignBuckets` va esportato da `launchPoolActions.ts` (oggi è privato)
o estratto in un modulo condiviso `src/lib/launchPoolShared.ts` — NON duplicato.
Nota: i file `actions/` sono "use server", ogni export diventa endpoint —
l'helper condiviso NON deve essere esportato da un file "use server";
estrazione in lib è la via sicura.

### 3. UI su /import

**Sezione nuova "Pool Database (ActiveCampaign)"** (`DatabasePoolSection.tsx`,
client component, montato in `ImportClient` sotto la card BS):

- Header con selettore **mese/anno** + bottone "Sincronizza da AC".
  Conferma (`confirm()`) prima del sync con mese esplicitato. Durante il sync:
  spinner + disabilita tutto (il sync può durare minuti — `maxDuration = 300`
  già settato sulla pagina; il sync gira come server action della stessa route).
- **Mini tabella comparativa** (una riga per pool, anche archiviati con badge
  "Rimosso"): Mese | Totale | Assegnati | Disponibili | Chiamati | Fissati |
  Confermati | Chiusi | Fatturato. Stile compatto tabella BS/manager
  (overflow-x-auto su mobile).
- **Una card per pool attivo** (riuso layout `BlackSummerPoolCard`, tema blu
  — il colore "Database" già usato in manager-targets): disponibili, input
  quantità, checkbox GDO attivi, preview equa, "Esegui Assegnazione", report
  per-GDO.
- **Pulsante "Rimuovi pool"**: visibile sulla card, `disabled` finché
  `disponibili > 0` (tooltip "Assegna tutti i lead per poter rimuovere il
  pool"), `confirm()` alla pressione. Dopo: card sparisce, riga resta nella
  tabella comparativa col badge.

**Card Black Summer**: aggiungere lo stesso pulsante "Rimuovi pool"
(`archiveLaunchPool('BLACK_SUMMER')`), attivo solo a 0 disponibili; la card
si nasconde se la riga `launchPools` di BLACK_SUMMER è archiviata.

### 4. Esclusione "già clienti" — config

Costanti in `databasePoolActions.ts` (default nel codice, NON env — stessa
scelta di `BLOCKED_LIST_NAMES_NORMALIZED`):

```ts
const CLIENT_TAG_NAMES_NORMALIZED: string[] = [/* da esplorazione AC */]
const CLIENT_LIST_NAMES_NORMALIZED: string[] = [/* da esplorazione AC */]
```

Flusso di finalizzazione (bloccato dalla chiave API, da fare appena
`ACTIVECAMPAIGN_API_KEY` è nel `.env` locale o fornita dal PO):
1. `GET /tags` + `GET /lists` → elenco completo con conteggi.
2. Proposta al PO dei candidati "cliente" (tag tipo "Cliente", liste
   studenti/corsi acquistati).
3. Validazione: contatti creati set 2025 esclusi i clienti ≈ **6.300**
   (numero atteso dal PO).
4. Hardcode dei nomi confermati nelle due costanti.

Finché le costanti sono vuote il sync NON esclude nessuno: il deploy della
feature senza config clienti è quindi funzionante ma va completato con la
conferma PO prima dell'uso reale.

### 5. Non-scope / invarianti

- Nessuna modifica al webhook AC intake (i lead database entrano SOLO dal sync).
- Nessuna modifica ai flow GDO/Conferme/Venditori: i lead del pool sono lead
  normali con funnel Database (sondaggi già esclusi per funnel database,
  team goal "database" li conta già — tutto automatico via funnel).
- Serenamente non vede nulla (gate company fenice).
- I lead assegnati NON si toccano mai: né dal re-sync né dall'archiviazione.

## Error handling

- Chiave AC mancante → errore esplicito nel report.
- Fallimento a metà download → insert di quanto raccolto + errore nel report,
  re-click riprende (idempotente) — pattern BS.
- Tag/lista clienti non trovata per nome → errore bloccante nel report
  (meglio fermarsi che importare clienti).
- Doppio sync concorrente → re-check pre-insert (pattern BS).
- Archiviazione con disponibili > 0 → rifiutata server-side (non solo UI).

## Testing

- `npx tsc --noEmit` + build pulita.
- Verifica SQL post-migrazione (tabella + backfill BS).
- QA in prod (la chiave AC vive solo su Vercel): sync set 2025 → conteggio
  atteso ~6.300, spot-check esclusione clienti, assegnazione a un GDO di
  test, tabella stats coerente, pulsante Rimuovi disabilitato con
  disponibili > 0.
