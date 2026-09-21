# SDD ledger — plan: docs/superpowers/plans/2026-09-21-pipeline-autonoma-venditore.md

Spec: docs/superpowers/specs/2026-09-21-pipeline-autonoma-venditore-design.md (letta, autorevole)
Branch: feat/pipeline-autonoma-venditore
Merge base: 9f175be

Ruling: workspace = branch isolato, non git worktree — un worktree richiederebbe un
`npm install` completo di un progetto Next.js grosso su una macchina con 16GB e storico
di crash per esaurimento memoria. Costo se sbagliato: il main non e' protetto da un
secondo checkout, ma il branch resta comunque separato e il merge passa da revisione.

## Pre-flight scan (prima di Task 1)

### Incroci fra task che condividono file o interfacce

| Task A | Task B | File / interfaccia condivisa | Esito |
|---|---|---|---|
| T1 | T4, T6 | `SELF_BOOKED_OUTCOME` / `isSelfBooked` | OK: nomi coerenti fra produttore e consumatori |
| T2 | T4 | `readSalesPipelineConfig()` | OK: firma senza argomenti, usata cosi' in T4 |
| T2 | T7 | `canDivertFresh(cfg, diverted)` via `feeding.ts` | OK |
| T2 | T8 | `getSalesPipelineConfig` / `setSalesPipelineConfig` | OK |
| T3 | T4 | `selfBookingCheck({slot, blocked, occupied, at})` | OK: T4 chiama con esattamente questi 4 campi |
| T4 | T5 | `requireSalesPipelineUser`, `setSalesSelfAppointment` | OK |
| T4 | T8 | `moveSalesSelfAppointment` | OK (T8 non lo usa, nessun vincolo) |
| T7 | T8 | `assignBotReturnsToSalesPipeline`, `countDivertedFresh` | OK |
| T6 | T6 | `CrmCounts.self` -> `row.self` nel client | OK |
| T1,T2,T3,T7 | - | `package.json` script `test` | OK: quattro append sequenziali, nessuna sovrapposizione. Ogni task rilegge il file prima di scrivere |
| T4 | T5,T7,T8 | `salesPipelineActions.ts` | OK: creato da T4, poi solo aggiunte. Ordine di esecuzione rispettato |
| T5 | T8 | `Sidebar.tsx` | OK: due voci diverse, modifiche additive |
| T5 | Global Constraints | `pipelineActions.ts` | OK: e' l'unica modifica su codice GDO che i vincoli ammettono, ed e' dichiarata |

### Coerenza interna dei singoli task

| Task | Test contro codice specificato | Esito |
|---|---|---|
| T1 | 2 test su una costante e un predicato | OK |
| T2 | 7 test contro `parseSalesPipelineConfig`/`canDivertFresh` | OK |
| T3 | 6 test contro `selfBookingCheck` | **DIFETTO** (vedi R3) |
| T4 | nessun test unitario: e' I/O su DB + Google. Verifica manuale prescritta | OK, accettato |
| T5 | nessun test: superficie UI. Verifica manuale prescritta, incluso "la board GDO non e' cambiata" | OK |
| T6 | nessun test: verifica = "su un mese senza autofissati nessun numero cambia" | OK |
| T7 | 9 test contro `pickMostLoadedGdo`/`shouldDivertFreshLead` | **DIFETTO** (vedi R1) |
| T8 | nessun test: superficie UI | OK |
| T9 | rimozione UI, nessun test | OK |

### Rulings

Ruling: R1 — `LANCIO_BUCKET` esiste gia' in `src/lib/lancio/intake.ts:17`; il piano lo
ridefiniva in `feeding.ts`. Costante del lancio duplicata = due verita' che divergono.
Deciso: rimossa dal piano, `shouldDivertFreshLead` rifiuta qualunque `launchBucket` e il
lancio e' gia' compreso. Costo se sbagliato: nessuno (la guardia e' piu' larga, non piu'
stretta).

