# Pipeline autonoma venditore — test su Sales 002 (Marco)

Data: 2026-09-21 · Stato: spec approvata dal PO, da pianificare

## 1. Perché

Oggi un venditore riceve solo lead caldi: li fissano i GDO (o il bot), li
confermano le Conferme, e solo allora arrivano in `/venditore`. Il test verifica
un'ipotesi diversa: **un venditore che si fissa gli appuntamenti da solo**
chiamando lead a freddo, e che se li mette direttamente in agenda saltando le
Conferme.

Il test gira su **un solo venditore** (Sales 002, Marco) e su **10 lead**: 5
freschi mai toccati da nessuno e 5 già lavorati e restituiti dal bot. Serve a
misurare la resa di un venditore sulle due diete, non a cambiare il processo
di nessun altro.

Vincolo che domina ogni scelta di questa spec: **il lancio Web Dev AI del 5
ottobre è in corso**. Nessuna modifica può toccare il suo percorso, e ogni
pezzo deve potersi spegnere senza deploy.

## 2. Decisioni del PO (2026-09-21)

1. Gli appuntamenti autofissati **restano separati in tutto**, ma **influenzano**
   il Pannello Sales Manager.
2. Contano per: **appuntamento fissato**, **chiusure**, **fatturato**. Contano
   come **presenza solo se il lead si presenta davvero**. **Non contano mai come
   conferma** — non esiste uno stadio Conferme in questo percorso.
3. Nel Pannello restano nella riga del **loro funnel reale** (spesa e ROAS di
   quel funnel restano onesti), con una colonna **"di cui autofissati"**.
4. Niente pulsante "Invia agenda": l'agenda la manda il venditore in autonomia.
5. I 5 ridati dal bot si prendono dal **GDO che ha più lead nuovi** in quel
   momento.
6. I 5 freschi si ottengono **dirottando i primi lead in arrivo da AC** a Marco,
   con tetto 5; superato il tetto, tutto torna a scorrere come oggi.
   **Rettifica del PO (21/09, dopo la prima stesura): il tetto e' GIORNALIERO, non
   complessivo.** "5 lead nuovi oggi... il limite giornaliero e' quello". Il conteggio
   si azzera a mezzanotte italiana, senza che nessuno debba rialzare il numero a mano
   ogni giorno.
7. Serve una **pagina per regolare** accensione, venditore e tetto.
8. Da `/lead-automatici` vanno tolte **tutte e tre** le sezioni di recupero
   import ("Lead non importati", "Bloccati da lista", "Telefoni da verificare").

## 3. Il perno: `confirmationsOutcome = 'autofissato'`

L'appuntamento autofissato nasce con la sentinella `'autofissato'` nella colonna
`leads.confirmationsOutcome`. **Non serve nessuna colonna nuova, nessuna
migration.**

Funziona perché nel CRM esistono due famiglie di lettori di quella colonna, e la
sentinella cade dalla parte giusta di entrambe:

| Famiglia | Esempi | Effetto della sentinella |
|---|---|---|
| "da lavorare dalle Conferme" = `IS NULL` | board Conferme `confermeActions.ts:79`, avviso bloccante richiami `confermeAlertActions.ts:82`, riepilogo azienda `companySummaryActions.ts:51` | **escluso in automatico**, zero righe da cambiare |
| "è una conferma" = `= 'confermato'` | `funnelStages.ts:64`, tutto `confermeKpiActions`, `gdoPerformanceActions.ts:163/453`, `achievementActions`, `databasePoolActions.ts:389` | **mai contato come conferma**, zero righe da cambiare |

La regola di conteggio chiesta dal PO coincide esattamente con ciò che
`stageHits()` (`src/lib/kpi/funnelStages.ts:57`) calcola già:

- `app` → vero, da `appointmentDate` + `apptSetAt()`
- `conferme` → richiede `=== 'confermato'`, quindi sempre falso
- `trattative` → dal latch `presentedAt`, che si scrive solo alla prima
  registrazione di Chiuso/Non chiuso: **la presenza conta solo se il lead si è
  presentato davvero**
- `close` / `fatturato` → da `salespersonOutcome='Chiuso'` + `closeAmountEur`

Non c'è niente da forzare: basta **non scrivere `'confermato'`**.

### Alternativa scartata

