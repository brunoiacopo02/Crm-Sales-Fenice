# Lead che avevano detto sì e che nessuno ha richiamato

*Estratti il 29/08/2026 dal DB di produzione. Sono lead restituiti dal bot in
agosto con una nota che dice che avevano confermato o stavano compilando il form,
e che oggi sono ancora `NEW` con `callCount = 0`: nessuno li ha mai chiamati.*

Sono già tutti assegnati a un GDO. Il problema non è l'assegnazione: è che sono
rientrati dal bot e nessuno li ha presi in mano.

## Priorità 1 — il form li ha bloccati (6)

Queste sei persone **hanno provato a prenotare e non ci sono riuscite**. Non è
un "forse": lo dicono con parole loro. È il bug del form del fornitore, ed è il
recupero più facile che abbiamo perché il sì c'era già ed è documentato.

| Nome | Telefono | GDO | Rientrato | Parole sue |
|---|---|---|---|---|
| Sara | 348 564 4350 | 114 | 23/08 16:03 | «Non mi fa scegliere martedì 18 agosto. Mi manda a 1 settembre» |
| Michele Calcagnile | 328 536 4416 | 109 | 21/08 20:03 | «Ho scritto una mail perché non mi dà il giorno 10 nemmeno ricaricando la pagina» |
| Nicola Calcinotto | 348 010 0130 | 114 | 21/08 19:02 | «Sto compilando il form ma esce solo martedì con orari la mattina» |
| Veronica Panait | 324 054 2664 | 109 | 24/08 10:03 | «Sempre il 17» (nota: problema tecnico con il form) |
| Maila Capitani | 339 392 4170 | 114 | 24/08 10:03 | — (nota: problema tecnico con il form) |
| Giulia Spizzico | 388 589 4036 | 114 | 25/08 01:06 | «Si esatto confermo mercoledì 19 alle 12» — il form non le faceva scegliere la data |

## Priorità 2 — avevano confermato la call (13)

| Nome | Telefono | GDO | Rientrato | Parole sue |
|---|---|---|---|---|
| Viola Davide | 371 350 1117 | 114 | 25/08 00:04 | «Noemi è l'unico nome dopo aver fatto invio.. come nello screenshot» (form inviato) |
| Rosalia Pineda | 351 489 0209 | 114 | 24/08 21:04 | «31 agosto» (data confermata, mancava l'ora) |
| Nino | 339 239 9031 | 114 | 25/08 02:04 | conferma del form di prenotazione |
| Margherita Pisciotta | 328 057 5361 | 117 | 25/08 02:03 | «Ok fissiamo la data di una call» |
| Anna Locanto | 328 486 2917 | 114 | 25/08 02:03 | «Mattina» (stava scegliendo l'orario) |
| Melissa Misdea | 351 909 9599 | 114 | 24/08 21:05 | «Eh che non so se riesco per le 12, per questo dicevo» (sceglieva fra 9 e 12) |
| Anna Alberghini | 349 550 5261 | 114 | 22/08 15:02 | «Sì» dopo la conferma della call |
| Fabio | 327 578 8289 | 114 | 25/08 00:05 | «Sì» dopo la conferma della call |
| Giusy Paragliola | 348 116 1100 | 114 | 24/08 23:04 | «21» |
| Jonathan Gaón | 348 987 4385 | 115 | 24/08 21:04 | «Ok» |
| Giovanna Quimi | 351 729 1101 | 114 | 24/08 20:04 | «Sì, normale non whatsapp, perché non prende bene per le telefonate» |
| Nicolas Zorzetto | 388 102 2470 | 109 | 24/08 14:03 | «Grazie mille» (dopo conferma video e preselezione) |
| Boscherini | 351 656 0522 | 114 | 24/08 10:02 | «Ok 🙏» (in attesa di confermare 18 o 19) |

## Priorità 3 — link mandato, conferma non arrivata (9)

Più deboli: il link c'era, il sì esplicito no.

| Nome | Telefono | GDO | Rientrato |
|---|---|---|---|
| Franco Sincinelli | 338 306 4241 | 114 | 23/08 14:02 |
| Maria Gina | 371 331 7699 | 114 | 23/08 18:02 |
| Emanuele | 333 147 6942 | 114 | 25/08 01:05 |
| Jorge Marquez | 389 316 8914 | 114 | 25/08 02:05 |
| Danilo Conte | 340 378 6097 | 119 | 26/08 17:03 |
| Francesco Attianese | 393 229 5936 | 117 | 29/08 13:02 |
| Leonardo | 347 877 4409 | 114 | 22/08 19:04 |
| Katia | 392 547 5594 | 114 | 23/08 13:03 |
| Giuseppina Barraco | 393 677 0250 | 109 | 23/08 09:03 |

## Il fatto da guardare, indipendente dai singoli lead

**19 di questi 28 sono assegnati a GDO 114**, gli altri sparsi fra 109 (4), 117
(2), 115 (1), 119 (1).

Non è una colpa: la restituzione dal bot passa dallo stesso round-robin dei lead
nuovi, e in quei giorni il turno è caduto lì. Ma il risultato è che una sola
persona si è ritrovata in pipeline diciannove lead che avevano già detto sì, e
non ne ha chiamato nessuno — probabilmente perché in pipeline arrivano
indistinguibili da qualunque altro lead nuovo.

**È un difetto di prodotto, non di persona.** Un lead che torna dal bot dopo
aver confermato un appuntamento non dovrebbe entrare in coda come un lead
freddo: dovrebbe essere marcato, e ordinato per primo. Il fornitore da oggi ci
manda un `CONTATTO_UMANO` con la nota «AVEVA CONFERMATO E L'APPUNTAMENTO NON
C'È» proprio per questo — quella segnalazione ora atterra nella coda
`/richieste-contatto`, ma vale la pena decidere se debba anche marcare la card
in pipeline.
