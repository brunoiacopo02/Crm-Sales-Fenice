'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Mic, LifeBuoy, Shield, ChevronDown } from 'lucide-react'

type QuestionSet = { title: string; items: string[] }

type Block =
    | { title: string; kind: 'content'; content: string; voice?: string; emergencyPanel?: 'fuga' | 'obiezioni' }
    | { title: string; kind: 'targetChecklist'; voice?: string; sets: { generale: QuestionSet[]; imprenditori: QuestionSet[]; extra_skills: QuestionSet[] } }
    | { title: string; kind: 'checklist'; voice?: string; sections: QuestionSet[] }

const BLOCKS: Block[] = [
    {
        title: '1 — Introduzione + filtri tecnici',
        kind: 'content',
        voice:
            'Tono professionale, caldo, diretto. Voce ferma ma non fredda — sei un\'ufficio ammissioni, non un call center. Non chiedere permesso: verifica.',
        content: `Pronto #NOME#?
Ciao, sono #MIO NOME# dell'ufficio ammissioni di Fenice Academy. Ti chiamo per il tuo appuntamento di orientamento fissato per #GIORNO# alle #ORA#. Prima di confermarlo, ti faccio un paio di domande veloci per assicurarmi che ci siano i requisiti per farti parlare col nostro tutor. Sei in un posto tranquillo?

FILTRO VIDEO
"Sei riuscito a guardare tutto il video che ti abbiamo mandato?"
→ SE NO: "Allora riprogrammiamo a quando l'avrai visto, il tutor in consulenza dà per scontate quelle informazioni."

FILTRO PROFESSIONE
"Tra le professioni del video, verso quale sei più indirizzato?"

FILTRO PACCHETTO
"A livello economico, sei più orientato all'Advance da 155€, al Gold da 210€ o all'Exclusive da 320€ al mese in rate?"`,
        emergencyPanel: 'fuga',
    },
    {
        title: '2 — Fase 1: domande iniziali',
        kind: 'targetChecklist',
        voice:
            'Tono tranquillo, amichevole. Come un amico che ti chiede "dimmi, cosa ti è successo?". Ascolta il DOPPIO di quanto parli. Ripeti le parole esatte del lead per ancorarle.',
        sets: {
            generale: [
                {
                    title: 'Contesto, episodio, emozione',
                    items: [
                        'Cosa ti ha spinto a cercare una soluzione e a chiederci informazioni proprio adesso?',
                        'Da quanti anni o mesi vai avanti con questa situazione?',
                        'Qual è stata la "goccia che ha fatto traboccare il vaso" in questi giorni?',
                        'Quando è che ti pesa di più questa situazione durante la settimana?',
                        'Mi fai un esempio pratico? Com\'è una tua giornata tipo quando le cose vanno male a lavoro?',
                        'Qual è la cosa che ti dà più fastidio in assoluto di quello che fai oggi?',
                        'Che storia ti racconti in quei momenti per tirare avanti e farti forza?',
                        'A fine giornata, ti senti più stanco fisicamente o esaurito mentalmente?',
                        'Cosa ti fa provare questa situazione quando stacchi e torni a casa?',
                        'In una scala da 1 a 10, quanto sei insoddisfatto della tua routine? Perché proprio quel numero?',
                    ],
                },
            ],
            imprenditori: [
                {
                    title: 'Imprenditore / Partita IVA',
                    items: [
                        'Visto che hai già una tua attività, cerchi queste competenze per gestire tu stesso il marketing o sei stanco di pagare agenzie esterne senza vedere risultati?',
                        'Oggi quante ore dedichi fisicamente all\'attività? Riesci a staccare o sei sempre operativo?',
                        'Come trovi i clienti oggi? Vai a tentativi col passaparola o hai un sistema preciso?',
                        'Qual è l\'ostacolo più grande che stai affrontando oggi con la tua azienda?',
                    ],
                },
            ],
            extra_skills: [
                {
                    title: 'Vuole solo competenze in più',
                    items: [
                        'Di solito nessuno si mette a studiare la sera per hobby. Qual è il vero motivo? Cerchi un aumento dove sei oggi o sotto sotto vorresti un piano B?',
                        'C\'è stata una situazione recente a lavoro in cui ti sei sentito superato da altri o tagliato fuori perché ti mancavano queste competenze?',
                        'Ti senti valorizzato per quello che sai fare oggi o hai l\'impressione di aver raggiunto il tetto massimo?',
                    ],
                },
            ],
        },
    },
    {
        title: '3 — Fase 2: costo e conseguenza',
        kind: 'targetChecklist',
        voice:
            'Tono più serio, empatico — come un dottore che fa una diagnosi. Pause lunghe (3-4 sec) dopo la risposta. Il silenzio lo fa ragionare.',
        sets: {
            generale: [
                {
                    title: 'Fai ammettere il costo di non cambiare',
                    items: [
                        'Quanto ti sta costando questa situazione in termini di energie, serenità e tempo perso?',
                        'Che impatto reale sta avendo sul rapporto con chi ti sta vicino e sulla tua vita privata?',
                        'Se l\'aspetto economico è un peso, quanto ti frustra non poterti togliere delle soddisfazioni dopo aver lavorato tutto il mese?',
                        'Qual è l\'ultima cosa a cui hai dovuto rinunciare ultimamente per colpa dei soldi o del poco tempo?',
                        'Se fra 6 mesi o un anno le cose fossero identiche a oggi, cosa cambierebbe in peggio per te?',
                        'Qual è lo scenario futuro per la tua vita che vuoi assolutamente evitare?',
                    ],
                },
            ],
            imprenditori: [
                {
                    title: 'Imprenditore / P. IVA',
                    items: [
                        'Quanto ti sta costando ogni mese, in mancati incassi, il fatto di non sapere come acquisire clienti online in modo continuo?',
                        'Se continui a sperare solo nel passaparola, come vedi i bilanci della tua azienda tra due anni?',
                        'Che impatto sta avendo sulla tua vita privata il dover dedicare tutte queste ore all\'azienda senza vedere i margini puliti che vorresti?',
                        'Quanto ti fa rabbia vedere concorrenti, magari meno bravi di te, che fatturano di più solo perché sanno vendersi meglio online?',
                    ],
                },
            ],
            extra_skills: [
                {
                    title: 'Vuole solo competenze in più',
                    items: [
                        'Quanto ti costa, a livello di autostima, sentirti fermo nella stessa routine da anni senza imparare più nulla?',
                        'Quanto ti brucia vedere colleghi che fanno carriera o guadagnano di più solo perché hanno competenze più aggiornate delle tue?',
                        'Se tra tre anni fossi esattamente nella stessa posizione di oggi e con lo stesso stipendio, saresti fiero di te o te ne pentiresti?',
                        'Se non ti aggiorni adesso, hai considerato il rischio reale di diventare obsoleto o di essere rimpiazzato dall\'intelligenza artificiale?',
                    ],
                },
            ],
        },
    },
    {
        title: '4 — Fase 3: blocco + pre-framing',
        kind: 'checklist',
        voice:
            'Voce bassa, lenta, chirurgica. Qui anticipi le scuse di fine chiamata. Pausa DOPO aver fatto la domanda, prima di proseguire.',
        sections: [
            {
                title: 'Indagine sul blocco reale',
                items: [
                    'Cosa ti ha impedito di risolvere definitivamente questa situazione finora?',
                    'Qual è il punto esatto in cui di solito molli o lasci perdere quando provi a fare un cambiamento?',
                    'Cosa hai già provato a fare in passato e perché non ha funzionato?',
                ],
            },
            {
                title: 'Pre-framing Budget (filtro vitale)',
                items: [
                    'Visto che le rate vanno dai 155€ ai 320€ al mese, sii onesto: questa cifra per te significa tagliare qualche piccola spesa extra, o ti toglierebbe materialmente i soldi per mangiare? (Se non ha soldi per la spesa → annullare l\'appuntamento. Non passare lead senza budget.)',
                    'Se il tutor ti fa capire chiaramente come rientrare di questo investimento lavorando in questo settore, saresti disposto a fare qualche sacrificio all\'inizio?',
                    '[Solo imprenditori] Sei d\'accordo che investire 155€-320€ al mese per l\'azienda non è una spesa, ma uno strumento di lavoro per non farsi schiacciare?',
                ],
            },
            {
                title: 'Pre-framing Partner',
                items: [
                    'Per le decisioni sul tuo futuro lavorativo, decidi in autonomia o ne devi parlare per forza col tuo partner?',
                    '(Se deve parlarne) Se tu gli spiegassi che questa cosa può farti stare meglio e portarti un\'entrata in più, ti ostacolerebbe o farebbe il tifo per te? (Attendi: fa il tifo)',
                    'Quindi se domani il tutor ti chiarisce tutto, la decisione finale dipende solo ed esclusivamente da te, corretto?',
                ],
            },
            {
                title: 'Pre-framing Decisione e impegno',
                items: [
                    'Ti spaventa di più dover faticare a studiare la sera o restare bloccato per sempre dove sei oggi?',
                    'Molti a fine chiamata dicono "ci devo pensare" solo per paura di fare il passo. Tu sei uno che affronta le cose o uno che rimanda sempre?',
                    'Il nostro tutor ti dirà le cose come stanno, in modo molto diretto. Accetti la franchezza o preferisci chi ti dà solo false rassicurazioni?',
                    '[Solo extra skills] Noi formiamo persone per farle lavorare, non per hobby. Sei disposto a metterti in gioco seriamente?',
                    'Se domani il tutor valuta che hai le carte in regola per certificarti con noi, sei pronto a iscriverti e partire?',
                    'Mi assicuri che domani sarai da solo davanti al PC e in un posto silenzioso per ascoltare bene?',
                ],
            },
        ],
    },
    {
        title: '5 — Il patto di ferro',
        kind: 'content',
        voice:
            'Tono FERMO, asciutto, autorevole. Non una preghiera — una regola d\'ingaggio. Fine chiamata: blindi la chiusura.',
        content: `Ok #NOME#, la situazione è chiara. Confermo l'appuntamento per #GIORNO# alle #ORA#.

Ti spiego solo come funziona. Andrai in chiamata con il tutor, che ti farà un po' di domande per conoscerti. Se si rende conto che non fa per te o non hai l'attitudine, te lo dice chiaramente in faccia e la cosa finisce lì.

Ma se capisce che hai del potenziale, alla fine ti spiegherà tutto nel dettaglio: costi, garanzie, e metodo di studio. Visto che avrai tutte le informazioni sul tavolo, ti chiederà di prendere una decisione direttamente in chiamata con lui: un "Sì, lo voglio fare" o un "No, non fa per me".

Te lo dico perché noi non accettiamo i "Ci devo pensare"; avendo già tutto chiaro, sappiamo benissimo che il "ci penso" è solo una scusa usata per non decidere e farsi bloccare dalla paura. Se la cosa non ti convince dici di no e amici come prima, ma in modo chiaro.

Visto che mi hai appena detto che sei uno che affronta le cose, mi confermi che alla fine della chiamata sarai pronto a dargli un Sì o un No definitivo?

→ SE DICE SÌ: saluti e chiudi.
→ SE FA OBIEZIONI: usa il pannello "Gestisci obiezione" qui sopra.`,
        emergencyPanel: 'obiezioni',
    },
]

