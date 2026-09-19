## 1. Accuse sbagliate, gonfiate o non dimostrate

La sigla **[V] verifica un’osservazione, non automaticamente la sua spiegazione causale né l’impatto dichiarato**. Qui le tre cose vengono spesso confuse. La certezza indicata sotto riguarda la mia contestazione, non una verifica dei vostri sistemi.

### Sicurezza: difetti plausibili, formulazioni troppo assolute

**1. «Ogni funzione esportata è un endpoint pubblico; 50 file senza controllo di ruolo» non misura le vulnerabilità. — Certezza alta.**  
Le Server Actions effettivamente esposte vanno trattate come endpoint, ma contano il build distribuito, l’autenticazione, gli helper chiamati, l’autorizzazione sulle risorse e il ruolo database usato. Next.js può eliminare action inutilizzate: «12 action morte = 12 endpoint aperti» non segue. Inoltre, “pubblico” e “richiede una sessione valida” sono due proprietà diverse. Serve una matrice **azione → identità → risorsa → controllo effettivo**, non il conteggio dei file senza `if(role)`.

**2. Il rilievo 1.1 resta serio; la prova del trigger è accessoria e insufficiente. — Certezza alta.**  
Usare `user_metadata` per autorizzare è un errore concreto nel modello standard Supabase. Ma «nessun trigger nello schema auth, quindi niente lo impedisce» non esclude controlli applicativi, restrizioni di rete o autorizzazioni successive. RLS potrebbe limitare il danno, **se** quelle query la attraversano e **se** non usa gli stessi metadata manipolabili; una connessione privilegiata potrebbe invece bypassarla. Non declasserei questo rischio: farei una prova controllata con utenza di test e ripristino, senza aspettare un attacco.

**3. «Presa di controllo del Google Calendar» descrive male 1.4. — Certezza alta.**  
Lo scenario descritto è soprattutto **sostituzione del collegamento OAuth / login CSRF**: associare il calendario dell’attaccante all’identità del venditore, potenzialmente deviandovi appuntamenti futuri. Non prova l’accesso al calendario Google originale della vittima. Inoltre, un authorization code già consumato normalmente non è riutilizzabile: serve verificare il percorso con un codice nuovo e uno `state` alterato. Il rischio può essere grave, ma l’attacco raccontato è impreciso.

**4. In 1.3 manca un passaggio logico. — Certezza alta.**  
Non confrontare `userId` con l’utente corrente prova, salvo altri controlli, un rischio di azione per conto altrui. **Non prova da solo** che si possano ripetere premi o avanzare arbitrariamente: servono anche assenza di verifica degli eventi, vincoli unici e controlli sullo stato. Sono vulnerabilità diverse, da dimostrare separatamente.

**5. «Le 24 chiusure senza prodotto vengono da 1.5» è un’ipotesi, non una diagnosi. — Certezza alta.**  
Import, vecchie versioni, cancellazioni del prodotto e altre scritture possono produrre lo stesso dato. Il difetto di autorizzazione è indipendente e va corretto; l’origine delle chiusure richiede una cronologia delle modifiche.

**6. Il cron 1.7 non è dimostrato vulnerabile nella configurazione attuale; il retry eterno nemmeno. — Certezza alta.**  
`Bearer undefined` è una configurazione fail-open **quando manca il segreto**, non la prova che oggi manchi. Un record rimasto `pending` può essere ritentato, ma «ri-POSTa per sempre» dipende dal punto di errore, dalle scritture intermedie, dagli eventuali limiti e dalla deduplicazione del destinatario. Il caso pericoloso è “destinatario ha accettato, mittente non registra il successo”: va riprodotto.

### Lancio e messaggistica: alcuni allarmi sono giusti, altre “prove” non provano

**7. La data di prova del 18 settembre non dimostra che il lancio del 5 ottobre non partirà. — Certezza alta.**  
Dimostra che **la configurazione attuale non è pronta**. Diventa un incidente annunciato se mancano un responsabile, una scadenza e un controllo di readiness. «Nessun cron controlla che la data sia futura» non è una correzione sensata in sé: il cron deve operare anche quando l’evento è iniziato o passato, per invii e follow-up. Serve controllare configurazione e stato operativo prima dell’evento.

