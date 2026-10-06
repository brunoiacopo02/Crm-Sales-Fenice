# Mario vocale: webhook attivo e contesto per fissare

## 1. Il webhook dell'agenda

**URL:** `https://crm-sales-fenice.vercel.app/api/webhooks/mario-agenda`
**Segreto (`X-Mario-Segreto`):** te lo mando a parte.

Usiamo il tuo formato (`webhook-agenda.md`, versione 1) senza modifiche. Ecco cosa succede quando arriva:

1. Cerchiamo il lead nel CRM per telefono (ultime 10 cifre). Se più lead hanno lo stesso numero, vince quello della coda IA vocale, cioè quelli dell'Excel.
2. Il lead va al **GDO 108** ed è segnato **APPUNTAMENTO** all'ora di `appuntamento.inizio`. In nota mettiamo `[Mario vocale]` più il `riassunto`. Da lì lo prendono in carico le Conferme e poi il venditore, come ogni altro appuntamento.
3. Il nostro bot WhatsApp manda al lead l'**agenda** dal numero 3199. Alla sua prima risposta manda il **video**, scelto da `lavora` e `figli_a_carico` (solo `"sì"` vale sì; `n.d.` e `null` valgono no).

**Risposte**

| HTTP | Corpo | Significato | Ritentare? |
|---|---|---|---|
| 200 | `{ ok: true, agenda: "consegnato" \| "inviato" }` | Appuntamento registrato e agenda partita | No |
| 200 | `{ ok: true, duplicato: true }` | `id_invio` già visto | No |
| 200 | `{ ok: false, motivo: "lead_non_trovato" }` | Il numero non è nel nostro CRM | No |
| 200 | `{ ok: false, motivo: "gia_appuntamento" }` | Il lead ha già un appuntamento (anche fissato da altri): non lo sovrascriviamo | No |
| 200 | `{ ok: false, error: "appuntamento_passato" }` | Appuntamento già passato | No |
| 400 | `{ ok: false, error: ... }` | Corpo non valido (es. `data_senza_offset`, `versione_ignota`) | Inutile |
| 401 | | Segreto mancante o sbagliato | Inutile |
| 409 / 500 / 502 | | Errore temporaneo (agenda non partita, conflitto) | Sì, con lo stesso `id_invio`: l'appuntamento non si duplica, riparte solo l'agenda |

Uno **spostamento** con un nuovo `id_invio` su un lead già in appuntamento oggi risponde `gia_appuntamento`. Se ti serve gestire gli spostamenti, va concordato a parte.

## 2. I lead che chiami

I lead dell'Excel **non sono partecipanti del webinar**. Sono lead nuovi (funnel Corso 10 ore, Job Simulator, Telegram…) a cui il nostro bot WhatsApp ha scritto senza riuscire a fissare, e che i GDO non riescono ad assorbire (massimo 20 ridati a testa al giorno).

## 3. Come funziona il lancio "Web Developer AI"

- **Che cos'è:** una live gratuita su Zoom di lunedì 5 ottobre alle 21:00, di circa 90 minuti, sul percorso Web Developer con l'IA. Docente: Leonardo Zanarella, web developer nel settore bancario. Il percorso dura 632 ore in tutto: 9 mesi di teoria, 4 settimane di progetti pratici e 2 mesi di stage. Si imparano HTML, CSS, JavaScript, PHP, SQL, Git, le API e l'IA applicata al web.
- **Dopo la live:** chi era interessato ha premuto un pulsante. Una parte è stata chiamata subito da un venditore, gli altri hanno fissato una call. Chi non ha visto la live riceve su WhatsApp la registrazione / il video dell'offerta (`lp.feniceacademy.it/vsl-offerta`). Il follow-up WhatsApp ai partecipanti va avanti fino al 9/10.
- **L'appuntamento** è sempre una **videocall di 30-40 minuti con un consulente/venditore**. Prima, le Conferme (Noemi) fanno una breve telefonata di 5-10 minuti per confermare la presenza. Non è un'alternativa alla videocall.
- **Prezzi:** nel lancio il bot **non dice mai cifre**, nemmeno indicative: «te lo spiega il consulente nella call». Vale anche per i pacchetti (Advance / Gold / Exclusive) e per le rate.
- **Tono:** la call serve a chiarire gli ultimi dubbi e a iscriversi. Mai «vediamo se ti convince».

## 4. Regole per un appuntamento che regge da noi

- **Giorno:** domani o dopodomani. Mai oggi, mai di domenica.
- **Orario:** tra le 9 e le 20, a ora piena (lo fai già).
- **Data:** sempre con lo scarto di fuso (`+02:00` / `+01:00`). Senza scarto rispondiamo 400.
- **Riassunto:** più è concreto (che lavoro fa, cosa vuole cambiare, l'obiezione principale), più è utile a Conferme e venditore.
