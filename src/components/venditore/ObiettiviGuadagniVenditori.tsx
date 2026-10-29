"use client"

// Schermata manager/admin (PO 29/10/2026): obiettivi INDIVIDUALI dei venditori
// per mese, misurati sul FIRMATO, e guadagno di ciascuno sull'INCASSATO.
// Un mese senza obiettivi salvati mostra quelli dell'ultimo mese prima.

import { useEffect, useState, useCallback } from "react"
import { getObiettiviEGuadagni, saveObiettiviVenditori } from "@/app/actions/obiettiviVenditoriActions"
import type { GuadagnoVenditore } from "@/lib/venditore/obiettiviDb"
import { formatEur, formatMonth } from "@/components/gestionale/format"
import { Target, Save } from "lucide-react"

const euro = (eur: number) => formatEur(Math.round(eur * 100))

function mesiSelezionabili(corrente: string): string[] {
    const out: string[] = []
    let [y, m] = '2026-10'.split('-').map(Number)
    const [cy, cm] = corrente.split('-').map(Number)
    const fine = cy * 12 + cm + 3
    while (y * 12 + m <= fine) {
        out.push(`${y}-${String(m).padStart(2, '0')}`)
        m++; if (m > 12) { m = 1; y++ }
    }
    return out.reverse()
}

type Bozza = Record<string, { t1: string; t2: string }>

export function ObiettiviGuadagniVenditori({ meseCorrente }: { meseCorrente: string }) {
    const [mese, setMese] = useState(meseCorrente)
    const [righe, setRighe] = useState<GuadagnoVenditore[]>([])
    const [bozza, setBozza] = useState<Bozza>({})
    const [caricamento, setCaricamento] = useState(true)
    const [salvataggio, setSalvataggio] = useState(false)
    const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null)

    const carica = useCallback(async (ym: string) => {
        setCaricamento(true)
        try {
            const r = await getObiettiviEGuadagni(ym)
            setRighe(r)
            setBozza(Object.fromEntries(r.map(x => [x.salesUserId, {
                t1: x.obiettivi.target1Eur != null ? String(x.obiettivi.target1Eur) : '',
                t2: x.obiettivi.target2Eur != null ? String(x.obiettivi.target2Eur) : '',
            }])))
        } catch (e) {
            console.error(e)
            setMessaggio({ ok: false, testo: 'Impossibile caricare i dati.' })
        } finally {
            setCaricamento(false)
        }
    }, [])

    useEffect(() => { setMessaggio(null); carica(mese) }, [mese, carica])

    const numero = (s: string): number | null => {
        const t = s.replace(/\./g, '').replace(',', '.').trim()
        return t === '' ? null : Number(t)
    }

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
                        <h2 className="font-semibold text-ash-800">Obiettivi e guadagni dei venditori</h2>
                        <div className="text-xs text-ash-500">Obiettivi individuali sul firmato del mese. Guadagno = incassato ÷ 1,22 × 10% (11% col 1° obiettivo, 12% col 2°).</div>
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
                                <th className="px-3 py-2 text-right">Firmato</th>
                                <th className="px-3 py-2">1° obiettivo</th>
                                <th className="px-3 py-2">2° obiettivo</th>
                                <th className="px-3 py-2 text-right">Incassato</th>
                                <th className="px-3 py-2 text-right">Senza bonus</th>
                                <th className="px-3 py-2 text-right">Con bonus</th>
                                <th className="px-3 py-2">Prossimo obiettivo</th>
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
                                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-ash-800">{euro(r.firmatoEur)}</td>
                                        <td className="px-3 py-2">
                                            <input
                                                inputMode="decimal"
                                                value={b.t1}
                                                onChange={e => setBozza(p => ({ ...p, [r.salesUserId]: { ...b, t1: e.target.value } }))}
                                                className="input-fenice w-28 text-sm"
                                                placeholder="—"
                                            />
                                            {ereditato && <div className="mt-0.5 text-[10px] text-ash-400">da {formatMonth(r.obiettivi.daMese!)}</div>}
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                inputMode="decimal"
                                                value={b.t2}
                                                onChange={e => setBozza(p => ({ ...p, [r.salesUserId]: { ...b, t2: e.target.value } }))}
                                                className="input-fenice w-28 text-sm"
                                                placeholder="—"
                                            />
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right text-ash-700">
                                            {formatEur(r.incassatoCents)}
                                            {r.incassoProvvisorio && r.incassatoCents !== 0 && <div className="text-[10px] text-ash-400">provvisorio</div>}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right text-ash-700">{formatEur(r.guadagno.baseCents)}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-emerald-700">
                                            {formatEur(r.guadagno.attualeCents)} <span className="text-xs font-normal text-ash-500">({r.guadagno.pct}%)</span>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-xs text-ash-600">
                                            {r.guadagno.prossimo
                                                ? `mancano ${euro(Math.max(0, r.guadagno.prossimo.mancaEur))} per il ${r.guadagno.prossimo.numero}° → ${formatEur(r.guadagno.prossimo.guadagnoCents)}`
                                                : r.obiettivi.target1Eur != null ? 'tutti presi' : '—'}
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
