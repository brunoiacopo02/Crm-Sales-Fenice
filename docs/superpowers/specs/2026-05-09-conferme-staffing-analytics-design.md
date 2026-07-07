# Conferme Staffing Analytics — Design Doc

**Data:** 2026-05-09
**Owner:** Bruno
**Stato:** Design approvato, pronto per implementation plan

## Obiettivo

Calcolare in modo standardizzato quante persone servono al team **Conferme** per gestire il carico di chiamate quotidiane. Oggi il lavoro è svolto solo da Alberto e Andrea; senza dati strutturati è impossibile capire quando saturano e quanto staff aggiungere prima di compromettere il funnel.

L'output è una nuova dashboard `/conferme/analytics` che, dato un periodo (7/14/30/90gg) e opzionalmente un operatore, calcola:

- **Saturazione attuale** (% del fabbisogno coperto dalla capacità del team)
- **Operatori necessari** in giornata media
- **Picco di operatori contemporanei** sull'ora più carica

A supporto della metrica sintetica, mostra le metriche operative richieste dal brief: media app/giorno da chiamare, tempo medio chiamata, % richiamati in giornata, % parcheggiati altri giorni, % risposta per tentativo (1°/2°/3°/mai), distribuzione app per slot orario.

Tutte le metriche sono **medie giornaliere** calcolate sul periodo selezionato (denominatore = giorni lavorativi del periodo, escluse domeniche).

## Decisioni di scope

1. **Workflow chiamate: 4 NR → 3 NR.** Modifica al workflow esistente: scarto automatico al 3° NR consecutivo (oggi è al 4°). Storico unificato: lead scartati storicamente per "4 NR consecutivi" contano come "mai risposto" nelle metriche, stessa categoria di "3 NR consecutivi".
2. **Timer chiamata manuale.** Pulsante toggle Avvia/Ferma nel pannello azioni rapide. Durata salvata su `confCall1/2/3Duration`. Timer non avviato → durata NULL ammessa, esclusa da AVG.
3. **Visibilità.** `/conferme/analytics` accessibile a `MANAGER`, `ADMIN`, `CONFERME` con vista identica.
4. **Periodo e filtro.** Selettore 7/14/30/90gg + filtro operatore (`tutti` / per Conferme attivo). Persistenza in URL searchparam.
5. **Capacità default.** 6.5h × N operatori attivi. Oggi: 780 min/giorno (Alberto 13:00–19:30 + Andrea 13:30–20:00).

## Architettura dati

### Già in DB (storico recuperabile)

- `leads.confCall1At/2At/3At` — timestamp di ogni NR
- `leads.confirmationsOutcome`, `confirmationsTimestamp`, `confirmationsDiscardReason`
- `leads.confSnoozeAt`, `confNeedsReschedule`, `recallDate`
- `leads.appointmentDate` — slot orario
- `leadEvents` con eventTypes esistenti: `conferme_no_answer`, `conferme_outcome_set`, `conferme_recall_scheduled`, `conferme_snooze_set`, `conferme_auto_discarded_4nr`

### Da aggiungere

**Schema (`src/db/schema.ts`):**

```ts
// Su tabella leads, accanto ai confCall*At esistenti:
confCall1Duration: integer('confCall1Duration'),  // secondi, nullable
confCall2Duration: integer('confCall2Duration'),
confCall3Duration: integer('confCall3Duration'),
```

**Migrazione Drizzle:** aggiungere i tre campi nullable, nessun backfill. Le righe esistenti restano NULL e sono escluse da AVG (comportamento desiderato).

**Nuovo eventType `leadEvents`:** `conferme_call_logged` con
```ts
metadata: {
  durationSeconds: number,    // 0 se Stop senza tempo
  slot: 1 | 2 | 3 | null,     // null se chiamata di servizio (no azione rapida dopo)
  answered: boolean | null    // true=risposta, false=NR, null=indeterminato
}
```

**Nuovo eventType `leadEvents`:** `conferme_auto_discarded_3nr` (sostituisce `..._4nr` per le nuove righe; quelle vecchie restano per cronologia).

## Workflow modification: 3 NR

File: `src/app/actions/confermeActions.ts`, funzione `recordConfermeNoAnswer`.

```
Stato attuale (4 NR):
  null → confCall1At → confCall2At → confCall3At → auto-scarto al 4° tentativo

Stato target (3 NR):
  null → confCall1At → confCall2At → auto-scarto al 3° tentativo (con confCall3At valorizzato)
```

**Cambi:**
1. Nel ramo `!oldLead.confCall3At`, oltre a settare `confCall3At = now`, settare anche:
   ```ts
   confirmationsOutcome: 'scartato',
   confirmationsDiscardReason: '3 NR consecutivi',
   confirmationsUserId: session.user.id,
   confirmationsTimestamp: new Date(),
   ```
