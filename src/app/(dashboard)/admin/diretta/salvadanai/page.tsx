import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { nextYearMonth, previousYearMonth, toRomeDateStr } from "@/lib/dateUtils"
import { euroIt } from "@/lib/diretta/formato"
import { readEconomyRules } from "@/lib/economy/awards"
import {
    dateSettimana, meseDelSalvadanaio, nomeMese, type PremiMese, type SettimanaDelMese,
} from "@/lib/economy/premiMese"
import { leggiPremiMese } from "@/lib/economy/premiMeseDb"

export const dynamic = "force-dynamic"

/**
 * Salvadanai dei GDO (PO 09/11/2026): i bonus in euro di ogni GDO nel mese,
 * settimana per settimana (bonus presenze e classifica), più la settimana in
 * corso provvisoria. Gli stessi conti di "Premi della settimana"; una
 * settimana conta nel mese del suo sabato (confermata dal PO il 09/11/2026).
 * Solo ADMIN, letto dalla tabella users. Dati in cache 2 minuti.
 */
export default async function SalvadanaiPage({ searchParams }: { searchParams: Promise<{ mese?: string }> }) {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const now = new Date()
    const economia = await readEconomyRules()
    const primoMese = economia.inizio.slice(0, 7)
    const meseCorrente = toRomeDateStr(now).slice(0, 7)
    // Dal 30/11 la settimana in corso è già di dicembre: si può guardare anche quello.
    const ultimoMese = [meseCorrente, meseDelSalvadanaio(now)].sort()[1]
    const sp = await searchParams
    const richiesto = sp.mese && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mese) ? sp.mese : null
    const mese = richiesto && richiesto >= primoMese && richiesto <= ultimoMese ? richiesto : meseCorrente

    const premi = await leggiPremiMese("fenice", mese).catch((e: unknown) => {
        console.error("[salvadanai] lettura", mese, e)
        return null
    })
    const prima = previousYearMonth(mese)
    const dopo = nextYearMonth(mese)
    const anno = mese.slice(0, 4)

    return (
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
            <Link href="/admin/diretta" className="inline-flex items-center gap-1 text-sm text-ash-500 transition-colors hover:text-brand-charcoal">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Rinascita
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-brand-charcoal">Salvadanai dei GDO</h1>
                <p className="mt-1 text-sm text-ash-500">
                    I bonus in euro del mese: presenze oltre la soglia e classifica, settimana per settimana (lunedì-sabato).
                    Una settimana conta nel mese del suo sabato. Nel totale entrano solo le settimane chiuse.
                </p>
            </div>

            <nav aria-label="Mese" className="flex items-center justify-between gap-3 rounded-2xl border border-ash-200 bg-white px-3 py-2">
                {prima >= primoMese ? (
                    <Link href={`/admin/diretta/salvadanai?mese=${prima}`} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-ash-700 transition-colors hover:bg-ash-50">
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        <span className="capitalize">{nomeMese(prima)}</span>
                    </Link>
                ) : <div className="w-9" />}
                <div className="text-base font-bold capitalize text-brand-charcoal">{nomeMese(mese)} {anno}</div>
                {dopo <= ultimoMese ? (
                    <Link href={`/admin/diretta/salvadanai?mese=${dopo}`} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-ash-700 transition-colors hover:bg-ash-50">
                        <span className="capitalize">{nomeMese(dopo)}</span>
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                ) : <div className="w-9" />}
            </nav>

            {!premi ? (
                <div className="rounded-2xl border border-ash-200 bg-white p-5 text-sm text-ash-500">Dati non disponibili ora. Riprova tra poco.</div>
            ) : (
                <>
                    <Riepilogo p={premi} />
                    {premi.chiuse.map(s => <Settimana key={s.lunedi} s={s} p={premi} provvisoria={false} />)}
                    {premi.inCorso && <Settimana s={premi.inCorso} p={premi} provvisoria />}
                    {premi.future.length > 0 && (
                        <div className="text-sm text-ash-500">
                            Ancora da iniziare: {premi.future.map(f => dateSettimana(f.lunedi, f.sabato)).join(", ")}.
                        </div>
                    )}
                    <div className="text-xs text-ash-500">
                        Importi lordi. Le settimane registrate in{" "}
                        <Link href="/admin/diretta/premi-settimana" className="font-semibold underline">Premi della settimana</Link>{" "}
                        usano i numeri registrati; le altre sono ricalcolate (aggiornate ogni 2 minuti).
                    </div>
                </>
            )}
        </div>
    )
}

