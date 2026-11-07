"use client"

/**
 * "App da verificare" (PO 07/11/2026): gli appuntamenti di oggi confermati dalle
 * Conferme il giorno prima. Un'ora prima della call il bot chiede al lead di confermare;
 * qui si vede in tempo reale chi l'ha fatto e chi va chiamato. Chi è da chiamare blocca
 * anche lo schermo (ConfermeRecallBlockingAlert, kind 'verifica').
 *
 * Aggiornamento: ping 'leads' del bus (le scritture del bot e dei colleghi), poll di
 * riserva da 30s e una sveglia puntuale sul prossimo cambio di stato (messaggio in
 * partenza, scadenza dei 30 minuti). Nessun canale realtime nuovo.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CheckCircle2, Clock, PhoneCall, UserX, MessageCircleQuestion, ShieldCheck } from "lucide-react"
import {
    getAppDaVerificare,
    segnaVerificaGestita,
    segnaVerificaSparito,
    type AppDaVerificarePayload,
    type AppDaVerificareRow,
} from "@/app/actions/verificaBotActions"
import { onBusEvent } from "@/lib/realtimeBus"
import { toDialablePhone, telHref } from "@/lib/phoneDial"

const POLL_MS = 30_000

const ora = (iso: string) =>
    new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(new Date(iso))

type Chip = { label: string; classic: string; diretta: string }

function chip(r: AppDaVerificareRow): Chip {
    switch (r.stato) {
        case 'confermato':
            return { label: 'Confermato col bot', classic: 'bg-emerald-100 text-emerald-800 border-emerald-200', diretta: 'bg-emerald-500/15 text-emerald-300' }
        case 'da_chiamare':
            return { label: 'Da chiamare', classic: 'bg-red-100 text-red-800 border-red-200', diretta: 'bg-red-500/20 text-red-300' }
        case 'in_attesa':
            return { label: `In attesa fino alle ${r.dueAt ? ora(r.dueAt) : '—'}`, classic: 'bg-amber-100 text-amber-800 border-amber-200', diretta: 'bg-amber-500/15 text-amber-300' }
        case 'attesa_messaggio':
            return { label: `Messaggio alle ${r.dueAt ? ora(r.dueAt) : '—'}`, classic: 'bg-ash-100 text-ash-700 border-ash-200', diretta: 'bg-white/5 text-[var(--d-muted)]' }
        case 'gestita':
            return { label: 'Presa in carico', classic: 'bg-sky-100 text-sky-800 border-sky-200', diretta: 'bg-sky-500/15 text-sky-300' }
        case 'sparito':
            return { label: 'Sparito, venditore avvisato', classic: 'bg-ash-200 text-ash-700 border-ash-300', diretta: 'bg-white/10 text-[var(--d-muted)]' }
        case 'non_raggiunto':
            return { label: 'Il bot non l\'ha raggiunto', classic: 'bg-ash-100 text-ash-600 border-ash-200', diretta: 'bg-white/5 text-[var(--d-muted)]' }
        case 'esclusa':
            return { label: 'Call alle 9: niente messaggio', classic: 'bg-ash-100 text-ash-600 border-ash-200', diretta: 'bg-white/5 text-[var(--d-muted)]' }
    }
}

// Prima del messaggio del bot niente azioni: la verifica la fa lui.
const AZIONABILE = new Set(['da_chiamare', 'in_attesa', 'non_raggiunto', 'esclusa'])

export function AppDaVerificarePanel({ variant = 'classic' }: { variant?: 'classic' | 'diretta' }) {
    const [data, setData] = useState<AppDaVerificarePayload | null>(null)
    const [busyId, setBusyId] = useState<string | null>(null)
    const wake = useRef<ReturnType<typeof setTimeout> | null>(null)

    const load = useCallback(async () => {
        try { setData(await getAppDaVerificare()) } catch { /* si riprova al prossimo giro */ }
    }, [])

    useEffect(() => {
        load()
        const iv = setInterval(load, POLL_MS)
        const off = onBusEvent("leads", () => load())
        return () => { clearInterval(iv); off() }
    }, [load])

    useEffect(() => {
        if (wake.current) { clearTimeout(wake.current); wake.current = null }
        if (!data?.nextWakeAt) return
        const delay = new Date(data.nextWakeAt).getTime() - Date.now()
        wake.current = setTimeout(load, Math.max(500, Math.min(delay + 500, POLL_MS)))
        return () => { if (wake.current) clearTimeout(wake.current) }
    }, [data?.nextWakeAt, load])

    const rows = data?.rows ?? []
    if (rows.length === 0) return null

    const conta = (s: string) => rows.filter(r => r.stato === s).length
    const confermati = conta('confermato')
    const daChiamare = conta('da_chiamare')
    const inAttesa = conta('in_attesa') + conta('attesa_messaggio')

    const azione = async (id: string, fn: (id: string) => Promise<{ ok: boolean; error?: string }>) => {
        if (busyId) return
        setBusyId(id)
        try {
            const r = await fn(id)
            if (!r.ok) window.alert(r.error || "Operazione non riuscita. Riprova.")
        } finally {
            setBusyId(null)
            load()
        }
    }

    const diretta = variant === 'diretta'

    return (
        <section
            aria-label="App da verificare"
            className={diretta
                ? "mb-4 mt-4 rounded-2xl bg-[var(--d-surface)] p-4 text-[var(--d-text)]"
                : "rounded-xl border border-ash-200 bg-white p-4 shadow-sm"}
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <ShieldCheck className={diretta ? "h-5 w-5 text-[var(--d-orange)]" : "h-5 w-5 text-brand-orange"} />
                    <h2 className={diretta ? "text-base font-semibold" : "text-base font-bold text-ash-800"}>App da verificare</h2>
                    <span className={diretta ? "text-sm text-[var(--d-muted)]" : "text-sm text-ash-500"}>
                        confermati il giorno prima, il bot li sente un&apos;ora prima della call
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className={diretta ? "rounded-md bg-emerald-500/15 px-2 py-1 text-emerald-300" : "rounded-md bg-emerald-50 px-2 py-1 text-emerald-700"}>
                        {confermati} confermati col bot
                    </span>
                    <span className={diretta ? "rounded-md bg-red-500/20 px-2 py-1 text-red-300" : "rounded-md bg-red-50 px-2 py-1 text-red-700"}>
                        {daChiamare} da chiamare
                    </span>
                    <span className={diretta ? "rounded-md bg-white/5 px-2 py-1 text-[var(--d-muted)]" : "rounded-md bg-ash-50 px-2 py-1 text-ash-600"}>
                        {inAttesa} in attesa
                    </span>
                </div>
            </div>

            <ul className={diretta ? "mt-3 divide-y divide-[var(--d-line)]" : "mt-3 divide-y divide-ash-100"}>
                {rows.map(r => {
                    const c = chip(r)
                    const busy = busyId === r.id
                    return (
                        <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                            <div className={diretta ? "w-14 shrink-0 text-lg font-semibold tabular-nums" : "w-14 shrink-0 text-lg font-bold tabular-nums text-ash-800"}>
                                {ora(r.appointmentDate)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <Link
                                    href={`/conferme?lead=${r.id}`}
                                    className={diretta ? "block truncate font-medium hover:underline" : "block truncate font-semibold text-ash-800 hover:underline"}
                                >
                                    {r.name}
                                </Link>
                                <div className={diretta ? "flex flex-wrap items-center gap-x-3 text-xs text-[var(--d-muted)]" : "flex flex-wrap items-center gap-x-3 text-xs text-ash-500"}>
                                    {r.phone && (
                                        <a href={telHref(r.phone)} className="tabular-nums hover:underline">{toDialablePhone(r.phone)}</a>
                                    )}
                                    {r.salespersonName && <span>Venditore: {r.salespersonName}</span>}
                                    {r.motivo && <span className={diretta ? "text-red-300" : "text-red-600"}>{r.motivo}</span>}
                                </div>
                                {r.risposta && (
                                    <div className={diretta ? "mt-0.5 flex items-start gap-1 text-xs italic text-[var(--d-muted)]" : "mt-0.5 flex items-start gap-1 text-xs italic text-ash-600"}>
                                        <MessageCircleQuestion className="mt-0.5 h-3 w-3 shrink-0" />
                                        <span className="truncate">&ldquo;{r.risposta}&rdquo;</span>
                                    </div>
                                )}
                            </div>
                            <div className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${diretta ? `border-transparent ${c.diretta}` : c.classic}`}>
                                {r.stato === 'confermato' ? <CheckCircle2 className="h-3.5 w-3.5" />
                                    : r.stato === 'da_chiamare' ? <PhoneCall className="h-3.5 w-3.5" />
                                        : r.stato === 'sparito' ? <UserX className="h-3.5 w-3.5" />
                                            : <Clock className="h-3.5 w-3.5" />}
                                {c.label}
                            </div>
                            {AZIONABILE.has(r.stato) && (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => azione(r.id, segnaVerificaGestita)}
                                        className={diretta
                                            ? "rounded-lg border-2 border-[var(--d-line)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--d-surface-2)] disabled:opacity-60"
                                            : "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"}
                                    >
                                        Confermato a voce
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => {
                                            if (window.confirm(`Segnare ${r.name} come SPARITO e avvisare il venditore?`)) azione(r.id, segnaVerificaSparito)
                                        }}
                                        className={diretta
                                            ? "rounded-lg border-2 border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                                            : "rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"}
                                    >
                                        Sparito
                                    </button>
                                </div>
                            )}
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
