# Revisione completa — Tracker Regolamento GDO

**Data:** 2026-07-24
**Oggetto:** revisione della bozza `Tracker_Regolamento_GDO` (Google Sheets, creata 28/05/2026) con prospettiva HR senior + verifica legale, in funzione del modello di business Fenice (call center vendite outbound, ~11 GDO a tempo determinato CCNL call center, 1 TL, cultura gamificata, pause in autogestione da luglio 2026).
**Fonti:** tre ricerche dedicate (quadro legale IT, best practice HR, pattern software HR) — riferimenti normativi e giurisprudenziali citati in calce.

---

## 1. Verdetto in sintesi

La bozza ha **l'impianto giusto e il meccanismo sbagliato**. L'idea di un catalogo regole codificato, con gravità e tracciamento sistematico degli episodi, è corretta ed è esattamente ciò che serve per costruire fascicoli difendibili. Ma il motore attuale — contatori che al superamento di una soglia generano una lettera di richiamo — è **giuridicamente nullo e controproducente**: produce carta che non vale nulla come precedente disciplinare, e nel frattempo espone l'azienda a rilievi privacy. Va ribaltato il paradigma: **il tracker segnala, l'uomo decide, la procedura formale (Art. 7) certifica**.

### Cosa va bene (da tenere)
| Elemento | Perché va bene |
|---|---|
| Catalogo regole codificato (C/P/S/L/K/I + numero) | Standard dei sistemi ER professionali; base del "codice disciplinare" richiesto per legge |
| Tre livelli di gravità | Corretto; permette proporzionalità |
| Soglie configurabili | Giusto principio — ma vanno reinterpretate (v. §3.1) |
| Finestra mobile 30gg | Buona per il "fresh start" psicologico; da integrare con memoria recidiva |
| Riepilogo aggregato per GDO | È la dashboard che serve al TL/manager |
| Template lettera formale | Utile come modello, ma va usato **dentro** la procedura Art. 7, mai auto-generato |
| Campo Note per episodio | Embrionale ma nella direzione giusta: la descrizione fattuale è tutto |

### Cosa non va (in ordine di gravità)
1. **Lettera automatica a soglia** → illegittima (automatismo sanzionatorio; recidiva su fatti mai contestati; violazione tempestività).
2. **Nessuna procedura Art. 7 nel flusso** → contestazione scritta preventiva, 5 giorni di difesa, decisione motivata: assenti.
3. **Codice disciplinare non affisso** → senza affissione fisica in bacheca, quasi tutte le sanzioni su queste 26 regole sarebbero annullabili.
4. **Modulo di tracciamento = controllo a distanza (Art. 4)** → senza informativa scritta (e probabilmente accordo sindacale o autorizzazione INL), i dati raccolti sono inutilizzabili in giudizio e sanzionabili dal Garante (precedenti Foodinho €2,6M+€5M, Deliveroo €2,5M per scoring dei lavoratori).
5. **Email settimanale di sole violazioni** → pratica sconsigliata: feedback tardivo (il cambiamento comportamentale si ottiene entro 24-48h), percepita come sorveglianza impersonale, contraddice la fiducia data con le pause in autogestione.
6. **Solo bastone, zero carota** → in un ambiente costruito sulla gamification, un sistema puramente punitivo erode il morale; serve il rapporto ~5:1 tra riconoscimenti e correzioni (Gallup).
7. **Regole vaghe non difendibili** → "conversazioni prolungate", "atteggiamento polemico", "tempo morto evidente": senza criteri osservabili sono arbitrio del TL e si smontano in giudizio.
8. **P02/P03 contraddicono la policy attuale** → le pause sono in autogestione da luglio: sanzionare "pausa > 30 min" o "uscita non registrata" è incoerente con la fiducia dichiarata (e il pulsante pausa non viene più usato → dato nemmeno misurabile).
9. **Episodi senza evidenze** → nessun campo per data/ora precisa, descrizione fattuale, testimoni, allegati: così il tracker non ha valore probatorio.
10. **Anagrafica vuota e nessun campo "rilevatore"** → non si sa chi ha registrato cosa; con più TL in futuro diventa ingestibile.

