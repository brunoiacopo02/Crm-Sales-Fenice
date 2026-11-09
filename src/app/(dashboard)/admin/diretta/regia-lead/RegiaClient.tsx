"use client"

// Regia dei lead, parte interattiva: panoramica per GDO, elenco dei lead della
// riga scelta con i filtri, operazioni con anteprima e conferma nella pagina
// (niente confirm() del browser), interruttori del GDO, lead singolo e storico
// con "Annulla". Tutte le scritture passano da regiaLeadActions (solo ADMIN).

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
    anteprimaInterruttoriGdo, anteprimaLead, anteprimaMassa, annullaOperazioneRegia, confermaInterruttoriGdo, confermaLead,
    confermaMassa, leggiLeadRegia, type InputMassa, type InputSingolo,
} from "@/app/actions/regiaLeadActions"
import { searchLeads, type SearchResult } from "@/app/actions/searchActions"
import type {
    AnteprimaInterruttori, AnteprimaSingolo, ElencoRegia, EsitoMassa, OperazioneStorico, PanoramicaRegia, PersonaRegia,
    PianoMassa, RigaPanoramica, TipoMassa,
} from "@/lib/diretta/regiaDb"
import type { FiltriLead } from "@/lib/diretta/regia"
import { dataOraBreveRoma, numeroIt, oraRoma } from "@/lib/diretta/formato"
import { toRomeDateStr } from "@/lib/dateUtils"
import { Sezione, Vuoto, bottone } from "@/components/diretta/admin/ui"

/** Come MASSIMO_AL_BOT di regia.ts (qui senza importare le regole lato server). */
const MASSIMO_AL_BOT = 60

const TH = "whitespace-nowrap px-2 pb-2 text-right text-[12.5px] font-normal text-[#BFBFBF] first:pl-0 first:text-left"
const TD = "whitespace-nowrap border-t-2 border-[#2E2E2E] px-2 py-2 text-right align-top first:pl-0 first:text-left"
const CAMPO = "h-10 w-full rounded-[8px] border-2 border-[#3D3D3D] bg-[#1F1F1F] px-3 text-[14px] text-[#F2F2F2] focus:border-[#BFBFBF] focus:outline-none"

const n = (v: number) => numeroIt(v)
const nomeRiga = (r: RigaPanoramica) =>
    r.tipo === "nessuno" ? "Senza assegnatario" : r.tipo === "bot" ? `Bot ${r.persona?.codice ?? ""}`.trim() : `${r.persona?.nome} (${r.persona?.codice})`

function Avviso({ tipo, children }: { tipo: "ok" | "errore" | "info"; children: ReactNode }) {
    const c = tipo === "ok" ? "bg-[#16352A] text-[#9BE3BF]" : tipo === "errore" ? "bg-[#3D1A16] text-[#FFB4A8]" : "bg-[#2E2E2E] text-[#F2F2F2]"
    return <div role={tipo === "errore" ? "alert" : "status"} className={`rounded-[10px] px-4 py-3 text-[14px] leading-snug ${c}`}>{children}</div>
}

function Etichetta({ children, sotto }: { children: ReactNode; sotto?: ReactNode }) {
    return (
        <div className="mb-1.5">
            <div className="text-[13px] font-semibold text-[#F2F2F2]">{children}</div>
            {sotto && <div className="text-[12.5px] text-[#BFBFBF]">{sotto}</div>}
        </div>
    )
}

// ── Pagina ───────────────────────────────────────────────────────────────

export function RegiaClient({ panoramica, storico, persone }: { panoramica: PanoramicaRegia; storico: OperazioneStorico[]; persone: PersonaRegia[] }) {
    const [sorgente, setSorgente] = useState<string | null>(null)
    const riga = panoramica.righe.find(r => r.chiave === sorgente) ?? null

    return (
        <div className="mt-4 flex flex-col gap-4">
            <TabellaPanoramica panoramica={panoramica} scelta={sorgente} onScegli={(k) => setSorgente(k === sorgente ? null : k)} />
            {riga && <PannelloSorgente key={riga.chiave} riga={riga} panoramica={panoramica} persone={persone} />}
            <div className="grid items-start gap-4 lg:grid-cols-2">
                <LeadSingolo />
                <Storico storico={storico} />
            </div>
        </div>
    )
}

// ── Panoramica ───────────────────────────────────────────────────────────

function Stato({ r }: { r: RigaPanoramica }) {
    const p = r.persona
    if (!p) return <div className="text-[12.5px] text-[#BFBFBF]">—</div>
    if (r.tipo === "bot") return <div className="text-[12.5px] text-[#BFBFBF]">{p.isActive ? "attivo" : "spento"}</div>
    const chip = (on: boolean, testo: string) => (
        <div className={`rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold ${on ? "bg-[#16352A] text-[#5CC792]" : "bg-[#2E2E2E] text-[#8C8C8C] line-through"}`}>{testo}</div>
    )
    return (
        <div className="flex flex-wrap justify-end gap-1">
            {chip(p.isActive, "attivo")}
            {chip(p.acAutoIntake, "freschi")}
            {chip(p.botReturnIntake, "ridati")}
            <div className="rounded-[6px] bg-[#2E2E2E] px-1.5 py-0.5 text-[12px] text-[#F2F2F2]" title="Tetto freschi al giorno">tetto {p.dailyFreshCap ?? "—"}</div>
        </div>
    )
}

