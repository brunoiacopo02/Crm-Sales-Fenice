# Risposta al fornitore bot — 29/08/2026

*Bozza pronta da mandare. Risponde punto per punto al loro messaggio del 29/08.*

---

Ciao,

rispondo punto per punto. Tre cose le abbiamo già fatte oggi, due sono decisioni
nostre che vi spiego, e su due ci serve qualcosa da voi.

## 1. Il recupero NR: `call-attempt` è agganciato

Fatto. La chiamata parte **automaticamente** nel momento esatto in cui la
Conferma registra il mancato contatto, al 1° e al 3° tentativo, con
`appointmentAt` valorizzato. Non a fine giornata: dentro l'azione stessa,
prima ancora che la schermata si aggiorni.

Avete ragione sul perché: avevamo due bottoni «Notifica 1° NR» e «Notifica 3 NR»
e li abbiamo tolti il 6 agosto proprio perché mandavano dal canale sbagliato.
Rimetterli come bottoni sarebbe stato inutile — su una board dove si clicca NR
di corsa, un bottone in più non viene premuto. Ora è il click stesso sul mancato
contatto a farlo partire.

Non filtriamo niente da parte nostra: come dite voi, chiamiamo sempre e filtrate
voi. Registriamo la vostra risposta (`inviato`, `ramo`, `motivo`) su ogni
tentativo, così fra due settimane possiamo dirvi quanti appuntamenti ha
recuperato davvero invece di crederlo.

**Una cosa da sapere sul 3° tentativo.** Da noi il 3° NR **scarta già** il lead,
in automatico, nello stesso istante. Quindi il vostro messaggio che dice «senza
risposta l'appuntamento verrà annullato» è letteralmente vero: è appena
successo. Se il lead risponde, il recupero passa dalle Conferme, che riaprono a
mano. Non lo riapriamo in automatico di proposito: quello scarto ha già fatto
partire un evento verso il marketing e ha già contato nelle statistiche di
conferma, e un lead che entra ed esce dai numeri per conto suo li rende
inaffidabili. Ma perché funzioni **serve che ci segnaliate `CONTATTO_UMANO`
quando il lead risponde al messaggio del 3° NR** — altrimenti recuperiamo gente
che poi nessuno riprende.

## 2. La sezione Conferme: c'era già metà, e la diagnosi era sbagliata

Le notifiche alle Conferme **sono già in tempo reale, con il pallino rosso, dal
26 agosto**. Quando ci mandate `CONTATTO_UMANO` su un lead che ha un
appuntamento, la notifica parte nello stesso istante a tutte le Conferme attive
e compare sulla campanella senza ricaricare la pagina. Non c'è nessun riepilogo
del giorno dopo.

Le 48 richieste ferme non sono ferme per quello. Sono ferme perché la coda era
visibile **solo agli admin**: le Conferme ricevevano l'avviso, lo cliccavano, e
non avevano una pagina dove atterrare. Quella pagina ora c'è, filtrata sui lead
che hanno già un appuntamento — la vostra corsia. Da lì prendono in carico e
chiudono con un esito.

Grazie per `info.appuntamento`: è quello che ci permette di instradarle senza
doverle cercare.

## 3. Il ritorno: sì, e sulle righe di `lead-status` come proponevate

Fatto, senza endpoint nuovi e senza segreti nuovi. Ogni riga porta ora:

```json
"contattoUmano": {
  "presoInCaricoDa": "Nome Operatore | null",
  "presoInCaricoIl": "2026-08-29T10:12:00+02:00",
  "esito": "chiamato_ok | non_raggiungibile | rifissato | disdetto | non_gestito",
  "esitoIl": "2026-08-29T11:03:00+02:00",
  "nota": "testo libero, opzionale",
  "stato": "pending | assigned | closed",
  "richiestaIl": "2026-08-28T18:40:00+02:00"
}
```

