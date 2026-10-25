"use client"

// Modulo admin del bonus Conferme (PO 25/10/2026: chiusure, settimana, soglia
// 16, 12 euro a testa). Unità e periodo restano modificabili: l'anteprima
// mostra dove sarebbe oggi la squadra con ciascuna regola.

import { useMemo, useState } from "react"
import { saveConfermeBonusSettings, type ConfermeBonusSettings } from "@/app/actions/confermeDirettaActions"
import { progressoSquadra, type BonusPeriodo, type BonusUnita, type ObiettiviConferme } from "@/lib/conferme/bonus"
import { euroIt } from "@/lib/diretta/formato"

type ObiettiviForm = Record<string, { confermeGiorno: string; presenzeSettimana: string; chiusureMese: string }>

const KEYS = ['confermeGiorno', 'presenzeSettimana', 'chiusureMese'] as const
const COLONNE: Record<(typeof KEYS)[number], string> = {
    confermeGiorno: 'Conferme al giorno',
    presenzeSettimana: 'Presenze a settimana',
    chiusureMese: 'Chiusure al mese',
}

const eur = (n: number) => euroIt(n)

function toForm(obiettivi: Record<string, ObiettiviConferme>, accountIds: string[]): ObiettiviForm {
    const out: ObiettiviForm = {}
    for (const id of accountIds) {
        const o = obiettivi[id]
        out[id] = {
            confermeGiorno: o?.confermeGiorno ? String(o.confermeGiorno) : "",
            presenzeSettimana: o?.presenzeSettimana ? String(o.presenzeSettimana) : "",
            chiusureMese: o?.chiusureMese ? String(o.chiusureMese) : "",
        }
    }
    return out
}

/** Campo vuoto = obiettivo non impostato; altrimenti il numero, che il server valida. */
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(",", ".")))

