# Brief tecnico — nuovo evento `lead.rejected` dal CRM Fenice

Questo documento è indirizzato a chi lavora sul **receiver** lato CRM marketing
(`POST /marketing/api/webhooks/crm-fenice`). Contiene tutto il necessario: non serve
altro contesto.

Il CRM Fenice sta per iniziare a inviare un settimo tipo di evento. **Il receiver oggi
non lo conosce.** Se risponde con un 4xx, il nostro outbox ritenta col backoff
1m → 5m → 30m → 2h → 6h e poi manda l'evento in dead-letter queue: nessun dato viene
perso da parte nostra, ma voi non ricevete niente finché il receiver non è aggiornato.

Serve quindi che il receiver accetti `lead.rejected` **prima** che attiviamo l'invio.
Fateci sapere quando siete pronti e accendiamo.

---

## 1. Cosa non cambia

Il trasporto è identico a quello dei sei eventi che già ricevete. Nessuna modifica a
firma, header, autenticazione o formato dell'inviluppo.

- **Metodo e URL:** `POST` sull'endpoint che già usate
- **Content-Type:** `application/json`
- **Firma:** `X-CRM-Signature: sha256=<hex>` dove `<hex>` è
  `HMAC-SHA256(secret, rawBody)` calcolato sul **body grezzo**, senza prefisso
  timestamp. Il secret è quello che avete già (dalla vostra parte si chiama
  `WEBHOOK_SECRET_CRM`).
- **Dedup:** `X-CRM-Event-Id` — è un UUID deterministico, la vostra logica di
  idempotenza esistente vale identica.
- **Tipo:** `X-CRM-Event-Type: lead.rejected`

Se il vostro handler è già generico sul body e valida la firma prima di guardare
`eventType`, il lavoro si riduce a **riconoscere un valore in più** e persistere il
nuovo blocco `data`.

## 2. Perché questo evento

Oggi ricevete solo il lato positivo del funnel: appuntamento fissato, spostato,
esitato, deal assegnato, vinto, perso. Non ricevete niente sui lead che muoiono prima
dell'appuntamento — che sono la maggioranza del volume.

