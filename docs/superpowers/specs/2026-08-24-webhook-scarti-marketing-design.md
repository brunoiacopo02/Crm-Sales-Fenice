# Scarti dei lead verso il CRM marketing — design

**Data:** 2026-08-24
**Stato:** approvato dal PO
**Contesto:** [2026-05-07-marketing-webhooks-design.md](./2026-05-07-marketing-webhooks-design.md)

## Il problema

Il marketing riceve oggi sei eventi, tutti dal lato positivo del funnel: appuntamento
fissato, spostato, esitato, deal assegnato, vinto, perso. Non riceve **niente** sui lead
che muoiono prima dell'appuntamento — che sono la maggioranza.

Il risultato è che chi compra il traffico non sa distinguere una campagna che porta
persone senza budget da una che porta numeri inesistenti. Sono due problemi opposti:
la prima si aggiusta col targeting, la seconda col form. Oggi somigliano entrambe a
"pochi appuntamenti".

Ad agosto i GDO hanno lavorato circa 1.400 lead sul solo bot, più il volume umano.
Ogni scarto porta una causale che l'operatore ha già selezionato a mano e che oggi
resta chiusa nel CRM.

## Cosa mandiamo

Un evento nuovo: **`lead.rejected`**. Diventa l'unico posto dove il marketing legge
"questo lead è morto, ed ecco perché", qualunque sia lo stadio in cui è morto.

```json
{
  "eventId": "…uuid deterministico…",
  "eventType": "lead.rejected",
  "occurredAt": "2026-08-24T15:12:00.000Z",
  "apiVersion": "1",
  "lead": { "id": "…", "name": "…", "phone": "…", "funnel": "…", "utm": { … } },
  "data": {
    "stage": "GDO",
    "automatic": false,
    "reasonCode": "NO_BUDGET",
    "reasonLabel": "non ha soldi",
    "rawReason": "non ha soldi",
    "callCount": 2,
    "byBot": false,
    "rejectedAt": "2026-08-24T15:12:00.000Z",
    "rejectedBy": { "userId": "…", "displayName": "GDO 106", "role": "GDO" }
  }
}
```

Il blocco `lead` è identico a quello degli altri sei eventi: stessa anagrafica, stessi
UTM. Il marketing può incrociare gli scarti con le campagne senza codice nuovo.

### I quattro campi che contano

**`stage`** — `GDO` o `CONFERME`. Separa "non ha mai voluto l'appuntamento" da
"l'appuntamento c'era e poi è saltato". Sono due fallimenti diversi e vanno letti
diversi.

**`automatic`** — `true` solo per l'auto-scarto dopo il terzo tentativo a vuoto. Non è
un giudizio sul lead: è irreperibilità, e il marketing deve poterla escludere quando
misura la qualità del contatto.

**`byBot`** — `true` quando a scartare è il bot fissatore (GDO 201). Il bot non è
nascosto ma è isolabile: chi vuole confrontare solo il lavoro umano ha il filtro.

**`reasonCode`** — codice stabile, vedi sotto.

### Perché un codice e non la stringa

La causale è oggi una stringa italiana scelta da una tendina. Se il marketing
raggruppa su quella, ogni ritocco al testo spacca i grafici storici — e il testo
*è già sbagliato* in un caso (vedi "Il refuso"). Mandiamo quindi un codice stabile
più l'etichetta leggibile, e teniamo `rawReason` per l'audit.

| Causale operatore | `reasonCode` | Chi la usa |
|---|---|---|
| non ha soldi | `NO_BUDGET` | GDO, Conferme |
| non interessato | `NOT_INTERESTED` | GDO, Conferme |
| disoccupato | `UNEMPLOYED` | GDO, Conferme |
| straniero | `FOREIGN` | GDO, Conferme |
| solo informazioni | `INFO_ONLY` | GDO, Conferme |
| non vuole prendere l'appuntamento | `REFUSED_APPOINTMENT` | GDO, Conferme |
| numero inesistente | `INVALID_NUMBER` | GDO, Conferme |
| non ha potere decisionale | `NO_DECISION_POWER` | GDO, Conferme |
| irreperibile (3 o 4 tentativi vuoti) | `UNREACHABLE` | automatico |
| non risponde | `NO_ANSWER` | Conferme |
| posticipa senza data | `POSTPONED_NO_DATE` | Conferme |
| attaccato in faccia | `HUNG_UP` | Conferme |
| *qualsiasi altra* | `OTHER` | fallback |

Il fallback `OTHER` porta comunque `rawReason` valorizzato: una causale nuova non fa
perdere il dato mentre aggiorniamo la mappa.

## Dove si aggancia

Il bot passa dalla **stessa** `updateLeadOutcome` dei GDO umani (`/api/bot/outcome`
la chiama con `serviceCtx`). Un solo hook copre quindi tre dei quattro casi.

