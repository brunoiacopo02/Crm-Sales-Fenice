# Calendario disponibilità venditori

Spec di design — 2026-09-12
Stato: approvata dal PO in brainstorming, pronta per il piano di implementazione.

## 1. Il problema

Le Conferme fissano gli appuntamenti sull'agenda dei venditori senza sapere davvero
chi è disponibile e quando. Oggi `getVenditoriAgenda` mostra solo il carico (gli
appuntamenti già fissati) e, per chi ha connesso Google, gli impegni del calendario
personale. Manca la cosa che serve: una **dichiarazione esplicita di disponibilità**.

Risultato: le Conferme fissano su un orario che sembra libero, il venditore non c'è,
e l'appuntamento salta senza che nessuno ne risponda.

La spec introduce un calendario di disponibilità settimanale obbligatorio, tre
conseguenze economiche, e una vista di copertura condivisa fra venditori, Conferme e
direzione.

## 2. Decisioni prese (PO, 2026-09-12)

| Tema | Decisione |
|---|---|
| Griglia | Ore piene 9:00–21:00, lunedì–sabato. Domenica non compilabile. |
| Vincolo sulle Conferme | ~~Avviso, non blocco. Possono fissare fuori disponibilità, ma quello slot non genera mai multa.~~ **Ripensamento PO, 2026-09-12 (stesso giorno, dopo la prima stesura di questa spec): Blocco con forzatura motivata. Admin e manager esenti.** Uno slot forzato continua a non generare mai multa. |
| Segnalazione assenza | La multa scatta subito; l'admin può annullarla con motivo. |
| Blocco tardivo (<1h) | Il sistema lo impedisce. |
| Compilazione in ritardo | Multa da 50 € definitiva, ma il calendario resta apribile. Una sola multa per settimana. |
| Soglia "compilato" | Basta aver salvato almeno una volta entro lunedì 14:00. Nessun minimo di ore. |
| Sales 001 | Esente da obblighi, promemoria e multe. Resta visibile ovunque e il suo calendario funziona se vuole usarlo. |
| Posizionamento | Due pagine nuove: `/mio-calendario` e `/calendari-venditori`. |
| Blocco su slot già occupato | Rifiutato (regola proposta da Claude, accettata dal PO). |
| Copertura | Mostra quanti venditori sono disponibili **e quali**, a venditori, Conferme e direzione. |

La griglia 9–21 Lun–Sab è confermata dai dati: sugli ultimi 90 giorni gli appuntamenti
assegnati a un venditore cadono quasi sempre a ora piena fra le 9 e le 21, con zero
appuntamenti di domenica.

## 3. Modello dati (migrazione `0034_sales_calendar.sql`)

Tutte le tabelle nuove sono multi-tenant (`companyId` con FK a `companies`), come il
resto dello schema.

### 3.1 `salesAvailabilitySlots` — la disponibilità dichiarata

Una riga = uno slot che il venditore ha dichiarato disponibile.

```
id           text primary key
companyId    text not null default 'fenice' references companies(id)
salesUserId  text not null references users(id) on delete cascade
slotStart    timestamptz not null      -- sempre ora piena Europe/Rome
weekStart    date not null             -- lunedì della settimana, Europe/Rome
createdAt    timestamptz not null default now()

unique (salesUserId, slotStart)
index (companyId, weekStart)
index (companyId, slotStart)
```

Assenza della riga = non disponibile. Togliere una disponibilità cancella la riga.

`weekStart` è ridondante rispetto a `slotStart` ma evita di ricalcolare il lunedì in
ogni query di copertura e compilazione; viene scritto dal server, mai dal client.

### 3.2 `salesSlotBlocks` — i blocchi

Una riga = un blocco su uno slot. Righe separate perché due follow-up possono cadere
nella stessa ora: il rilascio deve togliere solo il proprio blocco.

```
id           text primary key
companyId    text not null default 'fenice' references companies(id)
salesUserId  text not null references users(id) on delete cascade
slotStart    timestamptz not null
kind         text not null             -- 'MANUAL' | 'FOLLOWUP'
leadId       text references leads(id) on delete cascade   -- valorizzato su FOLLOWUP
note         text
createdBy    text references users(id)
createdAt    timestamptz not null default now()

index (companyId, salesUserId, slotStart)
unique index sales_slot_blocks_followup_uq on (salesUserId, leadId) where kind = 'FOLLOWUP'
unique index sales_slot_blocks_manual_uq   on (salesUserId, slotStart) where kind = 'MANUAL'
```

