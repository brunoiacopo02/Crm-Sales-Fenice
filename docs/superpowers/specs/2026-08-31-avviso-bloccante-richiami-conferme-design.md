# Avviso bloccante richiami Conferme — design

Data: 2026-08-31
Richiesta originale: Bruno, 2026-08-29 (rinviata allora, ripresa oggi)

## Problema

Quando un richiamo Conferme ("risentire dopo", `leads.confSnoozeAt`) arriva a
scadenza, oggi succedono due cose deboli:

1. **`alert()` nativo** in `ConfermeBoard.tsx` (righe ~241-272): parte solo per
   chi è fisicamente sulla board Conferme, solo per i lead nelle liste
   `oggiLeads`/`domaniLeads`, una volta sola per sessione, e si chiude con OK
   senza lasciare traccia. Chi è su un'altra pagina non vede niente.
2. **Banner blu** `ConfermeRecallBanner`: piccolo, in basso a destra, con una X
   che lo fa sparire per sempre (dismiss locale). Facilissimo da ignorare.

Risultato: i richiami vengono dimenticati. Alcuni restano scoperti per giorni
(oggi in prod ce ne sono 3 fermi da aprile).

## Cosa costruiamo

Un avviso **a schermo pieno che blocca l'operatività** di tutte le Conferme
finché il richiamo non viene preso in carico. Tre sole vie d'uscita:

- **Apri e chiamalo** → apre la scheda del lead: l'avviso si spegne **per tutti**.
- **Lo chiamo io** → claim: da quel momento l'avviso riappare **solo a chi ha
  cliccato** e sparisce agli altri. Scade dopo 10 minuti di inattività.
- **Snooze 2 min** → silenzio globale di 2 minuti, poi **ritorna a tutti**.

### Decisioni prese con Bruno (2026-08-31)

| Domanda | Decisione |
|---|---|
| Cosa fa scattare l'avviso | Solo richiami Conferme scaduti (`confSnoozeAt <= now`), **sia di oggi sia parcheggiati in giorni precedenti** |
| Cosa lo spegne per tutti | Aprire la scheda del lead |
| Durata del claim | Finché gestisce il lead, oppure **10 minuti** e torna a tutti |
| Quanto blocca | Blocco totale: nessuna X, nessun ESC, nessun click-fuori |
| Chi lo vede | **Solo ruolo `CONFERME`** (manager e admin mai) |
| Multi-azienda | Sì, suona anche per l'altra azienda, con chip azienda; "Apri" fa lo switch |
| Più richiami insieme | Uno alla volta, il più vecchio, con contatore "1 di N" |
| Richiami archeologici | **Cutoff 7 giorni** + bonifica dei 3 di aprile |

## Architettura

### Stato: 4 colonne su `leads` (migrazione 0032)

| Colonna | Tipo | Significato |
|---|---|---|
| `confAlertSnoozedUntil` | `timestamptz` | Silenzio globale fino a questo istante (snooze 2 min) |
| `confAlertClaimedById` | `text` | Chi ha premuto "Lo chiamo io" (`users.id`) |
| `confAlertClaimedAt` | `timestamptz` | Quando, per far scadere il claim a 10 min |
| `confAlertHandledAt` | `timestamptz` | Qualcuno ha aperto la scheda → spento per tutti |

**Perché colonne su `leads` e non una tabella nuova**: il trigger della
migrazione 0019 già manda un ping Broadcast `leads` sul topic `crm:<azienda>` a
ogni UPDATE della tabella. Mettendo lo stato lì, il claim si propaga a tutti gli
schermi **senza un canale nuovo, senza un evento nuovo, senza un trigger nuovo**
— e la regola "mai un secondo channel sullo stesso topic"
(`project_conferme_presence`) resta rispettata per costruzione.

**Costo di scrittura**: una UPDATE per click (snooze / claim / apertura), cioè
poche decine al giorno. Nessuna scrittura periodica: il ritorno dopo 2 minuti è
calcolato lato client dal timestamp. Nessun rischio per il Disk IO
(`project_disk_io_optimization`).

