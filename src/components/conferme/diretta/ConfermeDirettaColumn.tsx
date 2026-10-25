"use client"

// Colonna arancione delle Conferme nella Diretta (PO 25/10/2026): i numeri del
// giorno di chi guarda, gli obiettivi individuali se impostati, la squadra verso
// la soglia del bonus e il saldo Scintille e Piume. Sull'arancione il testo è nero.
//
// Aggiornamento: al montaggio, poi ogni 30 secondi solo a scheda visibile (al
// ritorno sulla scheda, se l'ultimo giro è più vecchio di 20 secondi). I numeri
// lato server hanno una cache di 20 secondi; la conferma appena salvata dal
// drawer si conta subito (evento CONFERMATO_EVENT) e si toglie quando il server
// la vede o dopo due minuti.

import { useCallback, useEffect, useRef, useState } from "react"
import { getConfermeDirettaStats, type ConfermeDirettaStats } from "@/app/actions/confermeDirettaActions"
import { CONFERMATO_EVENT, confermeOggiConOttimistiche } from "@/lib/conferme/direttaStats"
import { formatEuro } from "./ui"

const POLL_MS = 30_000
const MIN_GAP_MS = 20_000
const OTTIMISTICA_TTL_MS = 120_000
/** Oltre questa soglia la squadra si disegna come barra continua invece che a blocchi. */
const MAX_BLOCCHI = 40

const UNITA = {
    chiusure: { una: 'chiusura', tante: 'chiusure' },
    presenze: { una: 'presenza', tante: 'presenze' },
} as const

function etichettaPeriodo(stats: ConfermeDirettaStats): string {
    if (stats.squadra.periodo === 'settimana') return 'della settimana'
    const mese = new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'Europe/Rome' })
        .format(new Date(stats.squadra.periodoInizio))
    return `di ${mese}`
}

function Riga({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-4 border-t-2 border-[var(--d-orange-ink)]/20 py-2.5 first:border-t-0">
            <dt className="text-[15px]">{label}</dt>
            <dd className="text-xl font-semibold">{value}</dd>
        </div>
    )
}

