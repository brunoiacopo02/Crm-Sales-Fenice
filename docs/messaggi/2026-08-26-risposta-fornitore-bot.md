# Risposta al fornitore del bot — 26 agosto 2026

Ciao,

grazie del punto, è il messaggio più utile che ci siamo scambiati finora. Ho verificato
tutto sul nostro database prima di rispondervi: sui numeri principali siamo d'accordo, su
tre punti no, e su due cose che ci chiedete eravate voi a non sapere che erano già pronte.
Parto da quello che abbiamo fatto oggi, così sapete cosa potete già usare.

---

## 1. Fatto oggi, è già in produzione

### a) I dati dopo l'appuntamento — è la vostra richiesta principale, ed è aperta

Avete ragione sul merito: fermandovi al momento in cui l'appuntamento viene preso,
l'unica cosa che potete ottimizzare è il **numero** di appuntamenti. Si può farlo
crescere peggiorando il risultato, e nessuno se ne accorgerebbe.

Abbiamo scelto la strada che non aggiunge macchinari a nessuno dei due: invece di un
canale di eventi con code, retry e ordini da ricostruire, un **endpoint in lettura** che
interrogate voi.

```
POST https://crm-sales-fenice.vercel.app/api/bot/lead-status
x-bot-signature: sha256=<hmac del body grezzo, lo stesso segreto di /api/bot/outcome>

{ "since": "2026-08-01T00:00:00+02:00", "limit": 200 }
```

Torna, per ogni lead che il bot ha lavorato: stato, appuntamento e data, **esito delle
Conferme** (confermato / scartato / da rifissare, con la causale), **presenza alla call**,
**esito della trattativa** (Chiuso / Non chiuso / Sparito), **venduto sì/no, prodotto e
importo**, più la causale di scarto per chi non fissa. Le righe arrivano in ordine di
aggiornamento: finché `hasMore` è `true` richiamate con `since = nextSince`, poi tornate
più tardi. Un giro ogni 15-30 minuti basta.

Sono tutte e sette le voci della vostra tabella. La specifica completa è la **Direzione 5**
del contratto aggiornato che vi allego.

Due avvertenze che vi risparmiano un bug:
- la presenza è **latchata**: una volta vera non torna falsa, uno "Sparito" a un follow-up
  successivo non cancella una presenza già avvenuta;
- una riga può ricomparire più volte: è uno **stato corrente da sovrascrivere**, non un
  evento da accumulare.

Escono solo i lead che il bot ha davvero lavorato (push consegnato o agenda recapitata):
non è un export del CRM.

### b) I lead che chiedono di parlare con una persona

Qui avevate ragione, e il dato reale è peggiore del vostro: nel nostro database le
richieste sono **53 e ne è stata lavorata una sola**. La notifica c'era, ma una campanella
non è una coda — se in quel momento non la vede nessuno, il lead resta fermo per sempre.

Da oggi c'è una sezione dedicata dove un amministratore vede la coda ordinata per attesa,
legge le parole esatte del lead e con un bottone sceglie **quale GDO lo richiama**. Le 53
richieste storiche le abbiamo già recuperate noi dal database e sono in coda: **non serve
che ce le rimandiate**. Da qui in avanti bastano quelle nuove.

Per renderle lavorabili ci servono i due campi che ci avete proposto voi. Sono
**opzionali** — una richiesta senza di essi entra comunque in coda — ma senza chi chiama
parte alla cieca:

```jsonc
{
  "outcome": "CONTATTO_UMANO",
  "leadId": "…",
  "note": "Mi puoi chiamare? Vorrei capire meglio i costi",   // le parole del lead
  "motivo": "prezzo",                                          // categoria chiusa
  "info": {
    "sintesi": "Interessata al percorso, blocco sul prezzo",
    "disponibilita": "dopo le 18",
    "telefonoPreferito": "+39…",
    "urgenza": "alta",
    "argomenti": ["rateizzazione", "durata"]
  }
}
```

Categorie di `motivo`: `richiamo`, `prezzo`, `programma`, `sfiducia_bot`,
`problema_tecnico`, `disdetta`, `altro`. Non serve che coincidano con le vostre sette:
normalizziamo noi maiuscole, spazi e sinonimi, e un valore che non riconosciamo diventa
`altro` — **mai un 400**. Una categoria sbagliata è un fastidio, una richiesta persa è un
lead perso.

Una nota sul conteggio: la vostra richiesta più vecchia risulta del 27 luglio, ma da noi
il primo `CONTATTO_UMANO` è arrivato l'**8 agosto** — l'esito non esisteva prima del 5.
Quella di luglio non ci è mai arrivata.

### c) Le due modifiche di contratto che ci avete chiesto

**RICHIAMO senza data certa: concesso, è già attivo.** Avete ragione, e il fatto che su 26
richiami 22 cadessero su ore tonde mai pronunciate da nessuno lo dimostra. Ora:

```json
{ "leadId": "…", "outcome": "RICHIAMO", "periodo": "a settembre", "note": "Riprende dopo le ferie" }
```

`periodo` è testo libero e sostituisce `date`. Se non mandate né l'uno né l'altro: 400.