L'unique parziale garantisce che un lead non possa tenere due slot bloccati
contemporaneamente: spostare il follow-up sposta il blocco (UPDATE dello `slotStart`),
non ne aggiunge un secondo.

Il rilascio **cancella** la riga. La storia resta in `leadEvents`
(`slot_blocked` / `slot_released`).

### 3.3 `salesWeekPlans` — il registro della compilazione

```
id           text primary key
companyId    text not null default 'fenice' references companies(id)
salesUserId  text not null references users(id) on delete cascade
weekStart    date not null
submittedAt  timestamptz not null      -- primo salvataggio
updatedAt    timestamptz not null
slotCount    integer not null default 0
late         boolean not null default false   -- primo salvataggio dopo lunedì 14:00

unique (salesUserId, weekStart)
index (companyId, weekStart)
```

`submittedAt` non si aggiorna sui salvataggi successivi: è la prova di quando la
settimana è stata compilata la prima volta, ed è ciò che il cron legge.
`late` è calcolato al primo salvataggio e non cambia più.

### 3.4 `salesLatePenalties` estesa — un solo registro multe

Il PO ha chiesto che le multe nuove stiano "assieme a quelle per i follow up".
Si estende la tabella esistente invece di crearne una seconda, così il totale
mensile resta uno solo.

```
alter table "salesLatePenalties" alter column "leadId" drop not null;
alter table "salesLatePenalties" add column "reportedBy" text references users(id);
alter table "salesLatePenalties" add column "note" text;
alter table "salesLatePenalties" add column "voidedAt" timestamptz;
alter table "salesLatePenalties" add column "voidedBy" text references users(id);
alter table "salesLatePenalties" add column "voidReason" text;

create unique index sales_penalties_userkind_uq
  on "salesLatePenalties" ("salesUserId", kind, "dueAt")
  where kind in ('CALENDAR_MISSING', 'ABSENT_SLOT');
```

L'indice unico esistente `(leadId, kind, dueAt)` non protegge le multe nuove: in
Postgres due NULL non collidono, quindi due `CALENDAR_MISSING` passerebbero entrambe;
e un `ABSENT_SLOT` con lead e uno senza, sullo stesso slot, non collidono nemmeno.
L'indice parziale qui sopra chiude entrambi i buchi ignorando il `leadId`: per le due
multe nuove la chiave d'unicità è **venditore + tipo + scadenza**, che è esattamente la
regola voluta ("una sola multa per settimana", "una sola segnalazione per slot").

`kind` ammette ora quattro valori:

| kind | Importo | `leadId` | `dueAt` |
|---|---|---|---|
| `APPOINTMENT` | 10 € | obbligatorio | ora dell'appuntamento |
| `FOLLOWUP` | 10 € | obbligatorio | ora del follow-up |
| `CALENDAR_MISSING` | 50 € | null | lunedì 14:00 della settimana non compilata |
| `ABSENT_SLOT` | 50 € | opzionale (il lead dell'appuntamento, se c'era) | inizio dello slot |

**Vincolo su tutto il codice esistente**: ogni query che oggi legge
`salesLatePenalties` deve filtrare `kind in ('APPOINTMENT','FOLLOWUP')`, altrimenti il
runner dei ritardi e il Monitor Vendite si confondono. I punti da toccare sono
`src/lib/venditore/latePenaltiesRunner.ts` e `src/app/actions/venditoriMonitorActions.ts`.

**Annullamento**: una multa con `voidedAt` valorizzato resta visibile barrata e non
entra in nessun totale. Vale per tutti e quattro i `kind`.

### 3.5 `users.calendarExempt`

```
alter table users add column "calendarExempt" boolean not null default false;
update users set "calendarExempt" = true where email = 'sales001@fenice.com';
```

Nessun ID hardcodato nel codice: l'esenzione si accende e si spegne dalla pagina di
supervisione.

## 4. Regole di dominio

### 4.1 Lo slot

Uno slot è un'ora piena in Europe/Rome fra le 9:00 e le 21:00 (13 slot), dal lunedì al
sabato (6 giorni), per un totale di 78 slot a settimana.

