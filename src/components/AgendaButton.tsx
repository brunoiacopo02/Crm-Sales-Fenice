"use client"

import { useState } from "react"
import { Send, X, Briefcase, Users, CheckCircle2, Loader2 } from "lucide-react"
import { sendAgendaToLead } from "@/app/actions/activeCampaignActions"
import { useRouter } from "next/navigation"

type AgendaButtonProps = {
    leadId: string
    leadName: string
    leadPhone: string
    hasEmail: boolean
    agendaSentAt?: Date | null
}

export function AgendaButton({ leadId, leadName, leadPhone, hasEmail, agendaSentAt }: AgendaButtonProps) {
    const router = useRouter()
    const [showModal, setShowModal] = useState(false)
    const [lavora, setLavora] = useState<boolean | null>(null)
    const [haFamiglia, setHaFamiglia] = useState<boolean | null>(null)
    const [loading, setLoading] = useState(false)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const alreadySent = !!agendaSentAt
    const disabled = !hasEmail

    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (disabled) return
        setShowModal(true)
        setLavora(null)
        setHaFamiglia(null)
        setSuccessMsg(null)
        setErrorMsg(null)
    }

    const handleClose = () => {
        if (loading) return
        setShowModal(false)
    }

    const handleSubmit = async () => {
        if (lavora === null || haFamiglia === null) return
        setLoading(true)
        setErrorMsg(null)
        try {
            const result = await sendAgendaToLead(leadId, { lavora, haFamiglia })
            if (result.success) {
                setSuccessMsg(result.alreadySent ? "Agenda reinviata correttamente!" : "Agenda inviata correttamente!")
                router.refresh()
                setTimeout(() => setShowModal(false), 1500)
            } else {
                setErrorMsg(result.error || "Errore sconosciuto")
            }
        } catch (e: any) {
            setErrorMsg(e.message || "Errore invio")
        } finally {
            setLoading(false)
        }
    }

    const canSubmit = lavora !== null && haFamiglia !== null && !loading

    return (
        <>
            <button
                onClick={handleOpen}
                disabled={disabled}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${disabled
                    ? 'border-ash-200 bg-ash-50 text-ash-400 cursor-not-allowed'
                    : alreadySent
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                    }`}
                title={
                    disabled ? "Lead senza email" :
                        alreadySent ? `Agenda già inviata (${new Date(agendaSentAt!).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}) — clicca per reinviare` :
                            "Invia agenda Calendly via WhatsApp"
                }
            >
                {alreadySent ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                Agenda
            </button>

            {showModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={handleClose}>
                    <div className="absolute inset-0 bg-black/50" />
                    <div
                        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border-b border-blue-200 px-5 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center">
                                    <Send className="h-4 w-4 text-blue-600" />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-ash-900">
                                        {alreadySent ? 'Reinvia Agenda' : 'Invia Agenda'}
                                    </div>
                                    <div className="text-xs text-ash-500">{leadName} — {leadPhone}</div>
                                </div>
                            </div>
                            <button
                                onClick={handleClose}
                                disabled={loading}
                                className="p-1.5 rounded-lg hover:bg-blue-200/50 transition-colors disabled:opacity-50"
                            >
                                <X className="w-5 h-5 text-ash-600" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-5 space-y-5">
                            {alreadySent && !successMsg && (
                                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
                                    ⚠️ Agenda già inviata il <strong>{new Date(agendaSentAt!).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</strong>. Procedi solo se il lead non l'ha ricevuta.
                                </div>
                            )}

                            {!successMsg && (
                                <>
                                    {/* Question 1: Lavora */}
                                    <div>
                                        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ash-500 mb-2">
                                            <Briefcase className="w-3.5 h-3.5" /> Il lead lavora?
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setLavora(true)}
                                                disabled={loading}
                                                className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${lavora === true
                                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                                                    : 'border-ash-200 bg-white text-ash-600 hover:border-ash-300'
                                                    } disabled:opacity-50`}
                                            >
                                                Sì, lavora
                                            </button>
                                            <button
                                                onClick={() => setLavora(false)}
                                                disabled={loading}
                                                className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${lavora === false
                                                    ? 'border-rose-500 bg-rose-50 text-rose-700 shadow-sm'
                                                    : 'border-ash-200 bg-white text-ash-600 hover:border-ash-300'
                                                    } disabled:opacity-50`}
                                            >
                                                No, non lavora
                                            </button>
                                        </div>
                                    </div>

                                    {/* Question 2: Ha famiglia */}
                                    <div>
                                        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ash-500 mb-2">
                                            <Users className="w-3.5 h-3.5" /> Il lead ha famiglia?
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setHaFamiglia(true)}
                                                disabled={loading}
                                                className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${haFamiglia === true
                                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                                                    : 'border-ash-200 bg-white text-ash-600 hover:border-ash-300'
                                                    } disabled:opacity-50`}
                                            >
                                                Sì, ha famiglia
                                            </button>
                                            <button
                                                onClick={() => setHaFamiglia(false)}
                                                disabled={loading}
                                                className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${haFamiglia === false
                                                    ? 'border-rose-500 bg-rose-50 text-rose-700 shadow-sm'
                                                    : 'border-ash-200 bg-white text-ash-600 hover:border-ash-300'
                                                    } disabled:opacity-50`}
                                            >
                                                No, single
                                            </button>
                                        </div>
                                    </div>

                                    {errorMsg && (
                                        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                                            {errorMsg}
                                        </div>
                                    )}
                                </>
                            )}

                            {successMsg && (
                                <div className="flex flex-col items-center gap-3 py-6">
                                    <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                                        <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                                    </div>
                                    <div className="text-sm font-bold text-emerald-700">{successMsg}</div>
                                    <div className="text-xs text-ash-500">Il lead riceverà il messaggio via WhatsApp.</div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        {!successMsg && (
                            <div className="border-t border-ash-100 px-5 py-3 bg-ash-50/50 flex gap-2 justify-end">
                                <button
                                    onClick={handleClose}
                                    disabled={loading}
                                    className="px-4 py-2 text-sm font-semibold text-ash-600 hover:text-ash-800 transition-colors disabled:opacity-50"
                                >
                                    Annulla
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={!canSubmit}
                                    className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Invio...
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4" />
                                            {alreadySent ? 'Reinvia' : 'Invia Agenda'}
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
