# Conferme chiamano la mattina stessa — design (24/10/2026)

## Perché

Oggi le Conferme lavorano dalle 13 e coprono le call del mattino (9-14) chiamando
il pomeriggio del giorno prima. Per questo né il bot né i GDO possono fissare per
domani mattina: il primo giorno utile parte dalle 15.

Da **martedì** le Conferme attaccano **alle 9**. Le call del mattino si chiamano
la mattina stessa. Di conseguenza da **lunedì** chi fissa può proporre anche
domani mattina. La call si avvicina, e più è vicina meno l'imprevisto se la mangia.

Online **solo quando lo dice Bruno** (fine giornata 24/10 o inizio lunedì 26/10):
CRM e bot si preparano su branch, niente push su `main` prima del via.

## Regole decise da Bruno

1. **Fissare (bot e GDO)**: domani mattina e pomeriggio + dopodomani tutto il giorno.
   La fascia proposta va dalle **10:00 alle 21:00**. Le **09:00** restano possibili
   solo come ultima spiaggia, se il lead non può in nessun altro orario.
2. **Niente più limite delle 20:00 per il bot**: anche alle 22 di lunedì il bot
   fissa per martedì (mattina o pomeriggio) e mercoledì.
3. **Board Conferme**: il tab "Pomeriggio" diventa **"Oggi"** e mostra tutti gli
   appuntamenti di oggi dalle 09:00 alle 21:00.
4. **Il giorno prima, solo per le call del mattino fissate con anticipo**: se un
   appuntamento del mattino di domani è stato fissato *prima di oggi*, oggi le
   Conferme lo vedono nel tab **"Domani mattina"** e fanno una prima chiamata.
   - **Risponde e conferma**: è finita, la mattina dopo non serve un promemoria.
     Esce dalla board come oggi, perché ha `confirmationsOutcome` valorizzato.
   - **NR**: sparisce dalla lista di oggi e ricompare la mattina dopo in "Oggi"
     con NR1 già segnato (seconda chiamata). Il conteggio dei 3 NR resta quello di
     oggi (`recordConfermeNoAnswer`, al terzo NR scarto automatico).
5. **Fissato il giorno prima stesso** (es. lunedì per martedì 10:00): lunedì non
   compare da nessuna parte. Martedì mattina è in "Oggi".
6. **Pomeriggio**: nessuna chiamata il giorno prima, come adesso.
7. Il secondo giorno resta prenotabile tutto il giorno (confermato da Bruno).

### Esempi (lunedì = 26/10)

| Fissato | Per | Lunedì (Conferme) | Martedì (Conferme) |
|---|---|---|---|
| lun 16:00 | mar 10:00 | non lo vedono | "Oggi", lo chiamano dalle 9 |
| sab 24/10 | mar 11:00 | "Domani mattina", 1ª chiamata | se NR: "Oggi" con NR1; se confermato: niente |
| lun 11:00 | mer 17:00 | niente | niente (mercoledì in "Oggi") |
| lun 22:30 (bot) | mar 10:00 | — | "Oggi" |

## Mie scelte (da controllare)

- **"Mattina" = 09:00-14:59**, cioè le ore 9-14 come la board di oggi. Il
  "pomeriggio" parte dalle 15 ([[feedback_pomeriggio_dalle_15]]).
- **"Fissato prima di oggi"** = `appointmentCreatedAt` precedente alla mezzanotte
  di oggi, ora di Roma. Un lead senza `appointmentCreatedAt` si tratta come
  fissato con anticipo: si vede, e meglio una chiamata in più che una persa.
- **In "Domani mattina" restano solo i lead senza alcun NR** (`confCall1At` nullo)
  e ancora da lavorare. Dopo un NR il lead torna visibile solo il giorno della call.
- **Eccezione per le 09:00**: un appuntamento alle 09:00 di domani compare in
  "Domani mattina" anche se è stato fissato oggi. Alle 9 le Conferme attaccano e
  non farebbero in tempo a chiamarlo prima. Un 09:00 fissato dopo che le Conferme
  hanno staccato la sera prima non lo chiama nessuno prima della call: lo si
  accetta, le 9 sono solo per le emergenze.
- **Sabato e lunedì**: la regola è la stessa per tutti i giorni lavorativi
  (lun-sab). Il sabato "Domani mattina" riguarda il lunedì. Un lunedì mattina
  fissato venerdì si chiama sabato. Uno fissato sabato si chiama lunedì mattina.
  La domenica non lavora nessuno: il codice applica la stessa regola senza casi
  speciali (oggi = domenica, "Domani mattina" = lunedì).
- **Spariscono** le regole per giorno della settimana di `strict_kanban`
  (sabato 13-21, venerdì con l'eccezione 13-14 delle 12 ore, ecc.). Spariscono
  anche gli override festivi datati e ormai scaduti (24/04, 30/04, 01/06/2026). Il
  "prossimo giorno lavorativo" resta: dopo il sabato viene il lunedì.
- **Appuntamenti spostati**: uno spostamento conta come un fissaggio nuovo.
  "Fissato prima di oggi" vuol dire che l'ultimo fissaggio o spostamento è prima
  di oggi. Lo spostamento si legge dall'evento che lo registra (quello con
  `previousAppointmentDate`): una query sola sui lead candidati, nessuna colonna
  nuova. Esempio: spostato oggi a domani 10:00 → oggi non compare in "Domani
  mattina", domani è in "Oggi".
