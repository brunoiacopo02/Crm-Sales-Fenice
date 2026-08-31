# Messaggio al fornitore bot — chiusura, 29/08/2026

*Messaggio unico e autosufficiente. Sostituisce tutte le bozze precedenti della
giornata: manda solo questo.*

---

Ciao,

chiudiamo il giro con un messaggio solo, così resta una cosa da rileggere invece
di sei. Dentro c'è cosa è cambiato da parte nostra e come si comporta adesso il
CRM, cosa abbiamo chiuso insieme, e le due cose che restano aperte.

È stata una giornata utile: quattro delle sette cose che ci avevate chiesto sono
in produzione, e tre convinzioni sbagliate — due nostre e una vostra — sono
cadute perché ci siamo passati i dati invece delle opinioni. Vale la pena
continuare così.

---

## PARTE 1 — Cosa è vivo da oggi, e come si comporta

### Il recupero delle mancate risposte

**`POST /api/bot/call-attempt` è agganciato e acceso.** Parte automaticamente
nell'istante in cui la Conferma registra il mancato contatto — dentro l'azione
stessa, prima ancora che la schermata si aggiorni — al **1° e al 3° tentativo**,
mai al secondo. `appointmentAt` è sempre valorizzato quando la data esiste.

Non filtriamo niente da parte nostra: come dicevate, chiamiamo sempre e filtrate
voi. Registriamo la vostra risposta (`inviato`, `ramo`, `motivo`) su ogni
tentativo, così fra due settimane possiamo dirvi quanti appuntamenti ha
recuperato davvero invece di crederlo.

Avevamo tolto i due bottoni «Notifica 1° NR» e «Notifica 3 NR» il 6 agosto
proprio perché mandavano dal canale sbagliato. Rimetterli come bottoni sarebbe
stato inutile: su una board dove si clicca NR di corsa, un bottone in più non
viene premuto. Ora è il click stesso a farlo partire.

### Il rifissaggio dopo lo scarto — la modifica più importante della giornata

**Sì, un `APPUNTAMENTO` con data nuova su un lead scartato o riassegnato viene
accettato.** Vale in tutti i casi: scartato dalle Conferme, riassegnato a un GDO
umano, scartato da un GDO. Il bot può rifissare, non deve fermarsi alla
segnalazione.

**Ma fino a stamattina "accettato" non voleva dire niente.** Un lead scartato per
"3 NR consecutivi" resta con lo stato `APPOINTMENT`: cambia solo il campo
dell'esito Conferme. Il nostro ramo di rifissaggio aggiornava la data e non
toccava quel campo — e la board delle Conferme mostra solo i lead con l'esito
ancora vuoto. Risultato: la Conferma riceveva la notifica dello spostamento, la
cliccava, e il lead non era da nessuna parte.

Adesso il rifissaggio **riapre lo scarto** e il lead torna sulla board, con una
notifica che lo dice: «Recuperato: era scartato, ha rifissato». Senza la vostra
domanda quel buco sarebbe rimasto aperto proprio mentre accendevamo il recupero
NR, cioè nel momento peggiore possibile.

### Le richieste di contatto umano

**`CONTATTO_UMANO` non viene più rifiutato. Mai.** Qualunque sia la storia di
quel lead, purché sia un lead Fenice. È l'unico dei vostri esiti che non scrive
niente sul lead — mette una riga in coda e manda una notifica, nessuna
transizione di stato, nessuna attribuzione toccata. Il danno massimo se sbagliate
lead è una riga di coda da chiudere; il danno di rifiutarlo è una persona che ha
chiesto di essere richiamata e di cui nessuno saprà mai niente. È successo a
`e4ef3953` il 31 luglio, che scriveva «farmi sentire la tua collega».

Tutte le altre guardie restano identiche: un esito che sposta stato o
attribuzione su un lead che non è del bot continua a essere respinto.

**`risposta_dopo_terzo_nr` è mappato**, con la sua etichetta dedicata («Ha
risposto dopo il 3° NR — recuperabile») e tre alias (`risposta_dopo_3nr`,
`risposta_dopo_terzo_tentativo`, `ha_risposto_dopo_nr`), per non dipendere dalla
forma esatta. Non finisce in `altro`.

