# Restyle "Diretta" e nuova gamification (GDO + Conferme)

Data: 25/10/2026. Go-live: lunedì 26/10/2026, prima delle 13:30.
Fonti: decisioni di Bruno in chat (riassunte nella memoria `project_restyle_gdo_diretta.md`), ricerca su motivazione e gamification, progetto dell'economia e audit del codice (sintesi in `sintesi_agenti.md` nello scratchpad della sessione).

## Intento

Noemi e Lavinia tornano a fissare lunedì e Bruno vuole che tutti percepiscano un cambiamento positivo. Il CRM deve smettere di sembrare fatto in "vibe coding" e diventare uno strumento scuro, da diretta sportiva, che mette davanti il lavoro e il risultato. La gamification deve premiare i risultati verificati e la squadra, non l'attività grezza. Tutta la parte di creature, avventura, scambi, duelli, boss, loot e forzieri a tempo sparisce.

## Non obiettivi

- Non cambiano le **logiche degli esiti**: OutcomeModal e GdoQuickActions restano con lo stesso contratto (lock `leadVersion`, CONCURRENCY_ERROR, timeout, avviso orari, script_completed). Cambia solo la grafica. Niente scorciatoie da tastiera.
- Lo **script di vendita** non si tocca.
- **Serenamente** si ignora: per GDO e Conferme non esiste (niente scelta azienda, niente banner cross-azienda).
- Non si cancellano tabelle né righe storiche: si smette di usarle.
- Non si toccano i canali realtime esistenti (`realtimeBus`, `postgres_changes`) né l'emissione di `realtime_update`.
- Venditori e manager: niente restyle in questo giro, salvo la citazione del giorno.

## Anti-obiettivi (fallimento anche se funziona)

- Un GDO che vede scritto "bot", "ridato dal bot", "Fissatore" o "GDO 201" sulle sue schermate.
- Numeri di squadra o personali diversi da quelli veri, o lenti da far sembrare il CRM rotto.
- Nuovo carico sul database che ricrei l'incidente di saturazione di luglio.
- Monete ottenibili con esiti falsi, doppi click, rifissaggi o race condition.
- Schermata bianca (WSOD) per bottoni dentro `span`/`p` o per orologi calcolati lato server.

## Vincoli

- Next 16.1.6, React 19, Tailwind v4 (`@theme` in `globals.css`), Drizzle, Supabase prod (le preview usano il DB di prod).
- Migrazioni solo additive, numerate dopo la 0044.
- Fuso Europe/Rome per ogni conteggio. Lunedì 26 è il primo giorno di ora solare: niente offset fissi, si usano `dayBoundsRome` / `romeOffset`.
- Stile: file `stile-fenice-slide-SKILL.md`. Arancione `#FF9330`, nero `#171717`, chiari `#F2F2F2` e `#F5F5F5`, tonale `#FFF1E3`, Poppins 400/500/600, raggi 8/16. Niente ombre, gradienti, pillole, emoji, monospace (`tabular-nums` sui numeri). Sull'arancione il testo è nero.
- Tema di Andrea e tema Serenamente non devono rompersi: il nuovo stile vive sotto `[data-ui="diretta"]`, in fondo a `globals.css`, senza rinominare classi condivise.

## Accensione e sicurezza

- Interruttore `appSettings` `gdo_ui_diretta` (e `conferme_ui_diretta`): spento = UI attuale, acceso = Diretta. Si spegne senza deploy.
- L'attributo `data-ui="diretta"` sul div radice del layout compare solo per il ruolo interessato con l'interruttore acceso.
- Verifiche prima di accendere: `tsc`, `npm test`, `next build`, smoke test con un account GDO vero sul deploy, poi controllo degli errori Vercel e di `pg_stat_statements` nella prima ora.

## Persone e nomi

- Nuova colonna `users.firstName`, nullable. `name` e `displayName` ("GDO 1xx") restano, perché li usano il cron di riscaldamento, il bot, i webhook e i report.
- Nomi: 105 Anthony, 106 Zora, 107 Noemi, 110 Alessandro, 112 Beatrice, 114 Christel, 115 Christian, 116 Lavinia, 118 Lorenzo, 119 Riccardo.
- **Squadra** = GDO umani con `firstName` valorizzato e `isActive`. 108 (IA vocale) e 201 (bot) restano fuori da squadra, classifica e cronaca.
- I nomi veri si vedono sulle schermate GDO, Conferme e manager. Nei report che usano il codice, il codice resta.
- Riattivare 107 e 116. Il 118 passa a Lorenzo, setter da remoto con le stesse logiche dei GDO. Le password sono già cambiate e le sessioni del 118 revocate.

## Lead

