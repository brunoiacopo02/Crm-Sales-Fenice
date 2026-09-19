# Audit CRM Fenice + bot WhatsApp — 18 settembre 2026

Due sistemi in produzione, gestiti dalla stessa persona (Bruno, product owner e unico sviluppatore
con assistenza AI).

- **CRM** (`CRM GDO`): Next.js App Router + Drizzle + Supabase. Funnel lead → GDO (call center) →
  Conferme → Venditori, con gamification (coin, forzieri, boss, negozio). ~70 utenti interni.
- **Bot** (`Software Messaggistica`): Next.js 16 + Supabase JS + Twilio WhatsApp + Anthropic
  (claude-sonnet-4-6). Scrive a lead veri, fissa appuntamenti, li restituisce al CRM via un
  contratto HMAC a due vie (v1.7).
- **Evento imminente**: lancio "Web Developer AI", webinar Zoom **lunedì 5 ottobre 2026 ore 21**,
  ~3.000 persone in lista. Il blast del link Zoom parte quella sera fra le 19:30 e le 20:45.

L'audit è stato fatto da sette agenti in sola lettura su codice e **database di produzione**.
Segno con **[V]** ciò che ho verificato personalmente rieseguendo la query o leggendo il codice, e
con **[R]** ciò che riporto da un agente senza averlo ricontrollato.

---

## 1. Sicurezza del CRM — la classe più grave

**Premessa strutturale.** Ogni file in `src/app/actions/*.ts` ha `'use server'`: **ogni funzione
esportata è un endpoint POST pubblico**, invocabile con argomenti arbitrari da chiunque abbia una
sessione valida. Non conta cosa passa la UI. Su 78 file di actions, **50 non contengono alcun
controllo di ruolo**. [R]

**1.1 Il ruolo viene da un campo che l'utente può riscriversi.** [V per il codice e per l'assenza
di trigger; NON verificato sul campo]
`src/lib/tenancy.ts:74`: `const role: string = meta.role ?? 'GDO';` dove `meta = user.user_metadata`.
Anche `companyId`, `area` e `allowedCompanies` vengono da lì. In Supabase `user_metadata`
(`raw_user_meta_data`) è scrivibile **dall'utente stesso** con `supabase.auth.updateUser({data})` e
la chiave anon. Ho interrogato `pg_trigger` sullo schema `auth`: **nessun trigger**, quindi niente
lo impedisce lato database. Non ho tentato l'escalation (sarebbe una modifica vera su produzione).
Se il meccanismo è quello che sembra, qualunque utente si assegna `role: 'ADMIN'` e ogni cancello
sotto diventa irrilevante.
*Cura*: spostare ruolo/tenancy in `app_metadata` (non scrivibile dall'utente) o leggerli dalla
tabella `users`, come già fa `manualAdjustmentActions.ts:17`.

**1.2 Un GDO si accredita i Fenice Coins.** [V]
`managerRpgActions.ts:384 addGdoCoins(userId, amount)` — l'unico controllo è `assertSalesArea(ctx)`,
che verifica `ctx.area !== 'sales'` e nient'altro: nessun controllo di ruolo, nessun confronto
`userId === ctx.userId`, nessun tetto su `amount`. Idem `updateGdoBaseSalary` (riscrive
`baseSalaryEur` di chiunque) e `updateVenditoreSalesTarget`. Stessa forma su
`targetActions.ts:116 saveMonthlyTarget`, che riscrive i target mensili dell'azienda (base dei
semafori Sales Alerts).

**1.3 `userId` dal client su tutta l'economia della gamification.** [R]
`chestActions.ts:116 incrementChestProgress(userId, metric, amount)`, `adventureActions.ts:135
attackBoss(userId, …)`, `shopActions.ts:78/141/165 buyShopItem/…`: nessuna confronta `userId` con
`ctx.userId`. Si può far avanzare il proprio forziere senza telefonare, ripetere i premi dei boss,
o svuotare il wallet di un collega comprando al posto suo.

**1.4 Presa di controllo del Google Calendar di un venditore.** [R]
`api/google/callback/route.ts:11`: `const userId = searchParams.get('state')`, usato come identità e
non come nonce CSRF, non legato alla sessione che ha avviato l'OAuth; poi
`db.update(calendarConnections).set({accessToken…})`. Chi rigioca il redirect con lo `state` di un
venditore si prende i suoi appuntamenti nel proprio calendario.