2. Rimuovere il ramo `else` (4° NR) — irraggiungibile.
3. Inserire `leadEvents` con `eventType: 'conferme_auto_discarded_3nr'`, metadata `{ reason: '3 NR consecutivi', autoDiscard: true }`.
4. Triggerare `enqueueMarketingWebhook({ eventType: 'appointment.outcome' })` (già fatto al 4° NR oggi).
5. **UX silenziosa**: nessun modal, nessun toast — l'operatore vede direttamente che il lead è uscito dal kanban.
6. **`undoConfermeNoAnswer`**: estendere per gestire l'undo dello scarto al 3° NR. Se `oldLead.confirmationsDiscardReason === '3 NR consecutivi'` e `oldLead.confCall3At`, ripulire anche `confirmationsOutcome`, `confirmationsDiscardReason`, `confirmationsUserId`, `confirmationsTimestamp` insieme a `confCall3At`.

**Grep di riferimento da aggiornare:** ricercare in tutta la codebase stringhe `"4 NR"`, `"4nr"`, `"tentativo 3 di 4"` o simili nelle UI Conferme e nei commenti per coerenza testuale.

## Timer chiamata

### UI

Nuovo componente `ConfermeCallTimer` posizionato nel pannello azioni rapide del lead Conferme (lo stesso punto di NR / Risentire dopo / Conferma / Scarta / Riprogramma).

Stati:
```
idle:     [▶ Avvia chiamata]
running:  [■ 00:42  Ferma]      ← contatore live aggiornato ogni secondo
stopped:  [▶ 00:42  Avvia]      ← mostra ultima durata, pronto a ripartire
```

### Persistenza

Stato `{ leadId, startedAt }` salvato in `sessionStorage` con chiave `conferme_call_timer`. Al mount del componente, se la chiave esiste e `leadId` corrisponde, il timer riparte come running. Su unload tab si perde (accettabile).

### Server action

Nuovo file/funzione: `src/app/actions/confermeAnalyticsActions.ts` → `logConfermeCallDuration(leadId, durationSeconds, opts)`.

Regola di assegnazione slot:
```
opts.actionTaken: 'nr' | 'outcome' | null
- 'nr' (l'operatore ha appena premuto NR): salva su confCall(N)Duration dove N è l'NR appena registrato.
- 'outcome' (Conferma/Scarta/Snooze/Recall): salva su confCall(N+1)Duration dove N = NR già presenti, marca answered=true.
- null (Stop senza azione rapida): inserisce solo leadEvents.conferme_call_logged con slot=null, answered=null.
```

In tutti i casi inserisce `leadEvents` con `eventType: 'conferme_call_logged'` e metadata appropriata.

### Safety net

Quando l'operatore preme un'azione rapida con timer running, l'azione rapida prima di tutto ferma il timer client-side e logga la durata col `actionTaken` corrispondente, poi esegue la sua logica (NR / outcome / etc.). Se il timer non era stato avviato, l'azione rapida funziona normalmente e nessun log durata viene creato.

## Formule metriche

Sia:
- **P** = periodo selezionato in giorni (7/14/30/90)
- **G** = numero giorni lavorativi nel periodo (escluse domeniche)
- **U** = filtro operatore (`tutti` o `confermeUserId` specifico)
- **L_periodo** = lead toccati da almeno un evento conferme nel periodo (filtrati per U se U≠tutti)

### Media app/giorno da chiamare
```
N_app = COUNT(lead WHERE appointmentDate AT TIME ZONE 'Europe/Rome' ∈ P)
media_app_giorno = N_app / G
```
Suddivisione mostrata in UI:
- **Pomeriggio oggi-equivalente**: `appointmentDate` ora ∈ [15..21]
- **Mattina domani-equivalente**: `appointmentDate` ora ∈ [9..14]

Filtro operatore non applicato (carico di team).

### Tempo medio chiamata
Sui `leadEvents WHERE eventType='conferme_call_logged' AND timestamp ∈ P [AND userId=U]`:
```
tempo_medio_risposta = AVG(metadata->>'durationSeconds') WHERE answered=true
tempo_medio_nr       = AVG(metadata->>'durationSeconds') WHERE answered=false
tempo_medio_totale   = AVG(metadata->>'durationSeconds')          ← usato nello staffing
```
Eventi con `durationSeconds` mancante o NULL esclusi automaticamente.

### % richiamati in giornata (snooze)
```
N_snooze_giornata = COUNT(lead in L_periodo
  con almeno un leadEvents.conferme_snooze_set
  con metadata.snoozeAt::date == events.timestamp::date
  nel periodo)

pct_snooze_giornata = N_snooze_giornata / |L_periodo|
```

