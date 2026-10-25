"use client"

// Gestione admin del negozio nuovo: consegna o annulla le richieste (con
// rimborso), mostra il catalogo attivo e la forma della pagina Squadra.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { handleRewardPurchase, type ArticoloAdmin, type RichiestaPremio } from "@/app/actions/negozioActions"
import { setLeaderboardMode } from "@/app/actions/squadraActions"
import type { LeaderboardMode } from "@/lib/diretta/squadra"
import { daApprovare } from "@/lib/diretta/negozio"
import { STATO_TESTO, dataOra, numero, prezzoTesto } from "@/components/diretta/negozio/ui"

type Tab = 'da_gestire' | 'gestite' | 'catalogo'

const TIPO: Record<string, string> = {
    concreto: 'Premio',
    permesso: 'Permesso, da approvare',
    immagine: 'Immagine profilo',
    personalizzazione: 'Personalizzazione',
    corso: 'Corso',
}

const MODALITA: { value: LeaderboardMode; titolo: string; testo: string }[] = [
    { value: 'top3', titolo: 'Primi tre', testo: 'Il podio della settimana; chi non c\'è vede solo quante presenze gli mancano per salire.' },
    { value: 'completa', titolo: 'Classifica completa', testo: 'Tutta la squadra per presenze, poi per fissati.' },
    { value: 'nessuna', titolo: 'Nessuna classifica', testo: 'Solo la barra di squadra e i Fenici della settimana.' },
]

const btnArancio = 'inline-flex h-9 items-center justify-center rounded-[8px] bg-[#FF9330] px-3 text-sm font-semibold text-[#171717] transition-colors hover:bg-[#FFA552] disabled:opacity-60'
const btnLinea = 'inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 transition-colors hover:border-neutral-900 disabled:opacity-60'