Ruling: R2 — il webhook AC ha DUE percorsi di creazione lead: il lancio (~riga 468-590,
`LANCIO_FUNNEL`, risponde `lancio: true`) e l'intake normale (~riga 900-1260). Il piano
punta al secondo ma non lo dice. Deciso: il dirottamento va SOLO nell'intake normale, e
la cosa entra esplicita nel brief di Task 7. Costo se sbagliato: se finisse nel percorso
lancio, dirotterebbe iscritti al webinar del 5 ottobre — il danno peggiore previsto da
questo piano. Per questo e' scritto due volte.

Ruling: R3 — nel piano un test di T3 si chiamava "occupato vince su bloccato" ma
asseriva 'bloccato'. Il nome era sbagliato, non l'asserzione: `bookingCheck` controlla
`blocked` prima di `occupied`. Deciso: rinominato il test e aggiunto il commento sul
perche' l'ordine conta. Costo se sbagliato: nessuno, e' documentazione.

## Esecuzione

Batch T1+T2+T3 (tre moduli puri della stessa forma) dispatchato su sonnet. BASE bb9de13.
Ruling: batchati invece di tre dispatch separati — stessa forma (modulo puro + test +
riga in package.json), nessuna dipendenza reciproca, il piano prescrive comunque tre
commit distinti. Costo se sbagliato: una revisione unica su tre moduli invece di tre
revisioni separate; i commit restano distinti e isolabili.
T1-T3: implementer DONE (commit e6295a1, 7afd4b9, 6bf88eb). npm test 647/647 (+15). tsc pulito.
  Concern non bloccante segnalato: l'insert su appSettings non passa companyId e usa il
  default 'fenice'. Coerente con la feature (un solo venditore, una sola azienda).
T1-T3: revisione dispatchata su sonnet, package review-bb9de13..6bf88eb.diff
T1-T3: complete (commits bb9de13..6bf88eb, review clean — spec OK, qualita' approvata).
  Il revisore ha rieseguito test e tsc di persona invece di fidarsi del report.
  ⚠️ risolto da me: "comportamento runtime contro DB vivo non verificabile dal diff" —
  non e' una lacuna: `appSettings` esiste gia', nessuna migration serve, e la scrittura
  viene esercitata dalla verifica manuale di T8.
T1-T3: minor (deferred): in selfBooking.test.ts il test "ora non dichiarata" non e'
  differenziale (il parametro `declared` non esiste nella firma). Vale come nota di
  regressione. Difetto del brief, non dell'implementazione. Da triagare alla revisione finale.
T4: dispatch implementer su sonnet. BASE 6bf88eb.
T4: implementer DONE (commit 0380d03). tsc pulito, npm test 647/647.
  Scostamento brief<->schema corretto e documentato: `calendarEvents.googleEventId` e'
  nullable a schema ma `deleteGoogleCalendarEvent` vuole string -> guardia aggiunta,
  stesso pattern di confermeActions.ts:1603.
  Step di verifica manuale end-to-end NON eseguito (serve DB reale + credenziali Google):
  resta nella checklist finale prima dell'accensione.
T4: revisione dispatchata su sonnet, package review-6bf88eb..0380d03.diff
T4: revisione spec OK, qualita' approvata, 2 Important aperti -> fix loop.
  (1) in moveSalesSelfAppointment la riga calendarEvents si cancella anche se la delete
      su Google fallisce -> due inviti al cliente e nessuna traccia dell'orfano
  (2) query calendarEvents senza filtro eventType='appointment' (il pattern di
      riferimento lo ha)
  Ruling: entrambi entrano nel loop anche se il n.1 e' ereditato da confermeActions.ts.
  Qui l'impatto e' su un cliente vero e il percorso e' nuovo: si corregge dove nasce.
  NON estendo la correzione a confermeActions (stesso difetto): e' fuori scope, il
  committente ha chiesto un cambiamento alla volta. Costo se sbagliato: il difetto resta
  nel percorso Conferme, dov'e' da mesi. Annotato per la revisione finale.
T4: fix round 1/5 dispatchato (resume implementer).
T4: fix round 1/5 (2 addressed, 0 open; commit 0380d03..94a0fcf)
T4: complete (commits 6bf88eb..94a0fcf, review clean)
T4: minor (deferred): messaggio d'errore unico per due condizioni diverse in
  moveSalesSelfAppointment; nessun controllo difensivo su status='APPOINTMENT'.
  Entrambi non raggiungibili oggi. Da triagare alla revisione finale.
T5: dispatch implementer su sonnet. BASE 94a0fcf.
T5: implementer DONE (commit 798901b, 6 file). tsc pulito, npm test 647/647.
  Scostamento dichiarato: modificato anche `(dashboard)/layout.tsx`, fuori dalla lista
  Files del brief, per il gating server-side della voce di Sidebar che il brief stesso
  chiedeva esplicitamente. Sottoposto al revisore per giudizio sullo scope.
  Nuovo errore ESLint: `type Lead = any` in MiaPipelineClient.tsx — viene testualmente
  dallo scheletro che ho scritto io nel piano.
T5: revisione dispatchata su sonnet, package review-94a0fcf..798901b.diff
T5: revisione spec OK (nessuna regressione su board GDO ne' gamification GDO/bot,
  verificata call-site per call-site), 1 Important aperto -> fix loop.
  (1) query `recalls` senza tiebreaker `id`: stessa classe del bug "lead spariti"
      gia' capitato in questo progetto.
  Ruling: `layout.tsx` fuori dalla lista Files del brief e' ACCETTATO — 4 righe piu' una
  prop, ed e' l'unico modo di soddisfare lo Step 5 del brief, che chiedeva la voce di
  menu gatata server-side. Costo se sbagliato: una prop in piu' nel layout, reversibile.
  Ruling: incluso nello stesso giro il Minor `type Lead = any` (errore ESLint nuovo,
  nato dallo scheletro che ho scritto io nel piano). E' una riga e la correzione e' gia'
  aperta: rimandarla alla revisione finale costerebbe un secondo dispatch per nulla.
T5: fix round 1/5 dispatchato (resume implementer).
T5: minor (deferred): tre letture ridondanti della config per un caricamento di
  /mia-pipeline; nessun carve-out "cercati" ne' quarta chiamata (parita' col brief, non
  con la board GDO completa).