- **"Senza NR" vuol dire senza NR registrati oggi**: un NR vecchio, di una data
  precedente, non lo nasconde. Il conteggio dei 3 NR resta quello di adesso: la
  regola dei reset non si tocca.
- **Chiusure aziendali**: il CRM continua a non leggerle, come oggi. Alla
  vigilia di una chiusura si fa un override a mano, come per le festività di
  aprile e giugno.
- **Avviso GDO** (`src/components/GdoQuickActions.tsx`, `appointmentSlotWarning`):
  oggi dice "domani dalle 15:00 alle 22:00". Va aggiornato alla regola nuova:
  domani e dopodomani dalle 10 alle 21, le 09:00 solo come ultima spiaggia. Resta
  un avviso, non un blocco.
- **Cosa promette il bot al lead su Noemi** (vale anche per [QUANDO] nella
  CONFERMA POST-APPUNTAMENTO e per `quandoChiamaNoemi`): se la call è dalle 15 in
  poi, come oggi. Se è del mattino (10-14):
  - call di domani rispetto a quando scrive → "ti chiama la mattina stessa, dalle 9";
  - call più in là → "ti sente già il giorno prima, e se non ti trova la mattina
    stessa".

  Una call alle 09:00 si tratta come "il giorno prima".
- **Fuori perimetro**: le analytics Conferme (`confermeAnalyticsActions`,
  `LoadCard`) che dividono mattina e pomeriggio, il flusso lancio (i prenotati
  della mattina nascono già confermati e non entrano nella board) e i template
  WhatsApp. Non cambiano.
- **GDO**: nel CRM non esiste un blocco sull'orario di fissaggio. La regola
  "dalle 10, le 9 solo in emergenza" la comunica Bruno, nessuna modifica al codice.

## Cosa cambia — CRM (questo repo)

- `src/app/actions/confermeActions.ts` → `getConfermeAppointments`, ramo
  `strict_kanban`: sostituire il filtro per giorno della settimana con la regola sopra
  (oggi 9-21 + prossimo giorno lavorativo 9-14 fissato prima di oggi, oppure alle
  09:00, senza NR). La finestra di query (−1/+4 giorni) e i "da definire"
  (`confNeedsReschedule`) restano come sono. La regola va in una funzione pura
  testabile (es. `src/lib/conferme/boardWindow.ts`) con test accanto, sul modello
  dei `.test.ts` già presenti in `src/lib`.
- `src/components/ConfermeBoard.tsx`: tab "Pomeriggio" → **"Oggi"** (ore 09-21 per
  tutti i giorni), tab "Mattina" → **"Domani mattina"** (ore 09-14). `ViewMode`
  `'pomeriggio' | 'mattina'` rinominati `'oggi' | 'domani'` insieme agli usi
  (deep-link, auto-selezione ora, conteggi). Nessun canale realtime toccato.
- Verificare che nessun altro chiamante dipenda dal vecchio filtro
  (`fetchMode: 'strict_kanban'`, `timeSlot`).

## Cosa cambia — Bot (repo `whatsapp-lead`, worktree nuovo da `origin/main`)

- `lib/booking-slots.ts`:
  - togliere la rotazione delle 20:00 in `computeBookingDays`;
  - entrambi i giorni con la fascia "dalle 10:00 alle 21:00; le 09:00 solo se il
    lead non può in nessun altro orario" (al posto di `fascia(day1Imminente)` e
    di "dalle 09:00");
  - aggiornare i commenti che parlano delle 20:00.
- `lib/bot-outcome-rules.ts`: `APPUNTAMENTO_ORA_MIN` resta 9, perché le 9 sono
  ammesse. Aggiornare il commento sulla finestra che ruota alle 20:00.
  `bookingDays` continua a viaggiare dal prompt alla guardia: a mezzanotte la
  finestra ruota ancora.
- Quando chiama Noemi (`lib/mario-prompt.ts` blocco "QUANDO CHIAMA",
  `lib/gdo-context-note.ts` `quandoChiamaNoemi` + `NOEMI_SOGLIA_STESSO_GIORNO`,
  commento in `lib/fenice-autoreply.ts`):
  - call dalle **10:00 in poi**: lo chiama lo stesso giorno, qualche ora prima
    (per una call del mattino, la mattina stessa dalle 9). Se la call è fissata con
    qualche giorno di anticipo, può sentirlo già il giorno prima;
  - call alle **09:00**: lo chiama il giorno prima;
  - togliere "attacca alle 13" e "mai la mattina stessa", e togliere "ti chiama la
    mattina stessa" dalle frasi vietate. Restano vietate le frasi tipo "pochi
    minuti prima". Resta "dagli la finestra, mai un orario al minuto".
- Test accanto ai moduli toccati (`booking-slots.test.ts`,
  `bot-outcome-rules` test, `gdo-context-note` test) aggiornati alle nuove regole.

## Rilascio

1. CRM su branch `feat/conferme-mattina-stessa`, bot su un branch omonimo in un
   worktree nuovo. Build + test verdi su entrambi.
2. Al via di Bruno: merge su `main` di entrambi, possibilmente insieme. Se uno
   solo va online, è meglio prima il CRM: una board che mostra la mattina senza
   bot che la fissa non fa danni, il contrario sì.
3. Verifica deploy (Vercel) e smoke test: board Conferme con i due tab, prompt del
   bot con le nuove fasce.

## Cosa lascio a chi costruisce

Nomi di file e funzioni nuovi, struttura dei test, testo esatto delle righe del
prompt, purché rispetti le regole sopra e lo stile già presente nel prompt.
