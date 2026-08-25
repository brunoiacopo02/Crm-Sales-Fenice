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
| `calledAt` — parte la chiamata | click sul numero nella card (`LeadCard.tsx:258-260`), intercettato in fase di **cattura** su `window`; in subordine il bottone "Copia numero" (`LeadCard.tsx:278`) | **Tempo morto fra due chiamate**: dal salvataggio dell'esito precedente a questo |
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

**Come si intercetta l'inizio della chiamata.** I GDO chiamano cliccando
direttamente sul numero nella card: un'estensione del browser trasforma il numero
in un elemento cliccabile e passa la chiamata a MicroSIP. Quel click avviene
comunque dentro il DOM del CRM, quindi è intercettabile — a patto di ascoltarlo
nel punto giusto:

- listener registrato su `window` in **fase di cattura** (`capture: true`), cioè
  il primo anello della catena di propagazione. Arriva prima di qualunque
  gestore dell'estensione, anche se questa chiama `stopPropagation()`;
- il contenitore del numero nella card riceve un attributo `data-lead-phone`
  con l'id del lead, così il listener risale al lead dal bersaglio del click;
- l'estensione può sostituire o incapsulare il nodo di testo del numero: il
  listener non deve dipendere dall'identità del nodo cliccato, ma solo dal fatto
  che si trovi dentro un contenitore marcato (`closest('[data-lead-phone]')`);
- il click sul bottone "Copia numero" (`LeadCard.tsx:278`) vale come marker
  equivalente per chi usa quel flusso. Si prende il primo dei due che avviene.

**Copertura da verificare.** La percentuale di cicli con `calledAt` valorizzato è
l'indicatore di affidabilità della metrica principale, va misurata nel QA e
mostrata nella pagina. Chi digitasse il numero a mano sul softphone non produce
il marker. Se la copertura risultasse bassa, il fallback è usare `openedAt` come
inizio ciclo, accettando che il tempo morto misurato sia sottostimato.

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
- `calledAt`, `openedAt`, `savedAt` (timestamptz, nullable tranne `savedAt`)
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

- **Copertura del marker di inizio chiamata** (vedi sopra): è il rischio principale
  sull'affidabilità della metrica di punta.
- **Cicli sovrapposti**: un GDO che apre più schede insieme produce cicli
  intrecciati. Vanno rilevati e marcati, non silenziosamente sommati.
- **Ordine dei marker non garantito**: c'è chi apre la scheda dell'esito prima di
  cliccare il numero e chi fa il contrario. I segmenti vanno quindi calcolati
  ordinando i marker per orario, non assumendo la sequenza
  `calledAt` → `openedAt` → `savedAt`; un segmento negativo è un bug, non un dato.
- **Il DOM manipolato dall'estensione**: l'estensione che rende cliccabili i
  numeri modifica il DOM della pagina. Il listener non deve dipendere dal nodo
  esatto cliccato (vedi sezione 4), e il QA deve verificare il comportamento con
  l'estensione realmente installata, non solo su un browser pulito.
- **Attività fuori CRM**: chi lavora su WhatsApp o su un altro schermo risulta
  inattivo. È corretto rispetto all'obiettivo, ma va detto leggendo i numeri.
- **Fase 1 e fase 2 non sono confrontabili fra loro**: misurano cose diverse.
  La pagina deve distinguerle esplicitamente, non sommarle.

## 8. Verifica

- Test sulla funzione di classificazione dei buchi: è logica pura, riceve una
  giornata sintetica e deve classificarla correttamente in CERTO / PROBABILE /
  CONVERSAZIONE, tetto incluso.
- Test sul calcolo dei segmenti del ciclo, inclusi i casi degeneri: ciclo senza
  `calledAt`, ciclo abbandonato, cicli sovrapposti.
- Riconciliazione SQL: i totali della fase 1 devono ricadere sui numeri della
  sezione 2 di questo documento.
- QA nel browser sulla pagina riscritta, e verifica da account GDO che **nulla**
  sia cambiato di visibile a parte il nuovo volume minimo.

## 9. Il centralino: verifica di fattibilità in corso

In ufficio c'è un centralino raggiungibile solo dalla LAN su
`http://192.168.1.7/admin/config.php` — il percorso indica quasi certamente
**FreePBX** (interfaccia web di Asterisk), con un gateway GSM per le SIM e
MicroSIP come telefono sui PC.

Se espone i tabulati (CDR), diventano la fonte migliore in assoluto: orario di
inizio, numero chiamato, durata di conversazione effettiva (`billsec`) ed esito
tecnico di **ogni** chiamata. Conseguenze sul design:

- il tempo al telefono si misura invece di stimarlo: cadono il tetto
  conversazione, la durata anomala per tipo di esito e la classificazione
  CERTO / PROBABILE / CONVERSAZIONE della fase 1;
- il tempo morto fra due chiamate è la differenza fra la fine di una e l'inizio
  della successiva, al secondo;
- si vedono fatti che il CRM non può conoscere: chiamate senza esito registrato,
  esiti senza chiamata, chiamate a numeri non presenti nel CRM.

Il tracker CRM (fase 2) resterebbe utile per ciò che i tabulati non sanno —
quanto costa compilare un esito, i lead aperti e mai chiamati — ma smetterebbe
di essere il pezzo portante.

**Vincoli.** Il centralino è in LAN, il CRM è su Vercel: la connessione va fatta
in uscita, con un piccolo agente sul PC dell'ufficio che legge i tabulati e li
invia firmati al CRM (stesso schema HMAC già in uso per il bot fissatore).
Il pannello del centralino **non va esposto su internet** in nessun caso: i PBX
raggiungibili da fuori sono un bersaglio classico e le SIM sono aziendali.

**Verifica da fare in ufficio (sola lettura):**

1. Versione e conferma che sia FreePBX (visibile nell'intestazione del pannello).
2. `Reports → CDR Reports`: esiste? Da quale data partono i dati? Quante
   chiamate risultano in una giornata tipo?
3. Nella stessa pagina: c'è l'export in CSV?
4. `Applications → Extensions`: quanti interni esistono e con che numerazione —
   **serve la mappatura interno ↔ GDO**, senza la quale i tabulati non sono
   attribuibili alle persone.
5. Esiste un accesso SSH al box e le credenziali del database `asteriskcdrdb`?
   (Serve solo per automatizzare; per la verifica basta l'export CSV.)
6. Il box è sempre acceso e chi ne ha le credenziali di amministrazione?

Esito della verifica: se i punti 2 e 4 rispondono sì, il progetto si riorienta
sui tabulati prima di scrivere il tracker.

## 10. Fuori perimetro

- **Registrazioni delle chiamate**: analisi qualitativa, progetto a sé.
- Volume minimo personalizzato per GDO (oggi scelto unico per tutti).