### % parcheggiati altri giorni
```
N_parcheggiati = COUNT(lead in L_periodo
  con almeno un conferme_recall_scheduled dove
    payload.newAppointmentDate::date > events.timestamp::date
    OR payload.needsReschedule == true
  nel periodo)

pct_parcheggiati = N_parcheggiati / |L_periodo|
```

### % risposta per tentativo
Sui lead con `confirmationsTimestamp ∈ P [AND confirmationsUserId=U]`:
```
risposto_al_1 = lead con confCall1At IS NULL                          (outcome al primo colpo)
risposto_al_2 = lead con confCall1At valorizzato AND confCall2At NULL (outcome dopo 1 NR)
risposto_al_3 = lead con confCall2At valorizzato AND confCall3At NULL (outcome dopo 2 NR)
mai_risposto  = lead con confirmationsDiscardReason IN ('3 NR consecutivi', '4 NR consecutivi')

denom = risposto_al_1 + risposto_al_2 + risposto_al_3 + mai_risposto

pct_risp_1 = risposto_al_1 / denom
pct_risp_2 = risposto_al_2 / denom
pct_risp_3 = risposto_al_3 / denom
pct_mai    = mai_risposto / denom
```

Nota: lead confermati o scartati per altri motivi (non NR-based) entrano nei rispettivi bucket "risposto al X". Lo stato `confCallNAt` valorizzato indica solo quanti NR ci sono stati prima della risposta.

### App per slot orario
Per ogni ora `H ∈ [9..21]`:
```
N_app_H = COUNT(lead WHERE EXTRACT(HOUR FROM appointmentDate AT TIME ZONE 'Europe/Rome') = H AND appointmentDate ∈ P)
media_app_ora_H = N_app_H / G
```
Output: array di 13 valori, render come bar chart orizzontale.

### Calcolo staffing (sintesi)

```
chiamate_per_giorno      = media_app_giorno × (1 + pct_snooze_giornata + pct_parcheggiati)
fabbisogno_minuti_giorno = chiamate_per_giorno × tempo_medio_totale_minuti
capacita_team_min        = 390 × N_operatori_attivi    (390 min = 6.5h per operatore)
saturazione              = fabbisogno_minuti_giorno / capacita_team_min
operatori_full_day       = ceil(fabbisogno_minuti_giorno / 390)
```

**Picco contemporaneo per slot orario:**
```
Per ogni ora H:
  carico_ora_H_min = media_app_ora_H × tempo_medio_totale_minuti × (1 + pct_snooze_giornata + pct_parcheggiati)
  operatori_ora_H  = carico_ora_H_min / 60

operatori_picco = MAX(operatori_ora_H per H ∈ [9..21])
ora_picco       = ARGMAX_H(operatori_ora_H)
```

> **Caveat:** `operatori_ora_H` è un'approssimazione: assume che gli appuntamenti dell'ora H siano chiamati in una finestra concentrata di 1h. La regola business reale (chiamare il pomeriggio prima per appuntamenti mattina, e in giornata per appuntamenti pomeriggio) implica spalmatura — quindi questo numero è un *indicatore di pressione*, non un fabbisogno orario letterale. La metrica decisionale è `saturazione` e `operatori_full_day`.

### N_operatori_attivi

Numero di utenti con `role='CONFERME'` e `isActive=true` al momento del rendering. Configurabile in futuro tramite settings, per ora derivato da DB.

## UI dashboard

Single-page route `app/(dashboard)/conferme/analytics/page.tsx`. Layout top-down:

### 1. Header (sticky)
- Titolo "Analytics Conferme"
- Selettore periodo: 7gg / 14gg / 30gg / 90gg
- Selettore operatore: dropdown popolato da utenti `role=CONFERME, isActive=true` + opzione "Tutti"
- Bottone "Aggiorna"
- Stato in URL: `?period=30&user=all` per shareability

### 2. Hero card — saturazione
Card grande, alto contrasto:
- Capacità: `780 min/giorno (Alberto + Andrea, 6h30 ciascuno)`
- Fabbisogno: `XXX min/giorno`
- Barra saturazione con colori: verde <80% / giallo 80-100% / rosso >100%
- Sotto: "Servono N operatori (giornata media) — Picco M alle ore H:00"

### 3. Cards metriche operative (grid 2 colonne)
- **Carico**: media app/giorno totale + split pomeriggio/mattina
- **Tempi**: tempo medio risposta / NR / totale (formato MM:SS)

### 4. % risposta per tentativo
Donut chart o barre orizzontali con i 4 bucket: 1° / 2° / 3° / mai.

