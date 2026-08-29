# Ultima risposta al fornitore bot — il form, 29/08/2026

*Breve. Chiude il giro.*

---

Ciao,

una correzione che ci dobbiamo, e poi siamo a posto.

## Il form è nostro, e ve l'avevamo chiamato vostro

Avete ragione: è **Calendly**, ed è configurato da noi. In tutti i messaggi di
oggi ve l'abbiamo chiamato «il vostro form di prenotazione» — era sbagliato, e
per fortuna l'avete aperto lo stesso invece di rimandarcelo indietro. Grazie di
aver fatto il lavoro al posto nostro su una cosa che era nostra.

## I vostri numeri li confermiamo, con scostamenti minimi

Abbiamo rifatto il conto dal nostro lato, e viene lo stesso quadro:

| | voi | noi |
|---|---|---|
| call fissate dal bot in agosto | 312 | **276** |
| prima delle 15:00 | 34% | **30,4%** (84 su 276) |
| media al giorno | 13,6 | **12,0** |
| giorno peggiore (18/08) | 98 | **81** |
| giorni sopra le 7 fasce | 13 su 23 | **9 su 23** (6 anche sopra 13) |

Gli scostamenti vengono da come attribuiamo gli appuntamenti (noi contiamo quelli
dell'account bot, voi probabilmente tutte le call che avete fissato, spostamenti
compresi). Non cambiano niente: la conclusione regge in entrambe le versioni.

**E c'è un numero che chiude il ragionamento meglio di tutti: l'ora delle 15:00
da sola contiene 69 delle 276 call.** Un quarto di tutto quello che il bot fissa
in un mese sta in una singola fascia — la prima del primo giorno disponibile. Non
è che i lead preferiscano le 15:00: è l'unica cosa che il form offre per primo, e
ci finiscono tutti dentro. È la prova più pulita che la finestra sta guidando il
comportamento invece di assecondarlo.

## Cosa facciamo, e in che ordine

Prendiamo tutte e tre le vostre osservazioni e le trattiamo come nostre, perché
lo sono:

1. **La finestra a due giorni**: la allarghiamo. È la causa di tutto il resto e
   la più semplice da correggere.
2. **La freccia che salta di mese**: è il comportamento standard quando non c'è
   nessun giorno disponibile nel mese — salta al primo mese con qualcosa, e se
   sono tutti vuoti continua a saltare. Sparisce da sola quando la finestra si
   allarga, ma la verifichiamo comunque perché è quella che i lead descrivono
   con parole loro.
3. **Le fasce del primo giorno (7 contro 13)**: la guardiamo. Non è una scelta
   che abbiamo mai fatto consapevolmente, quindi molto probabilmente è un effetto
   del preavviso minimo di prenotazione che mangia la mattina del giorno dopo.

**Sul tetto giornaliero siamo d'accordo con voi: non mettetelo.** Avete
ragione anche sul motivo — il collo di bottiglia non è quante call fissate, è
quante il form ne lascia prenotare. Ridurre gli appuntamenti per farli stare
dentro un bug sarebbe il modo peggiore di chiuderlo. Sistemiamo il form.

Vi diciamo quando è fatto, così potete rifare la prova dei trenta secondi e
dirci se da fuori si vede uguale a noi.

## Sul resto: d'accordo, e una cosa che ci piace più della nostra

**La distinzione fra scrivere per primi e rispondere è migliore della regola
secca che vi avevamo dato**, e la prendiamo così com'è. Avevamo ragionato solo
sul bot che scrive di sua iniziativa, e non avevamo visto il caso opposto: una
persona che ha già comprato scrive a Marta e non le risponde nessuno. Ottantasette
chat vive con un messaggio negli ultimi 14 giorni non è un dettaglio.

E il `CONTATTO_UMANO` al posto del silenzio è esattamente la cosa giusta: da
stamattina non lo rifiutiamo più in nessun caso, quindi quelle segnalazioni
arrivano tutte, anche sui clienti e sui presentati dove prima la guardia le
avrebbe respinte. Il pezzo che avevate chiesto e il pezzo che abbiamo tolto si
incastrano senza che nessuno dei due l'avesse pianificato.

**Il test sui 500 in stand-by: giusto, ed è la decisione che avremmo dovuto
prendere noi.** Misurare gli irreperibili adesso vorrebbe dire misurare il form,
e uscirne con un "no" che non vuol dire niente ma che chiude la domanda per
sempre. La soglia resta scritta: 15 appuntamenti su 500 a 30 giorni, lotto preso
fra chi ha una chat ancora aperta. Quando il form è sistemato, decidiamo se
farlo.

**`conferma_senza_appuntamento`**: perfetto. Una parola di differenza e non
sarebbe scattato niente, in silenzio — ed è il motivo per cui l'avevamo scritto
per esteso.

**Mehdi**: aspettiamo, e grazie di dircelo comunque vada.

**I 39**: ve li mandiamo.

---

Chiudiamo qui. Da una parte e dall'altra sono uscite quattro cose in produzione
e quattro convinzioni sbagliate — tre nostre e una vostra — e nessuna delle due
squadre le ha difese oltre il punto in cui i dati dicevano il contrario. È
l'unica cosa che rende utile scriversi così a lungo.

A presto,