Una data qualsiasi si porta sul suo slot troncando i minuti in Europe/Rome. Un
appuntamento delle 16:45 appartiene allo slot delle 16:00. Le date fuori dalla griglia
(prima delle 9, dopo le 21, di domenica) **non hanno slot**: nessun blocco, nessuna
multa, nessun conteggio di copertura.

Tutta la conversione vive in un unico modulo, `src/lib/venditore/calendarSlots.ts`,
costruito sopra gli helper esistenti di `src/lib/dateUtils.ts` (`toRomeDateStr`,
`weekBoundsRome`, `parseRomeDatetimeLocal`). Nessun altro file fa aritmetica sulle ore.

### 4.2 Disponibilità effettiva

```
disponibile(venditore, slot) =
    esiste salesAvailabilitySlots(venditore, slot)
    AND non esiste alcun salesSlotBlocks(venditore, slot)
```

Un appuntamento già fissato **non** rende lo slot indisponibile: lo slot resta
dichiarato e serve a dimostrare che il venditore doveva esserci. La vista lo mostra
come "occupato da appuntamento", che è un terzo stato visivo, non un blocco.

### 4.3 Compilazione settimanale

Il venditore può modificare la settimana corrente e le tre successive. Le settimane
passate sono in sola lettura.

Il salvataggio scrive in transazione: sostituzione completa degli slot di quella
settimana per quel venditore, più upsert di `salesWeekPlans`. È idempotente e
sopporta il doppio click.

`late = now() > lunedì 14:00` valutato solo al primo salvataggio della settimana.

Sales 001 (e chiunque abbia `calendarExempt`) può salvare ma non riceve né promemoria
né multe, e non compare fra i "non compilati" della supervisione.

### 4.4 Blocco manuale (imprevisto)

Consentito solo se **tutte** queste condizioni valgono:

1. lo slot inizia fra più di 60 minuti (`slotStart - now() > 60 min`);
2. lo slot è dichiarato disponibile;
3. **non c'è nessun appuntamento fissato in quello slot** per quel venditore.

Sul punto 3 il messaggio è esplicito: *"C'è un appuntamento alle HH:MM: avvisa le
Conferme per spostarlo."* Senza questa regola basterebbe bloccare a 61 minuti
dall'appuntamento per annullare la multa.

Sotto i 60 minuti il bottone è disabilitato con la spiegazione, non nascosto: il
venditore deve capire che la finestra è chiusa, non credere a un guasto.

Lo sblocco è sempre consentito.

### 4.5 Blocco automatico da follow-up

| Evento | Effetto sul blocco |
|---|---|
| Follow-up fissato o spostato (`rescheduleFollowUp`, `saveVenditoreOutcome` con nuovo follow-up) | upsert del blocco `FOLLOWUP` sullo slot della nuova data |
| Lead messo "In lavorazione" (`parkLead`) | blocco rilasciato |
| Esito registrato (chiuso / non chiuso / esito rimosso) | blocco rilasciato |
| Lead riassegnato a un altro venditore | blocco del venditore precedente rilasciato |
| Follow-up fuori griglia (prima delle 9, dopo le 21, domenica) | nessun blocco |

Il blocco si crea anche se il venditore non aveva dichiarato disponibile quello slot:
sono due concetti indipendenti, e l'effetto utile (Conferme vedono "occupato") è lo
stesso.

I punti d'innesto sono in `src/app/actions/venditoreActions.ts` e nel percorso di
riassegnazione già esistente (commit 8a28a6c). Ogni transizione scrive un `leadEvent`.

### 4.6 Multa "calendario non compilato" — 50 €

Gira dentro il cron esistente `/api/cron/sales-late-penalties` (già schedulato ogni 30
minuti): niente entry nuova in `vercel.json`, niente schedule nuovo da sorvegliare.

Al giro si guarda il **lunedì della settimana corrente**: se le sue 14:00 sono già
passate, per ogni venditore `isActive` e non `calendarExempt` senza riga
`salesWeekPlans` per quella `weekStart` si registra:

```
kind = 'CALENDAR_MISSING', amountEur = 50, leadId = null,
dueAt = lunedì 14:00, monthKey = mese del lunedì (Europe/Rome)
```

