# Performance Venditori — dati mensili completi (2026-07-15)

## Problema riportato (Bruno)
"Nel report delle performance dei venditori mi serve che tutti i dati siano filtrati
per mesi: sales010 questo mese ha fatto 5 trattative ma nel report vedo numeri che
non tornano."

## Diagnosi (verificata su prod)
La pagina `/performance-venditori` filtra GIÀ per mese, ma legge SOLO `salesAttempts`,
che è incompleta:

1. **Storico assente**: `salesAttempts` esiste dal 2026-07-02 (migr. 0015). Tutti gli
   esiti precedenti vivono solo su `leads.salespersonOutcome*` → i mesi passati
   (aprile/maggio/giugno) risultano vuoti e persino luglio è monco.
2. **Percorso Conferme bypassa la tabella**: `setSalespersonOutcome` (ConfermeBoard/
   ConfermeDrawer) aggiorna `leads` ma NON inserisce in `salesAttempts` → ogni esito
   registrato dalle Conferme è invisibile al report (es. lead "Lorenzo Borghetti",
   esitato 1/7, sales010: 5° trattativa di luglio mancante).
3. **Date esito stantie (14 righe, 10–13 luglio)**: prima del fix 96e5744 il drawer
   precompilava la data esito del follow-up con quella dell'esito precedente →
   follow-up salvati con `outcomeAt` del tentativo 0 (es. Domenico Bongiovanni,
   sales010: attempt 0,1,2 tutti al 10/7 15:12).

Numeri reali sales010 (leads): apr 9 esitati/3 chiusi, mag 16/5, giu 10/3, lug 5/1
(€1.890). La pagina oggi mostra per luglio 4/1 e zero nei mesi passati.

## Fix
- **Codice** — `setSalespersonOutcome` (confermeActions.ts): dopo l'update su leads,
  insert in `salesAttempts` (attemptNumber = count righe esistenti del lead,
  salesUserId = lead.salespersonUserId; skip se venditore assente o esito
  "Lead non presenziato", che non è una trattativa).
- **Backfill SQL (prod)** — per ogni lead con `salespersonOutcome IN
  ('Chiuso','Non chiuso','Perso','Sparito')`, `salespersonUserId` e
  `salespersonOutcomeAt` valorizzati e NESSUNA riga `salesAttempts`: insert attempt 0
  con outcome/notClosedReason/closeProduct/closeAmountEur/outcomeAt copiati da leads.
  `nextFollowUpDate = null` (nessun follow-up fantasma nei monitor). ~382 righe.
  Esclusi: 23 "Lead non presenziato", 16 senza venditore.
- **Bonifica SQL (prod)** — le 14 righe con outcomeAt copiato da un attempt
  precedente (createdAt > outcomeAt + 1h): `outcomeAt = createdAt` (tutte restano
  a luglio).

## Verifica
- SQL: sales010 luglio = 5 esitati distinti / 1 chiuso €1.890; apr/mag/giu popolati
  e coerenti con leads (a meno dei 'Lead non presenziato').
- `npx tsc --noEmit` + build pulita; commit + push (auto-deploy Vercel).

## Rollback backfill
Le righe inserite hanno `createdAt` = timestamp del batch (default now()); elenco
id salvato in scratchpad della sessione.
