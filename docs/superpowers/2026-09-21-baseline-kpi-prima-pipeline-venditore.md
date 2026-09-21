# Fotografia dei KPI prima di accendere la pipeline autonoma venditore

Scattata il **21/09/2026**, prima che Sales 002 registrasse una sola chiamata dalla nuova
pipeline. Serve a una cosa sola: se dopo l'accensione un numero dei GDO si muove, qui c'e'
il confronto. E' l'unica verifica che non si puo' fare a posteriori.

Venditore del test: **Sales 002**, id `d1a616d7-b8d4-417d-a5b3-5e30a41b941e`, ruolo
`VENDITORE`, attivo, company `fenice`.

## Contatori che devono restare a zero

Se uno di questi diventa diverso da zero, il venditore e' entrato dove non doveva.

| Cosa | Valore al 21/09 |
|---|---|
| `callLogs` scritti da un utente di ruolo VENDITORE | **0** |
| Lead con appuntamento assegnati a un non-GDO | **0** |
| Achievement sbloccati da un utente VENDITORE | **0** |
| Lead con `confirmationsOutcome = 'autofissato'` | **0** |

I primi tre devono restare a zero **per sempre**: sono le tre porte da cui il venditore
sarebbe potuto entrare nei KPI dei GDO, e sono state chiuse. Il quarto sale appena Marco
fissa il suo primo appuntamento, ed e' l'unico che deve muoversi.

Nota: `callLogs` di ruolo VENDITORE resta a zero **anche dopo** l'accensione, nonostante
Marco scriva righe in quella tabella? **No** — questo e' il punto delicato. Marco scrive
`callLogs` con il suo `userId`. Quel contatore SALIRA'. Cio' che deve restare vero e' che
quelle righe non producano una riga "Performance GDO" col suo nome ne' entrino nei totali:
si verifica dal blocco sotto, non da questo contatore.

## Chiamate per utente, settembre 2026 (1-21)

| Chi | Ruolo | Chiamate |
|---|---|---|
| GDO 201 (bot) | GDO | 5.243 |
| GDO 112 | GDO | 3.023 |
| GDO 118 | GDO | 2.883 |
| GDO 106 | GDO | 2.234 |
| GDO 110 | GDO | 2.166 |
| GDO 115 | GDO | 1.930 |
| GDO 105 | GDO | 1.777 |
| GDO 119 | GDO | 1.330 |
| GDO 114 | GDO | 1.318 |
| GDO 107 | GDO | 393 |
| Admin Fenice | ADMIN | 1 |

Quella singola riga ADMIN e' storica e **deve restare**: i KPI la tengono per scelta
dichiarata nel codice. Se sparisce, un filtro e' stato stretto troppo.

## Appuntamenti per assegnatario, settembre 2026 (1-21)

| Chi | Ruolo | Appuntamenti |
|---|---|---|
| GDO 201 (bot) | GDO | 482 |
| GDO 106 | GDO | 128 |
| GDO 118 | GDO | 128 |
| GDO 114 | GDO | 82 |
| GDO 112 | GDO | 81 |
| GDO 119 | GDO | 79 |
| GDO 110 | GDO | 59 |
| GDO 105 | GDO | 54 |
| GDO 115 | GDO | 53 |
| GDO 107 | GDO | 12 |

Nessun assegnatario non-GDO. Dopo l'accensione questa tabella non deve guadagnare righe.

## Totali funnel, settembre 2026 (1-21)

| Stadio | Valore |
|---|---|
| Appuntamenti (`appointmentCreatedAt`) | 1.158 |
| Conferme (`confermato`) | 155 |
| Trattative (latch `presentedAt`) | 141 |
| Chiusure (`Chiuso`) | 50 |
| Fatturato | € 126.042 |

Dopo l'accensione: **Appuntamenti**, **Trattative**, **Chiusure** e **Fatturato** possono
salire, e la quota di Marco deve comparire nella colonna "di cui autofissati" del Pannello
Sales Manager. **Conferme no**: quel numero non deve muoversi per causa sua, mai.

## Come si rifa' il confronto

Le query che hanno prodotto questi numeri sono tre, tutte su
`callLogs`, `leads` e `userAchievements`, filtrate sul mese con le date italiane
(`2026-09-01 00:00+02` incluso, `2026-10-01 00:00+02` escluso). Rilanciarle a fine test e
mettere le due tabelle a fianco.