**Reset**: `setConfermeSnooze` azzera tutte e 4 le colonne ogni volta che scrive
un nuovo `confSnoozeAt`. Un lead ri-parcheggiato torna quindi a suonare da capo.

**Indice**: riusa `leads_conf_snooze_idx` (parziale su
`companyId, confSnoozeAt WHERE confirmationsOutcome IS NULL AND confSnoozeAt IS NOT NULL`).
Nessun indice nuovo.

### Selezione: funzione pura + query

`src/lib/conferme/blockingAlert.ts`

```ts
export type AlertCandidate = {
  id: string; name: string; phone: string | null; companyId: string
  snoozeAt: Date; notes: string | null
  alertSnoozedUntil: Date | null
  claimedById: string | null; claimedAt: Date | null
  handledAt: Date | null
}

export const CLAIM_TTL_MS = 10 * 60_000
export const SNOOZE_MS = 2 * 60_000
export const STALE_CUTOFF_DAYS = 7

/** Il candidato che questo utente deve vedere adesso, + quanti ne restano. */
export function selectBlockingAlert(
  rows: AlertCandidate[], opts: { now: Date; userId: string }
): { alert: AlertCandidate | null; queueTotal: number; nextWakeAt: Date | null }
```

Regole applicate in ordine, sui candidati ordinati dal più vecchio:

1. scarta se `handledAt` valorizzato;
2. scarta se `snoozeAt` è più vecchio di `STALE_CUTOFF_DAYS` (archeologia);
3. scarta se `alertSnoozedUntil > now` (silenzio globale in corso);
4. scarta se `claimedById` è di un **altro** utente e `claimedAt` è entro
   `CLAIM_TTL_MS` (l'ha preso lui);
5. il primo che sopravvive è l'avviso; `queueTotal` conta tutti i sopravvissuti.

`nextWakeAt` è il primo istante futuro in cui la risposta cambierebbe da sola
(fine snooze o scadenza claim): serve al client per riaccendere l'overlay al
secondo giusto, senza polling stretto.

La funzione è pura e testata; la query si limita a portare le righe candidate.

### Server actions — `src/app/actions/confermeAlertActions.ts`

Tutte con `currentTenant()` + `assertSalesArea()` + gate `role === 'CONFERME'`,
tutte scoped su `inArray(leads.companyId, ctx.allowedCompanies)`.

| Action | Effetto |
|---|---|
| `getConfermeBlockingAlert()` | Query candidati (`confSnoozeAt` tra `now - 7gg` e `now`, `confirmationsOutcome IS NULL`, `confAlertHandledAt IS NULL`, limit 20) → `selectBlockingAlert` → `{ alert, queueTotal, nextWakeAt }` |
| `snoozeConfermeAlert(leadId)` | `confAlertSnoozedUntil = now + 2min`, azzera claim |
| `claimConfermeAlert(leadId)` | `confAlertClaimedById = me`, `confAlertClaimedAt = now`, `confAlertSnoozedUntil = null` |
| `markConfermeAlertHandled(leadId)` | `confAlertHandledAt = now` |

Le UPDATE **non toccano** `leads.version` né `updatedAt`: sono metadati
dell'avviso, non modifiche al lead, e bumparne la versione farebbe scattare
`CONCURRENCY_ERROR` nelle altre azioni Conferme mentre l'operatore lavora.

### Componente — `src/components/ConfermeRecallBlockingAlert.tsx`

Montato in `src/app/(dashboard)/layout.tsx` accanto a `ConfermeRecallBanner`,
dentro `<SafeWrapper>`, con lo stesso gate `session.user.role === 'CONFERME'`.

- `fixed inset-0 z-[200]` (sopra drawer e radar), sfondo pieno non trasparente,
  `document.body.style.overflow = 'hidden'` mentre è aperto.
- **Nessuna** X, nessun handler ESC, nessun click-outside: le uniche uscite sono
  i tre bottoni.
- Contenuto: chip azienda (FENICE / SERENAMENTE / …), nome, **telefono grande
  cliccabile** (`tel:`), orario del richiamo e "scaduto da N minuti", note del
  richiamo se presenti, contatore "1 di N" quando `queueTotal > 1`.
- Aggiornamento, tre fonti che convergono sulla stessa `load()`:
  1. `onBusEvent('leads')` → refetch (propagazione claim ~1,5s per il debounce);
  2. `setInterval` 30s di riserva — il realtime a volte muore in silenzio, è la
     stessa difesa già adottata da presence e banner;
  3. timer locale su `nextWakeAt` → refetch all'istante esatto in cui lo snooze
     scade, senza aspettare il giro dei 30s.
- Aggiornamento ottimistico locale al click (l'overlay sparisce subito a chi
  preme, senza aspettare il round-trip).

### "Apri e chiamalo"

1. `markConfermeAlertHandled(leadId)`;
2. se `lead.companyId !== azienda attiva` → `POST /api/company/select` con quella
   azienda (switch già esistente);
3. `router.push('/conferme?lead=<id>')` — deep-link già supportato da
   `ConfermeBoard` (`pendingDeepLink`).

⚠️ **Gap da chiudere**: oggi il deep-link apre il drawer solo se il lead si trova
in una delle liste già caricate dalla board; un richiamo parcheggiato da giorni
può non esserci, e il deep-link "rinuncia in silenzio". Va aggiunto un fallback
che carica il singolo lead per id quando non è in nessuna lista.

### Rimozioni e contorno

- **Rimuovere** lo snooze watcher con `alert()` nativo in `ConfermeBoard.tsx`
  (righe ~241-272) e lo stato `alertedSnoozes`: è il predecessore rozzo di
  questa feature e altrimenti suonerebbero in due. In più `alert()` blocca il
  tab del browser.
- `ConfermeRecallBanner` (banner blu) passa ai soli richiami **futuri**
  (`snoozeAt > now`, finestra 30 minuti): gli scaduti sono ora di competenza
  dell'overlay, e non vogliamo due avvisi per lo stesso richiamo.
- **Bonifica**: azzerare `confSnoozeAt` sui 3 lead con richiamo scaduto da
  aprile 2026 (nessun esito Conferme). Restano nei board come sempre, smettono
  solo di essere "richiami pendenti".

## Limiti accettati

- **Account condiviso Alberto/Lavinia**: il claim è per `users.id`, quindi se una
  delle due preme "Lo chiamo io" l'avviso sparisce anche all'altra. Inevitabile
  finché l'account è condiviso (`project_conferme_account_condiviso`).
- **Propagazione ~1,5s**: il bus `leads` è coalesced con debounce 1500ms. Chi
  clicca vede l'effetto subito (ottimistico); gli altri schermi entro ~2s.
- **Tab in background**: il timer locale e il poll 30s continuano, ma il browser
  può rallentare i timer delle tab nascoste. L'avviso comparirà al ritorno sulla
  tab, non prima.

## Test

`src/lib/conferme/blockingAlert.test.ts`, con `node --test` + `tsx` come il
resto del progetto (aggiungere il file allo script `test` in `package.json`).
Casi:

1. nessun candidato → `alert: null`;
2. due scaduti → viene scelto il più vecchio, `queueTotal = 2`;
3. `handledAt` valorizzato → escluso;
4. `snoozeAt` più vecchio di 7 giorni → escluso;
5. `alertSnoozedUntil` nel futuro → escluso, e `nextWakeAt` = quell'istante;
6. claim di un altro utente entro i 10 min → escluso per me, visibile a lui;
7. claim di un altro utente scaduto (> 10 min) → torna visibile a tutti;
8. claim mio → lo vedo io, e resta escluso per gli altri;
9. `nextWakeAt` = il più vicino tra fine snooze e scadenza claim.

## Piano di lavoro

1. Migrazione 0032 (4 colonne) + `schema.ts`.
2. `blockingAlert.ts` puro + test (TDD).
3. `confermeAlertActions.ts` (4 action).
4. Reset delle colonne dentro `setConfermeSnooze`.
5. `ConfermeRecallBlockingAlert.tsx` + mount nel layout.
6. Fallback deep-link per lead fuori dalle liste caricate.
7. Rimozione `alert()` nativo + banner blu ai soli richiami futuri.
8. Bonifica dei 3 richiami di aprile.
9. Build + QA browser.