function Blocchi({ pieni, totale }: { pieni: number; totale: number }) {
    if (totale <= 0) return null
    if (totale > MAX_BLOCCHI) {
        const pct = Math.min(100, Math.round((pieni / totale) * 100))
        return (
            <div aria-hidden="true" className="mt-3 h-5 w-full rounded border-2 border-[var(--d-orange-ink)]">
                <div className="h-full bg-[var(--d-orange-ink)]" style={{ width: `${pct}%` }} />
            </div>
        )
    }
    const colonne = totale <= 20 ? totale : Math.ceil(totale / 2)
    return (
        <div aria-hidden="true" className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${colonne}, minmax(0, 1fr))` }}>
            {Array.from({ length: totale }, (_, i) => (
                <div
                    key={i}
                    className={`h-5 rounded ${i < pieni ? 'bg-[var(--d-orange-ink)]' : 'border-2 border-[var(--d-orange-ink)]'}`}
                />
            ))}
        </div>
    )
}

export function ConfermeDirettaColumn() {
    const [stats, setStats] = useState<ConfermeDirettaStats | null>(null)
    const [errore, setErrore] = useState(false)
    // Lead confermati dal drawer e non ancora visti dal server: id → istante.
    const [ottimistiche, setOttimistiche] = useState<Map<string, number>>(() => new Map())
    const lastFetch = useRef(0)
    const inFlight = useRef(false)

    const load = useCallback(async () => {
        if (inFlight.current) return
        inFlight.current = true
        lastFetch.current = Date.now()
        try {
            const s = await getConfermeDirettaStats()
            setStats(s)
            setErrore(false)
            const visti = new Set(s.personali.confermeOggiIds)
            const limite = Date.now() - OTTIMISTICA_TTL_MS
            setOttimistiche(prev => {
                if (prev.size === 0) return prev
                const next = new Map<string, number>()
                prev.forEach((at, id) => { if (!visti.has(id) && at > limite) next.set(id, at) })
                return next
            })
        } catch {
            setErrore(true)
        } finally {
            inFlight.current = false
        }
    }, [])

    useEffect(() => {
        void load()
        const tick = () => {
            if (document.hidden) return
            if (Date.now() - lastFetch.current >= MIN_GAP_MS) void load()
        }
        const interval = setInterval(tick, POLL_MS)
        document.addEventListener('visibilitychange', tick)
        return () => {
            clearInterval(interval)
            document.removeEventListener('visibilitychange', tick)
        }
    }, [load])

    useEffect(() => {
        const onConfermato = (e: Event) => {
            const leadId = (e as CustomEvent<{ leadId?: string }>).detail?.leadId
            if (!leadId) return
            setOttimistiche(prev => new Map(prev).set(leadId, Date.now()))
        }
        window.addEventListener(CONFERMATO_EVENT, onConfermato)
        return () => window.removeEventListener(CONFERMATO_EVENT, onConfermato)
    }, [])

    if (!stats) {
        return (
            <aside aria-label="La tua giornata e la squadra" aria-busy={!errore} className="flex min-h-full flex-col gap-4 bg-[var(--d-orange)] px-8 py-9 text-[var(--d-orange-ink)]">
                <div className="text-base font-medium">Oggi hai confermato</div>
                {errore && <div className="text-[15px]">Numeri non disponibili, riprovo tra poco.</div>}
            </aside>
        )
    }

    const { personali, squadra, obiettivi, saldo } = stats
    const conferme = confermeOggiConOttimistiche(personali.confermeOggiIds, ottimistiche.keys())
    const u = UNITA[squadra.unita]
    const target = obiettivi?.confermeGiorno ?? null

    let fraseSquadra: string
    if (squadra.oltre > 0) {
        fraseSquadra = `${squadra.oltre} oltre la soglia: ${formatEuro(squadra.euro)} maturati.`
    } else if (squadra.mancano === 1) {
        fraseSquadra = `Ne manca 1 alla prima da ${formatEuro(squadra.euroPerUnita)}.`
    } else {
        fraseSquadra = `Ne mancano ${squadra.mancano} alla prima da ${formatEuro(squadra.euroPerUnita)}.`
    }

    const righeObiettivi: { label: string; value: string }[] = []
    if (obiettivi?.presenzeSettimana) {
        righeObiettivi.push({ label: 'Presenze della settimana', value: `${personali.presenzeSettimana} su ${obiettivi.presenzeSettimana}` })
    }
    if (obiettivi?.chiusureMese) {
        righeObiettivi.push({ label: 'Chiusure del mese', value: `${personali.chiusureMese} su ${obiettivi.chiusureMese}` })
    }

    return (
        <aside aria-label="La tua giornata e la squadra" className="flex min-h-full flex-col gap-7 bg-[var(--d-orange)] px-8 py-9 text-[var(--d-orange-ink)]">
            <section aria-label="Le tue conferme di oggi">
                <h2 className="text-base font-medium">Oggi hai confermato</h2>
                <div className="mt-2 text-[160px] font-semibold leading-[0.9] tracking-[-0.04em]">{conferme}</div>
                <div className="mt-3 text-xl">
                    {conferme === 1 ? 'appuntamento' : 'appuntamenti'}
                    {target ? <> su <span className="font-semibold">{target}</span></> : null}.
                </div>
            </section>

            <dl aria-label="Presenze e chiusure di oggi">
                <Riga label="Presenze di oggi" value={String(personali.presenzeOggi)} />
                <Riga label="Chiusure di oggi" value={String(personali.chiusureOggi)} />
                {righeObiettivi.map(r => <Riga key={r.label} label={r.label} value={r.value} />)}
            </dl>

            <div className="h-0.5 bg-[var(--d-orange-ink)] opacity-20" />

            <section aria-label="Bonus di squadra">
                <h2 className="text-base font-medium">Bonus di squadra</h2>
                <div className="mt-1 text-[44px] font-semibold leading-tight">
                    {squadra.conteggio} <span className="text-2xl font-normal">su {squadra.soglia}</span>
                </div>
                <div className="text-[15px]">{u.tante} {etichettaPeriodo(stats)}</div>
                <Blocchi pieni={Math.min(squadra.conteggio, squadra.soglia)} totale={squadra.soglia} />
                <div className="mt-3 text-[15px] font-semibold">{fraseSquadra}</div>
                <div className="mt-1 text-[13px]">
                    Dalla {squadra.soglia + 1}ª {u.una} in poi, {formatEuro(squadra.euroPerUnita)} per ognuna.
                </div>
            </section>

            <div className="h-0.5 bg-[var(--d-orange-ink)] opacity-20" />

            <dl aria-label="Il tuo saldo">
                <Riga label="Scintille" value={saldo.scintille.toLocaleString('it-IT')} />
                <Riga label="Piume" value={saldo.piume.toLocaleString('it-IT')} />
            </dl>
        </aside>
    )
}