export function PremiAdminClient({ richieste, modalita }: {
    richieste: { daGestire: RichiestaPremio[]; recenti: RichiestaPremio[]; catalogo: ArticoloAdmin[] }
    modalita: LeaderboardMode
}) {
    const router = useRouter()
    const [tab, setTab] = useState<Tab>('da_gestire')
    const [annulla, setAnnulla] = useState<string | null>(null)
    const [inCorso, setInCorso] = useState<string | null>(null)
    const [msg, setMsg] = useState<{ id: string; testo: string } | null>(null)
    const [mode, setMode] = useState<LeaderboardMode>(modalita)
    const [modeMsg, setModeMsg] = useState<string | null>(null)

    const gestisci = async (r: RichiestaPremio, to: 'consegnato' | 'annullato') => {
        if (inCorso) return
        setInCorso(r.id)
        setMsg(null)
        try {
            const res = await handleRewardPurchase(r.id, to)
            if (res.ok) {
                setAnnulla(null)
                router.refresh()
            } else {
                setMsg({ id: r.id, testo: res.error })
            }
        } catch {
            setMsg({ id: r.id, testo: 'Connessione assente. Riprova tra poco.' })
        } finally {
            setInCorso(null)
        }
    }

    const cambiaModo = async (m: LeaderboardMode) => {
        const prima = mode
        setMode(m)
        setModeMsg(null)
        try {
            const res = await setLeaderboardMode(m)
            if (res.ok) setModeMsg('Salvato. La pagina Squadra cambia subito.')
            else { setMode(prima); setModeMsg(res.error) }
        } catch {
            setMode(prima)
            setModeMsg('Connessione assente. Riprova tra poco.')
        }
    }

    const righe = tab === 'da_gestire' ? richieste.daGestire : richieste.recenti

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 font-[family-name:var(--font-poppins)] text-neutral-900">
            <header>
                <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">
                    Premi del <span className="text-[#FF9330]">negozio</span>
                </h1>
                <div className="mt-1 max-w-2xl text-[15px] leading-relaxed text-neutral-700">
                    Le richieste di GDO e Conferme. Consegnato chiude la richiesta; Annulla rimborsa il saldo una volta sola.
                    Immagini e personalizzazioni sono attive subito e non passano da qui, ma si possono annullare dallo storico.
                </div>
            </header>

            <div role="tablist" aria-label="Sezioni" className="flex flex-wrap gap-1">
                {([
                    ['da_gestire', `Da gestire ${richieste.daGestire.length}`],
                    ['gestite', 'Storico'],
                    ['catalogo', 'Catalogo'],
                ] as [Tab, string][]).map(([k, label]) => (
                    <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={tab === k}
                        onClick={() => setTab(k)}
                        className={`h-10 rounded-[8px] px-4 text-sm ${tab === k ? 'bg-neutral-900 font-semibold text-white' : 'font-medium text-neutral-700 hover:bg-neutral-100'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab !== 'catalogo' && (
                <section aria-label={tab === 'da_gestire' ? 'Richieste da gestire' : 'Storico'} className="rounded-[16px] bg-white">
                    {righe.length === 0 ? (
                        <div className="p-6 text-[15px] text-neutral-700">
                            {tab === 'da_gestire' ? 'Nessuna richiesta da gestire.' : 'Ancora nessuna richiesta gestita.'}
                        </div>
                    ) : (
                        <div className="divide-y-2 divide-neutral-100">
                            {righe.map(r => (
                                <div key={r.id} className="px-5 py-4">
                                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                        <div className="w-32 shrink-0 text-sm tabular-nums text-neutral-700">{dataOra(r.createdAt)}</div>
                                        <div className="w-40 shrink-0">
                                            <div className="font-medium">{r.persona}</div>
                                            <div className="text-xs text-neutral-600">{r.ruolo === 'CONFERME' ? 'Conferme' : 'GDO'}</div>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium">{r.itemNome}</div>
                                            <div className="text-xs text-neutral-600">
                                                {TIPO[r.kind] ?? r.kind}{r.giftTo ? `, regalo per ${r.giftTo}` : ''}
                                            </div>
                                        </div>
                                        <div className="w-32 shrink-0 text-right text-sm font-semibold tabular-nums">{prezzoTesto(r.currency, r.price)}</div>
                                        <div className="flex w-full flex-wrap justify-end gap-2 lg:w-[320px]">
                                            {r.status === 'annullato' && <div className="text-sm text-neutral-600">{STATO_TESTO.annullato}</div>}
                                            {r.status === 'consegnato' && annulla !== r.id && (
                                                <>
                                                    <div className="self-center text-sm text-neutral-600">Consegnato{r.handledAt ? ` il ${dataOra(r.handledAt)}` : ''}</div>
                                                    <button type="button" className={btnLinea} disabled={inCorso !== null} onClick={() => setAnnulla(r.id)}>
                                                        Annulla e rimborsa
                                                    </button>
                                                </>
                                            )}
                                            {r.status === 'richiesto' && annulla !== r.id && (
                                                <>
                                                    <button type="button" className={btnArancio} disabled={inCorso !== null} onClick={() => gestisci(r, 'consegnato')}>
                                                        {daApprovare(r.kind) ? 'Approvato e fatto' : 'Consegnato'}
                                                    </button>
                                                    <button type="button" className={btnLinea} disabled={inCorso !== null} onClick={() => setAnnulla(r.id)}>
                                                        Annulla e rimborsa
                                                    </button>
                                                </>
                                            )}
                                            {annulla === r.id && (
                                                <>
                                                    <div className="self-center text-sm">
                                                        Rimborsare {prezzoTesto(r.currency, r.price)} a {r.persona}?
                                                    </div>
                                                    <button type="button" className={btnArancio} disabled={inCorso !== null} onClick={() => gestisci(r, 'annullato')}>
                                                        {inCorso === r.id ? 'Un attimo' : 'Sì, annulla'}
                                                    </button>
                                                    <button type="button" className={btnLinea} disabled={inCorso !== null} onClick={() => setAnnulla(null)}>
                                                        No
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {msg?.id === r.id && <div role="status" className="mt-2 text-sm text-[#E70000]">{msg.testo}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {tab === 'catalogo' && (
                <section aria-label="Catalogo" className="overflow-x-auto rounded-[16px] bg-white">
                    {richieste.catalogo.length === 0 ? (
                        <div className="p-6 text-[15px] text-neutral-700">
                            Il catalogo è vuoto: si carica con scripts/diretta/negozio-catalogo.ts --apply.
                        </div>
                    ) : (
                        <table className="w-full min-w-[640px] text-sm">
                            <thead>
                                <tr className="text-left text-neutral-600">
                                    <th className="px-5 py-3 font-medium">Articolo</th>
                                    <th className="px-3 py-3 font-medium">Tipo</th>
                                    <th className="px-3 py-3 text-right font-medium">Prezzo</th>
                                    <th className="px-3 py-3 font-medium">Regalabile</th>
                                    <th className="px-5 py-3 font-medium">Stato</th>
                                </tr>
                            </thead>
                            <tbody>
                                {richieste.catalogo.map(a => (
                                    <tr key={a.id} className="border-t-2 border-neutral-100">
                                        <td className="px-5 py-3 font-medium">{a.name}</td>
                                        <td className="px-3 py-3 text-neutral-700">{TIPO[a.kind] ?? a.kind}</td>
                                        <td className="px-3 py-3 text-right tabular-nums">{numero(a.price)} {a.currency === 'P' ? 'Piume' : 'Scintille'}</td>
                                        <td className="px-3 py-3 text-neutral-700">{a.giftable ? 'Sì' : 'No'}</td>
                                        <td className="px-5 py-3 text-neutral-700">{a.isActive ? 'In vendita' : 'Spento'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>
            )}

            <section aria-label="Pagina Squadra" className="rounded-[16px] bg-white p-5 sm:p-6">
                <h2 className="text-lg font-semibold">Pagina Squadra</h2>
                <div className="mt-1 text-sm text-neutral-700">Come si vede la classifica della settimana a GDO e Conferme con la Rinascita accesa.</div>
                <div className="mt-4 flex flex-col gap-2">
                    {MODALITA.map(m => (
                        <label key={m.value} className={`flex cursor-pointer items-start gap-3 rounded-[8px] border-2 px-4 py-3 ${mode === m.value ? 'border-neutral-900' : 'border-neutral-100 hover:border-neutral-300'}`}>
                            <input
                                type="radio"
                                name="leaderboard_mode"
                                className="mt-1 h-4 w-4 accent-[#FF9330]"
                                checked={mode === m.value}
                                onChange={() => cambiaModo(m.value)}
                            />
                            <span className="block">
                                <span className="block font-medium">{m.titolo}</span>
                                <span className="block text-sm text-neutral-700">{m.testo}</span>
                            </span>
                        </label>
                    ))}
                </div>
                {modeMsg && <div role="status" className="mt-3 text-sm text-neutral-700">{modeMsg}</div>}
            </section>
        </div>
    )
}
