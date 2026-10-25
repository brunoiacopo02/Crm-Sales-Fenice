// Pezzi comuni delle pagine Diretta del ramo negozio (negozio, squadra,
// profilo). Niente hook: si usano sia da server sia da client. I colori sono
// i token --d-* di globals.css, definiti sotto [data-ui="diretta"].

import type { ReactNode } from "react"
import { nomeValuta } from "@/lib/diretta/negozio"

export const btn = {
    // Azione che conta adesso: arancione, testo nero.
    primario: 'inline-flex h-10 items-center justify-center rounded-[8px] bg-[var(--d-orange)] px-4 text-sm font-semibold text-[var(--d-orange-ink)] transition-colors hover:bg-[#FFA552] disabled:cursor-not-allowed disabled:opacity-60',
    // Azione neutra: chiaro su scuro, come "Chiama" nella tavola B.
    chiaro: 'inline-flex h-10 items-center justify-center rounded-[8px] bg-[var(--d-text)] px-4 text-sm font-semibold text-[var(--d-bg)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60',
    // Azione secondaria: solo filetto.
    linea: 'inline-flex h-10 items-center justify-center rounded-[8px] border-2 border-[var(--d-line)] px-4 text-sm font-medium text-[var(--d-text)] transition-colors hover:border-[var(--d-muted)] disabled:cursor-not-allowed disabled:opacity-60',
} as const

/** Pagina a tutta superficie scura: copre anche il padding del <main> del layout. */
export function PaginaDiretta({ children }: { children: ReactNode }) {
    return (
        <div className="-m-3 min-h-[calc(100%+1.5rem)] bg-[var(--d-bg)] px-4 py-6 text-[var(--d-text)] sm:-m-6 sm:min-h-[calc(100%+3rem)] sm:px-8 sm:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
        </div>
    )
}

/** Titolo di pagina con una sola porzione in arancione. */
export function TitoloDiretta({ prima, accento, dopo }: { prima?: string; accento: string; dopo?: string }) {
    return (
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[32px]">
            {prima ? `${prima} ` : ''}<span className="text-[var(--d-orange)]">{accento}</span>{dopo ? ` ${dopo}` : ''}
        </h1>
    )
}

function iniziali(nome: string): string {
    return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?'
}

/**
 * Immagine profilo quadrata (raggio 8, 16 sopra i 64 px). Senza immagine, le
 * iniziali su chiaro come nella barra in alto. La cornice comprata è un
 * filetto arancione staccato di 2 px.
 */
export function AvatarDiretta({ nome, immagine, cornice = false, size = 40 }: { nome: string; immagine: string | null; cornice?: boolean; size?: number }) {
    const radius = size >= 64 ? 16 : 8
    return (
        <div
            className="relative flex shrink-0 items-center justify-center overflow-hidden bg-[var(--d-text)] font-semibold text-[var(--d-bg)]"
            style={{
                width: size, height: size, borderRadius: radius, fontSize: Math.max(11, Math.round(size * 0.36)),
                // Le immagini hanno il fondo della pagina: un filetto le tiene quadrate.
                outline: cornice ? '2px solid var(--d-orange)' : immagine ? '1px solid var(--d-line)' : undefined,
                outlineOffset: cornice ? 2 : undefined,
            }}
            aria-hidden="true"
        >
            {immagine
                ? <img src={immagine} alt="" width={size} height={size} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                : iniziali(nome)}
        </div>
    )
}

const NUM = new Intl.NumberFormat('it-IT')
export const numero = (n: number) => NUM.format(n)

export const prezzoTesto = (currency: string, n: number) => `${numero(n)} ${nomeValuta(currency, n)}`

// Date assolute con fuso esplicito: stesso testo sul server e nel browser.
const DATA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short' })
const DATA_ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
export const dataBreve = (iso: string) => DATA.format(new Date(iso))
export const dataOra = (iso: string) => DATA_ORA.format(new Date(iso))

export const STATO_TESTO: Record<string, string> = {
    richiesto: 'In attesa',
    consegnato: 'Consegnato',
    annullato: 'Annullato, saldo rimborsato',
}