**8. Il limite PostgREST di 1.000 è credibile; manca la misura dell’esposizione reale. — Certezza medio-alta.**  
La query di prova dimostra il limite, non quante esecuzioni reali lo superano con **quei filtri**. Occorre misurare i messaggi per blocco e riprodurre una restituzione errata. Non lo liquiderei come teorico: 1.000 righe su 200 conversazioni significa appena cinque messaggi medi. Ma «ha già classificato male» e «può classificare male» restano affermazioni differenti.

**9. La capienza del blast è raccontata male. — Certezza alta.**  
Con 16 run da 200, perdere **un** run lascia 3.000 posti: non lascia necessariamente 200 persone escluse. Perderne due lascia 2.800. Il margine è fragile, ma il titolo è gonfiato. Inoltre, prima compaiono **24 esecuzioni**, poi 16: chiarire se 24 include quelle fuori finestra. E “posti” non equivale a messaggi consegnati: contano selezione, tentativi falliti, coda e throughput reale.

**10. Il CAS di 2.5 potrebbe avere funzionato perfettamente. — Certezza alta.**  
Se l’update filtra correttamente la fase e modifica zero righe, è il ritorno hard-coded `cambiata:true` a mentire. Questo può comunque far proseguire un invio indebito: il difetto sarebbe **ignorare l’esito del CAS**, non il CAS che non tiene. Un log prodotto da quel codice non prova la transizione. Nemmeno prova, da solo, perché sia partito il template otto minuti dopo.

**11. In 3.2 c’è una contraddizione letterale. — Certezza alta.**  
«Template consegnato + insert fallito» descrive un destinatario servito ma non tracciato, non uno che non ha ricevuto nulla. Inoltre, una risposta positiva all’API Twilio normalmente indica accettazione, non consegna finale. Il problema reale è la separazione tra **accettazione, persistenza e consegna**, con possibili duplicati e rendicontazione falsa.

**12. «Tutti ricevono due volte» e «il timeout produce 2–3 messaggi» sono esiti possibili, non necessari. — Certezza alta.**  
In 3.3 vanno considerate le altre guardie e la platea eleggibile; in 3.4 il duplicato richiede che il primo tentativo sia stato accettato e che non esista deduplicazione efficace. Sono rischi standard da gestire, non eventi già dimostrati. Anche «basta rilanciare l’errore per riattivare 60 righe di logica corretta» è troppo: quel recupero potrebbe ripetere un invio già accettato.

**13. L’errore di fuso di 3.5 ha il verso sbagliato. — Certezza alta, per una data-ora ISO senza offset interpretata in UTC.**  
“10:00” inteso come ora italiana estiva ma interpretato come UTC diventa **12:00 in Italia**, due ore dopo, non prima. Il difetto di validazione resta. In 4.7, invece, il fatto che il bot *prenoti* di notte non prova un difetto nella pagina degli appuntamenti: bisogna distinguere ora di creazione e ora dell’appuntamento.

**14. Una domenica da 25 ore è corretta, non è un bug. — Certezza alta.**  
Il 25 ottobre 2026 a Roma dura 25 ore. `dayBoundsRome` potrebbe quindi comportarsi correttamente. Il lunedì restituito alle 01:00 sarebbe invece sospetto, da verificare sugli istanti UTC e sul contratto dell’helper. «Quattro mesi l’anno» in 4.6 è sbagliato: l’ora solare dura circa cinque mesi. E nessun dato fornito dimostra che il **25 ottobre** sia nella finestra del lancio del 5–7 ottobre.

### Numeri, dati e zavorra

**15. In 5.1 è dimostrata una popolazione incoerente, non un unico “valore vero”. — Certezza alta.**  
Con lo stesso divisore, `8,5 × 521 / 958 ≈ 4,62`, non 4,7: vanno esposti giorni usati, arrotondamenti e istante della rilevazione. Inoltre, escludere oggi gli utenti disattivati può cancellare lavoro legittimamente svolto quando erano attivi. La metrica deve dichiarare se misura produttività degli operatori attuali, lavoro umano storico o capacità complessiva del sistema.

**16. Percentuali diverse non sono automaticamente errori. — Certezza alta.**  
5.2 e 5.3 possono essere misure entrambe valide: coorti diverse, risposta per chiamata contro risposta per persona. Il difetto è presentarle con etichette o target intercambiabili. In 5.4, a numeratore identico, 19% sugli assegnati e 10,9% sui chiamati implica più chiamati che assegnati: possibile con riassegnazioni e aiuti, ma da spiegare, non da chiamare semplicemente “tre versioni della stessa metrica”.

