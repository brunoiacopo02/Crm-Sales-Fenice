# Incassi dal gestionale: sync in sola lettura + dashboard Incassi e I miei incassi

Data: 2026-10-02 · Stato: approvato dal PO (delega "fai come ritieni opportuno")

## 1. Perché

Il Database Clienti non vive più sul foglio Excel ma nel gestionale dell'amministrazione
(software interno). Il gestionale espone un'API in sola lettura con contratti, rate,
incassi e commissioni mensili per venditore. Il CRM deve:

- far vedere a Bruno (ADMIN, "Sales Manager") gli incassi totali, il dettaglio per
  venditore e i contratti a rischio;
- far vedere a ogni venditore i propri incassi e la propria commissione **meno le multe**
  che il CRM già registra (`salesLatePenalties`);
- in un secondo tempo, far girare `/riconciliazione` su questa fonte invece del foglio
  (FUORI da questo lavoro).

Il CRM **non scrive mai** nel gestionale e **non ricalcola** le commissioni: le prende dal
blocco `commissioni` dell'API. Le multe le toglie il CRM. I bonus sono fuori scope (PO: dopo).

## 2. Il contratto dell'API (concordato col gestionale il 02/10)

`GET {GESTIONALE_API_URL}/api/v1/contratti?dal=2026-09-01&incassi_dal=2026-09-01`
con `Authorization: Bearer {GESTIONALE_API_KEY}`. Ogni chiamata è uno **snapshot completo**:
un record assente è un record eliminato.

```
{ generato_il, contratti: [ {
    id, data_firma, pacchetto, importo_totale, stato_pagamento, venditore, note,
    cliente: { nome, cognome, telefono, email },
    rate:    [ { id, numero, tipo, scadenza, importo, stato, incasso_id } ],
    incassi: [ { id, data, importo, metodo, voce, stato, storno_di, rata_id,
                 venditore, conta_commissione, mese_commissione } ] } ],
  commissioni: [ { venditore, mese, totale_incassato, commissione_lorda, commissione_imponibile } ] }
```

Convenzioni: importi stringhe "1250.00" IVA inclusa; date "YYYY-MM-DD" senza ora; id UUID
stabili; telefono senza +39 o null; `venditore` = "Sales 00X" oppure "DIREZIONE";
`stato_pagamento` ∈ Pagato, Pagamento programmato, Sollecito, Stand-by, Recupero, Avvocato;
rate.stato ∈ pagata, da_pagare, scaduta; incassi.stato ∈ incassato, stornato; uno storno
è un incasso separato con importo negativo e `storno_di`. Il blocco `commissioni` ha una riga
per ogni codice e mese (anche a zero) e comprende rate di contratti firmati prima del 1/9.

Il formato reale va verificato sulla risposta di esempio che il gestionale manderà: il
parser è l'unico punto da ritoccare se qualcosa differisce.

## 3. Approccio: copia locale aggiornata ogni ora

Scelto fra tre (lettura diretta a ogni pagina; JSON grezzo per run) perché le pagine non
dipendono dall'uptime del gestionale, si incrociano le multe con una query e la futura
riconciliazione avrà tabelle vere.

## 4. Dati (migration `0039_gestionale_incassi.sql`)

Importi sempre in **centesimi interi** (`integer`), convertiti dalla stringa senza passare
da float. Tutte con `companyId` default 'fenice' come il resto dello schema.

- `gestionaleContratti`: `id` (UUID del gestionale, PK), `dataFirma` (date), `pacchetto`,
  `importoTotaleCents`, `statoPagamento`, `venditoreCode` (testo grezzo), `salesUserId`
  (nullable, risolto da `users.name = venditoreCode`; null per DIREZIONE), `note`,
  `clienteNome`, `clienteCognome`, `clienteTelefono` (normalizzato E.164 con
  `normalizePhoneStrict`, null se assente), `clienteEmail`, `deletedAt`, `syncedAt`.
- `gestionaleRate`: `id` PK, `contrattoId`, `numero`, `tipo`, `scadenza` (date),
  `importoCents`, `stato`, `incassoId`, `deletedAt`, `syncedAt`.
