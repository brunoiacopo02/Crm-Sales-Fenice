# Le sette richieste del fornitore bot — 29/08/2026

Risposta operativa al messaggio del fornitore del 29/08/2026. Sette richieste,
di cui quattro sono codice e tre sono decisioni o indagini. Questo documento
fissa cosa facciamo, cosa non facciamo, e perché.

Il filo che le tiene insieme: oggi il CRM e il bot si parlano in una direzione
sola. Noi gli mandiamo lead e lui ci manda esiti, ma nessuno dei due sa cosa
succede dopo dall'altra parte. Le richieste 1, 2 e 3 chiudono tre anelli aperti;
le altre quattro sono debiti che si sono accumulati sul confine fra i due
sistemi.

## Contesto: cosa esiste già

Va detto prima, perché metà del lavoro apparente non è lavoro.

- **Le notifiche alle Conferme sono già realtime.** `/api/bot/outcome:428-437`
  notifica tutte le Conferme attive quando arriva un `CONTATTO_UMANO` su un lead
  `APPOINTMENT`, e `useRealtimeNotifications` alimenta la campanella del Topbar
  con il pallino rosso per ogni ruolo. La diagnosi del fornitore — «le 48
  richieste sono ferme perché la notifica compare solo nel riepilogo del giorno
  dopo» — è sbagliata. Sono ferme perché `/richieste-contatto` è ADMIN-only:
  le Conferme ricevono l'avviso, lo cliccano, e non hanno una pagina dove
  atterrare.
- **Il gancio per il messaggio di recupero NR era già stato lasciato apposta.**
  `ConfermeDrawer.tsx:489-494` documenta la rimozione dei due bottoni «Notifica
  1° NR» / «Notifica 3 NR» il 2026-08-06, con la nota che `sendConfermeNotifyToLead`
  «resta in piedi: sarà il punto di aggancio quando i messaggi passeranno dal
  bot». È esattamente questo momento. L'unica differenza rispetto ad allora è
  che il trigger diventa automatico anziché un bottone.
- **`phoneSuspicious` esiste già** ed è calcolato su tutti e tre gli intake
  (webhook AC, launch pool, database pool). Manca solo l'effetto.
- **La coda `botContactRequests` esiste** (migrazione 0030) con
  `assignedToId`/`assignedAt` già pronti. Mancano solo le colonne dell'esito.

## 1. Recupero NR: `POST /api/bot/call-attempt`

Lo scarto per «3 NR consecutivi» vale il 42% degli appuntamenti fissati dal bot
e il 44% di quelli fissati dai GDO: ~1.288 appuntamenti persi dal 24 giugno. Sui
lead passati dal bot c'è una chat WhatsApp già aperta, e quando la Conferma non
riesce a parlargli al telefono il bot glielo scrive lì.

### Aggancio

Un punto solo: `recordConfermeNoAnswer` (`src/app/actions/confermeActions.ts:904`).
È già l'unico passaggio comune fra la board (`ConfermeBoardRow.tsx:93`) e il
drawer (`ConfermeDrawer.tsx:350`), e sa già distinguere il tentativo perché
scrive `confCall1At` / `confCall2At` / `confCall3At` in cascata.

- scrive `confCall1At` → `tentativo: 1`
- scrive `confCall2At` → **niente** (il fornitore accetta solo 1 e 3)
- scrive `confCall3At` → `tentativo: 3`

Il ramo «stato impossibile» già presente nella funzione (3 NR registrati ma
outcome ancora nullo, lead in transizione dal vecchio sistema a 4 tentativi)
**non** manda niente: non stiamo registrando un tentativo nuovo, stiamo
sanando uno stato incoerente.

### Client

Nuova funzione `notifyCallAttemptToBot()` in `src/lib/agendaBot.ts`, accanto a
`notifyAppointmentToBot` di cui ricalca la forma: stesso `BOT_WEBHOOK_SECRET`,
stesso header `x-bot-signature` via `signPayload`, stesso `protocolError` per i
log. Nessun segreto nuovo, nessun file nuovo.

```
POST https://web-app-messaggistica.vercel.app/api/bot/call-attempt
{ leadId, esito: "no_answer", tentativo: 1|3, at, appointmentAt }
```

