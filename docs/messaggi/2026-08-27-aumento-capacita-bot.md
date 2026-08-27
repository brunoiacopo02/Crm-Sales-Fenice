# Aumento di capacità del bot — 27 agosto 2026

Ciao,

dopo lo scambio di ieri abbiamo fatto una cosa concreta dalla nostra parte: **da oggi il
bot riceve molti più lead**. Vi spiego come funziona da adesso, cosa ci aspettiamo in
cambio e un problema che dobbiamo chiudere.

---

## 1. Da oggi il bot riceve ~150 lead al giorno invece di ~35

Fino a ieri il bot era, per il nostro sistema, un operatore come gli altri: i lead in
arrivo giravano a rotazione fra i sei GDO e il bot, quindi gli arrivava **un settimo del
totale, circa 35 lead al giorno**, con un tetto di 50 che non toccava quasi mai.

Da oggi la regola non è più la rotazione, è **l'orario**:

| quando | a chi vanno i lead |
|---|---|
| lun–ven **20:00 → 13:00** | tutti al bot |
| lun–ven **13:00 → 20:00** | prima il bot, finché non arriva a 100 nella giornata; poi ai GDO |
| sabato **10:00 → 16:30** | ai GDO (è il loro turno del sabato) |
| sabato, fuori da quella fascia | tutti al bot |
| domenica, tutto il giorno | tutti al bot |

Il ragionamento è semplice: nelle ore in cui i nostri GDO non sono al telefono, un lead
che entra resta fermo fino al mattino dopo, e un lead fermo dodici ore è un lead già
raffreddato. Quelle ore le copre il bot, che non ha orari.

Sui volumi reali degli ultimi tre settimane — **~240 lead al giorno**, di cui **~150
arrivano fuori dall'orario dei GDO** — questo significa per voi passare da ~35 a **~150
lead al giorno, più di quattro volte tanto**.

Non vi chiediamo di confermarcelo prima: la modifica è già in produzione. Vi chiediamo di
dirci **subito** se questo volume vi mette in difficoltà, perché in quel caso lo
riportiamo giù in cinque minuti e ne riparliamo. Meglio saperlo da voi che scoprirlo dai
lead fermi.

---

## 2. Quello che ci serve in cambio: restituire i lead in 3-4 giorni

Con questo volume, il punto critico non è più quanti lead prendete: è **quanto tempo li
tenete prima di ridarceli**. Un lead che il bot non converte torna ai nostri GDO, e la
differenza fra un ritorno a 3 giorni e uno a 10 è la differenza fra una chiamata utile e
una persona che non ricorda nemmeno di aver lasciato il numero.

I nostri numeri sulle restituzioni (evento di ritorno al pool umano):

| mese | lead restituiti | mediana | media | il peggiore |
|---|---|---|---|---|
| giugno | 141 | **1,0 giorni** | 1,2 | 3 giorni |
| luglio | 429 | **1,0 giorni** | 1,2 | 28,5 giorni |
| agosto | 1.791 | **4,9 giorni** | 7,2 | 22 giorni |

A giugno e luglio restituivate in un giorno. Ad agosto la mediana è quintuplicata e la
media dice 7,2 giorni. Il volume è cresciuto, ma è proprio per questo che il tempo di
restituzione conta: **la richiesta è che un lead non convertito torni entro 3-4 giorni**,
qualunque sia il motivo per cui non ha funzionato. Se la sequenza dura più di così,
diteci quanto dura davvero e la mettiamo nero su bianco: possiamo lavorare con qualsiasi
numero concordato, non possiamo lavorare con un numero che cambia ogni mese.

---

## 3. I 174 lead fermi: abbiamo verificato, il push è partito

Ieri vi avevamo detto 295 lead assegnati al bot e ancora senza esito. Oggi, con il
criterio più stretto (mai lavorati, fermi allo stato iniziale) sono **174**. Prima di
scrivervi abbiamo controllato se fosse un problema nostro, cioè un push mai partito:

- su **tutti e 174** c'è l'evento di consegna verso di voi. Il lead vi è stato mandato,
  la chiamata al vostro endpoint è andata a buon fine;
- il più vecchio è del **22 giugno**;
- **31 di questi hanno anche chiesto esplicitamente di parlare con una persona** — quindi
  non è nemmeno un problema di lead irraggiungibili: hanno risposto al bot e hanno chiesto
  un umano;
- negli ultimi 14 giorni ci sono arrivate 1.152 note e 1.047 report dal bot, quindi il
  canale funziona benissimo in generale.

Quindi non è un errore di lettura dei nostri dati: sono lead che avete ricevuto e per cui
non è mai tornato un esito. Le possibilità sono due, e la risposta ce l'avete solo voi:
la sequenza è ancora aperta (e allora ditecelo, così smettiamo di contarli come persi),
oppure si è interrotta senza chiudersi (e allora è un bug, e vanno restituiti tutti).

Non serve che li ricarichiate: appena ci mandate un esito qualsiasi — anche solo "mai
risposto" — noi li rimettiamo in circolo dai nostri GDO.

---

## 4. Due cose che avete già disponibili, per non ripeterci

- **I dati dopo l'appuntamento** (conferma, presenza, esito della trattativa, venduto e
  importo): `POST /api/bot/lead-status`, in lettura, firmato con lo stesso segreto. Un
  giro ogni 15-30 minuti basta. È la Direzione 5 del contratto che vi abbiamo allegato
  ieri.
- **I lead che chiedono una persona**: adesso finiscono in una coda che un nostro
  amministratore lavora a mano. Continuate a mandarceli con il motivo e le informazioni
  raccolte, come da contratto v1.5.

---

## In sintesi, cosa ci serve da voi

1. Confermate che **~150 lead al giorno** sono sostenibili — o diteci subito il numero che
   reggete, e lo impostiamo noi.
2. Restituzione dei lead non convertiti **entro 3-4 giorni**, o il tempo reale della vostra
   sequenza messo per iscritto.
3. Una risposta sui **174 lead fermi**: sequenza ancora aperta o interrotta?

A presto,
Bruno
