# Ondata di fix dalla revisione finale del branch

Ogni voce ha: dove sta, cosa c'e' che non va, e cosa fare. Falle tutte, con commit
separati per gruppo logico. Dove serve un giudizio, la decisione e' gia' presa qui.

---

## CRITICAL

### C1 — Il bot riscrive la data di un appuntamento autofissato senza toccare Google

`src/app/api/bot/outcome/route.ts:240-275`. Il ramo di idempotenza anti-rifissaggio
intercetta `APPUNTAMENTO` su un lead gia' `status='APPOINTMENT'` e, se la data e'
diversa, aggiorna `appointmentDate`. Non guarda `confirmationsOutcome`, ne' chi possiede
il lead. Su un autofissato: l'evento Google e il Meet restano all'ora vecchia (questo
ramo non tocca mai `calendarEvents`), e parte una notifica a tutte le Conferme per un
lead che la loro board non puo' mostrare. Il cliente si presenta su una stanza che il
venditore non apre.

Raggiungibile proprio sui "5 ridati dal bot": il gate di appartenenza richiede un
`BOT_PUSHED` consegnato, che e' esattamente la popolazione che
`assignBotReturnsToSalesPipeline` seleziona.

**Fix:** prima di quel ramo, se `lead.confirmationsOutcome === SELF_BOOKED_OUTCOME`,
esci con una risposta di no-op esplicita (es. `{ ok: true, skipped: 'self_booked' }`) e
un log. L'appuntamento autofissato e' terminale per il bot, come lo e' gia' un
APPUNTAMENTO suo.

### C2 — Il venditore entra nei KPI dei GDO

E' la cosa che il committente ha chiesto esplicitamente di non rompere, e la spec
affermava (sbagliando) che i KPI GDO si escludono da soli filtrando `users.role='GDO'`.

Due punti, entrambi raggiunti dalle righe `callLogs` che il venditore ora scrive:

1. `src/app/actions/kpiAdvancedActions.ts:195-215` — `gdoStatsMap` si costruisce da
   qualunque `userId` presente in `callLogs`, escludendo solo il bot: su `/kpi-gdo`
   comparirebbe una riga "Performance GDO" col nome del venditore. E a `:110-123` il set
   `apptLeadsInRange` (testata "App Fissati" e attribuzione per assegnatario) filtra
   solo il bot: gli autofissati entrerebbero nel numero aziendale, insieme a
   `calledLeadsCount`, `answeredLeadsCount`, `totalCalls` e al grafico dei motivi di
   scarto.
2. `src/app/actions/kpiTeamActions.ts:105-140` — le chiamate sono correttamente
   intersecate con la lista GDO (`:96`), **ma gli appuntamenti no**: `apptLeadsRaw` e'
   filtrato solo su `botIds` (`:119`). `totalAppointments`, `teamConversionRate` e la
   serie del grafico includerebbero il venditore mentre il ranking sotto no: il totale
   smette di essere la somma delle righe.

**Fix:** in entrambi i file, intersecare gli **appuntamenti** con l'insieme dei GDO
esattamente come si fa gia' per le chiamate. Non riprogettare niente: e' un filtro in
due punti. Verifica poi che su un periodo senza autofissati i numeri restino identici.

### C3 — L'attribuzione CDR puo' riscrivere la storia telefonica di un GDO

`src/lib/cdr/attribuzione.ts:45`: la CTE di ancoraggio unisce `callLogs -> users` con il
solo `NOT u."isBot"`, senza `role='GDO'`. Un esito del venditore entro ±10 minuti da una
chiamata uscente sullo stesso numero lo rende candidato proprietario di quell'interno, e
`riattribuisciChiamate({applica:true})` scrive davvero (`UPDATE "pbxCalls"` a `:133`,
`UPDATE "pbxExtensions"` a `:140`), riattribuendo anche lo storico a ogni
`npm run import:cdr`.

Succede solo se il venditore chiama da un interno del centralino, ma e' l'unico difetto
che **distrugge dati gia' acquisiti** invece di aggiungerne di sbagliati.

**Fix:** `AND u.role = 'GDO'` nella join. Una riga.

---

## IMPORTANT

### I1 — `moveSalesSelfAppointment` e' esportata e non la chiama nessuno

Un appuntamento autofissato oggi non lo puo' spostare nessuno: la board del venditore
esclude `status='APPOINTMENT'`, `updateGdoAppointment` richiede `role==='GDO'`, le
Conferme non vedono il lead, e `scheduleConfermeRecall` e' gated su
`confirmationsOutcome === 'confermato'`.

