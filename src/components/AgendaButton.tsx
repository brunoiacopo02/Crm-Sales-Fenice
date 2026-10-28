"use client"

import { useState } from "react"
import { Send, X, Briefcase, Users, CheckCircle2, Loader2, Sparkles, AlertTriangle, MessageCircle } from "lucide-react"
import { sendAgendaToLead } from "@/app/actions/activeCampaignActions"
import { sendAgendaSerenamente } from "@/app/actions/serenamenteAgendaActions"
import { useSalesCompany } from "@/components/providers/SalesCompanyProvider"
import { useRouter } from "next/navigation"
import { dataOraRoma } from "@/lib/diretta/formato"

/** Esito dell'ultimo invio. Volutamente senza riferimenti al canale sottostante. */
export type AgendaStatus = 'consegnato' | 'inviato' | 'fallito'

type AgendaButtonProps = {
    leadId: string
    leadName: string
    leadPhone: string
    agendaSentAt?: Date | null
    agendaStatus?: string | null
    /**
     * Veste Diretta (collaudo 25/10/2026): 'diretta' = bottone a icona della
     * card, 'diretta-testo' = bottone con la scritta (barra dello script). In
     * entrambe la finestra è scura; domande, invio e messaggi sono gli stessi.
     */
    variant?: 'diretta' | 'diretta-testo'
}