Il controllo si fa per settimana, non "solo di lunedì": così se il cron salta tutto il
pomeriggio di lunedì, la multa viene registrata al primo giro utile di martedì, sempre
datata lunedì 14:00. L'indice unico parziale rende il giro idempotente: il cron può
girare venti volte e la multa resta una.

**Kill-switch e attivazione**, gemelli di quelli dei ritardi:
`SALES_CALENDAR_PENALTIES=off` sospende, `SALES_CALENDAR_PENALTIES_FROM` (ISO) è la
data di entrata in vigore — senza quella env non viene registrato nulla, così la
regola non può partire retroattiva. È la lezione del malus ritardi, che sembrò rotto
per giorni solo perché la env non era in produzione.

**Kill-switch del muro del fissaggio** (§6.3), il terzo della famiglia:
`BOOKING_WALL=off` sospende il blocco sulle Conferme — solo quel valore esatto lo
spegne, il muro nasce acceso e resta acceso con la env assente o con qualunque altro
valore. Spento, le Conferme tornano a fissare dove vogliono e non viene più registrata
nessuna forzatura. Serve perché l'alternativa, se lunedì mattina il muro si rivelasse
ingestibile, sarebbe un revert e un redeploy sotto pressione con quattro persone ferme.

### 4.7 Multa "assente allo slot" — 50 €

Il bottone vive nell'agenda venditori che le Conferme già aprono. È attivo solo se:

1. lo slot è **già iniziato** e sono passate meno di **48 ore** dal suo inizio;
2. lo slot era **dichiarato disponibile e non bloccato** al momento in cui è iniziato;
3. il venditore non è esente;
4. non esiste già una segnalazione per quello slot.

Quando una condizione non vale, il bottone è disabilitato **con il motivo scritto**.
In particolare, sullo slot fissato fuori disponibilità: *"Questo slot non era
dichiarato disponibile: non può generare multa."* È la conseguenza diretta della
scelta "avviso, non blocco".

**Ripensamento PO, 2026-09-12: la scelta "avviso, non blocco" di §2 è diventata un
blocco con forzatura motivata.** Questa conseguenza resta comunque vera, e non per
caso: una forzatura avviene *solo* su uno slot non dichiarato o bloccato (§2 aggiornato),
cioè esattamente le due condizioni che il punto 2 qui sopra già rifiuta. Uno slot
forzato non può quindi mai generare multa, senza bisogno di codice apposta — è la
stessa regola di sempre, letta con l'occhio della forzatura invece che dell'avviso.

Sul punto 2 serve una precisazione, perché la disponibilità è mutevole: la verifica si
fa sullo stato **attuale** delle righe, non su uno storico. Un venditore non può però
cancellare a posteriori la disponibilità di uno slot passato — le settimane passate
sono in sola lettura (§4.3) — quindi lo stato attuale di uno slot passato coincide con
quello che era. I blocchi manuali su slot passati sono impossibili per la regola dei
60 minuti; un blocco `FOLLOWUP` rilasciato dopo lo slot è l'unico caso residuo, e in
quel caso il venditore era comunque impegnato per il CRM: la multa non scatta ed è
corretto così.

Effetto della pressione: riga `ABSENT_SLOT` da 50 €, `reportedBy` = la Conferma,
`dueAt` = inizio slot, `leadId` = il lead dell'appuntamento se ce n'era uno, nota
facoltativa. Notifica immediata al venditore.

### 4.8 Annullamento di una multa

Solo ADMIN, dalla scheda "Multe calendario". Motivo obbligatorio. La multa resta a
registro barrata con chi l'ha annullata e perché, e sparisce da tutti i totali.

## 5. I calcoli condivisi

Un solo modulo, `src/lib/venditore/calendarCoverage.ts`, produce i numeri che le tre
viste mostrano identici.

### 5.1 Copertura

Per ogni slot della settimana richiesta:

- `disponibili`: elenco dei venditori con disponibilità effettiva (§4.2), con nome;
- `occupati`: venditori con un appuntamento fissato in quello slot;
- `bloccati`: venditori con un blocco, distinti per `kind`.

I nomi sono visibili a tutti e tre i ruoli: il PO ha scelto esplicitamente che
venditori, Conferme e direzione vedano **chi** c'è, non solo quanti.

Sales 001 rientra nel conteggio se ha dichiarato: è esente dagli obblighi, non
invisibile.

