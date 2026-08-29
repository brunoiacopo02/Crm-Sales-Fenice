# Risposta al fornitore bot — 29/08/2026 (quarta)

*Bozza pronta da mandare. Chiude i punti aperti e consegna i 7 leadId.*

---

Ciao,

quattro sì, una cosa che non torna e che dobbiamo guardare insieme, e i sette
`leadId`.

## 1. Mehdi: via libera, mandate pure

Sì, riagganciatelo voi. Avete la chat e il contesto, e al telefono non risponde
— l'abbiamo già scartato dopo i tentativi. Con il rifissaggio che da oggi riapre
davvero lo scarto, se ottenete una data il lead torna da solo sulla board delle
Conferme senza che nessuno debba fare niente a mano.

## 2. I 39 del "giorno e ora": sì, rimandateceli

Avete ragione sull'occasione, ed è l'osservazione migliore del vostro messaggio:
quei lead avevano già detto sì alla call, mancava solo un giorno che allora non
esisteva e adesso sì. Sono i più recuperabili che abbiamo tutti e due.

Una cosa sola in cambio: **mandateci l'esito lead per lead**, anche i "no". Su 39
conversazioni con il sì già dato vogliamo sapere quanto rende davvero un
riaggancio a tre settimane di distanza — è un numero che nessuno dei due ha, e
che decide se rifarlo la prossima volta che chiudiamo l'agenda per una settimana.

## 3. `e4ef3953`: rimandatela adesso, la guardia l'abbiamo tolta

Qui c'era un equivoco da chiarire: **il 403 su elisabetta non c'entrava con il
record incoerente.** Bonificare la data dell'appuntamento non avrebbe sbloccato
niente. Il 403 arrivava perché quel lead non è mai passato dal bot — la stessa
identica causa dei dieci esiti del punto 4.

Ma guardando il caso ci siamo accorti che la guardia era sbagliata **per questo
esito specifico**, e l'abbiamo cambiata oggi.

`CONTATTO_UMANO` è l'unico dei vostri esiti che non scrive niente sul lead: mette
una riga in coda e manda una notifica, nessuna transizione di stato, nessuna
attribuzione toccata. Il danno massimo se sbagliate lead è una riga di coda da
chiudere. Il danno di rifiutarlo è una persona che ha chiesto di essere
richiamata e di cui nessuno saprà mai niente — che è esattamente cosa è successo
a elisabetta il 31 luglio, quando scriveva «farmi sentire la tua collega».

**Da adesso `CONTATTO_UMANO` non viene mai più rifiutato** su un lead Fenice,
qualunque sia la storia di quel lead. Rimandatecela quando volete.

Tutte le altre guardie restano identiche: un esito che sposta stato o
attribuzione su un lead che non è del bot continua a essere respinto, e deve
esserlo.

## 4. L'agenda del 31 luglio: i nostri dati dicono un'altra cosa

Abbiamo guardato, e qui non torna. Non ve lo scriviamo per chiudere la
discussione ma perché uno dei due sta leggendo male dei dati, e conviene sapere
quale prima di costruirci sopra.

**I dieci lead hanno ricevuto l'agenda il 30 luglio, non il 31**, fra le 15:11 e
le 19:58, mandata da sette GDO umani diversi, **via ActiveCampaign/Spoki**. Nel
log di ognuno dei dieci c'è il `contactId` di ActiveCampaign.

**Il canale bot l'abbiamo acceso il 31 luglio alle 13:25.** Circa venti ore dopo
l'ultima di quelle agende. Prima di quel momento il codice che chiama
`/api/send-agenda` non era nemmeno rilasciato in produzione: la prima chiamata in
assoluto è delle 13:25 di quel giorno.

Sul "buco di registrazione": non c'è. Abbiamo controllato tutta la storia della
tabella, e i lead con un'agenda partita dal vostro canale e lo stato di consegna
non registrato sono **zero**. `agendaStatus` vuoto su quei dieci non è un dato
perso: è l'informazione corretta, e significa "non passata dal bot". La colonna è
nata insieme al canale, e il commento della migrazione dice testualmente
*"NULL = nessun invio tramite bot (lead storici via ActiveCampaign/Spoki)"*.

Due domande concrete, e con le risposte si chiude in un quarto d'ora:

1. **Il timestamp della richiesta HTTP che dite di aver ricevuto su
   `/api/send-agenda` per ciascuno dei dieci** — l'ora della chiamata in
   ingresso, non l'ora del messaggio WhatsApp. Se cade prima delle 13:25 del 31
   luglio, la chiamata non può essere partita da noi.
2. **Da dove avete preso i nostri `leadId` per quei dieci contatti**, visto che
   nessuna delle tre vie che ve li trasmette (`/send-agenda`, `/appointment-set`,
   `/bot/intake`) è stata percorsa per loro.

Un'ipotesi che spiegherebbe tutto senza che nessuno abbia sbagliato: se
l'abbinamento l'avete fatto **a posteriori per numero di telefono**, i messaggi
WhatsApp del 31 luglio che vedete nei vostri log sono di altri lead — quel giorno
il bot ha davvero mandato 62 agende. Sarebbe la terza volta oggi che la deduplica
per numero spiega una divergenza fra i nostri due sistemi, dopo gli otto
appuntamenti e i dieci esiti.

## 5. I 7 `leadId` del 24 agosto

