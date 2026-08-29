# Risposta al fornitore bot — 29/08/2026 (quinta)

*Bozza pronta da mandare. Chiude i punti aperti. Sull'eccezione "irreperibile"
la risposta non è quella che si aspettano, e il motivo è nei numeri.*

---

Ciao,

grazie per aver ritirato la frase sull'agenda in chiaro invece che lasciarla
scivolare: sapere che erano invii vostri da un nostro CSV chiude la questione e
spiega anche il doppio invio del 30-31 luglio. Su quello: oggi non può più
succedere allo stesso modo, il canale è uno solo e siete voi a deduplicare. Il
pulsante di reinvio dalla nostra parte resta libero di proposito — a volte un GDO
deve legittimamente rimandare l'agenda — e ci appoggiamo al vostro `deduplicato`.

Sui due riscontri: grazie di aver guardato riga per riga e di aver detto «li
abbiamo persi noi». Ne parliamo al punto 2, perché c'è dell'altro.

## 1. "Irreperibile": non ve la concediamo come regola, ve la concediamo come test

Abbiamo controllato prima di rispondere, e la vostra logica è ragionevole ma i
dati non la reggono. Ve li mettiamo davanti perché possiate contestarli.

**Il conteggio, quasi giusto.** A noi risultano **811** irreperibili sui lead
passati dal bot, non 881 — «non interessato» 634 e «numero inesistente» 370
combaciano al pezzo, quindi sembra una trasposizione di cifre. Sul resto siamo
d'accordo.

**Un chiarimento di perimetro che conta molto**, e che va messo nero su bianco: i
vostri 2.626 sono i lead *passati dal bot*. Nel CRM i lead con una causale di
scarto sono **50.380**, di cui **20.843 irreperibili**. Se la regola vale su
tutto il database e non solo sul flusso corrente, la popolazione in gioco è venti
volte più grande. Diteci a quale insieme la applicate.

**Perché non ci convince.** Tre cose, in ordine di peso:

1. **Non è mai successo.** Nessun lead scartato è mai stato ri-pushato al bot.
   Il numero di casi "scartato → ripreso dal bot → appuntamento" è **zero su
   50.380**. Non esiste un dato storico né a favore né contro: stiamo
   discutendo di un'ipotesi, non di un'evidenza.
2. **Il precedente che sembra darvi ragione non regge.** Fra gli irreperibili
   c'è il 2,0% di appuntamenti, contro lo 0,10% dei "non interessato" — sembra
   la prova che quella popolazione vale. Ma **in 417 casi su 417 l'appuntamento
   è stato creato PRIMA dello scarto**. Sono persone che avevano fissato e poi
   sono sparite, non persone scartate e poi recuperate. Quel 2% non misura il
   valore del recupero: misura che chi fissa e poi sparisce viene etichettato
   "irreperibile" invece che "non interessato".
3. **Lo scarto "irreperibile" arriva DOPO di voi, non prima.** Verificato su 810
   casi su 810: il lead entra, ve lo pushiamo, la chat non converte, torna ai
   GDO, i GDO lo chiamano 3-4 volte a vuoto, e allora viene scartato.
   **Riscrivergli non è portare una popolazione nuova sul canale giusto: è
   ritentare esattamente la cosa che non ha funzionato la prima volta.**

E il vostro unico argomento quantitativo si rovescia: gli irreperibili hanno
risposto in chat almeno una volta nel **35,5%** dei casi, ma i "non interessato"
nel **48,1%**. Se il criterio è la reattività su WhatsApp, giustificherebbe di
riscrivere prima ai non interessati che agli irreperibili — che nessuno dei due
vuole.

**La nostra proposta.** Non una regola permanente, un **test misurato**: un lotto
di **500 irreperibili che hanno almeno una `chat_interrotta` alle spalle** — cioè
persone che con voi avevano davvero parlato — ri-pushati, con misurazione a 30
giorni di appuntamenti, presenze e vendite.