type EmergencyCard = { trigger: string; response: string }
const PANEL_FUGA: { title: string; subtitle: string; cards: EmergencyCard[] } = {
    title: 'Gestisci fuga — lead che cerca di annullare',
    subtitle: 'Non supplicare. Usa queste domande per farlo ragionare.',
    cards: [
        {
            trigger: '"Ci ho ripensato / Non mi interessa più"',
            response: `Capisco #NOME#. Però ti faccio una domanda: da quando hai lasciato i dati a oggi ti hanno per caso cambiato contratto o alzato lo stipendio? (Attendi il no). Esatto. Quindi la tua situazione è identica a prima. Spesso non è che non interessa più, è che subentra la paura di mettersi in gioco per davvero. La consulenza serve proprio a farti un'analisi della situazione, poi mal che vada ci saluti. Fissiamo e togliti questo dubbio, d'accordo?`,
        },
        {
            trigger: '"Ho visto i costi, non ho soldi, è inutile farla"',
            response: `Apprezzo la sincerità. Ma ascoltami: annullando la chiamata, la tua situazione economica migliorerà domani mattina? No. Il fatto che tu faccia fatica a fine mese è proprio il motivo per cui dovresti parlarne con noi e capire come crearti un'entrata in più. Fatti spiegare dal tutor se ci sono soluzioni fattibili per te, non chiuderti l'unica porta in faccia da solo. Che orario blocchiamo?`,
        },
        {
            trigger: '"Sono troppo incasinato col lavoro, non ho tempo"',
            response: `Il posto posso anche cederlo, non è un problema. Però riflettici un attimo: se sei così incastrato in un lavoro che non ti soddisfa da non trovare 50 minuti per uscirne, non credi sia arrivato il momento di cambiare qualcosa? Lavorare da remoto serve proprio a ridarti il tempo che oggi non hai. Prenditi questo spazio per te, altrimenti non cambierà mai nulla. Lasciamo confermato l'orario?`,
        },
    ],
}