- `at` — istante del click, ISO Roma via `toRomeIso` (già esistente).
- `appointmentAt` — da `oldLead.appointmentDate`, ISO Roma. È il campo che
  secondo il fornitore fa la differenza fra un messaggio che cita giorno e ora
  e uno generico; lo rifiutano se è nel passato.
- URL da env `CALL_ATTEMPT_BOT_URL` con default hardcoded, come gli altri due.

### Non blocca l'operatore

La chiamata HTTP parte dentro `after()` di `next/server` — la stessa primitiva
con cui `enqueueMarketingWebhook` (`src/lib/marketing-webhooks/enqueue.ts:119`)
consegna i webhook marketing. La scrittura DB e il ritorno alla UI avvengono
subito; l'HTTP prosegue dopo la risposta senza che Vercel congeli la funzione.

Questo non è un dettaglio di performance: una Conferma clicca NR di corsa su una
board, e un'attesa di 4-6 secondi per click renderebbe la feature odiata prima
ancora che utile.

### Perimetro e interruttore

- Solo `companyId === 'fenice'`. Serenamente ha il suo canale Twilio diretto.
- Kill-switch **dedicato**: `BOT_CALL_ATTEMPT=off`. Deliberatamente **non**
  riuso `AGENDA_CHANNEL`: il recupero serve anche sugli appuntamenti fissati dai
  GDO (44% degli scarti 3NR), che hanno una chat aperta col bot solo perché
  l'agenda passa da lì. Voglio poterli spegnere separatamente.
- Nessun altro filtro. Il fornitore dice «chiamateci pure sempre, filtriamo
  noi» ed elenca sette guardie sue. Duplicarle qui significherebbe due copie
  della stessa regola che divergono al primo cambio da parte loro.

### Misura

Evento `BOT_CALL_ATTEMPT` in `leadEvents`, metadata `{ tentativo, inviato,
ramo, motivo }` presi dalla loro risposta. Senza questo non sapremmo mai se il
recupero funziona — ed è esattamente il rimprovero che loro fanno a noi al
punto 3. Volume trascurabile (poche centinaia di NR al giorno al massimo),
irrilevante rispetto all'allerta Disk IO del 27/06.

### La conseguenza sul 3° tentativo

Al 3° NR il CRM **scarta già** il lead: `confirmationsOutcome = 'scartato'`,
causale «3 NR consecutivi», e parte il webhook marketing `lead.rejected`. Il
messaggio del bot dirà al lead che senza risposta l'appuntamento verrà
annullato — coerente con quello che è appena successo da noi.

**Decisione PO (29/08): riapertura manuale.** Se il lead risponde, il bot ci
segnala `CONTATTO_UMANO`, la richiesta finisce in corsia Conferme (punto 2) e
sono loro a decidere se riaprire con «Annulla NR» (`undoConfermeNoAnswer`, già
esistente). Nessuna automazione tocca uno scarto già registrato: il webhook
`lead.rejected` è già partito verso marketing e i KPI di conferma sono già
contati. Un lead che esce e rientra dalle statistiche per conto suo è il modo
più rapido per rendere i numeri inaffidabili.

Ne segue che **il punto 1 senza il punto 2 recupera lead che poi nessuno
riprende**. Vanno rilasciati insieme.

## 2. La corsia Conferme sulla coda dei contatti umani

Il fornitore chiede una sezione nei profili Conferme, con notifica realtime e
pallino rosso. Metà è già viva (vedi Contesto). Quello che manca è la pagina.

### Corsia derivata, non una colonna

`lead.status === 'APPOINTMENT'` → corsia **Conferme**; tutto il resto → corsia
**GDO/admin**. Derivata e non memorizzata di proposito: un lead che passa ad
`APPOINTMENT` cambia corsia da solo, e non esiste uno stato da tenere allineato.

Sono le 14 richieste su 64 (22%) che oggi finiscono in coda per un GDO quando
la competenza è delle Conferme.

### Cambi

- `getContactRequests` (`src/app/actions/contactRequestActions.ts:69`) diventa
  role-aware al posto di `requireAdmin()`: ADMIN vede tutto, CONFERME vede solo
  la propria corsia. Il doppio controllo pagina + action resta.
- La pagina `/richieste-contatto` (`page.tsx`) apre alle Conferme con la vista
  filtrata.
