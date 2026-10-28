"use client"

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { salvaObiettiviFissatore } from '@/app/actions/fissatoreStatsActions'
import {
    CHIAVI_OBIETTIVI, ETICHETTE_OBIETTIVI, TESTO_FONTE,
    type ChiaveObiettivo, type ObiettiviRisolti, type ObiettiviSalvati,
} from '@/lib/bot-fissatore/obiettiviFissatore'

const SPIEGAZIONE: Record<ChiaveObiettivo, string> = {
    risposta: 'più alto è meglio',
    fissaggioTotale: 'più alto è meglio',
    fissaggioRisposti: 'più alto è meglio',
    restituzione: 'più basso è meglio',
}

function testoIniziale(salvati: ObiettiviSalvati): Record<ChiaveObiettivo, string> {
    const out = {} as Record<ChiaveObiettivo, string>
    for (const k of CHIAVI_OBIETTIVI) out[k] = salvati[k] !== undefined ? String(salvati[k]).replace('.', ',') : ''
    return out
}

/** Solo per l'admin: la pagina lo mostra solo a lui e la server action lo ricontrolla. */
export function ObiettiviFissatoreForm({ salvati, obiettivi }: { salvati: ObiettiviSalvati; obiettivi: ObiettiviRisolti }) {
    const router = useRouter()
    const [valori, setValori] = useState(() => testoIniziale(salvati))
    const [errore, setErrore] = useState<string | null>(null)
    const [fatto, setFatto] = useState(false)
    const [inCorso, startTransition] = useTransition()

    function salva(e: React.FormEvent) {
        e.preventDefault()
        setErrore(null)
        setFatto(false)
        startTransition(async () => {
            const r = await salvaObiettiviFissatore(valori)
            if (!r.ok) {
                setErrore(r.errore)
                return
            }
            setFatto(true)
            router.refresh()
        })
    }

    return (
        <form onSubmit={salva} className="rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {CHIAVI_OBIETTIVI.map(k => {
                    const o = obiettivi[k]
                    return (
                        <label key={k} className="block">
                            <div className="text-xs font-semibold uppercase tracking-wider text-ash-500">{ETICHETTE_OBIETTIVI[k]}</div>
                            <div className="mt-1 flex items-center gap-1.5">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={valori[k]}
                                    onChange={e => setValori(v => ({ ...v, [k]: e.target.value }))}
                                    placeholder="vuoto = predefinito"
                                    className="h-9 w-full rounded-lg border border-ash-200/60 bg-white px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30"
                                />
                                <div className="text-sm text-ash-500">%</div>
                            </div>
                            <div className="mt-1 text-xs text-ash-400">
                                {SPIEGAZIONE[k]} · oggi {o.valore === null ? 'da impostare' : `${String(o.valore).replace('.', ',')}% (${TESTO_FONTE[o.fonte]})`}
                            </div>
                        </label>
                    )
                })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                    type="submit"
                    disabled={inCorso}
                    className="h-9 rounded-lg bg-brand-orange px-4 text-sm font-medium text-white transition-colors hover:bg-brand-orange-600 disabled:opacity-60"
                >
                    {inCorso ? 'Salvo…' : 'Salva obiettivi'}
                </button>
                <div className="text-xs text-ash-500">Lascia vuoto un campo per tornare al valore predefinito.</div>
                {errore ? <div className="text-sm text-red-600">{errore}</div> : null}
                {fatto && !errore ? <div className="text-sm text-emerald-600">Salvato</div> : null}
            </div>
        </form>
    )
}
