"use client"

// Negozio della Diretta (/store per GDO e Conferme con l'interruttore acceso).
// Il prezzo si scala solo sul server (buyReward, in transazione); qui c'è la
// conferma in due passi e un id di richiesta che rende innocuo il doppio clic.

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    CalendarOff, Clapperboard, Clock, Coffee, Cookie, Flame, Frame, Gift, GraduationCap, Headphones, Music, Shield,
    ShoppingBag, Timer, Type, UserCheck, UtensilsCrossed, Zap,
    type LucideIcon,
} from "lucide-react"
import { buyReward, setProfileImage, type NegozioArticolo, type NegozioView } from "@/app/actions/negozioActions"
import { daApprovare, GIFT_TO_MAX, isDigitale, isPotenziamento, SOLO_REGALO } from "@/lib/diretta/negozio"
import { numeroIt, oraRoma } from "@/lib/diretta/formato"
import { AvatarDiretta, STATO_TESTO, TitoloDiretta, btn, dataBreve, numero, prezzoTesto } from "./ui"
import { PostazioneDiretta } from "./PostazioneDiretta"

const ICONE: Record<string, LucideIcon> = {
    'corso-fenice-academy': GraduationCap,
    'sabato-libero': CalendarOff,
    'booster-fissati': Zap,
    'moltiplicatore-presenza': UserCheck,
    'scudo-serie': Shield,
    'pausa-quando-vuoi': Timer,
    'spotify-o-netflix': Music,
    'cinema-per-due': Clapperboard,
    'buono-amazon-10': ShoppingBag,
    'buono-amazon-25': ShoppingBag,
    'caffe-per-un-collega': Gift,
    'mezza-giornata-venditore': Headphones,
    'uscita-30-minuti': Clock,
    'merenda-sala': Cookie,
    'pranzo-offerto': UtensilsCrossed,
    'caffe-cornetto': Coffee,
    'cornice-fenice': Frame,
    'titolo-voce-della-sala': Type,
}

function nuovoId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
}

interface Conferma { itemId: string; requestId: string; regalo: boolean; nome: string }
interface Esito { itemId: string; ok: boolean; testo: string }