const PANEL_OBIEZIONI: { title: string; subtitle: string; cards: EmergencyCard[] } = {
    title: 'Gestisci obiezione al Patto di Ferro',
    subtitle: 'Se il lead si frena e non vuole promettere di decidere in call, ribatti in modo naturale e senza spiegazioni.',
    cards: [
        {
            trigger: '"Non prendo decisioni a caldo, ci devo pensare qualche giorno"',
            response: `Capisco che tu voglia essere prudente. Ma ragioniamoci un attimo: su cosa dovresti pensare da solo a casa? Domani il tutor ti darà tutte le info su costi, metodo e tempistiche. Quando hai tutti i dati chiari, il "ci devo pensare" non serve a valutare meglio, è solo paura della novità, che è normalissima. Se domani lui ti toglie tutti i dubbi pratici, ti senti pronto a prendere una decisione per te stesso o ti fai bloccare?`,
        },
        {
            trigger: '"Costa troppo / L\'investimento mi frena / Devo farmi i conti"',
            response: `I conti li farai domani al centesimo col tutor, non ti preoccupare. Però ti chiedo: quanto ti sta già costando, a livello economico e di stress, rimanere nella situazione in cui sei ora? Quella è una spesa fissa reale che hai tutti i mesi, e non cambierà da sola. Andiamo in chiamata per capire se ci sono le basi per farti svoltare e farti recuperare i soldi investiti, senza fasciarti la testa prima di iniziare, ok?`,
        },
        {
            trigger: '"Prima devo assolutamente parlarne con mia moglie / mio marito"',
            response: `Fai bene a confrontarti a casa. Ma in base a quello che mi hai detto prima: se domani capisci che questa è la strada giusta per migliorare la tua vita e le vostre entrate, a casa ti bloccano o ti appoggiano? (Attendi: Ti appoggiano). Esatto. Quindi l'ostacolo non è la tua famiglia, sei tu. Sei tu che devi decidere se vuoi metterti sotto a studiare la sera. Se tu decidi di farlo, a casa hai solo supporto. Domani non nasconderti dietro la famiglia, assumiti tu la responsabilità di decidere per te stesso. Sei d'accordo?`,
        },
        {
            trigger: '"Ho un po\' d\'ansia / Ho paura di non farcela / Devo valutare bene"',
            response: `Avere dei dubbi e un po' d'ansia è normalissimo, significa che stai prendendo la cosa sul serio. Se non avessi paura vorrebbe dire che non stai cambiando nulla della tua vita. Il tutor è lì proprio per capire se sei portato o no; se non ce la puoi fare, te lo dice lui per primo. Ma se lui valuta che hai le carte in regola, sei disposto a mettere da parte l'ansia e a provarci seriamente?`,
        },
    ],
}

