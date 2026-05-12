# Pool Lancio Videoeditor — Design

**Date**: 2026-05-12
**Owner**: Bruno
**Status**: Draft → awaiting user review

## Contesto

Lancio del prodotto videoediting con ~5.700 lead totali da assegnare gradualmente ai GDO nel tempo. I lead sono in due categorie distinte:

- **Webinar visto** (~1.473 lead): hanno partecipato al webinar Zoom.
- **Webinar non visto** (~4.255 lead): non hanno partecipato.

Entrambe le categorie hanno provenienza commerciale `ORG` (organico). Il manager deve poter pescare dal pool nel tempo, scegliendo quanti lead di ciascuna categoria assegnare e a quali GDO (round-robin equo tra i selezionati). I lead non pescati restano nel pool fino a esaurimento.

## Decisioni di scoping

| Decisione | Scelta |
|---|---|
| Ciclo di vita | Pool persistente — pi&ugrave; round di assegnazione nel tempo |
| Logica di pesca | Quantit&agrave; per bucket + lista GDO selezionati (split equo round-robin) |
| Caricamento iniziale | Seed via SQL diretto da Claude (no UI di upload) |
| Distinzione bucket in DB | Nuova colonna `launchBucket` su `leads` |
| Provenienza | `funnel='ORG'` per tutti |
| Duplicati | Ammessi (`allowDuplicates`-equivalente) |
| Collocazione UI | Card dedicata in `/import` sotto `LeadRedistributionCard` |

## Modello dati

### Schema change

Aggiunta singola colonna a `leads`:

```ts
// src/db/schema.ts
launchBucket: text('launch_bucket'), // 'WEBINAR' | 'NO_WEBINAR' | null
```

- `null` → lead normale (default per tutti i lead esistenti).
- `'WEBINAR'` → lead webinar visto.
- `'NO_WEBINAR'` → lead webinar non visto.

Il valore resta sul lead anche dopo l'assegnazione, per analytics future (tasso di chiusura webinar vs no-webinar).

### Definizione di "lead nel pool"

```sql
launch_bucket IS NOT NULL AND assigned_to_id IS NULL
```

Quando il manager assegna, il lead riceve `assignedToId` e **esce** dal pool — ma `launchBucket` rimane valorizzato.

### Migration

Nuovo file `drizzle/0002_add_launch_bucket_to_leads.sql`:

```sql
ALTER TABLE leads ADD COLUMN launch_bucket text;
CREATE INDEX leads_launch_bucket_pool_idx
  ON leads (launch_bucket)
  WHERE launch_bucket IS NOT NULL AND assigned_to_id IS NULL;
```

L'indice parziale rende veloce il count del pool (la query principale eseguita ogni volta che la card si apre).

## Seed iniziale

Eseguito una sola volta via SQL su Supabase (come fatto per i webinar self-booked):

- **Webinar visto** — 1.473 INSERT da `lead_zoom_con_telefono.xlsx`:
  - `funnel='ORG'`, `status='NEW'`, `launchBucket='WEBINAR'`, `assignedToId=NULL`, `callCount=0`, `isSelfBooked=false`
  - Mapping colonne: Nome → name, Email → email, Telefono → phone
- **Webinar non visto** — 4.255 INSERT da `lead_da_chiamare_dopo.xlsx`:
  - identico ma `launchBucket='NO_WEBINAR'`

Per ogni lead, evento `IMPORTED` con metadata `{ source: 'launch_pool_seed', bucket: 'WEBINAR'|'NO_WEBINAR' }`.

Nessuna deduplica: tutti i lead vengono inseriti anche se telefono/email esiste gi&agrave; nel CRM.

## Server actions — `src/app/actions/launchPoolActions.ts`

### `getLaunchPoolStatus()`

```ts
async function getLaunchPoolStatus(): Promise<{
  webinarAvailable: number
  noWebinarAvailable: number
}>
```

- Restituisce i count di lead nel pool per ciascun bucket.
- Query: `SELECT launch_bucket, COUNT(*) FROM leads WHERE launch_bucket IS NOT NULL AND assigned_to_id IS NULL GROUP BY launch_bucket`.

### `assignFromLaunchPool(input)`

```ts
async function assignFromLaunchPool(input: {
  webinarCount: number
  noWebinarCount: number
  gdoIds: string[]
}): Promise<{
  ok: boolean
  assigned: Record<string, { webinar: number; noWebinar: number }>
  errors: string[]
}>
```

Comportamento:

1. **Validazioni**:
   - `gdoIds.length >= 1` altrimenti errore.
   - `webinarCount + noWebinarCount >= 1` altrimenti errore.
   - Verifica che ogni GDO in `gdoIds` esista e sia `role='GDO' AND isActive=true`.
   - Per ciascun bucket richiesto, controlla che la quantit&agrave; richiesta non superi la disponibilit&agrave; corrente.

2. **Pesca atomica per bucket** dentro `db.transaction(...)`:
   - `SELECT id FROM leads WHERE launch_bucket='WEBINAR' AND assigned_to_id IS NULL ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED`
   - Idem per `NO_WEBINAR`.
   - `FOR UPDATE SKIP LOCKED` previene race condition se due manager pescano insieme.

3. **Split round-robin equo** sui GDO selezionati:
   - Riuso `previewLeadDistribution(N, selectedGdos, 'equal', {})` per ottenere il piano di split.
   - I lead webinar e i lead no-webinar vengono splittati **indipendentemente** (cos&igrave; se chiedi 6 webinar + 6 no-webinar su 3 GDO, ognuno riceve 2+2).

