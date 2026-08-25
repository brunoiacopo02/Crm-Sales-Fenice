# Produttività GDO: tempo morto, volume reale, qualità appuntamenti

Data: 2026-08-25
Stato: design approvato in brainstorming, in attesa di piano di implementazione

## 1. Il problema

Da giugno 2026 i GDO hanno "libero arbitrio" sulle pause: 30 minuti al giorno,
ma senza più premere il pulsante del timer e senza sorveglianza. I dati lo
confermano — le pause registrate sono crollate da 795 (maggio) a 108 (giugno),
5 (luglio), zero (agosto). Il monitor pause esistente misura una cosa che non
succede più.

Restano tre domande senza risposta:

1. Quanto tempo di pausa si prendono davvero, ora che nessuno li guarda?
2. Quanto tempo si perde **tra una chiamata e l'altra** (note, scelta del lead,
   esitazione)? Recuperare 2 minuti a testa all'ora su 10 persone significa
   2 ore di squadra al giorno.
3. Il volume minimo di chiamate è fermo a un numero inventato: va ritarato sul
   comportamento reale, e affiancato dalla qualità degli appuntamenti prodotti.

Vincolo dichiarato dal committente: **i GDO non devono saperlo**, per ora.
Nessuna UI, nessuna comunicazione, nessun intervento sui loro computer.

## 2. Cosa dicono già i dati (agosto 2026, misurato in fase di design)

- Turno reale 13:00–19:30, finestra media prima→ultima chiamata 5,6–6,0 ore.
- Volume: media 163 chiamate/giorno, mediana 155, quartile lento 117, massimo 368.
  In crescita da giugno (136) e luglio (151): il libero arbitrio **non** ha ridotto
  il volume.
- Buchi oltre i 10 minuti fra un esito e l'altro: 407 ore su 143 giornate-uomo,
  cioè ~2,8 h al giorno per GDO. Ma vanno letti:
  - 242 ore finiscono con esito `APPUNTAMENTO` (durata media 21 min) → conversazioni vere;
  - 88 ore finiscono con `NON_RISPOSTO` → nessuno ha risposto, quindi tempo morto
    quasi certo: ~37 min/giorno per GDO;
  - 77 ore finiscono con scarto o richiamo → misto.
- Spread enorme fra persone a parità di turno: GDO 118 fa 241 chiamate/giorno con
  96 min di buchi; GDO 119 ne fa 96 con 218 min di buchi.

Questi numeri sono la baseline contro cui verificare l'implementazione.

## 3. Obiettivi e non obiettivi

**Obiettivi**
- Misurare il tempo morto **fuori** dalla lavorazione di un lead, cioè quello che
  non può essere una conversazione.
- Ricostruire il budget del tempo di una giornata GDO abbastanza fine da vedere i
  minuti piccoli (post-chiamata, scelta del lead) e poterli ottimizzare.
- Sostituire il volume minimo hardcoded con un parametro tarato sui dati.
- Misurare la qualità degli appuntamenti fino all'euro, per GDO.
- Non essere visibile né percepibile dai GDO.

**Non obiettivi**
- Non si giudica il tempo passato *dentro* la lavorazione di un lead: lì dentro
  può esserci una telefonata e non abbiamo modo di smentirlo.
- Non si sorveglia l'attività fuori dal CRM.
- Nessuna sanzione automatica, nessuna notifica, nessuna gamification collegata.

## 4. Architettura

### Fase 1 — Analisi retroattiva (nessun dato nuovo)

Un modulo di analisi ricostruisce le giornate passate dai `callLogs` esistenti,
sfruttando l'indice `calllogs_user_created_at_idx`. Consegna lo storico di
giugno–agosto il giorno stesso del rilascio.

Per ogni giornata di ogni GDO: finestra di turno, numero di chiamate, e i buchi
sopra soglia classificati **in base all'esito che chiude il buco**:

| Esito che chiude il buco | Classe | Motivo |
|---|---|---|
| `NON_RISPOSTO` | CERTO | Nessuno ha risposto: non stava parlando con nessuno |
| `DA_SCARTARE`, `RICHIAMO` | PROBABILE | Parte è conversazione; si scomputa una durata plausibile, l'eccesso resta morto |
| `APPUNTAMENTO` | CONVERSAZIONE | Ha parlato e fissato — ma solo fino a un tetto; l'eccesso torna PROBABILE |