**17. La riconciliazione 9.2 non torna e non dimostra affidabilità assoluta. — Certezza alta.**  
`53 + 53 + 4 = 110`, non 113. Con i due mai arrivati si ottiene 112, non 113: manca almeno una categoria o la definizione del totale. Soprattutto, selezionare conversazioni che **hanno già** `bot_outcome=APPUNTAMENTO` esclude gli appuntamenti persi prima di quel salvataggio. “Non è mai stato un problema di consegna” non segue da una fotografia dei sopravvissuti.

**18. Numero duplicato non significa necessariamente lead duplicato; collegamento nullo non significa persona assente. — Certezza alta.**  
Il 45,3% misura lead appartenenti a numeri ripetuti, non record sicuramente superflui. Uno stesso contatto può avere più opportunità legittime; più persone possono condividere un numero. Analogamente, le 4.116 conversazioni senza `crm_lead_id` sono **non collegate**, non necessariamente assenti nel CRM: serve un confronto su identità normalizzate. “Conversazione più vecchia del lead” è compatibile con un rebind, ma non basta da sola a provarne la dannosità.

**19. I 515 appuntamenti senza data non sono dimostrati tutti persi dal bot. — Certezza alta.**  
Il totale potrebbe includere appuntamenti umani e altre cause. Né è provato che la storia sia irrecuperabile: messaggi, eventi, calendari, backup e payload potrebbero consentire una ricostruzione parziale. Il latch proposto basta per contare il **primo** appuntamento per lead; non basta per distinguere prenotazioni, rifissaggi, annullamenti e appuntamenti multipli.

**20. La copia vecchia non è necessariamente una copia sbagliata. — Certezza alta.**  
Se lo stato cambia raramente, una riga non risincronizzata da 14 giorni può essere corretta. Il segnale utile sono le divergenze e le decisioni sbagliate che ne derivano. Inoltre, il referto trasforma un’età **mediana** di 14 giorni in un’età **media** di due settimane: non sono equivalenti.

**21. «427 MB: il ritrovamento più pesante» confonde spazio con impatto. — Certezza alta.**  
Non sappiamo se a luglio siano finiti disco, CPU, connessioni, IOPS o memoria. Gli array possono essere spreco reale, ma non sono una causa dimostrata della saturazione. Cancellarli non restituisce necessariamente subito spazio al sistema operativo. I 501 MB di worktree locali non pesano sulla produzione salvo inclusione nel deployment; tabelle vuote e script archiviati non provano codice morto.

**22. Mancano prove prestazionali e prove di ricostruzione. — Certezza alta.**  
Un seq scan non è di per sé un difetto: servono cardinalità, frequenza e `EXPLAIN ANALYZE`; `LIKE` case-sensitive è invece un comportamento verificabile. Le migrazioni disordinate sono un rischio serio, ma se il DDL inline è parte della procedura ufficiale il problema è anche procedurale. Infine, «schema allineato» contando le tabelle contraddice la sicurezza esibita: otto indici mancanti bastano già a smentire un allineamento completo.

**23. Il caching ha una stima ragionevole nella forma, ma una prova sbagliata sui cache hit. — Certezza alta.**  
Il 99% delle chiamate *globali* entro cinque minuti non implica 99% di hit: servono intervalli per prefisso effettivamente identico, inclusi Mario/Marta e gli altri elementi della richiesta. La soglia del 78% è compatibile con moltiplicatori 1,25× in scrittura e 0,1× in lettura, ma va verificata sul contratto effettivo; caratteri e chiamate non bastano per stimare token fatturati. “Nessun cambio di comportamento possibile” è un assoluto ingiustificato per una modifica della richiesta. Misurare token letti **e scritti**, latenza ed errori; non dedurre il risultato dalla frequenza globale.

## 2. Priorità sbagliate

**No: “tutta la sicurezza prima, poi il lancio” è un ordine sbagliato. Ma “siamo tutti interni” non autorizza a ignorare 1.1.**

Settanta persone identificate riducono alcuni scenari opportunistici; non eliminano account compromessi, errori o abuso interno. E “nessun accesso pubblico” non è dimostrato: almeno OAuth, webhook e integrazioni richiedono di chiarire quali endpoint siano raggiungibili e con quali protezioni. Un’interfaccia riservata non equivale a una rete privata.

Rifarei l’ordine così:

