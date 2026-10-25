"use client"

// Numeri vivi della home Diretta.
//
// Carico contenuto: al massimo un aggiornamento ogni 25 secondi, e solo con la
// scheda visibile; in più, con un minimo di 10 secondi fra due richieste,
// sull'evento window `realtime_update` (notifiche in arrivo). Il server tiene
// in cache i dati di squadra per 15 secondi.
//
// Momento appuntamento: all'evento `diretta_appointment` (emesso solo dopo
// l'ok del server) il contatore avanza subito di uno, e si chiede il dato
// vero. Finché il dato di squadra in cache non ha visto l'appuntamento, un
// "pavimento" impedisce ai numeri di tornare indietro.

import { useCallback, useEffect, useRef, useState } from "react"
import { getDirettaLive, type DirettaLive } from "@/app/actions/direttaActions"
import { DIRETTA_APPUNTAMENTO, deltaAppuntamento } from "@/lib/diretta/eventi"
import { conPavimento, tipoMomento } from "@/lib/diretta/home"

const OGNI_MS = 25_000
const DISTANZA_MINIMA_MS = 10_000
const PAVIMENTO_MS = 45_000

type Pavimento = { valore: number; fino: number } | null

export interface Momento {
    chiave: number
    n: number
    tipo: 'semplice' | 'scalino' | 'pieno'
    inPunta: boolean
}

export function useDirettaLive() {
    const [live, setLive] = useState<DirettaLive | null>(null)
    const [pav, setPav] = useState<{ mia: Pavimento; squadra: Pavimento; punta: Pavimento }>({ mia: null, squadra: null, punta: null })
    const [momento, setMomento] = useState<Momento | null>(null)
    const [, setBattito] = useState(0)

    const inVolo = useRef(false)
    const ancora = useRef(false)
    const ultimaRichiesta = useRef(0)
    const ultimoAppuntamento = useRef(0)
    const differita = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Ultimi dati e ultimi valori mostrati: l'avanzamento parte dal numero a schermo.
    const liveRef = useRef<DirettaLive | null>(null)
    const mostrati = useRef({ mia: 0, squadra: 0, punta: 0 })

    const carica = useCallback(async () => {
        if (typeof document !== 'undefined' && document.hidden) return
        if (inVolo.current) { ancora.current = true; return }
        inVolo.current = true
        const partita = Date.now()
        ultimaRichiesta.current = partita
        try {
            const dati = await getDirettaLive()
            if (dati) {
                setLive(dati)
                // I miei numeri sono freschi: se la richiesta è partita dopo
                // l'appuntamento, il server lo conta già e il pavimento non serve.
                if (partita >= ultimoAppuntamento.current) setPav(p => (p.mia ? { ...p, mia: null } : p))
            }
        } catch {
            // Rete o server giù: restano i numeri di prima, si riprova al giro dopo.
        } finally {
            inVolo.current = false
            if (ancora.current) {
                ancora.current = false
                setTimeout(() => { void carica() }, 0)
            }
        }
    }, [])

    // Primo caricamento, giro ogni 25 s, ritorno sulla scheda.
    useEffect(() => {
        void carica()
        const id = setInterval(() => {
            setBattito(b => b + 1) // fa scadere i pavimenti anche senza dati nuovi
            if (Date.now() - ultimaRichiesta.current >= OGNI_MS - 1000) void carica()
        }, OGNI_MS)
        const alRitorno = () => {
            if (!document.hidden && Date.now() - ultimaRichiesta.current >= OGNI_MS) void carica()
        }
        document.addEventListener('visibilitychange', alRitorno)
        return () => {
            clearInterval(id)
            document.removeEventListener('visibilitychange', alRitorno)
            if (differita.current) clearTimeout(differita.current)
        }
    }, [carica])

    // Notifiche in arrivo: aggiornamento con freno (al massimo uno ogni 10 s).
    useEffect(() => {
        const suNotifica = () => {
            const attesa = ultimaRichiesta.current + DISTANZA_MINIMA_MS - Date.now()
            if (attesa <= 0) { void carica(); return }
            if (differita.current) return
            differita.current = setTimeout(() => {
                differita.current = null
                void carica()
            }, attesa)
        }
        window.addEventListener('realtime_update', suNotifica)
        return () => window.removeEventListener('realtime_update', suNotifica)
    }, [carica])

    // Momento appuntamento: avanza subito, poi chiede il dato vero.
    // Appuntamento tolto da un altro esito (evento col segno meno): niente
    // avanzamento, via i pavimenti che terrebbero su il numero, e dato vero
    // subito. I miei numeri sono freschi; quelli di squadra hanno la cache del
    // server (15 s).
    useEffect(() => {
        const suAppuntamento = (e: Event) => {
            if (deltaAppuntamento(e) < 0) {
                setPav({ mia: null, squadra: null, punta: null })
                void carica()
                return
            }
            const adesso = Date.now()
            ultimoAppuntamento.current = adesso
            const fino = adesso + PAVIMENTO_MS
            const m = mostrati.current
            const nuovoMio = m.mia + 1
            const dati = liveRef.current
            const inPunta = !!(dati?.squadra.puntaInizio && dati.squadra.puntaFine
                && adesso >= Date.parse(dati.squadra.puntaInizio) && adesso < Date.parse(dati.squadra.puntaFine))
            const inSquadra = dati?.io.inSquadra ?? true
            setPav(p => ({
                mia: { valore: nuovoMio, fino },
                squadra: inSquadra ? { valore: m.squadra + 1, fino } : p.squadra,
                punta: inSquadra && inPunta ? { valore: m.punta + 1, fino } : p.punta,
            }))
            const scalini = dati?.squadra.obiettivi.personale ?? [8, 10]
            setMomento({ chiave: adesso, n: nuovoMio, tipo: tipoMomento(nuovoMio, scalini), inPunta })
            void carica()
        }
        window.addEventListener(DIRETTA_APPUNTAMENTO, suAppuntamento)
        return () => window.removeEventListener(DIRETTA_APPUNTAMENTO, suAppuntamento)
    }, [carica])

    // Il momento dura al massimo 2 secondi.
    useEffect(() => {
        if (!momento) return
        const id = setTimeout(() => setMomento(null), 2000)
        return () => clearTimeout(id)
    }, [momento])

    const adesso = Date.now()
    const fissatiOggi = conPavimento(live?.mia.fissatiOggi ?? 0, pav.mia, adesso)
    const squadra = conPavimento(live?.squadra.fissati ?? 0, pav.squadra, adesso)
    const punta = conPavimento(live?.squadra.punta ?? 0, pav.punta, adesso)

    useEffect(() => {
        liveRef.current = live
        mostrati.current = { mia: fissatiOggi, squadra, punta }
    })

    return { live, fissatiOggi, squadra, punta, momento }
}