Il tetto impedisce che "fisso alle 14 e sparisco fino alle 15" venga assorbito
come conversazione.

**Limite strutturale, da dichiarare nella UI**: i `callLogs` hanno un solo
timestamp per chiamata (il salvataggio dell'esito). Il buco fra due esiti contiene
appiccicati insieme post-lavorazione, scelta del lead, squilli e conversazione.
Per questo la fase 1 è attendibile **solo sui buchi grandi** e non può rispondere
alla domanda sui minuti piccoli. Quella è la fase 2.

### Fase 2 — Tracker del ciclo di lavorazione

Il CRM registra il ciclo con cui un GDO lavora un lead, usando marker che
esistono già nell'interfaccia:

| Marker | Aggancio nel codice | Segmento che chiude |
|---|---|---|
| `copiedAt` — copia il numero | `LeadCard.tsx:278` (bottone "Copia numero") | **Tempo morto fra due chiamate**: dal salvataggio dell'esito precedente a questo |
| `openedAt` — apre la scheda esito | `PipelineBoard.tsx:190` (`onOutcomeClick` → `setSelectedLeadId`) | Durata del tentativo: squilli + conversazione |
| `savedAt` — salva l'esito | `pipelineActions.ts:361` (insert su `callLogs`) | Compilazione dell'esito e delle note |
| `idleSeconds` — secondi senza input nel ciclo | listener su mouse/tastiera/scroll/visibilità | Indicatore informativo, **mai** usato come prova a carico |

Il **tempo morto fra due chiamate** è il numero centrale del progetto: in quella
finestra non c'è nessuna scheda aperta, quindi non può esserci una conversazione
col lead. È giudicabile senza soglie e senza falsi positivi.

Il tempo **dentro** il ciclo non viene mai classificato come pausa. L'unica
contromisura contro il "tengo la scheda aperta e non faccio niente" è il
confronto della durata del ciclo con la mediana del suo tipo di esito: un
`NON_RISPOSTO` che richiede 25 minuti non è una conversazione, perché nessuno ha
risposto. Il segnale "finestra del CRM in primo piano" **non** è utilizzabile a
carico, perché i GDO chiamano da MicroSIP sullo stesso PC e il softphone prende
legittimamente il primo piano; resta valido solo come prova a discarico
(se c'è attività, è certamente presente).

**Costo di scrittura.** Una riga per ciclo, non un evento per marker. Il client
tiene i tempi in memoria e li spedisce insieme al salvataggio dell'esito,
agganciandosi a una scrittura che avviene comunque. Stima: ~1.900 righe al
giorno per l'intera squadra. Un flush periodico copre i cicli abbandonati
(scheda aperta e mai esitata) e la chiusura del turno. Retention 90 giorni via
pg_cron, come già fatto per `pipelineSnapshots` — vincolo dovuto ai due alert
Disk IO Budget già ricevuti da Supabase.

**Copertura del marker "copia numero".** Un GDO che digita il numero a mano
invece di copiarlo non produce `copiedAt`. La copertura va misurata nel QA
(percentuale di cicli con `copiedAt` valorizzato) e mostrata nella pagina, perché
determina l'affidabilità della metrica principale. Se risultasse bassa, il
fallback è usare `openedAt` come inizio ciclo, accettando che il tempo morto
misurato sia sottostimato.

### Fase 3 — La pagina `/monitor-pause` riscritta

Stesso indirizzo e stessi permessi di oggi (ADMIN / MANAGER / TL), perché è una
voce di menu che esiste già e non insospettisce nessuno. Quattro schede:

1. **Tempo morto** — per GDO e per giorno/settimana/mese: finestra di turno,
   minuti certi / probabili / in conversazione, percentuale di tempo attivo, e
   (dalla fase 2) secondi medi persi fra una chiamata e l'altra, per ora del giorno.
2. **Volume** — chiamate/giorno contro il minimo, andamento, confronto fra pari.
3. **Qualità appuntamenti** — la cascata fissati → % presenziati → % chiusi →
   fatturato → € per appuntamento fissato, appoggiata alle definizioni `canon`
   già in uso (`presentedAt`, `outcomeAt`) per non introdurre l'ennesima
   definizione divergente.
4. **Pause col bottone** — lo storico attuale, invariato.

### Parametri

Spostati in `appSettings` (tabella globale già usata per il CPL in
`managerAdvancedActions.ts`) ed editabili dalla strip Parametri Manager
(`panoramica-generale/ManagerParamsStrip.tsx`), senza toccare il codice:

| Parametro | Default | Note |
|---|---|---|
| Volume minimo chiamate/giorno | **140** | Sostituisce il `90` hardcoded in `gdoPerformanceActions.ts:591`. Unico per tutti |
| Soglia buco fase 1 | 10 min | Sotto questa soglia il dato retroattivo non è interpretabile |
| Tetto conversazione | 25 min | Le call che portano appuntamento durano in media 21 min |
| Soglia "fermo" nel ciclo | 60 s | Solo contatore informativo, mai usato come accusa |

Il volume minimo è l'unico parametro visibile ai GDO: sostituisce il 90 nella
loro dashboard obiettivi (`GdoDailyObjectives.tsx`). È un cambiamento
giustificabile in sé e non rivela nulla del tracker.

## 5. Modello dati

Nuova tabella `workCycles` (una riga per lead lavorato):

- `id`, `companyId`, `userId`, `leadId`
- `copiedAt`, `openedAt`, `savedAt` (timestamptz, nullable tranne `savedAt`)
- `idleSeconds`, `activeSeconds` (integer)
- `outcome` (denormalizzato dal callLog, per il confronto con la mediana di tipo)
- `callLogId` (nullable, per i cicli abbandonati)
- `dateLocal` (text, giornata Europe/Rome, come `breakSessions`)
- indice su (`companyId`, `userId`, `dateLocal`)

Nessuna modifica distruttiva alle tabelle esistenti. `presenceHeartbeats` viene
esteso ai GDO per lo stato "CRM aperto" — è un upsert per utente, non cresce.

Migrazione scritta a mano: `drizzle-kit generate` è inutilizzabile su questo
progetto (vedi memoria admin-review-fixes-luglio).

## 6. Visibilità e conformità

Il tracker è invisibile: nessuna UI, nessuna voce di menu, nessuna notifica.
La chiamata di rete riusa la forma dell'heartbeat che il CRM già invia per il
Radar Conferme, quindi non spicca nemmeno ispezionando il traffico.

Nota consegnata al committente in fase di design e da lui presa in carico: in
Italia il controllo a distanza dell'attività dei lavoratori (art. 4 Statuto dei
Lavoratori) richiede di norma un'informativa. La decisione è del committente;
se in futuro si vorrà rendere trasparente lo strumento, basta accendere una
vista lato GDO — il modello dati non cambia.

## 7. Rischi e limiti

- **Copertura del marker "copia numero"** (vedi sopra): è il rischio principale
  sull'affidabilità della metrica di punta.
- **Cicli sovrapposti**: un GDO che apre più schede insieme produce cicli
  intrecciati. Vanno rilevati e marcati, non silenziosamente sommati.
- **Ordine invertito**: chi chiama prima e apre la scheda dopo produce cicli
  brevissimi e tempi morti gonfiati. Da verificare nel QA osservando la
  distribuzione delle durate.
- **Attività fuori CRM**: chi lavora su WhatsApp o su un altro schermo risulta
  inattivo. È corretto rispetto all'obiettivo, ma va detto leggendo i numeri.
- **Fase 1 e fase 2 non sono confrontabili fra loro**: misurano cose diverse.
  La pagina deve distinguerle esplicitamente, non sommarle.

## 8. Verifica

- Test sulla funzione di classificazione dei buchi: è logica pura, riceve una
  giornata sintetica e deve classificarla correttamente in CERTO / PROBABILE /
  CONVERSAZIONE, tetto incluso.
- Test sul calcolo dei segmenti del ciclo, inclusi i casi degeneri: ciclo senza
  `copiedAt`, ciclo abbandonato, cicli sovrapposti.
- Riconciliazione SQL: i totali della fase 1 devono ricadere sui numeri della
  sezione 2 di questo documento.
- QA nel browser sulla pagina riscritta, e verifica da account GDO che **nulla**
  sia cambiato di visibile a parte il nuovo volume minimo.

## 9. Fuori perimetro (possibili estensioni)

- **Tabulati del centralino VoIP dietro MicroSIP**: darebbero durata e orario
  reali di ogni telefonata, trasformando ogni stima in misura. Richiede accesso
  al pannello del provider.
- **Registrazioni delle chiamate**: analisi qualitativa, progetto a sé.
- Volume minimo personalizzato per GDO (oggi scelto unico per tutti).