1. **Contenimento immediato e circoscritto.** Verificare 1.1, controllare eventuali metadata anomali e impedire che attributi modificabili governino privilegi e tenant. Limitare le scritture amministrative e gli endpoint dubbi non indispensabili. Non trasformarlo in una riscrittura dell’autorizzazione prima del lancio.
2. **Readiness end-to-end del 5 ottobre.** Configurazione reale, template reali approvati, destinatari eleggibili, capienza, limite PostgREST, associazioni CRM–bot e prova completa su una coorte autorizzata. Il criterio è “destinatario raggiunto e stato coerente”, non “cron verde”.
3. **Integrità del percorso critico.** Persistenza degli invii, gestione degli esiti ambigui, idempotenza, CAS, retry, ri-arruolamenti, date e prenotazioni. Qui un difetto può danneggiare migliaia di contatti senza alcun attaccante.
4. **Contingenza e recupero prima dell’evento.** Monitoraggio, referente reperibile, procedura di arresto e ripresa, riconciliazione, alternativa operativa se provider o database non rispondono. Senza questo, il test riuscito è solo una fotografia.
5. **Dopo: semantica KPI, pulizia e gamification.** Un boss rotto, un premio perso o un bordo del mese non precedono invii e appuntamenti. Eccezione: **sospendere subito l’uso probatorio delle metriche contestate nei procedimenti sui lavoratori**, finché non validate. È un rischio già presente, non un miglioramento cosmetico.

Il caching può essere un intervento separato e reversibile, non una dipendenza del lancio. I grandi refactoring, le migrazioni generalizzate agli helper temporali e le bonifiche distruttive vanno tenuti fuori dal percorso critico.

## 3. Quello che manca

Non posso sapere cosa i sette agenti abbiano cercato senza riportarlo. Posso dire quali garanzie **non risultano dimostrate**.

### A. Non esiste una definizione verificata di identità

Il problema strutturale più evidente è **confondere persona, numero WhatsApp, lead/opportunità, conversazione e appuntamento**. Il rebind è un sintomo di questa confusione, non necessariamente di “mancata deduplica”.

Occorre decidere: una persona può avere più opportunità? Una conversazione può attraversarle? A quale opportunità appartiene ciascun messaggio e ciascun appuntamento? Cosa succede con un telefono condiviso, corretto o riciclato? Chiudere tutto con `UNIQUE(phone)` potrebbe distruggere dati legittimi.

### B. Due database, nessuna autorità esplicita per i singoli fatti

Chi possiede lo stato dell’appuntamento? Chi può annullarlo? Una modifica umana prevale sul bot? Una risposta tardiva può resuscitare un esito superato? Come si risolvono eventi arrivati fuori ordine?

HMAC autentica il mittente: **non stabilisce chi abbia ragione né rende affidabile la consegna**. Manca un contratto con identificativi degli eventi, versioni, regole di precedenza e riconciliazione. I campi sovrascritti non possono fare contemporaneamente da stato corrente e archivio storico.

### C. Non sono state provate le finestre di guasto

Servono test nei punti scomodi:
- Twilio accetta, ma la risposta si perde.
- Il database fallisce dopo l’invio.
- Il callback arriva prima dell’insert o arriva due volte.
- Il CRM accetta, ma il bot non registra l’esito.
- Due cron si sovrappongono; un deploy interrompe un lotto.
- Un evento vecchio arriva dopo un aggiornamento umano.

Non basta aggiungere `throw`: occorrono operazioni identificabili, tentativi persistenti, recupero degli esiti incerti e deduplicazione. “Exactly once” non si ottiene con una chiamata HTTP; serve un effetto applicativo idempotente e riconciliabile.

### D. Nessun conto operativo chiude davvero

Per il lancio deve essere possibile spiegare ogni destinatario:
**eleggibile → selezionato → tentato → accettato → consegnato/fallito → recuperato/escluso**, con ragioni esplicite e senza sovrapposizioni nascoste.

Oggi `status:200`, righe mancanti e log ottimistici non danno questa garanzia. Servono allarmi su mancato progresso, crescita dell’arretrato e destinatari senza stato, non soltanto sulle eccezioni. Anche il monitor può guastarsi: chi se ne accorge se il cron non parte affatto?

### E. Dipendenze esterne: è stato letto il codice, non dimostrata la capacità del servizio

Mancano verifiche su limiti e stato degli account Twilio/WhatsApp, velocità effettiva, code, scadenza dei messaggi, restrizioni marketing, template sospesi, opt-out e recapiti non raggiungibili. Sostituire un SID non dimostra né conformità né consegnabilità.