**1.5 Un venditore registra una vendita sul lead di un altro.** [V]
`venditoreActions.ts:217 saveVenditoreOutcome` è **l'unica** scrittura venditore che non passa da
`requireOwnLead(leadId)` — le altre quattro sì (righe 557, 643, 784, 897). Controlla solo il ruolo.
Inoltre non pretende importo/prodotto su 'Chiuso', mentre l'altra strada di chiusura
(`confermeActions.ts:1065`) sì: è la spiegazione più probabile delle ~24 chiusure storiche senza
prodotto già note.

**1.6 Scritture cross-tenant sul marketing.** [R]
`api/marketing/admin/companies/[id]/route.ts:56` e le route `funnels/**`: `id` viene dall'URL e non
è mai confrontato con `ctx.allowedCompanies`. Il cancello stesso (`isMarketingAdmin`) passa con
`area === 'both'` a prescindere dal ruolo. Un admin marketing di un'azienda modifica l'altra.

**1.7 Cron fail-open.** [R] `api/cron/marketing-webhooks-drain/route.ts:16` è l'unico dei cinque
cron senza la guardia `if (!secret) return 500`: con env mancante la password diventa la stringa
`Bearer undefined`. Nello stesso file, `Promise.allSettled` non ispeziona i rejected: una riga che
fallisce resta `pending` con `nextAttemptAt` nel passato e **ri-POSTa lo stesso `deal.closed_won`
per sempre**.

---

## 2. Il lancio del 5 ottobre, allo stato attuale, non parte

**2.1 `lancio_evento_at` è fermo alla prova generale.** [V]
In `app_settings`: `lancio_evento_at = "2026-09-17T16:42:00+02:00"`, `lancio_attivo = true`,
`lancio_pulsante_attivo = true` (aggiornati il 16/09). I cron del blast escono subito se
`romeDayKey(now) !== romeDayKey(eventoAt)` (`lib/lancio-zoom-blast.ts:24`). Il 5/10 girerebbero 24
volte scrivendo `lancio_zoom_run` con `motivo:"fuori_finestra"` a livello **info**, e ~3.000 persone
non riceverebbero il link. Stesso meccanismo per il follow-up del 6-7/10. **Nessun cron controlla
che quella data sia nel futuro.**

**2.2 La guardia anti-troncamento è codice irraggiungibile.** [V]
`lancio-followup/route.ts:68-69` e `lancio-restituzioni/route.ts:42-43`:
`BLOCCO_VALUTAZIONE = 200`, `MAX_RIGHE_BLOCCO = BLOCCO_VALUTAZIONE * 40` = **8000**, usato sia come
`.limit()` sia come soglia del guard (`righeBlocco.length >= MAX_RIGHE_BLOCCO`). Ma PostgREST taglia
a 1000: ho chiesto 8000 righe di `messages` e **ne ho ricevute 1000**. Quindi il guard non scatta
mai e le decisioni si prendono su una cronologia tagliata, ordinata `created_at` **crescente**
(cadono i messaggi più nuovi). Conseguenza scritta nel commento del codice stesso: una chat letta a
metà risulta "non ha mai risposto" e viene restituita al CRM con `NON_RISPOSTO` — decisione che il
CRM non annulla più. Stesso taglio in `lancio-aperture/route.ts:45` (`LOTTO*20 = 2000`), lì senza
nemmeno un guard.

**2.3 Il template Zoom è MARKETING contro il presidio `UTILITY_ONLY`.** [V per la categoria]
`fenice_lancio_zoom_v1` (`HXdfceb844…`) risulta dalla Content API Twilio **approved, category
MARKETING**. Il 17/09 alle 15:10 il blast si è fermato con `lancio_zoom_config_error`. Il problema è
stato aggirato **sostituendo il SID**, non sistemando l'allow-list. [R] I template del 6/10
(follow-up e le due "scelta") non sono mai stati provati contro quel presidio.

**2.4 Capienza stretta e un intoppo costa 200 persone.** [R]
`LANCIO_BATCH_MAX` non è in produzione → default 200; finestra 19:30-20:45 = 16 run × 200 = 3.200
posti per ~3.000 lead, senza nessun cron di recupero dopo le 20:45. Aggravante:
`lancio-blast-motore.ts:87` tratta come "rifiuto di policy" anche il messaggio *«non verificabile»*,
che `twilio.ts:162` lancia su un qualunque HTTP non-2xx del Content API. Un 429 transitorio ferma
l'intero run.