| Caso | Punto di aggancio | Condizione |
|---|---|---|
| Scarto GDO umano | `pipelineActions.updateLeadOutcome` | `outcome === 'DA_SCARTARE'` |
| Auto-scarto 3 NR | `pipelineActions.updateLeadOutcome` | `NON_RISPOSTO` e `newStatus === 'REJECTED'` |
| Scarto del bot | *(stesso hook)* | `serviceCtx.isBot` |
| Scarto Conferme | `confermeActions.setConfermeOutcome` | `confirmationsOutcome === 'scartato'` |

L'hook va **dopo** l'update riuscito, come gli altri cinque: se l'update fallisce per
`CONCURRENCY_ERROR` non deve partire nessun evento.

`enqueueMarketingWebhook` legge già il lead dal DB. La causale è sulla riga
(`leads.discardReason` per il GDO, `leads.confirmationsDiscardReason` per le Conferme),
quindi al chiamante basta passare il contesto che *non* è derivabile:

```ts
rejection: { stage: 'GDO' | 'CONFERME'; automatic: boolean }
```

## Idempotenza

`eventId` deterministico con granularità **al secondo**, come i cinque eventi non-`appointment.set`.

Un lead può essere scartato, riaperto e riscartato: sono fatti distinti e devono
propagarsi entrambi. Il bucket giornaliero di `appointment.set` qui sarebbe sbagliato —
schiaccerebbe due scarti veri dello stesso giorno in uno.

## Sovrapposizione con `appointment.outcome`

Gli scarti Conferme viaggiano **già** dentro `appointment.outcome`, che porta un campo
`discardReason`. Quell'evento non si tocca: resta l'evento del ciclo di vita
dell'appuntamento e va mantenuto per retrocompatibilità.

Ma questo significa che uno scarto Conferme genera **due** eventi. Nel messaggio al
loro dev va scritto a chiare lettere: **contare gli scarti solo da `lead.rejected`**,
altrimenti i numeri delle Conferme raddoppiano.

## Il refuso

L'auto-scarto scrive oggi `"irriperebile (3 tentativi vuoti)"` — mancano una `c` e
una `a`. È testo che i GDO leggono nella lista scarti.

Decisione PO: **si corregge** in `"irreperibile"`. La mappa dei codici riconosce
**entrambe** le grafie, quindi i lead già scartati con la vecchia stringa continuano a
produrre `UNREACHABLE` e lo storico interno non si spacca.

## Il debito che chiudiamo

La lista delle otto causali GDO è copiaincollata in due componenti:
`src/components/GdoQuickActions.tsx:68` e `src/components/OutcomeModal.tsx:16`.

Due copie e una mappa di codici che le deve coprire entrambe vanno fuori sincrono in
silenzio appena qualcuno tocca una sola tendina. La lista si accentra in
`src/lib/surveys/questions.ts`, dove vivono già `CONFERME_DISCARD_REASONS` e le altre
opzioni tunabili, e i due componenti la importano.

Un test verifica che **ogni** valore di entrambe le liste abbia un codice diverso da
`OTHER`: se domani si aggiunge una causale alla tendina senza mapparla, il test rompe.

## Cosa NON facciamo

- **Nessun backfill.** Decisione PO: il marketing accumula da adesso. Il backfill resta
  rifattibile in qualsiasi momento con `scripts/backfillMarketingEventsWindow.ts`.
- **Nessuna migrazione DB.** Tutti i campi esistono.
- **Nessun evento per i richiami o gli esiti non terminali.** Il marketing ha chiesto
  gli scarti; un evento per ogni "richiamo fra due giorni" sarebbe rumore.
- **Nessun evento per i lead mai entrati in pipeline** (liste bloccate, telefono
  invalido allo scarico AC): non sono scarti, sono lead che non sono mai esistiti.

## Test

Puri, senza DB, nello stile dei moduli esistenti (`src/lib/bot-fissatore/*.test.ts`):

1. **Mappa causali** — ogni valore delle due liste produce un codice ≠ `OTHER`;
   entrambe le grafie del refuso danno `UNREACHABLE`; una stringa ignota dà `OTHER`
   con `rawReason` preservato; `null` non fa esplodere il builder.
2. **Builder envelope** — `stage`, `automatic`, `byBot` corretti nei quattro casi;
   la causale letta dal campo giusto a seconda dello stage.
3. **eventId** — due scarti dello stesso lead nello stesso giorno ma a secondi diversi
   producono id diversi; lo stesso scarto ripetuto produce lo stesso id.

## Rischi

**Il loro receiver non conosce `lead.rejected`.** Se lo rifiuta con un 4xx la nostra
outbox ritenta col backoff 1m → 5m → 30m → 2h → 6h e poi va in DLQ. Nessun dato perso e
nessun impatto sul CRM, ma gli eventi non arrivano finché non aggiornano. Va concordato
**prima** del go-live: si prepara il testo per il loro dev con payload d'esempio e la
tabella dei codici.

**Kill-switch già esistente.** In emergenza `MARKETING_WEBHOOK_ENABLED=false` su Vercel
spegne tutto, evento nuovo compreso.