- Voce in `Sidebar.tsx:175` per CONFERME, con contatore delle pending in corsia.
- **Le Conferme non assegnano a un GDO.** `assignContactRequest` resta
  ADMIN-only: spostare l'assegnatario cambia l'attribuzione dei KPI, e non è il
  loro mestiere. Due azioni nuove al suo posto:
  - `takeChargeContactRequest(requestId)` → `status: 'assigned'`,
    `assignedToId` = chi ha cliccato, `assignedAt` = adesso.
  - `resolveContactRequest(requestId, esito, nota)` → `status: 'closed'` +
    le colonne del punto 3.

### Esiti

Il vocabolario è quello che il fornitore legge, così non serve tradurre ai due
capi: `chiamato_ok`, `non_raggiungibile`, `rifissato`, `disdetto`,
`non_gestito`.

## 3. Il ritorno: cosa fine fa ogni richiesta

Oggi il fornitore consegna la richiesta e finisce lì. Il bot resta zitto su
quella chat all'infinito anche quando il caso è chiuso da settimane, e nessuno
dei due può dire se la sezione funziona.

### Il problema che la loro proposta non vede

Il fornitore propone di aggiungere un blocco alle righe di `/api/bot/lead-status`,
che leggono ogni 30 minuti. Giusto come idea, ma **così com'è non funzionerebbe**:
quell'endpoint pagina su `leads.updatedAt` (`route.ts:93`), e prendere in carico
una richiesta non tocca il lead. Le righe non uscirebbero mai, e loro vedrebbero
silenzio credendo che non le lavoriamo — cioè esattamente il problema che
volevamo chiudere, con in più la convinzione di averlo chiuso.

### Tre strade

| | Come | Verdetto |
|---|---|---|
| **A** | Ogni mutazione su una richiesta tocca anche `leads.updatedAt` | **Scelta.** Una riga per mutazione, zero rischio sul contratto live, volume trascurabile (~64 richieste da luglio). Semanticamente onesta: dal punto di vista del bot qualcosa su quel lead è davvero cambiato. |
| B | Cursore su `GREATEST(leads.updatedAt, botContactRequests.updatedAt)` | Più «corretto», ma cambia la semantica di `nextSince` su un contratto in produzione da settimane. Rischio sproporzionato al beneficio. |
| C | Endpoint separato | Escluso dal fornitore stesso: «nessun endpoint nuovo, nessun segreto nuovo». |

### Migrazione 0031

A mano: `drizzle-kit generate` è inutilizzabile su questo progetto (verificato
2026-07-07). Tre colonne su `botContactRequests`:

- `outcome` text nullable
- `outcomeAt` timestamptz nullable
- `note` text nullable

`presoInCaricoDa` / `presoInCaricoIl` si mappano su `assignedToId` /
`assignedAt` **che esistono già**. Nessuna colonna doppia: due campi che dicono
la stessa cosa divergono al primo percorso che ne aggiorna uno solo.

### Payload

Blocco `contattoUmano` sulle righe di `lead-status`, in LEFT JOIN sulla
richiesta più recente per lead, `null` per i lead che non ne hanno mai avuta:

```json
"contattoUmano": {
  "presoInCaricoDa": "Nome Operatore | null",
  "presoInCaricoIl": "2026-08-29T10:12:00+02:00",
  "esito": "chiamato_ok | non_raggiungibile | rifissato | disdetto | non_gestito",
  "esitoIl": "2026-08-29T11:03:00+02:00",
  "nota": "testo libero, opzionale"
}
```

Il filtro `workedByBot` esistente non va toccato: un lead con una richiesta di
contatto è per definizione un lead che il bot ha lavorato.

Le 48 richieste ferme arretrate escono da sole man mano che vengono lavorate,
perché il cursore è a scorrimento.

## 4. I telefoni inventati

`phoneSuspicious` è già calcolato ovunque (`webhooks/activecampaign/route.ts:517`,
`databasePoolActions.ts:266`, `launchPoolActions.ts:365`) e mostrato come badge
in `LeadCard`. Oggi però quei lead vengono assegnati normalmente e bruciano il
tempo di un GDO su un numero che non esiste. Sono 21 sui 177 che il fornitore ha
incrociato.

**Decisione PO (29/08): non assegnati + lista admin.** Il lead entra nel CRM ma
resta senza assegnatario, visibile in una lista admin da bonificare a mano.

Scartarlo automaticamente sarebbe più pulito nei numeri ma perderebbe un lead
pagato ogni volta che `isPlausiblePhone` sbaglia — e sbaglia, per esempio, sui
formati esteri. Non assegnarlo costa una lista da guardare; scartarlo costa un
lead che nessuno saprà mai di aver perso.

