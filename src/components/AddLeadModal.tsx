"use client"

import { useState } from "react"
import { X, UserPlus, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
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

    if (!isOpen) return null

    const resetForm = () => {
        setNome("")
        setTelefono("")
        setEmail("")
        setFunnel("")
        setFeedback(null)
    }

    const handleClose = () => {
        resetForm()
        onClose()
    }

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
            <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

            {/* Modal */}
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-brand-orange/10 flex items-center justify-center">
                            <UserPlus className="h-4 w-4 text-brand-orange" />
                        </div>
                        <h2 className="font-semibold text-gray-800">Aggiungi Lead Manuale</h2>
                    </div>
                    <button onClick={handleClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                        <input
                            type="text"
                            value={nome}
                            onChange={(e) => setNome(e.target.value)}
                            placeholder="Nome del lead (opzionale)"
                            className="w-full h-10 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Telefono <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="tel"
                            value={telefono}
                            onChange={(e) => setTelefono(e.target.value)}
                            placeholder="Numero di telefono (min 5 cifre)"
                            required
                            className="w-full h-10 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email (opzionale)"
                            className="w-full h-10 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Funnel <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={funnel}
                            onChange={(e) => setFunnel(e.target.value)}
                            placeholder="Fonte/campagna di provenienza"
                            required
                            className="w-full h-10 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange transition-colors"
                        />
                    </div>

                    {/* Feedback */}
                    {feedback && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${feedback.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                            {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                            {feedback.message}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            Annulla
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-brand-orange hover:bg-brand-orange-hover rounded-lg shadow-sm disabled:opacity-50 transition-all"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
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
