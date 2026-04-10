"use client"

import { useState, useEffect, useRef } from "react"
import { LeadCard } from "./LeadCard"
import dynamic from "next/dynamic"

const OutcomeModal = dynamic(
  () => import("./OutcomeModal").then(mod => mod.OutcomeModal),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { Flame, Inbox } from "lucide-react"

type LeadList = any[]

export function PipelineBoard({
    firstCall,
    secondCall,
    thirdCall,
    fourthCall = [],
    isFourthCallActive = false,
    recalls = []
}: {
    firstCall: LeadList
    secondCall: LeadList
    thirdCall: LeadList
    fourthCall?: LeadList
    isFourthCallActive?: boolean
    recalls?: LeadList
}) {
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'first' | 'second' | 'third' | 'fourth'>('first')
    const [isTransitioning, setIsTransitioning] = useState(false)
    const tabIndicatorRef = useRef<HTMLDivElement>(null)
    const tabContainerRef = useRef<HTMLDivElement>(null)

    // --- RECALL WATCHER ---
    const [alertedRecalls, setAlertedRecalls] = useState<Set<string>>(new Set())

    useEffect(() => {
        const interval = setInterval(() => {
            const nowTime = new Date().getTime();

            setAlertedRecalls(prev => {
                const updatedSet = new Set(prev);
                let newlyAlerted = false;

                recalls.forEach(lead => {
                    if (lead.recallDate) {
                        const recallTime = new Date(lead.recallDate).getTime();
                        if (recallTime <= nowTime && !updatedSet.has(lead.id)) {
                            alert(`⏰ SVEGLIA RICHIAMO GDO\n\nÈ arrivato il momento di chiamare:\n👤 ${lead.name}\n📞 ${lead.phone}`);
                            updatedSet.add(lead.id);
                            newlyAlerted = true;
                        }
                    }
                });

                return newlyAlerted ? updatedSet : prev;
            });

        }, 30000);

        return () => clearInterval(interval);
    }, [recalls]);

    // Tab transition handler
    const switchTab = (tab: 'first' | 'second' | 'third' | 'fourth') => {
        if (tab === activeTab) return
        setIsTransitioning(true)
        setTimeout(() => {
            setActiveTab(tab)
            setIsTransitioning(false)
        }, 150)
    }

    // Sliding indicator position (GPU-accelerated via transform)
    useEffect(() => {
        if (!tabIndicatorRef.current || !tabContainerRef.current) return
        const activeBtn = tabContainerRef.current.querySelector<HTMLButtonElement>(`[data-tab="${activeTab}"]`)
        if (activeBtn) {
            const containerRect = tabContainerRef.current.getBoundingClientRect()
            const btnRect = activeBtn.getBoundingClientRect()
            const offsetX = btnRect.left - containerRect.left
            tabIndicatorRef.current.style.transform = `translateX(${offsetX}px)`
            tabIndicatorRef.current.style.width = `${btnRect.width}px`
        }
    }, [activeTab, isFourthCallActive])

    const getCurrentList = () => {
        switch (activeTab) {
            case 'first': return firstCall
            case 'second': return secondCall
            case 'third': return thirdCall
            case 'fourth': return fourthCall
            default: return firstCall
        }
    }

    const currentList = getCurrentList()

    const tabConfig = [
        { key: 'first' as const, label: '1ª Chiamata', count: firstCall.length, color: 'brand-orange' },
        { key: 'second' as const, label: '2ª Chiamata', count: secondCall.length, color: 'gold' },
        { key: 'third' as const, label: '3ª Chiamata', count: thirdCall.length, color: 'ember' },
    ]

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl border border-ash-200 shadow-card overflow-hidden">

            {/* STICKY HEADER & TAB BAR */}
            <div className="bg-white border-b border-ash-200/60 px-2 sm:px-4 pt-4 pb-3 shadow-sm rounded-t-xl">
                <div className="flex flex-wrap items-center justify-between gap-4">

                    {/* TABS */}
                    <div className="relative flex space-x-1 bg-ash-100/80 p-1 rounded-xl" ref={tabContainerRef}>
                        {/* Sliding active indicator */}
                        <div
                            ref={tabIndicatorRef}
                            className="absolute top-1 bottom-1 left-0 bg-white rounded-lg shadow-card ease-out"
                            style={{ zIndex: 0, transition: 'transform 300ms ease-out, width 300ms ease-out' }}
                        />

                        {tabConfig.map(tab => (
                            <button
                                key={tab.key}
                                data-tab={tab.key}
                                onClick={() => switchTab(tab.key)}
                                className={`relative z-10 px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors duration-200 flex items-center gap-2 ${
                                    activeTab === tab.key
                                        ? 'text-ash-900'
                                        : 'text-ash-500 hover:text-ash-700'
                                }`}
                            >
                                {tab.label}
                                <div className={`text-[11px] font-bold px-2 py-0.5 rounded-full transition-colors duration-200 ${
                                    activeTab === tab.key
                                        ? tab.key === 'first' ? 'bg-brand-orange-100 text-brand-orange-700'
                                        : tab.key === 'second' ? 'bg-gold-100 text-gold-700'
                                        : 'bg-ember-100 text-ember-700'
                                        : 'bg-ash-200/80 text-ash-500'
                                }`}>
                                    {tab.count}
                                </div>
                            </button>
                        ))}

                        {isFourthCallActive && (
                            <div className="relative group z-10">
                                <button
                                    data-tab="fourth"
                                    onClick={() => switchTab('fourth')}
                                    className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors duration-200 flex items-center gap-2 ${
                                        activeTab === 'fourth'
                                            ? 'text-ember-700'
                                            : 'text-ember-400 hover:text-ember-600'
                                    }`}
                                >
                                    <Flame className={`w-3.5 h-3.5 ${activeTab === 'fourth' ? 'text-ember-500' : 'text-ember-300'}`} />
                                    4ª Recupero
                                    <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${
                                        activeTab === 'fourth'
                                            ? 'bg-ember-100 text-ember-700'
                                            : 'bg-ember-50 text-ember-400'
                                    }`}>
                                        {fourthCall.length}
                                    </div>
                                </button>
                                {/* Tooltip */}
                                <div className="absolute hidden group-hover:block w-56 sm:w-64 p-2.5 bg-ash-800 text-white text-xs rounded-lg shadow-elevated -bottom-12 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none max-w-[calc(100vw-2rem)]">
                                    Attiva perché il tuo tasso di fissaggio è sotto 14% (ultimi 7 giorni).
                                    <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 rotate-45 w-2 h-2 bg-ash-800" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* LIST AREA */}
            <div className="flex-1 overflow-y-auto bg-gradient-to-b from-ash-50/50 to-white p-2 sm:p-4 pb-48">
                <div className={`flex flex-col gap-2.5 max-w-7xl mx-auto transition-opacity duration-150 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
                    {currentList.map((lead, index) => (
                        <div
                            key={lead.id}
                            className="animate-fade-in"
                            style={{ animationDelay: `${Math.min(index * 30, 300)}ms`, animationFillMode: 'backwards' }}
                        >
                            <LeadCard
                                lead={lead}
                                onOutcomeClick={setSelectedLeadId}
                                isRowLayout={true}
                            />
                        </div>
                    ))}

                    {currentList.length === 0 && (
                        <div className="flex flex-col items-center justify-center p-16 text-center bg-white border border-dashed border-ash-300 rounded-xl">
                            <div className="w-16 h-16 rounded-2xl bg-ash-100 flex items-center justify-center mb-4">
                                <Inbox className="w-8 h-8 text-ash-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-ash-700">Nessun lead in questa vista</h3>
                            <div className="text-ash-500 mt-1.5 max-w-sm text-sm">Hai completato tutti i contatti di questa fase o non ci sono nuovi import.</div>
                        </div>
                    )}
                </div>
            </div>

            <OutcomeModal
                isOpen={!!selectedLeadId}
                leadId={selectedLeadId || ""}
                leadVersion={(() => {
                    const allLeads = [...firstCall, ...secondCall, ...thirdCall, ...fourthCall]
                    return allLeads.find(l => l.id === selectedLeadId)?.version ?? 0
                })()}
                onClose={() => setSelectedLeadId(null)}
            />
        </div>
    )
}