**Prima però c'è un conto che non torna, e conviene chiarirlo subito.** Voi
parlate di **64 richieste totali e 48 aperte**. Nel nostro database ce ne sono
**59 in tutto**, di cui 37 non ancora chiuse (1 mai presa in carico, 36 assegnate
a qualcuno che non ha ancora riportato l'esito). Mancano all'appello **5
richieste** che a voi risultano inviate e a noi non risultano ricevute.

Non è un dettaglio contabile: se cinque `CONTATTO_UMANO` non sono mai arrivati,
sono cinque persone che hanno chiesto di parlare con qualcuno e nessuno lo sa. Il
sospetto è lo stesso del punto 7 — un `403 "lead mai passato dal bot"` — o lo
stesso dei duplicati del punto 6, con la richiesta partita sotto un `leadId` che
non era quello che vi avevamo mandato. **Mandateci l'elenco completo con
`/api/bot/contatti-umani` e lo incrociamo**: le 5 che mancano si trovano in
mezz'ora.

`null` per i lead che non hanno mai fatto una richiesta. Abbiamo aggiunto
`stato` e `richiestaIl` oltre a quello che chiedevate: una richiesta ancora
`pending` esce con esito `null`, e vi dice che l'abbiamo ricevuta ma non ancora
lavorata — che è già più di quello che sapete oggi.

**Un dettaglio tecnico che vi riguarda**: il vostro suggerimento così com'era
non avrebbe funzionato. `lead-status` scorre su `updatedAt` **del lead**, e
prendere in carico una richiesta non tocca il lead: quelle righe non sarebbero
mai uscite dal cursore e avreste visto silenzio, concludendo che non le
lavoriamo. Ora ogni movimento sulla coda tocca anche il lead apposta. L'arretrato
delle 48 esce da solo man mano che viene smaltito, perché il cursore è a
scorrimento.

## 4. I telefoni inventati: non li assegniamo più

Fatto. `phoneSuspicious` lo calcolavamo già su tutti i canali d'ingresso, ma non
faceva niente: il lead veniva assegnato normalmente. Ora entra senza
assegnatario e finisce in una lista che gli admin bonificano a mano.

Abbiamo controllato quanto costava tenerli in giro, ed è peggio di quanto
pensassimo: sullo storico sono **392 lead con un telefono non valido, di cui 367
sono stati davvero chiamati** da un operatore. Risultato complessivo: 1
appuntamento, 0 presentati, 0 vendite, 0 euro. Sono 367 telefonate a numeri che
non esistono. Il volume è circa l'1,1% degli ingressi, 2-3 al giorno.

Non li scartiamo in automatico, e non è pigrizia: il nostro controllo sbaglia
sui formati esteri, e un lead scartato da un automatismo è un lead pagato che
nessuno saprà mai di aver perso. Meglio una lista da guardare.

Non ve li pushiamo nemmeno: una chat su `0000000000` non esiste.

## 5. Le riassegnazioni — riconosciamo il problema, ma gli 8 lead sono un'altra cosa

**Partiamo da quello che è colpa nostra.** Avete ragione che il meccanismo
esiste: la nostra riassegnazione al pool umano non aveva **nessuna** guardia sui
lead già appuntati. Non leggeva nemmeno lo stato del lead prima di riportarlo a
`NEW`, e non azzerava la data dell'appuntamento — quindi il lead spariva dalla
board delle Conferme con la call ancora addosso e nessuno la faceva. È corretto
da oggi, la guardia sta dentro la transazione così copre anche i percorsi
futuri, e d'ora in poi la risposta vi dice esplicitamente
`{"ok": true, "reassigned": null, "skipped": "locked_appointment"}` invece di
lasciarvelo dedurre.

Cercando la causa abbiamo trovato anche un secondo caso della stessa guardia
mancante: **4 lead già scartati sono stati resuscitati** da un `INTERROTTO`
arrivato dopo lo scarto, e sono tornati in pipeline a chiamare gente che
qualcuno aveva deciso di non chiamare più. Corretto anche quello.

**Sui vostri 8, però, i dati dicono una cosa diversa.** Ne abbiamo identificati
7, tutti rilasciati il 24 agosto. Su nessuno dei 7 esiste **alcuna** traccia di
appuntamento nel CRM: nessun log di chiamata con esito appuntamento, nessuna
data, nessun evento. La timeline è identica per tutti e sette: importato →
assegnato → pushato a voi → riassegnato.

Il punto tecnico che rende questa verifica solida: il log della chiamata viene
scritto **prima** del controllo di concorrenza. Anche un `APPUNTAMENTO` che
fallisse per conflitto lascerebbe comunque la traccia. Non ce n'è nessuna. E su
tutto lo storico, non solo su questi giorni, esiste **un solo** lead con un
appuntamento precedente a una riassegnazione: quello del 25 giugno, che è
esattamente il caso in cui vi diamo ragione.

**Prima di trarne conclusioni, però, c'è una spiegazione che vi offriamo noi.**
Le vostre chiamate `NOTA`, `CONTATTO_UMANO` e lo stesso `INTERROTTO` ricevono
**davvero** 200 da noi, per contratto: non fissano niente, ma rispondono 2xx. Se
la vostra telemetria registra «CRM notificato, 200 OK» senza distinguere
l'outcome, i vostri 2xx sono veri e il quadro si spiega senza che nessuno abbia
sbagliato in malafede. C'è anche un secondo caso possibile: un `APPUNTAMENTO`
senza offset di fuso orario nella data prende **400** da noi — se il vostro
client non distingue i 4xx, potreste risultarvi inviato qualcosa che non è mai
passato.

**Quello che ci serve per chiudere in dieci minuti:** gli **8 `leadId`**, i
timestamp, e **il payload della richiesta più il corpo della risposta** delle
chiamate che risultano a voi con 2xx. Con quelli si risolve in un senso o
nell'altro, e non serve che nessuno dei due indovini.

**C'è però una cosa urgente, indipendente da chi ha ragione.** Le vostre note
su quei 7 dicono che l'appuntamento era **confermato in chat**. Se è così, sono
7 persone che credono di avere una call che non esiste in nessun sistema — e in
diversi casi la data che avevano confermato era **già passata** al momento in
cui ci avete rilasciato il lead (uno conferma «mercoledì 19 alle 12» e ci arriva
il 24 agosto alle 23:06). Mandateci i nominativi e li richiamiamo noi domani,
prima di capire di chi è la colpa.

Ultima nota di contesto, senza accuse: dal 20 al 25 agosto i rilasci per chat
interrotta sono passati da ~12 al giorno a **360 solo il 24**, con un pattern
orario regolare. Non c'è stato nessun rilascio nostro fra il 18 e il 24. Se è
stato uno svuotamento massivo di chat vecchie — magari in risposta alla nostra
segnalazione del 6 agosto sui 338 lead fermi — diccelo e va benissimo: ci serve
solo saperlo per leggere i numeri di agosto.

## 6. I duplicati: non uniamo i lead, vi diamo la chiave

Abbiamo misurato il fenomeno prima di decidere. Sul nostro database ci sono
6.459 gruppi di lead sullo stesso numero, ma **due terzi sono duplicazione
voluta**: sono gli import dei pool database e Black Summer, dove la stessa
persona viene richiamata apposta a distanza di mesi. Il fenomeno vero dal
webhook è 1.817 gruppi.

**Non possiamo unirli, e non è una scelta pigra.** 1.708 gruppi toccano
appuntamenti, presenze o fatturato — 374 hanno una presenza registrata e 224
hanno una vendita. E 5.251 gruppi (l'81%) hanno lead assegnati a **GDO diversi**:
unirli riscriverebbe l'attribuzione, quindi classifiche, obiettivi e provvigioni
già pagate di mesi chiusi e riconciliati.

**Vi diamo invece quello che vi serve per capirlo da soli.** Dal prossimo push
ogni lead porta:

```json
"personKey": "3331234567",
"previousLeadIds": [
  { "leadId": "…", "status": "REJECTED", "outcome": "non in target", "createdAt": "2026-06-12T…" }
]
```

`personKey` sono le ultime 10 cifre del telefono normalizzato: la stessa persona
ha sempre la stessa chiave, anche quando da noi diventa un lead nuovo.
`previousLeadIds` sono i lead precedenti con i loro esiti, dal più recente.
Continuate a rispondere sul `leadId` corrente — il contratto degli esiti non
cambia di una virgola — ma sapete che quella chat l'avete già avuta e come è
andata.

Abbiamo misurato quanto vi sblocca: dei **276 lead attualmente fermi in `NEW`
sull'account bot, 84 (il 30%) hanno uno storico recuperabile** con questa
chiave. È quasi il triplo dei 30 che avete contato voi — probabilmente perché
vedete solo quelli con una chat ancora aperta, mentre la chiave li trova tutti.

Abbiamo anche allargato la finestra anti-doppione all'ingresso da 10 minuti a
24 ore: le ricomparse entro un giorno sono doppi invii veri. Oltre no — chi
rientra dopo giorni **è** un lead nuovo e va richiamato (la mediana fra due
comparse è di 11 giorni).

## 7. I dieci esiti rifiutati: mandateceli

Senza i `leadId` è una congettura. La causa quasi certa è il nostro `403 "lead
mai passato dal bot"`, che scatta quando l'esito arriva su un lead che non vi
abbiamo mai pushato — ed è coerente con quello che dite voi («non risulta nessun
push del bot su quei lead»). Molto probabilmente sono la stessa cosa del punto 6:
l'esito è partito sotto un `leadId` che non era quello che vi avevamo mandato.
Con `personKey` non dovrebbe più succedere. Mandateci i dieci e li verifichiamo
uno per uno.

## Una conseguenza del vostro bug che vi diciamo per correttezza

Ci avete scritto che il vostro intake **rispondeva 200 anche quando non prendeva
in carico il lead**. Da noi un 200 su quel push viene registrato come «lead
lavorato dal bot», ed è la prova che usiamo per accettare i vostri esiti, per
servirvi `lead-status` e per contare le statistiche del bot.

Quindi per tutto il periodo in cui quel bug è stato attivo, **le nostre
statistiche sul bot sovrastimano i lead che avete davvero preso in carico**. Non
lo correggiamo a posteriori, perché per distinguerli servirebbe un vostro dato
che non abbiamo. Ma se in qualche riunione confrontiamo numeri, questo va
saputo da entrambi.

## Riassunto: cosa serve da voi

1. **Gli 8 `leadId`** del punto 5, con payload e risposta delle chiamate che vi
   risultano 2xx. E, subito e a prescindere, **i nominativi dei 7 che hanno
   confermato in chat**: li richiamiamo noi.
2. **I 10 `leadId`** degli esiti rifiutati.
3. **Confermateci** che al 3° NR ci segnalate `CONTATTO_UMANO` quando il lead
   risponde: senza quel segnale il recupero si ferma a metà.
4. **Ditecici** se il picco di rilasci del 20-25 agosto è stato uno svuotamento
   voluto: ci serve per leggere i numeri del mese.
5. **L'elenco completo delle richieste di contatto** da
   `/api/bot/contatti-umani`: a voi ne risultano 64, a noi 59. Vogliamo capire
   dove sono finite le 5 che mancano.
6. Fateci sapere quando iniziate a usare `personKey` e `previousLeadIds`, così
   controlliamo insieme che i lead fermi si sblocchino.

A presto,