---

## 2. Il punto legale essenziale (perché il redesign non è opzionale)

Sintesi del report legale — il dettaglio completo con fonti è in calce:

- **Art. 7 L.300/1970**: nessuna sanzione senza (a) codice disciplinare **affisso in luogo accessibile a tutti** — la Cassazione esclude forme equipollenti nel privato: intranet/CRM da soli non bastano (Cass. 33811/2021, 24722/2022); (b) **contestazione scritta specifica e tempestiva** (fatti concreti, datati); (c) **minimo 5 giorni** per le difese, con eventuale assistenza sindacale; (d) decisione **umana, motivata, proporzionata** (art. 2106 c.c.; Corte cost. 971/1988 contro gli automatismi).
- **Tempestività**: il tracker in tempo reale prova che l'azienda "sapeva subito". Aspettare la 5ª violazione per contestare le prime quattro = contestazione tardiva = sanzione annullabile. Ogni episodio rilevante va contestato **quando accade**, non a pacchetto.
- **Recidiva**: contano solo i precedenti **formalmente sanzionati** e **non oltre 2 anni**. Le annotazioni interne non contestate sono giuridicamente inesistenti. → Per l'obiettivo "se una persona diventa un peso, poterla licenziare legalmente": il fascicolo si costruisce **passando presto al binario formale**, non accumulando appunti.
- **Art. 4 (controlli a distanza) + GDPR**: il modulo violazioni nel CRM è un sistema con finalità di controllo → serve informativa scritta ex art. 4 c.3 (senza, i dati sono inutilizzabili anche in giudizio), molto probabilmente accordo sindacale o autorizzazione INL (provv. Garante 384/2021 su call center), DPIA (monitoraggio sistematico + scoring di lavoratori), retention definita, diritto di accesso dell'operatore ai propri dati.
- **Tempo determinato**: sanzioni conservative (richiamo, multa max 4h, sospensione max 10gg su scala CCNL TLC art. 54) si applicano normalmente. Il licenziamento **ante tempus richiede giusta causa** (asticella massima); se sbagliato costa le retribuzioni fino a scadenza naturale. L'uscita a costo zero resta il **non rinnovo a scadenza** — che non richiede giustificazione, ma un fascicolo ordinato protegge anche da contestazioni di non-rinnovo ritorsivo.

**Adempimenti preliminari obbligatori prima del go-live** (da fare col consulente del lavoro):
1. Verificare il **CCNL effettivamente applicato** in busta paga (TLC? Call Center CISAL-ANPIT-Assocontact 2024?) e mappare le 26 regole sulla sua scala sanzioni.
2. Redigere il **codice disciplinare aziendale** definitivo e **affiggerlo fisicamente** in bacheca (+ copia nel CRM con log di presa visione, come rafforzativo).
3. **Informativa Art. 4 c.3 + informativa GDPR** firmate da tutti i GDO; **DPIA**; valutazione accordo sindacale / istanza INL per il modulo CRM.
4. Definire la **retention**: contatori operativi 30gg, rilevanza recidiva 2 anni, fascicolo formale per la durata del rapporto + termini di contenzioso.

---

## 3. Il redesign del sistema

### 3.1 Doppio binario (il cambiamento chiave)

**Binario 1 — Registro episodi (coaching, interno):** il TL registra ogni episodio con data/ora, regola, descrizione fattuale, eventuali evidenze. Nessun valore disciplinare autonomo. Obbligo di **feedback verbale 1:1 entro 48h** (2 minuti, in privato). L'operatore può consultare il proprio registro on-demand (trasparenza, GDPR-friendly) e chiedere revisione di un episodio entro 5 giorni a una figura sopra il TL (episodio "sospeso" finché deciso).

