"use client"

import { useState, useEffect, useMemo } from "react"
import { saveVenditoreOutcome, rescheduleFollowUp } from "@/app/actions/venditoreActions"
import { saveSalesSurvey, getSalesSurveyByLead } from "@/app/actions/surveyActions"
import { X, User, Phone, Mail, Clock, Save, Building, AlertCircle, Lock, Play, CalendarClock, Pencil } from "lucide-react"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import { parseRomeDatetimeLocal, toRomeDatetimeLocal } from "@/lib/dateUtils"
import { VenditoreSurveyInline, type VenditoreSurveyState } from "./surveys/VenditoreSurveyInline"
import { EXCLUDED_FUNNEL, NOT_CLOSED_REASONS } from "@/lib/surveys/questions"
import { MAX_FOLLOW_UPS } from "@/lib/venditorePerformance/guard"

interface VenditoreDrawerProps {
    lead: any
    onClose: () => void
    onSaved: () => void
    // Check-in trattativa avviabile direttamente dalla scheda (oltre che dalla riga).
    onStartNegotiation?: () => void
    isStarting?: boolean
    // Aperto dalla tab Follow-up: il form parte pulito (l'esito registrato è
    // quello della NUOVA chiamata, non una modifica del tentativo precedente)
    // e il tentativo precedente viene mostrato come recap read-only.
    followUpMode?: boolean
}

