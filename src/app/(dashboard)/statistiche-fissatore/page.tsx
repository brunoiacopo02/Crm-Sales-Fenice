import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Activity, CalendarCheck, ChevronLeft, ChevronRight, Target, Undo2 } from 'lucide-react'
import { getStatisticheFissatore } from '@/app/actions/fissatoreStatsActions'
import { conRuoloDb } from '@/lib/auth/ruoloDb'
import { confronto, mesePrecedente, percentuale, semaforo, type Direzione, type RestituzioniPerMotivo, type Semaforo } from '@/lib/bot-fissatore/statisticheFissatore'
import {
    PIANO_CONFERMA_BOT, PIANO_PRESENZA_CONFERMATI, TESTO_FONTE, DIREZIONE_OBIETTIVI,
    type ChiaveObiettivo, type ObiettivoRisolto,
} from '@/lib/bot-fissatore/obiettiviFissatore'
import { ObiettiviFissatoreForm } from './ObiettiviFissatoreForm'

// --------------------------------------------------------------- formato

function nomeMese(mese: string): string {
    const [a, m] = mese.split('-').map(Number)
    return new Date(Date.UTC(a, m - 1, 15, 12)).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })
}

function meseDopo(mese: string): string {
    const [a, m] = mese.split('-').map(Number)
    return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

const num = (n: number) => n.toLocaleString('it-IT')
const pct = (v: number | null) => v === null ? '-' : `${v.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
const punti = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "+1,2 punti" / "+120" rispetto al mese prima. */
function Delta({ d, tasso, mesePrima, direzione = 'alto' }: { d: number | null; tasso: boolean; mesePrima: string; direzione?: Direzione }) {
    if (d === null) return <div className="mt-0.5 text-xs text-ash-400">{nomeMese(mesePrima)}: -</div>
    const meglio = direzione === 'alto' ? d > 0 : d < 0
    const colore = d === 0 ? 'text-ash-500' : meglio ? 'text-emerald-600' : 'text-red-500'
    const segno = d > 0 ? '+' : d < 0 ? '−' : ''
    const valore = tasso ? `${punti(Math.abs(d))} punti` : num(Math.abs(d))
    return (
        <div className="mt-0.5 text-xs text-ash-500">
            <span className={`font-semibold ${colore}`}>{segno}{valore}</span> rispetto a {nomeMese(mesePrima)}
        </div>
    )
}

function Pallino({ s }: { s: Semaforo | null }) {
    if (!s) return null
    return (
        <div
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${s === 'verde' ? 'bg-emerald-500' : 'bg-red-500'}`}
            title={s === 'verde' ? 'In linea' : 'Sotto'}
        />
    )
}

function Card({ label, value, children, s }: { label: string; value: string; children?: React.ReactNode; s?: Semaforo | null }) {
    return (
        <div className="rounded-xl border border-ash-200/60 bg-white p-4 shadow-soft">
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-ash-500">{label}</div>
                <Pallino s={s ?? null} />
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-brand-charcoal">{value}</div>
            {children}
        </div>
    )
}

function RigaObiettivo({ o }: { o: ObiettivoRisolto }) {
    if (o.valore === null) return <div className="mt-2 text-xs text-ash-400">Obiettivo: da impostare</div>
    return (
        <div className="mt-2 text-xs text-ash-600">
            Obiettivo <span className="font-semibold text-brand-charcoal">{pct(o.valore)}</span>
            <span className="text-ash-400"> · {TESTO_FONTE[o.fonte]}</span>
        </div>
    )
}

function RigaPiano({ linea, base }: { linea: number; base: number }) {
    return (
        <div className="mt-2 text-xs text-ash-600">
            Linea del piano <span className="font-semibold text-brand-charcoal">{pct(linea)}</span>
            <span className="text-ash-400"> · base {pct(base)} · dal piano</span>
        </div>
    )
}

// --------------------------------------------------------------- pagina

