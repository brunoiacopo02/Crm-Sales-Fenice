"use client"

import { useState, useEffect, useCallback } from "react"
import { Calendar, Clock, X, Save } from "lucide-react"

type EditAppointmentModalProps = {
    isOpen: boolean
    onClose: () => void
    onSave: (date: string, time: string, note: string) => Promise<void>
    initialDate: Date | null
    initialNote: string | null
    leadName: string
}

export function EditAppointmentModal({ isOpen, onClose, onSave, initialDate, initialNote, leadName }: EditAppointmentModalProps) {
    // Formatta Date in stringhe compatibili per input type="date" e type="time"
    const getInitialDateStr = () => {
        if (!initialDate) return ""
        const d = new Date(initialDate)
        return d.toISOString().split('T')[0]
    }

    const getInitialTimeStr = () => {
        if (!initialDate) return ""
        const d = new Date(initialDate)
        return d.toTimeString().split(' ')[0].slice(0, 5)
    }

    const [date, setDate] = useState(getInitialDateStr())
    const [time, setTime] = useState(getInitialTimeStr())
    const [note, setNote] = useState(initialNote || "")
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        if (isOpen) {
            setDate(getInitialDateStr())
            setTime(getInitialTimeStr())
            setNote(initialNote || "")
        }
    }, [isOpen, initialDate, initialNote])

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

    const handleSave = async () => {
        setIsSaving(true)
        try {
            await onSave(date, time, note)
            onClose()
        } catch (e) {
            console.error(e)
            alert("Errore durante il salvataggio")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="modal-backdrop" onClick={onClose} />

            {/* Modal */}
            <div className="relative modal-content w-full max-w-md z-50">
                <div className="flex items-center justify-between p-4 border-b border-ash-200 drawer-header rounded-t-xl">
                    <h3 className="font-bold text-gray-900 pr-8 truncate">
                        Modifica Appuntamento
                        <span className="block text-xs font-normal text-ash-500 truncate">{leadName}</span>
                    </h3>
                    <button onClick={onClose} className="p-2 text-ash-400 hover:text-ash-600 hover:bg-ash-100 rounded-full transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                                <Calendar className="h-4 w-4 text-brand-orange" /> Data
                            </label>
                            <input
                                type="date"
                                value={date}
                                onChange={e => setDate(e.target.value)}
                                className="input-fenice text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                                <Clock className="h-4 w-4 text-brand-orange" /> Ora
                            </label>
                            <input
                                type="time"
                                value={time}
                                onChange={e => setTime(e.target.value)}
                                className="input-fenice text-sm"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold text-gray-700">Note per le Conferme / GDO</label>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            rows={3}
                            placeholder="Es. Richiamare dopo le 18..."
                            className="input-fenice text-sm resize-none"
                        ></textarea>
                    </div>
                </div>

                <div className="p-4 border-t border-ash-200 bg-ash-50 rounded-b-xl flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="btn-secondary text-sm py-2 px-4"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !date || !time}
                        className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
                    >
                        {isSaving ? <span className="h-4 w-4 border-2 border-brand-charcoal/30 border-t-brand-charcoal rounded-full animate-spin"></span> : <Save className="h-4 w-4" />}
                        Salva Modifiche
                    </button>
                </div>
            </div>
        </div>
    )
}
