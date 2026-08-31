# Riconciliazione CRM ↔ Database Clienti

**Data:** 2026-08-29
**Stato:** design approvato, infrastruttura predisposta, implementazione da pianificare

## Il problema

Il fatturato del CRM non coincide con la lista contratti del PO, e a ogni chiusura di mese
qualcuno riallinea i contratti a mano via SQL. È successo il 18/07, il 22/07, il 25/07 e il
26/08. Ogni giro costa ore, produce un file di rollback che vive solo nello scratchpad di
sessione, e non lascia traccia consultabile.

La fonte di verità del fatturato è il Google Sheet **"Pannello - Sales Manager"**
(`1viEdIATN2bcJg9JW4OTzcM51d45j4ROCrtF7wgdEg5k`, owner `feniceacademy00@gmail.com`),
tab **`Database Clienti`**.

## Decisioni prese col PO (2026-08-29)

1. **Il pulsante diagnostica e applica ciò che l'admin spunta.** Non applica in automatico,
   non si limita a segnalare.
2. **Contratto su lead scartato** → la chiusura è attribuita al **funnel che il lead ha già
   nel CRM**. Non si inventa un'origine.
3. **Su quel lead si scrive solo chiusura e importo.** Nessun appuntamento, conferma o
   presenza ricostruiti a posteriori: i tassi di GDO e Conferme devono restare quelli veri.
4. **Contratto senza alcun lead** → si crea un lead minimo con funnel `FUORI FUNNEL`,
   così il totale quadra e l'origine resta distinguibile nelle statistiche.
5. **Accesso al foglio via service account**, con caricamento manuale come riserva. La
   riserva è un **CSV** (esportazione del singolo tab), non un XLSX: evita di aggiungere una
   dipendenza di parsing e riusa lo stesso normalizzatore del percorso automatico.
6. **Mappatura TUTOR → venditore confermata dal PO:** 001 = Bruno B., 002 = Marco L.,
   003 = Mattia G., 004 = Paolo S., 008 = Giacomo O., 010 = Stefania C.
   **La colonna K contiene nomi, non codici** (`Paolo S.`, `Giacomo O.`, …), e contiene anche
   **cinque valori fuori mappatura**: `Matteo D.` (17 contratti), `Matteo Q.` (10),
   `Amministrazione` (2), `Altro` (1), `Alberto C.` (1) — 31 contratti in tutto. Il motore
   non li indovina: li mostra come "venditore non mappato" e si rifiuta di applicarli finché
   il PO non dice a chi corrispondono.

## Architettura

### Sorgente dati

Lettura via Google Sheets API con service account (vedi *Infrastruttura*), range
`Database Clienti!A:K`. Colonne: A=cf, B=mail, C=num, D=nome, E=cognome,
F=FIRMA CONTRATTO, G=Stato di Pagamento, H=Valori contratti, I=Entrate, J=ancora da saldare,
K=TUTOR.

**Il tab è un `IMPORTRANGE`** da `1fobgWcPAuxP82nGLw9YG2KxvD7pUSqyG1dO_nM-KdTg`,
tab `Pacchetto_Bruno!A:AP`. L'API restituisce i valori già calcolati, quindi la lettura
funziona; ma se l'IMPORTRANGE si rompe (permesso revocato sulla sorgente) le celle
diventano `#REF!` e il foglio sembrerebbe **vuoto**. Il motore deve quindi **rifiutarsi di
riconciliare** quando trova `#REF!` o zero righe, invece di concludere che il CRM ha
contratti di troppo e proporne la cancellazione. È il fallimento più pericoloso del sistema.

Il service account **non** ha accesso al file sorgente: se un domani lo si condivide,
leggerlo direttamente elimina questa fragilità e dà 42 colonne invece di 11.

### Motore di matching (funzione pura)

Prende le righe del foglio e quelle del CRM, restituisce il diff. Nessun accesso a db o rete,
quindi testabile sui casi storici reali.

- match per **telefono normalizzato** (`normalizePhoneStrict`, `src/lib/phoneNormalize.ts`),
  **fallback sulla mail** quando il telefono non aggancia;
- aggregazione per **telefono + mese**, mai per solo telefono: le rifirme (Busonera, Carollo,
  Mazzola, Manoli) risulterebbero errori di importo;