**Binario 2 — Procedimento formale (Art. 7):** quando un episodio è grave o il pattern è consolidato, il TL propone l'apertura di un procedimento; **l'admin/titolare decide** se emettere la contestazione scritta (consegna a mano con firma o PEC — il CRM genera il documento e traccia, ma il canale formale resta fisico). Timer 5 giorni per le difese, esame reale delle giustificazioni, decisione motivata sulla scala CCNL. Solo questi provvedimenti alimentano la recidiva (finestra 2 anni).

**Le soglie cambiano significato:** non "→ lettera" ma "→ alert al TL/admin: valutare se aprire il binario formale". Con una correzione di tempistica: per i fatti di gravità **media e alta** la contestazione va valutata **subito al singolo episodio** (tempestività!), non a soglia; la soglia serve solo per le violazioni **basse**, dove il pattern (non il singolo fatto) è la mancanza.

**Soglie riviste consigliate:**
| Gravità | Oggi | Proposta |
|---|---|---|
| Bassa | 5 in 30gg → lettera | 3 in 30gg → colloquio formale documentato; pattern che si ripete (2 soglie in 90gg) → valutare contestazione formale |
| Media | 3 in 30gg → lettera | Ogni episodio → feedback 1:1 entro 48h; 2 in 30gg → valutare contestazione formale del pattern (contestando fatti specifici e recenti) |
| Alta | 1 → lettera + sospensione | 1 → proposta formale immediata all'admin (contestazione entro pochi giorni), MAI sanzione automatica |

### 3.2 La carota (riequilibrio col modello Fenice)