Una colonna booleana nuova (`salesSelfBooked`) più un `AND NOT flag` in ogni
query Conferme. Scartata: le superfici che definiscono "da lavorare" sono almeno
tre e crescono; dimenticarne una significa far comparire l'**overlay bloccante
dei richiami** a un operatore Conferme su un lead che non è suo. La sentinella
esclude tutto per costruzione.

### Campi lasciati a NULL di proposito

`confirmationsUserId` e `confirmationsTimestamp` **restano NULL**: nessuno del
team Conferme ha lavorato questo lead, e valorizzarli lo farebbe entrare in
query di attribuzione per-operatore. L'audit vive nell'evento `SALES_SELF_BOOKED`
e in `appointmentCreatedAt`.

### L'unica riga toccata in `confermeActions.ts`

Il bucket `storico` della board Conferme è `confirmationsOutcome IS NOT NULL`
(`confermeActions.ts:85`). Diventa `IS NOT NULL AND <> 'autofissato'`, così i
lead di Marco non compaiono nemmeno nello storico delle Conferme. È l'unica
modifica al codice Conferme prevista da questa spec.

## 4. Architettura

### 4.1 Configurazione e accensione

Config su `appSettings` (`schema.ts:1165`, tabella chiave-valore già usata per il
CPL — nessuna migration), chiave `sales_pipeline.config`, valore JSON:

    { "enabled": false, "salesUserId": "<uuid Sales 002>", "freshCap": 5 }

`enabled: false` è lo stato di partenza e il rollback: spegnerlo ferma
all'istante il dirottamento e nasconde la pipeline, senza deploy.

Il **contatore dei freschi dirottati non viene memorizzato**: si conta dagli
eventi `SALES_PIPELINE_ASSIGNED` con `metadata.source = 'fresh'`. Un contatore
salvato prima o poi si scolla dalla realtà; una `count(*)` no.

### 4.2 Pagina di regolazione — `/pipeline-venditore`

Solo ADMIN/MANAGER. Contiene:

- interruttore acceso/spento, selettore del venditore, tetto lead freschi
- contatore in chiaro: freschi dirottati / tetto, ridati assegnati
- pulsante "Assegna N ridati dal GDO più carico"
- elenco dei lead in pipeline con stato, tentativi e esito

### 4.3 Superficie di lavoro — `/mia-pipeline`

Board a tre colonne (1ª/2ª/3ª chiamata) più i richiami, con la stessa forma di
quella GDO. Visibile solo al venditore configurato (più ADMIN/MANAGER in sola
lettura).

Si riusa `getPipelineLeads()` (`pipelineActions.ts:56`) estendendo il ramo
`isGdo` a "GDO **oppure** venditore con pipeline attiva": stesso filtro
`assignedToId = userId`, stesse esclusioni (`status != REJECTED`,
`status != APPOINTMENT`, `recallDate IS NULL`, `callCount < 3`), stesso
ordinamento con `leads.id` come tiebreaker.

Differenze volute rispetto a `/venditore`:

- **il telefono è visibile subito** (sta chiamando a freddo; in `/venditore` è
  nascosto fino al check-in di trattativa, `venditoreActions.ts:104-113`)
- **niente pulsante "Invia agenda"** (decisione PO)
- **niente 4ª chiamata di recupero**: è una leva tarata sui GDO

### 4.4 Il fissaggio — `setSalesSelfAppointment(leadId, version, at, note)`

Modellata su `bookLancio()` (`src/lib/lancio/booking.ts:216-241`), che è già il
precedente esatto: appuntamento che nasce senza passare dalle Conferme.

Autorizzazione: ruolo VENDITORE, pipeline accesa, `lead.assignedToId` = sé
stesso, lock ottimistico su `version`.

**Lock.** `pg_advisory_xact_lock` sullo slot (namespace `sales-self:<slotKey>`,
seed 4 — 3 è del lancio): impedisce che una Conferma gli assegni un lead sullo
stesso slot nello stesso istante. Oggi **non esiste nessuna prenotazione
atomica** nel CRM: due scritture simultanee sullo stesso slot passano entrambe e
il doppio booking si scopre solo alla lettura dopo. Qui non ce lo possiamo
permettere, perché a valle parte un invito vero a un cliente vero.

