/**
 * Legenda della griglia calendario: quattro stati cella + quattro colori del
 * semaforo copertura. Nessuna logica, solo pastiglie di testo.
 *
 * Dal default verde (Task 5) lo stato "libero" (bianco) non è più una scelta
 * del venditore, quindi è uscito da questa legenda: nella griglia personale
 * ogni ora è o verde (disponibile) o rossa (non disponibile). Il bianco resta
 * nel codice come sfondo neutro delle sole viste di copertura (vedi
 * `SlotGrid.tsx`), dove non etichetta una scelta e quindi non serve una voce
 * qui.
 */

export function CoverageLegend() {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ash-200 bg-white px-3 py-2 text-[11px] text-ash-600">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold uppercase tracking-wider text-ash-400">Slot</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Disponibile
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-rose-700">
                    <span className="h-2 w-2 rounded-full bg-rose-400" /> Non disponibile
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-900">
                    <span className="h-2 w-2 rounded-full bg-sky-500" /> Occupato
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-ash-300 bg-ash-100 px-2 py-0.5 text-ash-500">
                    <span className="h-2 w-2 rounded-full bg-ash-400" /> Bloccato
                </span>
            </div>
            <div className="hidden h-4 w-px bg-ash-200 sm:block" />
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
