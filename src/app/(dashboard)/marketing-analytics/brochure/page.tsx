import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { FileText } from "lucide-react"
import { puoVedereMarketing } from "@/lib/brochure/accesso"
import { leggiBrochure } from "@/lib/brochure/brochureDb"
import type { Brochure, RigaStadi } from "@/lib/brochure/brochure"
import { euroIt, numeroIt, numeroItFino, oraRoma } from "@/lib/diretta/formato"
import { toRomeDateStr } from "@/lib/dateUtils"
import { AggiornaBrochure } from "./AggiornaBrochure"

export const dynamic = "force-dynamic"

/**
 * Lead della brochure gratuita (PO 10/11/2026): quanti arrivano dalla landing
 * "brochure-gratuita", quanti ricevono davvero la scheda dal bot, quanti
 * rispondono, fissano, si presentano e chiudono, per giorno, settimana e
 * professione, e chi li ha in mano adesso. Stessi accessi e stesso stile del
 * pannello "Scrivono da Telegram" di Marketing Analytics. Dati in cache 45
 * secondi (src/lib/brochure/brochureDb.ts), pagina riletta ogni minuto a
 * scheda visibile. Percentuali sempre sul totale dei lead.
 */
export default async function BrochurePage() {
    if (!(await puoVedereMarketing())) redirect("/unauthorized")
    const b = await leggiBrochure()

    return (
        <div className="flex min-h-screen flex-col bg-gray-50/50 md:h-screen md:overflow-hidden">
            <div className="flex-1 overflow-auto p-4 sm:p-8">
                <div className="mx-auto max-w-7xl space-y-8 pb-16">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-ash-900">
                                <FileText className="h-8 w-8 text-brand-orange" />
                                Lead della brochure
                            </h1>
                            <p className="mt-1 text-ash-500">
                                Chi chiede la brochure gratuita della professione e che fine fa. Percentuali sempre sul totale dei lead.
                            </p>
                        </div>
                        {b && <AggiornaBrochure oraDati={oraRoma(new Date(b.calcolatoAlle))} />}
                    </div>

                    {!b ? (
                        <div className="rounded-xl border border-ash-200 bg-white p-6 text-sm text-ash-500 shadow-sm">
                            I dati non sono disponibili in questo momento. Riprova tra un minuto.
                        </div>
                    ) : (
                        <Contenuto b={b} />
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Formati ──────────────────────────────────────────────────────────────

const pc = (v: number | null) => (v === null ? "—" : `${numeroItFino(v, 1)}%`)
const n = (v: number | null) => (v === null ? "—" : numeroIt(v))

function Card({ titolo, nota, children }: { titolo: string; nota?: ReactNode; children: ReactNode }) {
    return (
        <div className="rounded-xl border border-ash-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-ash-900">{titolo}</h2>
                {nota && <p className="max-w-md text-xs text-ash-500 sm:text-right">{nota}</p>}
            </div>
            {children}
        </div>
    )
}

function Tessera({ etichetta, valore, perc, accento = false, titolo }: {
    etichetta: string; valore: string; perc?: number | null; accento?: boolean; titolo?: string
}) {
    return (
        <div
            title={titolo}
            className={`rounded-lg border p-4 ${accento ? "border-brand-orange/30 bg-orange-50/50" : "border-ash-200 bg-ash-50/50"}`}
        >
            <div className="text-xs font-medium uppercase tracking-wide text-ash-500">{etichetta}</div>
            <div className="mt-1 flex items-baseline gap-2">
                <span className={`text-3xl font-bold tabular-nums ${accento ? "text-brand-orange" : "text-ash-900"}`}>{valore}</span>
                {perc !== undefined && perc !== null && (
                    <span className="text-sm font-medium tabular-nums text-ash-500">{pc(perc)}</span>
                )}
            </div>
        </div>
    )
}

const COLONNE = ["Lead", "Chat aperta", "Brochure inviata", "Rispondono", "Fissati", "Confermati", "Presenti", "Chiusi", "Incassato"]

function Cella({ v, p }: { v: number | null; p?: number | null }) {
    return (
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
            <span className="font-medium text-ash-900">{n(v)}</span>
            {p !== undefined && v !== null && <span className="ml-1.5 text-xs text-ash-500">{pc(p)}</span>}
        </td>
    )
}

function TabellaStadi({ prima, righe, totale }: { prima: string; righe: RigaStadi[]; totale?: RigaStadi }) {
    const riga = (r: RigaStadi, forte = false) => (
        <tr key={r.chiave} className={forte ? "border-t-2 border-ash-200 bg-ash-50 font-semibold" : "transition-colors hover:bg-ash-50"}>
            <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-ash-900">{r.etichetta}</th>
            <Cella v={r.stadi.lead} />
            <Cella v={r.stadi.conChat} p={r.perc.conChat} />
            <Cella v={r.stadi.brochure} p={r.perc.brochure} />
            <Cella v={r.stadi.risposto} p={r.perc.risposto} />
            <Cella v={r.stadi.appuntamenti} p={r.perc.appuntamenti} />
            <Cella v={r.stadi.confermati} p={r.perc.confermati} />
            <Cella v={r.stadi.presenti} p={r.perc.presenti} />
            <Cella v={r.stadi.chiusi} p={r.perc.chiusi} />
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-ash-900">{euroIt(r.stadi.euro)}</td>
        </tr>
    )
    return (
        <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-ash-200 bg-ash-50 text-ash-700">
                    <tr>
                        <th scope="col" className="px-3 py-3 text-left font-semibold">{prima}</th>
                        {COLONNE.map(c => <th key={c} scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">{c}</th>)}
                    </tr>
                </thead>
                <tbody className="divide-y divide-ash-100">
                    {righe.map(r => riga(r))}
                    {totale && riga(totale, true)}
                </tbody>
            </table>
        </div>
    )
}

function Contenuto({ b }: { b: Brochure }) {
    const t = b.totale
    const [, meseInizio, giornoInizioIso] = toRomeDateStr(new Date(b.inizio)).split("-")
    const giornoInizio = `${Number(giornoInizioIso)}/${Number(meseInizio)}`
    const avvisoBot = !b.botDisponibile
        ? "Il bot non ha risposto: chat, brochure inviate e risposte non sono disponibili in questo momento."
        : !b.schedaDisponibile
            ? "Il bot non manda ancora l'ora di invio della scheda: la colonna «Brochure inviata» resta vuota finché non la aggiunge."
            : null

    return (
        <>
            <Card
                titolo={`Dal ${giornoInizio}, tutti i lead della brochure`}
                nota={<>
                    Un lead è della brochure se arriva dalla campagna che promette il PDF (utm con «pdf» o «brochure») oppure se scrive al bot la frase del link
                    («…vorrei ricevere la scheda del corso»). Conta dal giorno in cui è arrivato o ha scritto.
                </>}
            >
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <Tessera etichetta="Arrivano" valore={numeroIt(t.stadi.lead)} accento />
                    <Tessera
                        etichetta="Ricevono la brochure"
                        valore={n(t.stadi.brochure)}
                        perc={t.perc.brochure}
                        titolo="La scheda del corso inviata davvero dal bot nella chat"
                    />
                    <Tessera
                        etichetta="Rispondono"
                        valore={n(t.stadi.risposto)}
                        perc={t.perc.risposto}
                        titolo="Scrivono almeno un messaggio al bot, oltre alla frase con cui chiedono la brochure"
                    />
                    <Tessera etichetta="Fissano" valore={numeroIt(t.stadi.appuntamenti)} perc={t.perc.appuntamenti} />
                    <Tessera etichetta="Confermati" valore={numeroIt(t.stadi.confermati)} perc={t.perc.confermati} />
                    <Tessera etichetta="Presenti" valore={numeroIt(t.stadi.presenti)} perc={t.perc.presenti} />
                    <Tessera etichetta="Chiudono" valore={numeroIt(t.stadi.chiusi)} perc={t.perc.chiusi} />
                    <Tessera etichetta="Incassato" valore={euroIt(t.stadi.euro)} />
                </div>
                <div className="mt-4 flex flex-col gap-1 text-sm text-ash-500">
                    <span>
                        Riconosciuti dalla campagna: <span className="font-medium tabular-nums text-ash-700">{b.riconosciuti.soloCampagna}</span>,
                        dalla frase scritta al bot: <span className="font-medium tabular-nums text-ash-700">{b.riconosciuti.soloFrase}</span>,
                        da entrambe: <span className="font-medium tabular-nums text-ash-700">{b.riconosciuti.entrambi}</span>.
                        {" "}Chat aperta dal bot: <span className="font-medium tabular-nums text-ash-700">{n(t.stadi.conChat)}</span>
                        {t.perc.conChat !== null && <> ({pc(t.perc.conChat)})</>}.
                    </span>
                    {avvisoBot && <span className="text-amber-700">{avvisoBot}</span>}
                </div>
                {t.stadi.lead === 0 && (
                    <p className="mt-4 text-sm text-ash-500">Nessun lead della brochure finora.</p>
                )}
            </Card>

            <Card titolo="Chi li ha in mano adesso">
                {b.inMano.length === 0 ? (
                    <p className="text-sm text-ash-500">Nessun lead.</p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {b.inMano.map(r => (
                            <div key={r.chiave} className={`rounded-lg border p-4 ${r.tipo === "bot" ? "border-brand-orange/30 bg-orange-50/50" : "border-ash-200 bg-ash-50/50"}`}>
                                <div className="truncate text-xs font-medium uppercase tracking-wide text-ash-500">
                                    {r.tipo === "gdo" ? "GDO" : r.tipo === "altro" ? "Altro" : r.tipo === "bot" ? "Bot" : "Da assegnare"}
                                </div>
                                <div className="truncate text-sm font-medium text-ash-900">{r.etichetta}</div>
                                <div className="mt-1 flex items-baseline gap-2">
                                    <span className="text-2xl font-bold tabular-nums text-ash-900">{numeroIt(r.lead)}</span>
                                    <span className="text-sm font-medium tabular-nums text-ash-500">{pc(r.perc)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <Card titolo="Per settimana" nota="Settimane da lunedì a domenica, la più recente in alto.">
                <TabellaStadi prima="Settimana" righe={b.perSettimana} totale={b.totale} />
            </Card>

            <Card titolo="Per professione" nota="Il corso scelto: quello della scheda inviata dal bot, altrimenti quello scritto nella frase del link.">
                <TabellaStadi prima="Professione" righe={b.perProfessione} totale={b.totale} />
            </Card>

            <Card titolo="Per giorno" nota="Il giorno di arrivo, il più recente in alto.">
                <TabellaStadi prima="Giorno" righe={b.perGiorno} totale={b.totale} />
            </Card>
        </>
    )
}
