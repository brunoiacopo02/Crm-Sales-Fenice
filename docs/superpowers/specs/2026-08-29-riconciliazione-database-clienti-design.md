# Riconciliazione CRM ↔ Database Clienti

**Data:** 2026-08-29
**Stato:** design approvato, infrastruttura predisposta, implementazione da pianificare

## Il problema

Il fatturato del CRM non coincide con la lista contratti del PO, e a ogni chiusura di mese
qualcuno riallinea i contratti a mano via SQL. È successo il 18/07, il 22/07, il 25/07 e il
26/08. Ogni giro costa ore, produce un file di rollback che vive solo nello scratchpad di
sessione, e non lascia traccia consultabile.

La fonte di verità del fatturato è il Google Sheet **"Pannello - Sales Manager"**
(`1viEdIATN2bcJg9JW4OTzcM51d45j4ROCrtF7wgdEg5k`, owner `feniceacademy00@gmail.com`),
tab **`Database Clienti`**.

## Decisioni prese col PO (2026-08-29)

1. **Il pulsante diagnostica e applica ciò che l'admin spunta.** Non applica in automatico,
   non si limita a segnalare.
2. **Contratto su lead scartato** → la chiusura è attribuita al **funnel che il lead ha già
   nel CRM**. Non si inventa un'origine.
3. **Su quel lead si scrive solo chiusura e importo.** Nessun appuntamento, conferma o
   presenza ricostruiti a posteriori: i tassi di GDO e Conferme devono restare quelli veri.
4. **Contratto senza alcun lead** → si crea un lead minimo con funnel `FUORI FUNNEL`,
   così il totale quadra e l'origine resta distinguibile nelle statistiche.
5. **Accesso al foglio via service account**, con caricamento manuale come riserva. La
   riserva è un **CSV** (esportazione del singolo tab), non un XLSX: evita di aggiungere una
   dipendenza di parsing e riusa lo stesso normalizzatore del percorso automatico.
6. **Mappatura TUTOR → venditore confermata dal PO:** 001 = Bruno B., 002 = Marco L.,
   003 = Mattia G., 004 = Paolo S., 008 = Giacomo O., 010 = Stefania C.
   **La colonna K contiene nomi, non codici** (`Paolo S.`, `Giacomo O.`, …), e contiene anche
   **cinque valori fuori mappatura**: `Matteo D.` (17 contratti), `Matteo Q.` (10),
   `Amministrazione` (2), `Altro` (1), `Alberto C.` (1) — 31 contratti in tutto. Il motore
   non li indovina: li mostra come "venditore non mappato" e si rifiuta di applicarli finché
   il PO non dice a chi corrispondono.

## Architettura

### Sorgente dati

Lettura via Google Sheets API con service account (vedi *Infrastruttura*), range
`Database Clienti!A:K`. Colonne: A=cf, B=mail, C=num, D=nome, E=cognome,
F=FIRMA CONTRATTO, G=Stato di Pagamento, H=Valori contratti, I=Entrate, J=ancora da saldare,
K=TUTOR.

**Il tab è un `IMPORTRANGE`** da `1fobgWcPAuxP82nGLw9YG2KxvD7pUSqyG1dO_nM-KdTg`,
tab `Pacchetto_Bruno!A:AP`. L'API restituisce i valori già calcolati, quindi la lettura
funziona; ma se l'IMPORTRANGE si rompe (permesso revocato sulla sorgente) le celle
diventano `#REF!` e il foglio sembrerebbe **vuoto**. Il motore deve quindi **rifiutarsi di
riconciliare** quando trova `#REF!` o zero righe, invece di concludere che il CRM ha
contratti di troppo e proporne la cancellazione. È il fallimento più pericoloso del sistema.

Il service account **non** ha accesso al file sorgente: se un domani lo si condivide,
leggerlo direttamente elimina questa fragilità e dà 42 colonne invece di 11.

### Motore di matching (funzione pura)

Prende le righe del foglio e quelle del CRM, restituisce il diff. Nessun accesso a db o rete,
quindi testabile sui casi storici reali.

- match per **telefono normalizzato** (`normalizePhoneStrict`, `src/lib/phoneNormalize.ts`),
  **fallback sulla mail** quando il telefono non aggancia;
- aggregazione per **telefono + mese**, mai per solo telefono: le rifirme (Busonera, Carollo,
  Mazzola, Manoli) risulterebbero errori di importo;