**2.5 Il compare-and-set sulla fase non ha tenuto, e ci sono le prove.** [R]
In `event_log` ci sono solo tre eventi di fase in tutta la storia, per la conversazione di prova:
un CAS da `post_pitch` verso `link_inviato` con `soloDaFasi:["attesa","posto_bloccato"]` risulta
**riuscito**, il che è impossibile. Effetto visibile: il lead riceve il template *«ecco il link…»*
otto minuti dopo aver detto che la live l'aveva già vista. Causa probabile:
`lib/lancio-db.ts:41-46` fa l'update **senza `.select()`** e hard-codifica `cambiata: true`, quindi
l'event_log può dichiarare cambi di fase che il database non ha fatto.

**2.6 Ri-arruolamento che cancella lo stato.** [R] `lib/fenice-enroll.ts:500`: `lancioFields`
include `lancio_fase:'attesa'` e `bot_outcome:null`, scritti anche nel ramo "chat già viva". Un
secondo arruolamento (re-sync della lista, intake ritentato) **azzera un esito già dato al CRM**,
senza alcun evento.

---

## 3. Errori ingoiati nel bot — la classe che fa sparire i messaggi

**3.1 Su 22 `messages.insert(...)` uno solo controlla l'errore.** [R] `supabase-js` non lancia su
errore Postgres. Quindi i rami di recupero già scritti in `lancio-blast-motore.ts:283-288` e
`lancio-aperture:325-336` sono **irraggiungibili**: basterebbe `if (error) throw error` per
riattivare ~60 righe di logica corretta.

**3.2 `lib/messaging.ts:95` — l'imbuto di tutti gli invii.** [R] Template consegnato + insert
fallito = `{ok:true}` al chiamante e nessuna riga: **un lead che non ha ricevuto nulla diventa
indistinguibile da uno servito**, e lo status callback non trova la riga da aggiornare.

**3.3 Guardie "ha già ricevuto" che falliscono aperte.** [R] `cron/send-video/route.ts:49`,
`precall-reminders:110`, `send-agenda-gdo.ts:91`: leggono `{ data }` senza `error`. Un errore
transitorio → la guardia risulta vuota → **tutti** ricevono il messaggio una seconda volta.

**3.4 Retry che duplicano, 429 che non si ritenta.** [R] `twilio.ts:60`:
`isRetriable = !status || status >= 500`. Un timeout dopo che Twilio ha accettato non ha `status` →
ritentato fino a 3 volte → lo stesso template arriva 2-3 volte. Specularmente il 429 non viene
ritentato.

**3.5 La data dell'APPUNTAMENTO non è validata, quella del RICHIAMO sì.** [V]
`lib/mario.ts:53`: `if (kind === 'APPUNTAMENTO') { scheduledAt = arg || undefined; }` — nessun
controllo. Due righe sotto, il ramo `RICHIAMO` fa `if (arg && isoWithOffset(arg))` con un commento
che spiega perché (i 22 richiami su 26 a ore tonde inventate). Una data senza offset viene letta nel
fuso del processo (UTC su Vercel): il lead legge "le 10" e nel CRM finiscono le **12:00** — due ore
**avanti**, verificato eseguendo il codice.

**3.6 TOCTOU sugli esiti.** [R] `bot-outcome.ts:633 vs :874`: si legge lo stato, si chiama il CRM
(secondi), poi si scrive con `.eq('id',…)` e basta. Il ramo `normal` scrive `bot_scheduled_at: null`:
un appuntamento appena fissato può essere azzerato dal cron backstop e i promemoria non partono più.

**3.7 `checkDataRichiamo` non controlla domenica/giorni chiusi/fascia oraria**, a differenza di
`checkDataAppuntamento`. [R] Un richiamo può finire in agenda domenica alle 07:00.

**3.8 `BOOKING_DAILY_CAP` è codice morto in entrambe le direzioni.** [R] `giorniPieni` è calcolato
da `fenice-autoreply.ts:540` e passato, ma `computeBookingDays(now)` lo ignora.

---

## 4. Bug del CRM (oltre alla sicurezza)

