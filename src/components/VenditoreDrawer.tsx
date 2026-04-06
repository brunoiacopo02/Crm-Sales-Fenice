"use client"

import { useState } from "react"
import { saveVenditoreOutcome } from "@/app/actions/venditoreActions"
import { X, User, Phone, Mail, Clock, Save, Building, AlertCircle } from "lucide-react"
import { format } from "date-fns"
import { it } from "date-fns/locale"

interface VenditoreDrawerProps {
    lead: any
    onClose: () => void
    onSaved: () => void
}

const NOT_CLOSED_REASONS = [
    "Non ha soldi",
    "Deve parlare con terzi",
    "Valuta altri percorsi",
    "Non ha urgenza reale",
    "Non vuole decidere in call",
    "Troppo spaventato",
    "Fa già altri corsi",
    "Event imminente che lo blocca"
]

export function VenditoreDrawer({ lead, onClose, onSaved }: VenditoreDrawerProps) {
    const [outcome, setOutcome] = useState<string>(lead?.salespersonOutcome || "")
    const [closeProduct, setCloseProduct] = useState(lead?.closeProduct || "advance")
    const [closeAmountEur, setCloseAmountEur] = useState(lead?.closeAmountEur?.toString() || "")
    const [notClosedReason, setNotClosedReason] = useState(lead?.notClosedReason || "")
    const [notes, setNotes] = useState(lead?.salespersonOutcomeNotes || "")

    const [followUp1Date, setFollowUp1Date] = useState(lead?.followUp1Date ? format(new Date(lead.followUp1Date), "yyyy-MM-dd'T'HH:mm") : "")
    const [followUp2Date, setFollowUp2Date] = useState(lead?.followUp2Date ? format(new Date(lead.followUp2Date), "yyyy-MM-dd'T'HH:mm") : "")

    const [isSaving, setIsSaving] = useState(false)

    // Form logic validations
    const canAddFollowUp = !followUp1Date || !followUp2Date;

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
            alert("Seleziona una motivazione valida per cui la vendita non è chiusa.")
            return
        }

        setIsSaving(true)
        try {
            const result = await saveVenditoreOutcome(lead.id, {
                outcome,
                notes,
                closeProduct: outcome === "Chiuso" ? closeProduct : undefined,
                closeAmountEur: outcome === "Chiuso" ? parseFloat(closeAmountEur) : undefined,
                notClosedReason: outcome === "Non chiuso" ? notClosedReason : undefined,
                followUp1Date: outcome === "Non chiuso" && followUp1Date ? new Date(followUp1Date) : null,
                followUp2Date: outcome === "Non chiuso" && followUp2Date ? new Date(followUp2Date) : null,
            }, lead.version)

            if (result && !result.success && result.error === 'CONCURRENCY_ERROR') {
                alert("Questo lead è stato modificato da un altro utente. Ricarica la pagina e riprova.")
                return
            }

            onSaved()
        } catch (error) {
            alert("Errore durante il salvataggio")
        } finally {
            setIsSaving(false)
        }
    }

    const apptDate = lead?.appointmentDate ? new Date(lead.appointmentDate) : null

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <User className="h-5 w-5 text-gray-400" />
                    Scheda Appuntamento
                </h2>
                <button
                    onClick={onClose}
                    className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                >
                    <X className="h-5 w-5 text-gray-500" />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">

                {/* Lead Recap */}
                <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 space-y-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">{lead?.name}</h3>
                            <div className="mt-2 space-y-1">
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Phone className="h-4 w-4 text-gray-400" />
                                    <a href={`tel:${lead?.phone}`} className="hover:text-brand-orange hover:underline">{lead?.phone}</a>
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

                {/* Form Esito */}
                <div className="space-y-6">
                    <h3 className="text-lg font-bold text-gray-900 border-b border-gray-200 pb-2">Esito Vendita</h3>

                    {/* Select Esito */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Seleziona l'esito dell'appuntamento *
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {["Chiuso", "Non chiuso", "Sparito"].map(o => (
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
                                        className="w-full bg-white border border-green-200 rounded p-2 text-sm focus:ring-green-500 focus:border-green-500"
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
                                    className="w-full bg-white border border-orange-200 rounded p-2 text-sm focus:ring-orange-500 focus:border-orange-500"
                                >
                                    <option value="" disabled>Seleziona un motivo...</option>
                                    {NOT_CLOSED_REASONS.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="pt-4 border-t border-orange-200">
                                <h4 className="text-sm font-bold text-orange-900 mb-3">Opzionale: Pianifica Follow-up</h4>
                                <div className="space-y-3">
                                    <div className="flex gap-4 items-center">
                                        <div className="w-1/3 text-xs font-semibold text-orange-800 uppercase">Follow-up 1</div>
                                        <input
                                            type="datetime-local"
                                            value={followUp1Date}
                                            onChange={e => setFollowUp1Date(e.target.value)}
                                            className="flex-1 border text-sm border-orange-200 rounded p-1.5 bg-white"
                                        />
                                        {followUp1Date && (
                                            <button onClick={() => setFollowUp1Date('')} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                                        )}
                                    </div>
                                    <div className="flex gap-4 items-center opacity-70 hover:opacity-100 transition-opacity">
                                        <div className="w-1/3 text-xs font-semibold text-orange-800 uppercase">Follow-up 2</div>
                                        <input
                                            type="datetime-local"
                                            value={followUp2Date}
                                            onChange={e => setFollowUp2Date(e.target.value)}
                                            className="flex-1 border text-sm border-orange-200 rounded p-1.5 bg-white"
                                        />
                                        {followUp2Date && (
                                            <button onClick={() => setFollowUp2Date('')} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                                        )}
                                    </div>
                                    <p className="text-xs text-orange-700 mt-2">
                                        I follow-up verranno automaticamente aggiunti al tuo Google Calendar. Max 2 follow-up supportati.
                                    </p>
                                </div>
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

                    {/* NOTE GENERALI FACULTATIVE */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Note (facoltative)
                        </label>
                        <textarea
                            rows={3}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full bg-white border border-gray-300 rounded-lg p-3 text-sm focus:ring-brand-orange focus:border-brand-orange"
                            placeholder="Aggiungi ulteriori dettagli..."
                        />
                    </div>
                </div>

            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 sticky bottom-0">
                <button
                    onClick={onClose}
                    className="px-6 py-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors"
                >
                    Annulla
                </button>
                <button
                    onClick={handleSave}
                    disabled={isSaving || !outcome}
                    className="px-6 py-2.5 rounded-lg bg-brand-orange hover:bg-brand-orange-hover text-white flex items-center gap-2 text-sm font-bold transition-colors shadow-sm disabled:opacity-50"
                >
                    <Save className="h-4 w-4" />
                    {isSaving ? "Salvataggio..." : "Salva Esito"}
                </button>
            </div>
        </div>
    )
}
