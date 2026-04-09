'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Clock, CheckCircle2, AlertTriangle, Mic } from 'lucide-react';

const SCRIPT_BLOCKS = [
  {
    title: "1 — Apertura",
    content: `Buongiorno, #NOME#?
🗣️
Ciao #NOME#! Sono #MIO NOME#, il tutor di Fenice Academy, professioni del futuro! Come stai? Tutto bene?
🗣️`,
    voice: "Sorridi mentre parli — si sente al telefono. Voce piena, dal petto. Energia ALTA, entusiasmo vero. Ritmo leggermente veloce — devi sembrare una persona di valore.",
  },
  {
    title: "2 — Gestione risposta",
    content: `"Tutto bene"
Ottimo! Senti, ti chiamo perché hai lasciato i tuoi dati sulla nostra pubblicità riguardo le professioni digitali — mi ha incuriosito, volevo capire direttamente da te: cos'è che ti aveva colpito?

"Più o meno / insomma / male"
Caspita, mi dispiace... spero nulla di grave.
(PAUSA 2-3 secondi — NON riempire il silenzio)
🗣️
Ti chiamo perché hai lasciato i tuoi dati sulla nostra pubblicità riguardo le professioni digitali — e magari è proprio il momento giusto per parlarne, no? Cosa ti aveva incuriosito?

"Non ricordo"
Fenice Academy! Formazione sulle professioni digitali — social media manager, copywriter, graphic designer...
Ti chiamo perché hai lasciato i tuoi dati su una nostra pubblicità su FB o IG — magari era un po' di tempo fa! Tu attualmente lavori già nel digitale o fai tutt'altro?

Se continua: "Nessun problema, capita! L'importante è: ti incuriosisce il mondo digitale? Perché se sì, vale la pena di fare due chiacchiere."

"Non ho tempo / Mi richiami"
Immaginavo tu fossi impegnato! Proprio per questo faccio chiamate da massimo 5 minuti — così sfruttiamo bene il tempo di entrambi. Okay?
Dimmi solo velocemente: cosa ti aveva colpito delle professioni digitali?

Se insiste: "Assolutamente, ti richiamo volentieri! Dimmi quando preferisci — domani mattina o pomeriggio?"

"Mi avete già chiamato"
Certo, mi ricordo! E proprio per questo ti richiamo — in Fenice abbiamo introdotto delle novità importanti. Volevo capire se adesso possiamo venire incontro meglio alle tue esigenze. Ricordami: come mai ti stavi interessando alle professioni digitali?`,
    voice: "Adatta la tua energia a quella del lead. Se è entusiasta, sii entusiasta. Se è giù, abbassa il volume, parla più lentamente, fai sentire che ti importa. Poi risali gradualmente.",
  },
  {
    title: "3 — Motivazione interesse",
    content: `"Curiosità"
Beh oggi se ne fa un gran parlare, è normale essere curiosi! Aiutami a capire meglio — tu oggi lavori in questo settore o fai tutt'altro?

"Voglio cambiare lavoro / Seconda entrata"
Interessante... e dimmi, questa cosa la stai valutando da poco o è un pensiero che hai da un po'?
🗣️

"Studente"
Cosa stai studiando? A che punto sei? Lavori anche?
Hai valutato se sei disposto ad investire in un percorso di formazione?`,
    voice: "Passa dall'entusiasmo alla curiosità. Parla meno e ascolta il DOPPIO. Il tuo tono dice: 'sono genuinamente interessato a te'.",
  },
  {
    title: "4 — Analisi problema",
    content: null, // Rendered as checklist
    voice: "Le prime domande: tono tranquillo, amichevole — come un amico.\nLe domande centrali: tono più serio, empatico — come un dottore.\nLe ultime domande: voce bassa, lenta, PAUSE LUNGHE (3-4 sec) dopo la risposta. Il silenzio è potentissimo.\nRipeti le parole esatte del lead. Se dice 'mi sento bloccato', tu dici 'capisco, ti senti bloccato... e da quanto tempo?'",
    checklist: {
      min: 8,
      sections: [
        { title: "Se lavora", items: [
          "Cosa fai di lavoro? Da quanto tempo?",
          "Part-time o full-time? Dipendente o libero professionista?",
          "Sei soddisfatto del tuo lavoro attuale?",
          "Cosa cambieresti se potessi?",
          "Quanto guadagni più o meno? Ti basta per vivere come vorresti?",
          "Hai mai pensato di avere un'entrata alternativa?",
          "Ti ci vedi a fare questo lavoro per tutta la vita?",
          "Ti senti valorizzato nel lavoro che fai?",
          "Cosa hai già provato per cambiare e non ha funzionato?",
          "Se la situazione non cambiasse nei prossimi 2 anni, ti andrebbe bene?",
          "Come ti fa sentire tutto questo? (PAUSA — lascialo parlare)",
          "Quanto ti costa questa situazione, non solo economicamente ma di tempo e serenità?"
        ]},
        { title: "Se non lavora", items: [
          "Da quanto tempo sei disoccupato/a?",
          "Qual è l'ultimo lavoro che hai fatto?",
          "Cosa è successo? Finito il contratto o sei andato/a via?",
          "Hai provato a cercare lavoro nel tradizionale? Come sta andando?",
          "Come ti fa sentire dipendere da un'altra persona economicamente?",
          "Hai un piano concreto per cambiare la situazione?",
          "Se la tua situazione non cambiasse, ti andrebbe bene?",
          "Come immagini la tua vita tra un anno se non cambi nulla?",
          "Cosa hai già provato che non ha funzionato?",
          "Quanto pesa questa situazione su di te quotidianamente?"
        ]},
        { title: "Se ha figli", items: [
          "Con il lavoro che hai, riesci a stare con loro quanto vorresti?",
          "Ti godi la famiglia come vorresti?",
          "Come ti senti rispetto alla gestione economica familiare?",
          "Cosa ti preoccupa di più per il loro futuro?",
          "Cosa hai già provato che non ha funzionato?"
        ]},
        { title: "Se non ha figli", items: [
          "Riesci a dedicare tempo a te stesso? Viaggiare? Hobby?",
          "Ti senti in ritardo rispetto ai tuoi coetanei?",
          "Tra 5 anni la tua situazione sarà diversa o identica?",
          "Cosa ti trattiene dal fare un cambiamento?",
          "Cosa hai già provato che non ha funzionato?"
        ]}
      ]
    }
  },
  {
    title: "5 — Professione",
    content: `Tranquillo, siamo qui proprio per valutare delle alternative e capire come aiutarti grazie al mondo digitale. Tu hai già visto una professione che ti incuriosisce?

"Vuole farne una"
Il [professione] è un'ottima scelta — c'è tantissima richiesta in questo momento. Però dipende anche dai tuoi obiettivi: cosa vorresti ottenere da un lavoro nel digitale?

"Non sa cosa fare"
Capire se è più razionale/analitico o creativo, poi:
Guarda, per te vedrei bene il [professione] — è perfetto per chi [match]. Però la cosa più importante è capire prima i tuoi obiettivi.`,
    voice: "Torna ad energia ALTA. Quando suggerisci la professione, voce sicura, ZERO esitazione. Tu sei l'esperto.",
  },
  {
    title: "6 — Analisi obiettivi",
    content: null,
    voice: "Tono che SALE, entusiasta, positivo. Qui parli del futuro del lead — deve sentire la differenza tra 'dove sei' (problema, tono basso) e 'dove vuoi arrivare' (obiettivo, tono alto). Tu sei il ponte.",
    checklist: {
      min: 5,
      sections: [
        { title: "Domande obiettivi", items: [
          "Qual è l'obiettivo principale che vuoi raggiungere?",
          "Hai una tempistica precisa o è 'prima o poi'?",
          "Dove vorresti essere tra 6 mesi?",
          "Se questa cosa funzionasse, cosa cambierebbe concretamente?",
          "Cosa ti manca oggi per arrivare al tuo obiettivo?",
          "C'è qualcosa che ti ha fermato finora?",
          "Che tipo di vita vuoi costruirti nei prossimi anni?",
          "Preferisci massimizzare guadagni, tempo libero o stabilità?"
        ]}
      ]
    }
  },
  {
    title: "7 — Urgenza obiettivo",
    content: `"È da molto che stai cercando di raggiungere questo obiettivo?"

Se risponde POCO:
"Ah, e come mai proprio adesso vorresti iniziare un percorso per avere [obiettivo]?"

Se risponde TANTO:
"Ah, e come mai non sei ancora riuscito a farlo?"
(PAUSA LUNGA 3-4 secondi — non dire nulla)`,
    voice: "Se risponde TANTO: dopo la pausa, voce bassa, calma, sincera — come se stessi dicendo una verità importante a un amico.",
  },
  {
    title: "8 — Bridge al pitch",
    content: `"Perfetto #NOME#, sono convinto che noi possiamo aiutarti a fare [OBIETTIVO] e adesso ti spiego come, ok?"`,
    voice: "Cambio di marcia. Fino ad ora ascoltavi. Adesso SEI L'ESPERTO. Voce che sale, tono fermo, dal petto. Certezza totale.",
    warning: "NON PASSARE AL PITCH SE NON AVETE PARLATO ALMENO 4 MINUTI",
    requiresTimer: true,
  },
  {
    title: "9 — Pitch",
    content: `"Considera che noi abbiamo percorsi davvero completi, composti da 3 elementi fondamentali. Adesso riassumo molto, poi ci sentiamo in una videochiamata per vedere tutti i dettagli, okay?"

1. TEORIA
"Per apprendere le competenze richieste — immagino tu abbia una vita abbastanza piena, vero?
(aspetta il sì)
Allora le nostre lezioni sono perfette perché le guardi quando e dove vuoi."

2. PRATICA
"Stage in azienda — immagino che orari fissi ti sarebbero scomodi, vero?
(aspetta il sì)
Immaginavo — per questo faremo lo stage da remoto e con orari flessibili."

3. COLLEGAMENTO AL LAVORO
(ABBASSA il volume, parla quasi sussurrando)
"Fenice Academy garantisce A CONTRATTO due colloqui di lavoro a fine corso."
(PAUSA 2 secondi — torna a volume normale)
"Pensi che sia facile cercare lavoro in autonomia? Proprio per questo noi te li portiamo noi."

"Insomma… molto completo e perfetto anche per te che parti da zero.
Prevede una quota di iscrizione che varia dai 1.000 ai 3.000€ a seconda del corso.
Ma sai cosa penso #NOME#? Che il vero punto sia prima capire bene di cosa si tratta e se è la cosa che fa per te.
Anzi, tu di dove sei?"`,
    voice: "3 livelli tonali:\n• Teoria = entusiasta, positivo\n• Pratica = rassicurante\n• Garanzia lavoro = SUSSURRA, poi pausa, poi torna normale. Questo contrasto la rende memorabile.\n'Tu di dove sei?' = tono leggero, come tra amici.",
  },
  {
    title: "10 — Presa appuntamento",
    content: `"Okay, organizziamoci una videocall. Almeno ci diamo anche un volto…
Parliamo una mezz'ora e vediamo insieme come e se, lavorando nel digitale, puoi risolvere [PROBLEMA] e arrivare a [OBIETTIVO]. Okay?"

SE FA PROBLEMI SULLA QUOTA:
"Comprendo che sia una scelta importante. Proprio per questo fissiamo una videochiamata per capire prima di tutto se il digitale è adatto a te e se è ciò che vuoi fare."

Ti mando il link della mia agenda virtuale su WhatsApp — dimmi quando arriva.

⚠️ "SEI SICURO/A, ALLE ORE X, DI AVERE 45 MINUTI TRANQUILLI IN UN POSTO TRANQUILLO?"

Ti chiedo di leggere il nome della mia collega che appare dopo aver cliccato Invia.
(legge: [NOME CONFERMA])`,
    voice: "Tono ORGANIZZATIVO — come se stessi fissando qualcosa di naturale e ovvio. Non chiedi il permesso, organizzi. 'Organizziamoci' non 'ti andrebbe di...'",
  },
  {
    title: "11 — Chiusura",
    content: `"Perfetto. Adesso ti dico chi è [NOME CONFERMA] — prima però ti mando un video su WhatsApp di circa 20 minuti, che ti spiega chi siamo, cosa facciamo, le professioni, i pacchetti e le quote di iscrizione."

"È FONDAMENTALE vedere il video subito appena puoi, già stasera, così ti fai un'idea generale di tutto."
(pausa — aspetta che dica ok)

"Nella giornata di [GIORNO] ti chiamerà la mia collega [NOME CONFERMA] per effettuare una PRESELEZIONE e mandarti il link per la videochiamata che faremo giorno [X] alle ore [X]."

"Tutto chiaro?"
🗣️

"È stato un piacere #NOME#. Ci vediamo in videochiamata — vedrai che sarà una bella chiacchierata. A presto!"`,
    voice: "Rallenta tutto. Voce bassa, calda, sicura. Come un mentore che dà le ultime indicazioni. L'ultima emozione che lasci è quella che il lead ricorderà.",
  },
];

