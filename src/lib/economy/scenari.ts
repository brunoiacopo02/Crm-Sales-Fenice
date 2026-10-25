// Modello degli scenari dell'economia v2 (25/10/2026): quanto guadagna a
// settimana un GDO o una Conferma con certi numeri, con le regole vere di
// ./rules.ts. Funzioni pure: servono a tarare il catalogo del negozio
// (src/lib/diretta/negozioCatalogo.ts) e a scrivere le tabelle di
// docs/superpowers/specs/2026-10-25-economia-v2-margini.md. Non girano in
// produzione.
//
// Ipotesi del modello, scritte nel documento:
// - 6 giornate a settimana (lun-sab); fissati del giorno come una normale con
//   deviazione 2 (tarata sui giorni veri di ottobre 2026);
// - conteggi settimanali delle Conferme come Poisson attorno alla media;
// - forzieri di squadra: probabilità per giorno stimate sui totali di squadra
//   di ottobre, uguali per tutti i GDO della squadra.

import { importiConferme, importiGdo, type EconomyRules } from './rules'
import type { GamificationTargets } from '@/lib/diretta/config'

export const GIORNI_SETTIMANA = 6
export const SETTIMANE_MESE = 52 / 12

export interface ScenarioGdo {
    nome: string
    fissatiGiorno: number
    conferma: number        // confermati / fissati
    presenza: number        // presentati / confermati
    chiusura: number        // chiusi / presentati
    /** Deviazione dei fissati del giorno (default 2). */
    sd?: number
}

export interface ForzieriAttesi {
    /** Probabilità al giorno che la squadra sblocchi un forziere raro (55 al giorno o 14 in punta). */
    raroGiorno: number
    /** Probabilità al giorno di un leggendario (65 o 20). */
    leggendarioGiorno: number
}

/** Stima di ottobre 2026 sulla squadra di 8-9 GDO attivi (vedi il documento). */
export const FORZIERI_OTTOBRE: ForzieriAttesi = { raroGiorno: 0.5, leggendarioGiorno: 0.11 }

/** Funzione di ripartizione della normale standard (Abramowitz-Stegun 26.2.17). */
export function normaleCdf(z: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(z))
    const d = 0.3989422804014327 * Math.exp(-z * z / 2)
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
    return z >= 0 ? 1 - p : p
}

/** Probabilità che i fissati interi del giorno siano almeno `soglia` (correzione di continuità). */
export function probAlmeno(media: number, sd: number, soglia: number): number {
    return 1 - normaleCdf((soglia - 0.5 - media) / sd)
}

/** P(X ≥ k) per una Poisson di media `lambda`. */
export function poissonAlmeno(lambda: number, k: number): number {
    if (k <= 0) return 1
    let p = Math.exp(-lambda)
    let cum = p
    for (let i = 1; i < k; i++) {
        p *= lambda / i
        cum += p
    }
    return Math.max(0, 1 - cum)
}

/** E[max(0, X − soglia)] per una Poisson di media `lambda`: le unità pagate oltre la soglia. */
export function poissonOltre(lambda: number, soglia: number): number {
    // E[X − s]⁺ = E[X] − s + E[s − X]⁺
    let p = Math.exp(-lambda)
    let sotto = soglia * p
    for (let i = 1; i < soglia; i++) {
        p *= lambda / i
        sotto += (soglia - i) * p
    }
    return lambda - soglia + sotto
}

export interface GuadagnoSettimana {
    fissati: number
    conferme: number
    presenze: number
    chiusure: number
    scintille: { fissati: number; scalini: number; forzieri: number; totale: number }
    piume: { lead: number; forzieri: number; totale: number }
}

/** Guadagno atteso di una settimana di un GDO (Scintille e Piume) con le regole date. */
export function guadagnoGdo(s: ScenarioGdo, r: EconomyRules, t: Pick<GamificationTargets, 'personale'>, f: ForzieriAttesi = FORZIERI_OTTOBRE): GuadagnoSettimana {
    const sd = s.sd ?? 2
    const fissati = s.fissatiGiorno * GIORNI_SETTIMANA
    const conferme = fissati * s.conferma
    const presenze = conferme * s.presenza
    const chiusure = presenze * s.chiusura

    // Il tetto dei fissati pagati al giorno taglia solo le giornate oltre il tetto.
    const pagatiGiorno = Math.min(s.fissatiGiorno, r.fissato.tettoGiorno)
    const sFissati = pagatiGiorno * GIORNI_SETTIMANA * r.fissato.scintille
    const p1 = probAlmeno(s.fissatiGiorno, sd, t.personale[0])
    const p2 = probAlmeno(s.fissatiGiorno, sd, t.personale[1])
    const sScalini = GIORNI_SETTIMANA * (p1 * r.scaliniPersonali[0] + p2 * r.scaliniPersonali[1])
    const mediaS = (o: { scintille: [number, number] }) => (o.scintille[0] + o.scintille[1]) / 2
    const raro = r.forzieri.raro
    const legg = r.forzieri.leggendario
    const sForzieri = GIORNI_SETTIMANA * (
        f.raroGiorno * (1 - raro.probPiuma) * mediaS(raro) + f.leggendarioGiorno * (1 - legg.probPiuma) * mediaS(legg)
    )
    const pForzieri = GIORNI_SETTIMANA * (f.raroGiorno * raro.probPiuma * raro.piume + f.leggendarioGiorno * legg.probPiuma * legg.piume)

    // Piume a stadi: ogni lead vale lo stadio più alto (non si sommano).
    const [g1, g2, g3] = importiGdo(r)
    const pLead = conferme * g1 + presenze * g2 + chiusure * g3

    return {
        fissati, conferme, presenze, chiusure,
        scintille: { fissati: sFissati, scalini: sScalini, forzieri: sForzieri, totale: sFissati + sScalini + sForzieri },
        piume: { lead: pLead, forzieri: pForzieri, totale: pLead + pForzieri },
    }
}

