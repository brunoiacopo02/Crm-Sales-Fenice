"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import { AlertTriangle, Clock } from "lucide-react"
import { startNegotiation } from "@/app/actions/venditoreActions"

const VenditoreDrawer = dynamic(
    () => import("@/components/VenditoreDrawer").then(mod => mod.VenditoreDrawer),
    {
        ssr: false,
        loading: () => (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" />
            </div>
        ),
    }
)

export type OverdueLead = {
    id: string
    name: string | null
    phone: string | null
    appointmentDate: string | null
    negotiationStartedAt: string | null
    funnel: string | null
    version: number
}

interface OutcomeGateProps {
    overdue: OverdueLead[]
}

export function OutcomeGate({ overdue }: OutcomeGateProps) {
    const router = useRouter()
    const [selectedLead, setSelectedLead] = useState<any>(null)
    const [pendingId, setPendingId] = useState<string | null>(null)
    const [isPending, startTransitionFn] = useTransition()

    // Intercept ESC — prevent closing the gate
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                // If drawer is open, close it; otherwise block ESC entirely
                if (selectedLead) {
                    setSelectedLead(null)
                } else {
                    e.preventDefault()
                    e.stopPropagation()
                }
            }
        }
        document.addEventListener("keydown", handler, true)
        return () => document.removeEventListener("keydown", handler, true)
    }, [selectedLead])

    if (overdue.length === 0) return null

    const handleRegistra = (lead: OverdueLead) => {
        setPendingId(lead.id)
        startTransitionFn(async () => {
            try {
                if (!lead.negotiationStartedAt) {
                    const result = await startNegotiation(lead.id)
                    if (!result.success) {
                        alert(result.error || "Errore durante l'avvio della trattativa")
                        return
                    }
                    setSelectedLead({
                        ...lead,
                        phone: result.phone ?? lead.phone,
                        negotiationStartedAt: new Date().toISOString(),
                    })
                } else {
                    setSelectedLead(lead)
                }
            } catch {
                alert("Errore di rete. Riprova.")
            } finally {
                setPendingId(null)
            }
        })
    }

    const closeDrawer = () => setSelectedLead(null)

    return (
        <>
            {/* Opaque backdrop — blocks all interaction with the dashboard below */}
            <div className="fixed inset-0 z-[100] bg-gray-950/95 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-elevated w-full max-w-lg overflow-hidden">
                    {/* Header */}
                    <div className="bg-red-50 border-b border-red-200 px-6 py-5 flex items-center gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-red-900 leading-tight">
                                Hai {overdue.length} {overdue.length === 1 ? "esito" : "esiti"} da registrare prima di continuare
                            </h2>
                            <p className="text-sm text-red-700 mt-0.5">
                                Registra gli esiti degli appuntamenti passati per sbloccare la dashboard.
                            </p>
                        </div>
                    </div>

                    {/* Lead list */}
                    <div className="divide-y divide-ash-100 max-h-[60vh] overflow-y-auto">
                        {overdue.map((lead) => {
                            const apptDate = lead.appointmentDate ? new Date(lead.appointmentDate) : null
                            const isThisPending = pendingId === lead.id

                            return (
                                <div key={lead.id} className="px-6 py-4 flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="font-semibold text-ash-800 truncate">
                                            {lead.name || "Lead senza nome"}
                                        </div>
                                        {apptDate && (
                                            <div className="flex items-center gap-1 text-sm text-ash-500 mt-0.5">
                                                <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                                                <span>
                                                    {format(apptDate, "dd MMM yyyy, HH:mm", { locale: it })}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleRegistra(lead)}
                                        disabled={isThisPending}
                                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                                    >
                                        {isThisPending ? "Avvio..." : "Registra esito"}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

            {/* Drawer — rendered above the gate (z-[110]) */}
            {selectedLead && (
                <div className="fixed inset-0 z-[110] flex justify-end">
                    <div
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
                        onClick={closeDrawer}
                    />
                    <div className="relative w-full max-w-2xl bg-white h-full shadow-elevated flex flex-col pt-[72px] animate-slide-in-right">
                        <VenditoreDrawer
                            lead={selectedLead}
                            onClose={closeDrawer}
                            onSaved={() => {
                                closeDrawer()
                                router.refresh()
                            }}
                        />
                    </div>
                </div>
            )}
        </>
    )
}