// Timer
const TIMER_SECONDS = 4 * 60;

export function ScriptWidget() {
  const [current, setCurrent] = useState(0);
  const [checkedItems, setCheckedItems] = useState<Record<number, Set<string>>>({});
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const block = SCRIPT_BLOCKS[current];
  const checked = checkedItems[current] || new Set<string>();
  const checkedCount = checked.size;
  const minRequired = block.checklist?.min || 0;
  const timerDone = timerSeconds >= TIMER_SECONDS;

  // Timer
  useEffect(() => {
    if (timerRunning && !timerDone) {
      timerRef.current = setInterval(() => {
        setTimerSeconds(prev => {
          if (prev + 1 >= TIMER_SECONDS) {
            setTimerRunning(false);
            if (timerRef.current) clearInterval(timerRef.current);
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning, timerDone]);

  // Start timer on block 2
  useEffect(() => {
    if (current >= 1 && !timerRunning && timerSeconds === 0) {
      setTimerRunning(true);
    }
  }, [current]);

  const canGoNext = useCallback(() => {
    if (current >= SCRIPT_BLOCKS.length - 1) return false;
    if (block.checklist && checkedCount < minRequired) return false;
    if (SCRIPT_BLOCKS[current + 1]?.requiresTimer && !timerDone) return false;
    return true;
  }, [current, checkedCount, minRequired, timerDone, block]);

  const goNext = () => { if (canGoNext()) setCurrent(prev => prev + 1); };
  const goPrev = () => { if (current > 0) setCurrent(prev => prev - 1); };
  const resetCall = () => {
    setCurrent(0);
    setCheckedItems({});
    setTimerSeconds(0);
    setTimerRunning(false);
    setShowVoice(false);
  };

  const toggleCheck = (key: string) => {
    setCheckedItems(prev => {
      const s = new Set(prev[current] || []);
      if (s.has(key)) s.delete(key); else s.add(key);
      return { ...prev, [current]: s };
    });
  };

  const remaining = Math.max(0, TIMER_SECONDS - timerSeconds);
  const timerMin = Math.floor(remaining / 60);
  const timerSec = remaining % 60;
  const progress = ((current + 1) / SCRIPT_BLOCKS.length) * 100;

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} disabled={current === 0} className="p-1.5 rounded-lg border border-ash-200 hover:bg-ash-50 disabled:opacity-30 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-ash-500 tabular-nums">{current + 1} / {SCRIPT_BLOCKS.length}</span>
          <button onClick={goNext} disabled={!canGoNext()} className="p-1.5 rounded-lg border border-ash-200 hover:bg-ash-50 disabled:opacity-30 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowVoice(!showVoice)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${showVoice ? 'bg-brand-orange/10 border-brand-orange/30 text-brand-orange-700' : 'border-ash-200 text-ash-500 hover:bg-ash-50'}`}>
            <Mic className="w-3.5 h-3.5" /> Voce
          </button>
          <button onClick={resetCall} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /> Nuova chiamata
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-ash-100 rounded-full mb-4 overflow-hidden">
        <div className="h-full bg-brand-orange rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* Timer */}
      {timerSeconds > 0 && (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl mb-4 text-sm font-medium border transition-all ${timerDone ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
          <Clock className="w-4 h-4 flex-shrink-0" />
          <span className="font-mono text-lg tabular-nums">{timerMin}:{timerSec.toString().padStart(2, '0')}</span>
          <span className="text-xs">{timerDone ? 'Puoi procedere al pitch' : 'Timer — sblocca il pitch dopo 4 min'}</span>
        </div>
      )}

      {/* Card */}
      <div className="bg-white rounded-2xl border border-ash-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-ash-100 bg-gradient-to-r from-ash-50 to-white">
          <h3 className="text-xs font-bold text-brand-orange uppercase tracking-widest">{block.title}</h3>
        </div>

        <div className="px-5 py-4">
          {/* Voice note */}
          {showVoice && block.voice && (
            <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl px-4 py-3 mb-4 text-sm text-amber-800 leading-relaxed">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 uppercase tracking-wider mb-1.5">
                <Mic className="w-3.5 h-3.5" /> Come dirlo
              </div>
              <div className="whitespace-pre-line">{block.voice}</div>
            </div>
          )}

          {/* Warning */}
          {block.warning && (
            <div className="bg-red-50 border border-red-200/60 rounded-xl px-4 py-3 mb-4 text-sm text-red-700 font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {block.warning}
            </div>
          )}

          {/* Checklist */}
          {block.checklist ? (
            <div>
              <div className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl mb-4 text-lg font-bold border ${checkedCount >= minRequired ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                {checkedCount >= minRequired ? <CheckCircle2 className="w-5 h-5" /> : null}
                {checkedCount} / {minRequired}
              </div>
              {block.checklist.sections.map((sec, si) => (
                <div key={si} className="mb-4">
                  <div className="text-xs font-bold text-brand-orange uppercase tracking-wider mb-2">{sec.title}</div>
                  {sec.items.map((item, ii) => {
                    const key = `${si}-${ii}`;
                    const isChecked = checked.has(key);
                    return (
                      <div key={key} onClick={() => toggleCheck(key)} className={`flex items-start gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-ash-50 ${isChecked ? 'opacity-50' : ''}`}>
                        <input type="checkbox" checked={isChecked} onChange={() => {}} className="mt-0.5 w-4 h-4 accent-brand-orange flex-shrink-0 cursor-pointer" />
                        <span className={`text-sm leading-relaxed ${isChecked ? 'line-through text-ash-400' : 'text-ash-800'}`}>{item}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[15px] leading-[1.85] text-ash-800 whitespace-pre-line">{block.content}</div>
          )}
        </div>
      </div>
    </div>
  );
}
