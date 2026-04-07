"use client"

import { useState, useEffect, useCallback } from "react"
import { X, UserPlus, CheckCircle2, AlertCircle } from "lucide-react"
import { createManualLead } from "@/app/actions/importLeads"
import { useRouter } from "next/navigation"

type AddLeadModalProps = {
    isOpen: boolean
    onClose: () => void
}

export function AddLeadModal({ isOpen, onClose }: AddLeadModalProps) {
    const router = useRouter()
    const [nome, setNome] = useState("")
    const [telefono, setTelefono] = useState("")
    const [email, setEmail] = useState("")
    const [funnel, setFunnel] = useState("")
    const [loading, setLoading] = useState(false)
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null)

    const resetForm = useCallback(() => {
        setNome("")
        setTelefono("")
        setEmail("")
        setFunnel("")
        setFeedback(null)
    }, [])

    const handleClose = useCallback(() => {
        resetForm()
        onClose()
    }, [resetForm, onClose])

    // ESC key handler
    useEffect(() => {
        if (!isOpen) return
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose()
        }
        document.addEventListener("keydown", handleKey)
        return () => document.removeEventListener("keydown", handleKey)
    }, [isOpen, handleClose])

    if (!isOpen) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setFeedback(null)

        // Client-side validation
        const cleanPhone = telefono.trim().replace(/[^\d+]/g, '')
        if (cleanPhone.length < 5) {
            setFeedback({ type: "error", message: "Telefono non valido (minimo 5 cifre)." })
            return
        }
        if (!funnel.trim()) {
            setFeedback({ type: "error", message: "Il campo Funnel è obbligatorio." })
            return
        }

        setLoading(true)
        try {
            const result = await createManualLead({
                nome: nome.trim(),
                telefono: telefono.trim(),
                email: email.trim() || undefined,
                funnel: funnel.trim(),
            })

            if (result.success) {
                setFeedback({ type: "success", message: "Lead creato e assegnato con successo!" })
                router.refresh()
                setTimeout(() => {
                    handleClose()
                }, 1200)
            } else {
                setFeedback({ type: "error", message: result.error || "Errore durante la creazione del lead." })
            }
        } catch (err: any) {
            setFeedback({ type: "error", message: err.message || "Errore imprevisto." })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="modal-backdrop" onClick={handleClose} />

            {/* Modal */}
            <div className="relative modal-content w-full max-w-md mx-4 z-50">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-ash-200 drawer-header rounded-t-xl">
                    <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-brand-orange/10 flex items-center justify-center">
                            <UserPlus className="h-4 w-4 text-brand-orange" />
                        </div>
                        <h2 className="font-semibold text-gray-800">Aggiungi Lead Manuale</h2>
                    </div>
                    <button onClick={handleClose} className="p-1.5 text-ash-400 hover:text-ash-600 rounded-lg hover:bg-ash-100 transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
                        <input
                            type="text"
                            value={nome}
                            onChange={(e) => setNome(e.target.value)}
                            placeholder="Nome del lead (opzionale)"
                            className="input-fenice text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Telefono <span className="text-ember-400">*</span>
                        </label>
                        <input
                            type="tel"
                            value={telefono}
                            onChange={(e) => setTelefono(e.target.value)}
                            placeholder="Numero di telefono (min 5 cifre)"
                            required
                            className="input-fenice text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email (opzionale)"
                            className="input-fenice text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Funnel <span className="text-ember-400">*</span>
                        </label>
                        <input
                            type="text"
                            value={funnel}
                            onChange={(e) => setFunnel(e.target.value)}
                            placeholder="Fonte/campagna di provenienza"
                            required
                            className="input-fenice text-sm"
                        />
                    </div>

                    {/* Feedback */}
                    {feedback && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm animate-slide-up ${feedback.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                            {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                            {feedback.message}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="btn-ghost text-sm py-2 px-4"
                        >
                            Annulla
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary text-sm py-2.5 px-5 disabled:opacity-50"
                        >
                            {loading ? (
                                <>
                                    <span className="h-4 w-4 border-2 border-brand-charcoal/30 border-t-brand-charcoal rounded-full animate-spin" />
                                    Creazione...
                                </>
                            ) : (
                                <>
                                    <UserPlus className="h-4 w-4" />
                                    Crea Lead
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
