# Esiti registrati senza telefonata — analisi, agosto 2026

Documento interno. Redatto il 2026-08-25, **rifatto integralmente il 2026-08-26**
incrociando i tabulati del centralino telefonico dell'ufficio con gli esiti
registrati nel CRM.

**Contiene valutazioni su una persona identificabile. Prima di usarlo va letta la
sezione "Cosa questa analisi NON dimostra".**

> **Nota sulla revisione del 26 agosto.** La prima stesura misurava il fenomeno in
> tre modi diversi chiamandoli tutti allo stesso modo ("esiti senza chiamata"), e i
> numeri di testata non erano confrontabili con quelli delle tabelle. Qui sotto la
> misura è **una sola, dichiarata in apertura**, e tutti i numeri sono ricalcolati
> su una finestra temporale pulita. Le conclusioni non cambiano: si rafforzano.

---

## 1. In due righe

Nei primi 24 giorni di agosto il GDO 115 (Clara) ha registrato nel CRM **2.333
esiti a fronte di 1.423 telefonate realmente partite dal centralino**. Il
**34,8% dei suoi esiti non ha una telefonata a quel numero in quella giornata**,
contro lo 0,7-6,2% di tutti gli altri operatori: cinque volte e mezza il secondo
peggiore.

**Nessun appuntamento e nessun richiamo risulta inventato.** Tutti e 73 gli
appuntamenti e tutti e 85 i richiami hanno una telefonata dietro, lo stesso
giorno. Lo scostamento è interamente su "non risposto" e "da scartare".

## 2. La misura usata, e perché questa

Lo stesso fenomeno si può misurare con tre metri diversi, dal più severo al più
generoso. Vanno tenuti distinti, perché rispondono a tre domande diverse:

| Metro | Domanda a cui risponde | GDO 115 | Resto della squadra |
|---|---|---|---|
| Esiti in più rispetto alle chiamate | Quanti esiti in più delle telefonate? | +910 | da −121 a +141 |
| Esiti senza una chiamata **a quel numero in quel giorno** | Quanti esiti non hanno un tentativo quel giorno? | **812 (34,8%)** | 0,7-6,2% |
| Esiti su numeri **mai chiamati da nessuno in sei mesi** | Quanti sono lead che nessuno ha mai provato? | 280 (12,0%) | 0,1-1,6% |

**In questo documento si usa il metro di mezzo**, e ogni percentuale che segue è
calcolata così: *l'esito è "scoperto" quando nei tabulati non esiste alcuna
chiamata a quel numero in quella giornata, da parte di nessun operatore.*

Il primo metro (la sottrazione) **non va usato per parlare con una persona**: è un
saldo, non un conteggio di casi, e un esito in più può nascere anche da un secondo
esito legittimo sullo stesso tentativo. Il terzo è il più difficile da contestare,
ma è anche il più generoso: assolve chi ha chiamato quel numero una volta in
marzo. I tre numeri sono coerenti fra loro e raccontano la stessa cosa a tre
livelli di severità.

## 3. Come è stata fatta

Il centralino FreePBX dell'ufficio conserva il tabulato di ogni chiamata: orario,
numero chiamato, durata, esito tecnico. Sono stati importati nel CRM i tabulati da
marzo ad agosto 2026 (144.117 chiamate) e collegati agli operatori tramite la
tabella degli interni. I numeri si agganciano confrontando le **ultime dieci
cifre**, per essere indipendenti da prefissi e formattazione.

**Finestra: dal 1 al 24 agosto 2026 compresi.** L'ultimo export dei tabulati si
ferma al 25 agosto alle 16:02, quindi ogni esito registrato dopo quell'ora
risulterebbe "senza chiamata" solo perché la telefonata non è ancora stata
importata. Il 25 e il 26 agosto sono esclusi per questo motivo, non per
convenienza. **Chiunque rifaccia questi conti su un periodo che arriva a oggi
otterrà numeri gonfiati**: è la trappola principale di questa analisi.

Sono esclusi gli esiti su lead con numero di telefono malformato (meno di dieci
cifre): 9 casi in tutto il mese.

## 4. Il confronto con la squadra

Finestra 1-24 agosto. "Scoperti" = nessuna chiamata a quel numero in quel giorno.