- **righe multiple dello stesso mese si sommano** (Dell'Aglio 800 + 729 = un contratto);
- filtro foglio: `FIRMA CONTRATTO` nel mese, **escluso solo `Stand-by`**
  (`Recupero`, `Avvocato`, `Sollecito` contano);
- confronto solo su `companyId = 'fenice'`: il foglio non contiene Serenamente;
- lato CRM si leggono **sia `leads` sia `salesAttempts`**, che devono dare lo stesso totale.

### Le quattro famiglie

| | Cosa trova | Cosa scrive | Spuntata di default |
|---|---|---|---|
| 1 | Lead regolare con esito sbagliato | esito `Chiuso`, importo, data, venditore | sì |
| 2a | Contratto su lead **scartato** | solo chiusura e importo, funnel invariato | no |
| 2b | Contratto **senza lead** | crea lead minimo, funnel `FUORI FUNNEL` | no |
| 3 | Importo divergente | allinea al foglio; sotto €2 etichettato "arrotondamento" | sì |
| 4 | Chiuso nel CRM ma **assente dal foglio o Stand-by** | propone `Non chiuso` | mai |

La famiglia 4 è la direzione inversa: è quella che nel 2026-07 aveva individuato Bryan Wu e
Salvatore Di Maggio. Togliendo fatturato, resta sempre da spuntare a mano.

### Scritture e invariante

Le scritture su `salesAttempts` **devono passare da `resolveAttemptWrite`**
(`src/lib/venditorePerformance/guard.ts`), che garantisce *un solo `Chiuso` per ciclo*.
Una scrittura diretta reintrodurrebbe il doppio conteggio del fatturato risolto a luglio
(commit `12eed7e`). Ogni salvataggio logga in `events` come già fa il flusso normale.

### Reversibilità

Ogni applicazione crea una riga di storico con lo **stato precedente di ogni campo toccato**,
così "Annulla" ripristina senza SQL a mano. Sostituisce i `rollback_*.sql` di sessione.
Richiede una migrazione scritta a mano (`drizzle-kit generate` non è utilizzabile su questo
progetto).

### Interfaccia

Pagina `/riconciliazione`, solo admin. Selettore mese → **Confronta** → anteprima per
famiglia con checkbox → **Applica** → storico delle applicazioni con "Annulla".

## Infrastruttura predisposta il 2026-08-29

- **Service account** `crm-riconciliazione@crm-calendar-sales-fenice.iam.gserviceaccount.com`
  creato nel progetto Google Cloud `crm-calendar-sales-fenice` (lo stesso del Calendar).
  Nessun ruolo IAM: l'accesso arriva solo dalla condivisione del foglio.
- **Google Sheets API** abilitata sul progetto.
- **Foglio condiviso** col service account come *Visualizzatore*. Lettura verificata:
  21 tab, 3.723 righe in `Database Clienti`.
- **Variabili** `GOOGLE_SHEETS_SA_EMAIL` e `GOOGLE_SHEETS_SA_PRIVATE_KEY` su Vercel
  (production, preview, development) e in `.env.local`. La chiave privata è salvata con
  **a capo reali**, non con `\n` letterali: il codice deve applicare
  `.replace(/\\n/g, '\n')`, che è innocuo su entrambi i formati.
- Il file JSON scaricato dalla console è stato cancellato dal disco.

**Da verificare al primo deploy di preview:** che Vercel abbia conservato la chiave
multi-riga integra e non troncata al primo a capo.

## Test

Il motore va testato sui casi storici documentati, che sono già la sua specifica:
le rifirme in mesi diversi, Dell'Aglio spezzato su due righe, il telefono di Ludovici
sbagliato di una cifra, il doppione Ligozzi, gli arrotondamenti 2079→2080, gli stand-by
di Wu e Di Maggio, e i tre falsi positivi risolti dalla mail (Ierna, Mauro, Angulo).

Test di non-regressione gratuito: **giugno, luglio e agosto sono già stati quadrati a mano**,
quindi sui mesi già bonificati il motore deve produrre zero differenze. Se ne produce, sbaglia lui.

Serve anche un test esplicito sul caso `#REF!` / foglio vuoto: deve alzare un errore, mai
proporre correzioni.

## Fuori scope

- Scrivere sul foglio: la riconciliazione è a senso unico, dal foglio al CRM.
- Riconciliare Serenamente: il foglio non la contiene.
- Automatizzare l'esecuzione (cron): l'applicazione resta un gesto umano.

## Primo giro utile

**Aprile e maggio 2026**: ~29 contratti per €64k mai riportati nel CRM, quasi tutti su lead
`REJECTED` dei funnel ORG e Database. È il buco più grosso rimasto e il banco di prova della
famiglia 2.
