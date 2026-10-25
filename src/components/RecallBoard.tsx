"use client"

import { useState, useEffect } from "react"
import { LeadCard } from "./LeadCard"
import dynamic from "next/dynamic"

const OutcomeModal = dynamic(
  () => import("./OutcomeModal").then(mod => mod.OutcomeModal),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { AlertCircle, Clock } from "lucide-react"
import { DirettaUiProvider } from "./diretta/DirettaUi"

type LeadList = any[]

export function RecallBoard({
    expired,
    upcoming,
    variant,
}: {
    expired: LeadList
    upcoming: LeadList
    /** 'diretta' = veste scura del GDO (collaudo del 25/10/2026): stesse card della home. */
    variant?: 'diretta'
}) {
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'expired' | 'upcoming'>('expired')

    // --- RECALL WATCHER ---
    const [alertedRecalls, setAlertedRecalls] = useState<Set<string>>(new Set())

    useEffect(() => {
        const interval = setInterval(() => {
            const nowTime = new Date().getTime();
            const allLeads = [...expired, ...upcoming];

            setAlertedRecalls(prev => {
                const updatedSet = new Set(prev);
                let newlyAlerted = false;

                allLeads.forEach(lead => {
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

        }, 30000); // Check every 30s

        return () => clearInterval(interval);
    }, [expired, upcoming]);

    const currentList = activeTab === 'expired' ? expired : upcoming
    const versioneDi = (id: string | null) => [...expired, ...upcoming].find(l => l.id === id)?.version ?? 0

    // ── Veste Diretta: le card della home (due righe, esiti sempre visibili),
    // stessi esiti e stessa sveglia dei richiami.
    if (variant === 'diretta') {
        const tabs = [
            { key: 'expired' as const, label: 'Da richiamare ora', count: expired.length },
            { key: 'upcoming' as const, label: 'In arrivo', count: upcoming.length },
        ]
        return (
            <div className="d-board mx-auto flex w-full max-w-5xl flex-col">
                <div role="tablist" aria-label="Richiami" className="flex shrink-0 gap-1 overflow-x-auto pb-3">
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-[14px] transition-colors ${activeTab === tab.key
                                ? 'bg-[#F2F2F2] font-semibold text-[#171717]'
                                : 'text-[#BFBFBF] hover:text-[#F2F2F2]'}`}
                        >
                            {tab.label} <span className="tabular-nums">{tab.count}</span>
                        </button>
                    ))}
                </div>

                <div className="flex flex-col gap-2.5 pb-24">
                    {currentList.map(lead => (
                        <DirettaUiProvider key={lead.id}>
                            <LeadCard lead={lead} onOutcomeClick={setSelectedLeadId} isRowLayout={true} />
                        </DirettaUiProvider>
                    ))}
                    {currentList.length === 0 && (
                        <div className="rounded-2xl border-2 border-[#262626] px-6 py-12 text-center">
                            <div className="text-[16px] font-semibold text-[#F2F2F2]">
                                {activeTab === 'expired' ? 'Nessun richiamo da fare adesso' : 'Nessun richiamo in arrivo'}
                            </div>
                            <div className="mt-1 text-[14px] text-[#BFBFBF]">
                                {activeTab === 'expired' ? 'Hai gestito tutti i richiami scaduti.' : 'Non ci sono chiamate programmate.'}
                            </div>
                        </div>
                    )}
                </div>

                <OutcomeModal
                    isOpen={!!selectedLeadId}
                    leadId={selectedLeadId || ""}
                    leadVersion={versioneDi(selectedLeadId)}
                    onClose={() => setSelectedLeadId(null)}
                />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden max-w-5xl mx-auto">

            {/* STICKY HEADER & TAB BAR */}
            <div className="sticky top-0 z-20 bg-white border-b border-gray-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">

                    {/* TABS */}
                    <div className="flex space-x-1 bg-gray-100/80 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('expired')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'expired' ? 'bg-red-50 text-red-700 ring-1 ring-red-200 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <AlertCircle className={`h-4 w-4 ${activeTab === 'expired' ? 'text-red-500' : ''}`} />
                            Da Richiamare Ora <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{expired.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('upcoming')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'upcoming' ? 'bg-white text-brand-orange ring-1 ring-brand-orange/20 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <Clock className={`h-4 w-4 ${activeTab === 'upcoming' ? 'text-brand-orange' : ''}`} />
                            In Arrivo <span className="text-xs bg-brand-orange/10 text-brand-orange px-1.5 py-0.5 rounded-full">{upcoming.length}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* LIST AREA */}
            <div className="flex-1 overflow-y-auto bg-gray-50/30 p-2 sm:p-4 pb-48">
                <div className="flex flex-col gap-3 max-w-5xl mx-auto">
                    {currentList.map((lead) => (
                        <div key={lead.id} className="relative">
                            {activeTab === 'expired' && (
                                <div className="absolute -left-1 top-4 h-3 w-3 rounded-full bg-red-500 animate-pulse border-2 border-white shadow-sm z-20" />
                            )}
                            <LeadCard
                                lead={lead}
                                onOutcomeClick={setSelectedLeadId}
                                isRowLayout={true}
                            />
                        </div>
                    ))}

                    {currentList.length === 0 && (
                        <div className="flex flex-col items-center justify-center p-12 text-center bg-white border border-dashed border-gray-300 rounded-xl">
                            <span className="text-5xl mb-4">{activeTab === 'expired' ? '✅' : '🗓️'}</span>
                            <h3 className="text-lg font-medium text-gray-900">
                                {activeTab === 'expired' ? 'Nessun richiamo in sospeso' : 'Nessun richiamo programmato'}
                            </h3>
                            <p className="text-gray-500 mt-1 max-w-sm">
                                {activeTab === 'expired' ? 'Hai gestito tutte le urgenze.' : 'Non ci sono chiamate pianificate nel futuro.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <OutcomeModal
                isOpen={!!selectedLeadId}
                leadId={selectedLeadId || ""}
                leadVersion={(() => {
                    const allLeads = [...expired, ...upcoming]
                    return allLeads.find(l => l.id === selectedLeadId)?.version ?? 0
                })()}
                onClose={() => setSelectedLeadId(null)}
            />
        </div>
    )
}