export function ConfermeBonusForm({ initial }: { initial: ConfermeBonusSettings }) {
    const accountIds = initial.account.map(a => a.id)
    const [unita, setUnita] = useState<BonusUnita>(initial.config.unita)
    const [periodo, setPeriodo] = useState<BonusPeriodo>(initial.config.periodo)
    const [soglia, setSoglia] = useState(String(initial.config.soglia))
    const [euro, setEuro] = useState(String(initial.config.euroPerUnita))
    const [obiettivi, setObiettivi] = useState<ObiettiviForm>(() => toForm(initial.config.obiettivi, accountIds))
    const [saving, setSaving] = useState(false)
    const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null)

    const anteprima = useMemo(() => {
        const s = Number(soglia)
        const e = Number(euro.replace(",", "."))
        if (!Number.isInteger(s) || s < 0 || !Number.isFinite(e) || e < 0) return null
        return progressoSquadra(initial.anteprima[unita][periodo], { soglia: s, euroPerUnita: e })
    }, [soglia, euro, unita, periodo, initial.anteprima])

    const salva = async () => {
        setSaving(true)
        setEsito(null)
        try {
            const payload = {
                unita,
                periodo,
                soglia: Number(soglia),
                euroPerUnita: Number(euro.replace(",", ".")),
                obiettivi: Object.fromEntries(Object.entries(obiettivi).map(([id, o]) => [id, {
                    confermeGiorno: numOrNull(o.confermeGiorno),
                    presenzeSettimana: numOrNull(o.presenzeSettimana),
                    chiusureMese: numOrNull(o.chiusureMese),
                }])),
            }
            const res = await saveConfermeBonusSettings(payload)
            if (res.success) {
                setObiettivi(toForm(res.config.obiettivi, accountIds))
                setEsito({ ok: true, testo: "Salvato. Le Conferme lo vedono entro mezzo minuto." })
            } else {
                setEsito({ ok: false, testo: res.error })
            }
        } catch {
            setEsito({ ok: false, testo: "Salvataggio non riuscito, riprova." })
        } finally {
            setSaving(false)
        }
    }

    const input = "w-full rounded-lg border border-ash-300 bg-white px-3 py-2 text-sm text-ash-800 outline-none focus:border-brand-orange tabular-nums"
    const scelta = (on: boolean) => `rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${on ? "border-brand-charcoal bg-brand-charcoal text-white" : "border-ash-200 bg-white text-ash-600 hover:border-ash-400"}`
    const unitaLabel = unita === "chiusure" ? "chiusure" : "presenze"

    return (
        <div className="space-y-6">
            <div className="rounded-2xl border border-ash-200 bg-white p-5">
                <h2 className="text-base font-bold text-brand-charcoal">Bonus di squadra</h2>
                <p className="mt-1 text-sm text-ash-500">
                    Deciso il 25/10/2026: chiusure della settimana (lunedì-sabato), soglia di squadra 16, poi 12 euro lordi a testa per ogni chiusura in più.
                    Contano solo i lead confermati da un account Conferme. I bonus da pagare si registrano a settimana chiusa in Premi della settimana.
                </p>

                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <div>
                        <div className="mb-2 text-sm font-semibold text-ash-700">Cosa si conta</div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setUnita("chiusure")} className={scelta(unita === "chiusure")}>Chiusure</button>
                            <button type="button" onClick={() => setUnita("presenze")} className={scelta(unita === "presenze")}>Presenze</button>
                        </div>
                    </div>
                    <div>
                        <div className="mb-2 text-sm font-semibold text-ash-700">Periodo</div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setPeriodo("mese")} className={scelta(periodo === "mese")}>Mese</button>
                            <button type="button" onClick={() => setPeriodo("settimana")} className={scelta(periodo === "settimana")}>Settimana</button>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="bonus-soglia" className="mb-2 block text-sm font-semibold text-ash-700">Soglia di squadra</label>
                        <input id="bonus-soglia" type="number" min={0} step={1} value={soglia} onChange={e => setSoglia(e.target.value)} className={input} />
                    </div>
                    <div>
                        <label htmlFor="bonus-euro" className="mb-2 block text-sm font-semibold text-ash-700">Euro per ogni unità oltre la soglia</label>
                        <input id="bonus-euro" type="number" min={0} step={0.5} value={euro} onChange={e => setEuro(e.target.value)} className={input} />
                    </div>
                </div>

                <div className="mt-5 rounded-xl bg-ash-50 p-4 text-sm text-ash-700">
                    <div className="font-semibold text-brand-charcoal">Dove sarebbe oggi la squadra</div>
                    <table className="mt-2 w-full max-w-sm text-left tabular-nums">
                        <thead>
                            <tr className="text-ash-500">
                                <th className="py-1 font-medium" />
                                <th className="py-1 text-right font-medium">Settimana</th>
                                <th className="py-1 text-right font-medium">Mese</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="py-1">Chiusure</td>
                                <td className="py-1 text-right">{initial.anteprima.chiusure.settimana}</td>
                                <td className="py-1 text-right">{initial.anteprima.chiusure.mese}</td>
                            </tr>
                            <tr>
                                <td className="py-1">Presenze</td>
                                <td className="py-1 text-right">{initial.anteprima.presenze.settimana}</td>
                                <td className="py-1 text-right">{initial.anteprima.presenze.mese}</td>
                            </tr>
                        </tbody>
                    </table>
                    {anteprima && (
                        <p className="mt-3">
                            Con questa regola la squadra è a <span className="font-semibold">{anteprima.conteggio} {unitaLabel}</span> su {anteprima.soglia}
                            {anteprima.oltre > 0
                                ? <>: <span className="font-semibold">{eur(anteprima.euro)}</span> maturati oltre la soglia.</>
                                : <>: ne mancano {anteprima.mancano} alla prima pagata.</>}
                        </p>
                    )}
                </div>
            </div>

            <div className="rounded-2xl border border-ash-200 bg-white p-5">
                <h2 className="text-base font-bold text-brand-charcoal">Obiettivi individuali</h2>
                <p className="mt-1 text-sm text-ash-500">
                    Un campo vuoto non si mostra. I valori per Andrea e Alberto sono ancora da decidere.
                </p>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                        <thead>
                            <tr className="text-ash-500">
                                <th className="py-2 pr-3 font-medium">Account</th>
                                {KEYS.map(k => <th key={k} className="py-2 pr-3 font-medium">{COLONNE[k]}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {initial.account.map(a => (
                                <tr key={a.id} className="border-t border-ash-100">
                                    <td className="py-2 pr-3 font-semibold text-ash-800">
                                        {a.nome}{!a.isActive && <span className="ml-1 font-normal text-ash-400">(non attivo)</span>}
                                    </td>
                                    {KEYS.map(k => (
                                        <td key={k} className="py-2 pr-3">
                                            <input
                                                type="number"
                                                min={1}
                                                step={1}
                                                aria-label={`${COLONNE[k]}, ${a.nome}`}
                                                value={obiettivi[a.id]?.[k] ?? ""}
                                                onChange={e => setObiettivi(prev => ({ ...prev, [a.id]: { ...prev[a.id], [k]: e.target.value } }))}
                                                className={input}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={salva}
                    disabled={saving}
                    className="rounded-lg bg-brand-charcoal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-50"
                >
                    {saving ? "Salvataggio..." : "Salva"}
                </button>
                {esito && (
                    <div className={`text-sm font-medium ${esito.ok ? "text-emerald-700" : "text-red-700"}`}>{esito.testo}</div>
                )}
            </div>
        </div>
    )
}
