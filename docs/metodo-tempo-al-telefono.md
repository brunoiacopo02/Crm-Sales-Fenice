# Come sono calcolati i numeri sul tempo perso

Documento di metodo, 2026-08-26. Serve a rispondere a una domanda sola: **da dove
vengono i numeri della scheda "Tempo al telefono" di /monitor-pause**, e quali di
quei numeri reggono un contraddittorio.

Si legge dall'alto verso il basso: si parte da una riga di tabulato telefonico e
si arriva al numero che compare in pagina, senza salti.

---

## 0. La risposta breve, prima di tutto

Circola una frase — *"perdono fino al 60% dell'orario di lavoro"* — che **non è
sostenibile in quella forma**, e va corretta prima di usarla con qualcuno.

Il 60% è una quantità reale ma è **il tempo con la cornetta abbassata**, che non è
la stessa cosa del tempo perso. Per la persona messa peggio (GDO 115), su 390
minuti di turno:

| Cosa | Minuti | % del turno | Si può contestare? |
|---|---|---|---|
| Tempo non passato in conversazione | 270 | 69% | Sì, include gli squilli: chiamare e non trovare nessuno è lavoro |
| **Tempo con la cornetta abbassata** | **230** | **59%** | Sì, include il tempo per scrivere gli esiti e i bordi del turno |
| Interruzioni fra le chiamate (brevi + pause) | 195 | 50% | Poco: è tempo oltre quello riconosciuto per scrivere l'esito |
| **Oltre i 30 minuti di pausa da contratto** | **165** | **42%** | **È questo il numero da portare** |

Per la persona messa meglio (GDO 117) le stesse quattro righe fanno 178, 126, 75 e
**45 minuti**.

**La frase corretta è: "le interruzioni superano di 165 minuti al giorno la pausa
prevista dal contratto"**, non "perde il 60% del turno". La differenza fra i due
modi di dirlo è di 65 minuti al giorno, ed è tutta roba che in un colloquio la
persona ribatterebbe con ragione.