- `gestionaleIncassi`: `id` PK, `contrattoId`, `data` (date), `importoCents` (può essere
  negativo), `metodo`, `voce`, `stato`, `stornoDi`, `rataId`, `venditoreCode`,
  `salesUserId`, `contaCommissione` (bool), `meseCommissione` ('YYYY-MM'), `deletedAt`,
  `syncedAt`. Indici su (`salesUserId`, `meseCommissione`) e (`data`).
- `gestionaleCommissioni`: PK composta (`venditoreCode`, `mese`), `salesUserId`,
  `totaleIncassatoCents`, `commissioneLordaCents`, `commissioneImponibileCents`, `syncedAt`.
- `gestionaleSyncRuns`: `id`, `startedAt`, `finishedAt`, `trigger` ('cron'|'manuale'),
  `status` ('ok'|'error'|'skipped'), `generatoIl`, conteggi (inseriti, aggiornati,
  eliminati, ripristinati), `error`.

Nessuna FK verso `leads`: l'aggancio al lead (per telefono) arriva con la riconciliazione.
Il telefono normalizzato si salva già per renderlo banale.

## 5. Sincronizzazione

Modulo `src/lib/gestionale/`:

- `client.ts` — `fetchSnapshot()`: fetch con timeout 30s, 2 tentativi su 5xx/rete,
  401/403 → errore senza retry. Legge `GESTIONALE_API_URL`, `GESTIONALE_API_KEY`.
- `parse.ts` — `parseSnapshot(json)` puro: valida a mano i campi obbligatori (niente zod,
  non è fra le dipendenze), converte importi in centesimi (`"1250.00"` → 125000, accetta
  "-50.00", rifiuta formati ambigui), normalizza il telefono, e restituisce righe pronte per
  il DB oppure un errore che dice quale record e quale campo. Un record malformato fa
  fallire **tutto** lo snapshot: una copia parziale è peggio di una copia di un'ora fa.
- `plan.ts` — `planSync(existingIds, snapshot)` puro: per ogni tabella calcola upsert,
  da marcare `deletedAt` (presenti da noi, assenti nello snapshot) e da ripristinare.
- `run.ts` — `runGestionaleSync(trigger)`: crea il run, scarica, parsa, risolve i codici
  venditore → `users.id`, applica il piano **in una transazione**, chiude il run.

Guardie:
- **Snapshot vuoto con dati locali presenti → abort** (status error, nessuna eliminazione):
  protegge da una risposta sbagliata che cancellerebbe tutto.
- Più del 30% di righe da eliminare in un colpo → abort con lo stesso criterio.
- Codice venditore sconosciuto (né "Sales 00X" esistente né DIREZIONE) → la riga si salva
  con `salesUserId` null e il codice grezzo; il run lo elenca negli avvisi. Non blocca.
- Env mancanti → status `skipped`, nessun errore rumoroso: la feature va in produzione
  inerte finché Federico non dà URL e chiave.

Trigger:
- Cron `/api/cron/gestionale-sync`, schedule `15 * * * *`, stesso schema di
  `sales-late-penalties` (Bearer CRON_SECRET prima, poi diagnosi env), kill-switch
  `GESTIONALE_SYNC=off`, `maxDuration = 60`.
- Pulsante "Aggiorna adesso" su `/incassi`: server action solo ADMIN che chiama lo stesso
  `runGestionaleSync('manuale')`. Il motore NON vive nel file `'use server'` (lezione della
  riconciliazione: ogni export lì è un endpoint pubblico).

## 6. Regole di calcolo (tutte in `src/lib/gestionale/metrics.ts`, pure)

Mese = 'YYYY-MM', selezionabile da 2026-09 al mese corrente.

- **Commissione del venditore nel mese** = `commissioneImponibileCents` della riga
  `gestionaleCommissioni` (codice, mese). Nessun ricalcolo.
- **Multe del mese** = somma `amountEur` di `salesLatePenalties` con `salesUserId`, `monthKey`
  = mese e `voidedAt` null (ritardi + calendario, come il totale trattenute esistente).
- **Netto** = commissione imponibile − multe. Mostrato com'è anche se negativo (il PO lo
  ritiene impossibile; non si azzera di nascosto).
- **Incassato del venditore** = `totaleIncassatoCents` della riga commissioni (coincide
  coi prospetti compensi del gestionale).