- **Lancio**: tutti i lead del lancio vanno tolti ai GDO.
- **Ridati dal bot**: vanno a tutti i GDO umani della squadra.
- **Vergini**: 10 al giorno a ciascun GDO, tranne Lorenzo, Christel e Beatrice. Compaiono in cima appena arrivano e vanno chiamati subito. Le assenze le comunica Bruno, che ridistribuisce dalla sezione esistente in /gestione.
- **Ora di arrivo** mostrata: l'ultima assegnazione al proprietario attuale, presa da `REASSIGNED_FROM_BOT` o `REASSIGNED_ADMIN` (`metadata.toAssigneeId`) o `ASSIGNED`. In mancanza si usa `assignedAt` e poi `createdAt`. La lista è ordinata per ora di arrivo decrescente, con `id` come spareggio.
- Nelle schermate GDO non compare mai alcun riferimento al bot: tooltip di LeadCard, motivo "Ti ha cercato" (si mostrano solo le parole del lead), timeline del ContactDrawer, "Assegnazione/Operatore GDO 201", modale duplicati, /lancio-umani.

## Obiettivi (tutti modificabili dall'admin)

| | Primo scalino | Secondo scalino |
|---|---|---|
| Personale, fissati al giorno | 8 | 10 |
| Squadra, fissati al giorno | 55 | 65 |
| Ora di punta, fissati di squadra | 14 | 20 |

- Ora di punta: lun-ven 18:00-19:00, sabato 11:00-12:00. Il sabato valgono gli stessi scalini.
- Turno: lun-ven 13:30-20:00, sabato 10:00-16:30.
- Pause: 15:30-15:45 e 17:45-18:00 (sabato: da definire).
- Presenze: obiettivo 7 a settimana. Ogni presenza dalla **5ª** vale €12 lordi, soglia fissa. La pagina /bonus va allineata. Il vecchio bonus bisettimanale 18/22 sparisce da /kpi-gdo e /profilo.
- "Fissato" = lead distinto con callLog `APPUNTAMENTO` del GDO, giorno di Roma (append-only).
- Presenze: `countPresences` (`src/lib/presenceCounting.ts`), settimana `weekBoundsRome`.
- Valori salvati in `appSettings` (chiave `gamification_targets`, JSON) con una pagina admin per modificarli.

## Schermata GDO "Diretta"