| GDO | Esiti | Chiamate | Rapporto | Scoperti | **% scoperti** | Mai chiamati |
|---|---|---|---|---|---|---|
| **115 Clara** | 2.333 | 1.423 | **1,64** | 812 | **34,8%** | 12,0% |
| 119 Riccardo | 1.284 | 1.251 | 1,03 | 80 | 6,2% | 1,6% |
| 107 Giulia | 1.415 | 1.363 | 1,04 | 70 | 4,9% | 1,2% |
| 117 Simone | 2.000 | 2.000 | 1,00 | 76 | 3,8% | 0,6% |
| 118 Fabio | 3.521 | 3.380 | 1,04 | 125 | 3,6% | 1,1% |
| 106 Zora | 2.192 | 2.313 | 0,95 | 73 | 3,3% | 1,4% |
| 114 Christel | 1.349 | 1.367 | 0,99 | 24 | 1,8% | 0,4% |
| 112 | 3.041 | 2.952 | 1,03 | 53 | 1,7% | 0,1% |
| 110 Alessandro | 1.743 | 1.749 | 1,00 | 27 | 1,5% | 0,2% |
| 109 Giusy | 801 | 845 | 0,95 | 8 | 1,0% | 0,1% |
| 105 Karim | 2.788 | 2.876 | 0,97 | 20 | 0,7% | 0,3% |

Dieci operatori su undici stanno fra 0,7% e 6,2%. Il 115 è a 34,8%.

Il rapporto esiti/chiamate della squadra sta fra 0,95 e 1,04 — cioè circa un esito
per ogni tentativo, che è quanto ci si aspetta. Il 115 è a 1,64.

## 5. Dove sta lo scostamento

GDO 115, 1-24 agosto, per tipo di esito:

| Esito | Totale | Chiamata stesso giorno | Chiamata altro giorno | Mai chiamato |
|---|---|---|---|---|
| Appuntamento | 73 | **73** | 0 | **0** |
| Richiamo | 85 | **85** | 0 | **0** |
| Non risposto | 1.784 | 1.073 | 497 | 214 |
| Da scartare | 391 | 281 | 35 | 66 |

**Gli esiti che producono valore hanno sempre una telefonata dietro, senza
eccezioni.** Lo scostamento è tutto sulle due voci che chiudono una riga senza
produrre niente: non risposto e da scartare.

## 6. Come si manifesta: a raffiche

Gli esiti scoperti non sono sparsi nella giornata, arrivano in sequenze rapide. Il
tempo mediano fra un esito e il successivo è di **14 secondi** per gli esiti
scoperti del 115, contro i **51 secondi** dei suoi esiti normali.

**Esiti scoperti registrati a meno di dieci secondi dal precedente:**

| GDO | Numero |
|---|---|
| **115 Clara** | **345** |
| 117 Simone | 29 |
| 112 | 25 |
| 106 Zora | 17 |
| 119 Riccardo | 14 |
| tutti gli altri | 0-10 |

Per la maggior parte degli altri operatori gli esiti scoperti sono **più lenti**
dei loro esiti normali (Giulia 85 secondi contro 52, Giusy 65 contro 46, Fabio 55
contro 44): sono casi isolati, non sequenze. Per il 115 sono più veloci di tre
volte e mezza.

## 7. Giornata per giornata

Non è un'abitudine uniforme: dipende dalla giornata.

| Giorno | Esiti | Chiamate | Scoperti | % |
|---|---|---|---|---|
| 6 agosto | 182 | 80 | 95 | **52,2%** |
| 20 agosto | 151 | 90 | 70 | **46,4%** |
| 19 agosto | 178 | 103 | 82 | **46,1%** |
| 5 agosto | 253 | 129 | 99 | 39,1% |
| 7 agosto | 258 | 129 | 100 | 38,8% |
| 22 agosto | 202 | 127 | 77 | 38,1% |
| … | | | | |
| 3 agosto | 177 | 117 | 39 | 22,0% |
| 21 agosto | 138 | 123 | 23 | 16,7% |

Si va dal 17% al 52%. **In nessuna giornata il valore scende ai livelli normali
della squadra** (sotto il 7%), quindi non è un episodio isolato; ma le giornate
peggiori sono identificabili e vale la pena partire da quelle.

## 8. Andamento nel tempo

| Mese | 115 Clara | 117 Simone | 118 Fabio | 106 Zora |
|---|---|---|---|---|
| Luglio | **1,57** | 1,06 | 1,02 | 0,94 |
| Agosto | **1,64** | 1,00 | 1,04 | 0,95 |