- **Clean record bonus**: 30gg senza episodi → bonus Fenice Coins / badge, **privato** (mai in classifica: rivelerebbe indirettamente chi ha violazioni). È l'unico ponte lecito tra disciplinare e gamification.
- **Regola 5:1 per il TL**: per ogni annotazione correttiva, ~5 riconoscimenti positivi (il CRM può misurare il rapporto e mostrarlo al TL — avete già `note-gdo` e la gamification per il lato positivo).
- **Mai**: coins sottratti, badge negativi, violazioni visibili nell'economia di gioco. Il disciplinare è formale e riservato; il gioco è pubblico e positivo. Mischiare i due registri è l'anti-pattern n.1 della letteratura (dark side of gamification) e una "multa in coins" rischia di essere letta come sanzione pecuniaria fuori procedura.
- **Framing del lancio**: presentare il sistema al team come "patto di squadra" prima del go-live (serve comunque l'affissione ex Art. 7): l'accettazione cambia tutto, e la coerenza con la fiducia data sulle pause va spiegata esplicitamente.

### 3.3 Revisione regola per regola

Legenda verdetti: ✅ tieni · ✏️ riscrivi (criterio osservabile) · 🔀 accorpa/sposta · ❌ elimina/sostituisci.

| Cod. | Regola attuale | Verdetto | Note di revisione |
|---|---|---|---|
| C01 | Mancato rispetto verso colleghi/superiori (Bassa) | ✏️ | Troppo vago e sottopesato. Riscrivere: "offese, derisione o rifiuto di collaborazione espliciti verso colleghi/superiori (episodio con data/ora e testimoni)". Gravità **Media**. L'aggressione resta C08. |
| C02 | Conversazioni non lavorative prolungate (Bassa) | ✏️ | Criterio: "> 10 min consecutivi in fascia di chiamata attiva, osservato dal TL (ora inizio/fine annotate)". |
| C03 | Postazione disordinata (Bassa) | ✅ | Ok se esiste una checklist postazione scritta a cui rimandare. |
| C04 | Mancato affiancamento collega se richiesto (Bassa) | ✏️ | In realtà è rifiuto di una direttiva: "rifiuto esplicito di una richiesta di affiancamento del TL". Così com'è punisce la non-spontaneità, indifendibile. |
| C05 | Abbigliamento non decoroso (Bassa) | ✏️ | Difendibile solo con dress code scritto di riferimento. Scriverlo (3 righe bastano) e linkarlo. |
| C06 | Linguaggio inappropriato (Media) | ✏️ | Separare: turpiloquio generico (Bassa/Media) vs insulti diretti a persone (→ confluisce in C01/C08). "Bestemmie in presenza di lead" → spostare in L (chiamata). |
| C07 | Atteggiamento polemico verso TL/correzioni (Media) | ✏️⚠️ | La regola più pericolosa del catalogo: com'è scritta punisce il dissenso. Riscrivere: "rifiuto reiterato (2+ episodi documentati) di applicare una correzione operativa già oggetto di feedback scritto". Se non si riesce a oggettivare, eliminarla: è la prima che un giudice bollerebbe come repressione del conflitto. |
| C08 | Comportamento aggressivo (Alta) | ✏️ | Tenere Alta, ma definire: minacce, contatto fisico, urla con testimoni. Evidenze obbligatorie. |
| P01 | Ritardo < 5 min non comunicato (Bassa) | 🔀 | Micro-infrazione: tracciare solo il pattern (3+ episodi/settimana), non il singolo. Accorpare con P04 in un'unica regola "ritardi" a due livelli. |
| P02 | Pausa > 30 min (Media) | ❌ | **In contraddizione con la policy di autogestione delle pause** (luglio 2026) e non misurabile (pulsante pausa in disuso). Sostituire con: "violazione del patto di autogestione" — ma prima il patto va scritto (es. copertura fasce minime, avviso al TL se ci si assenta oltre X). Senza patto scritto, nessuna regola sulle pause è sostenibile. |
| P03 | Uscita temporanea non registrata (Bassa) | ❌ | Stesso conflitto di P02: se le pause sono autogestite, pretendere la registrazione di bagno/sigaretta è incoerente (e odioso). Eliminare o assorbire nel patto di autogestione. |
| P04 | Ritardo > 5 min non comunicato (Media) | ✅ | Ok. Diventa il livello 2 della regola ritardi unificata. |
| P05 | Mancata comunicazione assenza/ritardo (Media) | 🔀 | Si sovrappone a P04/P06: tenerla solo per l'assenza (comunicazione oltre l'inizio turno), il ritardo sta in P01/P04. |
| P06 | Assenza ingiustificata / abbandono postazione (Alta) | ✅ | Classica da codice disciplinare. Definire "abbandono" (allontanamento senza avviso > X min con chiamate pianificate). |
| S01 | Cellulare non nel box a inizio turno (Bassa) | 🔀 | Accorpare con S02: la regola è una ("uso del cellulare personale in fascia produttiva fuori dalle pause"); il box è il mezzo, non il fine. Verificare che la policy box sia ancora attiva e scritta. |
| S02 | Uso cellulare durante lavoro (Media) | ✅ | Regola madre dell'accorpamento con S01. Prevedere eccezioni dichiarate (emergenze familiari comunicate al TL). |
| S03 | CRM non aggiornato / compilato male (Media) | ✏️🤖 | Misurabile dal CRM: "lead lavorato senza esito registrato entro fine giornata" / "esito palesemente incoerente". Candidata alle **segnalazioni suggerite** automatiche (con conferma umana del TL, mai auto-registrata). Richiede informativa Art. 4 esplicita su questo uso. |
| S04 | Uso improprio o danneggiamento strumenti (Alta) | ✏️ | Splittare: danneggiamento doloso/colposo grave (Alta) vs uso improprio lieve (Media). "Improprio" da solo è vago. |
| L01 | Mancato rispetto script (Media) | ✏️ | Come si accerta? Se tramite ascolto chiamate, servono informativa e base giuridica specifiche (Art. 4). Definire: quali blocchi dello script sono vincolanti vs adattabili (coerente con la filosofia dello ScriptWidget). |
| L02 | Informazione non conforme al lead (Media) | ✏️ | Tenere, ed è quasi sottopesata: informazioni false su prezzi/promesse → rischio reputazionale e legale. Prevedere aggravante (Alta) se deliberata. |
| L03 | Tono inappropriato con lead (Media) | ✅ | Ok con evidenza (ascolto chiamata / segnalazione lead documentata). |
| L04 | Attaccare in faccia al lead (Alta) | ✏️ | Tenere Alta ma con contesto: lead abusivo/insultante → chiusura legittima. La regola è "interruzione ingiustificata". |
| K01 | Lavoro discontinuo / tempo morto evidente (Bassa) | ❌ | Doppio problema: (1) vaghezza "evidente"; (2) lo scarso rendimento **non è materia da sanzioni disciplinari episodiche** ma da coaching/PIP e semmai da giustificato motivo. Toglierla dal disciplinare, gestirla nel percorso coaching (che avete già: piano Noemi/GDO110). |
| K02 | Lead non lavorati senza segnalazione (Media) | ✏️🤖 | Tenere: è violazione di procedura, non di rendimento. Misurabile dal CRM (pipeline ferma) → segnalazione suggerita con conferma TL. |
| I01 | Segnalazione tardiva di un problema (Bassa) | ✏️ | "Quando già troppo tardi" è indeterminato. Riscrivere: "mancata segnalazione al TL entro la giornata di un problema bloccante di cui si era a conoscenza". |
| I02 | Assenza a formazione/riunione obbligatoria (Media) | ✅ | Ok. Specificare che l'obbligatorietà va comunicata in anticipo per iscritto. |

