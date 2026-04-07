import { Trophy } from "lucide-react"

export default function ClassificaLoading() {
    return (
        <div className="flex-1 bg-ash-50 flex flex-col min-h-screen">
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
    )
}
