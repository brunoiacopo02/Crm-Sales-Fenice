"use client"

// Consigli in chiamata, lato admin (PO 26/10/2026). Un tasto in basso a destra
// su ogni pagina apre la chat: si sceglie la persona (GDO o Conferme), si
// scrive e si invia; sopra ci sono i consigli di oggi a quella persona con
// l'ora di lettura. Le frasi pronte le crea e le modifica l'admin (partono
// vuote): un clic le mette nella casella, da ritoccare prima di inviare.

import { useCallback, useEffect, useRef, useState } from "react"
import { Lightbulb, Pencil, Plus, Send, X } from "lucide-react"
import {
    getConsigliInviati, getDestinatariConsigli, getFrasiPronte, inviaConsiglio, salvaFrasiPronte,
    type Consiglio, type Destinatario,
} from "@/app/actions/consigliActions"
import { onBusEvent } from "@/lib/realtimeBus"
import { oraBreve } from "@/lib/diretta/home"

const CAMPO = "w-full rounded-lg border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[14px] text-[#F2F2F2] placeholder:text-[#8C8C8C] [color-scheme:dark] focus:border-[#FF9330] focus:outline-none"

export function ConsigliAdmin() {
    const [aperto, setAperto] = useState(false)
    const [persone, setPersone] = useState<Destinatario[]>([])
    const [scelto, setScelto] = useState("")
    const [inviati, setInviati] = useState<Consiglio[]>([])
    const [testo, setTesto] = useState("")
    const [frasi, setFrasi] = useState<string[]>([])
    const [modificaFrasi, setModificaFrasi] = useState(false)
    const [nuovaFrase, setNuovaFrase] = useState("")
    const [invio, setInvio] = useState(false)
    const [errore, setErrore] = useState("")
    const fondo = useRef<HTMLDivElement>(null)
    const casella = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        if (!aperto) return
        let vivo = true
        Promise.all([getDestinatariConsigli(), getFrasiPronte()])
            .then(([p, f]) => { if (vivo) { setPersone(p); setFrasi(f) } })
            .catch(() => { if (vivo) setErrore("Non riesco a leggere l'elenco, riprova.") })
        return () => { vivo = false }
    }, [aperto])

    const caricaInviati = useCallback(() => {
        if (!scelto) return
        getConsigliInviati(scelto).then(setInviati).catch(() => { /* resta l'ultimo elenco */ })
    }, [scelto])

    useEffect(() => {
        if (!aperto || !scelto) return
        const id = setTimeout(caricaInviati, 0)
        const off = onBusEvent("callTips", caricaInviati)
        return () => { clearTimeout(id); off() }
    }, [aperto, scelto, caricaInviati])

    useEffect(() => {
        fondo.current?.scrollIntoView({ block: "end" })
    }, [inviati])

    const invia = async () => {
        if (!scelto || !testo.trim() || invio) return
        setInvio(true)
        setErrore("")
        try {
            const r = await inviaConsiglio(scelto, testo)
            if (r.ok) {
                setTesto("")
                caricaInviati()
            } else {
                setErrore(r.error)
            }
        } catch {
            setErrore("Invio non riuscito, riprova.")
        } finally {
            setInvio(false)
            casella.current?.focus()
        }
    }

    const salvaFrasi = async (nuove: string[]) => {
        const r = await salvaFrasiPronte(nuove).catch(() => null)
        if (r?.ok) setFrasi(r.frasi)
        else setErrore("Frasi non salvate, riprova.")
    }

    const persona = persone.find(p => p.id === scelto)

    if (!aperto) {
        return (
            <button
                type="button"
                onClick={() => setAperto(true)}
                className="fixed bottom-4 right-4 z-[85] flex h-11 items-center gap-2 rounded-xl border-2 border-[#3D3D3D] bg-[#262626] px-4 text-[14px] font-semibold text-[#F2F2F2] shadow-[0_8px_24px_rgba(0,0,0,0.3)] transition-colors hover:border-[#FF9330]"
                style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}
            >
                <Lightbulb className="h-4 w-4 text-[#FF9330]" strokeWidth={2} aria-hidden="true" />
                Consigli
            </button>
        )
    }

    return (
        <section
            aria-label="Consigli in chiamata"
            className="fixed bottom-4 right-4 z-[85] flex max-h-[min(40rem,calc(100vh-6rem))] w-[min(26rem,calc(100vw-2rem))] flex-col rounded-2xl border-2 border-[#3D3D3D] bg-[#262626] text-[#F2F2F2] shadow-[0_12px_32px_rgba(0,0,0,0.4)]"
            style={{ fontFamily: "var(--font-poppins), system-ui, sans-serif" }}
        >
            <div className="flex items-center justify-between gap-2 border-b-2 border-[#2E2E2E] px-4 py-3">
                <div className="flex items-center gap-2 text-[15px] font-semibold">
                    <Lightbulb className="h-4 w-4 text-[#FF9330]" strokeWidth={2} aria-hidden="true" />
                    Consigli in chiamata
                </div>
                <button type="button" onClick={() => setAperto(false)} aria-label="Chiudi" className="rounded-lg p-1 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]">
                    <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
            </div>

            <div className="px-4 pt-3">
                <label htmlFor="consigli-persona" className="text-[13px] text-[#BFBFBF]">A chi</label>
                <select
                    id="consigli-persona"
                    value={scelto}
                    onChange={e => { setScelto(e.target.value); setInviati([]); setErrore("") }}
                    className={`${CAMPO} mt-1 h-10`}
                >
                    <option value="">Scegli la persona</option>
                    {(["GDO", "CONFERME"] as const).map(ruolo => {
                        const gruppo = persone.filter(p => p.ruolo === ruolo)
                        return gruppo.length === 0 ? null : (
                            <optgroup key={ruolo} label={ruolo === "GDO" ? "GDO" : "Conferme"}>
                                {gruppo.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                            </optgroup>
                        )
                    })}
                </select>
            </div>

            <div className="min-h-[6rem] flex-1 overflow-y-auto px-4 py-3">
                {!scelto ? (
                    <div className="text-[13px] text-[#A6A6A6]">Scegli a chi scrivere. Vede il consiglio subito, in un riquadro che non gli blocca lo schermo.</div>
                ) : inviati.length === 0 ? (
                    <div className="text-[13px] text-[#A6A6A6]">Oggi non hai ancora scritto a {persona?.nome ?? "questa persona"}.</div>
                ) : (
                    <ol className="flex flex-col gap-2">
                        {inviati.map(c => (
                            <li key={c.id} className="ml-6 rounded-xl bg-[#2E2E2E] px-3 py-2">
                                <div className="whitespace-pre-line text-[14px] leading-snug">{c.message}</div>
                                <div className="mt-1 text-[12px] tabular-nums text-[#A6A6A6]">
                                    {oraBreve(new Date(c.createdAt))}
                                    {c.readAt
                                        ? <span className="text-[#FF9330]">, letto alle {oraBreve(new Date(c.readAt))}</span>
                                        : ", non ancora letto"}
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
                <div ref={fondo} />
            </div>

            <div className="border-t-2 border-[#2E2E2E] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] text-[#BFBFBF]">Frasi pronte</div>
                    <button
                        type="button"
                        onClick={() => setModificaFrasi(v => !v)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]"
                    >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                        {modificaFrasi ? "Fatto" : "Modifica"}
                    </button>
                </div>
                {modificaFrasi ? (
                    <div className="mt-2 flex flex-col gap-1.5">
                        {frasi.map((f, i) => (
                            <div key={`${i}-${f}`} className="flex items-start gap-2 rounded-lg bg-[#2E2E2E] px-2.5 py-1.5 text-[13px]">
                                <div className="min-w-0 flex-1">{f}</div>
                                <button
                                    type="button"
                                    onClick={() => salvaFrasi(frasi.filter((_, j) => j !== i))}
                                    aria-label={`Togli la frase ${f}`}
                                    className="shrink-0 rounded p-0.5 text-[#BFBFBF] hover:text-[#F2F2F2]"
                                >
                                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                                </button>
                            </div>
                        ))}
                        <div className="flex gap-2">
                            <input
                                value={nuovaFrase}
                                onChange={e => setNuovaFrase(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter" && nuovaFrase.trim()) { e.preventDefault(); salvaFrasi([...frasi, nuovaFrase]); setNuovaFrase("") }
                                }}
                                maxLength={200}
                                placeholder="Nuova frase pronta"
                                className={`${CAMPO} h-9`}
                            />
                            <button
                                type="button"
                                disabled={!nuovaFrase.trim()}
                                onClick={() => { salvaFrasi([...frasi, nuovaFrase]); setNuovaFrase("") }}
                                aria-label="Aggiungi la frase"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#3D3D3D] text-[#F2F2F2] disabled:opacity-40"
                            >
                                <Plus className="h-4 w-4" strokeWidth={2} />
                            </button>
                        </div>
                    </div>
                ) : frasi.length === 0 ? (
                    <div className="mt-1 text-[12px] text-[#A6A6A6]">Nessuna frase pronta. Con Modifica te le crei.</div>
                ) : (
                    <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                        {frasi.map((f, i) => (
                            <button
                                key={`${i}-${f}`}
                                type="button"
                                onClick={() => { setTesto(f); casella.current?.focus() }}
                                className="max-w-full truncate rounded-lg bg-[#2E2E2E] px-2.5 py-1 text-left text-[12px] transition-colors hover:bg-[#3D3D3D]"
                                title={f}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                )}

                <div className="mt-3 flex items-end gap-2">
                    <textarea
                        ref={casella}
                        value={testo}
                        onChange={e => setTesto(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); invia() } }}
                        rows={2}
                        maxLength={500}
                        disabled={!scelto}
                        placeholder={scelto ? "Scrivi il consiglio, Invio per mandarlo" : "Prima scegli la persona"}
                        className={`${CAMPO} resize-none py-2 disabled:opacity-50`}
                    />
                    <button
                        type="button"
                        onClick={invia}
                        disabled={!scelto || !testo.trim() || invio}
                        aria-label="Invia il consiglio"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FF9330] text-[#171717] transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                        <Send className="h-4 w-4" strokeWidth={2} />
                    </button>
                </div>
                {errore && <div role="alert" className="mt-2 text-[13px] font-medium text-[#FF9330]">{errore}</div>}
            </div>
        </section>
    )
}