**Risultato netto:** dalle 26 attuali si scende a **~20 regole**, tutte con criterio osservabile + evidenza richiesta. Ogni regola nel formato: *comportamento osservabile + soglia quantitativa + evidenza necessaria*. Regola d'ingaggio assoluta: **se un episodio non ha data, ora e descrizione fattuale, non entra nel tracker** (metodo FOSA: Facts, Objectives, Solutions, Actions).

### 3.4 Comunicazione: cosa sostituisce l'email del venerdì

| Oggi (bozza) | Proposta |
|---|---|
| Email settimanale di sole violazioni a ogni GDO | ❌ Eliminata |
| — | Feedback verbale 1:1 entro 48h per ogni episodio (2 min, in privato), annotato nel registro |
| — | Registro personale consultabile on-demand dall'operatore nel CRM ("Il mio fascicolo") |
| — | Riepilogo **mensile** scritto e **bilanciato**: cosa è andato bene + eventuali episodi + trend. Mai una comunicazione scritta solo negativa |
| Lettera automatica a soglia | ❌ Sostituita dal binario formale Art. 7 (contestazione umana, 5gg difesa, decisione motivata su scala CCNL) |

### 3.5 Percorso di uscita legale (l'obiettivo dichiarato)

Se un GDO "diventa un peso", le opzioni in ordine di costo/rischio:

1. **Non rinnovo a scadenza** (costo zero, rischio minimo): non richiede giustificazione. Il fascicolo serve solo come difesa da eventuali accuse di ritorsione/discriminazione → basta che il registro mostri fatti, feedback dati e coerenza di trattamento tra operatori.
2. **Licenziamento disciplinare ante tempus** (giusta causa, asticella massima): si costruisce SOLO così — ogni episodio rilevante contestato formalmente **quando accade**; sanzioni progressive sulla scala CCNL (richiamo scritto → multa max 4h → sospensione max 10gg); recidiva formale entro il biennio (CCNL TLC: dopo 2 multe → sospensione; dopo 2 sospensioni → licenziamento); l'episodio finale grave contestato tempestivamente con procedura perfetta. Se il procedimento è viziato, il risarcimento è pari alle retribuzioni fino a scadenza naturale del contratto.
3. **Checklist fascicolo "pronto per il consulente"**: codice disciplinare affisso e in vigore alla data dei fatti · informative Art. 4/GDPR firmate · episodi con data/ora/fatti/evidenze · feedback 1:1 documentati · contestazioni formali notificate (ricevute) · difese ricevute e valutate per iscritto · sanzioni proporzionate e motivate · nessun trattamento difforme verso altri operatori per fatti analoghi.