**4.1 Doppio click = chiamata fantasma.** [R] `pipelineActions.ts:453` inserisce il `callLog`,
`:543` fa la guardia ottimistica sulla versione, **senza transazione**. La seconda richiesta perde
la gara e torna `CONCURRENCY_ERROR`, ma il suo callLog è già committato: 2 chiamate loggate,
`callCount` +1. Gonfia il denominatore del tasso di risposta — la metrica su cui sono stati
costruiti i fascicoli disciplinari dei GDO.
Nella stessa funzione, `userId?: string` (`:405`) permette di scrivere `callLogs.userId` a nome di
un altro GDO; i due chiamanti reali passano `undefined`, quindi il parametro esiste **solo** come
superficie d'attacco.

**4.2 Il mese del fatturato non è il mese italiano.** [R] `panoramicaActions.ts:118` e altri tre
punti usano `Date.UTC(year, month-1, 1)` con un commento che dichiara Europe/Rome. È l'unico file
KPI che non importa `dateUtils`. Una firma registrata l'1 settembre alle 00:45 Rome finisce in
**agosto** sulla Panoramica e in **settembre** su KPI Venditori.

**4.3 "Lead spariti", di nuovo, nello Storico Conferme.** [R] `confermeActions.ts:114-117`: limite
silenzioso a 500, nessun tiebreaker su `appointmentCreatedAt` (è la causa esatta dell'incidente del
14/05, risolta in `pipelineActions.ts:123` e non replicata qui), e si ordina su una colonna diversa
da quella filtrata.

**4.4 Premi ripetibili e premi bruciati.** [R] `adventureActions.ts:169-202` paga i coin **prima**
di avanzare lo stage, senza transazione, dentro un `catch` che ritorna `null`: se l'update fallisce,
il boss si ripaga. Inverso in `questActions/lootDropActions/streakActions`: il consumo è committato
prima del pagamento, quindi un errore brucia la ricompensa.

**4.5 ~30 scritture gamification fire-and-forget.** [R] `incrementChestProgress(...).catch(...)`
senza `after()`/`waitUntil()`: su Vercel l'invocazione può essere congelata appena la server action
risponde. Sintomo: "il forziere è indietro rispetto alle chiamate fatte", non riproducibile.

**4.6 Offset +02:00 cablato.** [V come classe] `questActions.ts:34` e `dailyLoginActions.ts:120`:
`new Date(\`${dateStr}T00:00:00+02:00\`) // CET/CEST approximation`. **Da fine ottobre a fine marzo
l'Italia è +01:00**: la giornata va dalle 23:00 del giorno prima. È l'unico difetto di questa classe
che sbaglia in modo deterministico per quattro mesi l'anno, e novembre è vicino. Solo gamification.

**4.7 Il commento dice Rome, il codice è UTC.** [R] `managerOverviewActions.ts:62-69`,
`appuntamenti-oggi/page.tsx:26`, `companySummaryActions.ts:28`: la data Rome è estratta bene e poi
ricostruita nel fuso del server. Su `appuntamenti-oggi` non è teorico: il bot fissa anche di notte,
quindi una prenotazione delle 00:40 finisce nella pagina di **ieri**.

**4.8 `dateUtils.ts` sbaglia di un'ora ai cambi d'ora e non ha test.** [R]
`weekBoundsRome(domenica 25/10/2026)` restituisce lunedì 19/10 **alle 01:00**; `dayBoundsRome(25/10)`
restituisce 25 ore. Impatto pratico minimo, ma è l'helper su cui si appoggiano 16 file e su cui si
vorrebbe migrare il resto. Il 25/10 non e' nella finestra del lancio (5-7/10) ma **e' dentro quella delle
restituzioni** (cron 8-31 ottobre).

**4.9 Ricerca Topbar case-sensitive e in seq scan.** [R] `searchActions.ts:30`: `like` invece di
`ilike` (cercare `mario` non trova `Mario`), `%term%` senza indice trigram su `leads` + `ORDER BY
updatedAt DESC` a ogni digitazione. Il DB è già saturato una volta a luglio.

**4.10 Due `fetch` verso route inesistenti, mascherati.** [R] `ShopClient.tsx:307` →
`/api/user/profile` (la cartella non esiste); dashboard marketing → `/api/marketing/crm/appointments`
(nessuna route `crm/*`), con `.catch(() => ({}))`: **la dashboard mostra zero appuntamenti invece di
un errore**.

---

## 5. Incongruenze sui numeri (CRM)