*(La riga "cornetta abbassata" è la somma delle colonne come si leggono in pagina:
23 + 87 + 108 + 12 = 230. Calcolandola invece per differenza dal turno teorico —
390 − 120 − 36 — verrebbe 234: i quattro minuti di scarto sono l'ora di formazione
del sabato, che è lavoro e viene tolta dalle voci di tempo fermo. Vale la pena
saperlo perché chi rifà il conto in un modo o nell'altro trova due numeri diversi.)*

---

## 1. Da dove arrivano i dati

**La sorgente è il centralino dell'ufficio**, un FreePBX raggiungibile solo dalla
rete interna. Registra una riga per ogni chiamata: orario di inizio, numero
chiamato, durata totale, secondi di conversazione effettiva, esito tecnico,
interno che l'ha composta.

Il percorso del dato è questo:

1. Export manuale dal centralino in CSV (Reports → CDR Reports).
2. `scripts/import-cdr.ts` legge il CSV e scrive nella tabella `pbxCalls`.
   L'import è idempotente sull'identificativo univoco della chiamata: rilanciarlo
   sullo stesso file non duplica nulla.
3. Le server action leggono da `pbxCalls`, mai dal CSV.

**Volume attuale: 144.117 chiamate dal 10 marzo 2026** (prima non esistono
tabulati). Di queste si usano **solo le chiamate in uscita**: le entranti non sono
attribuibili a una persona, perché il centralino non salva quale interno abbia
risposto.

**Due colonne fanno tutto il lavoro e vanno tenute distinte:**

- `duration` = secondi da quando parte la chiamata a quando si chiude, **squilli
  inclusi**;
- `billsec` = secondi di **conversazione effettiva**, cioè da quando qualcuno
  risponde.

Una chiamata a vuoto ha `duration` 25 e `billsec` 0. La differenza fra le due
colonne è il tempo di squillo, che nella scheda ha una colonna sua.

**Un bug corretto, che vale la pena conoscere:** il centralino scrive gli orari in
UTC, non in ora italiana. Per un giorno i conti sono stati fatti leggendoli come
ora di Roma, con due ore di sfasamento. È stato trovato solo perché il turno reale
fornito dalla direzione non tornava con gli orari osservati. Verificato dopo la
correzione: zero righe incoerenti su 144.117.

## 2. Come si sa di chi è una chiamata

Il centralino conosce gli interni (1007, 1008…), non le persone. La
corrispondenza sta nella tabella `pbxExtensions` ed è **compilata a mano**: la
regola che sembrerebbe ovvia (1015 → GDO 115) **è falsa**, gli abbinamenti reali
sono sparsi.

È il punto più fragile dell'intera catena, perché un solo abbinamento sbagliato
ribalterebbe una classifica. È stato verificato così: per ogni interno si guarda
di chi sono i lead effettivamente chiamati da quell'interno. Se l'interno 1007 è
davvero di Clara, i numeri che compone devono essere i lead assegnati a Clara.
Risultato: per tutti e undici gli interni il proprietario dei lead è l'operatore
mappato, con margini schiaccianti (per l'interno 1007: 1.497 lead di Clara contro
31 della seconda persona in lista).

Il GDO 116 non ha interno mappato perché non è in servizio: non è un buco nei dati.

## 3. Il turno di riferimento

**Non è dedotto dai dati, è stato fornito dalla direzione**: feriali 13:30-20:00,
sabato 10:00-16:30. In entrambi i casi **390 minuti**. Pausa prevista dal
contratto: **30 minuti al giorno**.

Questo è importante: prima di avere il turno reale si misurava la "finestra
osservata" (dalla prima all'ultima chiamata), che nascondeva chi comincia tardi e
chi stacca presto — cioè proprio i due comportamenti che interessa vedere.

**Il sabato di formazione** è un caso a parte. Quando c'è formazione occupa
l'ultima ora ed è lavoro, non tempo fermo: fino a 60 minuti non vengono contati
come interruzione. Ma la formazione non c'è tutti i sabati — fra giugno e agosto
c'è stata in 4 sabati su 10, zero a luglio. Quali? Si deduce dai dati, non dal
calendario: essendo collettiva, nei sabati di formazione **si ferma insieme tutta
la squadra**. La quota di operatori fermi nell'ultima mezz'ora, sabato per sabato,
è stata: 100%, 0%, 57%, 0%, 13%, 0%, 0%, 100%, 100%, 0%. Non c'è ambiguità: sopra
la metà è formazione, sotto no.

*(Fino al 26 agosto l'abbuono veniva concesso a ogni sabato indistintamente. Era
un errore a favore di tutti: abbassava le pause di 10-13 minuti al giorno a
chiunque. Corretto.)*

## 4. Quali giornate entrano nel conto

Si parte da tutte le coppie (persona, giorno) che hanno almeno una chiamata. Poi:

| Filtro | Perché | Dove finiscono |
|---|---|---|
| Domenica | Nessun turno definito | Escluse |
| Meno di 40 chiamate | Giornata non rappresentativa (rientro, permesso, mezza giornata) | Contate a parte, colonna Giornate |
| Un bordo del turno oltre 60 min (120 il sabato) | Permesso, mezza giornata, uscita autorizzata, arrivo molto in ritardo | Contate a parte, colonna Giornate |
| Tutte le altre | Giornate intere | **Sono la base di ogni media** |

**Le ferie non compaiono affatto**: un giorno senza chiamate non genera alcuna
riga, quindi non abbassa nessuna media.

Il filtro sulle giornate corte non è un dettaglio: senza di esso, **chi ha avuto
permessi risulta più diligente di chi ha lavorato tutti i giorni interi**, perché
una giornata finita alle 16 abbassa tutte le sue medie. Su agosto la differenza è
grossa: il "tempo dopo l'ultima chiamata" della squadra passa da 19-52 minuti a
2-10 a seconda che si includano o no le mezze giornate. Le giornate escluse non
spariscono mai dal conto: sono contate e mostrate a fianco.

Il filtro vale su **entrambi** i bordi del turno. Guardare solo l'uscita lasciava
passare come "intera" una giornata cominciata con tre ore di ritardo — è successo
il 21 agosto.

## 5. Come si scompone la giornata

Per ogni giornata intera si ordinano le chiamate per orario. Poi:

**Al telefono** = somma di `billsec`. È conversazione vera.

**Squilli a vuoto** = somma di (`duration` − `billsec`). Il telefono squilla,
nessuno risponde. Non è conversazione ma non è nemmeno tempo fermo: è lavoro che
non ha prodotto niente.

**I buchi fra le chiamate** = per ogni coppia di chiamate consecutive, il tempo fra
la **fine** di una e l'**inizio** della successiva. Non fra i due inizi: quello
conterebbe la durata della prima chiamata come se fosse un buco. I buchi negativi
(chiamate sovrapposte, 1 caso in sei mesi) si scartano.

**Dentro ogni buco, quanto tempo è lavoro?** Fino al 26 agosto la risposta era una
soglia sola per tutti: due minuti. Era troppo generosa, e la contestazione che l'ha
fatta cadere è semplice — *dopo uno squillo a vuoto non c'è niente da scrivere,
quindi due minuti non sono giustificabili*. Sui dati di agosto la sola fascia fra
30 secondi e 2 minuti dopo una chiamata senza risposta valeva 6-25 minuti al giorno
a persona, tutti classificati come lavoro.

Ora l'abbuono dipende da **cosa c'era davvero da scrivere**, cioè dall'esito che
quella telefonata ha prodotto nel CRM:

| Esito della telefonata precedente | Tempo riconosciuto |
|---|---|
| Nessuno ha risposto | **9 secondi** |
| Ha risposto, ma non se ne fa nulla (scarto, non interessato) | **9 secondi** |
| Richiamo fissato | **30 secondi** |
| Appuntamento preso | **80 secondi** |

Il tempo entro l'abbuono è lavoro e non si giudica. Quello oltre è tempo fermo, e
finisce fra le **interruzioni brevi** se il buco stava sotto i 10 minuti, fra le
**pause** se lo superava (3-6 al giorno è la normalità).

Due cose da sapere su come è implementato, perché sono le prime che un
contraddittorio attacca:

- **se non ha risposto nessuno, l'abbuono resta 9 secondi qualunque esito risulti
  nel CRM.** Non c'è stata conversazione, quindi non c'era niente da trascrivere:
  serve a non far comprare tempo a un esito registrato a vuoto;
- **l'esito si aggancia alla telefonata** per operatore, giornata e ultime dieci
  cifre del numero, scegliendo fra gli esiti di quel giorno su quel numero il più
  vicino nel tempo — gli esiti si registrano spesso con ore di ritardo. Se non lo
  si ritrova si usa l'abbuono minimo, **mai il più generoso**.

Nella colonna "quante volte" si contano solo le fermate che superano il minuto
oltre l'abbuono: senza quella soglia ogni singola telefonata produrrebbe
un'interruzione e il conteggio non direbbe più niente. **I minuti invece si
contano tutti.**

**I bordi del turno** = dall'inizio turno alla prima chiamata, e dalla fine
dell'ultima chiamata alla fine turno. Mai negativi.

**La verifica che tiene insieme tutto:** le sette voci sommate devono dare i 390
minuti del turno. In pagina la somma sta fra 364 e 387 — sotto i 390 perché l'ora
di formazione del sabato viene tolta dalle voci di tempo fermo pur essendo stata
lavorata, e per gli arrotondamenti al minuto. **È questa la verifica che rende la
tabella controllabile a mano da chiunque**, ed è il motivo per cui esiste la
colonna Totale.

## 6. Come si passa dalla giornata alla media

Si sommano i secondi di ogni voce su tutte le giornate intere e si divide per il
numero di giornate intere. Niente medie di medie.

I **conteggi** (quante interruzioni, quante volte dopo uno squillo a vuoto) sono
medie giornaliere con un decimale. I **bordi del turno** hanno due versioni: la
media, che è sommabile con le altre colonne, e la mediana, che descrive la
giornata tipica. Sono diverse e servono a cose diverse — confonderle è già
successo, e per un giorno ha prodotto l'affermazione sbagliata che due persone
staccassero cinquanta minuti prima.

## 7. La metrica più difendibile, e perché

Fra tutte, quella che regge meglio un contraddittorio è: **quante interruzioni
brevi cominciano subito dopo uno squillo a vuoto.**

Il ragionamento: dopo una conversazione c'è un esito da scrivere, e fermarsi
qualche minuto ha una giustificazione. Dopo uno squillo a vuoto non c'è nessuna
telefonata da annotare — l'esito "non risposto" si registra in pochi secondi.

Un'obiezione a questa metrica esiste ed è seria: *chi lavora liste riciclate
riceve molte più mancate risposte degli altri, quindi ha più occasioni di
fermarsi*. È vera e va tolta di mezzo, misurando il **tasso** invece del
conteggio: su cento squilli a vuoto, quante volte segue una pausa.

| | 115 | 119 | 110 | 106 | 109 | 114 | 107 | 105 | 112 | 118 | 117 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Tasso | **11,2%** | 5,9% | 4,5% | 3,6% | 3,2% | 2,7% | 2,6% | 1,7% | 1,6% | 1,2% | 1,2% |

Il risultato regge: chi ha **più** squilli a vuoto in assoluto (112, 118, 105) sta
in fondo alla classifica del tasso. Il volume non c'entra, resta l'abitudine.

## 8. Quello che questi numeri NON misurano

- **Le chiamate in entrata.** Il centralino non salva quale interno risponde: ad
  agosto sono 967 chiamate e 940 minuti di conversazione che, per chi ha
  risposto, risultano tempo fermo. Distribuite in parti uguali fra gli undici
  operatori fanno circa **6 minuti al giorno a testa**, ma non c'è modo di sapere
  se siano distribuite in parti uguali.
- **Il lavoro non telefonico legittimo**: messaggi ai lead, compilazione di
  schede, riunioni. Non lascia traccia nei tabulati.
- **Le chiamate fatte col telefono personale.** Nulla nei dati lo suggerisce, ma
  non è escludibile.
- **Il perché.** Questi numeri descrivono un comportamento, non la ragione per cui
  avviene.
- **Il valore di una persona.** Il tempo al telefono non è la produzione: chi fa
  più chiamate di tutti non è chi fissa più appuntamenti. Anzi, su agosto è vero
  il contrario, e il motivo è che chi compone più numeri lavora liste riciclate
  mentre chi ne compone meno lavora lead freschi. **Sono due mestieri diversi e i
  volumi non sono confrontabili fra loro.**

## 9. Se qualcuno vuole rifare i conti

Tutto è ricalcolabile con due tabelle: `pbxCalls` (i tabulati) e `callLogs` (gli
esiti registrati nel CRM). Il codice sta in `src/lib/cdr/` (moduli puri, con
test) e in `src/app/actions/productivityActions.ts` (le medie). Le soglie sono
tutte costanti dichiarate in cima ai file, non numeri sparsi nel codice.

**L'unica trappola da conoscere**: l'ultimo export dei tabulati si ferma al 25
agosto alle 16:02. Qualunque conto che arrivi a oggi troverà chiamate mancanti per
il 25 e il 26 agosto, e produrrà falsi allarmi.