- **Incassato totale del mese** (solo ADMIN) = somma `importoCents` di tutti gli incassi
  non eliminati con `data` nel mese, **storni negativi compresi** e senza filtrare per
  stato: è il flusso di cassa reale. Mostrato con la scomposizione per venditore, DIREZIONE
  inclusa come riga a sé.
- **Elenco incassi di un venditore nel mese** = incassi con `salesUserId` e
  `meseCommissione` = mese. La somma di quelli con `contaCommissione` si mostra accanto al
  totale del gestionale; se diverge, una nota lo dice (non si corregge nulla).
- **Contratto a rischio** = non eliminato e (`statoPagamento` ∈ Sollecito, Stand-by,
  Recupero, Avvocato **oppure** almeno una rata `scaduta`). Per ciascuno: rate scadute
  (numero e importo), residuo da pagare (somma rate non `pagata`), giorni dalla rata
  scaduta più vecchia. Ordinamento: Avvocato → Recupero → Sollecito → Stand-by → solo
  rate scadute; a parità, importo scaduto decrescente.

## 7. Pagine

### `/incassi` — solo ADMIN (link "Incassi" nel gruppo Direzione della Sidebar)
Gate come le altre pagine admin (`redirect('/')` se il ruolo non è ADMIN; anche la server
action ricontrolla). Contenuto:
1. Barra: selettore mese, "Ultimo aggiornamento: <ora> (ok/errore)", pulsante "Aggiorna
   adesso". Se l'ultimo run è in errore, banner con il messaggio.
2. Tessere: incassato totale del mese, commissioni imponibili totali, multe totali,
   contratti a rischio (numero e importo scaduto).
3. Tabella per venditore: incassato, commissione lorda, imponibile, multe, netto; riga
   DIREZIONE (solo incassato). Clic su un venditore → elenco dei suoi incassi del mese.
4. Contratti a rischio: tabella con cliente, telefono, venditore, stato, data firma, rate
   scadute, importo scaduto, residuo; filtro per venditore.

### `/miei-incassi` — solo VENDITORE (link "I miei incassi" nel suo menu)
Identità SOLO da `supabase.auth.getUser()` lato server: nessun parametro utente dal client.
1. Selettore mese + ultimo aggiornamento.
2. Tessere: incassato, commissione (imponibile), multe del mese, **netto**.
3. Elenco dei propri incassi del mese (data, cliente, voce, importo, conta sì/no).
4. I propri contratti a rischio (stesse colonne della vista admin, senza filtro).

Stato vuoto (sync mai eseguito o env assenti): messaggio "Dati dal gestionale non ancora
disponibili", niente tabelle a zero che sembrano dati veri.

## 8. Test

`node:test` come il resto del repo, file aggiunti allo script `test` di `package.json`:
- `parse.test.ts`: importi ("1250.00", "-50.00", "1250.5" e "1250" accettati — fino a 2
  decimali —, "1.250,00", "" e null rifiutati), telefono (null, "N/A", 10 cifre, già con 39), record malformato →
  errore che nomina id e campo, codici venditore.
- `plan.test.ts`: insert/update/delete/ripristino; guardia snapshot vuoto; guardia 30%.
- `metrics.test.ts`: netto con multe, storni nel totale cassa, divergenza elenco/totale,
  classificazione e ordinamento dei contratti a rischio, mese senza riga commissioni.
- Fixture JSON in `src/lib/gestionale/__fixtures__/snapshot.sample.json` costruita dal
  formato concordato; da sostituire con la risposta reale appena arriva.

## 9. Messa in produzione

1. Migration 0039 applicata via MCP Supabase.
2. Deploy con env assenti → cron `skipped`, pagine con stato vuoto. Nessun effetto visibile
   ai venditori oltre la voce di menu (che mostra lo stato vuoto).
3. Arrivano URL + chiave → env su Vercel → "Aggiorna adesso" → confronto a mano dei totali
   di settembre con il prospetto compensi del gestionale.

## 10. Fuori scope

Bonus; aggancio contratto → lead e migrazione di `/riconciliazione`; notifiche ai venditori;
scrittura verso il gestionale; storico degli snapshot.
