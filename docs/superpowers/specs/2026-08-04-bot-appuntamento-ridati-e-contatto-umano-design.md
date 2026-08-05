# Appuntamenti sui lead ridati e richieste di contatto umano

Data: 2026-08-04 · Stato: decisioni prese dal PO

## Da dove nasce

Il fornitore del bot ci ha segnalato che circa l'11% degli esiti che ci manda
torna indietro con `403 lead non assegnato a un account bot` — 46 su 413 in
sette giorni — e che un caso è costato un appuntamento.

Ricostruito il caso (Marina Destefanis, `95487d58`):

| | |
|---|---|
| 26/07 19:38 | importata, assegnata al bot, push al bot `200` |
| 26/07 20:12 | report del bot: *"conversazione molto breve, interrotta con arrivederci a domani"* |
| 26/07 20:12 | `REASSIGNED_FROM_BOT` → GDO 119, reason `chat_interrotta`, nota *"ci riprova domani"* |
| 27/07 | il bot continua la chat, fissa per il 28/07 alle 16:00, spinge `APPUNTAMENTO` quattro volte → `403` |

**È stato il bot a restituirci il lead**, 34 minuti dopo averlo ricevuto,
mandandoci lui un `INTERROTTO`. Poi ha continuato a lavorarlo lo stesso. Il
`403` è il contratto che funziona: il problema è a monte, `INTERROTTO` per noi
significa "ho chiuso" e per loro a volte "per ora mi fermo ma la chat è viva".

Quella richiesta gliela facciamo comunque, ma l'appuntamento perso resta perso.
Nel frattempo il GDO umano l'aveva chiamata tre volte e scartata: due canali
sullo stesso lead che non si vedevano.

I `403` **non sono contabili da noi**: una richiesta rifiutata non lascia
traccia a database. Il loro 46 su 413 è l'unica misura esistente.

Il fornitore ha anche segnalato che nove lead in trenta giorni chiedono
espressamente di parlare con una persona, il bot promette il richiamo e si
ferma — e quella richiesta oggi non arriva a nessuno.

## 1. L'appuntamento su un lead già ridato viene accettato

**Decisione del PO:** accettare l'esito e riprendere il lead, invece di
avvisare il GDO e lasciarglielo.

Il rischio noto e accettato: il GDO che ci stava lavorando se lo vede sparire
dalla pipeline senza che nessuno glielo dica. Resta ricostruibile dalla
timeline del lead, ma va cercata.

**Provenienza richiesta.** Il segreto del bot non deve diventare il permesso di
fissare appuntamenti su qualunque lead a database. L'esito si accetta solo se
quel lead è stato davvero del bot: esiste un evento `BOT_PUSHED`, oppure
`agendaStatus` è `consegnato`/`inviato`. Altrimenti resta `403` come oggi.

**Cosa succede.** Il lead torna assegnato all'account bot **prima** che l'esito
venga registrato, così l'appuntamento è attribuito al bot e non al GDO che non
l'ha fissato — il bot è già escluso dai KPI per GDO. Poi l'esito segue la
strada di sempre (`updateLeadOutcome` con `serviceCtx`), quindi handoff alle
Conferme, call log e webhook marketing restano identici.

**La ripresa è silenziosa.** Il GDO che perde il lead non riceve nessuna
notifica: il lead viene semplicemente ripreso. Resta un evento
`REASSIGNED_TO_BOT` con dentro da chi è stato ripreso — è la traccia di audit,
non un avviso.

**Solo `APPUNTAMENTO`.** Gli altri esiti su lead non del bot continuano a
prendere `403`: uno scarto o un richiamo dal bot su un lead che sta lavorando
un umano non ha la stessa urgenza commerciale e sovrascriverebbe il lavoro di
qualcun altro senza compenso.

## 2. `CONTATTO_UMANO`: la richiesta arriva agli admin (e alle Conferme se il lead è appuntato)

**Decisione del PO:** il report va agli **amministratori**, non al GDO. Decide
l'admin cosa farne e a chi assegnarla.

Nuovo valore di `outcome` su `/api/bot/outcome`, con `note` obbligatoria (è la
richiesta del lead, senza non serve a niente). Il fornitore aveva proposto un
`RICHIAMO`: non va bene, lascerebbe il lead assegnato all'account bot, dove non
guarda nessun umano — cioè lo stesso posto dove le richieste si perdono oggi.

**Cosa NON fa:** non cambia stato, non riassegna, non tocca l'appuntamento. È
una segnalazione, non una transizione: il lead resta esattamente dov'è.

**Cosa fa:** scrive un evento `BOT_CONTACT_REQUEST` in timeline e manda una
notifica cliccabile, che apre la scheda del lead, a tutti gli admin Fenice
attivi. Stessa provenienza richiesta del punto 1 — o il lead è del bot, o deve
risultare che lo sia stato.

**Se il lead è già `APPOINTMENT`, la richiesta arriva anche alle Conferme**
attive di Fenice, non solo agli admin: sono loro a richiamare il lead il
giorno prima dell'appuntamento, quindi sono loro a dover sapere subito che
vuole parlare con una persona. Stessa selezione di ruolo/attivo/azienda usata
per il blocco `NOTA` più sopra. La soppressione delle 24 ore copre entrambe le
platee insieme: se la richiesta è soppressa non notifica nessuno, se non lo è
notifica tutti quelli previsti.

Nove lead al mese: volume minimo, intento altissimo.

## Cosa resta fuori

- Il contratto dell'agenda e `/api/appointment-set`: separati, non si toccano.
- La deduplica delle note ripetute: già risolta lato nostro il 03/08, e il
  fornitore sistemerà la sua.
- Gli altri esiti sui lead ridati: restano `403`, per scelta.

## Verifica

- **Appuntamento su lead ridato**: `APPUNTAMENTO` su un lead con `BOT_PUSHED` e
  assegnato a un umano → `200`, lead in `APPOINTMENT` e assegnato al bot,
  nessuna notifica al GDO precedente, evento `REASSIGNED_TO_BOT`.
- **Lead mai passato dal bot**: stesso esito su un lead senza `BOT_PUSHED` e
  senza agenda → `403`, nessuna scrittura.
- **Altri esiti invariati**: `DA_SCARTARE` su lead di un umano → `403`.
- **Lead già del bot**: `APPUNTAMENTO` normale → identico a oggi, nessun
  evento di riassegnazione.
- **`CONTATTO_UMANO` su lead non appuntato**: `200`, evento in timeline, una
  notifica per ogni admin attivo, nessuna alle Conferme, nessuna modifica
  allo stato o all'assegnatario del lead.
- **`CONTATTO_UMANO` su lead `APPOINTMENT`**: `200`, evento in timeline, una
  notifica per ogni admin attivo e per ogni Confermista attivo di Fenice.
- **`CONTATTO_UMANO` soppresso (entro 24h dal precedente)**: `200`, evento in
  timeline, nessuna notifica a nessuno — né admin né Conferme.
- **`CONTATTO_UMANO` senza nota** → `400`.
