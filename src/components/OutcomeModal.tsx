"use client"

import { useState } from "react"
import { Ban, PhoneOff, CalendarClock, Handshake, X } from "lucide-react"
import { updateLeadOutcome } from "@/app/actions/pipelineActions"
import { useRouter } from "next/navigation"

type OutcomeModalProps = {
    leadId: string
    isOpen: boolean
    onClose: () => void
}

const DISCARD_REASONS = [
    "non interessato",
    "disoccupato",
    "straniero",
    "solo informazioni",
    "non vuole prendere l'appuntamento"
]

export function OutcomeModal({ leadId, isOpen, onClose }: OutcomeModalProps) {
    const router = useRouter()
    const [outcome, setOutcome] = useState<'DA_SCARTARE' | 'NON_RISPOSTO' | 'RICHIAMO' | 'APPUNTAMENTO' | null>(null)
    const [note, setNote] = useState("")
    const [dateStr, setDateStr] = useState("")
    const [discardReason, setDiscardReason] = useState("")
    const [loading, setLoading] = useState(false)

    if (!isOpen) return null

    const handleSubmit = async () => {
        if (!outcome) return
        setLoading(true)

        try {
            let targetDate: Date | undefined = undefined
            if ((outcome === 'RICHIAMO' || outcome === 'APPUNTAMENTO') && dateStr) {
                targetDate = new Date(dateStr)
            }

            await updateLeadOutcome(leadId, outcome, note, targetDate, undefined, outcome === 'DA_SCARTARE' ? discardReason : undefined)
            router.refresh()
            onClose()
        } catch (e) {
            alert("Errore nell'aggiornamento dell'esito")
        } finally {
            setLoading(false)
        }
    }

    const isDateRequired = outcome === 'RICHIAMO' || outcome === 'APPUNTAMENTO'
    const isDiscardReasonRequired = outcome === 'DA_SCARTARE'
    const isSubmitDisabled = !outcome || (isDateRequired && !dateStr) || (isDiscardReasonRequired && !discardReason) || loading

    return (
        <>
            {/* Backdrop overlay */}
            <div
                className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-[2px] animate-in fade-in transition-opacity"
                onClick={onClose}
            ></div>

            {/* Side Drawer */}
            <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-300 sm:max-w-md border-l border-gray-200">

                {/* Header */}
                <div className="px-6 py-5 border-b flex justify-between items-center bg-gray-50/50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Aggiorna Esito</h2>
                        <p className="text-sm text-gray-500 mt-0.5">Registra l'attività per questo contatto</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Body / Scrollable Content */}
                <div className="p-6 flex-1 overflow-y-auto space-y-6 custom-scrollbar">

                    {/* Outcome Grid */}
                    <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 block">1. Seleziona L'Esito</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setOutcome("NON_RISPOSTO")}
                                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${outcome === "NON_RISPOSTO" ? "border-brand-orange bg-orange-50 text-brand-orange shadow-sm" : "border-gray-100 hover:border-gray-300 hover:bg-gray-50 text-gray-500"}`}
                            >
                                <PhoneOff className={`h-6 w-6 mb-2 ${outcome === 'NON_RISPOSTO' ? 'text-brand-orange' : 'text-gray-400'}`} />
                                <span className="text-sm font-semibold">Non Risposto</span>
                                <span className="text-[10px] mt-1 opacity-70">Riprova più tardi</span>
                            </button>

                            <button
                                onClick={() => setOutcome("RICHIAMO")}
                                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${outcome === "RICHIAMO" ? "border-blue-500 bg-blue-50 text-blue-600 shadow-sm" : "border-gray-100 hover:border-gray-300 hover:bg-gray-50 text-gray-500"}`}
                            >
                                <CalendarClock className={`h-6 w-6 mb-2 ${outcome === 'RICHIAMO' ? 'text-blue-500' : 'text-gray-400'}`} />
                                <span className="text-sm font-semibold">Da Richiamare</span>
                                <span className="text-[10px] mt-1 opacity-70">Pianifica data</span>
                            </button>

                            <button
                                onClick={() => setOutcome("APPUNTAMENTO")}
                                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${outcome === "APPUNTAMENTO" ? "border-green-500 bg-green-50 text-green-600 shadow-sm" : "border-gray-100 hover:border-gray-300 hover:bg-gray-50 text-gray-500"}`}
                            >
                                <Handshake className={`h-6 w-6 mb-2 ${outcome === 'APPUNTAMENTO' ? 'text-green-500' : 'text-gray-400'}`} />
                                <span className="text-sm font-semibold">Appuntamento</span>
                                <span className="text-[10px] mt-1 opacity-70">Fissato con successo</span>
                            </button>

                            <button
                                onClick={() => setOutcome("DA_SCARTARE")}
                                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${outcome === "DA_SCARTARE" ? "border-red-500 bg-red-50 text-red-600 shadow-sm" : "border-gray-100 hover:border-gray-300 hover:bg-gray-50 text-gray-500"}`}
                            >
                                <Ban className={`h-6 w-6 mb-2 ${outcome === 'DA_SCARTARE' ? 'text-red-500' : 'text-gray-400'}`} />
                                <span className="text-sm font-semibold">Scarta Lead</span>
                                <span className="text-[10px] mt-1 opacity-70">Esito Negativo</span>
                            </button>
                        </div>
                    </div>

                    {/* Conditional Fields */}
                    {outcome && (
                        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <label className="text-xs font-bold uppercase tracking-wider text-gray-400 block border-t border-gray-100 pt-5">
                                2. Dettagli {outcome === 'DA_SCARTARE' ? 'di Scarto' : outcome === 'APPUNTAMENTO' ? "dell'Appuntamento" : outcome === 'RICHIAMO' ? 'del Richiamo' : 'Aggiuntivi'}
                            </label>

                            {isDateRequired && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                                        <CalendarClock className="h-4 w-4 text-gray-400" /> Data e Ora *
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={dateStr}
                                        onChange={(e) => setDateStr(e.target.value)}
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-orange/50 focus:border-brand-orange bg-white shadow-sm"
                                        required
                                    />
                                </div>
                            )}

                            {isDiscardReasonRequired && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Motivo Scarto *</label>
                                    <select
                                        value={discardReason}
                                        onChange={(e) => setDiscardReason(e.target.value)}
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 bg-white shadow-sm"
                                        required
                                    >
                                        <option value="" disabled>-- Seleziona il motivo esatto --</option>
                                        {DISCARD_REASONS.map(reason => (
                                            <option key={reason} value={reason}>{reason}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Note Interne (Opzionale)</label>
                                <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    rows={4}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-400 resize-none custom-scrollbar text-sm shadow-sm"
                                    placeholder="Trascrivi i dettagli utili della telefonata..."
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3 mt-auto">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-sm"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitDisabled}
                        className={`flex-[2] px-4 py-2.5 text-white text-sm font-bold rounded-lg shadow-md transition-all ${isSubmitDisabled ? 'bg-gray-300 cursor-not-allowed shadow-none' :
                                outcome === 'DA_SCARTARE' ? 'bg-red-600 hover:bg-red-700' :
                                    outcome === 'APPUNTAMENTO' ? 'bg-green-600 hover:bg-green-700' :
                                        'bg-brand-orange hover:bg-brand-orange-hover'
                            }`}
                    >
                        {loading ? 'Salvataggio in corso...' : 'Conferma Esito'}
                    </button>
                </div>
            </div>
        </>
    )
}