export function VenditoreDrawer({ lead, onClose, onSaved, onStartNegotiation, isStarting, followUpMode = false }: VenditoreDrawerProps) {
    // Trattativa avviata? Telefono e form esito sono sbloccati solo dopo il check-in
    // "Inizia trattativa" (regola remoto-only). Riflette anche l'avvio appena fatto.
    const isStarted = !!lead?.negotiationStartedAt
    const priorNonClosedCount = lead?.priorNonClosedCount ?? 0
    // Correzione esplicita dell'ultimo tentativo. Senza questa scelta dichiarata,
    // ri-registrare un esito dalla card follow-up creava un tentativo in più:
    // dallo stato del lead il caso è indistinguibile da un follow-up davvero
    // svolto, quindi l'intenzione deve arrivare dall'utente.
    const [correctingPrev, setCorrectingPrev] = useState(false)
    // Il tentativo che si sta correggendo non è un "pregresso": va scalato dal
    // tetto, altrimenti correggere il 3° follow-up nasconderebbe il campo data.
    // Stessa esclusione che fa il server in modalità update.
    const effectivePriorNonClosed = correctingPrev && lead?.salespersonOutcome === "Non chiuso"
        ? Math.max(0, priorNonClosedCount - 1)
        : priorNonClosedCount
    // Oltre il tetto si può ancora esitare "Non chiuso", ma senza pianificare
    // un ennesimo follow-up ("Perso" rimosso: era un doppione di Non chiuso).
    const followUpCapReached = effectivePriorNonClosed >= MAX_FOLLOW_UPS
    const OUTCOME_OPTIONS = ["Chiuso", "Non chiuso", "Sparito"]
    const [outcome, setOutcome] = useState<string>(followUpMode ? "" : lead?.salespersonOutcome || "")
    const [closeProduct, setCloseProduct] = useState(lead?.closeProduct || "advance")
    const [closeAmountEur, setCloseAmountEur] = useState(lead?.closeAmountEur?.toString() || "")
    // Data effettiva dell'esito (es. firma sabato ma esito segnato lunedì).
    // Vale per TUTTI gli esiti, non solo Chiuso: i KPI mensili (presenziati)
    // usano questa data. Formato datetime-local SEMPRE Europe/Rome (Sprint 2.4).
    // Default: esito precedente se esiste; altrimenti, se l'appuntamento è di un
    // giorno passato (esito arretrato), la data dell'appuntamento — così le
    // presenze finiscono nel mese in cui la trattativa è davvero avvenuta.
    const [closeDate, setCloseDate] = useState<string>(() => {
        // Follow-up: l'esito è della chiamata che avviene ADESSO, non della
        // trattativa originale — niente prefill da esito/appuntamento passati.
        if (followUpMode) return toRomeDatetimeLocal(new Date())
        if (lead?.salespersonOutcomeAt) return toRomeDatetimeLocal(new Date(lead.salespersonOutcomeAt))
        const now = new Date()
        const appt = lead?.appointmentDate ? new Date(lead.appointmentDate) : null
        if (appt && toRomeDatetimeLocal(appt).slice(0, 10) < toRomeDatetimeLocal(now).slice(0, 10)) {
            return toRomeDatetimeLocal(appt)
        }
        return toRomeDatetimeLocal(now)
    })
    const [notClosedReason, setNotClosedReason] = useState(followUpMode ? "" : lead?.notClosedReason || "")
    const [notes, setNotes] = useState(followUpMode ? "" : lead?.salespersonOutcomeNotes || "")

    // Sposta follow-up senza esito (spec 2026-07-23)
    const [showReschedule, setShowReschedule] = useState(false)
    const [rescheduleValue, setRescheduleValue] = useState("")
    const [isRescheduling, setIsRescheduling] = useState(false)

    // Mai precompilare con una data già passata: risalvando "Non chiuso" si
    // ripianificherebbe un follow-up nel passato → il lead resta in "Scaduti"
    // per sempre e brucia uno dei follow-up disponibili.
    const [nextFollowUpDate, setNextFollowUpDate] = useState(() => {
        if (followUpMode) return ""
        const fu = lead?.nextFollowUpDate ? new Date(lead.nextFollowUpDate) : null
        return fu && fu.getTime() > Date.now() ? toRomeDatetimeLocal(fu) : ""
    })

    const [isSaving, setIsSaving] = useState(false)

    // Sondaggio venditore (solo se outcome === "Non chiuso" e funnel != 'database')
    const [surveyStartedAt] = useState<number>(() => Date.now())
    const [survey, setSurvey] = useState<VenditoreSurveyState>({
        problemSignals: [],
        urgencySignals: [],
        priceReaction: null,
    })
    const surveyRequired = useMemo(() => {
        if (outcome !== "Chiuso" && outcome !== "Non chiuso") return false
        const f = (lead?.funnel || "").trim().toLowerCase()
        return f !== EXCLUDED_FUNNEL
    }, [outcome, lead?.funnel])
    const surveyValid = useMemo(() => {
        if (!surveyRequired) return true
        return (
            survey.problemSignals.length > 0 &&
            survey.urgencySignals.length > 0 &&
            survey.priceReaction !== null
        )
    }, [surveyRequired, survey])

    // Prefill survey if exists (in caso di edit)
    useEffect(() => {
        if (!lead?.id) return
        void (async () => {
            const existing = await getSalesSurveyByLead(lead.id)
            if (existing) {
                setSurvey({
                    problemSignals: existing.problemSignals ?? [],
                    urgencySignals: existing.urgencySignals ?? [],
                    priceReaction: existing.priceReaction ?? null,
                })
            }
        })()
    }, [lead?.id])

    const handleReschedule = async () => {
        if (!rescheduleValue) return
        const parsedDate = parseRomeDatetimeLocal(rescheduleValue)
        if (!parsedDate) { alert("Data follow-up non valida"); return }
        setIsRescheduling(true)
        try {
            const res = await rescheduleFollowUp(lead.id, parsedDate)
            if (!res.success) { alert(res.error || "Errore durante lo spostamento del follow-up"); return }
            onSaved()
        } finally {
            setIsRescheduling(false)
        }
    }

    // Passa il form dalla "nuova chiamata" alla riscrittura del tentativo già
    // registrato, ricaricandone i valori.
    const startCorrection = () => {
        setCorrectingPrev(true)
        setShowReschedule(false)
        setOutcome(lead?.salespersonOutcome || "")
        setNotClosedReason(lead?.notClosedReason || "")
        setNotes(lead?.salespersonOutcomeNotes || "")
        setCloseProduct(lead?.closeProduct || "advance")
        setCloseAmountEur(lead?.closeAmountEur?.toString() || "")
        setCloseDate(lead?.salespersonOutcomeAt
            ? toRomeDatetimeLocal(new Date(lead.salespersonOutcomeAt))
            : toRomeDatetimeLocal(new Date()))
        // Stessa cautela del prefill normale: mai riproporre una data già
        // passata, altrimenti si ripianifica un follow-up scaduto.
        const fu = lead?.nextFollowUpDate ? new Date(lead.nextFollowUpDate) : null
        setNextFollowUpDate(fu && fu.getTime() > Date.now() ? toRomeDatetimeLocal(fu) : "")
    }

    const cancelCorrection = () => {
        setCorrectingPrev(false)
        setOutcome("")
        setNotClosedReason("")
        setNotes("")
        setCloseAmountEur("")
        setCloseDate(toRomeDatetimeLocal(new Date()))
        setNextFollowUpDate("")
    }

    const handleSave = async () => {
        if (!outcome) {
            alert("Seleziona un Esito Vendita")
            return
        }
        if (outcome === "Chiuso" && (!closeProduct || !closeAmountEur)) {
            alert("Prodotto e Importo sono obbligatori per le vendite chiuse.")
            return
        }
        if (outcome === "Non chiuso" && !notClosedReason) {
            alert("Seleziona una motivazione valida.")
            return
        }
        if (surveyRequired && !surveyValid) {
            alert("Compila il sondaggio vendita (tutti i 3 blocchi) prima di salvare.")
            return
        }

        setIsSaving(true)
        try {
            // Salva il sondaggio PRIMA dell'esito: la guardia server (Task 9) lo cercherà già persistito.
            if (surveyRequired && surveyValid) {
                const sRes = await saveSalesSurvey(lead.id, {
                    problemSignals: survey.problemSignals,
                    urgencySignals: survey.urgencySignals,
                    priceReaction: survey.priceReaction!,
                    fillDurationMs: Date.now() - surveyStartedAt,
                })
                if (!sRes.success) {
                    alert(`Errore nel salvataggio del sondaggio: ${sRes.error}`)
                    return
                }
            }

            const result = await saveVenditoreOutcome(lead.id, {
                outcome,
                notes,
                closeProduct: outcome === "Chiuso" ? closeProduct : undefined,
                closeAmountEur: outcome === "Chiuso" ? parseFloat(closeAmountEur) : undefined,
                // Tutti i datetime-local sono interpretati come Europe/Rome (Sprint 2.4):
                // evita che chiusure registrate sera/notte cadano nella settimana sbagliata.
                // Inviata per OGNI esito: un "Non chiuso" registrato in ritardo deve
                // contare come presenza nel mese della trattativa, non in quello odierno.
                outcomeAt: closeDate ? (parseRomeDatetimeLocal(closeDate) || undefined) : undefined,
                notClosedReason: outcome === "Non chiuso" ? notClosedReason : undefined,
                nextFollowUpDate: outcome === "Non chiuso" && !followUpCapReached && nextFollowUpDate ? parseRomeDatetimeLocal(nextFollowUpDate) : null,
                // 'current' (correzione) quando l'utente l'ha chiesto esplicitamente
                // col bottone "Correggi questo esito", oppure quando è certo che non
                // ci sia una nuova occasione in ballo: fuori da followUpMode e senza
                // follow-up pendente. Se un follow-up è pendente il salvataggio può
                // esserne l'esito anche partendo dalla riga appuntamento, quindi si
                // resta sul comportamento storico ('new'). Il doppio conteggio del
                // fatturato è comunque impossibile: resolveAttemptWrite ammette una
                // sola chiusura per ciclo.
                occasion: (correctingPrev || !(followUpMode || lead?.nextFollowUpDate)) ? 'current' : 'new',
            }, lead.version)

            if (result && !result.success && result.error === 'CONCURRENCY_ERROR') {
                alert("Questo lead è stato modificato da un altro utente. Ricarica la pagina e riprova.")
                return
            }
            if (result?.rewardData) {
                const { emitRewardEarned } = await import('@/lib/animationUtils');
                emitRewardEarned(result.rewardData);
            }

            onSaved()
        } catch (error: any) {
            console.error("VenditoreDrawer save error:", error);
            alert(`Errore durante il salvataggio: ${error?.message || error}`)
        } finally {
            setIsSaving(false)
        }
    }

    const apptDate = lead?.appointmentDate ? new Date(lead.appointmentDate) : null

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header - sticky with glass effect */}
            <div className="px-4 sm:px-6 py-4 drawer-header flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <User className="h-5 w-5 text-gray-400" />
                        {correctingPrev ? "Correzione esito" : followUpMode ? "Esito Follow-up" : "Scheda Appuntamento"}
                    </h2>
                    {followUpMode && (
                        <div className="text-xs text-ash-500 mt-0.5 ml-7">
                            {correctingPrev
                                ? "Riscrivi l'ultimo tentativo registrato — non ne crea uno nuovo"
                                : <>Follow-up {Math.min(priorNonClosedCount, MAX_FOLLOW_UPS)} di {MAX_FOLLOW_UPS} — registra com&apos;è andata la chiamata</>}
                        </div>
                    )}
                </div>
                <button
                    onClick={onClose}
                    className="p-2 text-ash-400 hover:text-ash-600 hover:bg-ash-100 rounded-full transition-colors"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-8">

                {/* Lead Recap */}
                <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 space-y-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">{lead?.name}</h3>
                            <div className="mt-2 space-y-1">
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    {isStarted ? (
                                        <>
                                            <Phone className="h-4 w-4 text-gray-400" />
                                            <a href={`tel:${lead?.phone}`} className="hover:text-brand-orange hover:underline">{lead?.phone}</a>
                                        </>
                                    ) : (
                                        <>
                                            <Lock className="h-4 w-4 text-gray-400" />
                                            <span className="text-gray-400 italic">Numero visibile dopo l'avvio della trattativa</span>
                                        </>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Mail className="h-4 w-4 text-gray-400" />
                                    <a href={`mailto:${lead?.email}`} className="hover:text-brand-orange hover:underline">{lead?.email || "Non fornita"}</a>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Building className="h-4 w-4 text-gray-400" />
                                    <span>Funnel: <strong>{lead?.funnel || 'Sconosciuto'}</strong></span>
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            {apptDate && (
                                <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg border border-blue-100">
                                    <div className="text-xs uppercase font-bold tracking-wider mb-1">Appuntamento</div>
                                    <div className="font-bold flex items-center gap-1.5 justify-end">
                                        <Clock className="w-4 h-4" />
                                        {format(apptDate, "dd MMM yyyy - HH:mm", { locale: it })}
                                    </div>
                                    <div className="text-xs text-blue-500 mt-1">
                                        Generato da GDO {lead?.gdoCode}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {(lead?.appointmentNote) && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Note Precedenti (GDO/Conferme)</h4>
                            <div className="text-sm text-gray-700 bg-white p-3 rounded border border-gray-100">
                                {lead.appointmentNote}
                            </div>
                        </div>
                    )}
                </div>

                {/* Check-in trattativa: CTA finché non avviata (telefono/esito restano bloccati) */}
                {!isStarted && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex-1">
                            <div className="text-sm font-bold text-amber-900 flex items-center gap-2">
                                <Lock className="w-4 h-4" /> Trattativa non ancora avviata
                            </div>
                            <div className="text-xs text-amber-700 mt-1">
                                Avvia la trattativa per sbloccare il numero di telefono, il briefing e l'inserimento dell'esito.
                            </div>
                        </div>
                        <button
                            onClick={onStartNegotiation}
                            disabled={!onStartNegotiation || isStarting}
                            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 shrink-0"
                        >
                            {isStarting ? (
                                <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Play className="h-4 w-4" />
                            )}
                            {isStarting ? 'Avvio…' : 'Inizia trattativa'}
                        </button>
                    </div>
                )}

                {isStarted && (<>
                {/* Follow-up: recap read-only del tentativo precedente */}
                {followUpMode && lead?.salespersonOutcome && (
                    <div className="bg-ash-50 border border-ash-200 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-ash-500 uppercase tracking-widest mb-2">Tentativo precedente</h4>
                        <div className="text-sm text-ash-700 space-y-1">
                            <div>Esito: <strong>{lead.salespersonOutcome}</strong>
                                {lead.notClosedReason && <> — Motivo: <strong>{lead.notClosedReason}</strong></>}
                            </div>
                            {lead.salespersonOutcomeAt && (
                                <div className="text-xs text-ash-500">
                                    Registrato il {format(new Date(lead.salespersonOutcomeAt), "dd MMM yyyy - HH:mm", { locale: it })}
                                </div>
                            )}
                            {lead.nextFollowUpDate && (
                                <div className="text-xs text-ash-500">
                                    Follow-up pianificato: {format(new Date(lead.nextFollowUpDate), "dd MMM yyyy - HH:mm", { locale: it })}
                                </div>
                            )}
                            {lead.salespersonOutcomeNotes && (
                                <div className="text-xs text-ash-500">Note: {lead.salespersonOutcomeNotes}</div>
                            )}
                        </div>
                        <div className="mt-3 pt-3 border-t border-ash-200">
                            {correctingPrev ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-[11px] text-amber-700 font-semibold">
                                        Stai correggendo questo tentativo: il salvataggio lo riscrive, non ne aggiunge uno nuovo.
                                    </div>
                                    <button
                                        type="button"
                                        onClick={cancelCorrection}
                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-ash-100 text-ash-600 hover:bg-ash-200 transition-colors"
                                    >
                                        Annulla correzione
                                    </button>
                                </div>
                            ) : !showReschedule ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowReschedule(true)
                                            setRescheduleValue(lead?.nextFollowUpDate ? toRomeDatetimeLocal(new Date(lead.nextFollowUpDate)) : toRomeDatetimeLocal(new Date()))
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-700 hover:border-brand-orange/40 hover:text-brand-orange transition-colors"
                                    >
                                        <CalendarClock className="h-3.5 w-3.5" />
                                        Sposta follow-up
                                    </button>
                                    <button
                                        type="button"
                                        onClick={startCorrection}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-700 hover:border-brand-orange/40 hover:text-brand-orange transition-colors"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                        Correggi questo esito
                                    </button>
                                    <div className="text-[11px] text-ash-400">Il lead ha spostato? Cambia solo l&apos;orario: non consuma un follow-up.</div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        type="datetime-local"
                                        value={rescheduleValue}
                                        onChange={e => setRescheduleValue(e.target.value)}
                                        className="bg-white border border-ash-200 rounded-lg text-xs p-1.5 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleReschedule}
                                        disabled={isRescheduling || !rescheduleValue}
                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                    >
                                        {isRescheduling ? "Salvataggio…" : "Conferma nuova data"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowReschedule(false)}
                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-ash-100 text-ash-600 hover:bg-ash-200 transition-colors"
                                    >
                                        Annulla
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Banner lead già esitato (solo fuori dal flusso follow-up) */}
                {!followUpMode && lead?.salespersonOutcome && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <div className="text-sm font-bold text-blue-900">Questo lead è già stato esitato</div>
                            <div className="text-xs text-blue-700 mt-1">
                                Esito attuale: <strong>{lead.salespersonOutcome}</strong>
                                {lead.closeProduct && <> — Prodotto: <strong>{lead.closeProduct}</strong></>}
                                {lead.closeAmountEur && <> — Importo: <strong>€{lead.closeAmountEur}</strong></>}
                                {lead.notClosedReason && <> — Motivo: <strong>{lead.notClosedReason}</strong></>}
                            </div>
                            <div className="text-xs text-blue-600 mt-1">Puoi comunque sovrascrivere l'esito modificando i campi sotto.</div>
                        </div>
                    </div>
                )}

                {/* Form Esito */}
                <div className="space-y-6">
                    <h3 className="text-lg font-bold text-gray-900 border-b border-gray-200 pb-2">{correctingPrev ? "Correzione dell'ultimo esito" : followUpMode ? "Esito della chiamata di follow-up" : "Esito Vendita"}</h3>

                    {/* Select Esito */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {followUpMode ? "Seleziona l'esito della chiamata *" : "Seleziona l'esito dell'appuntamento *"}
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            {OUTCOME_OPTIONS.map(o => (
                                <button
                                    key={o}
                                    onClick={() => setOutcome(o)}
                                    className={`px-4 py-3 border rounded-lg font-medium text-sm transition-all text-center
                                    ${outcome === o
                                            ? (o === 'Chiuso' ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500' :
                                                o === 'Non chiuso' ? 'bg-orange-50 border-orange-500 text-orange-700 ring-1 ring-orange-500' :
                                                    'bg-gray-100 border-gray-500 text-gray-700 ring-1 ring-gray-500')
                                            : 'bg-white border-gray-200 text-gray-500 hover:border-brand-orange hover:bg-orange-50/30'
                                        }`}
                                >
                                    {o}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* VENDITA CHIUSA FORM */}
                    {outcome === "Chiuso" && (
                        <div className="p-4 bg-green-50 rounded-xl border border-green-200 space-y-4 animate-fade-in">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-green-900 mb-1">Prodotto Venduto *</label>
                                    <select
                                        value={closeProduct}
                                        onChange={e => setCloseProduct(e.target.value)}
                                        className="input-fenice text-sm !border-green-200"
                                    >
                                        <option value="advance">Advance</option>
                                        <option value="gold">Gold</option>
                                        <option value="exclusive">Exclusive</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-green-900 mb-1">Importo (EUR) *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="text-gray-500 sm:text-sm">€</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={closeAmountEur}
                                            onChange={e => setCloseAmountEur(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full pl-7 bg-white border border-green-200 rounded p-2 text-sm focus:ring-green-500 focus:border-green-500"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-green-900 mb-1">Data effettiva chiusura *</label>
                                <input
                                    type="datetime-local"
                                    value={closeDate}
                                    onChange={e => setCloseDate(e.target.value)}
                                    className="w-full bg-white border border-green-200 rounded p-2 text-sm focus:ring-green-500 focus:border-green-500"
                                />
                                <p className="text-xs text-green-700/80 mt-1">
                                    Default = adesso. Se il contratto è stato firmato in un altro momento (es. sabato ma esito inserito lunedì), correggi qui per non sballare i KPI settimanali.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* VENDITA NON CHIUSA FORM */}
                    {outcome === "Non chiuso" && (
                        <div className="p-4 bg-orange-50 rounded-xl border border-orange-200 space-y-4 animate-fade-in">
                            <div>
                                <label className="block text-sm font-medium text-orange-900 mb-1">Motivazione *</label>
                                <select
                                    value={notClosedReason}
                                    onChange={e => setNotClosedReason(e.target.value)}
                                    className="input-fenice text-sm !border-orange-200"
                                >
                                    <option value="" disabled>Seleziona un motivo...</option>
                                    {NOT_CLOSED_REASONS.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="pt-4 border-t border-orange-200">
                                <h4 className="text-sm font-bold text-orange-900 mb-1">Prossimo follow-up (facoltativo)</h4>
                                {followUpCapReached ? (
                                    <p className="text-xs text-orange-700 mb-1">Hai già usato tutti i {MAX_FOLLOW_UPS} follow-up per questo lead: puoi salvare l&apos;esito ma non pianificarne un altro.</p>
                                ) : (
                                    <div>
                                        <p className="text-xs text-orange-700 mb-3">Se vuoi ricontattare il lead, imposta quando: comparirà nella tua tab &quot;Follow-up&quot;. Altrimenti lascia vuoto.</p>
                                        <input
                                            type="datetime-local"
                                            value={nextFollowUpDate}
                                            onChange={e => setNextFollowUpDate(e.target.value)}
                                            className="input-fenice text-sm !border-orange-200 !p-1.5 w-full"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* SPARITO INFO */}
                    {outcome === "Sparito" && (
                        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600 flex items-start gap-2 animate-fade-in">
                            <AlertCircle className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                            <p>Il lead non si è presentato all'appuntamento ("no-show"). Non sono richieste ulteriori annotazioni o follow-up obbligatori.</p>
                        </div>
                    )}

                    {/* DATA EFFETTIVA ESITO — per gli esiti non-Chiuso (Chiuso ha il suo campo dedicato).
                        I KPI mensili (Trattative presenziate) usano questa data: se l'esito viene
                        registrato in ritardo, deve restare attribuito al giorno reale della trattativa. */}
                    {outcome && outcome !== "Chiuso" && (
                        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 animate-fade-in">
                            <label className="block text-sm font-medium text-gray-900 mb-1">Data effettiva esito *</label>
                            <input
                                type="datetime-local"
                                value={closeDate}
                                onChange={e => setCloseDate(e.target.value)}
                                className="input-fenice text-sm !p-1.5 w-full"
                            />
                            <div className="text-xs text-gray-500 mt-1">
                                Se stai registrando ora l&apos;esito di una trattativa avvenuta in passato, imposta la data reale della trattativa: i KPI mensili contano la presenza su questa data.
                            </div>
                        </div>
                    )}

                    {/* Sondaggio Vendita — obbligatorio per Chiuso e Non chiuso (funnel≠database) */}
                    {surveyRequired && (
                        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                            <VenditoreSurveyInline
                                value={survey}
                                onChange={setSurvey}
                                disabled={isSaving}
                            />
                        </div>
                    )}

                    {/* NOTE GENERALI FACULTATIVE */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Note (facoltative)
                        </label>
                        <textarea
                            rows={3}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="input-fenice text-sm"
                            placeholder="Aggiungi ulteriori dettagli..."
                        />
                    </div>
                </div>
                </>)}

            </div>

            {/* Footer — solo a trattativa avviata */}
            {isStarted && (
            <div className="p-6 border-t border-ash-200 bg-ash-50 flex justify-end gap-3 sticky bottom-0">
                <button
                    onClick={onClose}
                    className="btn-secondary text-sm py-2.5 px-6"
                >
                    Annulla
                </button>
                <button
                    onClick={handleSave}
                    disabled={isSaving || !outcome}
                    className="btn-primary text-sm py-2.5 px-6 disabled:opacity-50"
                >
                    {isSaving ? (
                        <span className="h-4 w-4 border-2 border-brand-charcoal/30 border-t-brand-charcoal rounded-full animate-spin" />
                    ) : (
                        <Save className="h-4 w-4" />
                    )}
                    {isSaving ? "Salvataggio..." : correctingPrev ? "Salva correzione" : followUpMode ? "Salva esito follow-up" : "Salva Esito"}
                </button>
            </div>
            )}
        </div>
    )
}
