"use client"

// Schermata manager/admin in /kpi-venditori (PO 29/10/2026): SOLO la modifica
// degli obiettivi individuali dei venditori per mese, misurati sul FIRMATO.
// Incassato e commissioni stanno in /performance-venditori.
// Un mese senza obiettivi salvati mostra quelli dell'ultimo mese prima.

import { useEffect, useState, useCallback } from "react"
import { getObiettiviMese, saveObiettiviVenditori } from "@/app/actions/obiettiviVenditoriActions"
import type { ObiettiviVenditore } from "@/lib/venditore/obiettiviDb"
import { formatMonth } from "@/components/gestionale/format"
import { Target, Save } from "lucide-react"

export function mesiSelezionabili(corrente: string, primo = '2026-10', dopo = 3): string[] {
    const out: string[] = []
    let [y, m] = primo.split('-').map(Number)
    const [cy, cm] = corrente.split('-').map(Number)
    const fine = cy * 12 + cm + dopo
    while (y * 12 + m <= fine) {
        out.push(`${y}-${String(m).padStart(2, '0')}`)
        m++; if (m > 12) { m = 1; y++ }
    }
    return out.reverse()
}

type Bozza = Record<string, { t1: string; t2: string }>

const numero = (s: string): number | null => {
    const t = s.replace(/\./g, '').replace(',', '.').trim()
    return t === '' ? null : Number(t)
}

export function ObiettiviVenditoriEditor({ meseCorrente }: { meseCorrente: string }) {
    const [mese, setMese] = useState(meseCorrente)
    const [righe, setRighe] = useState<ObiettiviVenditore[]>([])
    const [bozza, setBozza] = useState<Bozza>({})
    const [caricamento, setCaricamento] = useState(true)
    const [salvataggio, setSalvataggio] = useState(false)
    const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null)

    const carica = useCallback(async (ym: string) => {
        setCaricamento(true)
        try {
            const r = await getObiettiviMese(ym)
            setRighe(r)
            setBozza(Object.fromEntries(r.map(x => [x.salesUserId, {
                t1: x.obiettivi.target1Eur != null ? String(x.obiettivi.target1Eur) : '',
                t2: x.obiettivi.target2Eur != null ? String(x.obiettivi.target2Eur) : '',
            }])))
        } catch (e) {
            console.error(e)
            setMessaggio({ ok: false, testo: 'Impossibile caricare gli obiettivi.' })
        } finally {
            setCaricamento(false)
        }
    }, [])

    useEffect(() => { setMessaggio(null); carica(mese) }, [mese, carica])

    const salva = async () => {
        setSalvataggio(true)
        setMessaggio(null)
        try {
            const r = await saveObiettiviVenditori(mese, righe.map(x => ({
                salesUserId: x.salesUserId,
                target1Eur: numero(bozza[x.salesUserId]?.t1 ?? ''),
                target2Eur: numero(bozza[x.salesUserId]?.t2 ?? ''),
            })))
            if (r.ok) {
                setMessaggio({ ok: true, testo: `Obiettivi di ${formatMonth(mese)} salvati. Valgono anche per i mesi dopo, finché non li cambi.` })
                await carica(mese)
            } else {
                setMessaggio({ ok: false, testo: r.error })
            }
        } finally {
            setSalvataggio(false)
        }
    }

    return (
        <div className="mx-auto max-w-7xl space-y-4 rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-brand-orange" />
                    <div>
                        <h2 className="font-semibold text-ash-800">Obiettivi mensili dei venditori</h2>
                        <div className="text-xs text-ash-500">Individuali, sul firmato del mese. 1° obiettivo = commissione all&apos;11%, 2° = 12% (base 10%). Incassato e commissioni sono in Performance venditori.</div>
                    </div>
                </div>
                <select
                    value={mese}
                    onChange={e => setMese(e.target.value)}
                    className="cursor-pointer rounded-lg border border-ash-200/60 bg-ash-100/80 px-3 py-2 text-sm font-medium text-ash-700 focus:outline-none focus:ring-2 focus:ring-brand-orange/40"
                >
                    {mesiSelezionabili(meseCorrente).map(m => <option key={m} value={m}>{formatMonth(m)}</option>)}
                </select>
            </div>

            {caricamento ? (
                <div className="py-8 text-center text-sm text-ash-400">Caricamento…</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-ash-200/60 text-left text-sm">
                        <thead className="bg-ash-50 text-xs font-medium uppercase tracking-wider text-ash-500">
                            <tr>
                                <th className="px-3 py-2">Venditore</th>
                                <th className="px-3 py-2">1° obiettivo (€ firmato)</th>
                                <th className="px-3 py-2">2° obiettivo (€ firmato)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-100/60">
                            {righe.map(r => {
                                const b = bozza[r.salesUserId] ?? { t1: '', t2: '' }
                                const ereditato = r.obiettivi.daMese != null && r.obiettivi.daMese !== mese
                                return (
                                    <tr key={r.salesUserId}>
                                        <td className="whitespace-nowrap px-3 py-2">
                                            <div className="font-medium text-ash-800">{r.nome}</div>
                                            <div className="text-[10px] text-ash-400">{r.codice}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                inputMode="decimal"
                                                value={b.t1}
                                                onChange={e => setBozza(p => ({ ...p, [r.salesUserId]: { ...b, t1: e.target.value } }))}
                                                className="input-fenice w-32 text-sm"
                                                placeholder="—"
                                            />
                                            {ereditato && <div className="mt-0.5 text-[10px] text-ash-400">da {formatMonth(r.obiettivi.daMese!)}</div>}
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                inputMode="decimal"
                                                value={b.t2}
                                                onChange={e => setBozza(p => ({ ...p, [r.salesUserId]: { ...b, t2: e.target.value } }))}
                                                className="input-fenice w-32 text-sm"
                                                placeholder="—"
                                            />
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className={`text-sm ${messaggio?.ok ? 'text-emerald-700' : 'text-ember-600'}`}>{messaggio?.testo ?? ''}</div>
                <button
                    onClick={salva}
                    disabled={salvataggio || caricamento}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                    <Save className="h-4 w-4" />
                    {salvataggio ? 'Salvataggio…' : `Salva obiettivi di ${formatMonth(mese)}`}
                </button>
            </div>
        </div>
    )
}