### Il sì confermato adesso si vede in pipeline — e questa è vostra

La vostra segnalazione «AVEVA CONFERMATO E L'APPUNTAMENTO NON C'È» è il
contributo più utile che ci avete dato, e l'abbiamo cablata fino in fondo.

Il problema che risolve è nostro e ce lo eravamo tenuto senza accorgercene: un
lead che tornava dopo aver confermato entrava in pipeline **indistinguibile da un
lead freddo qualunque**. Ad agosto sono stati 50, e **14 di loro non li ha mai
chiamati nessuno**. Non era colpa di chi li aveva in carico: non c'era niente che
li distinguesse dagli altri.

Da oggi un lead con una vostra segnalazione aperta in una di queste due categorie
**è marcato sulla card con un badge verde «Aveva detto sì», e va in cima alla
lista** — prima chiamata, seconda, terza e richiami:

| `motivo` | Quando |
|---|---|
| `risposta_dopo_terzo_nr` | ha risposto al messaggio dopo il 3° tentativo |
| `conferma_senza_appuntamento` | aveva confermato o compilato il form, e l'appuntamento non è mai nato |

**Il secondo è un valore nuovo, e ci serve che lo usiate** per la segnalazione di
cui parlavate. Accettiamo anche `aveva_confermato`, `conferma_non_registrata`,
`form_non_completato` e `conferma_senza_appuntamento_creato` come alias, così non
dipendiamo dalla forma esatta — ma se ci mandate un motivo diverso finisce in
`altro`, e in `altro` la marcatura non scatta e il lead torna invisibile come
prima. È l'unico punto del contratto dove il nome esatto cambia il
comportamento: valeva la pena dirlo per esteso.

Il badge sparisce da solo quando la richiesta viene chiusa: finché è aperta, quel
lead resta in cima a chi ce l'ha in mano.

**La sezione per le Conferme c'è**, filtrata sui lead che hanno già un
appuntamento — la vostra corsia. Da lì prendono in carico e chiudono con un
esito. E da oggi c'è anche un **pallino rosso** sulla voce di menu con il numero
di richieste ancora da prendere in carico: la campanella suona una volta e poi si
legge, il pallino resta finché il lavoro non è fatto.

Una precisazione che vi eravamo dovuti: le notifiche alle Conferme erano già in
tempo reale dal 26 agosto. Le 48 richieste ferme non lo erano per quello: erano
ferme perché la pagina era visibile solo agli admin, e le Conferme ricevevano
l'avviso senza avere dove atterrare.

### Il ritorno su `lead-status`

Ogni riga porta ora `contattoUmano`, o `null` se il lead non ha mai fatto una
richiesta:

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

`stato` e `richiestaIl` sono in più rispetto a quanto chiedevate: una richiesta
ancora `pending` esce con esito `null` e vi dice che l'abbiamo ricevuta ma non
ancora lavorata, che è già più di quanto sapevate.

Il vostro suggerimento così com'era non avrebbe funzionato: `lead-status` scorre
su `updatedAt` **del lead**, e prendere in carico una richiesta non tocca il
lead. Quelle righe non sarebbero mai uscite dal cursore e avreste visto silenzio,
concludendo che non le lavoriamo. Ora ogni movimento sulla coda tocca anche il
lead apposta.

### La chiave persona

Al push ogni lead porta ora:

```json
"personKey": "3331234567",
"previousLeadIds": [
  { "leadId": "…", "status": "REJECTED", "outcome": "non in target", "createdAt": "2026-06-12T…" }
]
```

`personKey` sono le ultime 10 cifre del telefono normalizzato. Dieci e non nove:
a nove si fondono 134 gruppi di numeri realmente diversi. `acContactId` non
sarebbe bastato — copre il 52% dei casi, gli import manuali e i CSV non ce
l'hanno.

Abbiamo anche allargato la finestra anti-doppione all'ingresso da 10 minuti a
**24 ore**: le ricomparse entro un giorno sono doppi invii veri, oltre no — la
mediana fra due comparse è di 11 giorni, e chi rientra dopo *è* un lead nuovo.

