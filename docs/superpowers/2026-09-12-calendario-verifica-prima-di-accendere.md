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

---

# Parte 2 — Il muro sul fissaggio (branch `feat/fissaggio-vincolato`)

Da questo lavoro le Conferme possono fissare un appuntamento a un venditore **solo** su un'ora che lui ha dichiarato e non ha bloccato. Possono scavalcarlo scrivendo un motivo, che finisce nella scheda **Forzature** di `/calendari-venditori`. Admin e manager non sono soggetti. Gli impegni letti dal Google Calendar dei venditori sono stati tolti dall'agenda; la **creazione** degli eventi sul loro calendario resta e funziona anche sugli appuntamenti forzati.

## L'interruttore

`BOOKING_WALL=off` spegne il muro. Il muro nasce **acceso**: solo il valore esatto `off` lo spegne (`OFF`, `false`, `0` non bastano). Si cambia dal pannello Vercel senza un deploy.

## La decisione di accensione

Al 12/09, per la settimana del 14 avevano dichiarato le ore: Sales 002 (9), Sales 004 (13), Sales 008 (11); Sales 003 e Sales 010 **zero**. Sales 001 è esente. Le Conferme registrano 30-57 esiti "confermato" al giorno.

Accendere il muro contro un calendario così significa che quasi ogni appuntamento diventa una forzatura, e in mezza giornata "Fissa comunque" diventa il bottone normale — a quel punto la scheda Forzature registra il lavoro ordinario e il muro non vincola più niente.

**Guardare la scheda Compilazione lunedì dopo le 14:00 prima di decidere.**

## Cosa verificare dal vivo

1. Da **CONFERME**, su un venditore che ha dichiarato: fissare su un'ora dichiarata (passa senza attriti), su un'ora non dichiarata (muro + motivo + "Fissa comunque"), su un'ora che lui ha bloccato (muro), di domenica o alle 22 (muro "fuori griglia").
2. Su un lead **già confermato e assegnato**: cambiare **solo l'email** dalla scheda Dati e salvare. Deve passare senza chiedere un motivo: è il caso in cui il muro scattava a vuoto.
3. Riconfermare un lead **senza cambiare venditore**: deve passare. Riassegnarlo a un venditore **diverso**: il muro deve scattare.
4. Da **ADMIN** e da **MANAGER**: fissare su un'ora non dichiarata — nessun muro, nessuna riga in Forzature.
5. Dopo una forzatura: aprire `/calendari-venditori` → **Forzature** e controllare la riga (Conferma, lead, venditore, ora, motivo del rifiuto, motivo scritto); poi aprire il **Google Calendar del venditore** e verificare che l'evento sia arrivato.
6. Lasciare che il **bot** fissi un appuntamento da `/api/bot/outcome`: non deve essere respinto e non deve generare righe in Forzature.
7. Nell'agenda delle Conferme: sui giorni **futuri** devono comparire pastiglie verdi "Libero — HH:00" sulle ore dichiarate e libere; sui giorni **passati** resta la pastiglia grigia col bottone "Non c'era".

## Aperto — decisioni da prendere

1. **Le ore di oggi già passate non compaiono fra le pastiglie verdi.** Scelta dell'implementer, non richiesta: promettere "qui si fissa" su un'ora trascorsa sarebbe falso. Una riga da togliere se non convince.
2. **Le pastiglie verdi sono per venditore, non per ora**: con quattro venditori disponibili alle 18:00 la colonna mostra quattro pastiglie. Questione di densità, non un difetto.
3. **Nessun test automatico** sulle tre condizioni nuove del muro (confronto per slot, date fuori griglia, riconferma contro riassegnazione): vivono dentro server action e il progetto non ha mock. L'unica rete è la verifica manuale qui sopra.

---

# Parte 3 — Settimana tipo e griglia a default verde (branch `feat/settimana-tipo`)