**La soglia la fissiamo adesso, prima di partire, così nessuno la sposta dopo:**
un appuntamento generato dal bot vale oggi **€149** (€45.327 di fatturato agosto
su 304 appuntamenti). Perché i 500 si paghino servono almeno **15 appuntamenti,
il 3%**. Sotto quella soglia chiudiamo, sopra la estendiamo a tutta la
popolazione — e a quel punto parliamo di 20.843 lead, che è una cosa seria.

Se il test va bene avete vinto voi con un numero in mano invece che con un
ragionamento, e vale molto di più.

## 2. I 49 sono 50, e metà del danno è nostro

Il vostro conteggio è giusto: ne troviamo **50** (36 con conferma esplicita, 14
con il form). Ma guardando che fine hanno fatto è venuto fuori qualcosa che ci
riguarda più di voi.

**Valore realizzato: zero.** Zero presentati, zero vendite, su tutti e 50.

**E 14 di loro non li ha mai chiamati nessuno.** Ce li avete restituiti, sono
entrati in pipeline, e sono ancora lì fermi a zero chiamate. Non è colpa vostra:
è che un lead che torna dopo aver confermato un appuntamento entrava in coda
**indistinguibile da un lead freddo qualunque**. La vostra segnalazione «AVEVA
CONFERMATO E L'APPUNTAMENTO NON C'È» è esattamente la cosa che serviva, ed è il
contributo più utile del vostro messaggio.

Stima del mancato, con le assunzioni in chiaro: fra **€3.700 e €7.500** di valore
atteso (25-50 lead × €149). Non è la cifra che fa notizia, ma il punto non è la
cifra.

## 3. Il form di prenotazione è rotto, ed è la palla più grossa che ci siamo passati oggi

Questa è la cosa su cui vi chiediamo di mettere qualcuno domani mattina.

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

Ci interessa sapere: è un bug di disponibilità del calendario (slot esauriti che
non vengono mostrati come tali), un problema di fuso, o un limite della finestra
di prenotazione? Se è il calendario che si svuota, quello si vede anche dal
vostro lato senza aspettare che ce lo dicano i lead.

## 4. Sul non fissare senza il form: siamo d'accordo con voi

Avete ragione e non cambiate niente. Fissare a voce vorrebbe dire metterci in
agenda call che il calendario non ha, e ce ne accorgeremmo il giorno stesso.

La soluzione giusta è quella che avete già fatto — segnalare il sì confermato
**in aggiunta** all'esito, senza sostituirlo — più il form che funziona.

## 5. Le altre

**Mehdi**: perfetto, e grazie per averlo fatto subito. Facci sapere come va,
anche se dice NO.

**I 39**: ve li mandiamo. D'accordo anche sulla forma del ritorno: il conto
separato a coda finita ci basta, non serve il dettaglio riga per riga se ogni
lead esce comunque col suo esito.

**`e4ef3953`**: bene, chiuso.

**`presented` / `sold` / `discardReason` come stop**: perfetto. Su `presented` e
`sold` non c'è discussione — è la sola cosa che da sola impedisce di scrivere a
un cliente, e stamattina è mancata per un soffio.

## Riassunto

**Fatto da parte nostra oggi:** `CONTATTO_UMANO` non viene più rifiutato; il
rifissaggio riapre lo scarto e rimette il lead sulla board; il pallino rosso
sulla coda nei profili Conferme; `risposta_dopo_terzo_nr` mappato.

**Ci serve da voi:**

1. **Il form**: cosa lo rompe, e quando è sistemato. È la cosa più concreta
   rimasta.
2. **Sì o no al test sui 500 irreperibili** con la soglia del 3% a 30 giorni. Se
   la soglia non vi convince, discutiamola adesso e non dopo.
3. **A quale insieme applicate lo stop su `discardReason`**: i lead passati dal
   bot, o tutto quello che vi mandiamo.
4. Come va con **Mehdi**.

A presto,