### I telefoni inventati

Non vanno più a nessun operatore: entrano senza assegnatario e finiscono in una
lista che gli admin bonificano a mano. Non li scartiamo in automatico, perché il
nostro controllo sbaglia sui formati esteri e un lead scartato da un automatismo
è un lead pagato che nessuno saprà mai di aver perso. Non ve li pushiamo nemmeno:
una chat su `0000000000` non esiste.

Il dato che ci ha convinti: sullo storico erano **392 lead con un telefono non
valido, di cui 367 davvero chiamati** da un operatore. Risultato complessivo: 1
appuntamento, 0 presentati, 0 vendite, 0 euro.

### Le riassegnazioni

La nostra riassegnazione al pool umano non aveva **nessuna** guardia sui lead già
appuntati: non leggeva nemmeno lo stato del lead prima di riportarlo a `NEW`.
Adesso c'è, dentro la transazione così copre anche i percorsi futuri, e la
risposta vi dice esplicitamente `{"ok": true, "reassigned": null, "skipped":
"locked_appointment"}` invece di lasciarvelo dedurre da un silenzio.

Cercando la causa abbiamo trovato un secondo caso della stessa guardia mancante:
**4 lead già scartati resuscitati** da un `INTERROTTO` arrivato dopo lo scarto,
tornati in pipeline a chiamare gente che qualcuno aveva deciso di non chiamare
più. Corretto anche quello.

---

## PARTE 2 — Cosa abbiamo chiuso insieme

**Gli 8 appuntamenti "persi": non erano persi.** Ognuno aveva un lead gemello con
lo stesso numero che aveva ricevuto l'appuntamento, alle date esatte che citavate
voi. 7 confermati su 8, 7 presentati, **6 vendite per €15.996**. Era la deduplica
per numero vista dai due lati opposti, ed è esattamente ciò che `personKey`
chiude. Nessun messaggio è partito a quelle persone: sei erano clienti da tre
settimane.

**I 10 esiti rifiutati: il 403 era corretto.** Zero `BOT_PUSHED` e zero agenda
sul vostro canale, su dieci su dieci. Erano lead di sette GDO umani diversi. Uno
di quelli — `bea7627a` — ha venduto per **€2.890**: se avessimo allentato la
guardia avremmo sovrascritto il lavoro di un GDO su una vendita vera. Grazie di
aver tracciato la causa fino in fondo e di aver chiuso il meccanismo che li
generava.

**Le 12 richieste arretrate: colpa nostra e innocente.** Non era un problema di
trasporto: la coda delle richieste di contatto è nata l'8 agosto, e tutte e
dodici sono di luglio o dei primi quattro giorni di agosto. Adesso sono tutte
dentro, `e4ef3953` compresa.

**L'agenda del 31 luglio: chiuso.** Grazie per aver ritirato la frase in chiaro
invece di lasciarla scivolare. Sul doppio invio del 30-31: oggi non può più
succedere allo stesso modo, il canale è uno solo e siete voi a deduplicare. Il
pulsante di reinvio dalla nostra parte resta libero di proposito — a volte un GDO
deve legittimamente rimandare l'agenda — e ci appoggiamo al vostro `deduplicato`.

**I nostri 7 del 24 agosto: avevamo letto male noi.** Avevamo preso «interrotta
dopo la conferma dell'appuntamento» come se fosse il lead ad aver confermato.
Guardando le loro ultime frasi — «Ok», «grazie», «21» — per cinque di loro la
nostra lettura non reggeva. Su Giulia Spizzico e Viola Davide avevate verificato
voi e ci avete dato ragione: erano due appuntamenti veri, fermati dal form.

**Il non fissare senza il form: siamo d'accordo, non cambiate niente.** Fissare a
voce vorrebbe dire metterci in agenda call che il calendario non ha, e ce ne
accorgeremmo il giorno stesso. La soluzione giusta è quella che avete già fatto —
segnalare il sì confermato **in aggiunta** all'esito, senza sostituirlo — più il
form che funziona.

