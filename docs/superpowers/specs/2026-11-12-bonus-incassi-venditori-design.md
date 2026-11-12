# Bonus incassi del mese: a che punto è ogni venditore

Data: 2026-11-12 · Stato: proposta, da confermare dal PO prima della pubblicazione

## 1. Perché

Richiesta del PO (12/11/2026): «una visualizzazione per i sales dove possono vedere come
sono messi anche col bonus che gli abbiamo messo sugli incassi del mese stesso, quindi
qual è la percentuale di contratti che hanno firmato questo mese e su questi hanno anche
già pagato e quindi abbiamo incassato tutto».

Oggi il venditore vede in `/miei-incassi` la commissione 10/11/12%, ma non sa a che punto
è col bonus sugli incassi dello stesso mese, né chi deve sollecitare per arrivarci.

## 2. La regola (PO 02/11/2026)

Per venditore, sull'insieme dei contratti che ha firmato nel mese:

| Mese | Contratti pagati nel mese / firmati | Bonus |
|---|---|---|
| ottobre 2026 | ≥ 85% · ≥ 90% | +0,5% · +1% |
| da novembre 2026 | ≥ 80% · ≥ 85% · ≥ 90% | +0,5% · +1% · +1,5% |

Prima di ottobre 2026 il bonus non esisteva. Le soglie stanno in un'unica costante con
il mese di decorrenza (`BONUS_INCASSI_REGOLE`).

**Questa è solo una visualizzazione.** Non cambia il calcolo delle commissioni né gli
importi del guadagno già mostrati. Nel codice il bonus sugli incassi non era calcolato da
nessuna parte (solo il testo della pagina `/bonus`).

## 3. Dati e definizioni (verificate sui dati veri di ottobre e novembre 2026)

Fonte: copia oraria del gestionale (`gestionaleContratti`, `gestionaleIncassi`).

- **Firmato nel mese**: contratto non cancellato (`deletedAt` nullo), `dataFirma` nel mese
  (data senza ora: si confronta il prefisso `YYYY-MM`, nessun fuso), stato diverso da
  `Stand-by` (regola PO: stand-by = non chiuso). Il venditore è `salesUserId` del contratto.
- **Incassi che contano come pagamento del contratto**: le righe con `contaCommissione`
  vero (acconto, rata, saldo, rinnovo). Restano fuori l'euro del primo accesso, il costo
  della finanziaria (voce COMMISSIONE), materiale extra e abbonamenti, e le coppie
  incasso stornato + storno (il gestionale le marca entrambe "non conta").
- **Pagato per intero nel mese**: una delle due
  1. la somma dei pagamenti datati entro la fine del mese di firma è ≥ importo del contratto;
  2. lo stato è `Pagato`, c'è almeno un pagamento e nessun pagamento è datato dopo la
     fine del mese di firma.

Perché la (2): con una finanziaria (Sequra) l'azienda incassa meno dell'importo del
contratto (es. contratto 2.080 €, saldo incassato 1.774 €). Numeri veri al 12/11/2026:

| Firmati nel mese (stand-by esclusi) | ottobre | novembre 1-12 |
|---|---|---|
| Contratti firmati | 92 | 23 |
| Stato `Pagato` | 65 | 8 |
| di cui con incassi sotto l'importo (finanziati) | 9 | 1 |
| di cui col saldo datato il mese dopo | 7 | 0 |
| Solo regola 1 (incassi ≥ importo entro il mese) | 52 | 7 |
| **Pagati nel mese (regola 1 o 2)** | **58** | **8** |

La sola regola (1) lascerebbe i finanziati "non pagati" per sempre (6 a ottobre, 1 a
novembre). Lo stato da solo invece non ha data: 7 contratti di ottobre risultano `Pagato`
ma il saldo è arrivato a novembre, e non devono contare per ottobre. La data la danno
sempre gli incassi. Nessun contratto non `Pagato` risulta coperto dagli incassi.

Le rate (`gestionaleRate`) non si usano: metà dei contratti non ne ha e ci sono contratti
`Pagato` con la rata ancora "scaduta".

- **Percentuale** (quella che decide lo scaglione): contratti pagati / contratti firmati,
  sul numero. Confronto a interi (`pagati × 100 ≥ soglia × firmati`), niente arrotondamenti.
- **Percentuale in euro** (dato secondario): importo dei contratti pagati / importo dei firmati.
- **Mancano**: `ceil(soglia × firmati / 100) − pagati`, a firmati fermi.

## 4. Cosa si vede

- **Venditore** — `/miei-incassi`, card «Bonus incassi del mese» subito sotto «Il tuo
  guadagno del mese», segue il selettore del mese: percentuale grande, «X contratti pagati
  su Y firmati», barra con le soglie segnate, frase «ti mancano N contratti pagati per il
  +0,5%» (o scaglione raggiunto), elenco dei contratti del mese non ancora saldati
  (cliente, firma, importo, incassato, residuo, stato). Vede solo i suoi: l'utente viene
  dalla sessione.
- **Manager/Admin** — `/performance-venditori`, scheda «Incassi e commissioni», tabella
  «Bonus incassi del mese» sotto quella delle commissioni, stesso selettore del mese:
  venditore, firmati, pagati, percentuale, in euro, scaglione, quanti ne mancano; la riga
  si apre sui contratti da saldare. Scelta rispetto a `/incassi`: quella scheda è già il
  posto dove manager e admin controllano firmato, incassato e commissione per venditore;
  `/incassi` è solo ADMIN, dietro password, e il manager non la vede.
- `/bonus`: testo della card Venditori aggiornato alle soglie di novembre.

Parole: «Firmato» e «Incassato», mai «fatturato».

## 5. Fuori da questo lavoro

- Applicare il bonus alla commissione (resta a 10/11/12%).
- Contratti di DIREZIONE (nessun `salesUserId`).
- Confronto col firmato del CRM (lead "Chiuso"): la card conta i contratti del gestionale,
  quindi il numero dei firmati può differire da quello della card del guadagno.

## 6. Da confermare dal PO

1. La definizione di "pagato" al punto 3 (in particolare la regola 2 per i finanziati).
2. Percentuale sul numero di contratti (non sugli euro).
3. Su cosa si applica il +0,5/+1/+1,5% (tutto l'incassato o solo quei contratti): qui non serve, la card non mostra euro di bonus.
4. I contratti in Recupero/Avvocato contano come firmati non pagati.