export function AgendaButton({ leadId, leadName, leadPhone, agendaSentAt, agendaStatus, variant }: AgendaButtonProps) {
    const router = useRouter()
    const company = useSalesCompany()
    const isSerenamente = company === 'serenamente'
    const [showModal, setShowModal] = useState(false)
    const [lavora, setLavora] = useState<boolean | null>(null)
    const [haFamiglia, setHaFamiglia] = useState<boolean | null>(null)
    const [offertaDelMese, setOffertaDelMese] = useState(false)
    // WhatsApp diverso dal numero del CRM: vale solo per questo invio.
    const [whatsapp, setWhatsapp] = useState("")
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
        setWhatsapp("")
        setSuccessMsg(null)
        setErrorMsg(null)
    }

    const handleClose = () => {
        if (loading) return
        setShowModal(false)
    }

    const toggleOffertaDelMese = () => {
        if (loading) return
        setOffertaDelMese((on) => {
            const next = !on
            if (next) {
                setLavora(null)
                setHaFamiglia(null)
            }
            return next
        })
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
                whatsappPhone: whatsapp.trim() || undefined,
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
                    ? `Agenda già inviata (${agendaSentAt ? dataOraRoma(new Date(agendaSentAt)) : 'adesso'}), clicca per reinviare`
                    : "Invia agenda al lead via WhatsApp"

    // Veste Diretta: bottone a icona, bordo neutro; l'arancione solo quando
    // l'invio va guardato adesso (consegna non confermata o fallita).
    const direttaClass = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 transition-colors disabled:cursor-not-allowed ${isLocked || isFailed
        ? 'border-[#FF9330] text-[#FF9330]'
        : 'border-[#3D3D3D] text-[#F2F2F2] hover:border-[#8C8C8C]'}`
    const direttaTestoClass = `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border-2 px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${isLocked || isFailed
        ? 'border-[#FF9330] text-[#FF9330]'
        : 'border-[#3D3D3D] text-[#F2F2F2] hover:border-[#8C8C8C]'}`
    const diretta = variant === 'diretta' || variant === 'diretta-testo'
    const etichetta = isSerenamente ? 'Agenda' : buttonLabel

    return (
        <>
            <button
                type="button"
                onClick={isSerenamente ? handleDirectSend : handleOpen}
                disabled={(isSerenamente && loading) || isLocked}
                className={variant === 'diretta' ? direttaClass : variant === 'diretta-testo' ? direttaTestoClass : `flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${buttonClass}`}
                title={buttonTitle}
                aria-label={variant === 'diretta' ? etichetta : undefined}
            >
                {isSerenamente && loading
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : isLocked ? <AlertTriangle className="w-3.5 h-3.5" />
                        : isFailed ? <AlertTriangle className="w-3.5 h-3.5" />
                            : alreadySent ? <CheckCircle2 className="w-3.5 h-3.5" />
                                : <Send className="w-3.5 h-3.5" />
                }
                {variant !== 'diretta' && etichetta}
            </button>

            {showModal && diretta && (
                <AgendaModalDiretta
                    leadName={leadName}
                    leadPhone={leadPhone}
                    agendaSentAt={agendaSentAt ?? null}
                    alreadySent={alreadySent}
                    isFailed={isFailed}
                    lavora={lavora}
                    setLavora={setLavora}
                    haFamiglia={haFamiglia}
                    setHaFamiglia={setHaFamiglia}
                    offertaDelMese={offertaDelMese}
                    toggleOffertaDelMese={toggleOffertaDelMese}
                    whatsapp={whatsapp}
                    setWhatsapp={setWhatsapp}
                    loading={loading}
                    successMsg={successMsg}
                    errorMsg={errorMsg}
                    videoGiaInviato={videoGiaInviato}
                    sentNowStatus={sentNowStatus}
                    canSubmit={canSubmit}
                    onClose={handleClose}
                    onDismiss={() => setShowModal(false)}
                    onSubmit={handleSubmit}
                />
            )}

            {showModal && !diretta && (
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
                                    {/* Offerta del mese: pulsante evidente in cima (spec lancio §4.7).
                                        Acceso ⇒ il bot manda il video dell'offerta e ignora lavora/famiglia.
                                        Il payload non cambia: viaggia sempre variant.offertaDelMese. */}
                                    <button
                                        type="button"
                                        onClick={toggleOffertaDelMese}
                                        disabled={loading}
                                        aria-pressed={offertaDelMese}
                                        className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all disabled:opacity-50 ${offertaDelMese
                                            ? 'border-purple-600 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md'
                                            : 'border-purple-300 bg-purple-50 text-purple-800 hover:border-purple-500 hover:bg-purple-100'
                                            }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Sparkles className="w-4 h-4 shrink-0" />
                                            <div>
                                                <div className="text-sm font-bold">Offerta del mese</div>
                                                <div className={`text-[11px] ${offertaDelMese ? 'text-purple-100' : 'text-purple-700/80'}`}>
                                                    {offertaDelMese
                                                        ? 'Attiva: il lead riceve il video dell\'offerta, le domande sotto non servono'
                                                        : 'Tocca per mandare il video dell\'offerta al posto di quello lavora/famiglia'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className={`shrink-0 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${offertaDelMese ? 'bg-white/20' : 'bg-purple-200/70'}`}>
                                            {offertaDelMese ? 'ON' : 'OFF'}
                                        </div>
                                    </button>

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

                                    <div>
                                        <label htmlFor={`agenda-wa-${leadId}`} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ash-500 mb-2">
                                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp su un altro numero?
                                        </label>
                                        <input
                                            id={`agenda-wa-${leadId}`}
                                            type="tel"
                                            inputMode="tel"
                                            value={whatsapp}
                                            onChange={(e) => setWhatsapp(e.target.value)}
                                            disabled={loading}
                                            placeholder={`Vuoto = ${leadPhone}`}
                                            className="w-full rounded-lg border border-ash-200 px-3 py-2 text-sm text-ash-900 placeholder:text-ash-400 focus:border-blue-400 focus:outline-none disabled:opacity-50"
                                        />
                                        <div className="mt-1 text-[11px] text-ash-500">Scrivilo solo se il lead ha WhatsApp su un numero diverso da quello che hai chiamato.</div>
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

// ── Finestra dell'agenda nella veste Diretta (collaudo del 25/10/2026) ──────
// Stesse domande, stessi testi, stessi gestori della finestra di sempre (gli
// stati vivono in AgendaButton). I colori sono scritti per esteso perché la
// classe .fixed, nella Diretta, rimette la palette chiara del tema.

function SceltaDiretta({ attiva, onClick, disabled, children }: { attiva: boolean; onClick: () => void; disabled: boolean; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-pressed={attiva}
            className={`min-h-11 rounded-lg border-2 px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-50 ${attiva
                ? 'border-[#FF9330] bg-[#FF9330] text-[#171717]'
                : 'border-[#3D3D3D] text-[#F2F2F2] hover:border-[#8C8C8C]'}`}
        >
            {children}
        </button>
    )
}

function AgendaModalDiretta(p: {
    leadName: string
    leadPhone: string
    agendaSentAt: Date | null
    alreadySent: boolean
    isFailed: boolean
    lavora: boolean | null
    setLavora: (v: boolean) => void
    haFamiglia: boolean | null
    setHaFamiglia: (v: boolean) => void
    offertaDelMese: boolean
    toggleOffertaDelMese: () => void
    whatsapp: string
    setWhatsapp: (v: string) => void
    loading: boolean
    successMsg: string | null
    errorMsg: string | null
    videoGiaInviato: boolean
    sentNowStatus: AgendaStatus | null
    canSubmit: boolean
    onClose: () => void
    onDismiss: () => void
    onSubmit: () => void
}) {
    const { loading, offertaDelMese } = p
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); p.onClose() }}>
            <div className="absolute inset-0 bg-black/70" />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={p.alreadySent ? 'Reinvia Agenda' : 'Invia Agenda'}
                className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border-2 border-[#262626] bg-[#171717] font-[family-name:var(--font-poppins)] text-[#F2F2F2] tabular-nums [color-scheme:dark]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Intestazione */}
                <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
                    <div className="min-w-0">
                        <div className="text-[18px] font-semibold leading-tight">
                            {p.alreadySent ? 'Reinvia Agenda' : 'Invia Agenda'}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-[#BFBFBF]">
                            <div className="min-w-0 truncate">{p.leadName}</div>
                            <div className="whitespace-nowrap">{p.leadPhone}</div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={p.onClose}
                        disabled={loading}
                        aria-label="Chiudi"
                        className="rounded-lg p-1.5 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2] disabled:opacity-50"
                    >
                        <X className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-1">
                    {p.isFailed && !p.successMsg && (
                        <div className="flex items-start gap-2 rounded-lg border-2 border-[#FF9330] px-3 py-2.5 text-[13px] text-[#F2F2F2]">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9330]" strokeWidth={1.75} aria-hidden="true" />
                            <div>L&apos;ultimo invio a questo lead non è andato a buon fine. Verifica che il numero sia corretto e attivo su WhatsApp.</div>
                        </div>
                    )}

                    {p.alreadySent && !p.isFailed && !p.successMsg && (
                        <div className="flex items-start gap-2 rounded-lg bg-[#262626] px-3 py-2.5 text-[13px] text-[#BFBFBF]">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9330]" strokeWidth={1.75} aria-hidden="true" />
                            <div>
                                Agenda già inviata il <strong className="font-semibold text-[#F2F2F2]">{p.agendaSentAt ? dataOraRoma(new Date(p.agendaSentAt)) : 'adesso'}</strong>. Procedi solo se il lead non l&apos;ha ricevuta.
                            </div>
                        </div>
                    )}

                    {!p.successMsg && (
                        <>
                            {/* Offerta del mese: in cima, come nella finestra di sempre */}
                            <button
                                type="button"
                                onClick={p.toggleOffertaDelMese}
                                disabled={loading}
                                aria-pressed={offertaDelMese}
                                className={`flex w-full items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors disabled:opacity-50 ${offertaDelMese
                                    ? 'border-[#FF9330] bg-[#FF9330] text-[#171717]'
                                    : 'border-[#3D3D3D] text-[#F2F2F2] hover:border-[#8C8C8C]'}`}
                            >
                                <div className="flex min-w-0 items-start gap-2">
                                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                    <div className="min-w-0">
                                        <div className="text-[14px] font-semibold">Offerta del mese</div>
                                        <div className={`text-[12px] ${offertaDelMese ? 'text-[#171717]' : 'text-[#BFBFBF]'}`}>
                                            {offertaDelMese
                                                ? 'Attiva: il lead riceve il video dell\'offerta, le domande sotto non servono'
                                                : 'Tocca per mandare il video dell\'offerta al posto di quello lavora/famiglia'}
                                        </div>
                                    </div>
                                </div>
                                <div className={`shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold ${offertaDelMese ? 'bg-[#171717] text-[#FF9330]' : 'bg-[#262626] text-[#BFBFBF]'}`}>
                                    {offertaDelMese ? 'ON' : 'OFF'}
                                </div>
                            </button>

                            <div className={offertaDelMese ? 'opacity-40' : ''}>
                                <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-[#BFBFBF]">
                                    <Briefcase className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" /> Il lead lavora?
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <SceltaDiretta attiva={p.lavora === true} onClick={() => p.setLavora(true)} disabled={loading || offertaDelMese}>Sì, lavora</SceltaDiretta>
                                    <SceltaDiretta attiva={p.lavora === false} onClick={() => p.setLavora(false)} disabled={loading || offertaDelMese}>No, non lavora</SceltaDiretta>
                                </div>
                            </div>

                            <div className={offertaDelMese ? 'opacity-40' : ''}>
                                <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-[#BFBFBF]">
                                    <Users className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" /> Situazione familiare
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <SceltaDiretta attiva={p.haFamiglia === true} onClick={() => p.setHaFamiglia(true)} disabled={loading || offertaDelMese}>Ha famiglia</SceltaDiretta>
                                    <SceltaDiretta attiva={p.haFamiglia === false} onClick={() => p.setHaFamiglia(false)} disabled={loading || offertaDelMese}>Non ha figli</SceltaDiretta>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="agenda-wa-diretta" className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-[#BFBFBF]">
                                    <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" /> WhatsApp su un altro numero?
                                </label>
                                <input
                                    id="agenda-wa-diretta"
                                    type="tel"
                                    inputMode="tel"
                                    value={p.whatsapp}
                                    onChange={(e) => p.setWhatsapp(e.target.value)}
                                    disabled={loading}
                                    placeholder={`Vuoto = ${p.leadPhone}`}
                                    className="min-h-11 w-full rounded-lg border-2 border-[#3D3D3D] bg-transparent px-3 py-2 text-[14px] text-[#F2F2F2] placeholder:text-[#8C8C8C] focus:border-[#FF9330] focus:outline-none disabled:opacity-50"
                                />
                                <div className="mt-1 text-[12px] text-[#8C8C8C]">Scrivilo solo se il lead ha WhatsApp su un numero diverso da quello che hai chiamato.</div>
                            </div>

                            <div className="flex items-start gap-2 rounded-lg bg-[#262626] px-3 py-2.5">
                                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#BFBFBF]" strokeWidth={1.75} aria-hidden="true" />
                                <div className="text-[13px] leading-relaxed text-[#BFBFBF]">
                                    <strong className="font-semibold text-[#F2F2F2]">Prima di chiudere la chiamata</strong>, fatti rispondere al messaggio dal lead:
                                    senza una sua risposta il video di preparazione non gli arriva.
                                </div>
                            </div>

                            {p.errorMsg && (
                                <div role="alert" className="rounded-lg border-2 border-[#FF9330] px-3 py-2.5 text-[13px] text-[#F2F2F2]">
                                    {p.errorMsg}
                                </div>
                            )}
                        </>
                    )}

                    {p.successMsg && p.videoGiaInviato && (
                        <div className="flex flex-col items-center gap-3 py-4 text-center">
                            <AlertTriangle className="h-10 w-10 text-[#FF9330]" strokeWidth={1.5} aria-hidden="true" />
                            <div className="text-[15px] font-semibold">
                                Il lead ha già ricevuto il video precedente
                            </div>
                            <div className="px-2 text-[13px] leading-relaxed text-[#BFBFBF]">
                                Aveva già risposto al messaggio, quindi il video della variante precedente
                                gli è arrivato e <strong className="font-semibold text-[#F2F2F2]">non è più recuperabile</strong>. Da qui in avanti
                                riceverà quello corretto, ma il video sbagliato l&apos;ha visto:
                                <strong className="font-semibold text-[#F2F2F2]"> diglielo tu ora che sei in chiamata.</strong>
                            </div>
                            <button
                                type="button"
                                onClick={p.onDismiss}
                                className="mt-1 rounded-lg bg-[#F2F2F2] px-5 py-2 text-[14px] font-semibold text-[#171717]"
                            >
                                Ho capito
                            </button>
                        </div>
                    )}

                    {p.successMsg && !p.videoGiaInviato && (
                        <div className="flex flex-col items-center gap-3 py-6 text-center">
                            {p.sentNowStatus === 'inviato'
                                ? <AlertTriangle className="h-10 w-10 text-[#FF9330]" strokeWidth={1.5} aria-hidden="true" />
                                : <CheckCircle2 className="h-10 w-10 text-[#31BC00]" strokeWidth={1.5} aria-hidden="true" />}
                            <div className="text-[15px] font-semibold">{p.successMsg}</div>
                            <div className="px-3 text-[13px] text-[#BFBFBF]">
                                {p.sentNowStatus === 'inviato'
                                    ? "Il telefono del lead risulta spento o offline: il messaggio gli arriverà appena si ricollega. Non reinviare."
                                    : "Il lead riceverà il messaggio via WhatsApp."}
                            </div>
                        </div>
                    )}
                </div>

                {!p.successMsg && (
                    <div className="flex flex-wrap justify-end gap-2 border-t-2 border-[#262626] px-5 py-3">
                        <button
                            type="button"
                            onClick={p.onClose}
                            disabled={loading}
                            className="rounded-lg px-4 py-2 text-[14px] font-medium text-[#BFBFBF] transition-colors hover:text-[#F2F2F2] disabled:opacity-50"
                        >
                            Annulla
                        </button>
                        <button
                            type="button"
                            onClick={p.onSubmit}
                            disabled={!p.canSubmit}
                            className="inline-flex items-center gap-2 rounded-lg bg-[#FF9330] px-5 py-2 text-[14px] font-semibold text-[#171717] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Invio...
                                </>
                            ) : (
                                <>
                                    <Send className="h-4 w-4" strokeWidth={1.75} />
                                    {p.alreadySent ? 'Reinvia' : 'Invia Agenda'}
                                </>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
