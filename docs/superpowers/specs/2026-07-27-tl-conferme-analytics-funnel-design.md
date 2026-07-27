# TL Conferme — Analytics per funnel (design)

**Data:** 2026-07-27
**Richiesta:** Bruno — "nella sezione del TL Conferme dovremmo mettere anche la % di conferme,
presenze e chiusi per funnel, e se ci sono altri dati utili aggiungiamo anche quelli".

## 1. Contesto

`/conferme/panoramica-tl` (server component + `getConfermeTlOverview`) oggi mostra:
5 card KPI (%conferme, %presenze, %chiusure, chiusure settimana, fatturato settimana)
e una tabella per operatore (confermati / scartati / chiusure / fatturato). Solo mese corrente.

## 2. Metodo di calcolo — CANON action-date

Decisione PO: usare **lo stesso calcolo di Marketing Analytics (`getMarketingStatsByGdo`) e
KPI GDO**, cioè l'attribuzione *action-date* già documentata in `src/lib/metricsUtils.ts`:

| Metrica | Data sorgente | Predicato |
|---|---|---|
| Fissati | `COALESCE(appointmentCreatedAt, appointmentDate)` | `appointmentDate IS NOT NULL` |
| Confermati | `confirmationsTimestamp` | `confirmationsOutcome = 'confermato'` |
| Presenziati | `presentedAt` (latch, PO 2026-07-17) | `presentedAt IS NOT NULL` |
| Chiusi / Fatturato | `salespersonOutcomeAt` | `salespersonOutcome = 'Chiuso'` |

Bounds Europe/Rome (`monthBoundsRome`). Funnel esclusi: `TEST`, `BLT`, vuoto.

**Alternativa scartata (coorte).** Seguire gli appuntamenti *schedulati* nel mese fino in fondo
renderebbe le tre percentuali moltiplicabili, ma introdurrebbe una quarta metodologia nel CRM.
La regola d'oro di `metricsUtils.ts` ("ogni pagina consuma la stessa definizione") vale più della
purezza statistica: il TL confronta i suoi numeri con Marketing Analytics e devono coincidere.

**Conseguenza: la pagina TL oggi NON è canon** e i numeri cambieranno leggermente.
Usa `appointmentDate` per i fissati (non la data di fissaggio) e conta "presentato" chi ha esito
venditore `Chiuso|Non chiuso` invece del latch `presentedAt`. Delta misurato su luglio 2026:

| Luglio 2026 | Fissati | Confermati | Presenziati | Chiusi |
|---|---|---|---|---|
| Canon | 1.334 | 243 | 226 | 96 |
| Pagina attuale | 1.398 | 245 | 216 | 93 |

**Lista funnel: derivata dai dati**, non da `OFFICIAL_FUNNELS`. Quella costante (in
`marketingActions.ts`) non contiene `BLACK SUMMER`, che a luglio 2026 è il primo funnel per
volume (518 fissati) e per fatturato (€126k). Fuori scope qui, ma è un buco aperto su
Marketing Analytics da segnalare.

**Funnel temporanei (PO 2026-07-27).** Black Summer è il funnel dell'offerta mensile di luglio e
da agosto non deve più comparire. La derivazione dai dati lo gestisce senza interventi: un funnel
compare solo nei mesi in cui ha attività, e il funnel della prossima offerta appare da solo.
Restano visibili — correttamente — le chiusure residue nei mesi successivi di appuntamenti fissati
a luglio: nasconderle toglierebbe fatturato reale dal totale. Per lo stesso motivo NON si aggiunge
Black Summer a `OFFICIAL_FUNNELS`: la lista fissa è proprio ciò che rende ciechi ai funnel a termine.

**Eccezione dichiarata:** il blocco Lead time è per costruzione *per-appuntamento* (raggruppa la
coorte dei fissati del mese e la segue). Va etichettato come tale nell'UI.

## 3. Blocchi

### 3.1 Tabella per funnel (richiesta principale)

Colonne: Funnel | Fissati | Conf | %Conf | Pres | %Pres | Chiusi | %Chius | Fissato→Chiuso |
Fatturato | €/fissato. Ordinata per fatturato desc, riga TOTALE in fondo.

`Fissato→Chiuso` e `€/fissato` sono le due colonne che rendono i funnel confrontabili in una
riga sola: a luglio un appuntamento Black Summer vale €243, uno Database €47.

### 3.2 Motivi di scarto

Scarti con `confirmationsTimestamp` nel mese, raggruppati per `confirmationsDiscardReason`,
barre orizzontali con % sul totale scarti. Luglio: `3 NR consecutivi` 56%, `non interessato` 17%.
Distingue problema di raggiungibilità da obiezione commerciale.

### 3.3 Lead time fissaggio → appuntamento

Bucket `0 gg` / `1 gg` / `2-3 gg` / `4-7 gg` / `8+ gg` sui fissati del mese, con % conferma e
% presenza. Giugno-luglio 2026: 1 giorno → 19,2% conferme, 2-3 giorni → 11,2%. Leva verso i GDO.

### 3.4 Operatori (estensione della tabella esistente)

Aggiunte: %presenza sui suoi confermati, %chiusura sui suoi presenziati, € per conferma.
Distingue chi conferma tanto da chi conferma bene (luglio: 110 conf al 33,3% vs 43 conf al 53,7%).
Righe: utenti `CONFERME` attivi + chiunque abbia lavorato ≥1 esito nel mese (es. admin).

### 3.5 Trend settimanale + delta mese precedente

Righe per settimana ISO del mese (clampate ai bounds del mese, così la somma torna col totale)
con le tre percentuali. Sulle card KPI: delta in punti percentuali vs stesso indicatore del mese
precedente (mese intero).

### 3.6 Selettore mese

Dropdown ultimi 12 mesi, stesso pattern di `SalesManagerView.tsx`. Le card "settimana corrente"
restano montate solo sul mese in corso.

## 4. Architettura

- `getConfermeTlOverview(yearMonth?: string)` in `src/app/actions/confermeKpiActions.ts`:
  **una sola query** su `leads` che copre mese selezionato + mese precedente (OR sulle 4 date
  canoniche), poi tutta l'aggregazione in memoria. Stesso pattern di `getMarketingStatsByGdo`,
  rispettoso del budget Disk IO (nessun fan-out di query per funnel/settimana).
  Query extra: `users` della company (piccola) per i nomi operatore.
- Authz invariata: ADMIN | MANAGER | (CONFERME && `isConfermeTl`). `companyScope(ctx, ...)` su tutto.
- `panoramica-tl/page.tsx` resta server component (auth + fetch iniziale) e monta
  `PanoramicaTlClient.tsx` (nuovo, `"use client"`) che gestisce selettore mese + re-fetch via
  server action in `useTransition`.
- Nessuna migrazione DB: tutti i campi esistono già.

## 5. Fuori scope

- Fix di `OFFICIAL_FUNNELS` su Marketing Analytics (Black Summer invisibile) — da valutare a parte.
- Target/soglie per funnel: nessun target esiste a questo livello di granularità.
- Export CSV.
