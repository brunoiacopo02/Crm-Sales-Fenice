# Le note del bot arrivano alle Conferme

Data: 2026-08-01 · Stato: design approvato dal PO

## Il problema

Dopo che il bot manda il video al lead, la chat continua: il lead disdice, chiede
di spostare, riconferma. Il bot ce lo racconta con `outcome: "NOTA"` su
`/api/bot/outcome` — 116 note negli ultimi 10 giorni, tutte operative:

> *"Il lead vuole annullare l'appuntamento. Motivo: rinuncia per problemi familiari."*
> *"Il lead ha chiesto di spostare a domenica 2 agosto alle 15:00."*
> *"Il lead ha riconfermato l'appuntamento."*

Oggi quelle note finiscono solo in due posti, e nessuno dei due è dove lavorano
le Conferme:

1. un evento `BOT_NOTE` in `leadEvents`, renderizzato **solo** nella timeline del
   `ContactDrawer` (quello della ricerca in Topbar), non nel `ConfermeDrawer`;
2. una notifica *"📋 Nota dal Fissatore"* nella campanella, mescolata a tutte le
   altre — e per giunta **non cliccabile**: `Topbar.tsx:122` non elenca
   `bot_note` tra i tipi che aprono il lead, quindi il click non fa nulla.

Il tab **Note** del `ConfermeDrawer` legge da `confirmationsNotes`, dove il bot
non scrive mai. Risultato: quel tab è vuoto anche quando il bot ha appena scritto
che il lead vuole disdire, e la notizia arriva all'operatore come una modifica
qualsiasi in mezzo alle altre.

C'è anche un problema di rumore: **il bot ri-manda la stessa nota 2-3 volte** a
distanza di minuti. Il 2026-08-01: Ramona Lazăr 3 volte, Micol Barbacci 2,
Filomena Madeo 2, Francesca 2.

## Il contratto col bot non cambia

Niente da chiedere al fornitore. `outcome: "NOTA"` resta com'è: tutto il lavoro
è dalla nostra parte. Al fornitore i duplicati li segnaliamo comunque, ma la
soluzione non dipende da loro.

## 1. Dedup della notifica, mai dell'informazione

Il duplicato **viene scritto lo stesso** come evento `BOT_NOTE`, con
`metadata.supersedes` che punta alla nota capofila. Gli eventi restano
immutabili: l'audit resta pulito e nessuna parola detta in chat va persa.

Il dedup sopprime solo il rumore: **niente notifica nuova** nella campanella
(una per intenzione, non tre) e **niente card ripetute** nel tab Note.

**Come si riconosce un duplicato.** Stesso lead, entro **15 minuti**, stessa
*intenzione*. L'intenzione è il testo normalizzato fino a `"Motivo:"` — è lì che
i duplicati veri coincidono, mentre la coda varia:

| | |
|---|---|
| 14:15 | Il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00). **Motivo:** non ha disponibilità economica al momento, ha chiesto di annullare la call. |
| 14:16 | …stesso incipit. **Motivo:** non ha disponibilità economica al momento, neanche a rate. |
| 14:18 | …stesso incipit. **Motivo:** non ha budget al momento, situazione economica non permette l'acquisto né le rate. |

Un confronto esatto non li prenderebbe. Il confronto sull'intenzione sì.

Estrazione della chiave, in quest'ordine:

1. il testo fino a `"motivo:"` (case-insensitive), se presente;
2. altrimenti la prima frase (fino al primo `.` seguito da spazio o fine);
3. altrimenti il testo intero troncato a 120 caratteri.

Poi normalizzata: minuscolo, spazi collassati, punteggiatura di coda rimossa.

**Catena piatta.** Si cerca l'ultimo `BOT_NOTE` dello stesso lead entro 15
minuti. Se quello ha già un `supersedes`, il nuovo evento eredita **lo stesso
valore**; altrimenti punta al suo id. Così `supersedes` indica sempre il
capofila, mai un anello intermedio: raggruppare è un `group by`, non una
risalita ricorsiva.

La notifica alle Conferme parte **solo per il capofila** (e come oggi solo se il
lead è in `APPOINTMENT`). Ai duplicati la notifica non parte.

La risposta al bot resta `200`, con `{ ok: true, noted: true, deduped: true }`
sui duplicati — informativa, non un errore: per lui è andata a buon fine.

## 2. Il tab Note diventa la sede unica

`getConfermeNotes` restituisce due sorgenti unite e ordinate per data
decrescente, ognuna marcata con `source: 'conferme' | 'bot'`:

- le note delle Conferme, da `confirmationsNotes` (invariate);
- le note del bot, da `leadEvents` con `eventType = 'BOT_NOTE'`.