**Muro del fissaggio.** Si riusa `bookingCheck()`
(`src/lib/venditore/calendarBooking.ts:36`) con una sola differenza:

| Rifiuto | Comportamento |
|---|---|
| `gia_occupato` | **blocco secco** |
| `bloccato` | **blocco secco** |
| `fuori_griglia` | **blocco secco** |
| `non_dichiarato` | **permesso** — è il suo calendario, e non lo mando a compilare la griglia mentre ha il cliente al telefono |

**Guardia anti-doppio-fissaggio.** Se il lead ha già `appointmentDate` e una riga
in `calendarEvents`, l'azione è un no-op che ritorna l'appuntamento esistente.
È il difetto noto di `updateLeadOutcome` (nessuna guardia sul rifissaggio, il
bot ce l'ha in `api/bot/outcome/route.ts:235-265`, l'UI GDO no): qui due clic
significherebbero **due eventi Google Calendar e due inviti al cliente**.

**Scritture sul lead**, in transazione:

    status                   = 'APPOINTMENT'
    appointmentDate          = at
    appointmentCreatedAt     = now
    appointmentNote          = note
    callCount                = callCount + 1
    lastCallDate             = now
    recallDate/Note/MissedAt = null
    confirmationsOutcome     = 'autofissato'    -- il perno
    confirmationsUserId      = null
    confirmationsTimestamp   = null
    salespersonUserId        = <Marco>          -- occupa lo slot (occupazione derivata)
    salespersonAssigned      = <nome>
    salespersonAssignedAt    = now
    version                  = version + 1

Più: una riga `callLogs` con `outcome='APPUNTAMENTO'`, e due `leadEvents`,
`APPOINTMENT_SET` e `SALES_SELF_BOOKED`.

**Effetti collaterali in `after()`** (fuori dalla risposta HTTP, come il lancio):

- `createGoogleCalendarEvent()` (`googleCalendar.ts:180`) → evento sul Google di
  Marco, **Meet generato** (`conferenceData` + retry via patch) e **invito mail
  al cliente** (`sendUpdates: 'all'`, attendee = email del lead). Errori solo
  loggati, mai bloccanti — come oggi.
- webhook marketing **`appointment.set`** e **`deal.assigned`**.
  **NON** `appointment.outcome`: non c'è nessun esito Conferme da comunicare, e
  mandarlo farebbe contare una conferma a valle. *Da confermare col receiver
  crm-marketing prima di accendere.*
- **NESSUN `notifyAppointmentToBot`**: nessuna agenda automatica parte. È la
  decisione del PO, ed è anche l'unico modo di non far scrivere il bot su
  WhatsApp a un lead che Marco sta gestendo a voce.

**Spostamento appuntamento.** Se Marco sposta un suo autofissato, si cancella e
si ricrea l'evento Google (pattern già in uso, `confermeActions.ts:1598` e
`:1608`), così il cliente riceve l'aggiornamento.

### 4.5 Gli altri tre esiti

Da scartare (con motivo), Non risposto, Richiamo (con data) riusano
`updateLeadOutcome()` così com'è, passando un contesto che spegne due cose:

- **gamification** (`awardXpAndCoins`, chest, boss, duelli): Marco è un
  venditore, non deve entrare nell'economia dei GDO
- **`notifyCallAttemptToBot`**: il bot non c'entra più con questi lead

È lo stesso seam che usa già il bot (`serviceCtx`), non una riscrittura della
funzione. Restano attivi auto-scarto al 3° tentativo vuoto e lock ottimistico.

### 4.6 Pannello Sales Manager

`getCrmFunnelCounts()` (`panoramicaActions.ts:894`) accumula, accanto ai totali
per funnel, uno `StageCounts` parallelo alimentato solo dai lead con
`confirmationsOutcome = 'autofissato'`. La tabella mostra il **"di cui
autofissati"** su App, Trattative, Chiusure e Fatturato; sotto Conferme la
colonna resta vuota per costruzione.

Il lead **non viene spostato di funnel**: la spesa pubblicitaria resta dov'è, e
il ROAS del funnel resta leggibile.

### 4.7 Alimentazione dei lead

