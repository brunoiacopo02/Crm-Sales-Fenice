# Finestra ferie GDO → dirottamento intake al bot (8–16 agosto 2026)

Data: 2026-08-07
Stato: approvato da PO (Bruno)

## Problema

Dall'8 al 16 agosto 2026 nessun GDO umano è al lavoro: rientrano a fissare il 17.
I lead ActiveCampaign continuano ad arrivare e oggi il round-robin li distribuisce
ai 6 GDO umani con `acAutoIntake = true`, dove resterebbero fermi 9 giorni.

Servono tre cose, tutte a tempo e tutte automatiche (nessuno deve mettere mano al
CRM né la sera del 7 né la sera del 16):

1. Tutti i lead AC Fenice in ingresso vanno al bot (GDO 201).
2. Il cap giornaliero del bot (`BOT_DAILY_CAP = 50`) è sospeso per la durata.
3. La scheda `/lead-automatici` (selezione GDO destinatari) è ignorata per la durata,
   ma resta funzionante e con i flag intatti.

## Stato attuale (verificato in prod il 2026-08-07)

- Un solo account bot Fenice: **GDO 201** (`867dd21a-…`), `isActive = true`, `acAutoIntake = true`.
- 6 GDO umani nel pool AC: 106, 109, 114, 115, 117, 119.
- Round-robin in `src/app/api/webhooks/activecampaign/route.ts:577-593`:
  pool = `companyId=fenice + role=GDO + isActive + acAutoIntake`, con sottoquery
  che sfila gli `isBot` a quota `BOT_DAILY_CAP` nel giorno solare Europe/Rome.
  Ordine: `acLastAssignedAt asc, id asc`.
- Se l'assegnatario è `isBot`, `route.ts:659` fa già partire `pushLeadToBot` in `after()`.
- Il retry delle `acIntakeFailures` ri-colpisce lo stesso webhook → eredita la logica.

## Decisioni

| Domanda | Decisione |
|---|---|
| Confini finestra | `2026-08-08 00:00` → `2026-08-17 00:00` Europe/Rome (estremo destro escluso). Il 16 è dentro. |
| Bot non disponibile | Fallback al pool umano di oggi. Nessun lead perso, nessuna failure nuova. |
| Cap dopo il 16 | Torna a 50 da solo. Bypass valido solo dentro la finestra. |
| Perimetro | Solo webhook AC Fenice. Import manuale e Serenamente intatti. |
| Ridati bot → umani | `reassign.ts` invariato: i ridati si accumulano sui GDO umani e li trovano il 17. |

## Design

### 1. `src/lib/bot-fissatore/holidayWindow.ts` (nuovo)

Modulo puro, senza I/O e senza DB. Espone:

```ts
export function isBotHolidayWindow(now?: Date): boolean
export function getBotHolidayWindow(): { from: string; until: string } | null  // per la UI
```

Finestra di default nel codice: `2026-08-08` → `2026-08-17` (`until` escluso).
Il confronto avviene sulla **data solare Europe/Rome** di `now`, ricavata con
`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })` — stessa tecnica già
usata nel webhook per il cap giornaliero, quindi immune a DST e all'ora UTC del
server Vercel. Confronto lessicografico su stringhe `YYYY-MM-DD`: `from <= oggi < until`.

Nessun cron. Un cron a mezzanotte può non partire, partire in ritardo o partire due
volte; una data non ha stati. Alla prima richiesta dopo la mezzanotte dell'8 la
finestra è aperta, alla prima dopo la mezzanotte del 17 è chiusa.

**Override senza deploy** — env opzionale `BOT_HOLIDAY_WINDOW`:
- `2026-08-08..2026-08-20` → sposta le date (se le ferie si allungano);
- `off` (o `none`, `disabled`) → spegne la finestra subito;
- assente → valgono le date del codice;
- malformata → **si ignora e si usa il default**, con un `console.warn`. Una env
  scritta male non deve mai far collassare l'intake dei lead.

### 2. Dirottamento in `route.ts`

La selezione del pool diventa condizionale su `isBotHolidayWindow(now)`:

- **Fuori finestra**: la query di oggi, invariata. Nessuna regressione dal 17.
- **Dentro finestra**: pool = `companyId=fenice + role=GDO + isActive + isBot=true`,
  senza filtro `acAutoIntake` e senza sottoquery del cap. Stesso ordinamento
  (`acLastAssignedAt asc, id asc`), così se un domani ci fossero due bot si
  alternerebbero.
- **Dentro finestra ma pool bot vuoto** (bot disattivato): si ricade sulla query
  normale. Se anche quella è vuota, resta il comportamento attuale (`no_gdo` →
  `acIntakeFailures`).

Tutto il resto del handler non cambia: dedup, advisory lock, guardia cross-azienda,
insert, `acLastAssignedAt`, push al bot, notifica, eventi.

Sull'evento `ASSIGNED` si aggiunge `botHolidayWindow: true` nei metadata quando il
lead è stato dirottato dalla finestra. Serve fra due mesi, quando si guarderanno i
volumi di agosto: la spiegazione sta nel DB, non nella memoria di qualcuno.

### 3. Striscia informativa su `/lead-automatici`

`page.tsx` (server) passa al client il risultato di `getBotHolidayWindow()` valutato
adesso. Se la finestra è attiva, il client mostra in cima una striscia ambrata:

> **Ferie GDO 8–16 agosto** — tutti i lead ActiveCampaign in arrivo vengono
> assegnati al bot (GDO 201) e il suo cap giornaliero è sospeso. Le selezioni qui
> sotto restano salvate e tornano attive da sole il 17 agosto.

Gli interruttori restano **funzionanti**: i flag `acAutoIntake` nel DB non vengono
toccati da nessuno, così il 17 il pool riparte con la configurazione di oggi. La
striscia esiste perché senza di lei un admin vede sei pallini verdi, non vede
arrivare nulla e conclude che il CRM è rotto.

Fuori finestra la striscia non viene renderizzata.

## Cosa non viene toccato

Import manuale `/import`, webhook Serenamente, `reassign.ts`, `BOT_DAILY_CAP` fuori
finestra, gamification, KPI, assegnazione dei pool, `pushLeadToBot`.

## Verifica

Essendo una finestra a data, il comportamento reale non è osservabile prima di
domani. Copertura:

1. **Test unitari** su `isBotHolidayWindow` (`holidayWindow.test.ts`, aggiunto allo
   script `npm test`): giorno prima / primo giorno / giorno di mezzo / ultimo giorno
   incluso / primo giorno fuori; mezzanotte esatta lato Rome con server UTC (il caso
   che rompe se si usa `toISOString()`); `off`; env malformata → default; env valida
   → override.
2. **Build** `npm run build` pulita.
3. **Controllo in prod domani mattina**: query sui lead `source='activecampaign'`
   creati dopo la mezzanotte dell'8, verificando `assignedToId = GDO 201` e la
   presenza degli eventi `BOT_PUSHED`.
4. **Controllo il 17**: primo lead del mattino deve tornare a un GDO umano.

## Rollback

Impostare `BOT_HOLIDAY_WINDOW=off` su Vercel e ridistribuire (o aspettare la
prossima invocazione della funzione): l'intake torna immediatamente al
comportamento attuale, senza revert di codice.