Non nasce nessuna tabella nuova e non serve nessuna migrazione: le note del bot
restano negli eventi, che sono già la loro fonte di verità e tengono coerente la
timeline del `ContactDrawer`.

**Raggruppamento.** Le note con lo stesso capofila diventano **una sola card**:
in testa il testo più recente (di solito il più completo), sotto un
`+N aggiornamenti dal bot` espandibile con tutte le versioni e i loro orari.

```
🤖 Fissatore — dalla chat                            oggi 14:18
Il lead vuole annullare l'appuntamento (fissato per sabato 1
agosto alle 15:00). Motivo: non ha budget al momento, situazione
economica non permette l'acquisto né le rate.

▸ +2 aggiornamenti dal bot
    14:16 — …non ha disponibilità economica al momento, neanche a rate.
    14:15 — …non ha disponibilità economica al momento, ha chiesto di
            annullare la call.
```

Il raggruppamento è puramente di lettura: i tre eventi restano tre a database.
Se domani il fornitore smette di ri-mandare, il codice funziona identico senza
niente da rimuovere.

**Resa grafica.** Le note del bot hanno sfondo azzurro e intestazione
*🤖 Fissatore — dalla chat*, senza tasti di modifica: sono un resoconto, non un
appunto. Le note scritte dalle Conferme restano identiche a oggi. Il contatore
sul tab conta entrambe le sorgenti.

## 3. Il segnale sulla riga della board

`getConfermeLeads` attacca `lastBotNote` a ogni riga, con la stessa tecnica già
usata per `lastConfermeNote` (una query sola su tutti i `leadId` della board,
poi primo per lead).

`ConfermeBoardRow` mostra una riga azzurra 🤖 con l'anteprima troncata e
l'orario, sotto l'anteprima della nota Conferme già presente.

**Pill NUOVA.** Arancione, quando la nota del bot è più recente dell'ultima
attività delle Conferme sul lead — il massimo tra `confCall1At`, `confCall2At`,
`confCall3At` e la data dell'ultima nota Conferme. Così "nuova" significa
davvero *nessuno l'ha ancora vista*, e la pill smette di lampeggiare da sola
appena qualcuno lavora il lead: nessun campo di stato nuovo, niente da azzerare
a mano.

## 4. La notifica diventa cliccabile

Il click su *"📋 Nota dal Fissatore"* porta al lead **dentro la board Conferme**,
col drawer aperto sul tab Note — non sul `ContactDrawer` della ricerca, che non
è dove lavorano.

Serve un deep-link su `/conferme` che oggi non esiste: `?lead=<id>&tab=note`. La
pagina legge i parametri all'apertura, apre il `ConfermeDrawer` sul lead e
seleziona il tab. Se il lead non è tra quelli della board (già esitato, fuori
finestra) non si apre nulla e la notifica resta segnata come letta.

Per gli altri ruoli (MANAGER, ADMIN) la notifica `bot_note` non viene generata,
quindi il caso non si pone.

## Cosa resta fuori

- Le autorizzazioni del flusso `NOTA` lato API (minimo privilegio sui lead non
  assegnati al bot): invariate.
- Il tab Note dei GDO e le notifiche verso gli altri ruoli: non toccati.
- Il `ContactDrawer`: continua a mostrare i `BOT_NOTE` in timeline uno per uno,
  senza raggruppamento. È una vista di audit, lì la ripetizione è corretta.

## Verifica

- **Dedup**: tre note con lo stesso incipit entro 15 minuti → tre eventi a
  database, un solo `supersedes` capofila, **una** notifica, **una** card nel
  tab Note con `+2 aggiornamenti`.
- **Oltre la finestra**: stessa intenzione dopo 20 minuti → due capofila, due
  notifiche, due card. È un secondo tentativo del lead, non un duplicato.
- **Intenzioni diverse ravvicinate**: "vuole annullare" e poi "ha riconfermato"
  entro 15 minuti → due card distinte, due notifiche. La seconda non deve
  sparire dietro la prima.
- **Nota senza `"Motivo:"`** (es. *"Il lead ha riconfermato l'appuntamento."*) →
  la chiave cade sulla prima frase e il dedup funziona lo stesso.
- **Tab Note**: un lead con note Conferme e note bot le mostra tutte in ordine
  cronologico, distinguibili a colpo d'occhio, e il contatore le somma.
- **Pill NUOVA**: compare all'arrivo della nota, sparisce dopo che l'operatore
  registra una chiamata o scrive una nota su quel lead.
- **Notifica**: il click apre `/conferme` sul lead giusto, tab Note.
