"use client"

import { useState, useEffect, useCallback } from "react"
import { Ban, PhoneOff, CalendarClock, Handshake, X } from "lucide-react"
import { updateLeadOutcome } from "@/app/actions/pipelineActions"
import { useRouter } from "next/navigation"

type OutcomeModalProps = {
    leadId: string
    leadVersion: number
    isOpen: boolean
    onClose: () => void
}

const DISCARD_REASONS = [
    "non interessato",
    "disoccupato",
    "straniero",
    "solo informazioni",
    "non vuole prendere l'appuntamento",
    "numero inesistente"
]

export function OutcomeModal({ leadId, leadVersion, isOpen, onClose }: OutcomeModalProps) {
    const router = useRouter()
    const [outcome, setOutcome] = useState<'DA_SCARTARE' | 'NON_RISPOSTO' | 'RICHIAMO' | 'APPUNTAMENTO' | null>(null)
    const [note, setNote] = useState("")
    const [dateStr, setDateStr] = useState("")
    const [discardReason, setDiscardReason] = useState("")
    const [loading, setLoading] = useState(false)

    // ESC key handler
    const handleEsc = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape") onClose()
    }, [onClose])

    useEffect(() => {
        if (!isOpen) return
        document.addEventListener("keydown", handleEsc)
        return () => document.removeEventListener("keydown", handleEsc)
    }, [isOpen, handleEsc])

    if (!isOpen) return null

    const handleSubmit = async () => {
        if (!outcome) return
        setLoading(true)

        try {
            let targetDate: Date | undefined = undefined
            if ((outcome === 'RICHIAMO' || outcome === 'APPUNTAMENTO') && dateStr) {
                targetDate = new Date(dateStr)
            }

            const result = await updateLeadOutcome(leadId, outcome, note, targetDate, undefined, outcome === 'DA_SCARTARE' ? discardReason : undefined, leadVersion)

            if (result && !result.success && result.error === 'CONCURRENCY_ERROR') {
                alert("Questo lead è stato modificato da un altro utente. La pagina verrà aggiornata.")
                router.refresh()
                onClose()
                return
            }
            if (result?.rewardData) {
                const { emitRewardEarned } = await import('@/lib/animationUtils');
                emitRewardEarned(result.rewardData);
            }

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
                className="drawer-overlay"
                onClick={onClose}
            ></div>

            {/* Side Drawer */}
            <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-elevated sm:max-w-md drawer-panel">

                {/* Header */}
                <div className="px-4 sm:px-6 py-5 border-b border-ash-200 drawer-header flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Aggiorna Esito</h2>
                        <div className="text-sm text-ash-500 mt-0.5">Registra l'attività per questo contatto</div>
                    </div>
                    <button onClick={onClose} className="p-2 text-ash-400 hover:text-ash-600 hover:bg-ash-100 rounded-full transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Body / Scrollable Content */}
                <div className="p-4 sm:p-6 flex-1 overflow-y-auto space-y-6 custom-scrollbar">

                    {/* Outcome Grid */}
                    <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-ash-400 mb-3 block">1. Seleziona L&apos;Esito</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setOutcome("NON_RISPOSTO")}
                                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${outcome === "NON_RISPOSTO" ? "border-brand-orange bg-brand-orange-50 text-brand-orange shadow-sm" : "border-ash-200 hover:border-ash-300 hover:bg-ash-50 text-ash-500"}`}
                            >
                                <PhoneOff className={`h-6 w-6 mb-2 ${outcome === 'NON_RISPOSTO' ? 'text-brand-orange' : 'text-ash-400'}`} />
                                <span className="text-sm font-semibold">Non Risposto</span>
                                <span className="text-[10px] mt-1 opacity-70">Riprova più tardi</span>
                            </button>

                            <button
                                onClick={() => setOutcome("RICHIAMO")}
                                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${outcome === "RICHIAMO" ? "border-blue-500 bg-blue-50 text-blue-600 shadow-sm" : "border-ash-200 hover:border-ash-300 hover:bg-ash-50 text-ash-500"}`}
                            >
                                <CalendarClock className={`h-6 w-6 mb-2 ${outcome === 'RICHIAMO' ? 'text-blue-500' : 'text-ash-400'}`} />
                                <span className="text-sm font-semibold">Da Richiamare</span>
                                <span className="text-[10px] mt-1 opacity-70">Pianifica data</span>
                            </button>

                            <button
                                onClick={() => setOutcome("APPUNTAMENTO")}
                                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${outcome === "APPUNTAMENTO" ? "border-green-500 bg-green-50 text-green-600 shadow-sm" : "border-ash-200 hover:border-ash-300 hover:bg-ash-50 text-ash-500"}`}
                            >
                                <Handshake className={`h-6 w-6 mb-2 ${outcome === 'APPUNTAMENTO' ? 'text-green-500' : 'text-ash-400'}`} />
                                <span className="text-sm font-semibold">Appuntamento</span>
                                <span className="text-[10px] mt-1 opacity-70">Fissato con successo</span>
                            </button>

                            <button
                                onClick={() => setOutcome("DA_SCARTARE")}
                                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${outcome === "DA_SCARTARE" ? "border-red-500 bg-red-50 text-red-600 shadow-sm" : "border-ash-200 hover:border-ash-300 hover:bg-ash-50 text-ash-500"}`}
                            >
                                <Ban className={`h-6 w-6 mb-2 ${outcome === 'DA_SCARTARE' ? 'text-red-500' : 'text-ash-400'}`} />
                                <span className="text-sm font-semibold">Scarta Lead</span>
                                <span className="text-[10px] mt-1 opacity-70">Esito Negativo</span>
                            </button>
                        </div>
                    </div>

                    {/* Conditional Fields */}
                    {outcome && (
                        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <label className="text-xs font-bold uppercase tracking-wider text-ash-400 block border-t border-ash-200 pt-5">
                                2. Dettagli {outcome === 'DA_SCARTARE' ? 'di Scarto' : outcome === 'APPUNTAMENTO' ? "dell'Appuntamento" : outcome === 'RICHIAMO' ? 'del Richiamo' : 'Aggiuntivi'}
                            </label>

                            {isDateRequired && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                                        <CalendarClock className="h-4 w-4 text-ash-400" /> Data e Ora *
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={dateStr}
                                        onChange={(e) => setDateStr(e.target.value)}
                                        className="input-fenice text-sm"
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
                                        className="input-fenice text-sm"
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
                                    className="input-fenice text-sm resize-none"
                                    placeholder="Trascrivi i dettagli utili della telefonata..."
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-ash-200 bg-ash-50 flex gap-3 mt-auto">
                    <button
                        onClick={onClose}
                        className="btn-secondary flex-1 text-sm py-2.5"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitDisabled}
                        className={`flex-[2] px-4 py-2.5 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed ${isSubmitDisabled ? 'bg-ash-300 shadow-none' :
                                outcome === 'DA_SCARTARE' ? 'bg-red-600 hover:bg-red-700' :
                                    outcome === 'APPUNTAMENTO' ? 'bg-green-600 hover:bg-green-700' :
                                        'bg-brand-orange hover:bg-brand-orange-hover'
                            }`}
                    >
                        {loading ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Salvataggio...
                            </span>
                        ) : 'Conferma Esito'}
                    </button>
                </div>
            </div>
        </>
    )
}
