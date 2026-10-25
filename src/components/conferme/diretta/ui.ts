// Classi della grafica Diretta per le Conferme (PO 25/10/2026). Usano i token
// --d-* definiti in fondo a globals.css sotto [data-ui="diretta"]: fondo
// #171717, superfici #262626, testo #F2F2F2 e #BFBFBF, arancione #FF9330 solo
// per ciò che conta adesso, con il testo nero sopra. Raggi 8 e 16, niente
// ombre, gradienti, pillole, maiuscolo spaziato o monospace.

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--d-orange)]'

export const dUi = {
    /** Bottone secondario: bordo, fondo trasparente. */
    btn: `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border-2 border-[var(--d-line)] bg-transparent px-3 text-[13px] font-medium text-[var(--d-text)] transition-colors hover:bg-[var(--d-surface-2)] disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
    /** Bottone secondario grande (azioni del drawer). */
    btnLg: `inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border-2 border-[var(--d-line)] bg-transparent px-4 text-sm font-medium text-[var(--d-text)] transition-colors hover:bg-[var(--d-surface-2)] disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
    /** Bottone d'attenzione: la scelta che conta adesso, arancione con testo nero. */
    btnPrimary: `inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--d-orange)] px-5 text-[15px] font-semibold text-[var(--d-orange-ink)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
    /** Bottone chiaro: azione principale che non è un esito. */
    btnLight: `inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--d-text)] px-5 text-[15px] font-semibold text-[var(--d-bg)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
    /** Bottone solo testo. */
    btnText: `inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-[var(--d-muted)] transition-colors hover:text-[var(--d-text)] disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
    /** Bottone quadrato con sola icona. */
    btnIcon: `inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--d-muted)] transition-colors hover:bg-[var(--d-surface-2)] hover:text-[var(--d-text)] ${focus}`,
    input: 'w-full rounded-lg border-2 border-[var(--d-line)] bg-[var(--d-bg)] px-3 py-2 text-sm text-[var(--d-text)] outline-none transition-colors [color-scheme:dark] placeholder:text-[var(--d-faint)] focus:border-[var(--d-orange)] disabled:opacity-60',
    label: 'text-[13px] font-medium text-[var(--d-muted)]',
    muted: 'text-[var(--d-muted)]',
    faint: 'text-[var(--d-faint)]',
    surface: 'rounded-2xl bg-[var(--d-surface)]',
    /** Popover sopra la board (richiamo, risentire dopo). */
    popover: 'absolute right-0 top-full z-50 mt-2 rounded-2xl border-2 border-[var(--d-line)] bg-[var(--d-surface)] p-4 text-[var(--d-text)]',
}

/** Scheda di una barra a schede (tab): attiva chiara, le altre in testo secondario. */
export function dTab(active: boolean): string {
    return `inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm transition-colors ${focus} ${active
        ? 'bg-[var(--d-text)] font-semibold text-[var(--d-bg)]'
        : 'font-medium text-[var(--d-muted)] hover:bg-[var(--d-surface)] hover:text-[var(--d-text)]'}`
}

/** Filtro piccolo (chiamate a vuoto, storico, periodo): stessa logica della scheda, più compatto. */
export function dChip(active: boolean): string {
    return `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-colors ${focus} ${active
        ? 'bg-[var(--d-text)] font-semibold text-[var(--d-bg)]'
        : 'font-medium text-[var(--d-muted)] hover:bg-[var(--d-surface)] hover:text-[var(--d-text)]'}`
}

/** Euro in italiano, il simbolo dopo il numero. */
export function formatEuro(n: number): string {
    return new Intl.NumberFormat('it-IT', {
        style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n)
}
