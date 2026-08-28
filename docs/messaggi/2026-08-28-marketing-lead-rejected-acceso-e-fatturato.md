# Marketing — `lead.rejected` è acceso, e quattro importi da correggere

Destinatario: chi lavora sul receiver del CRM marketing.
Data: 28/08/2026.

---

## `lead.rejected` è in produzione

Acceso oggi alle 13:15. Nessun backfill: partono dagli scarti di adesso in avanti,
come da §9.

I primi eventi sono già passati, tutti **200**:

| causale grezza | reasonCode | fase | automatico |
|---|---|---|---|
| non vuole prendere l'appuntamento | `REFUSED_APPOINTMENT` | CONFERME | no |
| non interessato | `NOT_INTERESTED` | CONFERME | no |
| numero inesistente | `INVALID_NUMBER` | GDO | no |

Se dalla vostra parte `crm_lead_rejections` li ha, siamo allineati e da qui in poi
il flusso è suo.

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
mancato. Non è urgente: in entrambi i casi resta ritentabile, e la dedup su
`X-CRM-Event-Id` copre lo scenario in cui avete persistito e noi abbiamo comunque
abbandonato.

---

## Il fatturato di agosto

Sì, il vostro fatturato di agosto era disallineato dal nostro. Guardiamo solo
agosto: sul passato non torniamo.

**Quattro trattative ve le abbiamo appena rimandate noi** — erano chiuse da voi
come perse e in realtà sono vendite. Sono partite oggi come `deal.closed_won`
normali, non serve che facciate niente:

| lead | esito | importo |
|---|---|---|
| Nicola Franzoni | 01/08 | 1.390 € |
| Federica Zamattia | 04/08 | 300 € |
| Deborah Salmaso | 10/08 | 1.390 € |
| Fabio (ORG) | 22/08 | 2.890 € |

Totale: **5.970 € di vendite che avevate come perse.**

**Quattro importi invece ve li passiamo a mano**, perché su questi la vendita ce
l'avete già e ci serve che venga *corretta*, non aggiunta:

| lead | avete | è | delta |
|---|---|---|---|
| Monica Debandi | 3.154 € | **3.190 €** | +36 |
| Krittanai | 3.489 € | **3.490 €** | +1 |
| Gabriele | 2.865 € | **2.890 €** | +25 |
| Kaur Jit | 2.862 € | **2.890 €** | +28 |

Novanta euro in tutto: valgono per la quadratura, non per il ROAS. Se preferite
riceverli come evento invece che correggerli a mano, ci basta sapere una cosa:
**un secondo `deal.closed_won` sullo stesso `lead.id` da voi sovrascrive la
trattativa o aggiunge una riga?** Se sovrascrive ve li mandiamo e chiudiamo così.
Se aggiunge no, perché raddoppierebbe quei quattro invece di correggerli.

### Perché era successo

`deal.closed_won` e `deal.closed_lost` partono dal salvataggio dell'esito da parte
del venditore. Quando una chiusura viene corretta **fuori da lì** — nel nostro caso
la riconciliazione col Database Clienti di fine agosto — voi restate fermi
all'ultimo valore che vi abbiamo mandato, e nessuno se ne accorge. Non è mai stato
un problema di trasporto: gli eventi mandati vi sono arrivati tutti.

Adesso abbiamo lo strumento che trova queste divergenze e le rispedisce, e lo
passiamo dopo ogni riconciliazione. Quindi da settembre in poi non dovrebbe più
succedere.