*(rapporto esiti/chiamate; è l'unica misura disponibile anche per luglio)*

Il comportamento è stabile sui due mesi verificabili.

**Attenzione ai mesi precedenti**: da aprile a giugno la mappatura fra postazioni
telefoniche e operatori era incompleta (copertura 74-87% contro il 99% di
luglio-agosto), e i rapporti risultanti sono inattendibili anche per operatori
regolari (0,35 e 2,56 sulla stessa persona in due mesi contigui). **I mesi da
aprile a giugno non vanno usati per questo confronto.**

## 9. Ipotesi alternative verificate ed escluse

| Ipotesi | Verifica | Esito |
|---|---|---|
| Lead chiamati prima che il centralino esistesse (10 marzo) | I lead in questione sono tutti creati dal 20 luglio in poi | **Esclusa** |
| Numeri malformati che non si agganciano | 9 casi in tutto il mese, già esclusi dal conteggio; la quota di prefissi anomali è la stessa fra esiti coperti e scoperti (17% contro 21%) | **Esclusa** |
| Difetto del metodo di confronto | Se lo fosse, colpirebbe tutti allo stesso modo: gli altri dieci operatori stanno fra 0,7% e 6,2% | **Esclusa** |
| Chiamate fatte da un'altra postazione | Il controllo cerca il numero nei tabulati di **tutti** gli interni, non solo del suo | **Esclusa** |
| Interno attribuito alla persona sbagliata | Per ognuno degli undici interni, il proprietario dei lead chiamati è l'operatore mappato, con margini schiaccianti (1.497 lead contro 31 per l'interno del 115) | **Esclusa** |
| Fuso orario sbagliato nei tabulati | Bug reale, trovato e corretto il 25/08. Verificato: nessuna riga incoerente su 144.117 | **Corretta** |
| Tabulati non ancora importati | Reale, ed è il motivo per cui l'analisi si ferma al 24 agosto (vedi §3) | **Neutralizzata dalla finestra** |

## 10. Cosa questa analisi NON dimostra

- **Non dimostra un intento.** Descrive un comportamento, non la ragione per cui
  avviene. Le spiegazioni compatibili con questi numeri sono almeno tre: difficoltà
  a reggere il ritmo richiesto, convinzione che scartare a vista lead palesemente
  fuori target sia accettabile, oppure adattamento a un obiettivo che premiava il
  volume di chiamate.
- **Non dimostra una frode sui risultati.** Zero appuntamenti e zero richiami senza
  telefonata: la produzione dichiarata è reale.
- **Non copre le chiamate fatte fuori dal centralino.** Un tentativo fatto con un
  telefono personale non lascerebbe traccia. Nulla nei dati lo suggerisce, ma non è
  escludibile, ed è l'unico canale che potrebbe ancora ridimensionare il dato.
- **Non copre eventuali tentativi che il centralino non registra** (seconde gambe,
  errori di linea): verificabile solo sul centralino in ufficio.
- **Non è una misura di rendimento.** Serve a verificare l'attendibilità di un
  dato, non a giudicare il valore di una persona.

## 11. Il contesto che rende leggibile il dato

Fino a metà agosto l'obiettivo giornaliero degli operatori era **90 chiamate**, un
numero che l'intera squadra superava tutti i giorni senza sforzo. Un obiettivo così
tarato non misura nulla, ma resta un bersaglio visibile in dashboard — e **il modo
più economico per centrarlo è registrare esiti, non telefonare**.

Dai dati di agosto risulta inoltre che il numero di chiamate **non predice** gli
appuntamenti. Va però detto che il confronto fra operatori su questo punto è
inquinato dal tipo di lista assegnata: chi compone più numeri lavora quasi solo
liste riciclate (il 118 al 100%, il 105 al 98%), chi ne compone meno lavora lead
freschi (il 117 al 2%, il 114 allo 0%). **Non sono due ritmi di lavoro diversi,
sono due mestieri diversi**, e il volume di chiamate non li rende confrontabili.

## 12. Cosa si consiglia di fare

1. **Cambiare prima l'obiettivo, poi guardare il comportamento.** Un bersaglio sul
   numero di chiamate toglie ogni convenienza a telefonare davvero, e ne dà molta a
   registrare esiti. Se dopo il cambio il fenomeno sparisce, era il sistema di
   incentivi; se resta, la conversazione diventa molto più semplice.
2. **Parlare con la persona prima di decidere qualsiasi cosa**, portando le
   giornate specifiche (5, 6, 7, 19 e 20 agosto) e non il totale del mese. È più
   utile capire cosa succedeva in quelle giornate che discutere una percentuale.
3. **Portare il metro di mezzo, non la sottrazione.** Alla domanda "come fai a
   dire 812?" la risposta deve essere una frase sola: *nei tabulati non c'è nessuna
   chiamata a quel numero in quel giorno, da parte di nessuno*.
4. **Non estendere il sospetto al resto della squadra.** Dieci operatori su undici
   hanno numeri regolari, e vale la pena dirglielo.
5. **Rimisurare fra un mese** con lo stesso metodo e la stessa finestra pulita.

---

*Metodo riproducibile: i tabulati stanno nella tabella `pbxCalls` (colonna
`dstKey` = ultime dieci cifre del numero chiamato), gli esiti in `callLogs`. Ogni
numero di questo documento è ricalcolabile con una singola query di confronto fra
le due tabelle sulla finestra 2026-08-01 / 2026-08-24.*
