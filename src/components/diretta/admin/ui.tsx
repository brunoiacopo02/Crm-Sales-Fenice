// Pezzi comuni delle pagine admin della Diretta (centro di controllo,
// citazioni, obiettivi). Niente hook: si usano sia da server sia da client.
//
// I colori sono quelli dei token --d-* scritti per esteso: queste pagine sono
// scure anche quando la veste dell'admin è spenta e la cornice è quella vecchia
// (lì [data-ui="diretta"] non c'è e le variabili non esistono). Il carattere è
// Poppins anche dentro la superficie chiara che la cornice dell'admin tiene per
// le pagine vecchie.

import Link from "next/link"
import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { toRomeDateStr } from "@/lib/dateUtils"

const BOTTONE = 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[8px] text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const TIPI_BOTTONE = {
    // L'azione che conta adesso: arancione, testo nero.
    primario: 'bg-[#FF9330] font-semibold text-[#171717] hover:bg-[#FFA552]',
    // Azione secondaria: solo filetto.
    linea: 'border-2 border-[#3D3D3D] font-medium text-[#F2F2F2] hover:border-[#BFBFBF]',
    // Azione di contorno: testo, senza riquadro.
    testo: 'text-[#BFBFBF] hover:bg-[#2E2E2E] hover:text-[#F2F2F2]',
    // Scelta attiva di un filtro: chiaro su scuro, l'arancione resta alle azioni.
    scelto: 'border-2 border-[#F2F2F2] bg-[#F2F2F2] font-semibold text-[#171717]',
} as const

/** Classi di un bottone delle pagine admin Diretta. */
export function bottone(tipo: keyof typeof TIPI_BOTTONE, misura: 'normale' | 'piccola' = 'normale'): string {
    return `${BOTTONE} ${TIPI_BOTTONE[tipo]} ${misura === 'piccola' ? 'h-9 px-3' : 'h-10 px-4'}`
}

/** Pagina a tutta superficie scura: copre il padding del <main> del layout. */
export function PaginaAdmin({ children, larga = false }: { children: ReactNode; larga?: boolean }) {
    return (
        <div className="-m-3 min-h-[calc(100%+1.5rem)] bg-[#171717] px-4 py-6 font-[family-name:var(--font-poppins)] text-[#F2F2F2] tabular-nums sm:-m-6 sm:min-h-[calc(100%+3rem)] sm:px-8 sm:py-8">
            <div className={`mx-auto w-full ${larga ? 'max-w-[90rem]' : 'max-w-6xl'}`}>{children}</div>
        </div>
    )
}

/** Titolo di pagina con una sola porzione in arancione; sotto, al massimo una riga. */
export function TitoloAdmin({ prima, accento, dopo, sotto }: { prima?: string; accento: string; dopo?: string; sotto?: ReactNode }) {
    return (
        <header>
            <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[32px]">
                {prima ? `${prima} ` : ''}<span className="text-[#FF9330]">{accento}</span>{dopo ? ` ${dopo}` : ''}
            </h1>
            {sotto && <div className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[#BFBFBF]">{sotto}</div>}
        </header>
    )
}

/** Link "torna indietro" sopra il titolo delle pagine di dettaglio. */
export function Indietro({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Link href={href} className="mb-4 inline-flex items-center rounded-[8px] py-1 text-[14px] text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]">
            {children}
        </Link>
    )
}

/** Riquadro di una sezione: titolo, link al dettaglio a destra, contenuto. */
export function Sezione({ titolo, href, linkTesto = 'Apri', id, className = '', children }: {
    titolo: string
    href?: string
    linkTesto?: string
    id?: string
    className?: string
    children: ReactNode
}) {
    return (
        <section id={id} aria-label={titolo} className={`flex min-w-0 flex-col rounded-[16px] bg-[#262626] p-5 sm:p-6 ${className}`}>
            <div className="flex items-start justify-between gap-3">
                <h2 className="text-[17px] font-semibold leading-snug">{titolo}</h2>
                {href && (
                    <Link
                        href={href}
                        className="-mr-2 -mt-1 inline-flex shrink-0 items-center gap-0.5 rounded-[8px] px-2 py-1 text-[14px] text-[#BFBFBF] transition-colors hover:bg-[#2E2E2E] hover:text-[#F2F2F2]"
                    >
                        {linkTesto}
                        <ChevronRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                    </Link>
                )}
            </div>
            <div className="mt-4 flex min-w-0 flex-1 flex-col">{children}</div>
        </section>
    )
}

/** Riga etichetta e valore, separata dalla precedente da un filetto. */
export function Riga({ etichetta, valore, forte = false, nota }: { etichetta: ReactNode; valore: ReactNode; forte?: boolean; nota?: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 border-t-2 border-[#2E2E2E] py-2.5 first:border-t-0 first:pt-0">
            <div className="min-w-0">
                <div className="text-[14px] leading-snug text-[#F2F2F2]">{etichetta}</div>
                {nota && <div className="mt-0.5 text-[13px] leading-snug text-[#BFBFBF]">{nota}</div>}
            </div>
            <div className={`shrink-0 text-right text-[15px] tabular-nums ${forte ? 'font-semibold text-[#FF9330]' : 'font-medium text-[#F2F2F2]'}`}>{valore}</div>
        </div>
    )
}

/** Frase per una sezione senza dati. */
export function Vuoto({ children }: { children: ReactNode }) {
    return <div className="text-[14px] leading-relaxed text-[#BFBFBF]">{children}</div>
}

/** Sezione che non si è potuta leggere: le altre restano in pagina. */
export function NonDisponibile() {
    return <Vuoto>Dati non disponibili in questo momento. Si riprova al prossimo aggiornamento.</Vuoto>
}

/** Barra di avanzamento con il primo scalino segnato e il secondo in fondo. */
export function BarraScalini({ valore, scalini, etichetta }: { valore: number; scalini: [number, number]; etichetta: string }) {
    const fondo = Math.max(1, scalini[1], valore)
    const pieno = Math.min(1, valore / fondo)
    const primo = Math.min(1, scalini[0] / fondo)
    return (
        <div role="img" aria-label={`${etichetta}: ${valore} su ${scalini[1]}, primo scalino a ${scalini[0]}`}>
            <div className="relative h-2.5 overflow-hidden rounded-[3px] bg-[#3D3D3D]">
                <div className="h-full bg-[#FF9330]" style={{ width: `${pieno * 100}%` }} />
                <div className="absolute inset-y-0 w-0.5 bg-[#F2F2F2]" style={{ left: `calc(${primo * 100}% - 1px)` }} />
            </div>
            <div className="relative mt-1 h-4 text-[12px] tabular-nums text-[#BFBFBF]">
                <span className="absolute -translate-x-1/2" style={{ left: `${primo * 100}%` }}>{scalini[0]}</span>
                <span className="absolute right-0">{scalini[1]}</span>
            </div>
        </div>
    )
}

// Date e ore assolute con fuso esplicito: stesso testo sul server e nel browser.
const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })
const GIORNO_ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
export const oraDi = (iso: string) => ORA.format(new Date(iso))
export const giornoOraDi = (iso: string) => GIORNO_ORA.format(new Date(iso))

/** Ora se è di oggi (giorno di Roma, YYYY-MM-DD), altrimenti giorno e ora. */
export function quando(iso: string, oggi: string): string {
    return toRomeDateStr(new Date(iso)) === oggi ? oraDi(iso) : giornoOraDi(iso)
}