**`noteOnly` sull'APPUNTAMENTO: non serve, e il problema vero è un altro.** L'idempotenza
c'è già dal 10 luglio: un `APPUNTAMENTO` su un lead già appuntato riceve
`{ ok: true, deduped: true }` e **non scrive niente** — non "viene risegnato". Il difetto
era il rovescio, e non l'avevate visto: quando ci mandavate una **data diversa**, la
scartavamo in silenzio e le Conferme chiamavano per un orario che il lead aveva già
spostato. Da oggi conta la data: stessa data → `deduped` come prima; data diversa →
aggiorniamo l'appuntamento, avvisiamo le Conferme e rispondiamo
`{ ok: true, rescheduled: true }`. Il rifissaggio non viene contato come un fissaggio
nuovo, altrimenti un lead spostato tre volte comparirebbe tre volte fra gli appuntamenti
presi oggi.

---

## 2. Tre cose su cui non siamo d'accordo

### Le 44 ore fra fissaggio e call non sono le vostre

È la vostra "causa numero uno delle disdette" e il numero non regge. Misurato sui nostri
dati, ultimi 30 giorni, mediana fra il momento in cui l'appuntamento viene preso e
l'orario della call:

| chi fissa | mediana |
|---|---|
| il bot | **66,8 ore** |
| i GDO umani | **42,1 ore** |

Il bot fissa **più lontano** di una persona, di quasi un giorno intero. Le 44 ore
descrivono la popolazione umana, non la vostra. Se l'attesa è la causa principale delle
disdette, la prima leva è quale slot propone Marta in chat, e sta dalla vostra parte:
prima di chiederci disponibilità più ravvicinate, chiudiamo il divario con quello che i
GDO ottengono già oggi sulla stessa agenda.

### L'avviso di consegna dell'agenda funziona da tre settimane

Ci chiedete l'OK sul payload e l'URL come se il canale fosse fermo. Non lo è: dall'**8
agosto** riceviamo i vostri avvisi, **117 finora**, l'ultimo poche ore fa. Il payload che
usate — `leadId`, `esito`, `sid`, `at` — è esattamente quello giusto, l'endpoint è
`https://crm-sales-fenice.vercel.app/api/bot/agenda-delivery` ed è idempotente: agisce solo
sulla transizione `inviato → consegnato`, qualunque altro caso risponde 200 senza
scrivere. **Non serve nessuna finestra di deduplica**: mandate pure i 239 arretrati quando
volete, toccheranno solo gli 85 lead ancora fermi su `inviato`.

Stesso discorso per l'invio agenda per conto dei GDO: il canale è acceso dal 31 luglio
(800 agende consegnate) e le NOTE su lead non assegnati al bot sono ammesse dal 5 agosto.
Se da voi risulta spento, la variabile da accendere è vostra.

### I tre lead di giugno: risposta invariata dal 25 luglio

Allasia era un bug vostro, mentre Carobia e Daniela le ha scartate **il vostro bot** con
obiezione ferrea. Da noi risultano tutti e tre scartati. Non ripristiniamo appuntamenti a
posteriori: se sono ancora vivi, mandate un `APPUNTAMENTO` nuovo con una data futura e
rientrano dalla porta principale.

---

## 3. Le vostre altre domande

**I 127 esiti rifiutati con 403.** Mandateceli come `NOTA`: costa poco a entrambi e
smettiamo di perdere informazione su lead che il bot ha lavorato davvero. Ricordo che i
403 non sono contabili da noi — una richiesta rifiutata non lascia traccia a database — e
quindi il vostro conteggio resta l'unica misura che abbiamo.

**Gli 873 lead "postino".** Avete ragione che non sono lead abbandonati: sono agende
consegnate su appuntamenti fissati dai GDO. Li chiudiamo noi, non serve che li
classifichiate.

**La query "lead fermi al bot".** La vostra critica è fondata, il CSV del 6 agosto
misurava anche l'assegnazione. Con il criterio stretto — assegnato all'account bot **e**
ancora senza esito — oggi sono **295**, di cui **119 oltre i 12 giorni** e 46 oltre i 20;
il più vecchio è del **22 giugno**. Su questi la domanda resta la stessa: la sequenza è
finita e non li avete né chiusi né restituiti.

**Il report quindicinale.** D'accordo sulla data di assegnazione: le nostre statistiche
sono già costruite così (la coorte è il primo contatto del bot nella finestra, non la data
dell'esito).

**Ri-fissare chi chiede di spostare.** Sì, e per i lead già appuntati il canale ora esiste:
mandate `APPUNTAMENTO` con la data nuova (vedi sopra) invece di dire "ti ricontatta una
collega".

---

## 4. Quello che ci avete detto voi, e che ci torna

La **resa a 4 giorni** dal 24/08 la vediamo: i lead restituiti sono passati da 75-95 al
giorno a 251 il 24 e 261 il 25. Nessun allarme da parte nostra, il motivo è chiaro.

E un dato che vale la pena dirsi: sugli appuntamenti i nostri due database concordano quasi
perfettamente — voi 352 totali e 288 negli ultimi 30 giorni, noi 357 e 287. Vuol dire che
il contratto regge e che possiamo discutere di merito invece che di numeri.

A presto,
Bruno