**`presented` / `sold` / `discardReason` come stop: perfetto.** Su `presented` e
`sold` non c'è discussione: è la sola cosa che da sola impedisce di scrivere a un
cliente, e ieri è mancata per un soffio. `confermeOutcome: 'scartato'` invece
**non** è uno stop — quello dice solo che al telefono non l'abbiamo preso, ed è
il caso in cui vogliamo che rifissiate.

**Mehdi:** via libera confermato, e grazie di averlo fatto subito.

**I 39 del "giorno e ora":** ve li mandiamo. D'accordo sulla forma del ritorno:
il conto separato a coda finita ci basta.

---

## PARTE 3 — Le due cose che restano aperte

### 1. Il form di prenotazione è rotto, e tocca a voi

È la cosa più concreta rimasta, e vi chiediamo di metterci qualcuno.

Nelle vostre note di agosto ne abbiamo contate **circa 15 su 126** che descrivono
un fallimento del form, con le parole dei lead. Sei persone hanno **provato a
prenotare e non ci sono riuscite**:

- «Non mi fa scegliere martedì 18 agosto. **Mi manda a 1 settembre**»
- «Ho scritto una mail perché **non mi dà il giorno 10 nemmeno ricaricando la
  pagina**»
- «Sto compilando il form ma **esce solo martedì con orari la mattina**»
- «Non mi fa cliccare»
- «Lasciamo perdere»
- e Giulia Spizzico, che vi aveva scritto «confermo mercoledì 19 alle 12» e a cui
  il form non permetteva di selezionare nessuna data.

Non sono lead che hanno cambiato idea: sono lead che hanno detto sì e che il
software ha fermato. Sono anche gli unici del gruppo dove il recupero è quasi
garantito, perché il sì è documentato con parole loro.

Ci interessa sapere se è un bug di disponibilità del calendario (slot esauriti
non mostrati come tali), un problema di fuso, o un limite della finestra di
prenotazione. Se è il calendario che si svuota, quello si vede dal vostro lato
senza aspettare che ve lo dicano i lead.

**Sui 50 lead che avevano confermato**, il vostro conteggio era giusto (ne
troviamo 50: 36 con conferma esplicita, 14 con il form). Valore realizzato:
**zero** — zero presentati, zero vendite. Ma metà del danno è nostro: **14 di
loro non li ha mai chiamati nessuno** dopo il rientro. Un lead che torna dopo
aver confermato un appuntamento entrava in pipeline indistinguibile da un lead
freddo qualunque. La vostra segnalazione «AVEVA CONFERMATO E L'APPUNTAMENTO NON
C'È» è esattamente la cosa che serviva, ed è il contributo più utile del vostro
messaggio: da oggi quei lead sono marcati sulla card e ordinati per primi (vedi
sopra). Serve solo che ci mandiate il `motivo` giusto —
`conferma_senza_appuntamento` — altrimenti finisce in `altro` e la marcatura non
scatta.

### 2. "Irreperibile": non come regola, come test misurato

Qui la risposta non è quella che vi aspettate, e vi mettiamo davanti i numeri
perché possiate contestarli.

**Il conteggio, quasi giusto.** A noi risultano **811** irreperibili sui lead
passati dal bot, non 881 — «non interessato» 634 e «numero inesistente» 370
combaciano al pezzo, quindi sembra una trasposizione di cifre.

**Un chiarimento di perimetro che conta molto**, e che non avete dichiarato: i
vostri 2.626 sono i lead *passati dal bot*. Nel CRM i lead con una causale di
scarto sono **50.380**, di cui **20.843 irreperibili**. Se la regola vale su
tutto quello che vi mandiamo e non solo sul flusso corrente, la popolazione in
gioco è venti volte più grande. Diteci a quale insieme la applicate.

**Perché la vostra logica non ci convince.** Tre cose, in ordine di peso:

1. **Non è mai successo.** Nessun lead scartato è mai stato ri-pushato al bot: i
   casi "scartato → ripreso dal bot → appuntamento" sono **zero su 50.380**.
   Stiamo discutendo di un'ipotesi, non di un'evidenza.
