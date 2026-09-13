/**
 * Legenda della griglia calendario. Nessuna logica, solo pastiglie di testo.
 *
 * Due varianti, perché le due griglie non dicono la stessa cosa:
 *
 * - `personale` (la propria settimana in `/mio-calendario`): le celle portano
 *   uno STATO scelto dal venditore, quindi servono tutte e cinque le voci. Il
 *   bianco (`libero`) è tornato in legenda perché è tornato nella griglia: una
 *   settimana mai compilata — passata, o ancora solo proposta dal default
 *   verde — non è "non disponibile", è "nessuna scelta fatta", e le due si
 *   distinguono solo con il colore. Chiude l'elenco il "+N" in alto a
 *   sinistra sulle celle: è l'unico segno della griglia personale che non è
 *   uno stato ma un conteggio (i colleghi disponibili in quell'ora), e senza
 *   una riga di legenda restava un numero senza nome.
 * - `copertura` (le due griglie di sola copertura, qui e in
 *   `/calendari-venditori`): lì ogni cella è `libero`, cioè un contenitore
 *   neutro per il semaforo e i nomi. L'unico segnale è il semaforo. Elencare
 *   "Disponibile / Non disponibile / Occupato / Bloccato" sotto quella griglia
 *   spiegava colori che in quella griglia non esistono — un rosso che non c'è.
 */

type LegendVariant = 'personale' | 'copertura'

interface Props {
    /** Default `personale`: la griglia in cui le celle sono una scelta del venditore. */
    variant?: LegendVariant
}

export function CoverageLegend({ variant = 'personale' }: Props) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ash-200 bg-white px-3 py-2 text-[11px] text-ash-600">
            {variant === 'personale' && (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold uppercase tracking-wider text-ash-400">Slot</span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Disponibile
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-rose-700">
                            <span className="h-2 w-2 rounded-full bg-rose-400" /> Non disponibile
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ash-200 bg-white px-2 py-0.5 text-ash-500">
                            <span className="h-2 w-2 rounded-full border border-ash-300 bg-white" /> Non ancora scelto
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-900">
                            <span className="h-2 w-2 rounded-full bg-sky-500" /> Occupato
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ash-300 bg-ash-100 px-2 py-0.5 text-ash-500">
                            <span className="h-2 w-2 rounded-full bg-ash-400" /> Bloccato
                        </span>
                        <span className="text-ash-500">+N = altri colleghi disponibili in quell&apos;ora</span>
                    </div>
                    <div className="hidden h-4 w-px bg-ash-200 sm:block" />
                </>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold uppercase tracking-wider text-ash-400">Copertura</span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-rose-500" /> Nessuno disponibile
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" /> Sotto la domanda attesa
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Coperto
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full border border-ash-300 bg-transparent" /> Nessun dato storico
                </span>
            </div>
        </div>
    )
}
