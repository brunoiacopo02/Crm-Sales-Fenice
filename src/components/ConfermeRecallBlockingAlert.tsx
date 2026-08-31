"use client"

/**
 * Avviso BLOCCANTE per i richiami Conferme scaduti.
 *
 * Spec: docs/superpowers/specs/2026-08-31-avviso-bloccante-richiami-conferme-design.md
 *
 * Prende tutto lo schermo e non si chiude: niente X, niente ESC, niente click
 * fuori. Le uniche tre uscite sono i bottoni — aprire il lead (spegne l'avviso
 * per tutti), prenderlo in carico (resta solo a chi ha cliccato, 10 minuti), o
 * snoozare 2 minuti (silenzio per tutti, poi torna).
 *
 * Sostituisce l'`alert()` nativo che stava dentro ConfermeBoard: quello partiva
 * solo per chi era sulla board, solo sui lead di oggi/domani e una volta sola.
 *
 * Tre fonti di aggiornamento che convergono sulla stessa load(): il ping 'leads'
 * del bus (il claim di un collega arriva in ~1,5s), un poll di riserva da 30s
 * (il realtime a volte muore in silenzio) e un timer armato su `nextWakeAt`, che
 * riaccende l'avviso al secondo esatto in cui lo snooze o un claim scadono.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlarmClock, Phone, Hand, Timer } from "lucide-react"
import {
    getConfermeBlockingAlert,
    snoozeConfermeAlert,
    claimConfermeAlert,
    markConfermeAlertHandled,
    type BlockingAlertPayload,
} from "@/app/actions/confermeAlertActions"
import { onBusEvent } from "@/lib/realtimeBus"
import { useSalesCompany } from "@/components/providers/SalesCompanyProvider"

const POLL_MS = 30_000

const COMPANY_CHIP: Record<string, { label: string; className: string }> = {
    fenice: { label: 'FENICE', className: 'bg-orange-500/20 text-orange-200 border-orange-400/50' },
    serenamente: { label: 'SERENAMENTE', className: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50' },
    fcd: { label: 'FCD', className: 'bg-purple-500/20 text-purple-200 border-purple-400/50' },
}

function ritardo(snoozeAt: string): string {
    const diffMin = Math.max(0, Math.floor((Date.now() - new Date(snoozeAt).getTime()) / 60_000))
    if (diffMin < 1) return "adesso"
    if (diffMin < 60) return `${diffMin} min fa`
    const h = Math.floor(diffMin / 60)
    if (h < 24) return `${h}h ${diffMin % 60}min fa`
    const g = Math.floor(h / 24)
    return g === 1 ? "ieri" : `${g} giorni fa`
}

export function ConfermeRecallBlockingAlert() {
    const [data, setData] = useState<BlockingAlertPayload | null>(null)
    const [busy, setBusy] = useState(false)
    const activeCompany = useSalesCompany()
    const router = useRouter()
    const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const load = useCallback(async () => {
        try {
            setData(await getConfermeBlockingAlert())
        } catch {
            // errore transitorio: si riprova al prossimo giro, senza spegnere
            // quello che è già a schermo
        }
    }, [])

    useEffect(() => {
        load()
        const interval = setInterval(load, POLL_MS)
        const offBus = onBusEvent("leads", () => load())
        const onFocus = () => load()
        window.addEventListener("focus", onFocus)
        return () => {
            clearInterval(interval)
            offBus()
            window.removeEventListener("focus", onFocus)
        }
    }, [load])

    // Sveglia puntuale: fine snooze o scadenza di un claim altrui.
    useEffect(() => {
        if (wakeTimer.current) { clearTimeout(wakeTimer.current); wakeTimer.current = null }
        if (!data?.nextWakeAt) return
        const delay = new Date(data.nextWakeAt).getTime() - Date.now()
        wakeTimer.current = setTimeout(load, Math.max(500, Math.min(delay + 250, POLL_MS)))
        return () => { if (wakeTimer.current) clearTimeout(wakeTimer.current) }
    }, [data?.nextWakeAt, load])

    const alert = data?.alert ?? null

    // Blocca lo scroll della pagina sotto: l'overlay è una barriera, non un velo.
    useEffect(() => {
        if (!alert) return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = prev }
    }, [alert])

    if (!alert) return null

    const chip = COMPANY_CHIP[alert.companyId]
        || { label: alert.companyId.toUpperCase(), className: 'bg-white/10 text-white border-white/30' }
    const isOtherCompany = alert.companyId !== activeCompany

    // Ottimistico: l'overlay sparisce subito a chi clicca, senza aspettare il
    // round-trip. Il ping realtime allinea gli altri schermi entro un paio di
    // secondi; il poll rimette le cose a posto se la scrittura è fallita.
    const act = async (fn: () => Promise<unknown>) => {
        if (busy) return
        setBusy(true)
        setData(d => (d ? { ...d, alert: null } : d))
        try { await fn() } finally {
            setBusy(false)
            load()
        }
    }

    const apriLead = () => act(async () => {
        await markConfermeAlertHandled(alert.id)
        if (isOtherCompany) {
            await fetch('/api/company/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: alert.companyId }),
            })
        }
        router.push(`/conferme?lead=${alert.id}`)
        router.refresh()
    })

    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Richiamo Conferme da fare"
            className="fixed inset-0 z-[200] flex items-center justify-center bg-ash-900 p-4"
        >
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-ash-800 p-8 text-center shadow-2xl">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/20 text-red-300">
                    <AlarmClock className="h-9 w-9 animate-pulse" />
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-[11px] font-black tracking-widest ${chip.className}`}>
                        {chip.label}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-widest text-red-300">
                        Richiamo da fare · {ritardo(alert.snoozeAt)}
                    </span>
                    {data && data.queueTotal > 1 && (
                        <span className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] font-bold text-white/70">
                            1 di {data.queueTotal}
                        </span>
                    )}
                </div>

                <h2 className="mt-3 text-3xl font-black tracking-tight text-white">{alert.name}</h2>

                {alert.phone && (
                    <a
                        href={`tel:${alert.phone}`}
                        className="mt-2 inline-block text-4xl font-black tracking-tight text-emerald-300 hover:text-emerald-200"
                    >
                        {alert.phone}
                    </a>
                )}

                {alert.notes && (
                    <p className="mx-auto mt-4 max-w-lg rounded-xl bg-white/5 p-3 text-sm italic text-white/70">
                        "{alert.notes}"
                    </p>
                )}

                {alert.claimedByMe && (
                    <p className="mt-4 text-sm font-semibold text-amber-300">
                        L'hai preso in carico tu: gli altri non lo vedono più.
                    </p>
                )}

                {isOtherCompany && (
                    <p className="mt-3 text-sm text-white/60">
                        È un lead {chip.label}: aprendolo il CRM passa in automatico a quell'azienda.
                    </p>
                )}

                <div className="mt-8 flex flex-col gap-3">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={apriLead}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-lg font-black text-white transition hover:bg-emerald-400 disabled:opacity-60"
                    >
                        <Phone className="h-5 w-5" />
                        Apri e chiamalo
                    </button>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(() => claimConfermeAlert(alert.id))}
                            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:opacity-60"
                        >
                            <Hand className="h-4 w-4" />
                            Lo chiamo io
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(() => snoozeConfermeAlert(alert.id))}
                            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-white/60 transition hover:bg-white/5 disabled:opacity-60"
                        >
                            <Timer className="h-4 w-4" />
                            Snooze 2 min
                        </button>
                    </div>
                </div>

                <p className="mt-5 text-xs text-white/40">
                    "Lo chiamo io" tiene l'avviso solo per te per 10 minuti. Lo snooze lo ripropone a tutti fra 2 minuti.
                </p>
            </div>
        </div>
    )
}