function Riepilogo({ p }: { p: PremiMese }) {
    const mese = nomeMese(p.mese)
    return (
        <section className="rounded-2xl border border-ash-200 bg-white p-5">
            <h2 className="text-base font-bold text-brand-charcoal">Totale di {mese}</h2>
            {p.righe.length === 0 ? (
                <div className="mt-1 text-sm text-ash-500">Nessun GDO.</div>
            ) : (
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[360px] text-left text-sm tabular-nums">
                        <thead>
                            <tr className="text-ash-500">
                                <th scope="col" className="py-1 font-medium">GDO</th>
                                <th scope="col" className="py-1 text-right font-medium">Settimane chiuse</th>
                                {p.inCorso && <th scope="col" className="py-1 text-right font-medium">In maturazione</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {p.righe.map(r => (
                                <tr key={r.userId} className="border-t border-ash-100">
                                    <th scope="row" className="py-1.5 font-normal">{r.nome}</th>
                                    <td className="py-1.5 text-right font-semibold">{euroIt(r.euroMese)}</td>
                                    {p.inCorso && <td className="py-1.5 text-right text-ash-500">{euroIt(r.euroInMaturazione)}</td>}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-ash-200">
                                <th scope="row" className="py-2 text-left font-bold text-brand-charcoal">Totale</th>
                                <td className="py-2 text-right font-bold text-brand-charcoal">{euroIt(p.totaleMese)}</td>
                                {p.inCorso && <td className="py-2 text-right text-ash-500">{euroIt(p.totaleInMaturazione)}</td>}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
            {p.chiuse.length === 0 && <div className="mt-2 text-sm text-ash-500">Nessuna settimana di {mese} è ancora chiusa.</div>}
        </section>
    )
}

function Settimana({ s, p, provvisoria }: { s: SettimanaDelMese; p: PremiMese; provvisoria: boolean }) {
    const righe = p.righe.filter(r => s.voci[r.userId]).map(r => ({ ...r, v: s.voci[r.userId] }))
    return (
        <section className="rounded-2xl border border-ash-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-brand-charcoal">Settimana {dateSettimana(s.lunedi, s.sabato)}</h2>
                <div className="text-sm text-ash-500">
                    {provvisoria ? "In corso: numeri provvisori, la classifica si decide sabato." : s.registrata ? "Registrata." : "Chiusa, ricalcolata."}
                </div>
            </div>
            {righe.length === 0 ? (
                <div className="mt-2 text-sm text-ash-500">Nessuna presenza.</div>
            ) : (
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm tabular-nums">
                        <thead>
                            <tr className="text-ash-500">
                                <th scope="col" className="py-1 font-medium">GDO</th>
                                <th scope="col" className="py-1 text-right font-medium">Presenze</th>
                                <th scope="col" className="py-1 text-right font-medium">Bonus presenze</th>
                                <th scope="col" className="py-1 text-right font-medium">Classifica{provvisoria ? " (provv.)" : ""}</th>
                                <th scope="col" className="py-1 text-right font-medium">Totale</th>
                            </tr>
                        </thead>
                        <tbody>
                            {righe.map(r => (
                                <tr key={r.userId} className="border-t border-ash-100">
                                    <th scope="row" className="py-1.5 font-normal">{r.nome}</th>
                                    <td className="py-1.5 text-right">{r.v.presenze}</td>
                                    <td className="py-1.5 text-right">{euroIt(r.v.euroPresenze)}</td>
                                    <td className="py-1.5 text-right">
                                        {r.v.posizione !== null ? `${r.v.posizione}° · ${euroIt(r.v.euroClassifica)}` : "-"}
                                    </td>
                                    <td className="py-1.5 text-right font-semibold">{euroIt(r.v.euro)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-ash-200">
                                <th scope="row" colSpan={4} className="py-2 text-left font-bold text-brand-charcoal">Totale settimana</th>
                                <td className="py-2 text-right font-bold text-brand-charcoal">{euroIt(s.totaleEuro)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </section>
    )
}
