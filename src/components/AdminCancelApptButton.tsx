"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"
import { cancelLeadAppointment } from "@/app/actions/appointmentActions"

export function AdminCancelApptButton({ leadId, leadName }: { leadId: string; leadName: string }) {
    const router = useRouter()
    const [busy, setBusy] = useState(false)

    const handle = async () => {
        if (!confirm(`Cancellare l'appuntamento di "${leadName}"?\n\nIl lead resterà nel CRM (pipeline) ma SARANNO RESETTATI:\n• data/ora appuntamento\n• venditore assegnato\n• esito conferme + esito vendita\n\nPer cancellare il lead intero, usalo dalla scheda contatto via barra ricerca.`)) return
        setBusy(true)
        try {
            const res = await cancelLeadAppointment(leadId)
            if (!res.success) {
                alert(`Errore: ${res.error || 'sconosciuto'}`)
                return
            }
            router.refresh()
        } catch (e: any) {
            alert(`Errore: ${e?.message || e}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <button
            onClick={handle}
            disabled={busy}
            title="Cancella solo l'appuntamento (lead resta nel CRM)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Cancella App
        </button>
    )
}