**I 5 ridati dal bot.** Azione admin: individua il GDO più carico — dove "lead
nuovi" significa `assignedToId = quel GDO AND callCount = 0 AND status NOT IN
('REJECTED','APPOINTMENT')` — fra i suoi lead pesca quelli con evento
`REASSIGNED_FROM_BOT`, ne sposta 5 a Marco. Se quel GDO non ne ha 5, si prosegue
col secondo più carico, e così via finché non se ne trovano 5.
Ogni spostamento scrive `SALES_PIPELINE_ASSIGNED` con
`metadata.source = 'bot_return'` e `assignedAt` resta latchato
(`COALESCE`, come tutte le riassegnazioni).

**I 5 freschi.** Un passo di dirottamento **in testa** al routing del webhook AC
(`src/app/api/webhooks/activecampaign/route.ts`), prima della logica esistente:

    se pipeline accesa
       e il lead è fresco (non lancio, non quarantena)
       e i freschi già dirottati < freshCap
    allora → assignedToId = Marco, evento SALES_PIPELINE_ASSIGNED(source='fresh')
    altrimenti → il routing di oggi, invariato

Guardie non negoziabili:

- i lead del **lancio Web Dev** (`launchBucket = 'LANCIO_WEBDEV_2026'`) non
  vengono **mai** dirottati
- i lead con telefono implausibile restano in **quarantena** come oggi
- **advisory lock** sul conteggio: due webhook nello stesso istante non possono
  far diventare 6 il tetto di 5
- a tetto raggiunto il passo è un `return` immediato: **costo zero** sul percorso
  normale

### 4.8 Pulizia `/lead-automatici`

Via dalla pagina tutte e tre le sezioni: "Lead non importati", "Bloccati da
lista", "Telefoni da verificare". Spariscono anche le chiamate
`listAcFailures()` e `listQuarantinedLeads()` dal caricamento della pagina
(`lead-automatici/page.tsx:15-22`), quindi la pagina diventa anche più leggera.

**Il meccanismo lato server resta intatto**: i lead continuano a essere messi in
quarantena, i failure continuano a essere registrati e le azioni di recupero
continuano a esistere. Si smette solo di mostrarli. Il PO li guarderà per conto
proprio.

## 5. Cosa NON si tocca

Bot e suo contratto · routing AC esistente (solo un passo davanti, che a tetto
raggiunto non fa nulla) · lancio Web Dev · middleware · dashboard e KPI Conferme
(una riga sola, il bucket storico) · KPI GDO, che si escludono da soli perché
filtrano `users.role = 'GDO'` · calendario disponibilità e sue multe ·
gamification.

## 6. Rischi e guardie

| Rischio | Guardia |
|---|---|
| Doppio invito Google al cliente | guardia anti-doppio-fissaggio + `calendarEvents` |
| Doppia prenotazione sullo stesso slot | advisory lock sullo slot |
| Il dirottamento mangia lead del lancio | esclusione esplicita su `launchBucket` |
| Il tetto sfora per corsa fra webhook | advisory lock sul conteggio |
| Un autofissato finisce alle Conferme | la sentinella lo esclude per costruzione |
| Marco entra nei KPI dei GDO | tutte le query GDO filtrano `role='GDO'`; **da riverificare su `callLogs`**, che riceve righe con `userId` = Marco |
| Il bot scrive a un lead di Marco | nessuna notifica al bot da questo percorso |

## 7. Rollback

1. `sales_pipeline.config.enabled = false` dalla pagina → dirottamento fermo,
   pipeline nascosta, **nessun deploy**.
2. I lead già in pipeline restano assegnati a Marco: si riassegnano con gli
   strumenti esistenti.
3. Gli appuntamenti già autofissati restano validi e continuano a contare come
   descritto: la sentinella non va rimossa a posteriori.

## 8. Verifica prima di accendere

- un autofissato **non** compare nella board Conferme, né nell'avviso bloccante
  dei richiami, né nello storico Conferme
- il Pannello Sales Manager conta +1 App e +1 "di cui autofissati"; **conferme
  invariate**
- alla registrazione di Chiuso/Non chiuso: +1 trattativa (dal latch
  `presentedAt`), e se Chiuso +1 chiusura e fatturato
- l'evento Google esiste sul calendario di Marco, **ha il link Meet**, e il
  cliente ha ricevuto l'invito
- i KPI GDO del giorno prima non cambiano di una riga
- a tetto raggiunto, un lead fresco AC segue il routing di sempre