- **righe multiple dello stesso mese si sommano** (Dell'Aglio 800 + 729 = un contratto);
- filtro foglio: `FIRMA CONTRATTO` nel mese, **escluso solo `Stand-by`**
  (`Recupero`, `Avvocato`, `Sollecito` contano);
- confronto solo su `companyId = 'fenice'`: il foglio non contiene Serenamente;
- lato CRM si leggono **sia `leads` sia `salesAttempts`**, che devono dare lo stesso totale.

### Le quattro famiglie

| | Cosa trova | Cosa scrive | Spuntata di default |
|---|---|---|---|
| 1 | Lead regolare con esito sbagliato | esito `Chiuso`, importo, data, venditore | sì |
| 2a | Contratto su lead **scartato** | solo chiusura e importo, funnel invariato | no |
| 2b | Contratto **senza lead** | crea lead minimo, funnel `FUORI FUNNEL` | no |
| 3 | Importo divergente | allinea al foglio; sotto €2 etichettato "arrotondamento" | sì |
| 4 | Chiuso nel CRM ma **assente dal foglio o Stand-by** | propone `Non chiuso` | mai |

La famiglia 4 è la direzione inversa: è quella che nel 2026-07 aveva individuato Bryan Wu e
Salvatore Di Maggio. Togliendo fatturato, resta sempre da spuntare a mano.

### Scritture e invariante

Le scritture su `salesAttempts` **devono passare da `resolveAttemptWrite`**
(`src/lib/venditorePerformance/guard.ts`), che garantisce *un solo `Chiuso` per ciclo*.
Una scrittura diretta reintrodurrebbe il doppio conteggio del fatturato risolto a luglio
(commit `12eed7e`). Ogni salvataggio logga in `events` come già fa il flusso normale.

### Reversibilità

Ogni applicazione crea una riga di storico con lo **stato precedente di ogni campo toccato**,
così "Annulla" ripristina senza SQL a mano. Sostituisce i `rollback_*.sql` di sessione.
Richiede una migrazione scritta a mano (`drizzle-kit generate` non è utilizzabile su questo
progetto).

### Interfaccia

Pagina `/riconciliazione`, solo admin. Selettore mese → **Confronta** → anteprima per
famiglia con checkbox → **Applica** → storico delle applicazioni con "Annulla".

## Infrastruttura predisposta il 2026-08-29

- **Service account** `crm-riconciliazione@crm-calendar-sales-fenice.iam.gserviceaccount.com`
  creato nel progetto Google Cloud `crm-calendar-sales-fenice` (lo stesso del Calendar).
  Nessun ruolo IAM: l'accesso arriva solo dalla condivisione del foglio.
- **Google Sheets API** abilitata sul progetto.
- **Foglio condiviso** col service account come *Visualizzatore*. Lettura verificata:
  21 tab, 3.723 righe in `Database Clienti`.
- **Variabili** `GOOGLE_SHEETS_SA_EMAIL` e `GOOGLE_SHEETS_SA_PRIVATE_KEY` su Vercel
  (production, preview, development) e in `.env.local`. La chiave privata è salvata con
  **a capo reali**, non con `\n` letterali: il codice deve applicare
  `.replace(/\\n/g, '\n')`, che è innocuo su entrambi i formati.
- Il file JSON scaricato dalla console è stato cancellato dal disco.

**Da verificare al primo deploy di preview:** che Vercel abbia conservato la chiave
multi-riga integra e non troncata al primo a capo.

## Test

Il motore va testato sui casi storici documentati, che sono già la sua specifica:
le rifirme in mesi diversi, Dell'Aglio spezzato su due righe, il telefono di Ludovici
sbagliato di una cifra, il doppione Ligozzi, gli arrotondamenti 2079→2080, gli stand-by
di Wu e Di Maggio, e i tre falsi positivi risolti dalla mail (Ierna, Mauro, Angulo).

Test di non-regressione gratuito: **giugno, luglio e agosto sono già stati quadrati a mano**,
quindi sui mesi già bonificati il motore deve produrre zero differenze. Se ne produce, sbaglia lui.

Serve anche un test esplicito sul caso `#REF!` / foglio vuoto: deve alzare un errore, mai
proporre correzioni.

### Task 10 — verifica delle viste che dividono per le presenze (2026-08-29)

Grep `presentedAt` su `src/app/actions` e `src/lib` (esclusi i test): 26 file, ~100 hit.
Solo tre punti usano `presentedAt` come **denominatore** di un tasso di chiusura
(`chiusi / presenziati`) senza gate su `salespersonUserId`/`confirmationsUserId` che
escluda già le chiusure fuori funnel della riconciliazione:

- `gdoPerformanceActions.ts` (`getManagerGdoTables`) → `percClosed` per-funnel e totale,
  gate solo su `assignedToId` (il GDO che ha scartato il lead resta il GDO attribuito).
- `confermeKpiActions.ts` (`getConfermeTlOverview`) → `pctChius`/`pctFissatoChiuso` di
  TOTALE, per-funnel e trend settimanale (non gated su `confirmationsUserId`, quindi
  non protetti come invece lo è `perOperator`).
- `productivityActions.ts` (`getApptQuality`) → `chiusuraPct`, gate solo su
  `assignedToId` + ruolo GDO.

Tutti gli altri punti sono innocui: o contano `presentedAt` come numero grezzo (presenze,
non un tasso), o sono già gated su un campo che una chiusura fuori funnel non avrà mai
(`salespersonUserId`, `confirmationsUserId`, `apptLeadIds`/`fissatiSet` costruiti da
`appointmentDate`) — vedi `kpiVenditoriActions.ts`, `achievementActions.ts`,
`botStatsActions.ts`, `kpiAdvancedActions.ts` (per-GDO), gamification (`managerRpgActions.ts`,
`questActions.ts`), `salesAlertsActions.ts`, `targetActions.ts`, `panoramicaActions.ts`,
`marketingActions.ts` (i tassi), `metricsUtils.ts`, `presenceCounting.ts`.

Misura sui dati reali (Supabase, `project_id=ncutwzsifzundikwllxp`):

```sql
SELECT date_trunc('month', "salespersonOutcomeAt") AS mese, count(*)
FROM leads
WHERE "companyId" = 'fenice' AND "salespersonOutcome" = 'Chiuso' AND "presentedAt" IS NULL
GROUP BY 1 ORDER BY 1 DESC LIMIT 12;
-- → []  (nessuna riga)

SELECT count(*) AS total_chiusi, count(*) FILTER (WHERE "presentedAt" IS NULL) AS chiusi_senza_presenza
FROM leads WHERE "companyId" = 'fenice' AND "salespersonOutcome" = 'Chiuso';
-- → {"total_chiusi":298,"chiusi_senza_presenza":0}
```

Il caso è **zero su 298 chiusure**: non preesiste, perché la riconciliazione non è ancora
stata applicata su dati reali (il primo giro su aprile/maggio è ancora da fare). Non è un
falso allarme: i tre punti sopra si romperebbero al primo giro reale, quando le ~29 chiusure
`lead-scartato`/`lead-assente` di aprile/maggio verranno applicate.

Fix applicato — un solo file di verità (`isFunnelClosure` in `src/lib/kpi/canon.ts`,
`Chiuso && presentedAt non nullo`, coperto da test in `canon.test.ts`) e nei tre punti
sopra un contatore aggiuntivo `chiusiConPresenza` usato SOLO al numeratore del tasso; il
conteggio grezzo `chiusi` (e il fatturato, dove presente) resta invariato — nessuna
presenza finta, nessun taglio ai totali di fatturato.

**Correzione (review, 2026-08-29):** la prima stesura di questa nota affermava che le
righe TOTALE, per-funnel **e trend settimanale** di `confermeKpiActions.ts` fossero
tutte protette. Non era vero: solo `totals`/`perFunnel`/`ALTRI` (che passano da
`withRatios`) usavano già `chiusiConPresenza`; il trend settimanale (riga
`weeklyRows`, dentro `getConfermeTlOverview`) costruiva ancora `pctChius` a mano con
`acc.chiusi / acc.presenziati` — lo stesso bug che il resto del fix elimina, lasciato
vivo in un sotto-oggetto. Corretto: ora usa `acc.chiusiConPresenza` (già popolato da
`accumulate()`, nessuna query o contatore nuovo). Verificato che non restino altri
`.chiusi /` non filtrati nel file.

`npx tsc --noEmit`, `npm test` (224/224, incluse le 5 nuove su `isFunnelClosure`) e
`npm run build` verdi dopo il fix completo.

`marketingActions.ts` (`getMarketingStats`/`getMarketingStatsByGdo`) usa
`appointmentDate`, non `presentedAt`, come gate su `close`/`fatturato` per-funnel —
stesso meccanismo di rischio di questo task, campo diverso. Per la famiglia
`lead-scartato` (funnel reale mantenuto, `appointmentDate` mai valorizzato) questo
esclude silenziosamente quel fatturato da Marketing Analytics/ROAS. Il controller ha
messo questo punto in scope (Ruling B) con una condizione: applicare la correzione SOLO
se una misura sui dati reali dimostra che è un no-op oggi (nessuna chiusura storica
sarebbe toccata). La misura ha dato esito diverso da zero — vedi sotto — quindi la
correzione **non è stata applicata**: resta una decisione del PO.

```sql
SELECT date_trunc('month', "salespersonOutcomeAt") AS mese, count(*)
FROM leads
WHERE "companyId" = 'fenice' AND "salespersonOutcome" = 'Chiuso' AND "appointmentDate" IS NULL
GROUP BY 1 ORDER BY 1 DESC LIMIT 12;
-- → 2026-07: 2, 2026-05: 1, 2026-04: 3   (6 chiusure storiche, NON un no-op)
```

Le 6 chiusure preesistenti (dettaglio per funnel/importo nel report di task): 2 Black
Summer a luglio (€3.335), 1 ORG a maggio (€3.179), 1 CORSO 10 ORE + 1 ORG + 1
TELEGRAM-TK ad aprile (€1.890 + €2.890 + €1.529). Non sono un effetto della
riconciliazione (che non è ancora stata applicata su dati reali): sono chiusure
esistenti prima di questo task, di origine non accertata in questa verifica. Rimuovere
il gate su `appointmentDate` sposterebbe con effetto retroattivo il fatturato/ROAS di
aprile, maggio e luglio di Marketing Analytics — un cambio di numeri storici che il PO
deve decidere consapevolmente, non un effetto collaterale di un task di verifica.

## Fuori scope

- Scrivere sul foglio: la riconciliazione è a senso unico, dal foglio al CRM.
- Riconciliare Serenamente: il foglio non la contiene.
- Automatizzare l'esecuzione (cron): l'applicazione resta un gesto umano.

## Primo giro utile

**Aprile e maggio 2026**: ~29 contratti per €64k mai riportati nel CRM, quasi tutti su lead
`REJECTED` dei funnel ORG e Database. È il buco più grosso rimasto e il banco di prova della
famiglia 2.

## Collaudo sui dati veri (2026-08-31)

Primo confronto in sola lettura su cinque mesi (aprile → agosto), foglio live via
service account: 3.723 righe grezze. Ha fatto emergere tre difetti che i test a
tavolino non potevano vedere, tutti corretti prima di qualunque applicazione.

**1. La famiglia `lead-scartato` non si accendeva mai — zero righe su 27.**
`loadCrmClosures` cerca i candidati fra i lead con `salespersonOutcomeAt` nel
mese. Un lead scartato dal GDO quell'esito non ce l'ha, per definizione: restava
invisibile al confronto e il suo contratto finiva in `lead-assente`. Applicarlo
avrebbe **creato un lead nuovo accanto a quello che esiste già** — 26 doppioni
per 54.498 € fra aprile e maggio. È esattamente il buco che questa feature
doveva chiudere, e la feature lo mancava. Aggiunta `loadCrmCandidates` (ricerca
mirata per telefono/email dei soli contratti del mese, con e senza prefisso) e
un terzo livello di lookup in `reconcile`.

**2. Fra lead con lo stesso numero vinceva l'ultimo letto dalla query.**
`indexCrm` teneva un solo record per chiave (`Map.set`). A luglio, sul contratto
di Maurizio Conti, agganciava il doppione «Sparito» — producendo un
`esito-mancante` che avrebbe scritto una **seconda chiusura da 3.180 €** — e
lasciava la chiusura vera scoperta come `solo-crm`, cioè candidata alla
cancellazione. Due errori opposti sullo stesso contratto, e l'esito dipendeva
dall'ordine di una query senza `ORDER BY`. Ora l'indice tiene liste e `pick()`
sceglie in ordine: la chiusura con l'importo del foglio, poi una chiusura
qualsiasi, poi il resto.

**3. Il guard su `salesAttempts` bloccava tutte le chiusure d'annata.**
`salesAttempts` esiste dal 02/07/2026: per ogni chiusura precedente la somma dei
tentativi è 0 per costruzione, non per un disallineamento. 15 righe di maggio già
quadrate (delta 0 €) risultavano «leads e salesAttempts non concordano: va sanato
prima». Il guard ora scatta solo se un tentativo esiste davvero
(`attemptsCount > 0`).

### Quadro dopo le correzioni

| Mese | Foglio | Scarto vs CRM | Famiglie |
|---|---|---|---|
| 2026-04 | 46 contratti, 105.293 € | 19.299 € | 9 scartato (18.009 €), 1 esito-mancante, 1 importo (bloccato: tutor non mappato), 1 assente, 1 solo-crm |
| 2026-05 | 101 contratti, 247.554 € | 43.696 € | 14 scartato (31.630 €), 7 esito-mancante (15.901 €), 2 solo-crm |
| 2026-06 | 25 contratti, 59.414 € | 300 € | 1 scartato |
| 2026-07 | 117 contratti, 268.290 € | 5.759 € | 3 scartato (5.259 €), 1 assente (500 €) |
| 2026-08 | 45 contratti, 115.592 € | 2.926 € | 1 esito-mancante (1.890 €), 3 importo (8.959 €) |

I due `lead-assente` rimasti (Alice Tamassia, Barbara Cemini) sono stati
verificati a mano: nel CRM non esiste nessun lead con quel contatto, la famiglia
è corretta. I `solo-crm` (Marianna Russo 1.890 €, Bruno Bulferi Bulferetti 945 €,
Antonella 2.890 €) sono chiusure presenti nel CRM e assenti dal foglio: tolgono
fatturato, restano non spuntate e vogliono un occhio umano.

Nessuna correzione è stata applicata: l'applicazione resta un gesto umano dalla
pagina `/riconciliazione`.