È la tavola B del canvas (https://claude.ai/artifact/TvvDUh6s3QfC5D73fTSHja), con i dati veri.

- **Barra in alto**: logo, menu, orologio e tempo che manca a fine turno (solo lato client), avatar con il nome.
- **Colonna arancione**:
  - i miei fissati di oggi su 8/10, con frase di ritmo;
  - la squadra oggi su 55/65, a blocchi;
  - l'ora di punta, con conto alla rovescia, barra su 14/20 e pause.
- **Area centrale**: le code (1ª, 2ª, 3ª, 4ª chiamata, richiami) con la stessa logica di oggi, il lead aperto con gli stessi bottoni esito di oggi e la lista.
- **Cronaca "In diretta"**: ultimi appuntamenti fissati dalla squadra, con ora, nome e giorno dell'appuntamento.
- **Scheda personale privata**:
  - binario presenze di 7 caselle, le prime 4 base e dalla 5ª €12;
  - salvadanaio con gli euro della settimana, che non scende mai;
  - miglior settimana personale (presenze da ottobre, fissati dal 26/10);
  - saldo Scintille e Piume.
- **Momento appuntamento**: entro 300 ms dal salvataggio confermato, il contatore avanza e le Scintille entrano nel saldo. Dura al massimo 2 s, non blocca nulla ed è più ricco al 1°, all'8° e al 10° e nell'ora di punta. Se il server rifiuta, si annulla.
- **Notifica "si è iscritta"**: quando un lead fissato dal GDO chiude, il GDO riceve una notifica con nome di battesimo, corso e data della sua chiamata.
- **Inizio turno** (13:30, sabato 10:00):
  - schermata d'apertura con obiettivo, lead in coda, richiami di oggi, appuntamenti di ieri confermati, ora di punta;
  - citazione del giorno e consiglio di vendita.

## Citazione del giorno e consiglio di vendita

- Due elementi al giorno: una **citazione** (filosofi, poeti, psicologi) e un **consiglio di vendita**.
- **Citazione**: si vedono solo il testo (al massimo 2 righe) e l'autore. Il pulsante "Approfondisci" apre l'opera e una riflessione di al massimo 10 righe.
- **Consiglio di vendita**: frase più consiglio, filtrato per ruolo.
- **Testi italiani**: le citazioni vengono solo da traduzioni italiane esistenti, con l'URL salvato. Le riflessioni vengono solo dal materiale di Rick DuFer (mai nominato) o le scrive l'admin.
- **Approvazione giornaliera**: ogni riflessione o consiglio si vede solo se approvato dall'admin, che può approvare, modificare o riscrivere. Se non è approvato non compare, e resta solo la citazione.
- **Verifica**: prima dell'import, ogni citazione è ricontrollata in modo indipendente sul web.
- **Calendario**: solo giorni lavorativi lun-sab, feste italiane escluse. Le citazioni a tema vanno vicino alle occasioni (Natale, fine e inizio anno, Pasqua, rientro, 1/5, 25/4, 2/6). Mai due giorni vicini con lo stesso tema, frasi simili o lo stesso autore.
- **Chi lo vede**: GDO, Conferme, venditori e admin.
- **Tabelle nuove**:
  - `dailyQuotes` (testo, autore, opera, url traduzione, traduttore, tema, occasioni, fonte riflessione);
  - `dailyQuoteSchedule` (data, quoteId, riflessione, stato approvazione, approvatoDa);
  - le stesse due per i consigli di vendita.

## Economia

- **Azzeramento**: tutti i saldi a zero. Nessun benvenuto, salvo **200 Scintille a Riccardo (119) e Zora (106)**. I vecchi articoli del negozio si disattivano (mai cancellati).
- **Scintille (ritmo)**:
  - 10 per ogni fissato, una volta per lead ogni 30 giorni, al massimo 15 pagati al giorno;
  - +20 all'8° fissato del giorno, +60 al 10° (da confermare);
  - forzieri di squadra (vedi sotto).
- **Piume (risultati verificati da altri)**: conferma 1, presenza 2, presenza dalla 5ª della settimana 4, chiusura 5 (da confermare). Se l'esito viene tolto, le Piume vengono stornate.
- **Forzieri di squadra**:
  - primo scalino (squadra 55, ora di punta 14) = forziere **raro**: 5% di probabilità di 1 Piuma, altrimenti Scintille in quantità variabile;
  - secondo scalino (65 e 20) = forziere **leggendario**: 20% di probabilità di 1 Piuma, altrimenti più Scintille;
  - chi lo riceve: da confermare;
  - un solo forziere per scalino al giorno, assegnato una volta sola in modo idempotente.
- **Registro**: unico, con valuta S o P e righe di storno, idempotente sulla chiave (evento, lead, utente, giorno).
- **Negozio** (GDO e Conferme):
  - corso Fenice Academy a scelta a **400 Piume**, regalabile;
  - premi concreti a prezzo alto, che richiedono una o più settimane al massimo del patto;
  - immagini profilo e personalizzazioni generate con Higgsfield, alcune più care di certi premi concreti;
  - i permessi li gestisce Bruno.
- **Anti-imbroglio**: si premia solo il callLog APPUNTAMENTO da utente GDO non bot. Pagamento idempotente per lead. Piume solo da eventi scritti da Conferme e venditori. Storni sugli annullamenti. Acquisti con transazione e controllo del saldo lato server. Nessuna action di modifica dei saldi senza ADMIN. `updateGdoProfile` e `updateGdoTargets` vanno messe dietro ADMIN.

## Classifica

Da decidere tra tre opzioni:
1. top 3 più "distanza da chi ti sta davanti" (la proposta);
2. classifica classica;
3. nessuna classifica.

Vale in ogni caso:
- 108 e 201 esclusi;
- nomi veri;
- niente XP, streak e "chiamate" grezze;
- niente polling pesante: dati cache 15-20 s.

## Conferme

- Da lunedì via creature, forzieri e boss. Restyle Diretta subito, con la stessa citazione e lo stesso negozio.
- **Bonus**: soglia di squadra 17 (da chiarire: presenze o chiusure, settimana o mese). Oltre la soglia, €12 per ogni unità in più.
- **Obiettivi individuali** di conferma, presenza e chiusura sugli account di Andrea e Alberto (valori da chiarire).

## Rimozioni

Dettaglio in `sintesi_agenti.md`.
- **Lato client**: CelebrationOverlay, LootDropModal, TimedChest, DailyLoginReward, DuelWidget, HotStreak, FomoToast, UniverseToast, CreatureRevealOverlay, DuelStartOverlay. Si toglie anche SprintBanner, salvo decisione diversa.
- **Topbar**: vecchie monete e barra XP sostituite dal saldo Scintille e Piume.
- **Profilo**: via le tab Creature, Avventura, Scambi e Quest. /creature-inventario, /mappa-avventura e /trading rimandano alla home.
- **Lato server**: in `pipelineActions` e `confermeActions` si staccano forzieri, boss, creature, duelli, loot, team goal e il bonus creatura in `gamificationEngine`.

## Prestazioni

- I numeri della Diretta arrivano da action dedicate con `unstable_cache` di 15-20 s, per azienda e giorno di Roma.
- Lato client l'aggiornamento al massimo ogni 20-30 s, in pausa quando la scheda è nascosta.
- In `getPipelineLeads`: togliere la query degli appuntamenti storici inutile e limitare il controllo dei duplicati ai lead del GDO.

## Decisioni lasciate a chi costruisce

Layout fine, micro-copy entro le regole di stile, nomi interni di file e funzioni, struttura delle tabelle nuove, prezzi esatti del negozio (da mostrare a Bruno prima di accendere).
