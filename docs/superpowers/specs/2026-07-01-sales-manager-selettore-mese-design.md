# Sales Manager — Selettore mese (dati storici)

**Data:** 2026-07-01
**Route:** `/panoramica-generale` (dashboard "Sales Manager")
**Obiettivo:** permettere a manager/admin (e TL Conferme in sola lettura) di rileggere i numeri
consuntivi di qualunque mese degli ultimi 12, per controllo, senza modificare dati.

## Problema

La schermata Sales Manager è cablata sul **mese in corso**: non esiste alcun modo di guardare
indietro. Il management non riesce a controllare i numeri definitivi dei mesi chiusi.

## Scope

Sulla pagina realmente renderizzata oggi, sotto le strisce operative, ci sono **due tabelle**:

1. **Caricamento Lead** (`getLeadOverview`)
2. **Numeri Mensili** (`getMetricsOverview`, che internamente usa `getFunnelOverview`)

`SalesManagerSections` (ROAS + KPI venditori) e la tabella **Funnel Overview** esistono nel codice
ma **non sono montati** in `PanoramicaClient` → **fuori scope**. Il selettore copre solo le due
tabelle effettivamente in pagina.

Le tre server action degli overview **accettano già** un parametro opzionale `yearMonth` e
defaultano al mese corrente. Manca solo il selettore in UI e alcune rifiniture di comportamento
sui mesi passati.

## Decisioni prese

- **Range selettore:** ultimi 12 mesi (mese corrente + 11 precedenti), calcolati client-side.
- **Mesi chiusi = sola lettura:** sui mesi ≠ corrente i pulsanti "Modifica target" / "Modifica
  target metriche" sono nascosti.
- **Strisce operative:** Alert MTD (`SalesAlertStrip`) e Parametri Manager (`ManagerParamsStrip`)
  restano legate al mese corrente; quando si seleziona un mese passato **vengono nascoste**
  (mostrano solo dati live che sarebbero fuorvianti su uno storico).

## UX

- In cima alla pagina, **sopra le strisce**, compare `Periodo: [Luglio 2026 ▼]` con gli ultimi 12 mesi.
- Default = mese in corso → pagina identica a oggi.
- Selezionando un mese passato:
  - Le due tabelle si ricaricano su quel mese (breve spinner durante il fetch).
  - Le strisce operative spariscono.
  - I pulsanti di modifica target spariscono (sola lettura).
  - La colonna **"Today"** dei Numeri Mensili mostra `—` (priva di senso su un mese chiuso).
  - L'header passa da "Mese in corso" a **"Mese storico"** con indicazione di sola lettura.
  - Il *Target Prev* diventa automaticamente il target pieno del mese (giorni lavorativi tutti
    trascorsi).

## Architettura

### Nuovo componente client `SalesManagerView`
Wrapper che coordina lo stato del periodo:
- **Owns** `selectedMonth` (default = `currentYearMonth`).
- Disegna il selettore mese (ultimi 12 mesi).
- Monta le strisce **solo se** `selectedMonth === currentYearMonth`. Le riceve come prop
  `strips: ReactNode` da `page.tsx` (che mantiene i suoi gate: Tutte-le-aziende / TL Conferme).
- Passa `selectedMonth` e `currentYearMonth` a `PanoramicaClient`.

Interfaccia:
```
SalesManagerView({
  initialData, initialFunnelData, initialMetricsData,  // SSR, mese corrente
  readOnly, readOnlyVariant,
  currentYearMonth: string,
  strips: ReactNode,
})
```

### `PanoramicaClient` (modifiche)
- Nuove prop: `selectedMonth: string`, `currentYearMonth: string`.
- Deriva `isPastMonth = selectedMonth !== currentYearMonth`.
- `useEffect` sul cambio di `selectedMonth`: se diverso dallo yearMonth dei dati correntemente
  caricati, rifetch dei 3 overview (`getLeadOverview/getFunnelOverview/getMetricsOverview`) con
  `selectedMonth`; stato `loading` per lo spinner. Per il mese corrente iniziale si usano i dati SSR.
- I bottoni "Modifica target" e "Modifica target metriche" vengono mostrati solo se
  `!readOnly && !isPastMonth`.
- Nella tabella Numeri Mensili, quando `isPastMonth`, la cella "Today" mostra `—`.
- L'etichetta "Mese corrente" nell'header card diventa dinamica ("Mese in corso" / "Mese storico"
  + badge sola lettura quando storico).
- La `refresh()` esistente resta invariata (rilegge sul mese attualmente caricato).

### `page.tsx` (modifiche)
- Fetch iniziale invariato (mese corrente, SSR).
- Calcola `currentYearMonth` (via `currentYearMonthRome()`).
- Renderizza `<SalesManagerView ... strips={<>{<SalesAlertStrip/>}{stripsManager}</>} />` passando
  come `strips` esattamente i nodi che oggi renderizza tra il titolo e `PanoramicaClient`,
  preservando i gate esistenti (`ManagerParamsStrip` solo se `!isAllCompanies && !isTlConfermeViewer`).

## Backend — unica modifica di sicurezza

`funnelOverviewForCompany` → `resolveAlertState` **scrive sul DB** lo stato allarme
(`statoSegnalazione`, `dataPrimoSottoSoglia`) usando la data odierna. Poiché `getMetricsOverview`
richiama `funnelOverviewForCompany` internamente, **caricare un mese passato ne sovrascriverebbe**
lo stato macchina degli allarmi in base a oggi.

**Fix:** per un mese `yearMonth !== currentYearMonthRome()`, saltare la scrittura e usare lo stato
già memorizzato nella riga baseline (`row.statoSegnalazione` / `row.dataPrimoSottoSoglia`) — puro
display, nessun `db.update`. Per il mese corrente il comportamento resta identico a oggi.

Implementazione: aggiungere un parametro `persistAlertState: boolean` (default `true`) a
`funnelOverviewForCompany`, impostato a `false` quando `ym` non è il mese corrente; quando `false`,
non chiamare `resolveAlertState` (o passargli un flag per non scrivere) e restituire i valori
memorizzati così come sono.

**Verifica in implementazione:** `countWorkingDaysElapsed(year, month, new Date())` per un mese
passato deve restituire i giorni lavorativi pieni del mese (così `Target Prev = target pieno`). Se
per un mese passato restituisse un valore troncato/errato, adattare la funzione o passare una data
di riferimento pari a fine mese quando il mese è chiuso. Da confermare leggendo
`src/lib/workingDaysUtils.ts`.

## Fuori scope
- ROAS/marketing e KPI venditori (`SalesManagerSections`, non montati).
- Tabella Funnel Overview (`FunnelSection`, definita ma non renderizzata).
- Modifica dei consuntivi di mesi passati (scelta: sola lettura).

## Rischi / note
- Nessuna nuova query DB: gli overview sono già `yearMonth`-aware.
- L'unico effetto collaterale da neutralizzare è la scrittura di `resolveAlertState`.
- `SalesAlertStrip` / `ManagerParamsStrip` non ricevono un mese: restano "live". La coordinazione
  avviene solo tramite montaggio condizionale nel wrapper.