### 5.2 Stima affluenza

Per ogni combinazione giorno-della-settimana × ora, sulle **8 settimane intere
precedenti quella corrente** (lunedì-domenica; la settimana in corso è esclusa perché
incompleta falserebbe la media). Finestra in una costante, modificabile:

- `attesi` = media degli appuntamenti fissati in quella fascia per settimana;
- `affluenza` = quota di quegli appuntamenti con `presentedAt` valorizzato;
- `personeAttese` = `attesi × affluenza`.

Sorgente: `leads` con `salespersonUserId` e `appointmentDate` valorizzati, letti in
Europe/Rome. È una statistica **d'azienda**, non per venditore: dice quando arrivano i
clienti, non chi li riceve.

`presentedAt` è la presenza latchata al giorno dell'appuntamento (spec 2026-07-17):
resta il campo giusto anche qui, perché un "Sparito" registrato al follow-up non deve
riscrivere l'affluenza storica di quella fascia.

Il semaforo di ogni cella:

| Colore | Condizione |
|---|---|
| rosso | `disponibili = 0` e `personeAttese > 0` |
| ambra | `0 < disponibili < personeAttese` |
| verde | `disponibili >= personeAttese` |
| neutro | `personeAttese = 0` |

## 6. Le superfici

### 6.1 `/mio-calendario` — il venditore

Voce di menu nuova per il ruolo VENDITORE, che oggi ha solo due voci.

Un interruttore in cima: **Il mio calendario** / **Copertura squadra**.

*Il mio calendario*: griglia 6 giorni × 13 ore, selettore settimana (corrente + 3
successive, passate in sola lettura), click sulla cella per dichiarare o togliere, un
solo bottone "Salva". Ogni cella mostra, oltre al proprio stato: l'eventuale
appuntamento fissato (nome lead), il lucchetto del blocco da follow-up, il blocco
manuale, quanti colleghi sono disponibili in quell'ora, e lo sfondo dell'affluenza
attesa. Menu per slot con "Blocca per imprevisto" (§4.4).

In cima una striscia di stato: countdown a lunedì 14:00 se la settimana è ancora da
compilare, oppure la multa registrata con la data, oppure la conferma di compilazione
con l'ora del salvataggio e le ore dichiarate.

*Copertura squadra*: la griglia di §5, con in ogni cella `N disponibili · ≈X attesi` e
i nomi, più il riquadro "Fasce scoperte questa settimana". È il caso d'uso che il PO
ha chiesto: *se vedo che giovedì alle 20 non c'è nessuno, mi organizzo*.

L'admin può aprire la pagina con `?venditore=<id>` per vedere il calendario di
chiunque, in sola lettura.

### 6.2 `/calendari-venditori` — direzione

ADMIN e MANAGER in scrittura, CONFERME in sola lettura (senza la scheda multe).

- **Copertura** — la griglia di §5 più la matrice venditore × slot, per vedere chi si
  accumula sulle stesse ore e chi manca sempre di sera.
- **Compilazione** — tabella venditore × settimana: compilato sì/no, quando, quante
  ore, se in ritardo. Da qui si accende l'esenzione.
- **Multe calendario** — elenco `CALENDAR_MISSING` e `ABSENT_SLOT` con chi ha
  segnalato, la nota e il bottone "Annulla" con motivo.

### 6.3 Agenda venditori delle Conferme

Modifiche a `VenditoriAgendaModal` e a `getVenditoriAgenda`:

- riga di copertura in cima a ogni giornata (`9–13: 3 · 14–17: 4 · 18–21: 1`) con il
  dettaglio dei nomi al passaggio;
- slot non dichiarati in grigio, con avviso — ~~non blocco~~ **ripensamento PO,
  2026-09-12: ora è un blocco, scavalcabile solo scrivendo un motivo che resta
  tracciato (evento `appointment_forced`); esenti solo admin e manager** — se ci si
  fissa sopra;
- ore dichiarate e ancora libere mostrate come pastiglia verde `Libero — 18:00` su
  oggi e sui giorni futuri: la riga di copertura dice solo chi è disponibile in
  **tutta** una fascia e perde chi ha dichiarato una sola ora, quindi da sola
  indicava dove *non* si può fissare e mai dove si può. Sul futuro la pastiglia non
  porta il bottone "Non c'era", che lì sarebbe solo un bottone spento;
