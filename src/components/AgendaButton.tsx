"use client"

import { useState } from "react"
import { Send, X, Briefcase, Users, CheckCircle2, Loader2, Sparkles, AlertTriangle, MessageCircle } from "lucide-react"
import { sendAgendaToLead } from "@/app/actions/activeCampaignActions"
import { sendAgendaSerenamente } from "@/app/actions/serenamenteAgendaActions"
import { useSalesCompany } from "@/components/providers/SalesCompanyProvider"
import { useRouter } from "next/navigation"

/** Esito dell'ultimo invio. Volutamente senza riferimenti al canale sottostante. */
export type AgendaStatus = 'consegnato' | 'inviato' | 'fallito'

type AgendaButtonProps = {
    leadId: string
    leadName: string
    leadPhone: string
    agendaSentAt?: Date | null
    agendaStatus?: string | null
}

export function AgendaButton({ leadId, leadName, leadPhone, agendaSentAt, agendaStatus }: AgendaButtonProps) {
    const router = useRouter()
    const company = useSalesCompany()
    const isSerenamente = company === 'serenamente'
    const [showModal, setShowModal] = useState(false)
    const [lavora, setLavora] = useState<boolean | null>(null)
    const [haFamiglia, setHaFamiglia] = useState<boolean | null>(null)
    const [offertaDelMese, setOffertaDelMese] = useState(false)
    const [loading, setLoading] = useState(false)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    // Stato ottimistico: il badge si aggiorna SUBITO, anche dentro il drawer dello
    // script dove router.refresh() non ri-renderizza le props (il click sembrava
    // "non fare nulla"). Tiene anche l'esito, che decide colore e riapribilità.
    const [sentNowStatus, setSentNowStatus] = useState<AgendaStatus | null>(null)
    // Il lead aveva già risposto e il video della variante precedente è partito:
    // non è più correggibile via software, deve saperlo il GDO.
    const [videoGiaInviato, setVideoGiaInviato] = useState(false)

    const status = (sentNowStatus ?? agendaStatus ?? null) as AgendaStatus | null
    const alreadySent = !!agendaSentAt || sentNowStatus === 'consegnato' || sentNowStatus === 'inviato'

    // 'inviato' = partito ma consegna non confermata (tipicamente telefono spento).
    // Un reinvio arriverebbe doppio appena il lead torna online, quindi si blocca.
    const isLocked = status === 'inviato'
    const isFailed = status === 'fallito'

    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (isLocked) return
        setShowModal(true)
        setLavora(null)
        setHaFamiglia(null)
        setOffertaDelMese(false)
        setSuccessMsg(null)
        setErrorMsg(null)
    }

    const handleClose = () => {
        if (loading) return
        setShowModal(false)
    }

    const handleDirectSend = async (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        if (loading) return
        if (alreadySent && !window.confirm("Agenda già inviata a questo lead. Reinviare?")) return
        setLoading(true)
        setErrorMsg(null)
        try {
            const result = await sendAgendaSerenamente(leadId)
            if (result.success) {
                setSentNowStatus('consegnato')
                window.alert("✅ Agenda inviata a " + leadName + " via WhatsApp")
                router.refresh()
            } else {
                window.alert("❌ Invio agenda fallito: " + (result.error || "errore sconosciuto"))
            }
        } catch (err: any) {
            window.alert("❌ Invio agenda fallito: " + (err?.message || "errore di rete"))
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async () => {
        // Validation: either offerta del mese OR both work/family questions answered
        if (!offertaDelMese && (lavora === null || haFamiglia === null)) return
        setLoading(true)
        setErrorMsg(null)
        try {
            const result = await sendAgendaToLead(leadId, {
                lavora: lavora ?? false,
                haFamiglia: haFamiglia ?? false,
                offertaDelMese,
            })
            if (result.success) {
                const esito = (result.esito ?? 'consegnato') as AgendaStatus
                const videoPartito = result.videoGiaInviato === true
                setSentNowStatus(esito)
                setVideoGiaInviato(videoPartito)
                setSuccessMsg(
                    result.varianteAggiornata
                        ? "Variante aggiornata."
                        : esito === 'inviato'
                            ? "Agenda inviata, consegna non ancora confermata."
                            : result.alreadySent ? "Agenda reinviata correttamente!" : "Agenda inviata correttamente!"
                )
                router.refresh()
                // Se il video sbagliato è già partito la modale NON si chiude da sola:
                // è un'informazione su cui il GDO deve agire, non un messaggio di conferma.
                if (!videoPartito) {
                    setTimeout(() => setShowModal(false), esito === 'inviato' ? 3000 : 1500)
                }
            } else {
                if (result.esito === 'fallito') setSentNowStatus('fallito')
                setErrorMsg(result.error || "Errore sconosciuto")
            }
        } catch (e: any) {
            setErrorMsg(e.message || "Errore invio")
        } finally {
            setLoading(false)
        }
    }

    const canSubmit = (offertaDelMese || (lavora !== null && haFamiglia !== null)) && !loading

    const buttonClass = isLocked
        ? 'border-amber-300 bg-amber-50 text-amber-700 cursor-not-allowed'
        : isFailed
            ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
            : alreadySent
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'

    const buttonLabel = isLocked ? 'Consegna non confermata' : isFailed ? 'Invio fallito' : 'Agenda'

    const buttonTitle = isSerenamente
        ? "Invia agenda Serenamente"
        : isLocked
            ? "Il messaggio è partito ma la consegna non è confermata (telefono spento o offline). Arriverà da solo appena il lead torna online: non reinviare, riceverebbe tutto doppio."
            : isFailed
                ? "L'ultimo invio non è andato a buon fine — clicca per riprovare"
                : alreadySent
                    ? `Agenda già inviata (${new Date(agendaSentAt!).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}) — clicca per reinviare`
                    : "Invia agenda al lead via WhatsApp"

    return (
        <>
            <button
                type="button"
                onClick={isSerenamente ? handleDirectSend : handleOpen}
                disabled={(isSerenamente && loading) || isLocked}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${buttonClass}`}
                title={buttonTitle}
            >
                {isSerenamente && loading
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : isLocked ? <AlertTriangle className="w-3.5 h-3.5" />
                        : isFailed ? <AlertTriangle className="w-3.5 h-3.5" />
                            : alreadySent ? <CheckCircle2 className="w-3.5 h-3.5" />
                                : <Send className="w-3.5 h-3.5" />
                }
                {isSerenamente ? 'Agenda' : buttonLabel}
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
                            {isFailed && !successMsg && (
                                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                                    ⚠️ L'ultimo invio a questo lead non è andato a buon fine. Verifica che il numero sia corretto e attivo su WhatsApp.
                                </div>
                            )}

                            {alreadySent && !isFailed && !successMsg && (
                                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
                                    ⚠️ Agenda già inviata il <strong>{new Date(agendaSentAt!).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</strong>. Procedi solo se il lead non l'ha ricevuta.
                                </div>
                            )}

                            {!successMsg && (
                                <>
                                    {/* Offerta del Mese checkbox */}
                                    <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${offertaDelMese
                                        ? 'border-purple-500 bg-purple-50 shadow-sm'
                                        : 'border-ash-200 bg-white hover:border-ash-300'
                                        } ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
                                        <input
                                            type="checkbox"
                                            checked={offertaDelMese}
                                            onChange={(e) => {
                                                setOffertaDelMese(e.target.checked)
                                                if (e.target.checked) {
                                                    setLavora(null)
                                                    setHaFamiglia(null)
                                                }
                                            }}
                                            disabled={loading}
                                            className="w-4 h-4 accent-purple-600 cursor-pointer"
                                        />
                                        <div className="flex-1">
                                            <div className="flex items-center gap-1.5 text-sm font-bold text-purple-700">
                                                <Sparkles className="w-3.5 h-3.5" />
                                                È offerta del mese
                                            </div>
                                            <div className="text-[11px] text-ash-500 mt-0.5">
                                                Invia il video con l'offerta speciale del mese (ignora i tag Lavora/Famiglia)
                                            </div>
                                        </div>
                                    </label>

                                    {/* Question 1: Lavora */}
                                    <div className={offertaDelMese ? 'opacity-40' : ''}>
                                        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ash-500 mb-2">
                                            <Briefcase className="w-3.5 h-3.5" /> Il lead lavora?
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setLavora(true)}
                                                disabled={loading || offertaDelMese}
                                                className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${lavora === true
                                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                                                    : 'border-ash-200 bg-white text-ash-600 hover:border-ash-300'
                                                    } disabled:opacity-50`}
                                            >
                                                Sì, lavora
                                            </button>
                                            <button
                                                onClick={() => setLavora(false)}
                                                disabled={loading || offertaDelMese}
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
                                    <div className={offertaDelMese ? 'opacity-40' : ''}>
                                        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ash-500 mb-2">
                                            <Users className="w-3.5 h-3.5" /> Situazione familiare
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setHaFamiglia(true)}
                                                disabled={loading || offertaDelMese}
                                                className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${haFamiglia === true
                                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                                                    : 'border-ash-200 bg-white text-ash-600 hover:border-ash-300'
                                                    } disabled:opacity-50`}
                                            >
                                                Ha famiglia
                                            </button>
                                            <button
                                                onClick={() => setHaFamiglia(false)}
                                                disabled={loading || offertaDelMese}
                                                className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${haFamiglia === false
                                                    ? 'border-rose-500 bg-rose-50 text-rose-700 shadow-sm'
                                                    : 'border-ash-200 bg-white text-ash-600 hover:border-ash-300'
                                                    } disabled:opacity-50`}
                                            >
                                                Non ha figli
                                            </button>
                                        </div>
                                    </div>

                                    {/* Promemoria operativo: senza una risposta del lead il video non parte.
                                        TESTO DA APPROVARE DAL PO prima del go-live. */}
                                    <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                                        <MessageCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                                        <div className="text-[11px] leading-relaxed text-blue-900">
                                            <strong>Prima di chiudere la chiamata</strong>, fatti rispondere al messaggio dal lead:
                                            senza una sua risposta il video di preparazione non gli arriva.
                                        </div>
                                    </div>

                                    {errorMsg && (
                                        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                                            {errorMsg}
                                        </div>
                                    )}
                                </>
                            )}

                            {successMsg && videoGiaInviato && (
                                <div className="flex flex-col items-center gap-3 py-4">
                                    <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                                        <AlertTriangle className="w-8 h-8 text-red-600" />
                                    </div>
                                    <div className="text-sm font-bold text-red-700 text-center">
                                        Il lead ha già ricevuto il video precedente
                                    </div>
                                    <div className="text-xs text-ash-600 text-center px-3 leading-relaxed">
                                        Aveva già risposto al messaggio, quindi il video della variante precedente
                                        gli è arrivato e <strong>non è più recuperabile</strong>. Da qui in avanti
                                        riceverà quello corretto, ma il video sbagliato l'ha visto:
                                        <strong> diglielo tu ora che sei in chiamata.</strong>
                                    </div>
                                    <button
                                        onClick={() => setShowModal(false)}
                                        className="mt-1 px-5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-sm transition-colors"
                                    >
                                        Ho capito
                                    </button>
                                </div>
                            )}

                            {successMsg && !videoGiaInviato && (
                                <div className="flex flex-col items-center gap-3 py-6">
                                    <div className={`w-14 h-14 rounded-full flex items-center justify-center ${sentNowStatus === 'inviato' ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                                        {sentNowStatus === 'inviato'
                                            ? <AlertTriangle className="w-8 h-8 text-amber-600" />
                                            : <CheckCircle2 className="w-8 h-8 text-emerald-600" />}
                                    </div>
                                    <div className={`text-sm font-bold ${sentNowStatus === 'inviato' ? 'text-amber-700' : 'text-emerald-700'}`}>{successMsg}</div>
                                    <div className="text-xs text-ash-500 text-center px-4">
                                        {sentNowStatus === 'inviato'
                                            ? "Il telefono del lead risulta spento o offline: il messaggio gli arriverà appena si ricollega. Non reinviare."
                                            : "Il lead riceverà il messaggio via WhatsApp."}
                                    </div>
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
