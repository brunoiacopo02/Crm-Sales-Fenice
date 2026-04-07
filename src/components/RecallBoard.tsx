"use client"

import { useState, useEffect } from "react"
import { LeadCard } from "./LeadCard"
import dynamic from "next/dynamic"

const OutcomeModal = dynamic(
  () => import("./OutcomeModal").then(mod => mod.OutcomeModal),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { AlertCircle, Clock } from "lucide-react"

type LeadList = any[]

export function RecallBoard({
    expired,
    upcoming
}: {
    expired: LeadList
    upcoming: LeadList
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
                            {activeTab === 'upcoming' && (
                                <div className="absolute top-3 right-2 sm:right-48 z-10 bg-white/90 backdrop-blur px-2 py-0.5 rounded text-xs font-mono font-medium text-brand-orange border border-orange-100 shadow-sm">
                                    {new Date(lead.recallDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                                </div>
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
