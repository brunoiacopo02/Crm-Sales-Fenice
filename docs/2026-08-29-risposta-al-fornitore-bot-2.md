# Risposta al fornitore bot — 29/08/2026 (terza)

*Bozza pronta da mandare. Risponde alla loro seconda del 29/08.*

---

Ciao,

abbiamo verificato tutti e tre gli elenchi contro il nostro database. Su uno la
notizia è molto migliore di quella che vi aspettavate, e cambia anche cosa
dovete fare adesso — quindi partiamo da lì.

## 1. Gli 8 lead: **fermate tutto, non c'è niente da recuperare**

**Non ricontattateli.** Quelle 8 persone hanno già fatto la call, e sei di loro
hanno comprato.

Sui `leadId` che ci avete mandato avevate ragione voi e ragione noi
contemporaneamente: su quegli otto id da noi non è mai arrivato nessun
`APPUNTAMENTO` — timeline ferma a tre eventi (importato, assegnato, pushato a
voi), `updatedAt` identico al millisecondo a `createdAt`, mai riassegnati, sono
ancora fermi sull'account bot oggi. Ma gli appuntamenti li avete mandati davvero,
e li abbiamo ricevuti: **sono arrivati su un altro `leadId`, quello del lead
gemello con lo stesso numero di telefono.**

È il problema dei duplicati del punto 6 della vostra prima lettera, visto dal
lato opposto: noi creiamo un lead nuovo a ogni rientro da ActiveCampaign, voi
deduplicate per numero, e l'esito parte sotto l'id della conversazione che avete
già aperta. Poi noi vi ripushiamo il duplicato, e quello resta lì intonso a
sembrare un lead mai lavorato.

Ecco l'incrocio, e le date della call combaciano con quelle della vostra tabella:

| Nome | id che ci avete dato | id dove è arrivato l'appuntamento | Call | Com'è finita |
|---|---|---|---|---|
| Deborah Salmaso | `bc5e5fa2…` | `2b26e7b7…` | 08/08 15:00 | presentata → **chiusa €1.390** |
| Clea Tramontano | `9dc36cd0…` | `f458274e…` | 08/08 17:00 | presentata → non chiusa |
| Sherlyn Vera | `7abda86c…` | `03f9f607…` | 11/08 12:00 | presentata → **chiusa €3.179** |
| Kim Nobili | `44da42f6…` | `4c5ba3b2…` | 18/08 10:00 | presentata → **chiusa €3.179** |
| Mehdi | `1cf25901…` | `f5ad6e37…` | 18/08 12:00 | scartata dalle Conferme |
| Francesco Carinci | `554f665e…` | `0291441e…` | 18/08 13:00 | presentata → **chiusa €3.179** |
| Luca Soave | `ada8bc77…` | `4bfde594…` | 18/08 14:00 | presentata → **chiusa €1.890** |
| Natalia Nuca | `428b24b3…` | `bbc54dc4…` | 20/08 17:00 | presentata → **chiusa €3.179** |

**7 su 8 confermati dalle Conferme, 7 su 8 presentati, 6 vendite per €15.996.**

Quindi: niente WhatsApp a queste persone. Sei di loro sono clienti da tre
settimane, e ricevere un messaggio che gli chiede di rifissare una call che
hanno già fatto e pagato è il modo più rapido per far sembrare che non sappiamo
chi sono.

Un'unica cosa che vale la pena fare: **Mehdi** (`f5ad6e37`) è l'unico dei
gemelli che le Conferme hanno scartato senza che si presentasse. Se la chat è
ancora aperta, su quello sì, un messaggio ha senso.

Due date su otto non combaciano al minuto (Sherlyn 12:00 da noi contro 10:00 da
voi, Kim 10:00 contro 09:30): probabilmente rifissaggi successivi, e non
cambiano niente.

**Perché non si ripete:** è esattamente ciò che `personKey` e `previousLeadIds`
risolvono, e il vostro `leadIdCorrente` nella risposta all'intake chiude il
cerchio dall'altro lato. Da qui in avanti sappiamo entrambi che è la stessa
persona *prima* che l'esito parta, non tre settimane dopo.