Senza la causale dello scarto, una campagna che porta persone senza budget e una che
porta numeri di telefono inesistenti producono lo stesso sintomo ("pochi
appuntamenti") pur richiedendo interventi opposti: la prima si aggiusta col targeting,
la seconda col form di raccolta.

`lead.rejected` porta la causale che l'operatore ha selezionato a mano durante la
chiamata.

## 3. Il payload

```json
{
  "eventId": "3f2a91c4-8b7e-4d1a-9f03-6c2e8a4b1d55",
  "eventType": "lead.rejected",
  "occurredAt": "2026-08-24T13:12:00.000Z",
  "apiVersion": "1",
  "lead": {
    "id": "7dc11a19-5776-458e-ab57-6a65380611a7",
    "name": "Mario Rossi",
    "email": "mario.rossi@example.com",
    "phone": "+393331234567",
    "funnel": "Black Summer",
    "source": "activecampaign",
    "createdAt": "2026-08-20T09:14:00.000Z",
    "utm": {
      "source": "facebook",
      "medium": "cpc",
      "campaign": "bs-agosto-freddo",
      "content": "video-3",
      "term": null
    }
  },
  "data": {
    "stage": "GDO",
    "automatic": false,
    "reasonCode": "NO_BUDGET",
    "reasonLabel": "Non ha soldi",
    "rawReason": "non ha soldi",
    "callCount": 2,
    "byBot": false,
    "rejectedAt": "2026-08-24T13:12:00.000Z",
    "rejectedBy": {
      "userId": "a3b7d9da-94b7-4c48-983f-ee42e949c4e5",
      "displayName": "GDO 106",
      "role": "GDO"
    }
  }
}
```

Il blocco `lead` è **byte per byte lo stesso** degli altri sei eventi: stessa
anagrafica, stessi UTM. Se avete già una tabella o un modello per quel blocco,
riusatelo senza modifiche.

### Campi di `data`

| Campo | Tipo | Significato |
|---|---|---|
| `stage` | `"GDO"` \| `"CONFERME"` | Dove è morto il lead. `GDO` = non ha mai voluto l'appuntamento. `CONFERME` = l'appuntamento c'era ed è saltato prima di svolgersi. |
| `automatic` | boolean | `true` **solo** per lo scarto automatico dopo il terzo (o, sul recupero GDO, quarto) tentativo a vuoto. Vedi §5. |
| `reasonCode` | string | Codice stabile. Raggruppate su questo. Tabella al §4. |
| `reasonLabel` | string | Etichetta leggibile in italiano, per le UI. **Non raggruppate su questa.** |
| `rawReason` | string \| null | La stringa esatta a database. Solo per audit e per recuperare il dato quando `reasonCode` è `OTHER`. |
| `callCount` | integer | Quante chiamate **GDO** ha ricevuto il lead prima di essere scartato — non conta i tentativi delle Conferme. Su uno scarto `stage: "CONFERME"` può quindi essere basso (anche 0, se il GDO ha fissato al primo colpo) e non riflette quanti tentativi ha fatto l'operatore Conferme prima di scartare. |
| `byBot` | boolean | `true` se a scartare è stato il nostro bot automatico invece di un operatore umano. Vedi §6. |
| `rejectedAt` | ISO 8601 UTC | Istante dello scarto. Coincide con `occurredAt`. |
| `rejectedBy` | oggetto \| null | L'operatore la cui chiamata ha innescato lo scarto — **anche quando `automatic` è `true`**: è il GDO/operatore Conferme che stava chiamando quando è scattato il limite di tentativi, non un utente di sistema. Vale `null` solo se non c'è nessun attore associato all'azione (raro). **Non usatelo per distinguere scarti automatici da manuali: quel campo è `automatic`.** |

## 4. I codici causale

Raggruppate **sempre** su `reasonCode`, mai su `reasonLabel` o `rawReason`: le
etichette sono testo di UI e possono cambiare, i codici no.

| `reasonCode` | Etichetta tipica | Emesso da |
|---|---|---|
| `NO_BUDGET` | non ha soldi | GDO, Conferme |
| `NOT_INTERESTED` | non interessato | GDO, Conferme |
| `UNEMPLOYED` | disoccupato | GDO, Conferme |
| `FOREIGN` | straniero | GDO, Conferme |
| `INFO_ONLY` | solo informazioni | GDO, Conferme |
| `REFUSED_APPOINTMENT` | non vuole prendere l'appuntamento | GDO, Conferme |
| `INVALID_NUMBER` | numero inesistente | GDO, Conferme |
| `NO_DECISION_POWER` | non ha potere decisionale | GDO, Conferme |
| `UNREACHABLE` | irreperibile (3 o 4 tentativi vuoti) / 3 NR consecutivi | automatico |
| `NO_ANSWER` | non risponde | Conferme |
| `POSTPONED_NO_DATE` | posticipa senza data | Conferme |
| `HUNG_UP` | attaccato in faccia | Conferme |
| `OTHER` | *(varia)* | fallback |

**Trattate `OTHER` come valore atteso, non come errore.** Significa che un operatore ha
usato una causale che non abbiamo ancora mappato; `rawReason` contiene il testo
originale. Non fate fallire la richiesta: persistete e basta. Se vedete `OTHER`
comparire con frequenza, segnalatecelo e aggiungiamo il codice.

Non assumete che la lista sia chiusa: aggiungeremo codici nel tempo. Il vostro handler
non deve rifiutare un `reasonCode` sconosciuto.

⚠️ **Sugli eventi con `byBot: true`, aspettatevi `OTHER` come maggioranza, non come
eccezione.** Misurato sugli ultimi 90 giorni in produzione: gli scarti degli operatori
umani sono mappati al 100% (17.806 su 17.806), quelli del bot solo al 24% (260 su
1.074). Il fornitore del bot manda frasi libere invece di causali da lista — cose come
*"lead ha risposto NO esplicitamente, non interessato"* o *"non ha disponibilità
economica al momento"* — che il nostro mapper non riconosce. `rawReason` porta la frase
originale integra, quindi il dato non è perso, solo non categorizzato. Non è un bucket
che cresce e basta: stiamo lavorando col fornitore del bot per fargli mandare causali
canoniche, ma finché non succede è normale vedere `OTHER` dominare quel sottoinsieme.
Non trattatelo come un mapping da completare a breve dalla nostra parte — è un problema
a monte, dal lato del bot.

## 5. `automatic`: lo scarto a tre tentativi

Quando un lead non risponde per tre (o quattro, vedi §4) chiamate consecutive, il CRM
lo scarta da solo con `reasonCode: "UNREACHABLE"` e `automatic: true`.

**`rejectedBy` non è `null` in questo caso.** Porta comunque l'operatore che stava
chiamando quando è scattato l'auto-scarto — sapere chi era al telefono in quel momento
è un dato utile, e toglierlo non renderebbe l'evento più "automatico" di quanto già non
dica `automatic: true`. **Per separare gli scarti di sistema da quelli decisi a mano,
guardate `automatic`, non `rejectedBy`.**

**Questo non è un giudizio sulla qualità del lead.** È irreperibilità: il numero può
essere ottimo e la persona semplicemente non ha risposto. Quando misurate la qualità di
una campagna, tenetelo separato dagli scarti qualitativi — altrimenti una campagna che
gira in orari sbagliati sembra una campagna che porta lead scadenti.

Il consiglio è di esporlo come categoria a sé nei vostri report, non dentro il
calderone degli scarti.

## 6. `byBot`: il fissatore automatico

Una parte del volume viene lavorata da un bot di messaggistica invece che da un
operatore al telefono. Quando è lui a scartare, `byBot` è `true` e `rejectedBy` punta
all'utenza di servizio del bot.

Non è un dato da nascondere — quei lead sono reali e le loro causali sono valide — ma
va reso **filtrabile**, perché il bot ha un tasso di scarto strutturalmente diverso da
quello umano e mescolarli sposta le medie.

Ricordatevi anche che su questo sottoinsieme `reasonCode` è quasi sempre `OTHER`: vedi
il riquadro nel §4.

## 7. ⚠️ Doppio conteggio: leggete questo

Gli scarti con `stage: "CONFERME"` vi arrivano **anche** dentro l'evento
`appointment.outcome` che già ricevete, che porta un proprio campo `discardReason`.

Manteniamo `appointment.outcome` invariato per retrocompatibilità: resta l'evento del
ciclo di vita dell'appuntamento.

**Conseguenza operativa: contate gli scarti solo da `lead.rejected`.** Se sommate le
due fonti, i numeri delle Conferme raddoppiano. Se avete già report che contano gli
scarti da `appointment.outcome`, vanno migrati o esclusi.

## 8. Annullamento di uno scarto: nessun evento di rettifica

Un lead scartato può essere riaperto internamente (un operatore si accorge che lo
scarto era un errore, o arriva un nuovo motivo per ricontattarlo) e tornare in lavoro.
**Oggi questo annullamento non genera alcun evento verso di voi.** Non c'è un
`lead.rejected` con segno opposto, né altro evento che dica "in realtà questo lead non
era morto". L'unico segnale che ricevete resta lo scarto originale che vi è già
arrivato.

Sono numeri piccoli rispetto al volume totale, ma se costruite logiche che presumono
"uno scarto è definitivo" su questi lead specifici troverete un disallineamento — è per
design, non un bug da segnalarci.

## 9. Volumi attesi

Ordine di grandezza per dimensionare: qualche centinaio di eventi al giorno nei periodi
di picco, con code più fitte nelle fasce di lavoro dei call center (13:30–20:00 ora
italiana). Sono significativamente più numerosi degli `appointment.set`, perché gli
scarti sono la maggioranza degli esiti.

Nessun burst da backfill: **non invieremo storico**, gli eventi partono dal go-live in
avanti.

## 10. Checklist di accettazione

Il receiver è pronto quando:

1. Accetta `eventType: "lead.rejected"` e risponde **2xx**
2. Verifica la firma HMAC come già fa per gli altri eventi
3. Deduplica su `X-CRM-Event-Id`
4. Persiste tutti i campi di `data`, `rawReason` compreso
5. Non fallisce su un `reasonCode` sconosciuto (`OTHER` incluso)
6. Non fallisce se `rejectedBy` è `null`
7. Non conteggia due volte gli scarti Conferme (vedi §7)

Quando questi sette punti passano, ditecelo e attiviamo l'invio dal nostro lato.

## 11. Test

Non esiste un endpoint di test separato né un secret di test dedicato: c'è **un solo**
URL configurato lato nostro (`MARKETING_WEBHOOK_URL_PROD`) e **un solo** secret
(`MARKETING_WEBHOOK_SECRET`), condiviso da tutti e sette gli eventi. Non c'è un
`WEBHOOK_SECRET_CRM_TEST` né un dominio `crm-fenice-test`: se li avete letti in una
versione precedente di questo documento, ignorateli.

Ecco come possiamo davvero fare una prova insieme:

1. **Ci date un URL** (il vostro receiver vero, o una sua copia di staging) e
   confermate che sta a sentire con lo stesso `MARKETING_WEBHOOK_SECRET` che avete già.
2. **Puntiamo temporaneamente** `MARKETING_WEBHOOK_URL_PROD` su quell'URL (è una env
   var su Vercel, cambiarla non richiede deploy di codice).
3. **Spariamo un evento reale a comando** con un tool di debug interno
   (`POST /api/marketing/debug/send-test`, riservato a Manager/Admin del CRM): gli
   passiamo `eventType: "lead.rejected"` e l'id di un lead vero, e opzionalmente lo
   stage/`automatic`/`byBot` che vogliamo simulare. Parte un evento firmato identico a
   quello che ricevereste in produzione, così potete verificare parsing, firma e
   persistenza senza aspettare un vero scarto.
4. Quando confermate che è arrivato ed è stato salvato correttamente, **ripuntiamo
   l'URL sul vostro receiver di produzione** e accendiamo `MARKETING_WEBHOOK_ENABLED`
   per il traffico reale.

Fateci sapere quando siete pronti per il passo 1 e organizziamo la prova.
