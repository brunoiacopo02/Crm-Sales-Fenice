import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react'
import { getStatisticheFissatore } from '@/app/actions/fissatoreStatsActions'
import { conRuoloDb } from '@/lib/auth/ruoloDb'
import { mesePrecedente, percentuale, semaforo, type Direzione, type RestituzioniPerMotivo, type Semaforo } from '@/lib/bot-fissatore/statisticheFissatore'
import {
    PIANO_CONFERMA_BOT, PIANO_PRESENZA_CONFERMATI, DIREZIONE_OBIETTIVI, obiettivoInProporzione, testoFonte,
    type ChiaveObiettivo,
} from '@/lib/bot-fissatore/obiettiviFissatore'
import { ObiettiviFissatoreForm } from './ObiettiviFissatoreForm'

// Pagella del bot (PO 2026-10-28): una riga per numero, in parole semplici,
// con questo mese, obiettivo, esito e mese prima. I conti stanno in
// src/lib/bot-fissatore/statisticheFissatore.ts.

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

type Riga = {
    cosa: string
    spiegazione: string
    valore: string
    dettaglio: string
    obiettivo: string | null
    fonte: string | null
    esito: Semaforo | null
    prima: string
}

function Esito({ s }: { s: Semaforo | null }) {
    if (!s) return <div className="text-xs text-ash-400">-</div>
    return s === 'verde'
        ? <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><div className="h-2 w-2 rounded-full bg-emerald-500" />Ok</div>
        : <div className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"><div className="h-2 w-2 rounded-full bg-red-500" />Sotto</div>
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
                <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">Statistiche fissatore</h1>
                <div className="mt-6 rounded-xl border border-dashed border-ash-300 bg-white p-12 text-center text-ash-400">
                    Account del bot non trovato.
                </div>
            </div>
        )
    }

    const { questo: q, prima: p, mesePrima, obiettivi: ob } = stats
    const fq = q.funnel, fp = p.funnel
    const lq = q.linea, lp = p.linea
    const meseSucc = meseDopo(stats.mese)
    const puoAvanti = meseSucc <= stats.meseCorrente
    const inCorso = stats.mese === stats.meseCorrente

    const sem = (k: ChiaveObiettivo, v: number | null) => semaforo(v, ob[k].valore, DIREZIONE_OBIETTIVI[k])
    const obPct = (k: ChiaveObiettivo) => ob[k].valore === null ? null : pct(ob[k].valore)
    const fonte = (k: ChiaveObiettivo) => ob[k].valore === null ? null : testoFonte(ob[k])
    const sottoMeglio = (k: ChiaveObiettivo, testo: string | null) =>
        testo && (DIREZIONE_OBIETTIVI[k] as Direzione) === 'basso' ? `${testo} o meno` : testo

    const obApp = ob.appuntamenti
    const propApp = obApp.valore === null ? null : obiettivoInProporzione(obApp.valore, stats.mese, new Date(stats.calcolatoIl))

    const righe: Riga[] = [
        {
            cosa: 'Appuntamenti fissati dal bot',
            spiegazione: 'Quanti appuntamenti ha preso il bot in questo mese.',
            valore: num(q.appuntamentiDelMese),
            dettaglio: '',
            obiettivo: obApp.valore === null || !propApp
                ? null
                : propApp.inCorso
                    ? `${num(Math.round(propApp.valore))} a oggi`
                    : `${num(obApp.valore)} nel mese`,
            fonte: obApp.valore === null || !propApp
                ? null
                : propApp.inCorso
                    ? `${num(obApp.valore)} al mese, ${propApp.giorniTrascorsi} giorni su ${propApp.giorniMese} · ${testoFonte(obApp)}`
                    : testoFonte(obApp),
            esito: propApp ? semaforo(q.appuntamentiDelMese, propApp.valore, 'alto') : null,
            prima: num(p.appuntamentiDelMese),
        },
        {
            cosa: 'Lead che rispondono al bot',
            spiegazione: 'Su tutti i lead dati al bot, quanti gli hanno scritto almeno una volta.',
            valore: pct(fq.pctRisposta),
            dettaglio: `${num(fq.risposti)} su ${num(fq.ricevuti)}`,
            obiettivo: obPct('risposta'),
            fonte: fonte('risposta'),
            esito: sem('risposta', fq.pctRisposta),
            prima: pct(fp.pctRisposta),
        },
        {
            cosa: 'Lead fissati, su tutti quelli ricevuti',
            spiegazione: 'Su tutti i lead dati al bot, quanti hanno preso un appuntamento.',
            valore: pct(fq.pctFissaggioTotale),
            dettaglio: `${num(fq.fissati)} su ${num(fq.ricevuti)}`,
            obiettivo: obPct('fissaggioTotale'),
            fonte: fonte('fissaggioTotale'),
            esito: sem('fissaggioTotale', fq.pctFissaggioTotale),
            prima: pct(fp.pctFissaggioTotale),
        },
        {
            cosa: 'Lead fissati, su quelli che rispondono',
            spiegazione: 'Fra chi ha scritto al bot, quanti hanno preso un appuntamento.',
            valore: pct(fq.pctFissaggioRisposti),
            dettaglio: `${num(fq.fissati)} su ${num(fq.risposti)}`,
            obiettivo: obPct('fissaggioRisposti'),
            fonte: fonte('fissaggioRisposti'),
            esito: sem('fissaggioRisposti', fq.pctFissaggioRisposti),
            prima: pct(fp.pctFissaggioRisposti),
        },
        {
            cosa: 'Lead che il bot ridà ai GDO',
            spiegazione: 'Quanti lead il bot non è riuscito a fissare e ha restituito. Più basso è meglio.',
            valore: pct(fq.pctRestituzione),
            dettaglio: `${num(fq.restituiti)} su ${num(fq.ricevuti)}`,
            obiettivo: sottoMeglio('restituzione', obPct('restituzione')),
            fonte: fonte('restituzione'),
            esito: sem('restituzione', fq.pctRestituzione),
            prima: pct(fp.pctRestituzione),
        },
        {
            cosa: 'Appuntamenti confermati',
            spiegazione: 'Fra gli appuntamenti del bot già passati, quanti le Conferme hanno confermato.',
            valore: pct(lq.pctConferma),
            dettaglio: `${num(lq.confermati)} su ${num(lq.appuntamenti)}`,
            obiettivo: pct(PIANO_CONFERMA_BOT.linea),
            fonte: `minimo del piano (base ${pct(PIANO_CONFERMA_BOT.base)})`,
            esito: semaforo(lq.pctConferma, PIANO_CONFERMA_BOT.linea, 'alto'),
            prima: pct(lp.pctConferma),
        },
        {
            cosa: 'Confermati che si presentano',
            spiegazione: 'Fra i confermati, quanti si sono presentati alla call col venditore.',
            valore: pct(lq.pctPresenza),
            dettaglio: `${num(lq.presentatiConfermati)} su ${num(lq.confermati)}`,
            obiettivo: pct(PIANO_PRESENZA_CONFERMATI.linea),
            fonte: `minimo del piano (base ${pct(PIANO_PRESENZA_CONFERMATI.base)})`,
            esito: semaforo(lq.pctPresenza, PIANO_PRESENZA_CONFERMATI.linea, 'alto'),
            prima: pct(lp.pctPresenza),
        },
        {
            cosa: 'Presentati che comprano',
            spiegazione: 'Fra chi si è presentato, quanti hanno firmato.',
            valore: pct(lq.pctClosing),
            dettaglio: `${num(lq.chiusi)} su ${num(lq.presentati)}${lq.inLavorazione > 0 ? ` · ${num(lq.inLavorazione)} senza esito` : ''}`,
            obiettivo: null,
            fonte: 'il piano non lo fissa per il bot',
            esito: null,
            prima: pct(lp.pctClosing),
        },
    ]

    const sotto = righe.filter(r => r.esito === 'rosso').length
    const ok = righe.filter(r => r.esito === 'verde').length

    return (
        <div className="space-y-8 p-6 lg:p-8">
            {/* Intestazione + mese */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-brand-charcoal">
                        <Activity className="h-6 w-6 text-brand-orange" /> Statistiche fissatore
                    </h1>
                    <p className="mt-1 text-sm text-ash-500">
                        <span className="font-semibold capitalize text-brand-charcoal">{nomeMese(stats.mese)}</span>
                        {' '}· come ha lavorato il bot sui lead evergreen (lanci e database esclusi)
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

            {/* Il percorso dei lead */}
            <section>
                <h2 className="mb-3 text-lg font-semibold text-brand-charcoal">I lead del mese, passo per passo</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Passo titolo="Dati al bot" n={fq.ricevuti} sotto="" />
                    <Passo titolo="Gli hanno risposto" n={fq.risposti} sotto={`${pct(fq.pctRisposta)} dei lead`} />
                    <Passo titolo="Hanno preso un appuntamento" n={fq.fissati} sotto={`${pct(fq.pctFissaggioTotale)} dei lead`} evidenza />
                    <Passo titolo="Ridati ai GDO" n={fq.restituiti} sotto={`${pct(fq.pctRestituzione)} dei lead`} />
                </div>
                {inCorso ? (
                    <p className="mt-2 text-sm text-ash-500">
                        Il mese è in corso: i lead arrivati negli ultimi giorni il bot li sta ancora lavorando, quindi queste percentuali salgono nei prossimi giorni.
                    </p>
                ) : null}
            </section>

            {/* Pagella */}
            <section>
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold text-brand-charcoal">Pagella del mese</h2>
                    <div className="text-sm text-ash-500">
                        {ok} {ok === 1 ? 'numero' : 'numeri'} in linea con l&apos;obiettivo, {sotto} sotto
                    </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-ash-200/60 bg-white shadow-soft">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-ash-100 text-left text-xs uppercase tracking-wider text-ash-500">
                                <th className="px-4 py-3 font-semibold">Cosa misuriamo</th>
                                <th className="px-4 py-3 text-right font-semibold capitalize">{nomeMese(stats.mese)}</th>
                                <th className="px-4 py-3 text-right font-semibold">Obiettivo</th>
                                <th className="px-4 py-3 font-semibold">Esito</th>
                                <th className="px-4 py-3 text-right font-semibold capitalize">{nomeMese(mesePrima)}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-100">
                            {righe.map(r => (
                                <tr key={r.cosa} className="align-top">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-brand-charcoal">{r.cosa}</div>
                                        <div className="mt-0.5 text-xs text-ash-500">{r.spiegazione}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="text-lg font-bold text-brand-charcoal">{r.valore}</div>
                                        {r.dettaglio ? <div className="text-xs text-ash-500">{r.dettaglio}</div> : null}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="font-semibold text-brand-charcoal">{r.obiettivo ?? '-'}</div>
                                        {r.fonte ? <div className="text-xs text-ash-400">{r.fonte}</div> : null}
                                    </td>
                                    <td className="px-4 py-3"><Esito s={r.esito} /></td>
                                    <td className="px-4 py-3 text-right text-ash-600">{r.prima}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Lead ridati */}
            <section>
                <h2 className="mb-1 text-lg font-semibold text-brand-charcoal">I lead che il bot ha ridato ai GDO</h2>
                <p className="mb-3 text-sm text-ash-500">Divisi per motivo. Tra parentesi {nomeMese(mesePrima)}.</p>
                <div className="overflow-x-auto rounded-xl border border-ash-200/60 bg-white shadow-soft">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-ash-100 text-left text-xs uppercase tracking-wider text-ash-500">
                                <th className="px-4 py-3 font-semibold">Perché li ha ridati</th>
                                <th className="px-4 py-3 text-right font-semibold">Quanti</th>
                                <th className="px-4 py-3 text-right font-semibold">Su tutti i lead del bot</th>
                                <th className="px-4 py-3 text-right font-semibold">Passati a un GDO</th>
                                <th className="px-4 py-3 text-right font-semibold">Oggi senza nessun GDO</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-100">
                            <RigaRidati nome="Non hanno mai risposto" q={fq.maiRisposto} p={fp.maiRisposto} ricevuti={fq.ricevuti} ricevutiPrima={fp.ricevuti} />
                            <RigaRidati nome="Hanno smesso di rispondere" q={fq.chatInterrotta} p={fp.chatInterrotta} ricevuti={fq.ricevuti} ricevutiPrima={fp.ricevuti} />
                        </tbody>
                    </table>
                </div>
                <p className="mt-2 text-sm text-ash-500">
                    &quot;Oggi senza nessun GDO&quot; sono i lead ridati che in questo momento nessuno ha da chiamare.
                </p>
            </section>

            {/* Obiettivi */}
            <section>
                <h2 className="mb-1 text-lg font-semibold text-brand-charcoal">Cambia gli obiettivi</h2>
                <p className="mb-3 text-sm text-ash-500">
                    Confermati e presenze hanno il minimo fissato dal piano e non si cambiano da qui.
                </p>
                {stats.isAdmin ? (
                    <ObiettiviFissatoreForm salvati={stats.obiettiviSalvati} obiettivi={ob} />
                ) : (
                    <div className="rounded-xl border border-ash-200/60 bg-white p-4 text-sm text-ash-500 shadow-soft">
                        Gli obiettivi li cambia l&apos;admin.
                    </div>
                )}
            </section>
        </div>
    )
}

function Passo({ titolo, n, sotto, evidenza = false }: { titolo: string; n: number; sotto: string; evidenza?: boolean }) {
    return (
        <div className={`rounded-xl border bg-white p-4 shadow-soft ${evidenza ? 'border-brand-orange/50' : 'border-ash-200/60'}`}>
            <div className="text-sm text-ash-600">{titolo}</div>
            <div className={`mt-1 text-3xl font-bold tracking-tight ${evidenza ? 'text-brand-orange' : 'text-brand-charcoal'}`}>{num(n)}</div>
            <div className="mt-0.5 h-4 text-xs text-ash-500">{sotto}</div>
        </div>
    )
}

function RigaRidati({ nome, q, p, ricevuti, ricevutiPrima }: {
    nome: string
    q: RestituzioniPerMotivo
    p: RestituzioniPerMotivo
    ricevuti: number
    ricevutiPrima: number
}) {
    const cella = (a: string, b: string) => (
        <td className="px-4 py-3 text-right">
            <span className="font-semibold text-brand-charcoal">{a}</span>
            <span className="ml-1 text-xs text-ash-400">({b})</span>
        </td>
    )
    return (
        <tr>
            <td className="px-4 py-3 font-medium text-brand-charcoal">{nome}</td>
            {cella(num(q.totale), num(p.totale))}
            {cella(pct(percentuale(q.totale, ricevuti)), pct(percentuale(p.totale, ricevutiPrima)))}
            {cella(num(q.aUnGdo), num(p.aUnGdo))}
            {cella(num(q.ancoraDaChiamare), num(p.ancoraDaChiamare))}
        </tr>
    )
}
