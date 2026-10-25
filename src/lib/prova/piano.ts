// Cosa crea scripts/diretta/prova-setup.ts (migr. 0050, PO 25/10/2026): i due
// account di prova, il saldo per il negozio e i 25 lead di prova. Funzioni
// pure: gli istanti dipendono da `now`, così il piano si prova senza database
// e il dry-run mostra esattamente quello che verrebbe scritto.

import { romeTimeOnDay } from '@/lib/diretta/config'
import { nextWorkDayRome } from '@/lib/conferme/boardWindow'
import { dayBoundsRome } from '@/lib/dateUtils'

export const AZIENDA_PROVA = 'fenice'

export interface AccountProva {
    chiave: 'gdo' | 'conferme'
    email: string
    role: 'GDO' | 'CONFERME'
    gdoCode: number | null
    firstName: string
}

export const ACCOUNT_PROVA: readonly AccountProva[] = [
    { chiave: 'gdo', email: 'prova.gdo@fenice.local', role: 'GDO', gdoCode: 990, firstName: 'Prova GDO' },
    { chiave: 'conferme', email: 'prova.conferme@fenice.local', role: 'CONFERME', gdoCode: null, firstName: 'Prova Conferme' },
]

/** Saldo minimo per provare il negozio: basta per il corso (400 Piume) e qualche premio in Scintille. */
export const SALDO_PROVA = { scintille: 3000, piume: 600 } as const

/** Quanto accreditare per portare il saldo almeno al minimo di prova: mai un addebito. */
export function ricaricaPerSaldo(attuale: number, minimo: number): number {
    return Math.max(0, minimo - Math.max(0, attuale))
}

export type TipoLeadProva = 'vergine' | 'prima' | 'seconda' | 'terza' | 'richiamo_scaduto' | 'richiamo' | 'appuntamento'

export interface ChiamataProva {
    outcome: 'NON_RISPOSTO' | 'RICHIAMO' | 'APPUNTAMENTO'
    at: Date
    note: string | null
}

export interface LeadProva {
    nome: string
    telefono: string
    email: string
    funnel: string
    /** Come i lead veri dal webhook: serve anche al badge dei vergini del giorno. */
    source: 'activecampaign'
    tipo: TipoLeadProva
    status: 'NEW' | 'IN_PROGRESS' | 'APPOINTMENT'
    callCount: number
    createdAt: Date
    lastCallDate: Date | null
    lastCallNote: string | null
    recallDate: Date | null
    recallNote: string | null
    appointmentDate: Date | null
    appointmentNote: string | null
    appointmentCreatedAt: Date | null
    /** I callLog da scrivere, coerenti con callCount: la storia del lead. */
    chiamate: ChiamataProva[]
}

const NUMERI = [
    'Uno', 'Due', 'Tre', 'Quattro', 'Cinque', 'Sei', 'Sette', 'Otto', 'Nove', 'Dieci',
    'Undici', 'Dodici', 'Tredici', 'Quattordici', 'Quindici', 'Sedici', 'Diciassette', 'Diciotto',
    'Diciannove', 'Venti', 'Ventuno', 'Ventidue', 'Ventitré', 'Ventiquattro', 'Venticinque',
]

const FUNNEL = ['CORSO 10 ORE', 'JOB SIMULATOR', 'TELEGRAM', 'SOCIAL', 'GOOGLE', 'CORSO10ORE-TK']

/** 25 lead: 3 vergini, 5 in 1ª, 5 in 2ª, 4 in 3ª chiamata, 3 richiami scaduti, 3 in arrivo, 2 appuntamenti. */
const DISTRIBUZIONE: readonly [TipoLeadProva, number][] = [
    ['vergine', 3], ['prima', 5], ['seconda', 5], ['terza', 4],
    ['richiamo_scaduto', 3], ['richiamo', 3], ['appuntamento', 2],
]

export const TOTALE_LEAD_PROVA = DISTRIBUZIONE.reduce((n, [, k]) => n + k, 0)

/** Nome chiaramente finto: "Prova Uno" ... "Prova Venticinque". È anche la chiave per non crearlo due volte. */
export function nomeLeadProva(i: number): string {
    return `Prova ${NUMERI[i]}`
}

/** Telefono finto e non valido: +39 000 000 0001 ... +39 000 000 0025. */
export function telefonoLeadProva(i: number): string {
    return `+39 000 000 00${String(i + 1).padStart(2, '0')}`
}

export function emailLeadProva(i: number): string {
    return `prova${String(i + 1).padStart(2, '0')}@example.com`
}

const ORA = 3_600_000
const GIORNO = 24 * ORA

function oraDiRoma(at: Date): number {
    return parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(at), 10) % 24
}

/** Un orario 'HH:MM' di Roma nel giorno 'YYYY-MM-DD'. */
function alle(giorno: string, hhmm: string): Date {
    return romeTimeOnDay(new Date(`${giorno}T12:00:00Z`), hhmm)
}

/**
 * Quando cadono i due appuntamenti, perché la board Conferme li mostri
 * (src/lib/conferme/boardWindow.ts): il primo oggi fra un paio d'ore se
 * resta dentro le 9-21, altrimenti la mattina del prossimo giorno
 * lavorativo; il secondo sempre la mattina del prossimo giorno lavorativo.
 * Entrambi fissati ieri sera, così la colonna "Domani mattina" li accetta.
 */
