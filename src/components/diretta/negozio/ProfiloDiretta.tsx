"use client"

// Profilo semplice della Diretta (/profilo per GDO e Conferme con
// l'interruttore acceso): nome, immagine scelta tra quelle comprate, saldo e
// storico del negozio. Creature, avventura, scambi e quest non ci sono più.
// Ci si arriva dall'avatar della barra in alto; al GDO porta anche allo
// storico delle pause.

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { setProfileImage, type NegozioView } from "@/app/actions/negozioActions"
import { AvatarDiretta, STATO_TESTO, TitoloDiretta, btn, dataBreve, numero, prezzoTesto } from "./ui"

export function ProfiloDiretta({ view }: { view: NegozioView }) {
    const router = useRouter()
    const [inUso, setInUso] = useState<string | null>(view.profileImageUrl)
    const [inCorso, setInCorso] = useState<string | null>(null)
    const [errore, setErrore] = useState<string | null>(null)

    useEffect(() => { setInUso(view.profileImageUrl) }, [view.profileImageUrl])

    // Immagini possedute: una per articolo, anche se nel frattempo è uscita dal negozio.
    const immagini = view.acquisti
        .filter(p => p.kind === 'immagine' && p.status !== 'annullato' && p.imageUrl)
        .filter((p, i, all) => all.findIndex(q => q.itemId === p.itemId) === i)

    const scegli = async (itemId: string | null, imageUrl: string | null) => {
        if (inCorso) return
        setInCorso(itemId ?? 'nessuna')
        setErrore(null)
        try {
            const r = await setProfileImage(itemId)
            if (r.ok) {
                setInUso(imageUrl)
                router.refresh()
            } else {
                setErrore(r.error)
            }
        } catch {
            setErrore('Connessione assente. Riprova tra poco.')
        } finally {
            setInCorso(null)
        }
    }

    return (
        <div className="flex flex-col gap-10">
            <TitoloDiretta prima="Il tuo" accento="profilo" />

            <section aria-label="Chi sei" className="flex flex-wrap items-center gap-x-8 gap-y-6">
                <div className="flex items-center gap-5">
                    <div className="p-[2px]">
                        <AvatarDiretta nome={view.nome} immagine={inUso} cornice={view.stile.cornice} size={96} />
                    </div>
                    <div className="min-w-0">
                        <div className="text-[28px] font-semibold leading-tight">{view.nome}</div>
                        {view.stile.titolo && <div className="mt-1 text-[15px] text-[var(--d-muted)]">{view.stile.titolo}</div>}
                        {/* Nella barra in alto della Diretta lo storico delle pause non ha una voce: si apre da qui. */}
                        {view.ruolo === 'GDO' && (
                            <Link href="/storico-pause" className="mt-2 inline-block text-sm font-medium text-[var(--d-muted)] underline underline-offset-4 hover:text-[var(--d-text)]">
                                Storico delle pause
                            </Link>
                        )}
                    </div>
                </div>
                <div className="grid w-full grid-cols-2 gap-3 sm:ml-auto sm:w-[360px]">
                    <div className="rounded-[16px] bg-[var(--d-surface)] px-4 py-3">
                        <div className="text-sm text-[var(--d-muted)]">Scintille</div>
                        <div className="text-[28px] font-semibold leading-tight tabular-nums">{numero(view.scintille)}</div>
                    </div>
                    <div className="rounded-[16px] bg-[var(--d-surface)] px-4 py-3">
                        <div className="text-sm text-[var(--d-muted)]">Piume</div>
                        <div className="text-[28px] font-semibold leading-tight tabular-nums">{numero(view.piume)}</div>
                    </div>
                </div>
            </section>

            <section aria-label="Immagine profilo">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold">Immagine profilo</h2>
                    <Link href="/store" className="text-sm font-medium text-[var(--d-muted)] underline underline-offset-4 hover:text-[var(--d-text)]">
                        Altre immagini nel negozio
                    </Link>
                </div>
                {immagini.length === 0 ? (
                    <div className="mt-2 text-[15px] text-[var(--d-muted)]">
                        Non hai ancora immagini. Le trovi nel negozio, con le Scintille.
                    </div>
                ) : (
                    <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-7">
                        {immagini.map(p => {
                            const attiva = inUso === p.imageUrl
                            return (
                                <button
                                    key={p.itemId}
                                    type="button"
                                    onClick={() => scegli(p.itemId, p.imageUrl)}
                                    disabled={attiva || inCorso !== null}
                                    aria-pressed={attiva}
                                    className="group flex min-w-0 flex-col items-start text-left disabled:cursor-default"
                                >
                                    <img
                                        src={p.imageUrl!}
                                        alt=""
                                        width={512}
                                        height={512}
                                        loading="lazy"
                                        decoding="async"
                                        className={`aspect-square w-full rounded-[16px] object-cover ${attiva ? 'outline outline-2 outline-offset-2 outline-[var(--d-orange)]' : 'opacity-80 group-hover:opacity-100'}`}
                                    />
                                    <span className="mt-2 block w-full truncate text-sm font-medium">{p.nome}</span>
                                    <span className="block text-xs text-[var(--d-muted)]">{attiva ? 'In uso' : 'Usa questa'}</span>
                                </button>
                            )
                        })}
                    </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    {inUso && (
                        <button type="button" className={btn.linea} disabled={inCorso !== null} onClick={() => scegli(null, null)}>
                            Togli l&apos;immagine
                        </button>
                    )}
                    {errore && <div role="status" className="text-sm text-[var(--d-orange)]">{errore}</div>}
                </div>
            </section>

            <section aria-label="Storico del negozio">
                <h2 className="text-lg font-semibold">Storico del negozio</h2>
                {view.acquisti.length === 0 ? (
                    <div className="mt-2 text-[15px] text-[var(--d-muted)]">Ancora nessun acquisto.</div>
                ) : (
                    <div className="mt-1 divide-y-2 divide-[var(--d-surface)]">
                        {view.acquisti.map(p => (
                            <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                                <div className="w-16 shrink-0 text-[var(--d-muted)] tabular-nums">{dataBreve(p.createdAt)}</div>
                                <div className="min-w-0 flex-1">
                                    <span className="font-medium">{p.nome}</span>
                                    {p.giftTo && <span className="text-[var(--d-muted)]">, per {p.giftTo}</span>}
                                </div>
                                <div className="tabular-nums">{prezzoTesto(p.currency, p.price)}</div>
                                <div className={`w-44 shrink-0 sm:text-right ${p.status === 'richiesto' ? 'font-medium' : 'text-[var(--d-muted)]'}`}>
                                    {STATO_TESTO[p.status]}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}
