# Marketing — `lead.rejected` è acceso, e una cosa sul fatturato

Destinatario: chi lavora sul receiver del CRM marketing.
Data: 28/08/2026.

---

## `lead.rejected` è in produzione

Acceso oggi alle 13:15. Nessun backfill: partono dagli scarti di adesso in avanti,
come da §9.

I primi tre eventi sono già passati, tutti **200**:

| causale grezza | reasonCode | fase | automatico |
|---|---|---|---|
| non vuole prendere l'appuntamento | `REFUSED_APPOINTMENT` | CONFERME | no |
| non interessato | `NOT_INTERESTED` | CONFERME | no |
| numero inesistente | `INVALID_NUMBER` | GDO | no |

Se dalla vostra parte `crm_lead_rejections` li ha, siamo allineati e non serve altro.

---

## Le tre cose del contratto

### 1. Lead riaperto e riscartato → sì, arriva un secondo `lead.rejected`

La vostra assunzione è giusta, e la chiave su `event_id` è quella corretta.

L'`eventId` è deterministico su `eventType | leadId | bucket`, e per `lead.rejected`
il bucket è **il secondo** di `occurredAt`, non il giorno: due scarti dello stesso
lead in momenti diversi hanno id diversi e passano entrambi. Il bucket giornaliero
lo usa solo `appointment.set`, apposta, perché gli operatori rifissano lo stesso
appuntamento anche cinque volte di fila e non volevamo mandarvi quel rumore.

Una precisazione che vi conviene avere, perché riguarda eventi che **non** arrivano:
non ogni riscarto genera un evento. Emettiamo solo quando lo scarto è una notizia —
il lead non era già scartato, **oppure** lo era ma **con una causale diversa**.

- Caso che passa: lead auto-scartato al 3° "non risponde", ripreso dal GDO alla
  quarta chiamata ed esitato "non ha soldi" → secondo `lead.rejected`, con la
  causale vera. È il caso interessante per voi, ed è protetto apposta.
- Caso che sopprimiamo: stesso lead, stessa identica causale, mandata di nuovo.
  Serve a non farvi arrivare doppioni dal bot, che a volte ri-spara lo stesso esito.

La riapertura in sé resta senza evento, come da §8.

### 2. Header vs corpo: fate bene, e non possono divergere

`X-CRM-Event-Type` e il campo `eventType` del corpo escono dallo stesso oggetto —
l'header è `envelope.eventType`, il body è la serializzazione di quello stesso
envelope. Il caso "divergono" non è raggiungibile dal nostro lato.

Prendere il tipo dal corpo e usare l'header solo per etichettare un corpo
illeggibile è l'uso giusto: è l'unico dei due che sopravvive a un JSON che non
riuscite a parsare.

### 3. `maxDuration` 10s: funziona, ma conviene non tenerli uguali

Il ragionamento è corretto: se sforate, il 504 per noi è ritentabile, quindi il
comportamento finale è quello giusto.

L'unico difetto di averli identici è diagnostico, non funzionale. Se scattano
insieme noi logghiamo `timeout_10s` con `httpStatus: null` e voi un 504, e nessuno
dei due log dice chi ha ceduto per primo. **Scendendo a 8 secondi** la corsa la
vincete sempre voi e il vostro 504 diventa la spiegazione univoca dell'evento
mancato. In entrambi i casi la dedup su `X-CRM-Event-Id` copre lo scenario in cui
avete persistito e noi abbiamo comunque abbandonato.

---

## L'altra cosa: il fatturato aggiornato non vi è arrivato

Confermato, e abbiamo misurato quanto vale. **Il vostro fatturato è più basso del
nostro di 53.749 €**, distribuiti su 61 trattative da aprile a oggi.

| | trattative | effetto sul vostro fatturato |
|---|---|---|
| Chiusure mai inviate | 25 | mancano 44.446 € |
| Importo corretto dopo l'invio | 26 | ne contate ~50 € in più in totale, ma 4 casi singoli valgono centinaia di euro |
| Esito cambiato dopo l'invio | 10 | 7 vendite da 9.355 € vi risultano perse, e 6.100 € vi risultano venduti ma non lo sono più |

### Perché succede

`deal.closed_won` e `deal.closed_lost` partono dal salvataggio dell'esito da parte
del venditore. Ogni volta che una chiusura viene scritta o corretta **fuori da lì**
— import storici, bonifiche, la riconciliazione col nostro Database Clienti del
26/08 — voi restate fermi all'ultimo valore che vi abbiamo mandato. Non è un guasto
del trasporto: gli eventi che vi abbiamo mandato li avete ricevuti tutti. È che
dopo abbiamo cambiato i dati senza dirvelo.

I casi grossi, per darvi la misura: Ornella 1.529 → 1.000, Alessandra 800 → 1.529,
Achille Cannito 2.890 → 2.079, Nicola 2.079 → 2.890.

### Come ve li diamo — decidete voi

**Opzione A, ve li prendete voi (nessun lavoro da parte nostra, nessun rischio).**
Avete già un endpoint di lettura, `GET /api/marketing/leads`, Bearer token
condiviso al go-live. Restituisce lo **stato corrente** dei lead, non lo storico
degli eventi, quindi per definizione è allineato:

```
GET https://<nostro-dominio>/api/marketing/leads?eventType=deal.closed_won&since=2026-04-01&limit=500
Authorization: Bearer <token>
```

Paginato con `cursor`/`nextCursor`. Stessa forma di envelope dei webhook, così il
vostro parser non cambia. Stesso giro con `eventType=deal.closed_lost` per gli
esiti che sono cambiati in negativo. Se avete perso il token ve lo rimandiamo.

**Opzione B, ve li rispediamo come eventi.** Abbiamo lo strumento pronto: ricostruisce
i 61 envelope aggiornati e li rimette in coda. Ma prima ci serve una vostra
conferma, perché **gli eventi correttivi hanno un `eventId` nuovo** — nascono adesso,
quindi la vostra dedup non li scarta, ed è quello che vogliamo.

> **La domanda:** un secondo `deal.closed_won` sullo stesso `lead.id` da voi
> **sovrascrive** la trattativa o **aggiunge una riga**?

Se sovrascrive (upsert per lead), diteci solo di procedere e li mandiamo.

Se aggiunge una riga, non li mandiamo. Ventisei di questi lead una vendita ce
l'hanno già da voi, ed è quella con l'importo sbagliato: una seconda riga non la
corregge, la somma. Sono 62.435 € che diventerebbero 124.818 €, e il problema
diventerebbe più grosso di quello che stiamo risolvendo. In quel caso opzione A.

### Che succede d'ora in poi

La correzione a mano di dati già inviati resta un buco strutturale: finché la
riconciliazione col foglio la facciamo direttamente sul database, gli eventi non
ripartono da soli. Da oggi lo strumento di riallineamento è in repo e lo passiamo
dopo ogni bonifica, così lo scarto lo trovate voi già chiuso invece di scoprirlo
mesi dopo. Se preferite, possiamo farlo diventare una consegna periodica —
ditecelo e la mettiamo a cadenza fissa.
