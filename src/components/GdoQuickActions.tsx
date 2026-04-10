"use client"

import { useState, useRef, useEffect } from "react"
import { PhoneOff, Ban, CalendarClock, Handshake } from "lucide-react"
import { updateLeadOutcome } from "@/app/actions/pipelineActions"
import { useRouter } from "next/navigation"
import { getAnimationsEnabled } from "@/lib/animationUtils"
import { AppointmentDateTimePicker, RecallDateTimePicker } from "./DateTimePickers"

type GdoQuickActionsProps = {
    leadId: string
    leadVersion: number
    onSettled?: () => void
}

/** Spawn ~10 tiny confetti particles on a card for appointment celebration */
function spawnMiniConfetti(card: HTMLElement) {
    const colors = ['#FFD700', '#FF6B1A', '#FF8C42', '#34D399', '#60A5FA', '#F472B6']
    const rect = card.getBoundingClientRect()
    for (let i = 0; i < 10; i++) {
        const dot = document.createElement('div')
        const color = colors[i % colors.length]
        const x = (Math.random() - 0.5) * 120
        const y = -(40 + Math.random() * 60)
        const r = Math.random() * 360
        dot.style.cssText = `
            position:fixed;left:${rect.left + rect.width / 2}px;top:${rect.top + rect.height / 2}px;
            width:6px;height:6px;border-radius:${Math.random() > 0.5 ? '50%' : '1px'};
            background:${color};pointer-events:none;z-index:9999;
            --pa-x:${x}px;--pa-y:${y}px;--pa-r:${r}deg;
            animation:pa-confetti-burst 700ms ${i * 30}ms ease-out forwards;
        `
        document.body.appendChild(dot)
        setTimeout(() => dot.remove(), 1000)
    }
}

const DISCARD_REASONS = [
    "non interessato",
    "disoccupato",
    "straniero",
    "solo informazioni",
    "non vuole prendere l'appuntamento",
    "numero inesistente",
    "non ha potere decisionale",
    "non ha soldi"
]

