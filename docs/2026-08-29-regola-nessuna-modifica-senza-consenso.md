# Messaggio al fornitore bot — la regola sulle modifiche, 29/08/2026

*Da mandare dopo la risposta sul form. È l'ultimo del giro.*

---

Ciao,

un'ultima cosa, e non è tecnica. Va detta chiara adesso che siamo entrambi
contenti di come è andata, non la prima volta che qualcosa va storto.

## Niente che tocchi un lead cambia senza il nostro consenso

Oggi avete messo in produzione parecchie cose di vostra iniziativa e poi ce
l'avete raccontate. Quasi tutte erano giuste, e alcune erano migliori di quello
che vi avevamo chiesto noi. Ma il metodo non regge, e vi diciamo perché con
l'esempio di stamattina.

**Stavate per scrivere a sei persone che erano nostre clienti da tre settimane.**
Il messaggio era pronto e sarebbe partito il mattino dopo. Non l'ha fermato una
vostra verifica né una nostra regola: l'ha fermato il fatto che per caso avevamo
incrociato quegli otto `leadId` con il nostro database mentre rispondevamo a
un'altra domanda. Se quel giorno avessimo risposto più in fretta, quelle sei
persone si sarebbero sentite chiedere di rifissare una call che avevano già fatto
e pagato.

Non è un rimprovero: ci avete chiesto il via libera e ve l'abbiamo negato, e il
sistema ha funzionato **quel giorno lì**. Il punto è che ha funzionato per
fortuna, e la fortuna non è un processo.

**Quindi, da adesso, la regola è una sola e non ha eccezioni:**

> Tutto ciò che arriva a un lead — un messaggio, un template, un cambio di
> orario o di frequenza, una regola nuova su chi viene contattato e chi no, un
> lotto rilavorato — **si concorda con noi prima di andare in produzione**.

Quello che succede dentro casa vostra resta vostro: architettura, modelli,
classificatori, come scrivete il codice, come deduplicate. Non ci interessa e non
vogliamo entrarci. La linea è semplice: **se lo vede un lead, o se cambia quali
lead vengono toccati, lo approviamo prima noi.**

Non è burocrazia. Quelle persone sono clienti nostri, il nostro nome è sui
messaggi che ricevono, e siamo noi a doverci presentare davanti a loro se
qualcosa va storto.

## Cosa vi chiediamo adesso, in concreto

1. **Mandateci l'elenco di tutto quello che avete messo in produzione oggi di
   vostra iniziativa.** Non per farvi un processo: per sapere cosa è vivo. Ci
   avete già detto lo stop su `presented`/`sold`/`discardReason`, la distinzione
   fra scrivere per primi e rispondere, il `CONTATTO_UMANO` su qualsiasi risposta
   dopo il 3° NR, il classificatore che riconosce il sì confermato, e
   `conferma_senza_appuntamento`. Se c'è altro, ditecelo.
2. **Se qualcosa di quello che è già acceso può far partire un messaggio verso
   una popolazione che non abbiamo concordato, mettetelo in pausa** e ne parliamo
   prima di riaccenderlo. Meglio due giorni fermi che una persona sbagliata
   contattata.
3. **Le tre code aperte non partono finché non ve lo diciamo**, una per una: gli
   otto (fermi, e restano fermi tranne Mehdi che avevamo approvato), i 39 del
   "giorno e ora", e qualunque riaggancio sugli irreperibili. Per i 39
   aspettate il nostro invio: non ricostruiteli da parte vostra.
4. **Le 12 segnalazioni arretrate**: ci avete scritto che erano «partite mentre
   scrivevamo». Non sappiamo dire se prima o dopo il nostro sì, ed è esattamente
   l'ambiguità che vogliamo togliere. Non è successo niente di male — erano
   segnalazioni verso di noi, non messaggi verso i lead — ma se fosse stato il
   contrario ce ne saremmo accorti dopo.

**Il modello giusto ce l'avete già dato voi**, ed è quello di Mehdi: *«Non
l'abbiamo ancora mandato — ve lo diciamo prima di farlo, non dopo»*. Fate sempre
così e non avremo mai un problema.

## E una cosa che riguarda il form, per non lasciare equivoci

**Su Calendly non abbiamo cambiato niente, e non è detto che lo cambieremo.**

Vi abbiamo scritto che valutiamo la finestra di prenotazione, e valutare vuol
dire valutare. Allargarla sposta le call più in là nel tempo, e più una call è
lontana meno gente si presenta: il 17,1% di presenza che vi abbiamo dato è
misurato **con** la finestra stretta di oggi, e non sappiamo ancora se allargarla
porti più prenotazioni che si presentano o più prenotazioni che evaporano.

Ve lo diciamo perché **non dovete adattarci il bot in anticipo**: non cambiate le
giornate che propone, gli orari, né la formula con cui le annuncia, dando per
scontato che la finestra si allargherà. Se e quando cambia, ve lo diciamo noi,
con la data.

## Chiudiamo

Detto tutto questo: è stata una giornata di lavoro seria da entrambe le parti.
Avete ammesso un errore in chiaro, avete trovato un nostro bug aprendo un form
che credevate vostro, e ci avete dato una distinzione migliore di quella che
avevamo scritto noi. Non è un rapporto che vogliamo irrigidire — vogliamo solo
che l'unica cosa che oggi è andata bene per fortuna vada bene per costruzione.

Aspettiamo l'elenco di cosa è vivo, e da lì ripartiamo.

A presto,