T5: fix round 1/5 (2 addressed, 0 open; commit 798901b..3c95a95)
T5: complete (commits 94a0fcf..3c95a95, review clean)
T6: dispatch implementer su sonnet. BASE 3c95a95.
T6: implementer DONE (commit 6d9c627). tsc pulito, npm test 647/647.
  Due difetti del MIO piano trovati dall'implementer:
  (a) il brief indicava SalesManagerView.tsx come file del client, ma la tabella funnel
      vive in PanoramicaClient.tsx (FunnelSection). Corretto da lui.
  (b) esiste un secondo consumer non citato dal piano, `mergeFunnelOverviews` (percorso
      admin "Tutte le aziende"): costruisce l'oggetto campo per campo, quindi tsc NON
      avrebbe segnalato il campo mancante e la colonna sarebbe uscita undefined solo in
      quella modalita'. Aggiornato.
  Ruling: entrambi gli scostamenti ACCETTATI — sono correzioni a errori del piano, non
  allargamenti di scope, e (b) e' proprio la classe di bug che il multiazienda ha gia'
  prodotto in passato. Costo se sbagliato: due file in piu' nel diff, entrambi in
  revisione.
T6: revisione dispatchata su sonnet, package review-3c95a95..6d9c627.diff
T6: complete (commits 3c95a95..6d9c627, review clean — spec OK, nessun Critical/Important,
  verificato riga per riga che nessun totale esistente si muova, e che non restino
  consumer del tipo non aggiornati).
T6: minor (deferred): verifica a schermo del Pannello non eseguita (serve browser);
  resta nella checklist finale. Nessun test automatico su getCrmFunnelCounts (il file
  non ne ha, gap preesistente).
T7: dispatch implementer su OPUS (non sonnet come i precedenti). Motivo: e' l'unico task
  che mette una mano sul percorso di ingresso dei lead mentre il lancio del 5 ottobre e'
  in corso. BASE 6d9c627.