export function GdoQuickActions({ leadId, leadVersion, onSettled }: GdoQuickActionsProps) {
    const router = useRouter()
    const [loading, setLoading] = useState(false)

    // Popover states
    const [activePopover, setActivePopover] = useState<'scartato' | 'richiamo' | 'appuntamento' | null>(null)
    const [note, setNote] = useState("")
    const [dateStr, setDateStr] = useState("")
    const [discardReason, setDiscardReason] = useState("")

    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setActivePopover(null)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const handleAction = async (outcome: 'NON_RISPOSTO' | 'DA_SCARTARE' | 'RICHIAMO' | 'APPUNTAMENTO') => {
        setLoading(true)
        try {
            let targetDate: Date | undefined = undefined
            if ((outcome === 'RICHIAMO' || outcome === 'APPUNTAMENTO') && dateStr) {
                targetDate = new Date(dateStr)
            }

            const result = await updateLeadOutcome(leadId, outcome, note, targetDate, undefined, outcome === 'DA_SCARTARE' ? discardReason : undefined, leadVersion)

            if (result && !result.success && result.error === 'CONCURRENCY_ERROR') {
                alert("Questo lead è stato modificato da un altro utente. La pagina verrà aggiornata.")
                router.refresh()
                return
            }
            if (result?.rewardData) {
                const { emitRewardEarned } = await import('@/lib/animationUtils');
                emitRewardEarned(result.rewardData);
            }

            // Reset states
            setActivePopover(null)
            setNote("")
            setDateStr("")
            setDiscardReason("")

            // Micro-animation on the card before refresh (FA-015)
            let animDelay = 0
            if (getAnimationsEnabled()) {
                const card = containerRef.current?.closest('[data-lead-card]') as HTMLElement | null
                if (card) {
                    switch (outcome) {
                        case 'APPUNTAMENTO':
                            spawnMiniConfetti(card)
                            card.style.animation = 'pa-slide-out 600ms ease-in forwards'
                            animDelay = 650
                            break
                        case 'DA_SCARTARE':
                            card.style.animation = 'pa-fade-discard 400ms ease-out forwards'
                            animDelay = 450
                            break
                        case 'RICHIAMO':
                            card.style.animation = 'pa-amber-pulse 800ms ease-in-out'
                            animDelay = 850
                            break
                        default: // NON_RISPOSTO
                            card.style.animation = 'pa-bounce 200ms ease-out'
                            animDelay = 250
                            break
                    }
                }
            }

            if (animDelay > 0) {
                await new Promise(r => setTimeout(r, animDelay))
            }
            router.refresh()
            if (onSettled) onSettled()
        } catch (e) {
            alert("Errore nell'aggiornamento dell'esito")
        } finally {
            setLoading(false)
        }
    }

    const openPopover = (e: React.MouseEvent, type: 'scartato' | 'richiamo' | 'appuntamento') => {
        e.stopPropagation()
        setActivePopover(activePopover === type ? null : type)
        // reset form on open
        setNote("")
        setDateStr("")
        setDiscardReason("")
    }

    const isSubmitDisabled = 
        loading || 
        (activePopover === 'scartato' && !discardReason) || 
        ((activePopover === 'richiamo' || activePopover === 'appuntamento') && !dateStr)

    return (
        <div className="relative flex items-center gap-1.5" ref={containerRef}>
            {/* Quick Actions Row */}
            <button
                onClick={(e) => { e.stopPropagation(); handleAction('NON_RISPOSTO'); }}
                disabled={loading}
                className="bg-white border border-ash-200 hover:bg-ash-50 text-ash-600 hover:text-ash-900 px-2.5 py-1.5 rounded-md text-[11px] font-bold shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title="Non Risposto"
            >
                <PhoneOff className="w-3.5 h-3.5" /> NR
            </button>

            <button
                onClick={(e) => openPopover(e, 'scartato')}
                disabled={loading}
                className={`bg-white border  hover:bg-rose-50 text-rose-600 hover:border-rose-300 px-2.5 py-1.5 rounded-md text-[11px] font-bold shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 ${activePopover === 'scartato' ? 'border-rose-400 bg-rose-50' : 'border-ash-200'}`}
            >
                <Ban className="w-3.5 h-3.5" /> Scartato
            </button>

            <button
                onClick={(e) => openPopover(e, 'richiamo')}
                disabled={loading}
                className={`bg-white border hover:bg-blue-50 text-blue-600 hover:border-blue-300 px-2.5 py-1.5 rounded-md text-[11px] font-bold shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 ${activePopover === 'richiamo' ? 'border-blue-400 bg-blue-50' : 'border-ash-200'}`}
            >
                <CalendarClock className="w-3.5 h-3.5" /> Richiamo
            </button>

            <button
                onClick={(e) => openPopover(e, 'appuntamento')}
                disabled={loading}
                className={`bg-brand-orange border border-brand-orange-hover hover:bg-brand-orange-hover text-white px-3 py-1.5 rounded-md text-[11px] font-bold shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 ${activePopover === 'appuntamento' ? 'ring-2 ring-orange-300' : ''}`}
            >
                <Handshake className="w-3.5 h-3.5" /> App Preso
            </button>

            {/* POPOVER SCARTATO */}
            {activePopover === 'scartato' && (
                <div onClick={e => e.stopPropagation()} className="absolute right-0 top-[110%] w-64 bg-white border border-ash-200 rounded-xl shadow-xl z-50 p-4 animate-in fade-in slide-in-from-top-2">
                    <h4 className="text-[12px] font-bold text-rose-700 mb-3 flex items-center gap-1.5"><Ban className="w-3.5 h-3.5" /> Scarta Lead</h4>
                    
                    <select
                        value={discardReason}
                        onChange={(e) => setDiscardReason(e.target.value)}
                        className="input-fenice !text-xs !py-2 !px-2.5 !border-rose-200 mb-2 font-medium"
                    >
                        <option value="" disabled>-- Motivo Scarto --</option>
                        {DISCARD_REASONS.map(reason => (
                            <option key={reason} value={reason}>{reason}</option>
                        ))}
                    </select>

                    <div className="flex justify-end gap-2 mt-3">
                        <button onClick={() => setActivePopover(null)} className="px-2 py-1 text-xs text-ash-500 font-semibold">Annulla</button>
                        <button onClick={() => handleAction('DA_SCARTARE')} disabled={isSubmitDisabled} className="px-3 py-1.5 text-xs bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold disabled:opacity-50">
                            Conferma Scarto
                        </button>
                    </div>
                </div>
            )}

            {/* POPOVER RICHIAMO O APPUNTAMENTO */}
            {(activePopover === 'richiamo' || activePopover === 'appuntamento') && (
                <div onClick={e => e.stopPropagation()} className="absolute right-0 top-[110%] w-72 bg-white border border-ash-200 rounded-xl shadow-xl z-50 p-4 animate-in fade-in slide-in-from-top-2">
                    <h4 className={`text-[12px] font-bold mb-3 flex items-center gap-1.5 ${activePopover === 'appuntamento' ? 'text-brand-orange' : 'text-blue-600'}`}>
                        {activePopover === 'appuntamento' ? <><Handshake className="w-3.5 h-3.5" /> Fissa Appuntamento</> : <><CalendarClock className="w-3.5 h-3.5" /> Programma Richiamo</>}
                    </h4>
                    
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-ash-400 mb-1">Data e Ora *</label>
                    <div className="mb-3">
                        {activePopover === 'appuntamento' ? (
                            <AppointmentDateTimePicker value={dateStr} onChange={setDateStr} compact />
                        ) : (
                            <RecallDateTimePicker value={dateStr} onChange={setDateStr} compact />
                        )}
                    </div>

                    <label className="block text-[10px] font-bold uppercase tracking-wider text-ash-400 mb-1">Note (Opzionale)</label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={activePopover === 'appuntamento' ? "Note per le Conferme..." : "Motivo del richiamo..."}
                        className="input-fenice !text-xs !py-2 !px-2.5 resize-none h-16 mb-3"
                    />

                    <div className="flex justify-end gap-2">
                        <button onClick={() => setActivePopover(null)} className="px-2 py-1 text-xs text-ash-500 font-semibold">Annulla</button>
                        <button 
                            onClick={() => handleAction(activePopover === 'appuntamento' ? 'APPUNTAMENTO' : 'RICHIAMO')} 
                            disabled={isSubmitDisabled} 
                            className={`px-3 py-1.5 text-xs text-white rounded-lg font-bold disabled:opacity-50 ${activePopover === 'appuntamento' ? 'bg-brand-orange hover:bg-brand-orange-hover' : 'bg-blue-600 hover:bg-blue-700'}`}
                        >
                            Conferma {activePopover === 'appuntamento' ? 'App.' : 'Richiamo'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