export default async function StatisticheFissatorePage({
    searchParams,
}: {
    searchParams: Promise<{ mese?: string }>
}) {
    const utente = await conRuoloDb(['MANAGER', 'ADMIN', 'TL'])
    if (!utente) redirect('/unauthorized')

    const sp = await searchParams
    const stats = await getStatisticheFissatore(sp.mese)

    if (!stats) {
        return (
            <div className="p-6 lg:p-8">
                <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">Statistiche Fissatore</h1>
                <div className="mt-6 rounded-xl border border-dashed border-ash-300 bg-white p-12 text-center text-ash-400">
                    Account del fissatore non trovato.
                </div>
            </div>
        )
    }

    const { questo: q, prima: p, mesePrima, obiettivi: ob } = stats
    const fq = q.funnel, fp = p.funnel
    const lq = q.linea, lp = p.linea
    const meseSucc = meseDopo(stats.mese)
    const puoAvanti = meseSucc <= stats.meseCorrente

    const sem = (k: ChiaveObiettivo, v: number | null) => semaforo(v, ob[k].valore, DIREZIONE_OBIETTIVI[k])

    return (
        <div className="space-y-8 p-6 lg:p-8">
            {/* Intestazione + mese */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-brand-charcoal">
                        <Activity className="h-6 w-6 text-brand-orange" /> Statistiche Fissatore
                    </h1>
                    <p className="mt-1 text-sm text-ash-500">
                        <span className="font-semibold capitalize text-brand-charcoal">{nomeMese(stats.mese)}</span>
                        {' '}· accanto a ogni numero il confronto con {nomeMese(mesePrima)}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                    <Link
                        href={`/statistiche-fissatore?mese=${mesePrecedente(stats.mese)}`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-ash-200/60 bg-white text-ash-600 transition-colors hover:border-brand-orange/50 hover:text-brand-charcoal"
                        aria-label="Mese prima"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Link>
                    <form method="GET" className="flex items-center gap-1.5">
                        <input
                            type="month"
                            name="mese"
                            defaultValue={stats.mese}
                            className="h-9 rounded-lg border border-ash-200/60 bg-white px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30"
                        />
                        <button type="submit" className="h-9 rounded-lg bg-brand-orange px-3 text-sm font-medium text-white transition-colors hover:bg-brand-orange-600">
                            Vai
                        </button>
                    </form>
                    {puoAvanti ? (
                        <Link
                            href={`/statistiche-fissatore?mese=${meseSucc}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-ash-200/60 bg-white text-ash-600 transition-colors hover:border-brand-orange/50 hover:text-brand-charcoal"
                            aria-label="Mese dopo"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Link>
                    ) : null}
                </div>
            </div>

            {/* A. Funnel del bot */}
            <section>
                <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ash-700">
                    <Target className="h-4 w-4 text-brand-orange" /> Funnel del bot
                </h2>
                <p className="mb-3 text-xs text-ash-500">
                    I lead dati al bot nel mese (prima assegnazione). Lead di prova e del lancio esclusi.
                    I lead degli ultimi giorni sono ancora in lavorazione: i loro tassi crescono nei giorni dopo.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                    <Card label="Lead ricevuti" value={num(fq.ricevuti)}>
                        <Delta d={confronto(fq.ricevuti, fp.ricevuti)} tasso={false} mesePrima={mesePrima} />
                    </Card>
                    <Card label="% che risponde" value={pct(fq.pctRisposta)} s={sem('risposta', fq.pctRisposta)}>
                        <Delta d={confronto(fq.pctRisposta, fp.pctRisposta)} tasso mesePrima={mesePrima} />
                        <div className="mt-0.5 text-xs text-ash-400">{num(fq.risposti)} su {num(fq.ricevuti)} · stimato dal CRM</div>
                        <RigaObiettivo o={ob.risposta} />
                    </Card>
                    <Card label="% fissaggio sul totale" value={pct(fq.pctFissaggioTotale)} s={sem('fissaggioTotale', fq.pctFissaggioTotale)}>
                        <Delta d={confronto(fq.pctFissaggioTotale, fp.pctFissaggioTotale)} tasso mesePrima={mesePrima} />
                        <div className="mt-0.5 text-xs text-ash-400">{num(fq.fissati)} fissati su {num(fq.ricevuti)}</div>
                        <RigaObiettivo o={ob.fissaggioTotale} />
                    </Card>
                    <Card label="% fissaggio su chi risponde" value={pct(fq.pctFissaggioRisposti)} s={sem('fissaggioRisposti', fq.pctFissaggioRisposti)}>
                        <Delta d={confronto(fq.pctFissaggioRisposti, fp.pctFissaggioRisposti)} tasso mesePrima={mesePrima} />
                        <div className="mt-0.5 text-xs text-ash-400">{num(fq.fissati)} fissati su {num(fq.risposti)}</div>
                        <RigaObiettivo o={ob.fissaggioRisposti} />
                    </Card>
                    <Card label="% restituzioni" value={pct(fq.pctRestituzione)} s={sem('restituzione', fq.pctRestituzione)}>
                        <Delta d={confronto(fq.pctRestituzione, fp.pctRestituzione)} tasso mesePrima={mesePrima} direzione="basso" />
                        <div className="mt-0.5 text-xs text-ash-400">{num(fq.restituiti)} ridati dal bot su {num(fq.ricevuti)}</div>
                        <RigaObiettivo o={ob.restituzione} />
                    </Card>
                </div>

                {/* Restituzioni per motivo */}
                <div className="mt-4 overflow-x-auto rounded-xl border border-ash-200/60 bg-white shadow-soft">
                    <div className="flex items-center gap-2 border-b border-ash-100 px-4 py-3 text-sm font-semibold text-ash-700">
                        <Undo2 className="h-4 w-4 text-brand-orange" /> Restituzioni del bot
                    </div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase tracking-wider text-ash-500">
                                <th className="px-4 py-2 font-semibold">Motivo</th>
                                <th className="px-4 py-2 text-right font-semibold">Restituiti</th>
                                <th className="px-4 py-2 text-right font-semibold">% sui ricevuti</th>
                                <th className="px-4 py-2 text-right font-semibold">Dati a un GDO</th>
                                <th className="px-4 py-2 text-right font-semibold">Parcheggiati</th>
                                <th className="px-4 py-2 text-right font-semibold">Ancora da chiamare</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-100">
                            <RigaRestituzioni nome="Mai risposto" q={fq.maiRisposto} p={fp.maiRisposto} ricevuti={fq.ricevuti} ricevutiPrima={fp.ricevuti} mesePrima={mesePrima} />
                            <RigaRestituzioni nome="Chat interrotta" q={fq.chatInterrotta} p={fp.chatInterrotta} ricevuti={fq.ricevuti} ricevutiPrima={fp.ricevuti} mesePrima={mesePrima} />
                        </tbody>
                    </table>
                    <div className="border-t border-ash-100 px-4 py-2 text-xs text-ash-500">
                        Parcheggiati = restituiti senza darli a nessun GDO. Ancora da chiamare = oggi non ce l&apos;ha in carico nessuno.
                        Tra parentesi {nomeMese(mesePrima)}.
                    </div>
                </div>
            </section>

            {/* B. Linea del piano */}
            <section>
                <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ash-700">
                    <CalendarCheck className="h-4 w-4 text-brand-orange" /> Linea del piano
                </h2>
                <p className="mb-3 text-xs text-ash-500">
                    Gli appuntamenti fissati dal bot con data nel mese e già passati. Lanci esclusi.
                    Verde = alla linea del piano o sopra, rosso = sotto.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Card
                        label="% confermati sugli appuntamenti"
                        value={pct(lq.pctConferma)}
                        s={semaforo(lq.pctConferma, PIANO_CONFERMA_BOT.linea, 'alto')}
                    >
                        <Delta d={confronto(lq.pctConferma, lp.pctConferma)} tasso mesePrima={mesePrima} />
                        <div className="mt-0.5 text-xs text-ash-400">{num(lq.confermati)} confermati su {num(lq.appuntamenti)} appuntamenti</div>
                        <RigaPiano linea={PIANO_CONFERMA_BOT.linea} base={PIANO_CONFERMA_BOT.base} />
                    </Card>
                    <Card
                        label="% presenza sui confermati"
                        value={pct(lq.pctPresenza)}
                        s={semaforo(lq.pctPresenza, PIANO_PRESENZA_CONFERMATI.linea, 'alto')}
                    >
                        <Delta d={confronto(lq.pctPresenza, lp.pctPresenza)} tasso mesePrima={mesePrima} />
                        <div className="mt-0.5 text-xs text-ash-400">{num(lq.presentatiConfermati)} presentati su {num(lq.confermati)} confermati</div>
                        <RigaPiano linea={PIANO_PRESENZA_CONFERMATI.linea} base={PIANO_PRESENZA_CONFERMATI.base} />
                    </Card>
                    <Card label="Chiusi sui presentati" value={pct(lq.pctClosing)}>
                        <Delta d={confronto(lq.pctClosing, lp.pctClosing)} tasso mesePrima={mesePrima} />
                        <div className="mt-0.5 text-xs text-ash-400">
                            {num(lq.chiusi)} chiusi su {num(lq.presentati)} presentati
                            {lq.inLavorazione > 0 ? ` · ${num(lq.inLavorazione)} ancora senza esito` : ''}
                        </div>
                        <div className="mt-2 text-xs text-ash-400">Nessun obiettivo nel piano</div>
                    </Card>
                </div>
            </section>

            {/* C. Obiettivi */}
            <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ash-700">
                    <Target className="h-4 w-4 text-brand-orange" /> Obiettivi del funnel
                </h2>
                {stats.isAdmin ? (
                    <ObiettiviFissatoreForm salvati={stats.obiettiviSalvati} obiettivi={ob} />
                ) : (
                    <div className="rounded-xl border border-ash-200/60 bg-white p-4 text-sm text-ash-500 shadow-soft">
                        Gli obiettivi del funnel li cambia l&apos;admin.
                    </div>
                )}
            </section>
        </div>
    )
}

function RigaRestituzioni({ nome, q, p, ricevuti, ricevutiPrima, mesePrima }: {
    nome: string
    q: RestituzioniPerMotivo
    p: RestituzioniPerMotivo
    ricevuti: number
    ricevutiPrima: number
    mesePrima: string
}) {
    const cella = (a: string, b: string) => (
        <td className="px-4 py-2.5 text-right">
            <span className="font-semibold text-brand-charcoal">{a}</span>
            <span className="ml-1 text-xs text-ash-400" title={nomeMese(mesePrima)}>({b})</span>
        </td>
    )
    return (
        <tr>
            <td className="px-4 py-2.5 text-ash-700">{nome}</td>
            {cella(num(q.totale), num(p.totale))}
            {cella(pct(percentuale(q.totale, ricevuti)), pct(percentuale(p.totale, ricevutiPrima)))}
            {cella(num(q.aUnGdo), num(p.aUnGdo))}
            {cella(num(q.parcheggiati), num(p.parcheggiati))}
            {cella(num(q.ancoraDaChiamare), num(p.ancoraDaChiamare))}
        </tr>
    )
}
