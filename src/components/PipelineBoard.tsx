"use client"

import { useState } from "react"
import { LeadCard } from "./LeadCard"
import { OutcomeModal } from "./OutcomeModal"

type LeadList = any[]

export function PipelineBoard({
    firstCall,
    secondCall,
    thirdCall,
    fourthCall = [],
    isFourthCallActive = false
}: {
    firstCall: LeadList
    secondCall: LeadList
    thirdCall: LeadList
    fourthCall?: LeadList
    isFourthCallActive?: boolean
}) {
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'first' | 'second' | 'third' | 'fourth'>('first')

    // Helper per ottenere la lista corrente
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

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

            {/* STICKY HEADER & TAB BAR */}
            <div className="sticky top-0 z-20 bg-white border-b border-gray-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">

                    {/* TABS */}
                    <div className="flex space-x-1 bg-gray-100/80 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('first')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'first' ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            1ª Chiamata <span className="ml-1.5 text-xs bg-gray-200/80 px-1.5 py-0.5 rounded-full">{firstCall.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('second')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'second' ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            2ª Chiamata <span className="ml-1.5 text-xs bg-gray-200/80 px-1.5 py-0.5 rounded-full">{secondCall.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('third')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'third' ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            3ª Chiamata <span className="ml-1.5 text-xs bg-gray-200/80 px-1.5 py-0.5 rounded-full">{thirdCall.length}</span>
                        </button>
                        {isFourthCallActive && (
                            <div className="relative group">
                                <button
                                    onClick={() => setActiveTab('fourth')}
                                    className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-1 ${activeTab === 'fourth' ? 'bg-orange-50 text-brand-orange shadow-sm ring-1 ring-orange-200' : 'text-orange-600/70 hover:text-brand-orange'}`}
                                >
                                    4ª Chiamata
                                    <span className="ml-1 text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Recupero</span>
                                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'fourth' ? 'bg-orange-200 text-orange-800' : 'bg-orange-100 text-orange-800'}`}>{fourthCall.length}</span>
                                </button>
                                {/* Tooltip */}
                                <div className="absolute hidden group-hover:block w-64 p-2 bg-gray-800 text-white text-xs rounded-md shadow-lg -bottom-10 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
                                    Attiva perché il tuo tasso di fissaggio è sotto 14% (ultimi 7 giorni).
                                    <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 rotate-45 w-2 h-2 bg-gray-800" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* LIST AREA (SINGLE SECTION ROW LAYOUT) */}
            <div className="flex-1 overflow-y-auto bg-gray-50/30 p-4">
                <div className="flex flex-col gap-3 max-w-7xl mx-auto">
                    {currentList.map((lead) => (
                        <LeadCard
                            key={lead.id}
                            lead={lead}
                            onOutcomeClick={setSelectedLeadId}
                            isRowLayout={true}
                        />
                    ))}

                    {currentList.length === 0 && (
                        <div className="flex flex-col items-center justify-center p-12 text-center bg-white border border-dashed border-gray-300 rounded-xl">
                            <span className="text-5xl mb-4">📭</span>
                            <h3 className="text-lg font-medium text-gray-900">Nessun lead in questa vista</h3>
                            <p className="text-gray-500 mt-1 max-w-sm">Hai completato tutti i contatti di questa fase o non ci sono nuovi import.</p>
                        </div>
                    )}
                </div>
            </div>

            <OutcomeModal
                isOpen={!!selectedLeadId}
                leadId={selectedLeadId || ""}
                onClose={() => setSelectedLeadId(null)}
            />
        </div>
    )
}
