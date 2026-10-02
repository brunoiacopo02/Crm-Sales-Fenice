# Lancio Web Dev AI — tre strade dopo il pulsante e tetto Conferme (Pezzo 1)

Data: 2026-10-02 · Decisioni PO: Bruno (sessione del 02/10) · Repo coinvolti: CRM (`CRM GDO`) e bot (`Software Messaggistica`)
Estende: `2026-09-14-lancio-webdev-ottobre-design.md` (§4.2, §4.4, §4.5, §5.4). Dove questo documento contraddice quello, vale questo.

## 0. Obiettivo

Chi preme il pulsante WhatsApp del webinar (5/10/2026 ore 21) deve:
- se vuole essere chiamato subito, essere passato in fretta al venditore con due domande che gli diano leva;
- se prenota la mattina del 6 con un venditore, arrivarci **prequalificato** (pain point, pacchetto, impegno a decidere);
- in ogni altro caso finire alle Conferme senza mai sovraccaricarle: **massimo 25 appuntamenti del bot per ora**, riempiendo un giorno dopo l'altro.

Fuori perimetro (Pezzo 2, spec separata, acceso dal 6/10 quando c'è il link del video riassunto): Mario che porta tutti i lead nuovi sul Web Developer col video del webinar.

## 1. Decisioni PO (02/10)

1. **Sera del 5, chiamata subito**: tutti e 7 i venditori nel turno SERA, nessun tetto (il round robin di oggi non ne ha: va bene così).
2. **Chiamata subito**: prima di passarlo, il bot chiede due cose (una alla volta): cosa lo spinge a un percorso così; perché proprio adesso. Poi: *"Perfetto, ti faccio chiamare subito da [nome]. È una chiamata breve per valutare insieme le ultime cose e fare l'iscrizione, così blocchi il tuo posto: sono limitati."* Obiezioni o rifiuto di rispondere → *"ne parli direttamente col tutor"* e lo fa chiamare comunque. Le domande non sono un cancello.
3. **Chiusura presunta**: nessun testo del bot verso il lead contiene condizionali sulla chiusura ("se ti convince", "se ti interessa", "eventualmente").
4. **Mattina del 6 (9-14) → venditore diretto**: limite = calendario (uno slot dichiarato libero = un lead). Unica strada con la **prequalifica completa**.
5. **Tutto il resto → Conferme**, tetto **25 appuntamenti del bot per ora**. Vale la sera del lancio e tutti i giorni seguenti.
6. **Riempimento**: lun-sab, ore 9-20, domenica esclusa, nessuna data di fine. Ora piena → ora libera più vicina; giorno pieno → giorno dopo, dicendo che siamo pieni.
7. **Strada Conferme**: qualche domanda leggera (situazione, pain point, budget), meno spinta, senza impegno; il bot chiede al lead quando ci sarebbe in quel giorno e lui dice se è fattibile; chiusura *"Ti chiamerà Noemi per confermare: rispondile!"*. Niente agenda Jotform, niente video.
8. **Tutte le risposte arrivano al sales** nel CRM, compreso il drawer del venditore.
9. Invariati: restituzioni ai GDO (dal 7/10, 24h di silenzio), mai passaggio a una persona per i lead del lancio, interruttori del lancio decisi da Bruno.

## 2. La conversazione (bot)

La scelta iniziale non cambia: di notte (fino alle 03:00 del 6) pulsanti "Chiamami subito" / "Fissiamo domani"; di giorno "Oggi pomeriggio" / "Domani mattina".

### 2.1 Strada 1 — Chiamata subito
- Sostituisce il riscaldamento attuale (2 domande generiche, saltate se il lead chiede la chiamata) con le **due domande della decisione 2**, anche quando il lead ha premuto "Chiamami subito".
- Dopo la seconda risposta (o a un'obiezione / un rifiuto / una risposta che non risponde) → `[LANCIO:CHIAMA_ORA]` → `call-now` → testo della decisione 2 col nome del venditore restituito dal CRM.
- `nessun_venditore` (turno SERA vuoto): resta il ripiego di oggi sulla prenotazione.

### 2.2 Strada 2 — Mattina del 6 col venditore (prequalifica)
Si attiva quando l'ora scelta dal lead è una delle ore mattina del 6 restituite come libere dal CRM.
1. Il bot **non prenota subito**. Annuncia: *"Visto che i posti sono limitati, prima della call ti faccio due domande per capire se il percorso è in linea con te."*
2. Domande, una alla volta:
   - pain point: cosa non va oggi nel lavoro / nella situazione;
   - pacchetto: *"Durante la live abbiamo presentato Advance, Gold ed Exclusive: a quale pensavi?"* — **mai prezzi né descrizioni**; se il lead chiede le differenze: *"le vedi col tutor in call"*;
   - impegno: *"In call col tutor chiudete le ultime cose e fai l'iscrizione: l'obiettivo è decidere lì, un sì o un no. Ti va bene?"*
3. Poi `[LANCIO:PRENOTA|<ISO>]` → `book`. Le risposte viaggiano in `info.risposte`.
4. `409 ora_esaurita` sulla mattina → il bot propone la prima ora venditore ancora libera; se non ce ne sono → passa alla strada 3 **senza rifare le domande** (le risposte già raccolte vanno comunque al CRM).
5. Obiezione sull'impegno: il bot risponde in breve ("ne parli direttamente col tutor") e prenota comunque (stessa logica della chiamata subito); la risposta va nel campo risposte così il venditore la vede.

### 2.3 Strada 3 — Conferme
1. Qualche domanda leggera, una alla volta, al massimo tre: situazione attuale, pain point, budget (formulato come disponibilità a investire su sé stesso, senza cifre del bot).
2. Il bot chiede al CRM il **primo giorno con posto** (§3.2) e chiede al lead: *"[Giorno] a che ora ci saresti?"*
3. Ora proposta dal lead:
   - libera → prenota;
   - piena o fuori fascia → propone l'ora libera più vicina dello stesso giorno;
   - giorno pieno → *"[giorno] siamo pieni, ti va [giorno successivo con posto]?"*
4. Dopo `book` ok: *"Fissato per [giorno] alle [ora]. Ti chiamerà Noemi per confermare: rispondile!"*
5. Niente agenda, niente video, niente Jotform.

### 2.4 Regole dure lato bot
- Il bot non calcola mai disponibilità: propone solo ore restituite dal CRM e rilegge `409` col nuovo stato.
- `validaAtLancio` si allarga alle regole del §3.1 (lun-sab, 9-20, ora tonda, ≥1h di anticipo, dal giorno dopo l'evento in poi senza fine); la mattina del 6 resta l'unica fascia venditori.
- Il testo "domattina è tutto pieno" e simili continuano a nominare il giorno col nome reale (`Intl` it-IT).
- Test di regressione sui prompt: assenza di "se ti convince" / "se ti interessa" / "eventualmente" nei testi verso il lead; assenza di prezzi nella domanda sui pacchetti.

## 3. CRM

### 3.1 Regole sull'ora (`classifyAt`, `src/lib/lancio/rules.ts`)
| Data/ora | Kind | Destinazione |
|---|---|---|
| 6/10, 9-14 | `mattina` | venditore del turno GIORNO_DOPO (invariato) |
| 6/10, 15-20 | `pomeriggio` | Conferme, `lancioScelta='app_pomeriggio'` (invariato) |
| ogni altro giorno lun-sab dal 7/10, 9-20 | `conferme` (nuovo) | Conferme, `lancioScelta='app_conferme'` (nuovo) |
| domenica, fuori 9-20, non tonda, <1h | — | `422 fuori_regole` |

`app_dopodomani` resta leggibile per i lead già prenotati (retrocompatibilità), non viene più scritto.

### 3.2 Endpoint `slots` (`/api/bot/lancio/slots`)
- Input attuale `{date}` resta valido (risposta invariata nei campi esistenti, così il bot di oggi non si rompe).
- Nuovo input `{ from: 'YYYY-MM-DD' }` (oppure `{date}` con `cerca:true`): il CRM cerca **il primo giorno ≥ from** (lun-sab) con almeno un'ora Conferme sotto il tetto, entro un orizzonte di sicurezza di 30 giorni. Risponde:
  `{ ok, date, mattina: [{hour, liberi}] | null, conferme: [{hour, liberi}], pieno: string[] /* giorni saltati */ }`
  dove `conferme[].liberi = 25 - occupati` (solo ore con `liberi>0` e prenotabili per anticipo); `mattina` è valorizzata solo se `date` = 6/10.
- Il `pomeriggio` del formato vecchio diventa una vista di `conferme` per il 6/10.

### 3.3 Tetto in `book` (`bookLancio`, `src/lib/lancio/booking.ts`)
- Per i kind `pomeriggio` e `conferme`: advisory lock per ora (`lancio:conferme:<YYYY-MM-DD@H>`), poi conteggio
  `count(*) from leads where launchBucket = LANCIO and lancioScelta in ('app_pomeriggio','app_dopodomani','app_conferme') and appointmentDate in [ora, ora+1h) and id <> lead`.
  `≥ LANCIO_CONFERME_CAP_ORA` (costante in `config.ts`, 25) → `409 ora_esaurita` con gli `slots` aggiornati (formato §3.2).
- Contano solo gli appuntamenti del bot del lancio (non quelli dei GDO). Un lead che sposta la propria ora non conta sé stesso.
- Tutto il resto di `bookLancio` invariato (reset Conferme, notifica `lancio_appuntamento`, badge, dedup, `gia_prenotato`).

### 3.4 Conferme e monitor
- `lancioPriority` e `lancioSceltaLabel` (`src/lib/lancio/conferme.ts`) riconoscono `app_conferme` (priorità 1, etichetta *"Appuntamento [giorno e ora], scelto in chat col bot"*).
- `checkLancioReturnToPool` tratta `app_conferme` come scelta fatta (mai restituito).
- Monitor `/lancio` (`src/lib/lancio/monitor.ts`): nuova colonna "Conferme (altri giorni)" e, per i prossimi giorni, appuntamenti per ora rispetto al tetto.
- Tipo `LancioScelta` e commento sullo schema aggiornati (colonna `text`, nessuna migrazione).

### 3.5 Venditori
- `VenditoreDrawer` mostra il blocco "Dal bot – lancio" (`lancioBotInfo.risposte` + scelta) come già fa `ConfermeDrawer`, per qualunque lead del lancio assegnato al venditore (mattina del 6, chiamate subito, e lead passati dalle Conferme).
- I turni su `/lancio` li compila Bruno (tutti e 7 in SERA; i venditori della mattina in GIORNO_DOPO).

## 4. Contratto bot ↔ CRM
Aggiornare `docs/bot-fissatore-contract.md` (Direzione 6) a **v1.8**: nuovo input `from` di `slots`, campo `conferme`, kind `conferme`, `lancioScelta='app_conferme'`, `ora_esaurita` anche su pomeriggio/conferme.

## 5. Rilascio
1. CRM per primo (retrocompatibile: il bot di oggi continua a funzionare col formato vecchio). Push su main = deploy.
2. Bot dopo. Push su `origin/main` = deploy; verificare `git rev-list --count origin/main..main` = 0.
3. Entrambi in produzione **entro sabato 4/10 sera**; domenica 5/10 mattina prova dal vivo delle tre strade col numero di test; dal pomeriggio del 5 nessun deploy.
4. Nessun interruttore del lancio viene toccato da sessioni o script (`lancio_pulsante_attivo` lo accende Bruno dopo le 21 del 5).

## 6. Test
- CRM: `classifyAt` per tutte le righe del §3.1 (domenica, 21:00, 6/10 mattina, 8/10 10:00); tetto con 24 → ok, 25 → `ora_esaurita`; lock concorrente (due prenotazioni sull'ultimo posto → una sola passa); `slots {from}` salta giorni pieni e domenica; `app_dopodomani` ancora riconosciuto da priorità, etichetta e restituzioni; drawer venditore mostra le risposte.
- Bot: le tre strade (chiamata subito con e senza obiezione; mattina con prequalifica e con `ora_esaurita` → ripiego senza ridomande; Conferme con ora piena e giorno pieno); `validaAtLancio` nuovo perimetro; regressioni sui testi (§2.4).
- Prova dal vivo col numero di test (runbook `docs/lancio-webdev-runbook-b6.md` del bot), senza toccare lead veri.

## 7. Rischi
- **Calendari della mattina del 6 non compilati** → la strada 2 sparisce e tutto va alle Conferme (accettabile: il tetto le protegge). Bruno fa compilare i calendari prima del 5.
- **Prequalifica che allunga la chat** → qualcuno sparisce prima di prenotare: torna ai GDO con le restituzioni esistenti.
- **Domande sul pacchetto** → il bot non conosce i contenuti né i prezzi: risposta fissa "le vedi col tutor in call".