T7: implementer DONE_WITH_CONCERNS (commit 38aec3d, f8f5f80). tsc pulito, npm test 656/656
  (+9). Ramo lancio non toccato (nessuna riga fra 455 e 594).
  Scostamento dichiarato: `readSalesPipelineConfig()` spostata FUORI dalla transazione.
  Motivo dato: gira su `db`, e usare `db` dentro una `db.transaction` chiede una seconda
  connessione allo stesso pool, che in serverless ha max 5 e timeout 15s -> cinque
  webhook simultanei si bloccherebbero a vicenda. Ho verificato io il pool:
  src/db/index.ts:20 `max: isServerless ? 5 : 15`, :22 `connectionTimeoutMillis: 15000`.
  Il dato e' esatto. Sottoposto al revisore per giudizio sulle garanzie residue.
  Step 9 (lead di prova sul webhook) non eseguito: colpirebbe produzione. Resta nella
  checklist prima dell'accensione.
T7: revisione dispatchata su OPUS, package review-6d9c627..f8f5f80.diff
T7: revisione OPUS. Spec ✅ salvo gli step di verifica manuale. Nessun Critical:
  identita' a pipeline spenta DIMOSTRATA dal revisore in autonomia (git diff -w: tre sole
  righe cambiate nel webhook, i cinque rami dei pool invariati), ramo lancio intatto per
  due ragioni indipendenti, tetto non sforabile per concorrenza (lock xact + conteggio
  su tx dopo il lock + READ COMMITTED).
  Deviazione sulla config fuori transazione: ACCETTATA dal revisore, che ha verificato
  anche la claim "nessun `db` dentro `db.transaction` in tutto src" con uno scan
  automatico. Regge.
  SEI Important aperti -> fix loop:
  (I3) cfg.salesUserId mai validato: un id sbagliato viola la FK e ferma l'intake AC su
       OGNI lead. E' l'unico punto del disegno che non fallisce chiuso.
  (I4) il lock advisory si tiene fino al COMMIT su ogni lead fresco anche a tetto pieno:
       intake serializzato. Query del tetto misurata in produzione: 18,5 ms.
  (I1) assignBotReturnsToSalesPipeline sposta lead con appuntamento o presenza: manca la
       "doppia guardia" che il repo ha gia' in gdoPools/rebalance.ts:82-86.
  (I2) nessun bump di leads.version sulla riassegnazione: ogni altro punto del repo lo fa.
  (I5) candidati senza filtro callCount < 3: lead che spariscono da entrambe le board.
  (I6) manca assertSingleCompany + verifica company del venditore.
  Ruling: tutti e sei entrano nel loop. Quattro erano difetti del MIO brief (I1, I2, I5,
  I6), non dell'implementer. Aggiunti nello stesso giro tre commenti/guardie minori e
  `npm run build`, che non era mai stato lanciato.
T7: fix round 1/5 dispatchato (resume implementer, opus).
T7: minor (deferred): nessun test sul cablaggio (la proprieta' "a pipeline spenta il GDO
  e' lo stesso" e' difesa solo da prosa); ramo bot_return senza notifica al venditore;
  `moved` puo' essere < `count` senza spiegare perche'. Da triagare alla revisione finale.
T7: fix round 1/5 (6 Important + 3 minori addressed, 0 open; commit f8f5f80..32ff016).
  `npm run build` lanciato per la prima volta: "Compiled successfully in 33.6s".
  Il re-revisore ha approvato entrambe le scelte dell'implementer (check venditore prima
  del lock; ruolo da users.role perche' nel webhook non c'e' sessione).
T7: complete (commits 6d9c627..32ff016, review clean)
T7: Ruling: la divergenza possibile fra `users.role` (DB) e `user_metadata.role`
  (verita' per l'autorizzazione) NON viene chiusa qui. Nel webhook non c'e' sessione, e
  leggere la metadata reale richiederebbe supabase.auth.admin.getUserById dentro
  l'intake: cambiamento troppo grosso per questo test. Il disallineamento e' strutturale
  al progetto, non introdotto da noi, e prima di questo fix nel webhook non c'era ALCUN
  controllo di ruolo. Mitigazione: in T8 il venditore si sceglie da un elenco di utenti
  reali, non da un campo libero, cosi' la config non puo' contenere un id incoerente.
  Costo se sbagliato: se qualcuno cambia ruolo a un utente aggiornando solo la metadata
  e non la riga DB, fino a 5 lead finirebbero a chi non li vede. Recuperabili a mano.
