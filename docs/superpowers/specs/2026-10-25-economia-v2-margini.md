# Economia v2: valori, scenari e margini

Data: 25/10/2026, sera. Ramo `feat/diretta-economia2`, partito da `feat/restyle-diretta`.
Decisioni di partenza: memoria `project_restyle_gdo_diretta.md` ("Decisioni 25/10 mattina, seconda tornata"), patto con Paolo (Doc "Paolo · Responsabile GDO, Conferme e HR"), bonus del 25/10.

Tutti i numeri delle tabelle escono dalle regole vere del codice (`src/lib/economy/rules.ts`), dal catalogo vero (`src/lib/diretta/negozioCatalogo.ts`) e dal modello degli scenari (`src/lib/economy/scenari.ts`), con dati di ottobre letti dal DB di produzione (solo SELECT). Se cambia un valore nelle regole, le tabelle si rifanno con lo stesso modello.

## In breve

- **Sullo stesso lead le Piume non si sommano più.** Vale lo stadio più alto: confermato 1, presentato 2, chiuso 4. Prima una chiusura valeva 1 + 2 (o 4) + 5 = 8-10 Piume, adesso 4. A parità di lavoro un GDO prende il **45% di Piume in meno**.
- **Le Scintille comprano lo stile, le Piume comprano le cose vere.** Caffè, pranzo e merenda non si comprano più con le Scintille, cioè con il solo volume di fissati: i premi che costano soldi si pagano solo con risultati verificati da Conferme e venditori.
- **I premi concreti chiedono da 1 a 10 settimane al massimo del patto.** Il corso costa 175 Piume, cioè **3,0 mesi** sempre al massimo del patto (7,4 appuntamenti per giornata, 12,7% di conferma). Un GDO medio ci mette 4,3 mesi.
- **Le Conferme guadagnano anche loro.** Scintille sulle conferme, pagate soprattutto quando il lead si presenta, di più se la conferma arriva con un'ora d'anticipo. Piume su due obiettivi settimanali: presenze (16 e 22) e chiusure (5 e 7). Una Conferma brava arriva al corso in 3,1 mesi.
- **Classifica dei primi tre** da lunedì a sabato: 50, 25 e 10 euro lordi. Ordine per presenze, poi fissati validi, poi alfabeto. L'admin registra i vincitori a settimana chiusa.
- **Costo totale**, negozio e bonus in euro: **1.307 euro al mese** con una squadra come quella di ottobre, **2.276** con tutta la squadra al massimo del patto. Si ripaga con **2,4 presenze in più al mese** nel primo caso e con **4,2** nel secondo, su 118 e 173 presenze del mese. Passare da ottobre al patto vale circa **+29.800 euro di margine al mese**, contro 968 euro di costo in più.

## 1. Le regole nuove

Tutti i valori stanno in `appSettings`, chiave `economy_rules` (JSON), e si cambiano senza deploy; quelli qui sotto sono i default. Un valore mancante o assurdo torna al default.

### 1.1 GDO: Scintille, il ritmo