**Decisione presa: cablarla, non cancellarla.** Aggiungi a `/mia-pipeline` una sezione
compatta "Appuntamenti che hai fissato" (i lead con `salespersonUserId = lui` e
`confirmationsOutcome = SELF_BOOKED_OUTCOME` e `appointmentDate` nel futuro), ciascuno
con data, nome, telefono e un pulsante **Sposta** che apre lo stesso selettore
`datetime-local` gia' usato per il fissaggio e chiama `moveSalesSelfAppointment`.
L'autorizzazione resta quella che ha gia' (`requireSalesPipelineUser`), quindi lo fa il
venditore, che e' chi parla col cliente. Serve una funzione di lettura accanto a
`getSalesPipelineLeads`.

Gia' che la cabli: due messaggi d'errore distinti invece di uno solo per "non e' tuo" e
"non e' autofissato", la guardia difensiva su `status === 'APPOINTMENT'`, e la
validazione NaN su `at` che `setSalesSelfAppointment` ha gia' e questa no.

### I2 — Annullare un autofissato lascia vivo l'invito Google al cliente

`src/app/actions/appointmentActions.ts:205-252` azzera tutto e rimette il lead in
pipeline, senza mai chiamare `deleteGoogleCalendarEvent` ne' toccare `calendarEvents`.
E' un buco preesistente, ma prima di questo branch nessun appuntamento nasceva con un
invito gia' recapitato al cliente.

**Fix, limitato agli autofissati** (non cambiare il comportamento per gli altri):
se il lead che si sta annullando ha `confirmationsOutcome === SELF_BOOKED_OUTCOME`,
cancella l'evento Google e la riga `calendarEvents`, con lo stesso trattamento
dell'errore gia' usato altrove (se Google fallisce, la riga resta e si logga l'orfano).

### I3 — Il bot puo' riprendersi un "ridato" prima che il venditore lo fissi

`src/app/api/bot/outcome/route.ts:608-615`: con `APPUNTAMENTO`, assegnatario non-bot,
lead gia' lavorato dal bot e nessuna presenza registrata, il lead torna all'account bot.
Su un lead appena messo in pipeline tutte e quattro le condizioni sono vere: sparisce
dalla board del venditore senza notifica, e il campione del test si assottiglia in
silenzio.

**Fix:** non riprendersi il lead se il suo `assignedToId` e' il venditore configurato
nella pipeline (`readSalesPipelineConfig()`); in quel caso il bot resta postino, come
gia' fa sui lead dei GDO.

### I4 — Il gate gamification legge il ruolo dal posto fragile, ed e' parziale

`src/app/actions/pipelineActions.ts:299` e `:311`.

1. Legge `supabaseUser.user_metadata?.role` **senza default**, mentre `currentTenant()`
   fa `meta.role ?? 'GDO'`. Un GDO con i metadata incompleti smetterebbe in silenzio di
   guadagnare forzieri, boss, duelli e creature. Nel ramo `else` `tenant` e' gia' in
   scope: usa `tenant.role`.
2. Il gate copre solo il blocco "ogni chiamata". Il blocco `outcome === 'APPUNTAMENTO'`
   (XP e coins `FISSATO`, chest `fissaggi`, boss, `triggerLootDrop`, `evaluateTeamGoals`)
   e' ancora gated solo su `!isBotActor`. Estendi anche quello.

### I5 — L'endpoint pull marketing emette `appointment.outcome` per gli autofissati

`src/app/api/marketing/leads/route.ts:65`: per `eventType=appointment.outcome` filtra
`isNotNull(leads.confirmationsOutcome)`, e `mapConfirmationsOutcome`
(`src/lib/marketing-webhooks/payload-builders.ts:136-140`) manda tutto cio' che non e'
`confermato`/`scartato` su `'DA_RIFISSARE'`. La spec dice esplicitamente di non emettere
`appointment.outcome` per gli autofissati, perche' a valle diventerebbe una conferma: il
percorso push lo rispetta, il pull lo contraddice.

**Fix:** escludere la sentinella da quel filtro.

### I6 — Gli achievement non hanno ruolo e si sbloccano per il venditore

La tabella `achievements` non ha colonna `role` (a differenza di `quests`), e
`measureAchievementMetric` (`src/app/actions/achievementActions.ts:14-241`) conta
`total_calls`, `total_appointments`, `total_leads_contacted`,
`total_scripts_completed` per qualunque `userId`. `checkAchievements` e' raggiungibile
dal flusso sondaggi, che per i venditori e' vivo: il venditore sbloccherebbe badge da
GDO e incasserebbe `walletCoins`.

**Fix minimo:** in `checkAchievements`, uscire subito se l'utente non ha
`users.role = 'GDO'`. Non aggiungere colonne alla tabella: e' fuori scope.

### I8 — `/monitor-pause` mostrerebbe il venditore come riga "gdo"

`src/app/actions/productivityActions.ts:240-251`: la join `pbxCalls -> users` ha solo
`eq(users.phoneTimeTracked, true)`, che di default e' `true`, senza predicato sul ruolo,
e il campo di output si chiama `gdo`. Stessa condizionalita' di C3 (vale se il venditore
ha un interno).