function TabellaPanoramica({ panoramica, scelta, onScegli }: { panoramica: PanoramicaRegia; scelta: string | null; onScegli: (k: string) => void }) {
    const tot = panoramica.righe.reduce((s, r) => s + r.aperti, 0)
    const intest = ["Chi", "Stato", "Aperti", "1ª chiamata", "visibili", "in scorta", "Tent. 1", "Tent. 2+", "Richiami oggi", "scaduti", "Chiamate oggi", "lead chiamati", "fissati oggi", "BF aperti", "BF mai chiamati", "Ultima chiamata"]
    return (
        <Sezione titolo="Panoramica per GDO">
            <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full text-[14px] tabular-nums" style={{ minWidth: 1180 }}>
                    <thead><tr>{intest.map(h => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                    <tbody>
                        {panoramica.righe.map(r => (
                            <tr key={r.chiave} className={r.chiave === scelta ? "bg-[#33261A]" : ""}>
                                <td className={TD}>
                                    <button type="button" onClick={() => onScegli(r.chiave)} aria-pressed={r.chiave === scelta}
                                        className="rounded-[6px] px-1 text-left font-semibold text-[#FF9330] underline-offset-2 hover:underline">
                                        {nomeRiga(r)}
                                    </button>
                                </td>
                                <td className={TD}><Stato r={r} /></td>
                                <td className={`${TD} font-semibold`}>{n(r.aperti)}</td>
                                <td className={TD}>{n(r.prime)}</td>
                                <td className={TD}>{n(r.primeVisibili)}</td>
                                <td className={TD}>{n(r.primeScorta)}</td>
                                <td className={TD}>{n(r.t1)}</td>
                                <td className={TD}>{n(r.t2)}</td>
                                <td className={TD}>{n(r.richiamiOggi)}</td>
                                <td className={`${TD} ${r.richiamiScaduti > 0 ? "text-[#FF9330]" : ""}`}>{n(r.richiamiScaduti)}</td>
                                <td className={TD}>{r.tipo === "gdo" ? n(r.chiamateOggi) : "—"}</td>
                                <td className={TD}>{r.tipo === "gdo" ? n(r.chiamatiOggi) : "—"}</td>
                                <td className={TD}>{r.tipo === "gdo" ? n(r.fissatiOggi) : "—"}</td>
                                <td className={TD}>{n(r.bfAperti)}</td>
                                <td className={`${TD} ${r.bfMaiChiamati > 0 ? "text-[#FF9330]" : ""}`}>{n(r.bfMaiChiamati)}</td>
                                <td className={TD}>{r.ultimaChiamata ? quando(r.ultimaChiamata) : "—"}</td>
                            </tr>
                        ))}
                        <tr>
                            <td className={`${TD} font-semibold`}>Totale</td>
                            <td className={TD} />
                            <td className={`${TD} font-semibold`}>{n(tot)}</td>
                            <td className={TD} colSpan={13} />
                        </tr>
                    </tbody>
                </table>
            </div>
            <div className="mt-3 text-[12.5px] leading-snug text-[#BFBFBF]">
                Aperti = nuovi e in lavorazione (né appuntamento né chiusi). 1ª chiamata = mai chiamati senza richiamo; &quot;in scorta&quot; sono nascosti al GDO finché la scorta non li sblocca (i Black Friday non lo sono mai). Chiamate, chiamati e fissati sono di oggi dalle chiamate registrate nel CRM. Senza assegnatario esclude i lead tolti per decisione (lancio archiviato, tolti al bot).
            </div>
        </Sezione>
    )
}

function quando(iso: string): string {
    const d = new Date(iso)
    return toRomeDateStr(d) === toRomeDateStr(new Date()) ? oraRoma(d) : dataOraBreveRoma(d)
}

// ── Lead di una sorgente + operazioni ────────────────────────────────────

const FILTRI_VUOTI: FiltriLead = { funnel: null, tentativi: "tutti", bf: "tutti", provenienza: "tutti", richiamo: "tutti", etaMin: null, etaMax: null }

function PannelloSorgente({ riga, panoramica, persone }: { riga: RigaPanoramica; panoramica: PanoramicaRegia; persone: PersonaRegia[] }) {
    const router = useRouter()
    const [filtri, setFiltri] = useState<FiltriLead>(FILTRI_VUOTI)
    const [elenco, setElenco] = useState<ElencoRegia | null>(null)
    const [errore, setErrore] = useState<string | null>(null)
    const [carico, avviaCarico] = useTransition()
    const [scelti, setScelti] = useState<Set<string>>(new Set())
    const [giro, setGiro] = useState(0)

    useEffect(() => {
        let vivo = true
        avviaCarico(async () => {
            const r = await leggiLeadRegia(riga.chiave, filtri)
            if (!vivo) return
            if (r.ok) { setElenco(r.dati); setErrore(null) } else setErrore(r.errore)
            setScelti(new Set())
        })
        return () => { vivo = false }
    }, [riga.chiave, filtri, giro])

    const ricarica = () => { setGiro(g => g + 1); router.refresh() }
    const setF = <K extends keyof FiltriLead>(k: K, v: FiltriLead[K]) => setFiltri(f => ({ ...f, [k]: v }))
    const spostabili = elenco?.righe.filter(r => !r.bloccato) ?? []
    const tuttiScelti = spostabili.length > 0 && spostabili.every(r => scelti.has(r.id))

    return (
        <Sezione titolo={`Lead aperti di ${nomeRiga(riga)}`}>
            {riga.tipo === "gdo" && riga.persona && <Interruttori persona={riga.persona} onFatto={ricarica} />}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                    <Etichetta>Funnel</Etichetta>
                    <select className={CAMPO} value={filtri.funnel ?? ""} onChange={e => setF("funnel", e.target.value || null)}>
                        <option value="">Tutti</option>
                        {panoramica.funnel.map(f => <option key={f.funnel} value={f.funnel}>{f.funnel}</option>)}
                    </select>
                </div>
                <div>
                    <Etichetta>Tentativi</Etichetta>
                    <select className={CAMPO} value={filtri.tentativi} onChange={e => setF("tentativi", e.target.value as FiltriLead["tentativi"])}>
                        <option value="tutti">Tutti</option><option value="0">Mai chiamati</option><option value="1">1</option><option value="2+">2 o più</option>
                    </select>
                </div>
                <div>
                    <Etichetta>Black Friday</Etichetta>
                    <select className={CAMPO} value={filtri.bf} onChange={e => setF("bf", e.target.value as FiltriLead["bf"])}>
                        <option value="tutti">Tutti</option><option value="si">Solo BF</option><option value="no">Senza BF</option>
                    </select>
                </div>
                <div>
                    <Etichetta>Provenienza</Etichetta>
                    <select className={CAMPO} value={filtri.provenienza} onChange={e => setF("provenienza", e.target.value as FiltriLead["provenienza"])}>
                        <option value="tutti">Tutti</option><option value="ridati">Ridati dal bot</option><option value="vergini">Vergini</option><option value="altri">Né ridati né vergini</option>
                    </select>
                </div>
                <div>
                    <Etichetta>Richiamo</Etichetta>
                    <select className={CAMPO} value={filtri.richiamo} onChange={e => setF("richiamo", e.target.value as FiltriLead["richiamo"])}>
                        <option value="tutti">Tutti</option><option value="con">Con richiamo</option><option value="senza">Senza richiamo</option><option value="scaduti">Richiamo scaduto</option>
                    </select>
                </div>
                <div>
                    <Etichetta>Entrati da almeno (giorni)</Etichetta>
                    <input className={CAMPO} inputMode="numeric" value={filtri.etaMin ?? ""} onChange={e => setF("etaMin", e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                </div>
                <div>
                    <Etichetta>Entrati da al massimo (giorni)</Etichetta>
                    <input className={CAMPO} inputMode="numeric" value={filtri.etaMax ?? ""} onChange={e => setF("etaMax", e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                </div>
                <div className="flex items-end">
                    <button type="button" className={bottone("testo")} onClick={() => setFiltri(FILTRI_VUOTI)}>Togli i filtri</button>
                </div>
            </div>

            <div className="mt-4" aria-live="polite">
                {errore && <Avviso tipo="errore">{errore}</Avviso>}
                {carico && !elenco && <Vuoto>Caricamento…</Vuoto>}
                {elenco && (
                    <>
                        <div className="mb-2 flex flex-wrap items-center gap-3 text-[14px]">
                            <div><span className="font-semibold">{n(elenco.totale)}</span> lead con questi filtri{elenco.totale > elenco.limite ? `, qui i ${elenco.limite} più recenti` : ""}{carico ? " · aggiorno…" : ""}</div>
                            <div className="text-[#BFBFBF]">{n(scelti.size)} scelti a mano</div>
                        </div>
                        <ElencoLead elenco={elenco} scelti={scelti} tuttiScelti={tuttiScelti}
                            onScegli={(id) => setScelti(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x })}
                            onTutti={() => setScelti(tuttiScelti ? new Set() : new Set(spostabili.map(r => r.id)))}
                            mostraCima={riga.tipo === "gdo"} sorgente={riga.chiave} onFatto={ricarica} />
                    </>
                )}
            </div>

            <OperazioneMassa riga={riga} persone={persone} filtri={filtri} scelti={[...scelti]} totale={elenco?.totale ?? 0} onFatto={ricarica} />
        </Sezione>
    )
}

function ElencoLead({ elenco, scelti, tuttiScelti, onScegli, onTutti, mostraCima, sorgente, onFatto }: {
    elenco: ElencoRegia; scelti: Set<string>; tuttiScelti: boolean; onScegli: (id: string) => void; onTutti: () => void
    mostraCima: boolean; sorgente: string; onFatto: () => void
}) {
    const [azione, setAzione] = useState<{ tipo: "scarta" | "doppione" | "cima"; id: string; nome: string } | null>(null)
    if (elenco.righe.length === 0) return <Vuoto>Nessun lead aperto con questi filtri.</Vuoto>
    return (
        <>
            <div className="-mx-1 max-h-[28rem] overflow-auto px-1">
                <table className="w-full text-[13.5px] tabular-nums" style={{ minWidth: 920 }}>
                    <thead className="sticky top-0 bg-[#262626]">
                        <tr>
                            <th scope="col" className={TH}>
                                <input type="checkbox" aria-label="Scegli tutti quelli spostabili" checked={tuttiScelti} onChange={onTutti} className="h-4 w-4 accent-[#FF9330]" />
                            </th>
                            {["Lead", "Funnel", "Tent.", "Richiamo", "Entrato", "Ultima chiamata", "Note", "Azioni"].map(h => <th key={h} scope="col" className={`${TH} !text-left`}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {elenco.righe.map(r => (
                            <tr key={r.id}>
                                <td className={TD}>
                                    <input type="checkbox" aria-label={`Scegli ${r.nome}`} disabled={!!r.bloccato} checked={scelti.has(r.id)} onChange={() => onScegli(r.id)} className="h-4 w-4 accent-[#FF9330] disabled:opacity-30" />
                                </td>
                                <td className={`${TD} !text-left`}>
                                    <div className="max-w-[14rem] truncate font-medium">{r.nome}</div>
                                    <div className="text-[12px] text-[#BFBFBF]">{r.telefono}</div>
                                </td>
                                <td className={`${TD} !text-left`}><div className="max-w-[10rem] truncate">{r.funnel ?? "—"}</div></td>
                                <td className={`${TD} !text-left`}>{r.tentativi}</td>
                                <td className={`${TD} !text-left`}>{r.richiamo ? dataOraBreveRoma(new Date(r.richiamo)) : "—"}</td>
                                <td className={`${TD} !text-left`}>{dataOraBreveRoma(new Date(r.entrato))}</td>
                                <td className={`${TD} !text-left`}>{r.ultimaChiamata ? dataOraBreveRoma(new Date(r.ultimaChiamata)) : "—"}</td>
                                <td className={`${TD} !text-left`}>
                                    <div className="flex flex-wrap gap-1 text-[12px]">
                                        {r.bf && <div className="rounded-[6px] bg-[#3D2611] px-1.5 py-0.5 font-semibold text-[#FF9330]">BF</div>}
                                        {r.vergine && <div className="rounded-[6px] bg-[#16352A] px-1.5 py-0.5 text-[#5CC792]">vergine</div>}
                                        {r.ridato && <div className="rounded-[6px] bg-[#2E2E2E] px-1.5 py-0.5">ridato</div>}
                                        {r.scorta === "scorta" && <div className="rounded-[6px] bg-[#2E2E2E] px-1.5 py-0.5">in scorta</div>}
                                        {r.bloccato && <div className="rounded-[6px] bg-[#3D1A16] px-1.5 py-0.5 text-[#FFB4A8]">{r.bloccato}</div>}
                                    </div>
                                </td>
                                <td className={`${TD} !text-left`}>
                                    <div className="flex gap-1">
                                        {mostraCima && r.tentativi === 0 && !r.richiamo && (
                                            <button type="button" className={bottone("testo", "piccola")} onClick={() => setAzione({ tipo: "cima", id: r.id, nome: r.nome })}>In cima</button>
                                        )}
                                        <button type="button" className={bottone("testo", "piccola")} onClick={() => setAzione({ tipo: "scarta", id: r.id, nome: r.nome })}>Scarta</button>
                                        <button type="button" className={bottone("testo", "piccola")} onClick={() => setAzione({ tipo: "doppione", id: r.id, nome: r.nome })}>Doppione</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {azione && (
                <div className="mt-3">
                    {azione.tipo === "cima"
                        ? <CimaSingolo sorgente={sorgente} id={azione.id} nome={azione.nome} onChiudi={() => setAzione(null)} onFatto={onFatto} />
                        : <AzioneSingolo tipo={azione.tipo} leadId={azione.id} nome={azione.nome} onChiudi={() => setAzione(null)} onFatto={onFatto} />}
                </div>
            )}
        </>
    )
}

function CimaSingolo({ sorgente, id, nome, onChiudi, onFatto }: { sorgente: string; id: string; nome: string; onChiudi: () => void; onFatto: () => void }) {
    const input: InputMassa = { tipo: "cima", sorgente, ids: [id] }
    return <FlussoMassa titolo={`Metti in cima "${nome}"`} input={input} onChiudi={onChiudi} onFatto={onFatto} autoAnteprima />
}

// ── Operazione di massa ──────────────────────────────────────────────────

const ETICHETTE_TIPO: Record<TipoMassa, string> = {
    sposta: "Sposta a GDO", al_bot: "Dai al bot", accantona: "Accantona", cima: "Metti in cima",
}

function OperazioneMassa({ riga, persone, filtri, scelti, totale, onFatto }: {
    riga: RigaPanoramica; persone: PersonaRegia[]; filtri: FiltriLead; scelti: string[]; totale: number; onFatto: () => void
}) {
    const tipi: TipoMassa[] = riga.tipo === "gdo" ? ["sposta", "al_bot", "accantona", "cima"]
        : riga.tipo === "bot" ? ["sposta", "accantona"] : ["sposta", "al_bot"]
    const [tipo, setTipo] = useState<TipoMassa>("sposta")
    const [modo, setModo] = useState<"mano" | "filtri">("filtri")
    const [quanti, setQuanti] = useState("")
    const [dest, setDest] = useState<Set<string>>(new Set())
    const [posizione, setPosizione] = useState<"cima" | "scorta">("cima")
    const [motivo, setMotivo] = useState("")
    const [ancheGia, setAncheGia] = useState(false)
    const [input, setInput] = useState<InputMassa | null>(null)

    useEffect(() => { if (scelti.length > 0) setModo("mano") }, [scelti.length])
    const gdoAttivi = useMemo(() => persone.filter(p => !p.isBot && p.isActive && p.id !== riga.chiave), [persone, riga.chiave])

    const prepara = () => {
        setInput({
            tipo, sorgente: riga.chiave,
            ids: modo === "mano" ? scelti : null,
            filtri: modo === "filtri" ? filtri : null,
            quanti: modo === "filtri" ? Math.floor(Number(quanti) || 0) : null,
            destinatari: [...dest], posizione, motivo, ancheGiaContattati: ancheGia,
        })
    }

    return (
        <div className="mt-6 rounded-[12px] border-2 border-[#3D3D3D] p-4">
            <h3 className="text-[15px] font-semibold">Operazione su questi lead</h3>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tipo di operazione">
                {tipi.map(t => (
                    <button key={t} type="button" onClick={() => { setTipo(t); setInput(null) }} className={bottone(t === tipo ? "scelto" : "linea", "piccola")} aria-pressed={t === tipo}>
                        {riga.tipo === "bot" && t === "sposta" ? "Togli dal bot e dai a GDO" : ETICHETTE_TIPO[t]}
                    </button>
                ))}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                    <Etichetta>Quali lead</Etichetta>
                    <div className="flex flex-col gap-2 text-[14px]">
                        <label className="flex items-center gap-2">
                            <input type="radio" name="modo" checked={modo === "mano"} onChange={() => setModo("mano")} className="accent-[#FF9330]" />
                            I {n(scelti.length)} scelti a mano nell&apos;elenco
                        </label>
                        <label className="flex flex-wrap items-center gap-2">
                            <input type="radio" name="modo" checked={modo === "filtri"} onChange={() => setModo("filtri")} className="accent-[#FF9330]" />
                            I primi
                            <input className="h-9 w-20 rounded-[8px] border-2 border-[#3D3D3D] bg-[#1F1F1F] px-2 text-[14px]" inputMode="numeric" value={quanti}
                                onChange={e => { setQuanti(e.target.value.replace(/\D/g, "")); setModo("filtri") }} aria-label="Quanti lead" />
                            con i filtri sopra (su {n(totale)}, dal più recente)
                        </label>
                        {tipo === "al_bot" && <div className="text-[12.5px] text-[#BFBFBF]">Al bot al massimo {MASSIMO_AL_BOT} per volta: il bot li riceve a 30 al minuto.</div>}
                    </div>
                </div>

                {tipo === "sposta" && (
                    <div>
                        <Etichetta sotto="Ripartiti a turno fra quelli scelti.">A chi</Etichetta>
                        <div className="flex flex-wrap gap-2">
                            {gdoAttivi.map(p => (
                                <label key={p.id} className={`flex cursor-pointer items-center gap-1.5 rounded-[8px] border-2 px-2.5 py-1.5 text-[13.5px] ${dest.has(p.id) ? "border-[#FF9330]" : "border-[#3D3D3D]"}`}>
                                    <input type="checkbox" className="accent-[#FF9330]" checked={dest.has(p.id)}
                                        onChange={() => setDest(s => { const x = new Set(s); if (x.has(p.id)) x.delete(p.id); else x.add(p.id); return x })} />
                                    {p.nome} ({p.codice}){!p.acAutoIntake && !p.botReturnIntake ? " · intake spento" : ""}
                                </label>
                            ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-4 text-[14px]">
                            <label className="flex items-center gap-2"><input type="radio" name="pos" checked={posizione === "cima"} onChange={() => setPosizione("cima")} className="accent-[#FF9330]" />In cima (visibili subito)</label>
                            <label className="flex items-center gap-2"><input type="radio" name="pos" checked={posizione === "scorta"} onChange={() => setPosizione("scorta")} className="accent-[#FF9330]" />In scorta</label>
                        </div>
                    </div>
                )}
                {tipo === "accantona" && (
                    <div>
                        <Etichetta sotto="Finiscono senza assegnatario nel pool &quot;Lead accantonati&quot; di Importa lead.">Motivo</Etichetta>
                        <input className={CAMPO} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="es. ridati dal bot da più di 8 giorni" />
                    </div>
                )}
                {tipo === "al_bot" && (
                    <div className="text-[14px]">
                        <label className="flex items-start gap-2">
                            <input type="checkbox" className="mt-1 accent-[#FF9330]" checked={ancheGia} onChange={() => setAncheGia(v => !v)} />
                            <div>Includi anche chi il bot ha già contattato<div className="text-[12.5px] text-[#BFBFBF]">Di solito no: è una seconda apertura WhatsApp alla stessa persona e abbassa la qualità del numero.</div></div>
                        </label>
                    </div>
                )}
                {tipo === "cima" && <div className="text-[13.5px] text-[#BFBFBF]">Solo i mai chiamati senza richiamo: escono dalla scorta e vanno in cima alla prima chiamata.</div>}
            </div>

            <div className="mt-4">
                <button type="button" className={bottone("primario")} onClick={prepara}>Vedi l&apos;anteprima</button>
            </div>
            {input && (
                <div className="mt-4">
                    <FlussoMassa key={JSON.stringify(input)} titolo={ETICHETTE_TIPO[input.tipo]} input={input} onChiudi={() => setInput(null)} onFatto={() => { setInput(null); onFatto() }} autoAnteprima />
                </div>
            )}
        </div>
    )
}

/** Anteprima e conferma di un'operazione di massa, poi l'esito. */
function FlussoMassa({ titolo, input, onChiudi, onFatto, autoAnteprima }: { titolo: string; input: InputMassa; onChiudi: () => void; onFatto: () => void; autoAnteprima?: boolean }) {
    const [piano, setPiano] = useState<PianoMassa | null>(null)
    const [esito, setEsito] = useState<EsitoMassa | null>(null)
    const [errore, setErrore] = useState<string | null>(null)
    const [inCorso, avvia] = useTransition()

    useEffect(() => {
        if (!autoAnteprima) return
        avvia(async () => {
            const r = await anteprimaMassa(input)
            if (r.ok) setPiano(r.dati); else setErrore(r.errore)
        })
    }, [input, autoAnteprima])

    const conferma = () => {
        if (!piano) return
        avvia(async () => {
            const r = await confermaMassa(input, piano.inclusi)
            if (r.ok) { setEsito(r.dati); onFatto() } else setErrore(r.errore)
        })
    }

    return (
        <div className="rounded-[12px] bg-[#1F1F1F] p-4" aria-live="polite">
            <div className="flex items-start justify-between gap-3">
                <h4 className="text-[15px] font-semibold">Anteprima: {titolo}</h4>
                <button type="button" className={bottone("testo", "piccola")} onClick={onChiudi}>Chiudi</button>
            </div>
            {errore && <div className="mt-3"><Avviso tipo="errore">{errore}</Avviso></div>}
            {inCorso && !piano && <div className="mt-3"><Vuoto>Calcolo l&apos;anteprima…</Vuoto></div>}
            {esito && (
                <div className="mt-3">
                    <Avviso tipo="ok">
                        Fatto: {n(esito.fatti)} lead.{esito.saltati.length > 0 ? ` Saltati ${n(esito.saltati.length)} (cambiati nel frattempo).` : ""}
                        {esito.push && <> Bot: {n(esito.push.inviati)} inviati ({Object.entries(esito.push.esiti).map(([k, v]) => `${k} ${v}`).join(", ")}){esito.push.restanti > 0 ? `, ${esito.push.restanti} da ripassare` : ""}.</>}
                        {" "}Si può annullare dallo storico.
                    </Avviso>
                </div>
            )}
            {piano && !esito && (
                <div className="mt-3 flex flex-col gap-3 text-[14px]">
                    <div>
                        Da <span className="font-semibold">{piano.sorgenteNome}</span>: <span className="font-semibold text-[#FF9330]">{n(piano.inclusi.length)} lead</span>
                        {piano.perDestinatario.length > 0 && <> → {piano.perDestinatario.map(d => `${d.nome} ${d.quanti}`).join(", ")}</>}.
                        {piano.esclusi.length > 0 && <> Esclusi {n(piano.esclusi.length)}.</>}
                    </div>
                    {piano.avvisi.map((a, i) => <Avviso key={i} tipo="info">{a}</Avviso>)}
                    <Dettagli titolo={`Quali lead (${piano.inclusi.length})`}>
                        {piano.inclusi.map(v => <li key={v.id}>{v.nome}{v.a && piano.perDestinatario.length > 1 ? ` → ${piano.perDestinatario.find(d => d.id === v.a)?.nome ?? ""}` : ""}</li>)}
                    </Dettagli>
                    {piano.esclusi.length > 0 && (
                        <Dettagli titolo={`Esclusi e perché (${piano.esclusi.length})`}>
                            {piano.esclusi.map(v => <li key={v.id}>{v.nome}: <span className="text-[#FFB4A8]">{v.motivo}</span></li>)}
                        </Dettagli>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={bottone("primario")} disabled={inCorso || piano.inclusi.length === 0} onClick={conferma}>
                            {inCorso ? "In corso…" : `Conferma (${piano.inclusi.length})`}
                        </button>
                        <button type="button" className={bottone("linea")} disabled={inCorso} onClick={onChiudi}>Lascia stare</button>
                    </div>
                    {input.tipo === "al_bot" && inCorso && <div className="text-[12.5px] text-[#BFBFBF]">Il bot li riceve a 30 al minuto: può volerci qualche minuto, non chiudere la pagina.</div>}
                </div>
            )}
        </div>
    )
}

function Dettagli({ titolo, children }: { titolo: string; children: ReactNode }) {
    return (
        <details className="rounded-[8px] bg-[#262626] px-3 py-2">
            <summary className="cursor-pointer text-[13.5px] font-semibold">{titolo}</summary>
            <ul className="mt-2 max-h-56 list-disc overflow-auto pl-5 text-[13px] leading-relaxed text-[#E0E0E0]">{children}</ul>
        </details>
    )
}

// ── Interruttori del GDO ─────────────────────────────────────────────────

function Interruttore({ v, testo, onCambia }: { v: boolean; testo: string; onCambia: () => void }) {
    return (
        <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" className="h-4 w-4 accent-[#FF9330]" checked={v} onChange={onCambia} />{testo}
        </label>
    )
}

function Interruttori({ persona, onFatto }: { persona: PersonaRegia; onFatto: () => void }) {
    const [isActive, setIsActive] = useState(persona.isActive)
    const [freschi, setFreschi] = useState(persona.acAutoIntake)
    const [ridati, setRidati] = useState(persona.botReturnIntake)
    const [cap, setCap] = useState(persona.dailyFreshCap === null ? "" : String(persona.dailyFreshCap))
    const [anteprima, setAnteprima] = useState<AnteprimaInterruttori | null>(null)
    const [messaggio, setMessaggio] = useState<{ tipo: "ok" | "errore"; testo: string } | null>(null)
    const [inCorso, avvia] = useTransition()
    const input = { userId: persona.id, isActive, acAutoIntake: freschi, botReturnIntake: ridati, dailyFreshCap: cap.trim() === "" ? null : Number(cap) }

    const vedi = () => avvia(async () => {
        setMessaggio(null)
        const r = await anteprimaInterruttoriGdo(input)
        if (r.ok) setAnteprima(r.dati); else setMessaggio({ tipo: "errore", testo: r.errore })
    })
    const conferma = () => avvia(async () => {
        const r = await confermaInterruttoriGdo(input)
        setAnteprima(null)
        if (r.ok) { setMessaggio({ tipo: "ok", testo: "Fatto. Si può annullare dallo storico." }); onFatto() }
        else setMessaggio({ tipo: "errore", testo: r.errore })
    })
    const Interr = ({ v, set, testo }: { v: boolean; set: (x: boolean) => void; testo: string }) =>
        <Interruttore v={v} testo={testo} onCambia={() => { set(!v); setAnteprima(null) }} />

    return (
        <div className="mb-5 rounded-[12px] border-2 border-[#3D3D3D] p-4">
            <h3 className="text-[15px] font-semibold">Interruttori di {persona.nome}</h3>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                {Interr({ v: freschi, set: setFreschi, testo: "Riceve freschi" })}
                {Interr({ v: ridati, set: setRidati, testo: "Riceve ridati dal bot" })}
                <label className="flex items-center gap-2 text-[14px]">
                    Tetto freschi al giorno
                    <input className="h-9 w-20 rounded-[8px] border-2 border-[#3D3D3D] bg-[#1F1F1F] px-2" inputMode="numeric" value={cap}
                        onChange={e => { setCap(e.target.value.replace(/\D/g, "")); setAnteprima(null) }} aria-label="Tetto freschi al giorno" />
                </label>
                {Interr({ v: isActive, set: setIsActive, testo: "Account attivo" })}
                <button type="button" className={bottone("linea", "piccola")} onClick={vedi} disabled={inCorso}>Vedi cosa cambia</button>
            </div>
            <div className="mt-2 text-[12.5px] text-[#BFBFBF]">Per un&apos;assenza basta spegnere freschi e ridati. &quot;Account attivo&quot; spento toglie l&apos;accesso al CRM e si può solo senza lead aperti.</div>
            {anteprima && (
                <div className="mt-3 flex flex-col gap-2 rounded-[10px] bg-[#1F1F1F] p-3 text-[14px]">
                    {anteprima.cambi.length === 0 ? <div>Non cambia niente.</div> : (
                        <ul className="list-disc pl-5">{anteprima.cambi.map(c => <li key={c.campo}>{c.etichetta}: {c.prima} → <span className="font-semibold text-[#FF9330]">{c.dopo}</span></li>)}</ul>
                    )}
                    {anteprima.bloccato && <Avviso tipo="errore">Non si può: {anteprima.bloccato}.</Avviso>}
                    <div className="flex gap-2">
                        <button type="button" className={bottone("primario", "piccola")} disabled={inCorso || !!anteprima.bloccato || anteprima.cambi.length === 0} onClick={conferma}>Conferma</button>
                        <button type="button" className={bottone("linea", "piccola")} onClick={() => setAnteprima(null)}>Lascia stare</button>
                    </div>
                </div>
            )}
            {messaggio && <div className="mt-3"><Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso></div>}
        </div>
    )
}

// ── Lead singolo ─────────────────────────────────────────────────────────

function AzioneSingolo({ tipo, leadId, nome, onChiudi, onFatto }: {
    tipo: InputSingolo["tipo"]; leadId: string; nome: string; onChiudi: () => void; onFatto: () => void
}) {
    const [motivo, setMotivo] = useState("")
    const [tenuto, setTenuto] = useState<SearchResult | null>(null)
    const [anteprima, setAnteprima] = useState<AnteprimaSingolo | null>(null)
    const [messaggio, setMessaggio] = useState<{ tipo: "ok" | "errore"; testo: string } | null>(null)
    const [inCorso, avvia] = useTransition()
    const input: InputSingolo = { tipo, leadId, motivo, tenutoId: tenuto?.id ?? null }
    const titolo = tipo === "scarta" ? "Scarta" : tipo === "doppione" ? "Chiudi come doppione" : "Togli l'appuntamento"

    const vedi = () => avvia(async () => {
        setMessaggio(null)
        const r = await anteprimaLead(input)
        if (r.ok) setAnteprima(r.dati); else setMessaggio({ tipo: "errore", testo: r.errore })
    })
    const conferma = () => avvia(async () => {
        const r = await confermaLead(input)
        setAnteprima(null)
        if (r.ok) { setMessaggio({ tipo: "ok", testo: "Fatto. Si può annullare dallo storico." }); onFatto() }
        else setMessaggio({ tipo: "errore", testo: r.errore })
    })

    return (
        <div className="rounded-[12px] bg-[#1F1F1F] p-4 text-[14px]" aria-live="polite">
            <div className="flex items-start justify-between gap-3">
                <h4 className="font-semibold">{titolo}: {nome}</h4>
                <button type="button" className={bottone("testo", "piccola")} onClick={onChiudi}>Chiudi</button>
            </div>
            {tipo === "scarta" && (
                <div className="mt-3"><Etichetta>Motivo</Etichetta>
                    <input className={CAMPO} value={motivo} onChange={e => { setMotivo(e.target.value); setAnteprima(null) }} placeholder="es. numero inesistente" /></div>
            )}
            {tipo === "doppione" && (
                <div className="mt-3"><Etichetta sotto="Cerca per nome o telefono il lead da tenere.">Doppione di</Etichetta>
                    <CercaLead escludi={leadId} scelto={tenuto} onScegli={(r) => { setTenuto(r); setAnteprima(null) }} /></div>
            )}
            {!anteprima && !messaggio?.tipo?.startsWith("ok") && (
                <div className="mt-3"><button type="button" className={bottone("linea", "piccola")} onClick={vedi} disabled={inCorso}>Vedi l&apos;anteprima</button></div>
            )}
            {anteprima && (
                <div className="mt-3 flex flex-col gap-2">
                    <div>{anteprima.cosaSuccede}</div>
                    {anteprima.appuntamento && <div className="text-[#BFBFBF]">Appuntamento: {dataOraBreveRoma(new Date(anteprima.appuntamento))}</div>}
                    {anteprima.bloccato && <Avviso tipo="errore">Non si può: {anteprima.bloccato}.</Avviso>}
                    <div className="flex gap-2">
                        <button type="button" className={bottone("primario", "piccola")} disabled={inCorso || !!anteprima.bloccato} onClick={conferma}>{inCorso ? "In corso…" : "Conferma"}</button>
                        <button type="button" className={bottone("linea", "piccola")} onClick={() => setAnteprima(null)}>Lascia stare</button>
                    </div>
                </div>
            )}
            {messaggio && <div className="mt-3"><Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso></div>}
        </div>
    )
}

function CercaLead({ escludi, scelto, onScegli }: { escludi?: string; scelto: SearchResult | null; onScegli: (r: SearchResult) => void }) {
    const [q, setQ] = useState("")
    const [risultati, setRisultati] = useState<SearchResult[]>([])
    const [, avvia] = useTransition()
    useEffect(() => {
        if (q.trim().length < 3) { setRisultati([]); return }
        const t = setTimeout(() => avvia(async () => setRisultati((await searchLeads(q)).filter(r => r.id !== escludi))), 350)
        return () => clearTimeout(t)
    }, [q, escludi])
    return (
        <div>
            <input className={CAMPO} value={q} onChange={e => setQ(e.target.value)} placeholder="Nome o telefono" aria-label="Cerca lead" />
            {scelto && <div className="mt-2 text-[13.5px]">Scelto: <span className="font-semibold">{scelto.name}</span> · {scelto.phone} · {scelto.statusLabel}</div>}
            {risultati.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                    {risultati.map(r => (
                        <li key={r.id}>
                            <button type="button" onClick={() => { onScegli(r); setRisultati([]); setQ("") }}
                                className="w-full rounded-[8px] px-2 py-1.5 text-left text-[13.5px] hover:bg-[#2E2E2E]">
                                {r.name} · {r.phone} · <span className="text-[#BFBFBF]">{r.statusLabel}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function LeadSingolo() {
    const router = useRouter()
    const [lead, setLead] = useState<SearchResult | null>(null)
    const [tipo, setTipo] = useState<InputSingolo["tipo"] | null>(null)
    return (
        <Sezione titolo="Un lead solo">
            <div className="text-[13.5px] leading-snug text-[#BFBFBF]">Cerca un lead per nome o telefono: togli l&apos;appuntamento e riportalo in pipeline, scartalo o chiudilo come doppione.</div>
            <div className="mt-3"><CercaLead scelto={lead} onScegli={(r) => { setLead(r); setTipo(null) }} /></div>
            {lead && (
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={bottone(tipo === "togli_appuntamento" ? "scelto" : "linea", "piccola")} onClick={() => setTipo("togli_appuntamento")}>Togli appuntamento</button>
                    <button type="button" className={bottone(tipo === "scarta" ? "scelto" : "linea", "piccola")} onClick={() => setTipo("scarta")}>Scarta</button>
                    <button type="button" className={bottone(tipo === "doppione" ? "scelto" : "linea", "piccola")} onClick={() => setTipo("doppione")}>Doppione</button>
                </div>
            )}
            {lead && tipo && (
                <div className="mt-3">
                    <AzioneSingolo key={`${lead.id}-${tipo}`} tipo={tipo} leadId={lead.id} nome={lead.name} onChiudi={() => setTipo(null)} onFatto={() => router.refresh()} />
                </div>
            )}
        </Sezione>
    )
}

// ── Storico ──────────────────────────────────────────────────────────────

function Storico({ storico }: { storico: OperazioneStorico[] }) {
    const router = useRouter()
    const [chiede, setChiede] = useState<string | null>(null)
    const [esito, setEsito] = useState<{ id: string; tipo: "ok" | "errore"; testo: string } | null>(null)
    const [inCorso, avvia] = useTransition()

    const annulla = (id: string) => avvia(async () => {
        const r = await annullaOperazioneRegia(id)
        setChiede(null)
        if (r.ok) {
            const s = r.dati.saltati
            setEsito({ id, tipo: "ok", testo: `Annullata: ${r.dati.ripristinati} rimessi com'erano.${s.length ? ` Restano ${s.length}: ${s.slice(0, 5).map(x => `${x.nome} (${x.motivo})`).join("; ")}${s.length > 5 ? "…" : ""}` : ""}` })
            router.refresh()
        } else setEsito({ id, tipo: "errore", testo: r.errore })
    })

    return (
        <Sezione titolo="Storico delle operazioni">
            {storico.length === 0 ? <Vuoto>Ancora nessuna operazione.</Vuoto> : (
                <ul className="flex flex-col">
                    {storico.map(o => (
                        <li key={o.id} className="border-t-2 border-[#2E2E2E] py-3 first:border-t-0 first:pt-0">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[14px] leading-snug">{o.descrizione}</div>
                                    <div className="mt-0.5 text-[12.5px] text-[#BFBFBF]">
                                        {dataOraBreveRoma(new Date(o.quando))} · {o.admin || "admin"}
                                        {o.push ? ` · bot: ${o.push.inviati} inviati${o.push.restanti ? `, ${o.push.restanti} da ripassare` : ""}` : ""}
                                        {o.annullataAlle ? ` · annullata alle ${dataOraBreveRoma(new Date(o.annullataAlle))}${o.esitoAnnulla?.saltati.length ? ` (${o.esitoAnnulla.saltati.length} rimasti com'erano)` : ""}` : ""}
                                    </div>
                                </div>
                                {!o.annullataAlle && chiede !== o.id && (
                                    <button type="button" className={bottone("linea", "piccola")} onClick={() => { setChiede(o.id); setEsito(null) }}>Annulla</button>
                                )}
                            </div>
                            {chiede === o.id && (
                                <div className="mt-2 flex flex-col gap-2 rounded-[10px] bg-[#1F1F1F] p-3 text-[13.5px]">
                                    <div>Rimetto com&apos;erano i lead di questa operazione. Quelli che nel frattempo sono stati chiamati, fissati o spostati restano dove sono.{o.tipo === "al_bot" ? " I messaggi WhatsApp già partiti non tornano indietro." : ""}{o.tipo === "togli_appuntamento" ? " Le monete stornate non tornano." : ""}</div>
                                    <div className="flex gap-2">
                                        <button type="button" className={bottone("primario", "piccola")} disabled={inCorso} onClick={() => annulla(o.id)}>{inCorso ? "In corso…" : "Sì, annulla"}</button>
                                        <button type="button" className={bottone("linea", "piccola")} onClick={() => setChiede(null)}>No</button>
                                    </div>
                                </div>
                            )}
                            {esito?.id === o.id && <div className="mt-2"><Avviso tipo={esito.tipo}>{esito.testo}</Avviso></div>}
                        </li>
                    ))}
                </ul>
            )}
        </Sezione>
    )
}