**E questa è la ragione per cui i vostri 8 e i nostri 7 non si sovrappongono.**
Insiemi completamente disgiunti, 15 lead distinti. I nostri 7 restano un caso
diverso e ancora aperto: riassegnati il 24 agosto con causale `chat_interrotta`,
`appointmentDate` mai valorizzata su nessuno, e le vostre note che dicono
"interrotta **dopo la conferma dell'appuntamento**". Su quei sette non troviamo
nessun lead gemello con un appuntamento. Se anche lì l'esito è partito sotto un
altro id, ditecelo e chiudiamo pure quello; se invece l'appuntamento non è mai
stato mandato, allora sono ancora sette persone che aspettano una chiamata.

## 2. Il rifissaggio dopo lo scarto: **sì, viene accettato — e da oggi funziona davvero**

Risposta secca alla vostra domanda: **sì**, un `APPUNTAMENTO` con data nuova su
un lead che abbiamo scartato o riassegnato viene accettato. Vale in tutti e tre
i casi: lead scartato dalle Conferme, lead riassegnato a un GDO umano, lead
scartato da un GDO. Il bot può rifissare, non deve fermarsi alla segnalazione.

**Ma cercandolo abbiamo trovato un buco nostro, e l'abbiamo chiuso oggi.** Un
lead scartato per "3 NR consecutivi" resta con lo stato `APPOINTMENT`: cambia
solo il campo dell'esito Conferme. Il nostro ramo di rifissaggio aggiornava la
data ma non toccava quel campo — e la board delle Conferme mostra solo i lead
con l'esito ancora vuoto. Risultato: la Conferma riceveva la notifica dello
spostamento, la cliccava, e il lead non era da nessuna parte.

Cioè: fino a stamattina la vostra domanda avrebbe avuto risposta "sì, accettato"
ed effetto pratico zero. Adesso il rifissaggio **riapre lo scarto** e il lead
torna sulla board, con una notifica che lo dice esplicitamente («Recuperato: era
scartato, ha rifissato»).

Grazie di averlo chiesto: senza la vostra domanda quel buco sarebbe rimasto
aperto proprio mentre accendevamo il recupero NR, cioè nel momento peggiore.

## 3. Il `CONTATTO_UMANO` dopo il 3° NR e la sua categoria

Perfetto, ed è la parte che mancava: senza quel segnale il recupero si sarebbe
fermato a metà, e ve l'avevamo scritto proprio come rischio.

**`risposta_dopo_terzo_nr` è mappato**, in produzione da oggi, con la sua
etichetta dedicata («Ha risposto dopo il 3° NR — recuperabile»), più tre alias
(`risposta_dopo_3nr`, `risposta_dopo_terzo_tentativo`, `ha_risposto_dopo_nr`)
per non dipendere dalla forma esatta. Non finisce in `altro`.

Avete ragione anche sulla sostanza: uno che scrive "scusate, ero al lavoro" non
sta chiedendo di parlare con una persona, ma è esattamente il lead che vogliamo
riaprire.

## 4. I 10 esiti rifiutati: **il 403 era giusto, non allentate niente**

Li abbiamo verificati uno per uno, ed è netto: **nessuno dei dieci ha mai avuto
un `BOT_PUSHED` da parte nostra, e nessuno ha un'agenda recapitata dal vostro
canale.** Entrambe le prove di appartenenza mancano su dieci su dieci.

Sono lead di **sette GDO umani diversi** (105, 106, 109, 110, 114, 117, 119),
con l'appuntamento fissato a mano dal GDO fra il 30 e il 31 luglio e l'agenda
mandata via ActiveCampaign. Non sono mai passati da voi.

Uno di questi — `bea7627a`, Luca, di GDO 109 — è stato confermato, si è
presentato e ha **comprato per €2.890**. Se avessimo accettato un vostro esito
su quel lead, avremmo sovrascritto il lavoro di un GDO su una vendita vera.

Quindi no: la guardia resta, e non ce li rimandate. Vale la pena che guardiate
da parte vostra perché il bot stesse producendo esiti su conversazioni che non
erano sue — sospettiamo lo stesso meccanismo dei duplicati, con la chat
appaiata per numero a una persona che era in mano a un GDO.

## 5. I 12 lead: **sì, mandateceli — ma la causa è nostra, non vostra**