Mancano anche capienza e impostazioni Zoom per circa 3.000 invitati, disponibilità dell’host, link effettivo e piano per indisponibilità della riunione. Per Anthropic: timeout, rate limit, indisponibilità e comportamento degradato. Per Google: token revocati/scaduti e sincronizzazioni parziali. Per Vercel/Supabase: limiti di esecuzione, connessioni, storage e picchi simultanei.

### F. La prenotazione non è stata verificata come risorsa contesa

Validare una data non significa avere uno slot. Due chat possono occupare l’ultimo posto? Bot e operatore possono prenotare insieme? Il cap giornaliero è un suggerimento al modello o un vincolo atomico? Ferie, assenze, cancellazioni e calendario scollegato come incidono sulla disponibilità?

Manca una prova di carico sul **vincolo di prenotazione**, non soltanto sul numero di richieste HTTP.

### G. Il modello AI è fuori dall’analisi di sicurezza e correttezza

Un lead può indurlo a ignorare istruzioni, inventare disponibilità, divulgare dati o chiamare strumenti con argomenti arbitrari? Le autorizzazioni degli strumenti sono indipendenti dal prompt? Il modello può fissare un appuntamento non confermato dalla persona?

Vanno testati messaggi ambigui, correzioni, allegati, conversazioni lunghe, risposte simultanee e passaggio all’operatore. Serve inoltre isolamento del contesto fra contatti e tenant. Un prompt stabile di 40.705 caratteri non è una garanzia comportamentale.

### H. Sicurezza infrastrutturale e ciclo di vita degli accessi

Non risultano coperti RLS effettive per tutti i percorsi, credenziali privilegiate, segreti nei log, backup esposti, account dismessi, MFA amministrativa, revoca delle sessioni, dipendenze vulnerabili e accessi ai deploy.

Sul contratto HMAC mancano prove di anti-replay, validità temporale, canonicalizzazione, rotazione delle chiavi e compatibilità fra versioni. Sui webhook Twilio manca evidenza della verifica della firma. “Timing-safe” non è un audit del protocollo.

### I. Privacy e governo dei dati

Quali basi giuridiche e informative coprono messaggistica, finalità marketing, fornitori AI e conservazione delle chat? L’opt-out si propaga anche a liste reimportate e conversazioni ri-arruolate? Cancellazioni e rettifiche raggiungono entrambi i database, log e copie?

L’accesso in sola lettura dei sette agenti non risolve il tema: quali dati personali hanno ricevuto, dove sono finiti i risultati, per quanto restano conservati? Nessuna violazione è dimostrata; nessun presidio è documentato nel referto.

### J. Ripristino e assenza del manutentore

Esiste un restore realmente eseguito, con tempi misurati? Si possono ricostruire schema, indici, funzioni, RLS, cron, segreti e configurazione dei provider? Un backup Supabase non ricrea automaticamente l’intero servizio.

Ripristinare uno solo dei database a ieri può **ripetere messaggi già inviati oggi** o ricreare esiti superati. Serve una procedura di riallineamento successiva al restore. Se Bruno manca due settimane, un’altra persona può fermare gli invii, cambiare il link, leggere un allarme, ruotare una chiave e recuperare una coda senza interpretare il codice?

### Il problema strutturale

Non emerge soltanto “codice con molti bug”. Emerge un impianto in cui **le invarianti del business sono sparse fra prompt, UI, query, cron e campi mutabili**, mentre nessun registro operativo permette di spiegare in modo affidabile cosa sia accaduto.

Da qui derivano autorizzazioni incoerenti, metriche concorrenti, stati persi e riconciliazioni postume. Correggere i rilievi uno per uno senza stabilire identità, autorità dei dati, eventi e procedure di recupero produrrà la prossima lista di rilievi.

## 4. Il consiglio scomodo

**Il proprietario deve rinunciare all’idea che Bruno possa continuare a essere contemporaneamente unico sviluppatore, garante dei dati e unica procedura di emergenza.**

Non servono altri sette agenti a compensare questa dipendenza: serve una seconda persona operativamente autonoma, con accessi controllati, istruzioni provate e responsabilità assegnate. Nell’immediato: congelare le funzioni non essenziali e pretendere che qualcuno diverso da Bruno esegua una prova di arresto, ripresa e riconciliazione.

Se nessun altro riesce a farlo, il rischio non è “Bruno potrebbe assentarsi”. È che **l’azienda sta facendo dipendere processi produttivi da conoscenza non trasferita**, e nessuna chiusura di ticket può dichiarare risolto quel rischio.