type Target = 'generale' | 'imprenditori' | 'extra_skills'
const TARGET_LABEL: Record<Target, string> = {
    generale: 'Generale',
    imprenditori: 'Imprenditore / P.IVA',
    extra_skills: 'Solo extra skills',
}

export function ConfermeScriptWidget() {
    const [current, setCurrent] = useState(0)
    const [target, setTarget] = useState<Target>('generale')
    const [checkedItems, setCheckedItems] = useState<Record<string, Set<string>>>({})
    const [showVoice, setShowVoice] = useState(false)
    const [panelOpen, setPanelOpen] = useState<null | 'fuga' | 'obiezioni'>(null)

    const block = BLOCKS[current]

    const blockKey = useMemo(() => {
        if (block.kind === 'targetChecklist') return `${current}-${target}`
        return `${current}`
    }, [current, target, block])

    const checked = checkedItems[blockKey] || new Set<string>()
    const progress = ((current + 1) / BLOCKS.length) * 100

    const canGoNext = current < BLOCKS.length - 1
    const canGoPrev = current > 0
    const goNext = () => canGoNext && setCurrent(c => c + 1)
    const goPrev = () => canGoPrev && setCurrent(c => c - 1)
    const reset = () => {
        setCurrent(0)
        setCheckedItems({})
        setTarget('generale')
        setShowVoice(false)
        setPanelOpen(null)
    }

    const toggleCheck = (key: string) => {
        setCheckedItems(prev => {
            const s = new Set(prev[blockKey] || [])
            if (s.has(key)) s.delete(key); else s.add(key)
            return { ...prev, [blockKey]: s }
        })
    }

    const hasEmergency = block.kind === 'content' && block.emergencyPanel
    const emergencyLabel = hasEmergency && block.kind === 'content' && block.emergencyPanel === 'fuga'
        ? 'Gestisci fuga' : 'Gestisci obiezione'
    const EmergencyIcon = hasEmergency && block.kind === 'content' && block.emergencyPanel === 'fuga' ? LifeBuoy : Shield

    return (
        <div className="w-full max-w-3xl mx-auto">
            {/* Top bar */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <button onClick={goPrev} disabled={!canGoPrev} className="p-1.5 rounded-lg border border-ash-200 hover:bg-ash-50 disabled:opacity-30 transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-mono text-ash-500 tabular-nums">{current + 1} / {BLOCKS.length}</span>
                    <button onClick={goNext} disabled={!canGoNext} className="p-1.5 rounded-lg border border-ash-200 hover:bg-ash-50 disabled:opacity-30 transition-colors">
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setShowVoice(v => !v)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${showVoice ? 'bg-brand-orange/10 border-brand-orange/30 text-brand-orange-700' : 'border-ash-200 text-ash-500 hover:bg-ash-50'}`}>
                        <Mic className="w-3.5 h-3.5" /> Voce
                    </button>
                    {hasEmergency && block.kind === 'content' && block.emergencyPanel && (
                        <button
                            onClick={() => setPanelOpen(block.emergencyPanel!)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
                        >
                            <EmergencyIcon className="w-3.5 h-3.5" /> {emergencyLabel}
                        </button>
                    )}
                    <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                        <RotateCcw className="w-3.5 h-3.5" /> Nuova chiamata
                    </button>
                </div>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-ash-100 rounded-full mb-4 overflow-hidden">
                <div className="h-full bg-brand-orange rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>

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

                    {/* Target pills */}
                    {block.kind === 'targetChecklist' && (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                            {(Object.keys(TARGET_LABEL) as Target[]).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setTarget(t)}
                                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${target === t ? 'bg-brand-orange text-white border-brand-orange' : 'bg-white text-ash-700 border-ash-200 hover:bg-ash-50'}`}
                                >
                                    {TARGET_LABEL[t]}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Content block */}
                    {block.kind === 'content' && (
                        <div className="text-[15px] leading-[1.85] text-ash-800 whitespace-pre-line">
                            {block.content}
                        </div>
                    )}

                    {/* Target-filtered checklist */}
                    {block.kind === 'targetChecklist' && (
                        <ChecklistSections
                            sections={block.sets[target]}
                            checked={checked}
                            onToggle={toggleCheck}
                        />
                    )}

                    {/* Plain checklist */}
                    {block.kind === 'checklist' && (
                        <ChecklistSections sections={block.sections} checked={checked} onToggle={toggleCheck} />
                    )}
                </div>
            </div>

            {/* Emergency panel */}
            {panelOpen && (
                <EmergencyModal
                    data={panelOpen === 'fuga' ? PANEL_FUGA : PANEL_OBIEZIONI}
                    onClose={() => setPanelOpen(null)}
                />
            )}
        </div>
    )
}