4. **Update batch**:
   - Per ogni lead pescato, `UPDATE leads SET assignedToId=<gdo>, updatedAt=now()`.
   - Per ogni lead, evento `ASSIGNED` con `metadata={ source:'launch_pool', bucket }`.

5. **Cache invalidation**: `revalidatePath('/', 'layout')`.

6. **Ritorno**: report con dettaglio per GDO (quanti webinar, quanti no-webinar).

## UI — `src/components/LaunchPoolCard.tsx`

Componente client integrato in `src/app/(dashboard)/import/page.tsx` sotto `<LeadRedistributionCard />`.

### Stato

```ts
const [status, setStatus] = useState<{ webinarAvailable, noWebinarAvailable } | null>(null)
const [activeGdos, setActiveGdos] = useState<GdoInfo[]>([])
const [webinarN, setWebinarN] = useState(0)
const [noWebinarN, setNoWebinarN] = useState(0)
const [selectedGdoIds, setSelectedGdoIds] = useState<Set<string>>(new Set())
const [loading, setLoading] = useState(false)
const [report, setReport] = useState<AssignReport | null>(null)
```

### Layout

```
+--------------------------------------------------------------+
| 🚀 Pool Lancio Videoeditor                                    |
| Distribuisci gradualmente i lead del lancio ai tuoi GDO       |
+--------------------------------------------------------------+
| [Webinar Visto: 1.473 disp.]  [Webinar NON Visto: 4.255 disp.]|
+--------------------------------------------------------------+
| Quanti pescare:                                               |
|   Webinar visto  [  20 ]                                      |
|   No webinar     [  30 ]                                      |
|                                                               |
| GDO destinatari (3 selezionati):                              |
|   [x] Mario   [x] Luigi   [x] Anna   [ ] Carla                |
|   [Seleziona tutti] [Nessuno]                                 |
|                                                               |
| Anteprima: 50 lead totali → ~17 per GDO (round-robin equo)    |
|                                                               |
|                       [ Esegui Assegnazione → ]               |
+--------------------------------------------------------------+
```

### Comportamenti

- **Visibilit&agrave; card**: se `webinarAvailable + noWebinarAvailable === 0` la card non viene renderizzata (pool esaurito).
- **Input clamping**: il numero per ciascun bucket non pu&ograve; superare la disponibilit&agrave;; al raggiungimento del max appare etichetta "max".
- **Bottone disabilitato** quando:
  - `webinarN + noWebinarN === 0`, OPPURE
  - `selectedGdoIds.size === 0`, OPPURE
  - `loading === true`.
- **Conferma modale prima di eseguire** se totale > 100 (safety check sui batch grossi).
- **Report inline** dopo l'esecuzione: stessa estetica del report di `processCsvImport` (tag per GDO con quanti webinar / no-webinar ha ricevuto).
- **Refresh contatori** dopo esecuzione tramite re-fetch di `getLaunchPoolStatus()` + `router.refresh()`.

## Permessi e accessi

`/import` &egrave; gi&agrave; protetta a livello di middleware/route per il ruolo manager. Nessun cambio di permessi necessario — la card eredita la protezione della pagina.

## Edge cases

| Caso | Comportamento |
|---|---|
| Pool completamente esaurito | Card non renderizzata |
| Un solo bucket esaurito | Input del bucket esaurito disabilitato con badge "esaurito"; l'altro bucket resta usabile |
| N richiesto > disponibili | Input clampato al max + tooltip "max N" |
| Nessun GDO selezionato | Bottone disabilitato + hint "Seleziona almeno 1 GDO" |
| Due manager pescano insieme | `FOR UPDATE SKIP LOCKED` impedisce doppia assegnazione |
| GDO selezionato disattivato a met&agrave; flusso | Server action lo filtra e ritorna errore con lista GDO ignorati |
| N webinar + N no-webinar = 0 | Bottone disabilitato |

## Eventi e analytics

- Seed: `IMPORTED` con `metadata.source='launch_pool_seed'`.
- Pesca: `ASSIGNED` con `metadata.source='launch_pool'` e `metadata.bucket`.
- Possibile query futura: `SELECT launch_bucket, salesperson_outcome, COUNT(*) FROM leads WHERE launch_bucket IS NOT NULL GROUP BY 1,2` → tasso di chiusura per bucket.

## File toccati / creati

**Nuovi**:
- `src/app/actions/launchPoolActions.ts`
- `src/components/LaunchPoolCard.tsx`
- `drizzle/migrations/0003_add_launch_bucket_to_leads.sql` (la prossima migration dopo `0002_lead_is_self_booked.sql`)

**Modificati**:
- `src/db/schema.ts` — aggiunta colonna `launchBucket`
- `src/app/(dashboard)/import/page.tsx` — montaggio `<LaunchPoolCard />`

**Eseguiti una tantum**:
- SQL seed delle ~5.728 righe su Supabase produzione + log evento `IMPORTED` per ciascuna.

## Out of scope (esplicitamente non in questa iterazione)

- Storico/log dei round di assegnazione (chi ha pescato cosa quando).
- Analytics dedicate sul rendimento del bucket WEBINAR vs NO_WEBINAR.
- Eliminazione lead dal pool senza assegnarli ("scarta dal pool").
- UI di upload per aggiungere nuovi lead al pool dal browser.
- Re-shuffle / restituzione lead al pool (un lead assegnato non torna indietro).