Il lead non va nemmeno pushato al bot: una chat WhatsApp su `0000000000` non
esiste.

## 5. Le riassegnazioni sui lead già appuntati

Due cose distinte, che il fornitore ha fuso in una.

### Il bug è nostro ed è reale

`reassignBotLeadToHumanPool` (`src/lib/bot-fissatore/reassign.ts:29-53`) **non
ha nessuna guardia**. Non legge nemmeno il lead prima di sovrascriverlo con
`status:'NEW', callCount:0`, e non azzera `appointmentDate` — quindi un lead
può restare con un appuntamento appeso mentre è `NEW`, cioè fuori dalla board
Conferme, dove nessuno lo chiama.

Il chiamante è uno solo: il ramo `NON_RISPOSTO`/`INTERROTTO` in
`/api/bot/outcome:456-460`, che sta **prima** della guardia `leadHasHistory`
(`route.ts:486`) — quella protegge solo il ramo `APPUNTAMENTO`. Il commento in
`contactRequestActions.ts:53-54` che dichiara «stessa invariante della guardia in
/api/bot/outcome» **è falso oggi** e va corretto insieme al codice.

Vittima confermata in DB: una sola, `0f90aa98-17b4-4291-ab08-d05917b1a448`
(25/06) — appuntamento fissato alle 15:13, riassegnato come `chat_interrotta`
alle 16:32, poi richiamato a freddo quattro volte, oggi `REJECTED`.

**La stessa guardia mancante ha un secondo sapore**, trovato dalla verifica
avversaria: **4 lead già `REJECTED` sono stati resuscitati a `NEW`** da una
riassegnazione arrivata dopo un `DA_SCARTARE` (12/07, 27/07, 13/08, 17/08).
Uno scarto è una decisione presa; un `INTERROTTO` che arriva dopo non la
annulla. Va guardato anche questo — ma **separatamente** da `isLeadLocked`, che
è un'invariante diversa: lì si protegge lo storico e l'attribuzione, qui si
protegge una decisione. La distinzione conta, perché in
`assignContactRequest` la resurrezione di un `REJECTED` è **voluta**: un lead
scartato che chiede di essere richiamato torna in pipeline apposta.

**Fix**, come prima istruzione dentro la transazione (riga 30), così copre anche
futuri chiamanti:

```ts
const [cur] = await tx.select({ status: leads.status, presentedAt: leads.presentedAt })
    .from(leads).where(eq(leads.id, leadId)).limit(1);
if (!cur) return { ok: true, assignedToId: null, note: 'lead_not_found' };
if (cur.status === 'APPOINTMENT' || cur.presentedAt !== null) {
    // stessa invariante di isLocked() in contactRequestActions.ts
    return { ok: true, assignedToId: null, note: 'locked_appointment' };
}
```

Il route risponde `{ ok: true, skipped: 'locked_appointment' }` invece di
`reassigned`, così il fornitore vede dentro il 2xx che la riassegnazione non è
stata applicata — invece di dedurlo da un silenzio.

### Gli 8 lead che citano sono un caso diverso

Ne ho identificati 7, tutti riassegnati il **24/08** durante uno scarico massivo
di `INTERROTTO` (360 in un giorno contro una media di ~12). Timeline identica
per tutti: `IMPORTED → ASSIGNED → BOT_PUSHED(sent) → REASSIGNED_FROM_BOT`. Zero
callLog `APPUNTAMENTO`, `appointmentDate` e `appointmentCreatedAt` mai
valorizzati, `agendaStatus` NULL. Ma la loro `botNote` dice che l'appuntamento
era confermato in chat.

**Verifica avversaria (29/08): il nucleo regge, due affermazioni no.**

Cosa sopravvive, e con una prova più forte di quella iniziale:
`updateLeadOutcome` scrive il callLog **prima** del controllo di concorrenza
(`pipelineActions.ts:367-377`), quindi perfino un `APPUNTAMENTO` fallito con 409
lascia una traccia indelebile. Nessun callLog `APPUNTAMENTO` significa che
nessuna chiamata `APPUNTAMENTO` è mai arrivata al ramo di scrittura. Nel codice
non esiste nessuna delete su `callLogs`. E su **tutto** lo storico — non solo 90
giorni — esiste **un solo** lead con un appuntamento precedente a una
riassegnazione: quello del 25/06. Il campione, semmai, era incompleto **a nostro
sfavore**: le note di `REASSIGNED_FROM_BOT` che dichiarano un appuntamento
confermato in chat sono ~45, non 7.