**5.1 "App/gg per GDO": numeratore col bot, divisore senza.** [V]
`managerOverview`, `targetActions.mediaAppDayGdo` e `salesAlerts.appPerGdo` fanno
`app_del_mese / giorni / nGdo`, dove `nGdo` esclude bot e non-`statsActive` (**7**) ma il numeratore
li include tutti. Verificato con query: settembre 2026, 958 appuntamenti = **375 del bot** + 521 dei
7 GDO umani attivi + 62 di utenti disattivati. Il card mostra **8,55 app/gg/GDO**; con lo stesso divisore (16 giorni x 7 GDO) il
valore vero e' **4,65**, contro un target di 10. Agosto: 7,8 mostrato contro 3,8 vero.

**5.2 Due "% Conferme" sulla stessa pagina.** [R] Su `/panoramica-generale` convivono la striscia
Parametri Manager (coorte dei fissati del mese) e la tabella Numeri Mensili (per
`confirmationsTimestamp`): settembre **12,5%** contro **15,0%**, con target 15% — la striscia dice
rosso, la tabella sotto dice a target.

**5.3 Due "tassi di risposta" sulla stessa schermata.** [R] `/kpi-gdo`: header e tabella =
risposte/**chiamate** (31,1% a settembre); la card Funnel a fianco = lead che hanno
risposto/**lead contattati** (56,1%). Il predicato è stato unificato ad agosto, il **denominatore**
mai.

**5.4 Tre "% fissaggio" per lo stesso GDO.** [R] GDO 106, settembre: **19,0%** (app/lead assegnati),
**10,9%** (app/lead chiamati), **6,0%** (app/chiamate, sulla dashboard del GDO stesso).

**5.5 Marketing Analytics è cieca sui funnel fuori whitelist.** [V]
`OFFICIAL_FUNNELS` in `marketingActions.ts:10` ha 8 voci; il confronto è `.toUpperCase()`, quindi
`Database` combacia. Restano fuori, a settembre: CORSO10ORE-TK (74 lead, **11 appuntamenti**),
JOBSIMULATOR (58, variante di scrittura), SMM (66), SCONOSCIUTO (93), LEAD BF 2024 (43), LANCIO DATA
ANALYST (19), INBOUND (3) e **"Lancio Web Dev AI"** (oggi 5 lead — a ottobre sarà l'intero lancio,
**interamente invisibile** in Marketing Analytics). [R] Fatturato agosto: €129.971 secondo Marketing
contro €133.161 secondo panoramica/riconciliazione.

**5.6 `metricsUtils.ts` è una trappola.** [V] Il file si dichiara *"fonte unica di verità per le 6
metriche primarie"* con la *"REGOLA D'ORO: ogni pagina DEVE consumare `getMetric()`"*, e
**nessuno lo importa** (grep: un solo hit, in un commento). La sua M1 usa `createdAt` invece di
`canon.leadIntakeAt`: chi lo aprisse e lo seguisse "perché è il canonico" conterebbe **18.352** lead
a settembre invece di 8.198, reintroducendo da solo il gonfiaggio del flood della lista 133.

**5.7 `contaNeiKpi` applicato a macchia di leopardo.** [R] Il flag che esclude i 7.891 lead del
flood è applicato su ~6 viste e **non** su `/qualita-lead`, riconciliazione,
`/performance-venditori`, `/statistiche-fissatore`, report coaching, `/kpi-team`, sales alerts,
`/kpi-conferme`, "Resa per tentativo" e perfino su una delle tre query dentro
`getGdoThroughputMetrics30d`.

**5.8 Panoramica in UTC, tutto il resto in Rome.** [R] Settembre, lead acquisiti: 8.198 (Rome)
contro 8.178 (UTC). Inoltre `actValore` somma il fatturato **senza filtro funnel** mentre il
`closeCount` accanto è filtrato: il ticket medio mescola due popolazioni.

**5.9 Attribuzione mista.** [R] In `getAdvancedKpi.gdoStats` il numeratore è attribuito via
`leads.assignedToId` e il denominatore via `callLogs.userId`: chi aiuta un collega si abbassa la
propria percentuale. GDO 119 a settembre ha chiamato 619 lead di cui 45 non suoi.

---

## 6. Peso e zavorra

**6.1 330 MB di diagnostica di un bug chiuso a maggio.** [V]
`pipelineSnapshots` pesa **427 MB** totali su 89.475 righe; i tre array jsonb
`firstCallIds/secondCallIds/thirdCallIds` valgono **330 MB** su 78.988 righe. Il commento in
`pipelineActions.ts:191` dice che servono "solo per diagnosticare i lead spariti" — bug chiuso il
14/05. L'unica SELECT sulla tabella legge `fingerprint` e i tre `*Count`, mai gli array. Su un
progetto che a luglio ha avuto il database saturo, è il ritrovamento più pesante dell'audit.

**6.2 ~2.400 righe di codice morto, verificate una per una.** [R] Il read-model marketing legacy
(`ac-cache.ts` intero + tutte le funzioni di `activecampaign.ts`, ~700 righe) è confermato morto
anche dai dati: `crm_events`, `crm_appointments` e `ac_contacts` hanno **0 righe** in produzione.
Più: `scripts/archive/` (21 file), 5 componenti mai montati (729 righe), 12 server action morte
(= endpoint pubblici aperti), `api/debug/pipeline` (aperto a ogni utente loggato, con un commento
che ne chiede la rimozione dal 14/05), `_archive/prisma/schema.prisma`, 4 dipendenze mai importate,
e **501 MB** di worktree abbandonate in `.claude/worktrees/`.

**6.3 Il boss di squadra delle Conferme non prende mai danno.** [R] `teamAttackBoss` non è cablato
da nessuna parte, mentre `attackBoss` individuale sì. Ramo di gamification rotto, non solo morto.

**6.4 Le migrazioni non ricostruiscono il database.** [R] Due cartelle (`drizzle/` e
`drizzle/migrations/`), tre collisioni di numero (0004, 0032, 0037), journal incoerente, e **29
tabelle su 77 non sono create da nessuna migrazione** (le crea `scripts/run-migrations.ts` con DDL
inline). Un database ricreato da `drizzle/` non sta in piedi, e la procedura non è scritta da
nessuna parte. Da qui anche gli 8 indici dichiarati in `schema.ts` che **non esistono nel DB**.

**6.5 `supabase-rls.sql` in radice rimette `leads` e `notifications` nella publication realtime**,
che la migrazione 0020 aveva tolto per spegnere il WAL polling (e il conto Vercel). Nessun
riferimento nel codice: è una mina per chi lo rieseguisse. [R]

---

## 7. Prompt caching (bot) — la buona notizia

[R, con volumi ricontrollati da me sul DB]
Il bot chiama Anthropic ~**2.200 volte al giorno** (contate da `event_log.fenice_ai_reply`: 15/09 →
1.848, 16/09 → 1.078, 17/09 → 3.281, 18/09 → 2.215). Il prompt di sistema di Mario è **40.705
caratteri**, di cui ~97-98% stabile fra una chiamata e l'altra (unica variabile interna: il nome
persona Mario/Marta, due namespace di cache, non un invalidatore per chiamata). Le parti variabili
(ora, slot di prenotazione, nota di contesto) sono **già fisicamente dopo** il blocco stabile,
quindi **non serve riordinare il prompt**.

Basta spezzare `system` da stringa in due blocchi e mettere `cache_control: {type:'ephemeral'}` sul
primo. Zero caratteri del prompt toccati → **nessun cambio di comportamento possibile**; la latenza
migliora. Risparmio stimato ~**$2.100/mese** su ~$2.600 di input. Il caching costerebbe di più solo
se oltre il **78%** delle chiamate fosse a freddo: misurato, il 99% delle chiamate consecutive
globali sta entro 5 minuti, quindi i freddi sono ~**1%**.
Verifica dopo il deploy: loggare `usage.cache_read_input_tokens` — se è 0 ovunque, c'è un
invalidatore e la modifica va tolta, non lasciata a metà.

---

## 8. Cosa è stato controllato ed è risultato pulito

Vale quanto il resto, perché delimita il problema. [R]
- **Bottoni dentro tag testuali** (la causa del crash bianco noto): zero occorrenze reali.
- **`/api/bot/**` del CRM**: HMAC timing-safe, 503 se manca il segreto, doppia prova di
  appartenenza del lead prima di accettare un appuntamento. Nessun rilievo.
- **Webhook ActiveCampaign**: segreto fail-closed, dedup su `acContactId`.
- **`fetch` in uscita dal CRM**: tutte controllano sia lo status sia il flag di esito nel corpo.
- **`saveVenditoreOutcome`/`setConfermeOutcome` sul versionamento**: transazione + `WHERE version`
  + `.returning()`, latch `presentedAt` corretto. È il modello da copiare altrove (il difetto di
  1.5 è l'autorizzazione, non la concorrenza).
- **`latePenaltiesRunner`**: idempotente sul serio, unique index verificato.
- **TODO/FIXME**: zero occorrenze in tutto il CRM. Blocchi di codice commentato: nessuno.
- **`LANCIO_FAKE_NOW`** (orologio falso del lancio) **non è armato** in produzione.
- **Schema e DB allineati**: 78 tabelle contro 77, l'unica in più è una tabella orfana a 0 righe.

---

## 9. Il confronto fra i due database (fatto per la prima volta)

Finché CRM e bot erano gestiti da due sessioni separate, nessuno aveva mai incrociato i due
database. Fatto ora, spiega quasi tutte le dispute storiche.

**9.1 Il rebind del `crm_lead_id` — la causa madre.** [V sui totali CRM]
Il CRM **non deduplica per telefono in import**; il bot **deduplica per numero**. Quando il CRM crea
un lead nuovo per un numero che ha già, il bot riscrive `crm_lead_id` sulla conversazione esistente.
Risultato: il lead vecchio conserva l'appuntamento ma perde la chat, il lead nuovo ha la chat e
risulta `NEW` mai lavorato.
Numeri verificati sul CRM: **16.225 numeri di telefono hanno più di un lead, per 35.766 lead su
78.935 totali — il 45,3% del database**. Il 15/09 sono stati creati **8.032 lead in un giorno**, di
cui ~72% duplicati di numeri già presenti. [R] Effetto misurato lato bot: 555 conversazioni puntano
a un lead creato dopo la conversazione, di cui **59 con esito APPUNTAMENTO**; e **55 appuntamenti
CRM attribuiti al bot non hanno alcuna conversazione** — verificati uno per uno, sono tutti lo
stesso rebind.

**9.2 Gli esiti del bot arrivano: il canale è affidabile.** [R]
Su 844 conversazioni con `bot_outcome='APPUNTAMENTO'` [V: 844 esatte], solo **2** non sono mai
arrivate al CRM. Le altre 113 si spiegano tutte (53 rebind, 53 Conferme che rifissa, 4 scarti
successivi, 3 casi con report presenti). È la smentita definitiva della disputa storica dei "lead fermi al bot": il
problema non è mai stato la consegna degli esiti.

**9.3 Il CRM non sa più quanti appuntamenti ha fissato il bot.** [V per i 515]
`conferme_recall_scheduled` con `newAppointmentDate:null` **azzera `appointmentDate` lasciando
`status='APPOINTMENT'`**: nel CRM ci sono **515 lead in stato APPOINTMENT senza data**. E non esiste
alcun evento "appuntamento fissato" per l'utente bot (la gamification è OFF, quindi nessun
`RPG_AWARD_FISSATO`): l'unica traccia è un campo che viene sovrascritto. Conseguenza: agosto conta
369 appuntamenti secondo il bot e 332 secondo il CRM, e **nessuno dei due sistemi può ricostruire il
numero vero**. La cura è la stessa già adottata con successo per le presenze: un latch immutabile
`APPOINTMENT_SET` (chi, quando, per quando), e smettere di usare `appointmentDate` come contatore
storico.

**9.4 4.116 conversazioni non esistono nel CRM.** [V]
Il **28%** delle conversazioni del bot (4.116 su 14.654) non ha `crm_lead_id`, concentrate su tre
date (08/06, 13/07, 15/09 — 1.471 solo a settembre). [R] Di queste, **607 hanno almeno una risposta
del lead** (965 messaggi in ingresso), 43 a settembre. Sono persone a cui abbiamo scritto, che hanno
risposto, e che nel CRM **non esistono**: nessuna coda, nessun KPI, nessun richiamo. In più, 3.121
lead pushati il 15/09 non hanno mai generato una conversazione, e `BOT_PUSHED status:200` è stato
loggato lo stesso.

**9.5 La copia dello stato CRM dentro il bot è vecchia di due settimane.** [V]
`crm_lead_status`: 10.293 righe, solo **3.954 risincronizzate negli ultimi 7 giorni**; età mediana
della copia **14 giorni**. [R] Su 9.693 lead confrontati, 323 divergono (3,3%) — sempre per
staleness monodirezionale, mai per contraddizione, e **mai sulla data dell'appuntamento**. Ma il bot
decide riconferme e follow-up su uno stato vecchio in media di due settimane: 116 lead si sono
presentati e il bot non lo sa.