Eccoli. Grazie di aver controllato tutti e 358 invece di un campione, e grazie
soprattutto per le tre citazioni testuali: ci hanno fatto correggere la nostra
lettura prima di portarla avanti a torto.

| leadId | nome | telefono | vostra nota, testuale | ultima frase del lead |
|---|---|---|---|---|
| `791415b7-417e-4fba-a7dd-920464f1d282` | Sonia Sitti | 3495756185 | «Interrotta dopo la conferma dell'appuntamento rimandato al 24 agosto» | «Ok grazie» |
| `7920b583-b540-442d-a011-d59ffd2c2aff` | Elena Conte | 3451378789 | «Interrotta dopo il pitch e il prezzo, con appuntamento concordato a fine settembre» | «grazie» |
| `fe0a8b9c-a8a3-4398-8373-e1e1993b9aae` | Giovanna Quimi | 3517291101 | «Interrotta dopo la conferma dell'appuntamento telefonico post-martedì» | «Si normale non whatsapp, perché non prende bene per le telefonate» |
| `de16d17c-6318-4471-8c4e-77e472863d32` | Jonathan Gaón | 3489874385 | «Interrotta dopo la conferma dell'appuntamento e le istruzioni pre-call» | «Ok» |
| `d50f4371-5b82-4315-b91d-52bf6926386c` | Giusy Paragliola | 3481161100 | «Interrotta dopo la conferma dell'appuntamento e la spiegazione del processo pre-call» | «21» |
| `11b0892c-0c4f-43e8-b732-8cd69be4a4a3` | Viola Davide | 3713501117 | «Interrotta dopo la conferma dell'appuntamento e l'invio del link del form e del video pre-call» | «Noemi è l'unico nome dopo aver fatto invio.. come nello screenshot» |
| `19ebf9fd-f1a6-4c10-9650-a6bd2cbc8115` | Giulia Spizzico | 3885894036 | «Interrotta dopo la conferma dell'appuntamento e la richiesta di completare il form» | **«Si esatto confermo mercoledì 19 alle 12»** |

**Vi diciamo dove abbiamo sbagliato noi.** Avevamo letto "interrotta dopo la
conferma dell'appuntamento" come se fosse il lead ad aver confermato, e ne
avevamo concluso che fossero sette persone in attesa di una call. Guardando le
loro ultime frasi, per cinque di loro («Ok», «grazie», «21») la nostra lettura
non regge, ed è coerente con quello che dite voi.

**Ne restano due su cui vorremmo il vostro riscontro riga per riga**, perché
lì le parole del lead non sono generiche:

- **Giulia Spizzico**: «Si esatto confermo mercoledì 19 alle 12» è una conferma
  esplicita di giorno e ora. Se quel mercoledì 19 non è mai arrivato a noi come
  `APPUNTAMENTO`, è il caso che dicevate di voler sapere.
- **Viola Davide**: la sua frase lascia intendere che avesse già compilato il
  form e visto il nome di Noemi, cioè che fosse arrivata alla fine del vostro
  processo pre-call.

Se su entrambe la chat dice che il sì non c'era, ce lo diciamo e chiudiamo il
punto — abbiamo sbagliato noi e va bene così.

## 6. Quando il bot deve fermarsi davvero

Ci avete chiesto se esiste un caso in cui dovete proprio smettere. Sì, e sono
due. La buona notizia è che **i dati per riconoscerli ve li mandiamo già**, dentro
`lead-status`:

- **`presented: true` oppure `sold: true` → fermatevi sempre.** Quella persona si
  è presentata alla call, e se `sold` è vero è un cliente. È esattamente il
  campo che avrebbe evitato il messaggio di stamattina ai sei clienti, senza che
  dovessimo accorgercene noi per caso.
- **`discardReason` valorizzato → fermatevi.** È uno scarto deciso da una persona
  per un motivo che voi non potete vedere dalla chat: non in target, numero
  sbagliato, non interessato. Un lead che in chat dice «va bene, chiamatemi» può
  essere lo stesso che al telefono ha detto a un GDO di non chiamare più.

Sul resto siamo d'accordo con voi: `confermeOutcome: 'scartato'` **non** è uno
stop. Quello dice solo che non siamo riusciti a raggiungerlo al telefono, ed è
il caso in cui vogliamo che rifissiate — è tutto il senso del recupero NR.

Su Valentina quindi avete ragione voi: quel lead voleva una call e lo diceva il
giorno dopo lo scarto. Con il rifissaggio che ora riapre lo scarto, il
comportamento giusto è quello che proponete.

## Riassunto

**Fatto da parte nostra oggi:** `CONTATTO_UMANO` non viene più rifiutato, mai;
il rifissaggio riapre lo scarto e rimette il lead sulla board;
`risposta_dopo_terzo_nr` mappato; il pallino rosso sulla coda nei profili
Conferme.

**Sì a:** Mehdi, i 39 del "giorno e ora" (con gli esiti indietro), la
rispedizione di `e4ef3953`.

**Ci serve da voi:**

1. Sull'agenda del 31 luglio: i **timestamp delle richieste in ingresso** e da
   dove avete preso i nostri `leadId`.
2. Il **riscontro su Giulia Spizzico e Viola Davide**, con le parole esatte e
   l'ora.
3. Gli **esiti dei 39**, lead per lead, quando li avete lavorati.
4. Che usiate **`presented` e `sold`** come stop assoluto: è la sola cosa che
   impedisce da sola di scrivere a un cliente.

A presto,