Cosa **non** possiamo dire:

1. **«Le otto call sono passate con 2xx quindi mentono»** non è verificabile: i
   log HTTP Vercel del 15-24/08 non esistono più. E c'è una spiegazione
   innocente da offrire *prima* di accusare: `NOTA`, `CONTATTO_UMANO` e lo
   stesso `INTERROTTO` rispondono **davvero** 200 per contratto. Se la loro
   telemetria registra «CRM notificato, 200 OK» senza distinguere l'outcome, i
   loro 2xx sono veri ma riferiti a chiamate che per contratto non fissano
   niente. In più un `APPUNTAMENTO` senza offset di fuso prende 400
   (`route.ts:89-91`): se il loro client tratta male i 4xx, possono credere di
   aver inviato ciò che non è mai passato.
2. **«Il CRM non può fare quello che descrivete»** è falso. Può, ed è successo
   una volta. Va riconosciuto per primo, non per ultimo.

Non possiamo nemmeno affermare che il bot «non ha mai chiamato» l'endpoint con
`APPUNTAMENTO`: solo che nessuna chiamata `APPUNTAMENTO` è mai andata a buon
fine su quei lead. Quello che serve chiedere: gli **8 `leadId`**, i timestamp, e
**payload e corpo della risposta** delle chiamate che dicono aver ricevuto 2xx.
Con quelli si chiude in dieci minuti, in un senso o nell'altro.

**Contesto della finestra**, verificato: i 360 `chat_interrotta` del 24/08 sono
reali contro una media di ~12 al giorno, il picco parte il 20/08 con un pattern
da cron orario, e **fra il 18 e il 24/08 non c'è stato nessun deploy nostro**.
È compatibile con uno svuotamento massivo di chat stantie da parte loro — forse
la risposta alla nostra contestazione del 6/08 sui «338 lead fermi». Da tenere
presente prima di accusare: potremmo averlo chiesto noi.

Dettaglio a doppio taglio: molte conferme in chat del 21-24/08 riguardano date
**già passate** al momento del rilascio (es. `19ebf9fd`: il lead conferma
«mercoledì 19 alle 12», rilasciato il 24/08 alle 23:06). Prova che il bot ha
tenuto le chat oltre la data concordata — ma anche che, se pure ce li avesse
mandati, quegli appuntamenti sarebbero stati inservibili.

## 6. I duplicati per numero di telefono

Il fornitore deduplica per numero («la stessa persona ha una chat sola»), il CRM
crea un lead nuovo a ogni rientro. Chiedono come vogliamo gestirlo.

### Il fenomeno, misurato

Su 59.818 lead Fenice: **6.459 gruppi** di lead sullo stesso numero, **14.032
lead coinvolti (23,5%)**. Ma **due terzi sono duplicazione voluta** — import dei
pool database e Black Summer, decisione PO del 20/07: quei duplicati vanno
richiamati apposta. Il fenomeno vero da webhook è 1.817 gruppi / 3.897 lead.

### Il merge retroattivo è escluso

- **1.708 gruppi** toccherebbero appuntamenti, presenze o fatturato: 374 con
  `presentedAt` latchato (immutabile per decisione del 17/07, base dei bonus
  GDO) e 224 con `closeAmountEur > 0`.
- **5.251 gruppi (81%)** hanno lead su GDO diversi: un merge riscrive
  l'attribuzione, quindi KPI, classifiche, gamification e provvigioni già
  pagate.
- `callLogs`, `leadEvents` e `salesAttempts` hanno FK `ON DELETE CASCADE` su
  `leads.id`.

Nessun beneficio giustifica di riscrivere mesi già chiusi e riconciliati.

### Cosa facciamo invece

**(a) Diamo al bot la chiave persona.** Al push, in `BotIntakePayload`
(`src/lib/bot-fissatore/types.ts:12-19`), due campi nuovi:

- `personKey` — ultime 10 cifre del telefono normalizzato. Copre il 100% dei
  casi, mentre `acContactId` ne copre solo il 52% (import manuali e CSV non ce
  l'hanno).
- `previousLeadIds` — i lead precedenti con la stessa `personKey`, ciascuno con
  esito, stato e data. La query esiste già: `getLeadsWithSamePhone`
  (`pipelineActions.ts:253`), da alzare da 9 a 10 cifre.

Il bot capisce da solo che è la stessa chat e decide se riaprire o chiudere come
già lavorata. Il contratto degli esiti resta identico — continuano a rispondere
sul `leadId` corrente — quindi zero rischio su `/api/bot/outcome`. Sblocca i
~60 lead `NEW` che oggi sembrano fermi (il fornitore ne conta 30, il numero
vero è dell'ordine di 60).

Serve l'indice expression, perché oggi non esiste **nessun** indice su `phone`:

```sql
CREATE INDEX leads_company_phonekey_idx
  ON leads ("companyId", right(regexp_replace(phone,'\D','','g'), 10));
```

**(b) Finestra di dedup all'intake da 10 minuti a 24 ore**, solo per il flusso
webhook senza pool (`webhooks/activecampaign/route.ts:523`). Recupera 439
ricomparse entro le 24h, che sono doppi submit veri. Non tocca i rientri
legittimi: la mediana fra una comparsa e l'altra è 10,8 giorni, e oltre le 24h
la persona che rientra *è* un lead nuovo da richiamare.

**(c) Il rilevatore duplicati va portato da 9 a 10 cifre.**
`pipelineActions.ts:227` e `:271` raggruppano sulle ultime 9 cifre e così
**fondono 134 gruppi di numeri realmente diversi** — 6.565 gruppi a 9 cifre
contro 6.459 a 10. Va corretto prima di costruirci sopra qualsiasi automatismo,
`personKey` incluso.

## 7. I dieci esiti rifiutati

Non abbiamo la lista. La causa quasi certa è il `403 'lead mai passato dal bot'`
di `/api/bot/outcome:154`, che scatta quando il lead non ha né un `BOT_PUSHED`
con `result: 'sent'` né un'agenda consegnata — cioè quando il bot scrive su un
lead che non gli è mai arrivato.

Chiediamo i dieci `leadId` e li verifichiamo uno per uno. Senza quelli è una
congettura, e il fornitore dice lui stesso che «non risulta nessun push del bot
su quei lead» — il che è coerente col 403 ed è compatibile con i duplicati del
punto 6, dove l'esito parte sotto il `leadId` precedente.

## Un errore loro che ci riguarda

Il fornitore ammette che il loro endpoint di intake **rispondeva 200 anche
quando non prendeva in carico il lead**. Dal nostro lato era indistinguibile da
un lead lavorato, ed è il motivo per cui la lista dei «fermi al bot» continuava
a crescere.

Da mettere agli atti: nel nostro `push.ts` un 200 dal fornitore viene scritto
come `result: 'sent'`, ed è la prova di appartenenza usata da
`/api/bot/outcome`, `/api/bot/lead-status` e dalle statistiche del bot. Per il
periodo in cui il loro bug è stato attivo, `BOT_PUSHED sent` sovrastima i lead
davvero presi in carico. Non lo correggiamo retroattivamente — non abbiamo il
loro dato per distinguerli — ma va saputo da chi legge quelle statistiche.

## Ordine di rilascio

1. **Punto 1 + punto 2 insieme** — il recupero NR e la corsia Conferme. Non
   separabili: il primo produce lead recuperati che solo il secondo permette di
   riprendere.
2. **Punto 3** — il ritorno su `lead-status`. Chiude il ciclo e rende misurabili
   i due precedenti.
3. **Punto 5 (fix)** — la guardia in `reassign.ts`. Indipendente, piccolo,
   nessuna ragione per rimandarlo.
4. **Punto 4** — i telefoni sospetti non assegnati.
5. **Punto 6** — `personKey` + `previousLeadIds`, finestra 24h, detector a 10
   cifre.
6. **Punto 7** — dopo che il fornitore manda i dieci `leadId`.

## Cosa non facciamo

- Nessun merge retroattivo dei duplicati (punto 6).
- Nessuna riapertura automatica di uno scarto 3NR (punto 1).
- Nessuno scarto automatico dei telefoni sospetti (punto 4).
- Nessun endpoint nuovo per il ritorno dei contatti umani (punto 3).
- Nessuna duplicazione delle sette guardie del fornitore sul nostro lato
  (punto 1).