- bottone "Non c'era" sugli slot passati, con le regole di §4.7 — lì la pastiglia
  resta quella grigia "Slot vuoto" di sempre;
- il muro si spegne senza deploy con `BOOKING_WALL=off` (§4.6).

### 6.4 `/monitor-vendite`

La sezione "Ritardi" diventa **"Ritardi e multe"**: filtro per tipo, colonna importo,
totale mensile che somma i 10 € e i 50 €, righe annullate barrate. È il posto che il PO
ha indicato ("assieme a quelle per i follow up").

### 6.5 Notifiche

Tramite `notifications`, canale già esistente:

| Quando | A chi | Tipo |
|---|---|---|
| Lunedì 10:00 e 13:00, se non ha compilato | venditore non esente | `calendar_reminder` |
| Multa registrata (qualsiasi tipo nuovo) | venditore | `calendar_penalty` |
| Segnalazione assenza | admin | `calendar_absence_reported` |

I due promemoria di lunedì girano nello stesso cron dei 30 minuti, con la stessa
guardia di idempotenza (una notifica per venditore per fascia).

## 7. Autorizzazioni

| Azione | Chi |
|---|---|
| Compilare il proprio calendario | VENDITORE (solo il proprio) |
| Bloccare/sbloccare uno slot proprio | VENDITORE (solo il proprio) |
| Vedere la copertura | VENDITORE, CONFERME, MANAGER, ADMIN, TL Conferme |
| Segnalare un'assenza | CONFERME, ADMIN |
| Annullare una multa | ADMIN |
| Cambiare l'esenzione | ADMIN |
| Vedere il calendario altrui | MANAGER, ADMIN, CONFERME (sola lettura) |

Ogni server action passa da `currentTenant()` + `assertSalesArea()` come il resto del
CRM. I venditori sono staff condiviso multi-tenant: le query che li elencano usano il
pattern `allowedCompanies` già presente in `getVenditoriAgenda`, non il solo
`companyId` — altrimenti su Serenamente la pagina esce vuota.

## 8. Casi limite

- **Ora legale**: il passaggio cade di domenica, fuori griglia. Le settimane restano
  di 78 slot perché gli slot sono generati per data locale, non per offset.
- **Venditore disattivato a metà settimana**: esce dai conteggi di copertura e dal giro
  delle multe; le sue righe restano a registro.
- **Appuntamento spostato fuori dallo slot dichiarato**: l'appuntamento vale comunque,
  ma quello slot non può generare `ABSENT_SLOT`.
- **Due follow-up nella stessa ora**: due righe di blocco, lo slot si libera quando
  cade l'ultima.
- **Segnalazione su slot con appuntamento poi annullato**: la multa resta (il venditore
  doveva esserci), annullabile a mano dall'admin.
- **Settimana compilata e poi svuotata**: `submittedAt` non si azzera, la multa non
  scatta. Un calendario vuoto è visibile nella scheda Compilazione con `slotCount = 0`;
  è un fatto da guardare, non una multa, coerente con la soglia scelta.

## 9. Test

Unitari, sul modello dei test già presenti in `src/lib/venditore/latePenalties.test.ts`:

- `calendarSlots`: troncamento all'ora in Europe/Rome, esclusione di domenica e delle
  ore fuori 9–21, confini di settimana, ora legale;
- regola dei 60 minuti: consentito a 61 minuti, negato a 59, negato con appuntamento
  presente;
- selezione dei non compilati al lunedì 14:00, con esenti esclusi e idempotenza;
- ammissibilità della segnalazione: le quattro condizioni di §4.7, una per test;
- copertura e affluenza: griglia nota in ingresso, semaforo atteso in uscita;
- rilascio del blocco follow-up su park, esito e riassegnazione.

Verifica manuale prima del rilascio: un giro completo da account venditore reale, uno
da Conferme, uno da admin, sulla settimana corrente.

## 10. Fuori scope

- Sincronizzazione bidirezionale con Google Calendar. Resta la lettura dei busy già
  esistente, mostrata come informazione in più.
- Disponibilità a mezz'ora.
- Assegnazione automatica degli appuntamenti in base alla disponibilità: la scelta
  resta delle Conferme.
- Trattenuta effettiva in busta paga: il CRM registra, non liquida.