function ChecklistSections({
    sections, checked, onToggle,
}: {
    sections: QuestionSet[]
    checked: Set<string>
    onToggle: (key: string) => void
}) {
    return (
        <div>
            {sections.map((sec, si) => (
                <div key={si} className="mb-4">
                    <div className="text-xs font-bold text-brand-orange uppercase tracking-wider mb-2">{sec.title}</div>
                    {sec.items.map((item, ii) => {
                        const key = `${si}-${ii}`
                        const isChecked = checked.has(key)
                        return (
                            <div
                                key={key}
                                onClick={() => onToggle(key)}
                                className={`flex items-start gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-ash-50 ${isChecked ? 'opacity-50' : ''}`}
                            >
                                <input type="checkbox" checked={isChecked} onChange={() => {}} className="mt-0.5 w-4 h-4 accent-brand-orange flex-shrink-0 cursor-pointer" />
                                <span className={`text-sm leading-relaxed ${isChecked ? 'line-through text-ash-400' : 'text-ash-800'}`}>{item}</span>
                            </div>
                        )
                    })}
                </div>
            ))}
        </div>
    )
}

function EmergencyModal({
    data, onClose,
}: {
    data: { title: string; subtitle: string; cards: EmergencyCard[] }
    onClose: () => void
}) {
    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-2 sm:p-6 bg-ash-900/60 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4 flex flex-col max-h-[95vh]">
                <div className="flex items-center justify-between border-b border-ash-200 px-4 sm:px-6 py-3 sticky top-0 bg-white rounded-t-2xl z-10">
                    <div>
                        <h2 className="text-base font-bold text-ash-900">{data.title}</h2>
                        <p className="text-[11px] text-ash-500">{data.subtitle}</p>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-ash-400 hover:text-ash-600 hover:bg-ash-100 rounded-full text-lg leading-none">✕</button>
                </div>
                <div className="flex-1 overflow-auto p-3 sm:p-4 space-y-2">
                    {data.cards.map((c, i) => <EmergencyAccordion key={i} card={c} />)}
                </div>
            </div>
        </div>
    )
}

function EmergencyAccordion({ card }: { card: EmergencyCard }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="rounded-xl border border-ash-200 bg-white overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ash-50"
            >
                <span className="text-sm font-semibold text-ash-900">{card.trigger}</span>
                <ChevronDown className={`w-4 h-4 text-ash-500 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="px-4 py-3 border-t border-ash-100 bg-ash-50/50 text-[14px] leading-[1.75] text-ash-800 whitespace-pre-line">
                    {card.response}
                </div>
            )}
        </div>
    )
}