export interface ScenarioConferme {
    nome: string
    /** Conferme fatte (anche dopo l'ora dell'appuntamento), a settimana. */
    conferme: number
    /** Presenze di quei lead, a settimana. */
    presenze: number
    /** Quota delle presenze confermate con almeno un'ora d'anticipo. */
    inTempo: number
    /** Chiusure di quei lead, a settimana. */
    chiusure: number
}

export interface GuadagnoConferme {
    scintille: { conferme: number; presenze: number; inTempo: number; totale: number }
    piume: { presenze: number; chiusure: number; totale: number }
}

/** Guadagno atteso di una settimana di una Conferma, con gli obiettivi di default (o di una persona). */
export function guadagnoConferme(s: ScenarioConferme, r: EconomyRules, userId = ''): GuadagnoConferme {
    const [c1, c2] = importiConferme(r, false)
    const inTempo = r.conferme.scintille.inTempo
    const sConferme = s.conferme * c1
    const sPresenze = s.presenze * c2
    const sInTempo = s.presenze * s.inTempo * inTempo
    const o = r.conferme.perPersona[userId]
    const ob = r.conferme.obiettivi
    const sogliePres = o?.presenze ?? ob.presenze.soglie
    const soglieChiu = o?.chiusure ?? ob.chiusure.soglie
    const pPres = poissonAlmeno(s.presenze, sogliePres[0]) * ob.presenze.piume[0] + poissonAlmeno(s.presenze, sogliePres[1]) * ob.presenze.piume[1]
    const pChiu = poissonAlmeno(s.chiusure, soglieChiu[0]) * ob.chiusure.piume[0] + poissonAlmeno(s.chiusure, soglieChiu[1]) * ob.chiusure.piume[1]
    return {
        scintille: { conferme: sConferme, presenze: sPresenze, inTempo: sInTempo, totale: sConferme + sPresenze + sInTempo },
        piume: { presenze: pPres, chiusure: pChiu, totale: pPres + pChiu },
    }
}

/** Il patto col Sales Manager (Doc di Paolo, ottobre 2026): linea, base e massimo. */
export const PATTO = {
    linea: { fissatiGiorno: 6.1, conferma: 0.102, presenza: 0.85 },
    base: { fissatiGiorno: 6.1, conferma: 0.107, presenza: 0.886 },
    /** GDO-4 (≥ 7,4 appuntamenti per giornata) e CONF-4 (+2 punti sulla base). */
    massimo: { fissatiGiorno: 7.4, conferma: 0.127, presenza: 0.886 },
} as const

/** Chiusura dei presentati usata negli scenari (fuori lancio, prudente: vedi il documento). */
export const CHIUSURA_SCENARI = 0.26

/** Gli scenari dei GDO del documento. */
export const SCENARI_GDO: ScenarioGdo[] = [
    { nome: 'GDO medio (ottobre)', fissatiGiorno: 6.9, conferma: 0.093, presenza: 0.887, chiusura: CHIUSURA_SCENARI },
    { nome: 'GDO alla linea del patto', ...PATTO.linea, chiusura: CHIUSURA_SCENARI },
    { nome: 'GDO bravo', fissatiGiorno: 7.9, conferma: 0.107, presenza: 0.886, chiusura: CHIUSURA_SCENARI },
    { nome: 'GDO al massimo del patto', ...PATTO.massimo, chiusura: CHIUSURA_SCENARI },
    { nome: 'GDO campione', fissatiGiorno: 10, conferma: 0.15, presenza: 0.9, chiusura: CHIUSURA_SCENARI },
]

/** Gli scenari delle Conferme del documento (a persona, a settimana). */
export const SCENARI_CONFERME: ScenarioConferme[] = [
    { nome: 'Conferma media', conferme: 22, presenze: 19, inTempo: 0.59, chiusure: 6 },
    { nome: 'Conferma brava', conferme: 30, presenze: 26, inTempo: 0.65, chiusure: 8 },
]