2. **Il precedente che sembra darvi ragione non regge.** Fra gli irreperibili c'è
   il 2,0% di appuntamenti contro lo 0,10% dei "non interessato" — ma **in 417
   casi su 417 l'appuntamento è stato creato PRIMA dello scarto**. Sono persone
   che avevano fissato e poi sono sparite, non persone scartate e poi recuperate.
   Quel 2% misura solo che chi fissa e poi sparisce viene etichettato
   "irreperibile" invece che "non interessato".
3. **Lo scarto "irreperibile" arriva DOPO di voi, non prima.** Verificato su 810
   casi su 810: il lead entra, ve lo pushiamo, la chat non converte, torna ai
   GDO, i GDO lo chiamano 3-4 volte a vuoto, e allora viene scartato.
   Riscrivergli non è portare una popolazione nuova sul canale giusto: è
   ritentare esattamente la cosa che non ha funzionato la prima volta.

E il vostro unico argomento quantitativo si rovescia: gli irreperibili hanno
risposto in chat almeno una volta nel **35,5%** dei casi, ma i "non interessato"
nel **48,1%**. Se il criterio è la reattività su WhatsApp, giustificherebbe di
riscrivere prima ai non interessati che agli irreperibili — che nessuno dei due
vuole.

**La proposta: un test, non una regola.** Un lotto di **500 irreperibili che
hanno almeno una `chat_interrotta` alle spalle** — cioè persone con cui avevate
davvero parlato — ri-pushati, con misurazione a 30 giorni di appuntamenti,
presenze e vendite.

**La soglia la fissiamo adesso, prima di partire, così nessuno la sposta dopo:**
un appuntamento generato dal bot vale oggi **€149** (€45.327 di fatturato agosto
su 304 appuntamenti). Perché i 500 si paghino servono almeno **15 appuntamenti,
il 3%**. Sotto quella soglia chiudiamo, sopra la estendiamo a tutta la
popolazione — e a quel punto parliamo di 20.843 lead, che è una cosa seria.

Se il test va bene avete vinto voi con un numero in mano invece che con un
ragionamento, e vale molto di più.

---

## Un numero che vi dovevamo

Visto che `lead-status` ora ve lo fa vedere, tanto vale dirvelo per intero.
Appuntamenti creati in agosto 2026:

| | Appuntamenti | Confermati | Presentati | Scontrino medio |
|---|---|---|---|---|
| **Generati dal bot** | 304 | **19,7%** | **17,1%** | €2.833 |
| Generati dai GDO | 1.029 | 10,4% | 8,6% | €2.541 |

Gli appuntamenti del bot si confermano e si presentano al **doppio** del tasso di
quelli dei nostri GDO, con uno scontrino più alto. Non è un complimento di
circostanza: è il motivo per cui vale la pena chiudere il form e fare il test
sugli irreperibili invece di lasciar perdere.

---

## Riassunto

**Vivo da oggi da parte nostra:** `call-attempt` al 1° e 3° NR; il rifissaggio
che riapre lo scarto e rimette il lead sulla board; `CONTATTO_UMANO` mai più
rifiutato; `risposta_dopo_terzo_nr` e `conferma_senza_appuntamento` mappati, con
badge in pipeline e ordinamento per primi; il blocco `contattoUmano` su
`lead-status`; `personKey` e `previousLeadIds` nel push; la corsia Conferme con
il pallino rosso; i telefoni finti non assegnati; la guardia sulle riassegnazioni.

**Ci serve da voi, in ordine:**

1. **Il form**: cosa lo rompe e quando è sistemato.
2. **Sì o no al test sui 500 irreperibili**, con la soglia del 3% a 30 giorni. Se
   la soglia non vi convince, discutiamola adesso e non dopo.
3. **A quale insieme applicate lo stop su `discardReason`**: i lead passati dal
   bot, o tutto quello che vi mandiamo.
4. **Come va con Mehdi**, anche se dice NO.
5. Il **conto separato dei 39** quando la coda è finita.
6. Che usiate **`motivo: "conferma_senza_appuntamento"`** sulla segnalazione del
   sì confermato: è l'unico punto in cui il nome esatto cambia cosa succede da
   noi.

A presto,