T8: dispatch implementer su sonnet. BASE 32ff016.
Ruling: T8 e T9 batchati in un dispatch solo (due commit separati). Sono entrambi
  superfici UI indipendenti fra loro e dal resto, e nessuno dei due ha logica nuova da
  testare. Costo se sbagliato: una revisione unica su due superfici; i commit restano
  distinti e isolabili.
Ruling: in T8 il venditore si sceglie da `listVenditori()`, mai da un campo libero.
  Non e' estetica: chiude in pratica il rischio che la config contenga un id che il
  webhook poi rifiuta, lasciando una pipeline che sembra accesa e non dirotta nulla.
T8+T9: implementer DONE (commit ac7bda6, 5c423a6). tsc pulito, lint 4021->4004 errori
  totali (zero nei file nuovi), npm test 656/656, `npm run build` compila e
  /pipeline-venditore compare fra le route.
  Segnalazione: nel working tree sono comparse modifiche NON committate a tre file di
  marketing-analytics ("Inbound Spontanei"), di un altro lavoro in corso. Verificato da
  me: non sono in nessuno dei nostri commit e restano intatte. Non le tocchiamo.
T8+T9: revisione dispatchata su sonnet, package review-32ff016..5c423a6.diff
T8: complete (commits 32ff016..ac7bda6, review clean)
T9: complete (commit ac7bda6..5c423a6, review clean)
T8: minor (deferred): l'interruttore salva i valori di bozza del selettore anche senza
  premere "Salva impostazioni"; in modalita' "Tutte le aziende" il riepilogo torna vuoto
  invece di aggregare (limite preesistente dell'area sales, non regressione).

## Revisione finale del branch (opus, 14 commit)

Verdetto: approvato con riserve. Merge sicuro (feature spenta), ma 3 Critical, 8
Important e alcuni minori nelle CUCITURE col resto del CRM. Elenco completo con
diagnosi e correzioni decise in `final-findings.md`.
Confermato dal revisore, verificando di persona: lancio 5/10 intatto; regola di
conteggio del PO rispettata end-to-end; le 4 superfici Conferme escludono la sentinella;
muro degli slot reciprocamente esclusivo; pool/rebalance/redistribuzione non possono
toccare un autofissato; nessun push al bot dal percorso nuovo.
Ruling: I7 (via la UI di recupero import da /lead-automatici proprio nella settimana del
  lancio) NON si corregge nel codice: e' la decisione 8 del committente. Va portata a
  lui come domanda sulla TEMPISTICA, non ribaltata da me.
Ruling: I1 (moveSalesSelfAppointment morta) si CABLA, non si cancella. Va nella board
  del venditore, non nella pagina admin: l'autorizzazione della funzione e' gia'
  venditore-only ed e' lui che parla col cliente che chiede di spostare.
Ruling: I2 (annullamento lascia vivo l'invito Google) si corregge SOLO per gli
  autofissati. E' un buco preesistente anche per gli altri, ma allargare la correzione
  al percorso Conferme e' un secondo cambiamento non richiesto.
Ondata unica di fix dispatchata su OPUS.

## Decisioni del PO (2026-09-21, secondo giro)

- Pulizia /lead-automatici CONFERMATA anche nella settimana del lancio. "Se i numeri
  falliscono piuttosto lo vediamo insieme".
- Marco chiama dal SUO telefono, non dal centralino -> C3 (attribuzione CDR) e I8
  (/monitor-pause) non sono piu' raggiungibili. Ruling: le correzioni restano comunque,
  perche' sono filtri per ruolo corretti a prescindere e strettamente piu' sicuri; ma
  scendono da "da chiudere prima di accendere" a normale igiene.
- Check sui lead non importati: NIENTE da recuperare. 19.290 fallimenti di settembre
  sono per il 95% blocked_list:133 (il flood); 130 e 129 sono le liste bloccate per
  scelta (1.906 lead); dei 193 persi per 429 il 20/07 ne mancano davvero solo 2
  (acContactId 169000 e 172448), senza telefono ne' email nella riga. I 5 lead freschi
  del test devono quindi venire dal dirottamento dell'intake, come previsto.

## Ondata di fix finale

17 voci su 18 fatte (commit 07e8141, f70059c, 7af795e, 5c10105, f60acc4, c32eb96,
e314977). tsc pulito, npm test 667/667 (+11), npm run build 90/90 pagine, zero errori
lint nuovi. Percorso del lancio non toccato.
L'implementer si e' FERMATO su I6 invece di eseguire, e ha avuto ragione:
Ruling I6 — la correzione che avevo prescritto (uscire da checkAchievements se
  role !== 'GDO') avrebbe spento gli achievement delle Conferme, attivi in produzione
  (Alberto 30, Andrea 26, Christel 16 sblocchi, l'ultimo l'08/09). Adottata la variante
  inerte: si esce su role === 'VENDITORE'. Chiude il buco descritto e oggi tocca zero
  sblocchi. Costo se sbagliato: nessuno misurabile.
Ruling C2 — accettato il rovesciamento del predicato deciso dall'implementer: intersecare
  con l'insieme dei GDO avrebbe fatto sparire 123 lead Serenamente assegnati a GDO Fenice
  che quelle due pagine contano da giugno. Escludere chi appartiene ai non-GDO e'
  equivalente per il nostro scopo e non muove nulla di storico. I 123 lead restano un
  difetto vero di /kpi-gdo e /kpi-team, FUORI da questo perimetro: da portare al PO a
  parte.
Ruling: la nota del bot su lead autofissato (campanella a tutte le Conferme per un lead
  che non possono aprire) entra nella stessa ondata: e' C1 su un esito diverso, e' 5
  righe nello stesso file, e a pagarla sono due persone.
Secondo giro dell'ondata chiuso (commit 11bf055): I6 nella variante inerte + guardia
  sulla notifica Conferme per le note del bot su lead autofissati.
APERTO da portare al PO: su un lead autofissato, una disdetta che il cliente comunica
  in chat al bot ora non sveglia piu' nessuno. Prima svegliava due persone che non
  potevano farci niente (le Conferme, che quel lead non lo vedono). Notificare il
  venditore non e' una riga: il tipo `bot_note` porta un deep-link a /conferme, che lui
  non puo' aprire; servirebbe un tipo nuovo piu' un ramo di routing in Topbar.tsx, che
  carica ogni ruolo del CRM. Non fatto, e' un cambiamento a se'.
Re-review dell'intera ondata dispatchata su OPUS, package review-5c423a6..11bf055.diff

## Re-review dell'ondata (opus): tutte e 18 le voci ADDRESSED, verdetto mergiabile

Verifiche fatte sui dati veri di produzione, non sulla prosa dei report: 1.059=1.059
ancore CDR (con EXCEPT in entrambe le direzioni), 0 righe tolte a /monitor-pause su
154.123 chiamate, 0 lead appuntati con assegnatario non-GDO, 0 callLogs di ruolo
VENDITORE, 0 achievement VENDITORE, metadata del ruolo completi su tutti e 20 gli utenti.
Percorso del lancio 5/10 fisicamente irraggiungibile dal codice modificato.

UNA rottura nuova, e l'ha causata la MIA prescrizione M10:
Ruling — M10 partiva da una premessa falsa (che la ContactDrawer fosse riservata ai GDO).
  Il gate sul ruolo in Topbar copre solo la casella di ricerca; il drawer e' montato fuori
  e si apre dalle notifiche, che arrivano anche alle Conferme. E /richiami e' aperta a
  GDO/ADMIN/MANAGER/TL con la OutcomeModal che offre "Appuntamento". Il gate toglieva
  quindi la capacita' di fissare a quattro ruoli, in silenzio (nessun chiamante mostra
  l'errore) e con i coriandoli che partono lo stesso.
  Deciso: rovesciare il gate — si rifiuta se l'attore e' VENDITORE, invece di consentire
  solo ai GDO. Toglie zero capacita' a chi ce l'aveva e mantiene strutturale la garanzia
  che il venditore fissi solo con la sentinella. Piu': coriandoli e animazione non
  partono se l'esito non e' success. Costo se sbagliato: nessuna capacita' rimossa; il
  rischio residuo e' solo che un ADMIN fissi senza sentinella, che e' il comportamento
  di sempre.