export function orariAppuntamenti(now: Date): { primo: Date; secondo: Date; fissatiIl: Date } {
    const domani = nextWorkDayRome(now)
    const ora = Math.max(9, oraDiRoma(now) + 2)
    const primo = ora <= 20
        ? romeTimeOnDay(now, `${String(ora).padStart(2, '0')}:00`)
        : alle(domani, '10:00')
    return {
        primo,
        secondo: alle(domani, '11:00'),
        fissatiIl: romeTimeOnDay(new Date(now.getTime() - GIORNO), '18:30'),
    }
}

/** Il piano dei 25 lead di prova, tutti relativi a `now`. */
export function pianoLeadDiProva(now: Date): LeadProva[] {
    const t = now.getTime()
    const fa = (ms: number) => new Date(t - ms)
    // I vergini nascono oggi (giorno di Roma), tutti gli altri prima di oggi:
    // "vergine del giorno" guarda proprio la data di nascita (src/lib/diretta/arrivo.ts).
    const inizioOggi = dayBoundsRome(now).start.getTime()
    const app = orariAppuntamenti(now)
    const tipi = DISTRIBUZIONE.flatMap(([tipo, n]) => Array.from({ length: n }, () => tipo))

    return tipi.map((tipo, i): LeadProva => {
        const base = {
            nome: nomeLeadProva(i),
            telefono: telefonoLeadProva(i),
            email: emailLeadProva(i),
            funnel: FUNNEL[i % FUNNEL.length],
            source: 'activecampaign' as const,
            tipo,
        }
        const vuoto = {
            lastCallDate: null, lastCallNote: null, recallDate: null, recallNote: null,
            appointmentDate: null, appointmentNote: null, appointmentCreatedAt: null,
        }
        switch (tipo) {
            case 'vergine':
                // Appena arrivati: nati oggi, mai chiamati. In cima alla 1ª chiamata.
                return {
                    ...base, ...vuoto, status: 'NEW', callCount: 0,
                    createdAt: new Date(Math.min(t, Math.max(t - (i + 1) * 7 * 60_000, inizioOggi + (i + 1) * 1000))),
                    chiamate: [],
                }
            case 'prima':
                return { ...base, ...vuoto, status: 'NEW', callCount: 0, createdAt: new Date(inizioOggi - (i - 2) * 6 * ORA), chiamate: [] }
            case 'seconda': {
                const chiamata = fa(20 * ORA + i * 13 * 60_000)
                return {
                    ...base, ...vuoto, status: 'IN_PROGRESS', callCount: 1, createdAt: fa(3 * GIORNO),
                    lastCallDate: chiamata, lastCallNote: 'Non risponde (prova)',
                    chiamate: [{ outcome: 'NON_RISPOSTO', at: chiamata, note: 'Non risponde (prova)' }],
                }
            }
            case 'terza': {
                const prima = fa(2 * GIORNO + i * 11 * 60_000)
                const seconda = fa(22 * ORA + i * 11 * 60_000)
                return {
                    ...base, ...vuoto, status: 'IN_PROGRESS', callCount: 2, createdAt: fa(4 * GIORNO),
                    lastCallDate: seconda, lastCallNote: 'Non risponde (prova)',
                    chiamate: [
                        { outcome: 'NON_RISPOSTO', at: prima, note: 'Non risponde (prova)' },
                        { outcome: 'NON_RISPOSTO', at: seconda, note: 'Non risponde (prova)' },
                    ],
                }
            }
            case 'richiamo_scaduto':
            case 'richiamo': {
                const k = tipo === 'richiamo_scaduto' ? i - 17 : i - 20
                const chiamata = fa((k + 1) * 26 * ORA)
                const quando = tipo === 'richiamo_scaduto'
                    ? fa([1, 3, 26][k] * ORA)
                    : new Date(t + [2, 26, 50][k] * ORA)
                const nota = tipo === 'richiamo_scaduto' ? 'Richiamare: chiede di sentirsi più tardi (prova)' : 'Richiamare dopo il lavoro (prova)'
                return {
                    ...base, ...vuoto, status: 'IN_PROGRESS', callCount: 1, createdAt: fa((k + 2) * GIORNO),
                    lastCallDate: chiamata, lastCallNote: nota, recallDate: quando, recallNote: nota,
                    chiamate: [{ outcome: 'RICHIAMO', at: chiamata, note: nota }],
                }
            }
            case 'appuntamento': {
                const quando = i === 23 ? app.primo : app.secondo
                const fissato = new Date(app.fissatiIl.getTime() + (i - 23) * 15 * 60_000)
                const nota = 'Interessato, appuntamento da confermare (prova)'
                return {
                    ...base, ...vuoto, status: 'APPOINTMENT', callCount: 1, createdAt: fa(2 * GIORNO),
                    lastCallDate: fissato, lastCallNote: nota,
                    appointmentDate: quando, appointmentNote: nota, appointmentCreatedAt: fissato,
                    chiamate: [{ outcome: 'APPUNTAMENTO', at: fissato, note: nota }],
                }
            }
        }
    })
}