La griglia si apre **piena** e si tolgono le ore che non vanno bene; una cella non scelta è rossa. Il "⋯" di ogni cella apre un menu a tre voci — Disponibile, Imprevisto, Non disponibile — con le ragioni scritte dentro il menu. E c'è la **settimana tipo**: un orario abituale impostato una volta, che il cron materializza in ore vere sulle settimane non ancora compilate.

**Decisione del PO (opzione B): la settimana tipo vale da sé.** Chi ne ha una risulta compilato in automatico e **non prende più la multa del lunedì**. Le ore materializzate sono dichiarazioni a tutti gli effetti: multabili 50 € per assenza, e prenotabili dalle Conferme.

## Gli interruttori, e come NON usarli

| Env | Spegne | Nasce |
|---|---|---|
| `SALES_CALENDAR_PENALTIES=off` | le multe del calendario | accesa |
| `SALES_CALENDAR_PENALTIES_FROM` | senza, nessuna multa | impostata al 14/09 |
| `BOOKING_WALL=off` | il muro sul fissaggio | acceso |
| `SALES_TEMPLATE_MATERIALIZE=off` | la materializzazione della settimana tipo | accesa |

Tutti col confronto stretto: solo il valore esatto `off` spegne.

**TRAPPOLA — leggere prima di toccare `SALES_TEMPLATE_MATERIALIZE`.** Il cron materializza **prima** di calcolare le multe. Spegnere la materializzazione di lunedì mattina significa che alle 14:00 viene multato chi contava sulla settimana tipo per essere in regola — persone che non hanno sbagliato niente.

Se serve spegnerla, **spegni nello stesso momento anche `SALES_CALENDAR_PENALTIES=off`**, e riaccendi le due insieme. L'interruttore del muro è invece indipendente e si può usare da solo.

## Cosa verificare dal vivo, da un account venditore vero

1. **Il caso che si rompeva.** Aprire una settimana mai compilata, non toccare niente, premere Salva. Deve funzionare e comparire la conferma con le ore dichiarate.
2. **Guardare quelle ore in faccia.** Il verde propone anche il sabato sera e le 21:00 di ogni giorno: ogni ora accettata vale 50 € se una Conferma segnala l'assenza. Il primo salvataggio di ciascuno va guardato **insieme a lui**, non scoperto alla prima segnalazione.
3. **Il modello non sovrascrive il lavoro a mano.** Con chi ha già compilato: impostare una settimana tipo diversa e verificare che la settimana già salvata resti identica, `fromTemplate = false`.
4. **Le settimane future si riempiono** e nessuna ora finisce nel passato.
5. **Cancellare il modello**: le settimane già riempite restano, e restano dichiarazioni della persona. Se questo sorprende chi lo prova, il testo va riscritto prima del rilascio.
6. **Il menu su quattro celle diverse** — libera, occupata, bloccata da follow-up altrui, a meno di 60 minuti — controllando che la ragione si **legga dentro il menu**. Una passata anche da tastiera: è per questo che il menu esiste.
7. **Il lunedì alle 14:00, in sequenza**: chi ha un modello non prende la multa, chi non ce l'ha e non ha compilato sì, e una sola. Far girare il cron una seconda volta e riverificare.
8. **Dal lato Conferme**: fissare su un'ora materializzata dal modello deve passare senza forzatura.

## Aperto — decisioni da prendere

1. **Race simmetrica**: il cron che inserisce il piano mentre un salvataggio umano è a metà. Non aggiunge ore a nessuno nella sequenza pericolosa (quella è chiusa), ma chiuderla del tutto richiede di riordinare `saveCalendarWeek`, la funzione che scrive per chi è già in produzione.
2. **`slotCount` ha due definizioni**: la materializzazione conta le sole ore future, il salvataggio a mano conta tutte le righe della settimana.
3. **Una settimana le cui ore sono tutte passate si può salvare a zero ore** con un click, e questo evita la multa del lunedì: la regola guarda l'esistenza del piano, non il numero di ore.
4. `getCalendarWeek` non verifica che l'id passato sia un venditore attivo del tenant (preesistente).
