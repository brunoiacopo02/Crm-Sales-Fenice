# Richieste di contatto umano + correzioni contratto bot (v1.5)

Data: 2026-08-26 — branch `feat/richieste-contatto-umano`

## Il problema

53 lead hanno chiesto in chat di parlare con una persona. **Uno solo e' stato poi
chiamato da un umano**: 34 sono ancora aperti, 45 ancora parcheggiati sull'account
bot. Il canale esiste dal 05/08 (`CONTATTO_UMANO` -> evento `BOT_CONTACT_REQUEST` +
notifica agli admin) ma e' una campanella, non una coda: se nessuno la vede quando
suona, il lead resta fermo per sempre. Il piu' vecchio aspetta dal 27 luglio.

## Cosa si costruisce

### 1. Coda vera: tabella `botContactRequests`

Una riga per lead in attesa, non un evento in timeline. Gli eventi restano (audit),
la coda e' lo stato operativo.

Colonne: `id`, `leadId`, `companyId`, `category` (motivo normalizzato dal bot),
`reason` (le parole esatte del lead), `leadInfo` jsonb (contesto dal bot),
`updatesCount`, `status` (`pending`|`assigned`|`closed`), `assignedToId` (GDO scelto),
`assignedByUserId` (admin), `assignedAt`, `closedAt`, `closedByUserId`, `createdAt`,
`updatedAt`.

**Dedup**: il bot riemette l'esito a ogni messaggio del lead riformulando il motivo.
Se esiste gia' una riga `pending` per quel lead si aggiorna quella (motivo piu'
recente, `updatesCount++`), non se ne crea una seconda. Stessa filosofia della
soppressione notifiche a 24h gia' in produzione.

**Backfill**: le 53 richieste storiche entrano come `pending` (una per lead, il
motivo dell'ultimo evento). E' esattamente l'arretrato che il fornitore ci ha
chiesto di smaltire.

### 2. Contratto v1.5 — il bot manda motivo e contesto

Oggi `CONTATTO_UMANO` porta solo `note`. Si aggiungono, opzionali per
retrocompatibilita' ma richiesti dal contratto:
- `motivo`: categoria chiusa (7 valori) — sconosciuta -> `altro`, mai un 400
- `info`: `{ sintesi?, disponibilita?, telefonoPreferito?, urgenza?, argomenti?[] }`

### 3. Sezione admin `/richieste-contatto` (solo ADMIN)

Coda ordinata per attesa. Per ogni richiesta: nome, telefono, funnel, stato del lead,
categoria, **le parole esatte**, il contesto del bot, da quanto aspetta.

Bottone **Assegna a GDO**: si sceglie il GDO da una select e il lead gli viene dato,
con notifica immediata "chiamalo tu". Piu' un **Chiudi senza assegnare** per il rumore.

**Invariante KPI (non semplificare):** su un lead gia' `APPOINTMENT` o con
`presentedAt` valorizzato **non si tocca `assignedToId`**. Ogni metrica per-GDO di
questo codebase legge l'assegnatario ATTUALE: spostare un lead con storico fa
sparire presenze da cicli bonus gia' pagati e fatturato gia' riconciliato (stessa
ragione della guardia in `/api/bot/outcome`). In quel caso l'assegnazione produce
solo la notifica al GDO scelto — che puo' chiamare lo stesso dal drawer — e la
richiesta si chiude. La UI lo dice esplicitamente prima del click.

Su lead `REJECTED` l'assegnazione lo riapre come `NEW` (come fa gia' il ritorno dal
bot al pool umano).

### 4. Due correzioni di contratto chieste dal fornitore

- **RICHIAMO senza data certa.** Oggi la route pretende un ISO: quando il lead dice
  "ci risentiamo a settembre" il bot **inventa** un orario (22 RICHIAMO su 26 su ore
  tonde). Si accetta `periodo` (testo libero) al posto di `date`:
  `updateLeadOutcome` gia' regge `recallDate = null`, cambia solo la guardia.
- **Cambio data dell'appuntamento.** La guardia di idempotenza (10/07) scarta in
  silenzio un `APPUNTAMENTO` su lead gia' appuntato: se il bot manda una data
  **diversa** oggi la perdiamo. Ora una data diversa aggiorna `appointmentDate` e
  avvisa le Conferme, **senza** ritimbrare `appointmentCreatedAt` (un rifissaggio non
  e' un fissaggio nuovo: ritimbrarlo gonfierebbe "app fissati oggi"). Stessa data =
  dedup come oggi. Il `noteOnly` che ci hanno chiesto non serve.

## Fuori scope (decisioni tue, non fatte qui)

- Feed dei dati post-appuntamento verso il bot: proposta separata, sfrutta il fatto
  che CRM e bot stanno sullo stesso account Supabase/Vercel/GitHub.
- Chiusura automatica degli 873 lead "postino".
- I 127 esiti rifiutati con 403 da farsi rimandare come NOTA (lato loro).