export function NegozioDiretta({ view }: { view: NegozioView }) {
    const router = useRouter()
    const [saldo, setSaldo] = useState({ scintille: view.scintille, piume: view.piume })
    const [inUso, setInUso] = useState<string | null>(view.profileImageUrl)
    const [conferma, setConferma] = useState<Conferma | null>(null)
    const [inCorso, setInCorso] = useState<string | null>(null)
    const [esito, setEsito] = useState<Esito | null>(null)

    // Dopo router.refresh() arrivano i dati nuovi dal server: si allinea.
    useEffect(() => { setSaldo({ scintille: view.scintille, piume: view.piume }) }, [view.scintille, view.piume])
    useEffect(() => { setInUso(view.profileImageUrl) }, [view.profileImageUrl])

    const corso = view.articoli.find(a => a.kind === 'corso')
    const premi = view.articoli.filter(a => a.kind === 'concreto' || a.kind === 'permesso')
    const potenziamenti = view.articoli.filter(a => isPotenziamento(a.kind))
    const postazione = view.articoli.filter(a => a.kind === 'postazione')
    const boosterFino = view.boosterFino ? new Date(view.boosterFino) : null
    const serie = view.serie
    const immagini = view.articoli.filter(a => a.kind === 'immagine')
    const personalizzazioni = view.articoli.filter(a => a.kind === 'personalizzazione')
    const ultime = view.acquisti.slice(0, 5)

    const disponibile = (a: NegozioArticolo) => (a.currency === 'S' ? saldo.scintille : saldo.piume)

    const apri = (a: NegozioArticolo) => {
        setEsito(null)
        setConferma({ itemId: a.id, requestId: nuovoId(), regalo: SOLO_REGALO.has(a.id), nome: '' })
    }

    const compra = async (a: NegozioArticolo) => {
        if (!conferma || conferma.itemId !== a.id || inCorso) return
        const giftTo = conferma.regalo ? conferma.nome : null
        setInCorso(a.id)
        try {
            const r = await buyReward(a.id, giftTo, conferma.requestId)
            if (r.ok) {
                setSaldo({ scintille: r.scintille, piume: r.piume })
                setConferma(null)
                setEsito({
                    itemId: a.id, ok: true,
                    testo: r.status === 'consegnato'
                        ? (a.kind === 'immagine' ? 'Fatto, è tua. Puoi usarla subito come immagine profilo.'
                            : a.kind === 'booster' ? 'Booster attivo: per un\'ora i tuoi fissati valgono doppio.'
                                : a.kind === 'moltiplicatore' ? 'Moltiplicatore attivo fino a fine giornata: ora conta chi si presenta.'
                                    : a.kind === 'scudo' ? 'Scudo da parte: salva il primo giorno che manchi.' : 'Fatto, è già attiva.')
                        : 'Richiesta inviata. Ti arriva una notifica quando è pronta.',
                })
                // Per chi mostra il saldo altrove (barra in alto).
                window.dispatchEvent(new CustomEvent('diretta:saldo', { detail: { scintille: r.scintille, piume: r.piume } }))
                router.refresh()
            } else {
                setEsito({ itemId: a.id, ok: false, testo: r.error })
            }
        } catch {
            setEsito({ itemId: a.id, ok: false, testo: 'Connessione assente. Riprova tra poco.' })
        } finally {
            setInCorso(null)
        }
    }

    const usaImmagine = async (a: NegozioArticolo) => {
        if (inCorso) return
        setInCorso(a.id)
        try {
            const r = await setProfileImage(a.id)
            if (r.ok) {
                setInUso(a.imageUrl)
                setEsito({ itemId: a.id, ok: true, testo: 'Ora è la tua immagine profilo.' })
                router.refresh()
            } else {
                setEsito({ itemId: a.id, ok: false, testo: r.error })
            }
        } catch {
            setEsito({ itemId: a.id, ok: false, testo: 'Connessione assente. Riprova tra poco.' })
        } finally {
            setInCorso(null)
        }
    }

    /** Pulsante o stato a destra dell'articolo. */
    const azione = (a: NegozioArticolo) => {
        if (a.kind === 'booster' && boosterFino) {
            return <div className="text-sm font-semibold text-[var(--d-orange)]">Attivo fino alle {oraRoma(boosterFino)}</div>
        }
        if (a.kind === 'moltiplicatore' && view.moltiplicatoreOggi) {
            return <div className="text-sm font-semibold text-[var(--d-orange)]">Attivo fino a fine giornata</div>
        }
        if (a.kind === 'scudo' && serie) {
            if (serie.scudiInTasca > 0) return <div className="text-sm font-semibold text-[var(--d-orange)]">Da parte</div>
            if (serie.scudiMese >= serie.scudiAlMese) return <div className="text-sm text-[var(--d-muted)]">Finiti per questo mese</div>
        }
        if (a.posseduto && isDigitale(a.kind)) {
            if (a.kind === 'immagine') {
                if (a.imageUrl && inUso === a.imageUrl) return <div className="text-sm font-medium text-[var(--d-muted)]">In uso</div>
                return (
                    <button type="button" className={btn.chiaro} disabled={inCorso === a.id} onClick={() => usaImmagine(a)}>
                        Usala
                    </button>
                )
            }
            return <div className="text-sm font-medium text-[var(--d-muted)]">Attiva</div>
        }
        if (conferma?.itemId === a.id) return null
        const manca = a.price - disponibile(a)
        if (manca > 0) {
            return <div className="text-sm text-[var(--d-muted)]">Ti {manca === 1 ? 'manca' : 'mancano'} {prezzoTesto(a.currency, manca)}</div>
        }
        return (
            <button type="button" className={btn.linea} onClick={() => apri(a)}>
                {isPotenziamento(a.kind) ? 'Attiva' : isDigitale(a.kind) ? 'Prendi' : SOLO_REGALO.has(a.id) ? 'Offri' : 'Richiedi'}
            </button>
        )
    }

    /** Conferma in due passi ed esito, sotto l'articolo. */
    const dettaglio = (a: NegozioArticolo) => (
        <>
            {conferma?.itemId === a.id && (
                <div className="mt-3 flex flex-col gap-3 rounded-[8px] border-2 border-[var(--d-line)] p-4">
                    <div className="text-sm leading-relaxed">
                        Scali <span className="font-semibold">{prezzoTesto(a.currency, a.price)}</span>
                        {daApprovare(a.kind) ? '. Se non si può approvare, tornano nel saldo.' : '.'}
                    </div>
                    {SOLO_REGALO.has(a.id) && (
                        <label className="flex flex-col gap-1.5 text-sm">
                            A chi lo offri
                            <input
                                type="text"
                                maxLength={GIFT_TO_MAX}
                                value={conferma.nome}
                                onChange={e => setConferma({ ...conferma, nome: e.target.value })}
                                placeholder="Nome del collega"
                                className="h-10 w-full max-w-sm rounded-[8px] border-2 border-[var(--d-line)] bg-transparent px-3 text-sm text-[var(--d-text)] placeholder:text-[var(--d-faint)] focus:border-[var(--d-muted)] focus:outline-none"
                            />
                        </label>
                    )}
                    {a.giftable && !SOLO_REGALO.has(a.id) && (
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-[var(--d-orange)]"
                                    checked={conferma.regalo}
                                    onChange={e => setConferma({ ...conferma, regalo: e.target.checked })}
                                />
                                È un regalo
                            </label>
                            {conferma.regalo && (
                                <input
                                    type="text"
                                    maxLength={GIFT_TO_MAX}
                                    value={conferma.nome}
                                    onChange={e => setConferma({ ...conferma, nome: e.target.value })}
                                    placeholder="Nome e cognome di chi lo riceve"
                                    className="h-10 w-full max-w-sm rounded-[8px] border-2 border-[var(--d-line)] bg-transparent px-3 text-sm text-[var(--d-text)] placeholder:text-[var(--d-faint)] focus:border-[var(--d-muted)] focus:outline-none"
                                />
                            )}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={btn.primario}
                            disabled={inCorso === a.id || (conferma.regalo && !conferma.nome.trim())}
                            onClick={() => compra(a)}
                        >
                            {inCorso === a.id ? 'Un attimo' : 'Conferma'}
                        </button>
                        <button type="button" className={btn.linea} disabled={inCorso === a.id} onClick={() => setConferma(null)}>
                            Annulla
                        </button>
                    </div>
                </div>
            )}
            {esito?.itemId === a.id && (
                <div role="status" className={`mt-2 text-sm ${esito.ok ? 'text-[var(--d-text)]' : 'text-[var(--d-orange)]'}`}>
                    {esito.testo}
                </div>
            )}
        </>
    )

    const riga = (a: NegozioArticolo, prefisso: ReactNode) => (
        <div key={a.id} className="py-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:flex-nowrap">
                {prefisso}
                <div className="min-w-0 flex-1">
                    <div className="font-medium">{a.name}</div>
                    {a.description && <div className="mt-0.5 text-sm leading-relaxed text-[var(--d-muted)]">{a.description}</div>}
                </div>
                <div className="shrink-0 sm:text-right">
                    <div className="font-semibold tabular-nums">{prezzoTesto(a.currency, a.price)}</div>
                    {daApprovare(a.kind) && <div className="text-xs text-[var(--d-muted)]">Da approvare</div>}
                </div>
                <div className="flex w-full shrink-0 sm:w-auto sm:justify-end">{azione(a)}</div>
            </div>
            {dettaglio(a)}
        </div>
    )

    const icona = (a: NegozioArticolo) => {
        const Icon = ICONE[a.id] ?? Gift
        return <Icon className="hidden h-5 w-5 shrink-0 text-[var(--d-muted)] sm:block" strokeWidth={1.5} aria-hidden="true" />
    }

    const pctCorso = corso ? Math.min(100, Math.round((saldo.piume / corso.price) * 100)) : 0

    return (
        <div className="flex flex-col gap-10">
            <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-xl">
                    <TitoloDiretta prima="Il" accento="negozio" />
                    <div className="mt-2 text-[15px] leading-relaxed text-[var(--d-muted)]">
                        {view.ruolo === 'CONFERME'
                            ? 'Le Scintille arrivano dalle tue conferme, di più quando il lead si presenta; le Piume dagli obiettivi della settimana su presenze e chiusure.'
                            : 'Le Scintille arrivano dagli appuntamenti fissati, le Piume da conferme, presenze e chiusure dei tuoi lead.'}
                        {' '}Le Piume servono per il corso, le Scintille per tutti gli altri premi.
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:w-[360px]">
                    <div className="rounded-[16px] bg-[var(--d-surface)] px-4 py-3">
                        <div className="text-sm text-[var(--d-muted)]">Scintille</div>
                        <div className="text-[28px] font-semibold leading-tight tabular-nums">{numero(saldo.scintille)}</div>
                    </div>
                    <div className="rounded-[16px] bg-[var(--d-surface)] px-4 py-3">
                        <div className="text-sm text-[var(--d-muted)]">Piume</div>
                        <div className="text-[28px] font-semibold leading-tight tabular-nums">{numero(saldo.piume)}</div>
                    </div>
                </div>
            </header>

            {/* Collaudo del 25/10/2026: senza spiegazione il negozio non si capiva. */}
            <details className="group rounded-[16px] bg-[var(--d-surface)] p-5 sm:p-6" open={saldo.scintille === 0 && saldo.piume === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold">
                    Come funziona
                    <span className="text-sm font-medium text-[var(--d-muted)] group-open:hidden">Apri</span>
                    <span className="hidden text-sm font-medium text-[var(--d-muted)] group-open:inline">Chiudi</span>
                </summary>
                <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
                    {view.comeFunziona.map(b => (
                        <div key={b.titolo}>
                            <h3 className="text-[15px] font-semibold">{b.titolo}</h3>
                            <ul className="mt-1.5 flex flex-col gap-1.5">
                                {b.righe.map(r => (
                                    <li key={r} className="text-sm leading-relaxed text-[var(--d-muted)]">{r}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </details>

            {view.articoli.length === 0 && (
                <div className="text-[15px] text-[var(--d-muted)]">Il catalogo arriva a breve: i premi compaiono qui appena sono pronti.</div>
            )}

            {corso && (
                <section aria-label={corso.name} className="rounded-[16px] bg-[var(--d-surface)] p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 gap-4">
                            <GraduationCap className="mt-1 hidden h-6 w-6 shrink-0 text-[var(--d-orange)] sm:block" strokeWidth={1.5} aria-hidden="true" />
                            <div className="min-w-0">
                                <h2 className="text-xl font-semibold">{corso.name}</h2>
                                {corso.description && <div className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--d-muted)]">{corso.description}</div>}
                            </div>
                        </div>
                        <div className="shrink-0">
                            <div className="text-[28px] font-semibold leading-tight tabular-nums">{numero(corso.price)}</div>
                            <div className="text-sm text-[var(--d-muted)]">Piume</div>
                        </div>
                    </div>
                    <div className="mt-5">
                        <div className="h-2 overflow-hidden rounded-[4px] bg-[var(--d-line)]" aria-hidden="true">
                            <div className="h-full bg-[var(--d-orange)]" style={{ width: `${pctCorso}%` }} />
                        </div>
                        <div className="mt-2 text-sm text-[var(--d-muted)]">
                            {saldo.piume >= corso.price ? (
                                <>Hai <span className="font-semibold text-[var(--d-text)] tabular-nums">{numero(saldo.piume)}</span> Piume: bastano per il corso.</>
                            ) : (
                                <>
                                    Hai <span className="font-semibold text-[var(--d-text)] tabular-nums">{numero(saldo.piume)}</span> Piume
                                    su {numero(corso.price)}: {corso.price - saldo.piume === 1 ? 'ne manca 1' : `ne mancano ${numero(corso.price - saldo.piume)}`}.
                                </>
                            )}
                        </div>
                    </div>
                    {saldo.piume >= corso.price && <div className="mt-4 flex">{azione(corso)}</div>}
                    {dettaglio(corso)}
                </section>
            )}

            {potenziamenti.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold">Potenziamenti</h2>
                    {serie && (
                        <div className="mt-1 flex items-center gap-2 text-sm text-[var(--d-muted)]">
                            <Flame className={`h-4 w-4 shrink-0 ${serie.giorni > 0 ? 'text-[var(--d-orange)]' : ''}`} strokeWidth={2} aria-hidden="true" />
                            <div>
                                La tua serie: <span className="font-semibold text-[var(--d-text)]">{numeroIt(serie.giorni)} {serie.giorni === 1 ? 'giorno' : 'giorni'}</span>
                                {serie.prossima ? `, prossima tappa a ${numeroIt(serie.prossima.giorni)}.` : '.'}
                                {' '}Scudi presi questo mese: {numeroIt(serie.scudiMese)} su {numeroIt(serie.scudiAlMese)}.
                            </div>
                        </div>
                    )}
                    <div className="mt-1 divide-y-2 divide-[var(--d-surface)]">
                        {potenziamenti.map(a => riga(a, icona(a)))}
                    </div>
                </section>
            )}

            {premi.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold">Premi</h2>
                    <div className="mt-1 divide-y-2 divide-[var(--d-surface)]">
                        {premi.map(a => riga(a, icona(a)))}
                    </div>
                </section>
            )}

            {postazione.length > 0 && (
                <PostazioneDiretta
                    articoli={postazione}
                    acquisti={view.acquisti}
                    azione={a => (a.posseduto ? null : azione(a))}
                    dettaglio={dettaglio}
                />
            )}

            {immagini.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold">Immagini profilo</h2>
                    <div className="mt-1 text-sm text-[var(--d-muted)]">Si vedono accanto al tuo nome nella squadra e nel profilo.</div>
                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
                        {immagini.map(a => (
                            <div key={a.id} className="flex min-w-0 flex-col">
                                {a.imageUrl && (
                                    <img
                                        src={a.imageUrl}
                                        alt={a.name}
                                        width={512}
                                        height={512}
                                        loading="lazy"
                                        decoding="async"
                                        className="aspect-square w-full rounded-[16px] object-cover"
                                    />
                                )}
                                <div className="mt-3 font-medium">{a.name}</div>
                                {a.description && <div className="mt-0.5 text-xs leading-relaxed text-[var(--d-muted)]">{a.description}</div>}
                                <div className="mt-1 text-sm font-semibold tabular-nums">{a.posseduto ? 'Tua' : prezzoTesto(a.currency, a.price)}</div>
                                <div className="mt-3 flex">{azione(a)}</div>
                                {dettaglio(a)}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {personalizzazioni.length > 0 && (
                <section>
                    <h2 className="text-lg font-semibold">Personalizzazioni</h2>
                    <div className="mt-1 divide-y-2 divide-[var(--d-surface)]">
                        {personalizzazioni.map(a => riga(a, a.id.startsWith('cornice')
                            ? <div className="hidden p-[2px] sm:block"><AvatarDiretta nome={view.nome} immagine={inUso} cornice size={36} /></div>
                            : icona(a)))}
                    </div>
                </section>
            )}

            <section>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold">Le tue richieste</h2>
                    {view.acquisti.length > ultime.length && (
                        <Link href="/profilo" className="text-sm font-medium text-[var(--d-muted)] underline underline-offset-4 hover:text-[var(--d-text)]">
                            Tutto lo storico nel profilo
                        </Link>
                    )}
                </div>
                {ultime.length === 0 ? (
                    <div className="mt-2 text-sm text-[var(--d-muted)]">Ancora nessuna. Quando prendi qualcosa, la trovi qui.</div>
                ) : (
                    <div className="mt-1 divide-y-2 divide-[var(--d-surface)]">
                        {ultime.map(p => (
                            <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                                <div className="w-16 shrink-0 text-[var(--d-muted)] tabular-nums">{dataBreve(p.createdAt)}</div>
                                <div className="min-w-0 flex-1">
                                    <span className="font-medium">{p.nome}</span>
                                    {p.giftTo && <span className="text-[var(--d-muted)]">, per {p.giftTo}</span>}
                                </div>
                                <div className="tabular-nums">{prezzoTesto(p.currency, p.price)}</div>
                                <div className={`w-44 shrink-0 sm:text-right ${p.status === 'richiesto' ? 'font-medium text-[var(--d-text)]' : 'text-[var(--d-muted)]'}`}>
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
