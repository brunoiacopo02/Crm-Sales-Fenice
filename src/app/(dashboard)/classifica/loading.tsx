import { Trophy } from "lucide-react"

export default function ClassificaLoading() {
    return (
        <>
        {/* Con la Diretta accesa (data-ui sul div radice del layout) il caricamento
            è già scuro, senza il vecchio titolo "Classifica GDO". */}
        <div className="hidden [[data-ui=diretta]_&]:block -m-3 min-h-[calc(100%+1.5rem)] bg-[var(--d-bg)] px-4 py-6 sm:-m-6 sm:min-h-[calc(100%+3rem)] sm:px-8 sm:py-8" aria-busy="true">
            <div className="mx-auto w-full max-w-6xl">
                <div className="h-9 w-48 rounded-[8px] bg-[var(--d-surface)]" />
                <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                    <div className="h-72 rounded-[16px] bg-[var(--d-surface)]" />
                    <div className="flex flex-col gap-3">
                        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-[8px] bg-[var(--d-surface)]" />)}
                    </div>
                </div>
            </div>
        </div>
        <div className="[[data-ui=diretta]_&]:hidden flex-1 bg-ash-50 flex flex-col min-h-screen">
            <div className="bg-brand-charcoal text-white pt-8 pb-20 px-8">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-white/10 rounded-xl">
                        <Trophy className="h-6 w-6 text-brand-orange" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold">Classifica GDO</h1>
                        <p className="text-ash-400 mt-1">
                            Caricamento dati...
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex-1 px-8 -mt-10 pb-8 max-w-5xl mx-auto w-full">
                <div className="bg-white rounded-xl shadow-xl border border-ash-100 p-6 shadow-brand-orange/5 animate-pulse">
                    <div className="h-8 bg-ash-200 rounded w-1/4 mb-6" />
                    <div className="space-y-4">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="flex items-center justify-between p-4 bg-ash-50 rounded-lg">
                                <div className="flex items-center gap-4">
                                    <div className="h-8 w-8 bg-ash-200 rounded-full" />
                                    <div className="h-10 w-10 bg-ash-200 rounded-full" />
                                    <div className="h-4 bg-ash-200 rounded w-32" />
                                </div>
                                <div className="h-6 bg-ash-200 rounded w-16" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
        </>
    )
}
