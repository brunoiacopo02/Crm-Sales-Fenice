# Esiti registrati senza telefonata — analisi, agosto 2026

Documento interno. Redatto il 2026-08-25 incrociando i tabulati del centralino
telefonico dell'ufficio con gli esiti registrati nel CRM.

**Contiene valutazioni su una persona identificabile. Prima di usarlo va letta
la sezione "Cosa questa analisi NON dimostra".**

---

## 1. In due righe

Il GDO 115 (Clara) ad agosto ha registrato nel CRM **2.409 esiti a fronte di
1.485 telefonate realmente partite**: 924 esiti senza una chiamata dietro. Tutti
gli altri operatori registrano circa un esito per ogni chiamata. **Nessun
appuntamento e nessun richiamo risulta inventato**: lo scostamento è tutto su
"non risposto" e "da scartare".

## 2. Come è stata fatta

Il centralino FreePBX dell'ufficio conserva il tabulato di ogni chiamata: orario,
numero chiamato, durata, esito tecnico. Sono stati importati nel CRM i tabulati
da marzo ad agosto 2026 (144.117 chiamate) e collegati agli operatori tramite la
tabella degli interni.

Per ogni esito registrato nel CRM si è cercato, nei tabulati, se il numero di quel
lead risulti mai chiamato **da chiunque, in qualunque giorno** dei sei mesi. Il
confronto è volutamente il più generoso possibile verso l'operatore: basta una
sola telefonata a quel numero, anche fatta da un collega o settimane prima, perché
l'esito risulti "coperto".

I numeri si agganciano confrontando le ultime dieci cifre, per essere indipendenti
da prefissi e formattazione.

## 3. Il risultato

**Rapporto fra esiti registrati e chiamate realmente partite — agosto 2026:**

| GDO | Esiti | Chiamate | Rapporto | Differenza |
|---|---|---|---|---|
| **115 Clara** | 2.409 | 1.485 | **1,62** | **+924** |
| 107 Giulia | 1.541 | 1.443 | 1,07 | +98 |
| 112 | 3.251 | 3.075 | 1,06 | +176 |
| 118 Fabio | 3.715 | 3.506 | 1,06 | +209 |
| 119 Riccardo | 1.394 | 1.335 | 1,04 | +59 |
| 110 Alessandro | 1.837 | 1.807 | 1,02 | +30 |
| 117 Simone | 2.150 | 2.122 | 1,01 | +28 |
| 114 Christel | 1.352 | 1.370 | 0,99 | −18 |
| 105 Karim | 2.930 | 2.989 | 0,98 | −59 |
| 106 Zora | 2.326 | 2.398 | 0,97 | −72 |
| 109 Giusy | 897 | 928 | 0,97 | −31 |

La squadra sta fra 0,97 e 1,07. Un rapporto intorno a 1 è quello atteso: un esito
per ogni tentativo. Il 115 è a 1,62.

**Il dettaglio per tipo di esito (GDO 115, agosto):**

| Esito | Totale | Chiamata stesso giorno | Chiamata altro giorno | Mai chiamato |
|---|---|---|---|---|
| Appuntamento | 77 | 75 | 2 | **0** |
| Richiamo | 88 | 88 | 0 | **0** |
| Non risposto | 1.833 | 1.105 | 511 | 217 |
| Da scartare | 409 | 291 | 40 | 78 |

Gli esiti che producono valore — appuntamenti e richiami — hanno **sempre** una
telefonata dietro. Lo scostamento è interamente su non risposto e scarti.

## 4. Come si manifesta: a raffiche

Gli esiti senza chiamata non sono sparsi nella giornata: arrivano in sequenze
rapide. Il tempo mediano fra un esito e il successivo è di **14 secondi** per gli
esiti senza chiamata, contro i **44 secondi** dei suoi esiti normali.

**Esiti senza chiamata registrati a meno di dieci secondi l'uno dall'altro:**

| GDO | Numero |
|---|---|
| **115 Clara** | **128** |
| 106 Zora | 23 |
| 112 | 6 |
| 117 Simone | 4 |
| 118 Fabio | 3 |
| tutti gli altri | 0–2 |

Per gli altri operatori gli esiti senza chiamata sono mediamente **più lenti** dei
loro esiti normali (Fabio 50 secondi contro 44, Giusy 63 contro 46): sono casi
isolati, non sequenze. Per il 115 sono più veloci di tre volte.

## 5. Non è costante: dipende dalla giornata

| Giorno | Esiti | Chiamate | Senza chiamata | % |
|---|---|---|---|---|
| 20 agosto | 151 | 90 | 39 | **25,8%** |
| 6 agosto | 182 | 80 | 43 | **23,6%** |
| 7 agosto | 258 | 129 | 44 | 17,1% |
| 24 agosto | 104 | 76 | 15 | 14,4% |
| … | | | | |
| 4 agosto | 183 | 103 | 11 | 6,0% |
| 17 agosto | 102 | 79 | 6 | 5,9% |