**Regola operativa per il TL/PO:** quando qualcuno inizia a preoccupare, la decisione giusta non è "annotare di più" ma "**passare al formale presto**". Due mesi di appunti informali valgono meno di una contestazione formale ben fatta.

### 3.6 Governance e salute del sistema

- **Doppia firma**: il TL registra; per gravità media/alta la proposta formale la convalida l'admin. Calibrazione mensile TL+PO su 3-5 episodi campione (target: 90% accordo su criteri oggettivi).
- **Diritto di replica interno**: revisione episodio entro 5 giorni, episodio sospeso finché deciso.
- **Metriche di salute** (review trimestrale il primo anno): trend violazioni in calo dopo 60-90gg; violazioni distribuite (concentrazione su 1-2 persone = problema di coaching/selezione, non di regole); rapporto positivi/correttivi ~5:1; zero contestazioni "a sorpresa"; regole mai violate o sempre violate → riscriverle.

---

## 4. Traduzione nel CRM (visione, dettagli nella spec dedicata)

- **Catalogo regole** (`disciplinary_rules`) visibile a tutti gli operatori = copia digitale del codice disciplinare (rafforza, non sostituisce, l'affissione fisica).
- **Doppio binario nel modello dati**: nota informale (registro coaching) vs caso formale con stati (`SUBMITTED → UNDER_REVIEW → CONTESTED → DEFENSE_RECEIVED/EXPIRED → DECIDED → CLOSED`), audit trail **append-only**, allegati con hash, prese visione tracciate (chi/cosa/quando/quale versione — mai un toast).
- **Permessi**: TL vede solo il suo team; admin vede tutto; l'operatore vede solo il proprio fascicolo formale + il proprio registro episodi (mai note interne né dati altrui). **Niente bus realtime condiviso** per queste notifiche: canale privato per-utente.
- **Segnalazioni suggerite** (S03, K02) generate dai dati CRM ma **sempre confermate da un umano**; P02-like sulle pause escluse finché non esiste il patto di autogestione scritto.
- **Timer procedurali**: countdown 5 giorni difesa, reminder scadenze, marcatura automatica "spent" a 2 anni (esclusione dai contatori recidiva), retention job.
- **Clean record bonus** via gamification esistente (privato).
- **Fix parità import TL**: estendere `LeadRedistributionCard` + `redistributeLeadsActions` al ruolo TL (oggi solo ADMIN).

---

## 5. Riferimenti

Normativa e giurisprudenza: art. 7 e art. 4 L. 300/1970; artt. 2106, 2119 c.c.; Corte cost. 971/1988; Cass. 33811/2021, 24722/2022, 6893/2018 (affissione); Cass. ord. 7467/2023, 16088/2024, 34589/2024 (tempestività); Cass. 32283/2025 (art. 4 e chat); CCNL TLC 23/02/2024 art. 54; CCNL Call Center CISAL-ANPIT-Assocontact 2024; Garante provv. 384/2021 (call center), 10/06/2021 e 13/11/2024 (Foodinho), 234/2021 (Deliveroo); circolare INL 4/2017; artt. 5, 15, 22, 35 GDPR.

Letteratura HR: Gallup (rapporto 5:1, engagement e riconoscimento); Ravid et al. 2022 (meta-analisi electronic performance monitoring); SHRM/WSJ su PIP; SQM Group/Scorebuddy (calibrazione QA call center); metodologia FOSA; HR Acuity / OrangeHRM (pattern ER case management); ricerca "dark side of gamification" (separazione premi/sanzioni).

> ⚠️ Questo documento è un'analisi HR/organizzativa informata, **non un parere legale**. Prima del go-live: consulente del lavoro per codice disciplinare, mappatura CCNL, informative Art. 4/GDPR, DPIA e valutazione accordo sindacale/INL.
