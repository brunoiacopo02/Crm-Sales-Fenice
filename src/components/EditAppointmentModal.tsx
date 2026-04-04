"use client"

import { useState } from "react"
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in-95 duration-200">
                
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
                    <h3 className="font-bold text-gray-900 pr-8 truncate">
                        Modifica Appuntamento
                        <span className="block text-xs font-normal text-gray-500 truncate">{leadName}</span>
                    </h3>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                                <Calendar className="h-4 w-4 text-brand-orange" /> Data
                            </label>
                            <input 
                                type="date" 
                                value={date}
                                onChange={e => setDate(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50 focus:border-brand-orange transition-all"
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
                                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50 focus:border-brand-orange transition-all"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold text-gray-700">Note per the Conferme / GDO</label>
                        <textarea 
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            rows={3}
                            placeholder="Es. Richiamare dopo le 18..."
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50 focus:border-brand-orange transition-all resize-none"
                        ></textarea>
                    </div>
                </div>

                <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                    <button 
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        Annulla
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={isSaving || !date || !time}
                        className="px-4 py-2 text-sm font-semibold text-white bg-black rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSaving ? <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> : <Save className="h-4 w-4" />}
                        Salva Modifiche
                    </button>
                </div>

            </div>
        </div>
    )
}