### 5. Carico residuo (re-tentativi)
2 numeri grossi: % snooze giornata, % parcheggiati altri giorni.

### 6. Bar chart slot orario
Barre orizzontali, una riga per ora 9:00–21:00, valore = `media_app_ora_H` con etichetta numerica. Highlight della riga peak.

### Implementazione tecnica

- **Charts:** verifica se `recharts` o altra libreria charting è già nel `package.json`. Se no, CSS bars puro (nessuna nuova dipendenza). Le visualizzazioni sono semplici, non serve libreria.
- **Auto-refresh:** server component con `revalidate = 300` (5 min). Pulsante "Aggiorna" via `router.refresh()`.
- **Performance:** query aggregata unica via Drizzle SQL fragments; indici esistenti su `appointmentDate`, `confirmationsTimestamp`, `confirmationsOutcome` coprono i filtri principali. Aggiungere indice `lead_events_type_timestamp_idx` su `leadEvents (eventType, timestamp)` se non esiste — utile per query su `conferme_call_logged`.
- **Timezone:** sempre `Europe/Rome` per group-by giorno e ora, coerente con `getConfermeAppointments`.

## Server actions necessarie

File nuovo: `src/app/actions/confermeAnalyticsActions.ts`

```ts
export async function getConfermeAnalytics(opts: {
  periodDays: 7 | 14 | 30 | 90,
  userId?: string  // omitto = tutti
}): Promise<{
  hero: { capacityMin, demandMin, saturation, operatorsFullDay, peakOperators, peakHour },
  load: { mediaAppGiorno, splitMattina, splitPomeriggio },
  times: { mediaRisposta, mediaNr, mediaTotale },
  responseDistribution: { pctRisp1, pctRisp2, pctRisp3, pctMai, denom },
  recall: { pctSnoozeGiornata, pctParcheggiati },
  hourlyDistribution: Array<{ hour: number, mediaApp: number }>,
  meta: { periodDays, daysWorked, nOperators, generatedAt }
}>

export async function logConfermeCallDuration(
  leadId: string,
  durationSeconds: number,
  opts: { actionTaken: 'nr' | 'outcome' | null }
): Promise<{ success: boolean }>
```

## Edge cases

- **Periodo con zero lead toccati**: tutte le % e medie ritornano `0` o `null`, UI mostra placeholder ("Nessun dato nel periodo").
- **Operatore non Conferme nel filtro**: il dropdown popola solo `role=CONFERME, isActive=true`, ma per sicurezza il backend filtra anche per ruolo.
- **Lead con `appointmentDate` in domenica/festivo**: contano normalmente nelle metriche di carico (l'app può essere in domenica per ragioni storiche). Per `G` (giorni lavorativi del periodo) escludiamo solo le domeniche dal denominatore.
- **Storico mix 4 NR + 3 NR**: la metrica `mai_risposto` accetta entrambi i discard reason. Switch al 3 NR è trasparente alle metriche.
- **Concorrenza scrittura `confCall*Duration`**: il timer Stop arriva *dopo* che l'azione rapida ha già aggiornato la versione del lead. Soluzione: `logConfermeCallDuration` non usa il version check stretto — fa update mirato dei soli campi `confCall*Duration` e inserisce l'event log. Race rara e non-critica (worst case: durata associata a slot leggermente diverso).
- **Timer running quando il lead viene chiuso da un altro operatore**: al Stop, `logConfermeCallDuration` rileva che il lead è già `confirmationsOutcome=...` → salva comunque la durata sull'ultimo slot riempito + event log con metadata.

## Fuori scope (esplicitamente rimandato)

- Heatmap settimanale (giorno × ora) — interessante ma non richiesto.
- Confronto periodi (es. ultima settimana vs precedente) — niente per ora.
- Suggerimenti automatici "se vuoi scendere all'80% di saturazione, aggiungi 1 persona" — calcolabile facilmente, ma per ora basta il numero grezzo.
- Filtro su singolo operatore per le metriche di carico app/giorno (non ha senso, il carico è del team).
- Dashboard storica con time-series dei numeri principali (vedi trend nel tempo) — utile in seconda iterazione.
- Sound/notifica al raggiungimento della saturazione 100%.

## Piano di rollout

1. Schema migration (3 campi duration nullable)
2. Modifica workflow `recordConfermeNoAnswer` (4→3 NR) + `undoConfermeNoAnswer`
3. Server action `logConfermeCallDuration`
4. Componente `ConfermeCallTimer` + integrazione nel pannello azioni rapide
5. Server action `getConfermeAnalytics`
6. Pagina `/conferme/analytics` con tutte le card
7. Smoke test end-to-end (modifica workflow, timer in chiamata reale, dashboard popolata)
8. Aggiornamento link in nav per Conferme/Manager