Si va dal 6% al 26%. Sono giornate specifiche, non un'abitudine uniforme — il che
suggerisce una risposta a condizioni particolari (giornate difficili, stanchezza,
pressione sul numero) più che una pratica sistematica.

## 6. Andamento nel tempo

| Mese | 115 Clara | 117 Simone | 118 Fabio | 106 Zora |
|---|---|---|---|---|
| Luglio | **1,57** | 1,06 | 1,02 | 0,94 |
| Agosto | **1,62** | 1,01 | 1,06 | 0,98 |

Il comportamento è stabile sui due mesi verificabili.

**Attenzione ai mesi precedenti**: da aprile a giugno la mappatura fra postazioni
telefoniche e operatori era incompleta (copertura 74–87% contro il 99% di
luglio-agosto), e i rapporti risultanti sono palesemente inattendibili anche per
operatori regolari (0,35 e 2,56 sulla stessa persona in due mesi contigui). **I
mesi da aprile a giugno non vanno usati per questo confronto.**

## 7. Ipotesi alternative verificate ed escluse

| Ipotesi | Verifica | Esito |
|---|---|---|
| Lead chiamati prima che il centralino esistesse (10 marzo) | I lead in questione sono tutti creati dal 20 luglio in poi | **Esclusa** |
| Numeri malformati che non si agganciano | Solo 9 casi su 296 hanno meno di 10 cifre; la quota di prefissi anomali è la stessa fra esiti con e senza chiamata (17% contro 21%) | **Spiega il 3%** |
| Difetto del metodo di confronto | Se lo fosse, colpirebbe tutti allo stesso modo: gli altri dieci operatori stanno fra 0,97 e 1,07 | **Esclusa** |
| Chiamate fatte da un'altra postazione | Il controllo cerca il numero nei tabulati di **tutti** gli interni, non solo del suo | **Esclusa** |
| Fuso orario sbagliato nei tabulati | Bug reale, trovato e corretto il 25/08. Non incide: il confronto è sul numero chiamato, non sull'orario | **Corretta, ininfluente** |

## 8. Cosa questa analisi NON dimostra

- **Non dimostra un intento.** Descrive un comportamento, non la ragione per cui
  avviene. Le spiegazioni compatibili con questi numeri sono almeno tre: difficoltà
  a reggere il ritmo richiesto, convinzione che scartare a vista lead palesemente
  fuori target sia accettabile, oppure semplice adattamento a un obiettivo che
  premiava il volume di chiamate.
- **Non dimostra una frode sui risultati.** Zero appuntamenti e zero richiami senza
  telefonata: la produzione dichiarata è reale.
- **Non copre le chiamate fatte fuori dal centralino.** Un tentativo fatto con un
  telefono personale non lascerebbe traccia. Nulla nei dati lo suggerisce, ma non
  è escludibile.
- **Non è una misura di rendimento.** Serve a verificare l'attendibilità di un
  dato, non a giudicare il valore di una persona.

## 9. Il contesto che rende leggibile il dato

Fino a oggi l'obiettivo giornaliero degli operatori era **90 chiamate**, un numero
che l'intera squadra superava tutti i giorni senza sforzo: il quartile più lento
ne faceva 117. Un obiettivo così tarato non misura nulla, ma resta un bersaglio
visibile in dashboard — e **il modo più economico per centrarlo è registrare
esiti, non telefonare**.

Dai dati di agosto risulta inoltre che il numero di chiamate **non predice** gli
appuntamenti: chi ne fa 263 al giorno ne fissa 4,0; chi ne fa 108 ne fissa 6,8. La
grandezza che li predice sono i **minuti passati al telefono**.

## 10. Cosa si consiglia di fare

1. **Cambiare prima l'obiettivo, poi guardare il comportamento.** Sostituire il
   bersaglio "numero di chiamate" con i minuti al telefono toglie ogni convenienza
   a registrare esiti a vuoto. Se dopo il cambio il fenomeno sparisce, era il
   sistema di incentivi; se resta, la conversazione diventa molto più semplice.
2. **Parlare con la persona prima di decidere qualsiasi cosa**, portando i dati
   delle giornate specifiche (6, 7 e 20 agosto) e non il totale del mese. Le
   giornate peggiori sono poche e identificabili: è più utile capire cosa
   succedeva in quelle giornate che discutere una percentuale mensile.
3. **Non estendere il sospetto al resto della squadra.** Dieci operatori su undici
   hanno numeri regolari, e vale la pena dirglielo.
4. **Rimisurare fra un mese** con lo stesso metodo, che ora è automatico.

---

*Metodo riproducibile: i tabulati stanno nella tabella `pbxCalls`, gli esiti in
`callLogs`. Il confronto si rifà con le query allegate al branch
`feat/produttivita-gdo-cdr`.*