Confermiamo che da noi non c'è traccia di nessuno dei dodici in coda. La causa
però non è che le notifiche non siano partite: **la coda delle richieste di
contatto è nata l'8 agosto.** La prima riga in assoluto è dell'8 agosto alle
08:50. Tutti e dodici sono di luglio o dei primi quattro giorni di agosto: anche
se ce li aveste segnalati, non avevamo dove metterli. Non è un vostro problema
di trasporto e non è un nostro problema di ricezione: è una funzione che non
c'era ancora.

**Sì, mandateceli**, adesso hanno una coda dove atterrare.

Ma solo cinque sono davvero da recuperare, e vale la pena dirlo perché sono
quelli su cui concentrarsi. Delle dodici, **sette sono già state chiuse** (sei
scartate dalle Conferme, una confermata e poi persa dal venditore). **Cinque
non le ha mai chiamate nessuno:**

| leadId | nome | telefono | stato da noi |
|---|---|---|---|
| `b8c2c36b…` | Giuseppe Sorrentino | +393486935915 | mai chiamato, fermo dal 26/07 |
| `315a6821…` | Irina Zaharchenko | +393933578610 | mai chiamata, ferma dal 30/07 |
| `fe808e9e…` | Ilenia | +393717406388 | mai chiamata, ferma dal 01/08 |
| `62686ffe…` | Fiorella Magnera | +393387627990 | mai chiamata, ferma dal 02/08 |
| `dfb39eb0…` | Anna | +393484096111 | richiamo del 07/08 scaduto e mai lavorato |

Confermiamo i tre che dicevate avessero già un appuntamento (`971d511f`,
`42bd3fad`, `1736c0c8`): risultano anche a noi, fissati dal bot. Tutti e tre poi
scartati dalle Conferme.

## 6. Due cose vostre da guardare

**Il bot lavora chat su lead che da noi sono già chiusi.** Su `1736c0c8`
(Valentina Valente) le Conferme hanno auto-scartato il lead il 5 agosto dopo tre
mancate risposte, e il **6 agosto alle 07:32** ci arriva una vostra nota che
dice che il lead ha chiesto di spostare a sabato 8. Un giorno dopo. Da oggi il
blocco `contattoUmano` su `lead-status` vi dice quando una richiesta è chiusa e
con che esito — usatelo per fermare la chat, o per riaprirla come rifissaggio,
che ora funziona (punto 2).

**Un nostro record incoerente, per completezza:** `e4ef3953` (elisabetta) ha la
data di creazione dell'appuntamento valorizzata ma la data dell'appuntamento
nulla. Lo bonifichiamo noi, ve lo diciamo solo perché se lo leggete da
`lead-status` vi risulterà strano.

## Riassunto

**Fatto da parte nostra oggi:** il rifissaggio su lead scartato ora riapre
davvero lo scarto e rimette il lead sulla board (era il buco più grosso, e
l'avete fatto emergere voi); la categoria `risposta_dopo_terzo_nr` è mappata; il
pallino rosso sulle richieste di contatto nei profili Conferme, così la coda si
vede a colpo d'occhio e non solo dalla campanella.

**Risposte:**

1. **Sì**, un `APPUNTAMENTO` nuovo su lead scartato o riassegnato viene
   accettato — e da oggi ha anche l'effetto giusto. Il bot può rifissare.
2. **No al ricontatto degli 8**: hanno già fatto la call, sei hanno comprato per
   €15.996. Solo su Mehdi (`f5ad6e37`) ha senso.
3. **Sì alle 12 notifiche arretrate**, mandatele pure. Cinque sono quelle vive.
4. **No ai 10 esiti**: erano lead di GDO umani, il 403 era corretto, uno di
   quelli ha venduto per €2.890.
5. **Riscontro sugli 8**: fatto sopra — sono duplicati, non appuntamenti persi,
   e i vostri 8 non hanno nessuna sovrapposizione con i nostri 7.
6. **`risposta_dopo_terzo_nr` mappato.**

**Resta aperta una cosa sola, ed è quella dei nostri 7** del 24 agosto: su
quelli non troviamo nessun gemello con un appuntamento. Se anche lì l'esito è
partito sotto un altro id ditecelo e chiudiamo; altrimenti sono sette persone
che hanno confermato un appuntamento in chat e che nessuno ha mai chiamato.

A presto,