| Cosa | Scintille | Regole |
|---|---|---|
| Fissato | 10 | Solo fissati validi (lead ancora in appuntamento), una volta per lead ogni 30 giorni, al massimo 15 al giorno. Se il GDO toglie l'appuntamento prima che le Conferme lo vedano, si stornano. |
| 1° scalino del giorno (8 fissati validi) | 20 | Si stornano se i fissati validi del giorno scendono sotto la soglia. |
| 2° scalino del giorno (10 fissati validi) | 60 | Come sopra. |
| Forziere raro (squadra a 55 al giorno o 14 nell'ora di punta) | 10-30 | Prima 20-60. Oppure, nel 5% dei casi, 1 Piuma. Solo a chi ha fissato almeno una volta in quel periodo. |
| Forziere leggendario (65 al giorno o 20 in punta) | 30-80 | Prima 60-150. Oppure, nel 20% dei casi, 1 Piuma. |

Invariati rispetto alla prima versione: fissato, tetto, regola dei 30 giorni, scalini. Più bassi: i forzieri.

### 1.2 GDO: Piume, vale lo stadio più alto

| Stadio del lead | Valore del lead | Quando sale si accredita | Quando scende si storna |
|---|---|---|---|
| Confermato (da una persona delle Conferme, non dal bot) | 1 | 1 | il gradino della conferma |
| Presentato (latch `presentedAt`) | 2 in tutto | 1 | il gradino della presenza |
| Chiuso | 4 in tutto | 2 | il gradino della chiusura |

Esempi:
- Lead confermato, presentato e chiuso: 4 Piume in tutto. Prima erano 1 + 2 + 5 = 8 (o 10 dalla 5ª presenza della settimana).
- Chiusura tolta perché l'esito è cambiato o il venditore è stato riassegnato: si stornano 2 Piume, il lead torna a valere 2.
- Appuntamento annullato dall'admin: si stornano tutti e tre i gradini. Se il lead torna in appuntamento e risale, si riaccredita con chiavi nuove.

Si toglie anche la Piuma in più dalla 5ª presenza della settimana: quella presenza la paga già il bonus di 12 euro, e premiarla due volte va contro la parsimonia.

Le Piume entrano solo se l'esito lo scrive lo staff (Conferme, venditori, manager, admin, ruolo letto dal DB) e mai il GDO stesso; contano gli esiti dal 26/10. Ogni gradino ha una chiave idempotente (`P:lead:<lead>:<gradino>`): doppio clic e due salvataggi simultanei accreditano una volta sola.

### 1.3 Conferme: Scintille per lead

Solo per il ruolo CONFERME letto dal DB, account attivo e non bot. Anche qui vale lo stadio più alto.

| Stadio | Scintille del lead | Note |
|---|---|---|
| Confermato **prima dell'ora dell'appuntamento** | 3 | Al massimo 12 conferme pagate al giorno a persona. |
| Presentato | 20 in tutto (+17) | La presenza la scrive il venditore. |
| Presentato, con conferma arrivata almeno un'ora prima | 26 in tutto (+23) | È la regola "lead gestiti in tempo". |

Perché così:
- **La conferma fatta a call iniziata non paga.** Fra il 7/9 e il 24/10 il 10% delle conferme delle Conferme è stato registrato dopo l'ora dell'appuntamento, e quei lead si sono presentati quasi tutti (34 su 35): il lead era già davanti al venditore. Serve al conteggio delle presenze del GDO, ma non è lavoro di conferma.
- **Il grosso si paga alla presenza**, cioè quando un altro (il venditore) certifica che la conferma era vera. Confermare a vuoto rende 3 Scintille, e con il tetto di 12 al giorno al massimo 36. Non c'è nessuno storno per un lead che non si presenta: niente perdite da spiegare, la presenza semplicemente non arriva.
- **"In tempo" vuol dire prima dell'appuntamento, non veloce.** Abbiamo scartato i lead lavorati all'ora e i minuti dall'arrivo in board: si gonfiano con i non risposto e con gli scarti, che alzano il conteggio senza un lead in più davanti al venditore. L'anticipo misurato sull'ora dell'appuntamento invece è il tempo che conta per il venditore, e lo paga solo una presenza vera. Nei dati: il 57% delle conferme e il 59% delle presenze confermate arrivano con almeno un'ora d'anticipo.
- **Chi conferma per primo tiene il lead.** Se un collega riconferma lo stesso lead (2 casi su 636 da agosto), il premio resta a chi l'aveva confermato. Se la conferma viene tolta e rifatta da un altro, passa a lui. Una conferma già pagata resta valida anche se poi viene risalvata a call iniziata, per esempio per cambiare venditore.
- **Chi conferma non si premia da solo.** Se l'esito del venditore lo scrive la stessa persona che ha confermato, quel lead per lei resta confermato e non presentato. Oggi le Conferme non scrivono esiti dei venditori (zero casi dal 7/9), ma la funzione lo permette.

### 1.4 Conferme: Piume sugli obiettivi della settimana

Settimana da lunedì a sabato, solo lead confermati dalla persona prima dell'appuntamento, con le stesse regole dei punti sopra.

| Obiettivo | 1° scalino | 2° scalino | Piume |
|---|---|---|---|
| Presenze della settimana | 16 | 22 | 3 al primo, altre 4 al secondo |
| Chiusure della settimana | 5 | 7 | 4 al primo, altre 5 al secondo |

Al massimo 16 Piume a settimana. Gli scalini si accreditano appena raggiunti e si stornano se il conteggio scende (chiusura tolta, presenza annullata). Si riallineano a ogni esito per la settimana in corso e per quella prima, e di nuovo quando l'admin registra i premi della settimana.

Le soglie sono uguali per tutti. Per chi fa le Conferme a metà tempo si possono abbassare solo per quella persona (`economy_rules.conferme.perPersona`): oggi non è impostato niente.

La colonna arancione delle Conferme ora mostra "Obiettivi della settimana" con lo stesso conteggio che decide le Piume.

### 1.5 Bonus in euro

| Bonus | Regola | Chi |
|---|---|---|
| Presenze GDO | 12 euro lordi per ogni presenza dalla 5ª della settimana, senza tetto | ogni GDO della squadra |
| Classifica | 1° 50, 2° 25, 3° 10 euro lordi; settimana lun-sab | i primi tre GDO, almeno una presenza |
| Conferme | oltre 16 chiusure di squadra nella settimana, 12 euro lordi a testa per ogni chiusura in più | chi ha confermato almeno un lead nella settimana |

Il bonus Conferme conta le chiusure dei lead confermati da un account Conferme, come la colonna arancione. Default impostati in `src/lib/conferme/bonus.ts`: chiusure, settimana, soglia 16, 12 euro.

### 1.6 A cosa servono le due monete

- **Scintille**: si guadagnano col ritmo (GDO) e con le conferme (Conferme). Comprano immagini profilo e personalizzazioni, che non costano niente all'azienda. Fissare tanto e male non porta a nessun premio che costa soldi.
- **Piume**: si guadagnano solo con risultati scritti da altri (conferme, presenze, chiusure). Comprano i premi concreti, i permessi e il corso.

## 2. Dati di partenza (ottobre 2026)

Letti dal DB di produzione con sole SELECT il 25/10. Squadra = GDO umani con un nome (fuori 108 e 201). Nessun nome di persona nelle tabelle.

### 2.1 GDO

| Misura (1-24/10) | Valore |
|---|---|
| Fissati in giornate operative (almeno 20 chiamate) | 852 in 123 giornate = **6,9 per giornata** |
| Giornate con 8 o più fissati | 48 su 123 (39%) |
| Giornate con 10 o più | 15 su 123 (12%) |
| Squadra al giorno | da 25 a 60 fissati, mai 65; 55 o più 2 giorni su 21 |
| Ora 18-19 di squadra | al massimo 10 fissati (mai 14) |
| Rifissati entro 30 giorni | 1 su 852 |
| Fissati ancora in appuntamento (validi) | 99,6% (849 su 852) |

Conversione sulla coorte dei fissati 1/9-17/10 (maturi):

| | Fissati | Confermati | Conferma | Presentati | Presenza | Chiusi | Chiusura |
|---|---|---|---|---|---|---|---|
| Fuori lancio | 1.160 | 100 | 8,6% | 92 | 92,0% | 22 | 23,9% |
| Lancio | 456 | 50 | 11,0% | 41 | 82,0% | 13 | 31,7% |
| Tutti | 1.616 | 150 | **9,3%** | 133 | **88,7%** | 35 | **26,3%** |

Il migliore della squadra conferma già il 12,7% dei suoi fissati, cioè il massimo del patto.

### 2.2 Conferme (squadra, 7 settimane dal 7/9 al 24/10)

| Misura a settimana | Media | Minimo | Massimo |
|---|---|---|---|
| Conferme fatte prima dell'appuntamento | 43,9 | 29 | 64 |
| Presenze di quei lead | 38,3 | 28 | 53 |
| Chiusure di quei lead | 12,1 | 7 | 15 |
| Chiusure di squadra secondo la regola del bonus | 14,0 | 9 | 19 |

Le chiusure di squadra sono state, settimana per settimana, 16, 17, 13, 9, 19, 15 e 9: sopra la soglia di 16 in 2 settimane su 7.

### 2.3 Margine

| Parametro | Valore | Fonte e verifica |
|---|---|---|
| Ticket medio fuori lancio | **3.278 euro** | Analisi del 24/10 (21/9-18/10, riconciliata col gestionale). Verifica sul CRM, 1-24/10: 32 chiusure fuori lancio, ticket 3.284 euro. |
| Chiusura dei presentati | **26%** usato negli scenari | 27,4% fuori lancio su tutti i canali (analisi del 24/10); 27,0% sul CRM dal 28/9 (31 su 115); i lead dei GDO chiudono meno: 23,9% fuori lancio, 26,3% con il lancio. |
| Margine per euro firmato | **0,638633** | Piano (IVA = C/6). Con l'IVA esatta 0,627049: i margini qui sotto scendono dell'1,8%. |
| Margine per chiusura | **2.093 euro** | 3.278 × 0,638633 |
| Margine per presenza | **544 euro** | 2.093 × 26% |
| Margine per conferma del GDO | 482 euro | 544 × 88,6% |
| Margine per fissato al massimo del patto | 61 euro | 12,7% × 88,6% × 26% × 2.093 |
| Costo azienda per euro lordo di bonus | **× 1,38** | Costo azienda di un GDO 1.804 euro al mese su 1.208,76 lordi × 13 mensilità. |
| Costo azienda di un'ora di GDO | 10,7 euro | 1.804 euro su 169 ore al mese (39 a settimana). |

## 3. Scenari

### 3.1 GDO

Il massimo del patto è il gradino più alto del Doc di Paolo: GDO-4 (7,4 appuntamenti per giornata) e CONF-4 (+2 punti sulla base del 10,7%, cioè 12,7%), con la presenza dei confermati della base (88,6%).

| Scenario | Fissati per giornata | Conferma | Presenza dei confermati | Chiusura dei presentati | Giorni con 8+ fissati | Giorni con 10+ |
|---|---|---|---|---|---|---|
| GDO medio (ottobre) | 6,9 | 9,3% | 88,7% | 26% | 38% | 10% |
| GDO alla linea del patto | 6,1 | 10,2% | 85,0% | 26% | 24% | 4% |
| GDO bravo | 7,9 | 10,7% | 88,6% | 26% | 58% | 21% |
| GDO al massimo del patto | 7,4 | 12,7% | 88,6% | 26% | 48% | 15% |
| GDO campione | 10,0 | 15,0% | 90,0% | 26% | 89% | 60% |

Il bravo fissa più del massimo del patto ma conferma meno: è il profilo dei migliori fissatori di ottobre. Il campione fa il secondo scalino quasi ogni giorno, come le settimane migliori di ottobre (60 fissati, 9 conferme, 8 presenze).

Ipotesi del modello: 6 giornate a settimana; fissati del giorno distribuiti attorno alla media con deviazione 2 (con 6,9 di media dà 38% di giornate da 8+, contro il 39% vero di ottobre); forzieri: raro nel 50% dei giorni e leggendario nell'11%, stima per una squadra di 8 GDO attivi che fissano come a ottobre (con 5-7 GDO a ottobre il 55 è arrivato 2 volte).

Una settimana:

| Scenario | Fissati | Conferme | Presenze | Chiusure |
|---|---|---|---|---|
| GDO medio (ottobre) | 41,4 | 3,85 | 3,42 | 0,89 |
| GDO alla linea del patto | 36,6 | 3,73 | 3,17 | 0,83 |
| GDO bravo | 47,4 | 5,07 | 4,49 | 1,17 |
| GDO al massimo del patto | 44,4 | 5,64 | 5,00 | 1,30 |
| GDO campione | 60,0 | 9,00 | 8,10 | 2,11 |

Quanto guadagna:

| Scenario | Scintille: fissati | Scintille: scalini | Scintille: forzieri | Scintille a settimana | Scintille al mese | Piume dai lead | Piume dai forzieri | Piume a settimana | Piume al mese |
|---|---|---|---|---|---|---|---|---|---|
| GDO medio (ottobre) | 414 | 81 | 86 | **581** | 2.517 | 9,0 | 0,28 | **9,3** | 40,4 |
| GDO alla linea del patto | 366 | 45 | 86 | **497** | 2.154 | 8,6 | 0,28 | **8,8** | 38,3 |
| GDO bravo | 474 | 146 | 86 | **706** | 3.059 | 11,9 | 0,28 | **12,2** | 52,8 |
| GDO al massimo del patto | 444 | 110 | 86 | **641** | 2.776 | 13,2 | 0,28 | **13,5** | 58,6 |
| GDO campione | 600 | 323 | 86 | **1.009** | 4.372 | 21,3 | 0,28 | **21,6** | 93,6 |

Le Piume seguono la qualità: il bravo prende più Scintille del massimo del patto (fissa di più) ma meno Piume (conferma meno).

### 3.2 Conferme

Conferma media = la squadra di settembre-ottobre divisa per due persone. Conferma brava = circa un terzo in più, cioè le settimane buone di chi lavora le Conferme a tempo pieno. I conteggi settimanali degli obiettivi oscillano attorno alla media come una Poisson.

| Scenario | Conferme fatte prima dell'appuntamento | Presenze | Di cui confermate con un'ora d'anticipo | Chiusure |
|---|---|---|---|---|
| Conferma media | 22 | 19 | 59% | 6 |
| Conferma brava | 30 | 26 | 65% | 8 |

| Scenario | Scintille: conferme | Scintille: presenze | Scintille: in tempo | Scintille a settimana | Scintille al mese | Piume: presenze | Piume: chiusure | Piume a settimana | Piume al mese |
|---|---|---|---|---|---|---|---|---|---|
| Conferma media | 66 | 323 | 67 | **456** | 1.977 | 3,5 | 4,8 | **8,3** | 35,9 |
| Conferma brava | 90 | 442 | 101 | **633** | 2.745 | 6,2 | 7,0 | **13,2** | 57,3 |

Probabilità degli scalini in una settimana: la media arriva a 16 presenze nel 79% delle settimane e a 22 nel 27%, a 5 chiusure nel 71% e a 7 nel 39%; la brava a 16 presenze nel 99%, a 22 nell'81%, a 5 chiusure nel 90%, a 7 nel 69%.

Le Conferme guadagnano come i GDO: la media come il GDO medio, la brava come il GDO al massimo del patto. Così lo stesso negozio vale per tutti.

### 3.3 Prima e dopo

| Scenario | Piume a settimana v1 (si sommano: 1 + 2 o 4 + 5) | v2 (stadio più alto: 1, 2, 4) | Differenza |
|---|---|---|---|
| GDO medio (ottobre) | 16,5 | 9,0 | -45% |
| GDO alla linea del patto | 15,5 | 8,6 | -45% |
| GDO bravo | 21,7 | 11,9 | -45% |
| GDO al massimo del patto | 24,1 | 13,2 | -45% |
| GDO campione | 39,0 | 21,3 | -45% |

La v1 conta la presenza a 2,4 di media (2 fino alla 4ª della settimana, 4 dalla 5ª).

## 4. Il negozio

### 4.1 Catalogo e tempi

Settimana al massimo del patto: 640 Scintille e 13,5 Piume (sezione 3.1). I testi non hanno tetti in euro.

| Premio | Prezzo | Settimane al massimo del patto | GDO medio | GDO alla linea | GDO bravo | GDO al massimo | GDO campione | Conferma media | Conferma brava |
|---|---|---|---|---|---|---|---|---|---|
| Corso Fenice Academy a scelta, regalabile | 175 Piume | 13,0 | 4,3 mesi | 4,6 mesi | 3,3 mesi | **3,0 mesi** | 1,9 mesi | 4,9 mesi | 3,1 mesi |
| Sabato libero, pagato (da approvare) | 135 Piume | 10,0 | 3,3 mesi | 3,5 mesi | 2,6 mesi | 2,3 mesi | 6,3 sett. | 3,8 mesi | 2,4 mesi |
| Cena con Bruno e Federico, offerta | 110 Piume | 8,1 | 2,7 mesi | 2,9 mesi | 2,1 mesi | 1,9 mesi | 5,1 sett. | 3,1 mesi | 1,9 mesi |
| Mezza giornata con un venditore (da approvare) | 55 Piume | 4,1 | 5,9 sett. | 6,2 sett. | 4,5 sett. | 4,1 sett. | 2,5 sett. | 6,6 sett. | 4,2 sett. |
| Merenda per la sala | 40 Piume | 3,0 | 4,3 sett. | 4,5 sett. | 3,3 sett. | 3,0 sett. | 1,9 sett. | 4,8 sett. | 3,0 sett. |
| Uscita 30 minuti prima (da approvare) | 28 Piume | 2,1 | 3,0 sett. | 3,2 sett. | 2,3 sett. | 2,1 sett. | 1,3 sett. | 3,4 sett. | 2,1 sett. |
| Pranzo offerto: un ordine su Glovo che arriva in ufficio | 28 Piume | 2,1 | 3,0 sett. | 3,2 sett. | 2,3 sett. | 2,1 sett. | 1,3 sett. | 3,4 sett. | 2,1 sett. |
| Caffè e cornetto | 14 Piume | 1,0 | 1,5 sett. | 1,6 sett. | 1,1 sett. | 1,0 sett. | 4 gg | 1,7 sett. | 1,1 sett. |
| Titolo «Voce della sala» | 1.900 Scintille | 3,0 | 3,3 sett. | 3,8 sett. | 2,7 sett. | 3,0 sett. | 1,9 sett. | 4,2 sett. | 3,0 sett. |
| Cornice Fenice | 1.300 Scintille | 2,0 | 2,2 sett. | 2,6 sett. | 1,8 sett. | 2,0 sett. | 1,3 sett. | 2,8 sett. | 2,1 sett. |
| Fenice d'oro (immagine) | 2.600 Scintille | 4,1 | 4,5 sett. | 5,2 sett. | 3,7 sett. | 4,1 sett. | 2,6 sett. | 5,7 sett. | 4,1 sett. |
| Fiamma viva (immagine) | 1.600 Scintille | 2,5 | 2,8 sett. | 3,2 sett. | 2,3 sett. | 2,5 sett. | 1,6 sett. | 3,5 sett. | 2,5 sett. |
| Civetta (immagine) | 650 Scintille | 1,0 | 1,1 sett. | 1,3 sett. | 6 gg | 1,0 sett. | 4 gg | 1,4 sett. | 1,0 sett. |
| Falco (immagine) | 480 Scintille | 0,8 | 5 gg | 6 gg | 4 gg | 4 gg | 3 gg | 1,1 sett. | 5 gg |
| Volpe (immagine) | 320 Scintille | 0,5 | 3 gg | 4 gg | 3 gg | 3 gg | 2 gg | 4 gg | 3 gg |
| Squalo (immagine) | 300 Scintille | 0,5 | 3 gg | 4 gg | 3 gg | 3 gg | 2 gg | 4 gg | 3 gg |

"gg" = giornate di lavoro, "sett." = settimane lun-sab. Fenice d'oro, Fiamma viva, il titolo e la cornice costano più settimane di caffè, pranzo e uscita anticipata: le immagini più rare valgono più di certi premi concreti, come chiesto. Le 200 Scintille di benvenuto di Riccardo e Zora valgono due terzi della Squalo.

### 4.2 Che cosa cambia rispetto al catalogo di prima

| Premio | Prima | Settimane al massimo, prima | Adesso | Settimane al massimo, adesso |
|---|---|---|---|---|
| Corso | 400 Piume | 16,4 | 175 Piume | 13,0 |
| Sabato libero | 180 Piume | 7,4 | 135 Piume | 10,0 |
| Cena | 120 Piume, per due fino a 70 euro | 4,9 | 110 Piume, con Bruno e Federico | 8,1 |
| Mezza giornata con un venditore | 60 Piume | 2,5 | 55 Piume | 4,1 |
| Uscita 30 minuti prima | 30 Piume | 1,2 | 28 Piume | 2,1 |
| Merenda per la sala | 1.500 Scintille | 2,1 | 40 Piume | 3,0 |
| Pranzo | 1.300 Scintille, fino a 15 euro | 1,8 | 28 Piume, Glovo in ufficio | 2,1 |
| Caffè e cornetto | 700 Scintille | 1,0 | 14 Piume | 1,0 |
| Titolo | 50 Piume | 2,0 | 1.900 Scintille | 3,0 |
| Cornice | 900 Scintille | 1,2 | 1.300 Scintille | 2,0 |

"Prima" misurato con le regole della v1 (24,4 Piume e 723 Scintille a settimana al massimo del patto). Il corso diventa un po' più vicino (era quasi 4 mesi, ora 3, come chiesto); tutto il resto si allontana, e i premi che costano soldi escono dalle Scintille. Spendendo tutto, un GDO medio costava circa 116 euro al mese di negozio con la v1 e ne costa circa 50 con la v2; al massimo del patto da circa 157 a circa 72.

## 5. Margine

### 5.1 Premi del negozio

| Premio | Prezzo | Costo stimato | Come | Presenze per ripagarlo | Chiusure per ripagarlo | Margine in più di un GDO al massimo (sulla linea) nel tempo per guadagnarlo | Costo su quel margine | Euro per Piuma |
|---|---|---|---|---|---|---|---|---|
| Corso Fenice Academy | 175 Piume | 300 € | costo vivo stimato (tutor e piattaforma), da confermare; listino 1.870-3.670 € | 0,55 | 0,14 | 12.861 € | 2,3% | 1,71 |
| Sabato libero | 135 Piume | 296 € | 6,5 ore pagate (69 €) + metà della produzione persa (227 €) | 0,54 | 0,14 | 9.921 € | 3,0% | 2,19 |
| Cena con Bruno e Federico | 110 Piume | 150 € | 3 persone a 50 € | 0,28 | 0,07 | 8.084 € | 1,9% | 1,36 |
| Mezza giornata con un venditore | 55 Piume | 113 € | nessuna ora in più pagata; metà della produzione persa in 3,25 ore | 0,21 | 0,05 | 4.042 € | 2,8% | 2,05 |
| Merenda per la sala | 40 Piume | 30 € | 8-10 persone | 0,06 | 0,01 | 2.940 € | 1,0% | 0,75 |
| Uscita 30 minuti prima | 28 Piume | 23 € | mezz'ora pagata (5 €) + metà della produzione persa | 0,04 | 0,01 | 2.058 € | 1,1% | 0,82 |
| Pranzo su Glovo in ufficio | 28 Piume | 20 € | scontrino medio di un ordine, consegna compresa | 0,04 | 0,01 | 2.058 € | 1,0% | 0,71 |
| Caffè e cornetto | 14 Piume | 3 € | al bar | 0,01 | 0,00 | 1.029 € | 0,3% | 0,21 |
| Immagini, titolo e cornice | Scintille | 0 € | digitali | 0 | 0 | - | - | - |

Come leggerla:
- **Produzione persa**: un GDO al massimo del patto produce circa 70 euro di margine per ora al telefono (1,14 fissati all'ora × 61 euro). Nei permessi contiamo metà di quella produzione, perché i lead non chiamati restano in coda e se ne recupera una parte. Se i lead non mancano mai, il costo vero è solo quello delle ore pagate.
- **Margine in più**: al massimo del patto un GDO fa 1,82 presenze in più a settimana rispetto alla linea, cioè circa 990 euro di margine. Il corso chiede 13 settimane a quel ritmo, quindi 12.861 euro di margine in più; il corso ne costa il 2,3%.
- **Euro per Piuma**: in media 1,23 euro, al massimo 2,19 (se tutte le Piume diventassero sabati liberi).
- **Corso**: il costo vero è quello di erogarlo, non il listino. Il valore di 300 euro è un'ipotesi da verificare. Se viene regalato a qualcuno che l'avrebbe comprato si perde una vendita (2.093 euro di margine); se va a un dipendente o a un esterno, il trattamento fiscale è da chiedere al consulente.

### 5.2 Bonus presenze dei GDO (12 euro dalla 5ª)

| Scenario | Presenze a settimana | Presenze pagate a settimana (attese) | Lordo a settimana | Lordo al mese | Costo azienda al mese | Presenze oltre la 4ª al mese | Margine di quelle presenze | Costo su quel margine |
|---|---|---|---|---|---|---|---|---|
| GDO medio (ottobre) | 3,42 | 0,49 | 5,8 € | 25 € | 35 € | 2,1 | 1.144 € | 3,0% |
| GDO alla linea del patto | 3,17 | 0,38 | 4,6 € | 20 € | 28 € | 1,7 | 905 € | 3,0% |
| GDO bravo | 4,49 | 1,08 | 13,0 € | 56 € | 78 € | 4,7 | 2.556 € | 3,0% |
| GDO al massimo del patto | 5,00 | 1,43 | 17,2 € | 75 € | 103 € | 6,2 | 3.382 € | 3,0% |
| GDO campione | 8,10 | 4,16 | 49,9 € | 216 € | 298 € | 18,0 | 9.801 € | 3,0% |

Ogni presenza pagata costa 16,56 euro all'azienda (12 × 1,38) e vale 544 euro di margine: il bonus si ripaga se almeno una presenza pagata su 33 è in più grazie a lui. Le presenze della settimana oscillano: anche un GDO medio passa la 4ª in qualche settimana.

### 5.3 Classifica dei primi tre

85 euro lordi a settimana, 368 al mese, 508 di costo azienda. **Si ripaga con 0,93 presenze in più al mese** (0,24 chiusure), per tutta la squadra. Si paga sempre, chiunque vinca: è l'unico bonus che non cresce con i risultati.

### 5.4 Bonus Conferme (oltre 16 chiusure di squadra, 12 euro a testa)

| Chiusure di squadra a settimana (media) | Chiusure oltre 16 (attese) | Lordo a testa a settimana | Lordo per 2 persone al mese | Costo azienda al mese | Margine delle chiusure oltre 16 al mese | Costo su quel margine |
|---|---|---|---|---|---|---|
| 10 | 0,05 | 0,7 € | 6 € | 8 € | 497 € | 1,6% |
| 12 | 0,25 | 3,0 € | 26 € | 35 € | 2.235 € | 1,6% |
| 14 (settembre-ottobre) | 0,72 | 8,7 € | 75 € | 104 € | 6.565 € | 1,6% |
| 16 | 1,59 | 19,0 € | 165 € | 228 € | 14.401 € | 1,6% |
| 18 | 2,84 | 34,1 € | 295 € | 408 € | 25.773 € | 1,6% |
| 20 | 4,41 | 52,9 € | 458 € | 632 € | 39.978 € | 1,6% |

Ogni chiusura oltre la soglia costa 33 euro all'azienda (24 lordi × 1,38) e vale 2.093 euro di margine.

### 5.5 Il totale del mese

**Mese come ottobre: 8 GDO medi, 2 Conferme medie**

| Voce | Al mese |
|---|---|
| Bonus presenze GDO (lordo) | 202 € |
| Classifica (lordo) | 368 € |
| Bonus Conferme (lordo, 12 chiusure di squadra a settimana) | 26 € |
| Bonus in euro: costo azienda (× 1,38) | 822 € |
| Negozio: 395 Piume al mese × 1,23 € | 485 € |
| **Totale** | **1.307 €** |
| Totale se tutte le Piume diventano sabati liberi | 1.688 € |
| Presenze in più al mese per ripagarlo | **2,4** |
| Chiusure in più al mese per ripagarlo | 0,62 |
| Presenze GDO del mese (squadra) | 118 |
| Costo sul margine delle presenze GDO del mese | 2,0% |

**Squadra al patto: 8 GDO al massimo del patto, 2 Conferme brave**

| Voce | Al mese |
|---|---|
| Bonus presenze GDO (lordo) | 596 € |
| Classifica (lordo) | 368 € |
| Bonus Conferme (lordo, 16 chiusure di squadra a settimana) | 165 € |
| Bonus in euro: costo azienda (× 1,38) | 1.559 € |
| Negozio: 583 Piume al mese × 1,23 € | 716 € |
| **Totale** | **2.276 €** |
| Totale se tutte le Piume diventano sabati liberi | 2.838 € |
| Presenze in più al mese per ripagarlo | **4,2** |
| Chiusure in più al mese per ripagarlo | 1,09 |
| Presenze GDO del mese (squadra) | 173 |
| Costo sul margine delle presenze GDO del mese | 2,4% |

Da ottobre al patto: +55 presenze al mese, circa +29.800 euro di margine, contro 968 euro di costo in più.

Il negozio è contato come se ogni Piuma venisse spesa: è un tetto, non una previsione. Le Scintille non costano niente. Le Piume dei forzieri sono comprese.

## 6. La classifica dei primi tre

- **Settimana**: da lunedì 00:00 a sabato 23:59, ora di Roma. La domenica non si lavora: la pagina mostra la settimana appena chiusa, e il lunedì tutto riparte da zero.
- **Ordine**:
  1. presenze della settimana: è il risultato su cui si paga anche il bonus da 12 euro, verificato da Conferme e venditori, e il GDO non lo può gonfiare da solo;
  2. a parità di presenze, i fissati validi della settimana, cioè i lead ancora in appuntamento: premia chi ha lavorato di più senza contare gli appuntamenti tolti;
  3. a parità anche di quelli, l'ordine alfabetico del nome: un criterio che tutti possono controllare e che non dipende da niente di discutibile. Con presenze e fissati identici capita di rado.
- **Chi**: i GDO della squadra (fuori 108 e 201). Per salire sul podio, e prendere il premio, serve almeno una presenza: chi ha zero presenze non vince euro per i soli fissati.
- **Cosa si vede**: solo i primi tre, con presenze e premio in euro. Chi non c'è vede quante presenze gli mancano per salire di una posizione, mai i numeri degli altri. Resta la lista "Fenici della settimana" (chi ha superato la 4ª presenza, in ordine alfabetico): non è una classifica, ma se si vuole davvero solo il podio si può togliere.
- **Registrazione**: dalla domenica l'admin apre `/admin/diretta/premi-settimana`, guarda l'anteprima e registra. Il calcolo salva una fotografia (vincitori, presenze, fissati, bonus presenze, bonus Conferme, chi pagare e quanto) che non cambia più, anche se dopo cambiano i lead. Ricalcolare una settimana registrata chiede una conferma esplicita. Conviene registrare il lunedì pomeriggio, dopo gli esiti arrivati in ritardo dal sabato.

## 7. Che cosa è implementato

| Parte | Dove |
|---|---|
| Regole e default, motore a gradini (stadi, scalini, obiettivi) | `src/lib/economy/rules.ts`, test in `rules.test.ts` (49) |
| Accrediti e storni: Piume del GDO a stadi, Scintille e obiettivi delle Conferme | `src/lib/economy/awards.ts` (`syncLeadPiume` resta il punto unico, già chiamato da Conferme, venditori, annullamento admin e riconciliazione) |
| Premi della settimana (conti, settimana lun-sab, snapshot) | `src/lib/economy/premiSettimana.ts`, `settimanaDb.ts`, test in `premiSettimana.test.ts` |
| Modello degli scenari | `src/lib/economy/scenari.ts`, test in `scenari.test.ts` |
| Action admin e pagina | `src/app/actions/premiSettimanaActions.ts`, `/admin/diretta/premi-settimana`, link da `/admin/diretta` |
| Classifica con premi e settimana lun-sab | `src/lib/diretta/squadra.ts`, `squadraActions.ts`, `SquadraDiretta.tsx` |
| Catalogo e testi | `src/lib/diretta/negozioCatalogo.ts` (test tarati sul modello), icona della cena in `NegozioDiretta.tsx` |
| Bonus Conferme | default in `src/lib/conferme/bonus.ts`; `/bonus` legge la configurazione vera; obiettivi nella colonna arancione |
| Migrazione | `drizzle/migrations/0049_premi_settimana.sql`: tabella `weeklyPrizeRuns` (solo aggiunta) |

Da fare al go-live, nell'ordine:
1. applicare la migrazione 0049 (senza, la pagina dei premi della settimana non registra; il resto funziona);
2. `npx tsx --env-file=.env.local scripts/diretta/negozio-catalogo.ts`, controllare l'elenco, poi `--apply`;
3. nessuna azione sui saldi: le regole nuove partono dal 26/10 come le vecchie.

Esempio di `economy_rules` da scrivere solo se si vuole cambiare qualcosa (tutto il resto resta al default):

```json
{
  "piume": { "conferma": 1, "presenza": 2, "chiusura": 4 },
  "conferme": { "perPersona": { "<id utente>": { "presenze": [10, 14], "chiusure": [4, 5] } } },
  "classifica": { "premiEuro": [50, 25, 10], "minPresenze": 1 }
}
```

## 8. Da decidere o verificare

1. **Costo vero del corso** (tutor e piattaforma): qui 300 euro.
2. **Account delle Conferme**: oltre ad Andrea e Alberto risultano attivi "Christel (Conferme)" e "Team Conferme". Non guadagnano niente se non confermano, ma conviene disattivarli.
3. **Soglie per chi fa le Conferme a metà tempo**: oggi uguali per tutti.
4. **Fenici della settimana** nella pagina Squadra: restano accanto al podio; da togliere se "solo i primi tre" vale anche per loro.
5. **Bonus Conferme e conferme a call iniziata**: il bonus in euro conta le chiusure di tutti i lead confermati dalle Conferme, anche quelli confermati dopo l'ora dell'appuntamento (circa il 10%). Le Scintille e le Piume delle Conferme invece non li contano.
6. Le stime dei forzieri dipendono da quanti GDO fissano davvero ogni giorno: con meno di 8 il forziere raro arriva più di rado e le Scintille scendono di circa 80 a settimana.