**Fix:** aggiungere il predicato sul ruolo GDO.

---

## Dal triage dei minori

### T5 — Manca il test sulla proprieta' che protegge la produzione

"A pipeline spenta il GDO scelto e' lo stesso" oggi e' difesa solo da prosa. I test puri
su `shouldDivertFreshLead`/`canDivertFresh` ci sono, manca il cablaggio.

**Fix:** estrai in `src/lib/salesPipeline/feeding.ts` una funzione pura
`decideDiversion({ cfg, diverted, funnel, launchBucket, phoneSuspicious })` che ritorna
`salesUserId | null`, chiamala dal webhook al posto della logica inline, e testala —
inclusi i casi "pipeline spenta -> null", "funnel del lancio -> null", "launchBucket
qualsiasi -> null", "quarantena -> null", "tetto pieno -> null". Registra il test nello
script `test` di `package.json` se aggiungi un file nuovo.

### T8 — L'interruttore salva i valori di bozza non confermati

`src/app/(dashboard)/pipeline-venditore/PipelineVenditoreClient.tsx:58-66`:
`handleToggle` usa `draftUserId`/`draftCap`. L'admin cambia il venditore nel selettore,
non salva, poi spegne e riaccende: la pipeline riparte su un venditore che non ha mai
confermato.

**Fix:** `handleToggle` usa i valori della config salvata, non quelli di bozza.

### T9 — In "Tutte le aziende" la pagina mostra una sola azienda dicendo "tutte"

`currentTenant` in modalita' aggregata lascia `companyId` su un'azienda reale e alza
`isAllCompanies`. La pagina mostra i dati di UNA azienda dichiarando "tutte".

**Fix:** se `ctx.isAllCompanies`, la pagina dice di scegliere un'azienda invece di
mostrare numeri.

---

## Minori da chiudere nello stesso giro (sono tutti di poche righe)

- **M1** — `SALES_SELF_BOOKED` e `SALES_PIPELINE_ASSIGNED` non sono in `getEventLabel`
  (`src/components/ContactDrawer.tsx:234-255`): la timeline li mostra come "Evento
  Sconosciuto", proprio dove si va a cercare l'audit. Aggiungili con etichette leggibili.
- **M2** — `/monitor-vendite` (`MonitorVenditeClient.tsx:76-83`) etichetta un autofissato
  come "In attesa", che per un manager significa "non ancora confermato dalle Conferme".
  Aggiungi l'etichetta per la sentinella. E `AppointmentBoard.tsx:111` apre il riquadro
  "GDO Feedback Loop" perche' `confirmationsOutcome` e' truthy ma nessun ramo interno
  matcha: esce un box vuoto. Escludi la sentinella da quella condizione.
- **M7** — Sul lead dirottato l'evento `ASSIGNED` registra la fascia di routing GDO
  calcolata ma mai seguita (`route.ts:1501`). Scrivi `routing: 'sales_pipeline'`.
- **M9** — `assignBotReturnsToSalesPipeline` non avvisa **il GDO** a cui toglie i lead.
  In questo CRM "lead spariti" e' una frase con una storia. Manda una notifica al GDO
  di origine con quanti lead gli sono stati spostati e perche'.
- **M10** — `updateLeadOutcome` non ha nessuna autorizzazione per ruolo: la garanzia che
  il venditore possa fissare solo tramite `setSalesSelfAppointment` (e quindi con la
  sentinella) poggia sul fatto che il Topbar renderizza la ricerca solo ai GDO. Rendila
  strutturale: se l'attore non e' un GDO, non e' un service account, e l'esito e'
  `APPUNTAMENTO`, rifiuta con un errore chiaro.
