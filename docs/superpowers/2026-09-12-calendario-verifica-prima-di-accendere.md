# Calendario disponibilità venditori — cosa verificare prima di accendere

Branch `feat/calendario-venditori`. Questo elenco raccoglie le verifiche dal vivo che **non** sono state fatte durante lo sviluppo, perché richiedono credenziali reali o scriverebbero multe vere su un database che è uno solo per sviluppo e produzione.

**La regola nasce spenta.** Finché `SALES_CALENDAR_PENALTIES_FROM` non è in produzione, non viene registrata nessuna multa. Si può quindi deployare, far compilare i calendari per una settimana e accendere le multe dopo.

## 1. La prova della multa non si cancella

Da account venditore, sulla settimana corrente:

1. dichiarare disponibile un'ora **già passata** di oggi e salvare;
2. provare a togliere la spunta da quell'ora e salvare di nuovo.

Atteso: la cella delle ore passate non è cliccabile, e in ogni caso il server non cancella quelle righe. Se il salvataggio riuscisse a toglierla, la multa da assenza diventerebbe opzionale per chi la riceve.

## 2. Il blocco retrodatato non annulla la multa

1. da account venditore, spostare un follow-up su un'ora **già trascorsa**;
2. da account Conferme, aprire l'agenda venditori su quello slot.

Atteso: `rescheduleFollowUp` rifiuta la data passata. Se passasse, il bottone "Non c'era" non deve comunque diventare grigio con "il venditore aveva avvisato": i blocchi nati dopo l'inizio dello slot non contano.

## 3. Le multe del calendario si vedono anche col malus ritardi spento

Con `SALES_LATE_PENALTIES=off` e il calendario acceso, aprire `/monitor-vendite`.

Atteso: la sezione "Ritardi e multe" mostra comunque le multe da 50 €, con il messaggio di vuoto che distingue quale delle due regole è sospesa.

## 4. Il caso Serenamente

Da account venditore, fare login scegliendo **Serenamente**, aprire `/mio-calendario` e salvare una settimana già compilata su Fenice.

Atteso: la settimana appare compilata e il salvataggio funziona. Le tre tabelle del calendario sono per-utente: il calendario di una persona è suo, non dell'azienda su cui ha fatto login.

**Difetto noto e non chiuso** (vedi §Aperto): la striscia della multa e il badge "trattenute" leggono `salesLatePenalties`, che è rimasta per-azienda. Un venditore su Serenamente **non vedrà** la propria multa da 50 €.

## 5. Le frecce delle settimane nel cambio d'ora

Aprire `/mio-calendario?settimana=2026-10-19` e premere "settimana successiva".

Atteso: avanza al 26 ottobre. Prima della correzione tornava al 19 e la freccia era morta per tutta quella settimana.

## 6. I due numeri della stessa persona

Dopo aver registrato a mano una multa calendario di prova, confrontare la dashboard del venditore e il Monitor Vendite.

Atteso, **ed è voluto che siano diversi**: il badge del venditore dice "trattenute questo mese" e include i 50 €; la colonna "Ritardi" del Carico per venditore conta solo i ritardi operativi. Due domande diverse, due numeri diversi, ciascuno etichettato per ciò che è.

## 7. Il ciclo di vita del blocco

Fissare un follow-up, poi rimuovere l'esito, poi far cancellare l'appuntamento da un admin.

Atteso: il lucchetto sparisce dalla griglia del venditore a ogni passaggio. Se resta, lo slot è occupato per sempre e non può più generare multe da assenza.

## 8. Il giro completo, dai tre ruoli

- **Venditore**: compila, salva, blocca uno slot a più di un'ora, prova a bloccarne uno a meno di un'ora (deve rifiutare spiegando), prova a bloccare uno slot con appuntamento dentro (deve rifiutare), apre "Copertura squadra" e vede le fasce scoperte.
- **Conferme**: apre l'agenda, vede la riga di copertura e le pastiglie dei blocchi, segnala un'assenza su uno slot passato e dichiarato, riprova (deve rifiutare).
- **Admin**: apre `/calendari-venditori`, vede chi non ha compilato, annulla una multa con motivo, e verifica che sparisca dai totali anche su `/monitor-vendite`.

## 9. Accensione

1. `git push` e attendere il deploy.
2. La migrazione `0034_sales_calendar` è **già applicata** al database.
3. Quando si decide di accendere le multe, impostare **in produzione** su Vercel (progetto `crm-sales-fenice`):
   - `SALES_CALENDAR_PENALTIES_FROM` = il lunedì da cui la regola vale, ISO con offset (es. `2026-09-21T00:00:00+02:00`);
   - `SALES_CALENDAR_PENALTIES` non va impostata: serve solo per spegnere (`off`).

Finché quella env non è in produzione la sezione multe resta vuota **per progetto, non per guasto**. È la lezione del malus ritardi, che a settembre sembrò rotto per giorni solo perché la variabile non era stata messa.

---

## Aperto — decisioni da prendere

1. **`salesLatePenalties` resta per-azienda mentre il suo indice unico non lo è.** Un venditore loggato su Serenamente non vede la propria multa da 50 € (né striscia né badge), e una Conferma che segnala da Serenamente uno slot già segnalato da Fenice riceve un errore di unicità invece del messaggio corretto. Preesistente al lavoro sul calendario; la stessa asimmetria chiusa sulle tre tabelle nuove.
2. **Il tooltip sulla cella passata non si vede in Chrome**, che non disegna i titoli sugli elementi disabilitati: il venditore clicca un'ora già trascorsa, non succede nulla e non legge il perché. È l'unico difetto residuo che produce la sensazione "l'app è rotta".
3. **`slotCount` nella scheda Compilazione** ora conta le righe rimaste a DB (ore passate incluse), non quelle inviate: una settimana svuotata a metà settimana non mostrerà più `0`.
4. **Uno slot dichiarato e poi non salvato a cavallo dell'ora** viene scartato in silenzio con `success: true`.

## Fuori perimetro, scoperto strada facendo

- **`saveVenditoreOutcome` non ha alcun controllo di proprietà del lead**, per nessun ruolo: un venditore può registrare l'esito su un lead assegnato a un altro. Preesistente. Il raggio d'azione si è allargato, perché quella funzione ora scrive anche sui blocchi del calendario del venditore titolare.
- **`weekBoundsRome`** (`src/lib/dateUtils.ts`) riusa l'offset del giorno in ingresso per costruire il lunedì: nelle due domeniche del cambio d'ora sbaglia di un'ora, per tutti i suoi chiamanti. Il calendario non ne è affetto.
