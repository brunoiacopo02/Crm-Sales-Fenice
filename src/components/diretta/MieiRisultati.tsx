// "I miei risultati" del GDO in veste Diretta (collaudo del 25/10/2026). La
// pagina legge i dati sul server, tutti insieme, e questo li disegna: niente
// hook, niente grafici da caricare nel browser. Stessi numeri della pagina di
// sempre (getAdvancedKpi, getGdoTargetsProgress, getGdoCallAttemptMetrics).

import Link from "next/link"
import type { CallAttemptBucket, CallAttemptMetricsRow } from "@/app/actions/kpiAdvancedActions"
import { NonDisponibile, Riga, Sezione, Vuoto, bottone } from "@/components/diretta/admin/ui"
import { PaginaDiretta, TitoloDiretta } from "@/components/diretta/negozio/ui"
import { euroIt, numeroIt } from "@/lib/diretta/formato"
import { PERIODI, type NumeriPeriodo, type Periodo, type PuntoAndamento } from "@/lib/diretta/risultati"

export interface ObiettiviSettimana {
    dailyApptTarget: number | null
    todayAppointments: number
    weeklyConfirmedTarget: number | null
    weeklyConfirmed: number
    weeklyClosedCount: number
    weeklyRevenueEur: number
}

/** Numeri della home Diretta: fissati di oggi sul primo scalino, presenze sull'obiettivo. */
export interface NumeriDiretta {
    fissatiOggi: number
    scalino: number
    presenze: number
    presenzeObiettivo: number
}

const conTarget = (n: number, target: number | null) => (target && target > 0 ? `${numeroIt(n)} su ${numeroIt(target)}` : numeroIt(n))
const parola = (n: number, una: string, tante: string) => (n === 1 ? una : tante)

function link(periodo: string, turno: boolean): string {
    return `/kpi-gdo?periodo=${periodo}${turno ? '&turno=1' : ''}`
}

export function MieiRisultati({ periodo, turno, numeri, andamento, obiettivi, diretta = null, tentativi }: {
    diretta?: NumeriDiretta | null
    periodo: Periodo
    turno: boolean
    /** null = non si è potuto leggere: la sezione lo dice, le altre restano. */
    numeri: NumeriPeriodo | null
    andamento: PuntoAndamento[] | null
    obiettivi: ObiettiviSettimana | null
    tentativi: CallAttemptMetricsRow[] | null
}) {
    return (
        <PaginaDiretta>
            <header>
                <TitoloDiretta prima="I miei" accento="risultati" />
                <div className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[var(--d-muted)]">
                    Contati come nel resto del CRM: le chiamate sono quelle fatte da te, gli appuntamenti quelli fissati nel periodo sui tuoi lead.
                </div>
            </header>

            <nav aria-label="Periodo" className="mt-6 flex flex-wrap items-center gap-2">
                {PERIODI.map(p => (
                    <Link
                        key={p.chiave}
                        href={link(p.chiave, turno)}
                        aria-current={p.chiave === periodo.chiave ? 'page' : undefined}
                        className={bottone(p.chiave === periodo.chiave ? 'scelto' : 'linea', 'piccola')}
                    >
                        {p.etichetta}
                    </Link>
                ))}
                <Link
                    href={link(periodo.chiave, !turno)}
                    className={`${bottone(turno ? 'scelto' : 'linea', 'piccola')} sm:ml-auto`}
                    title="Conta solo le chiamate fatte fra le 13:30 e le 20:00. Gli appuntamenti restano tutti."
                >
                    Solo il turno, 13:30-20:00<span className="sr-only">{turno ? ': acceso' : ': spento'}</span>
                </Link>
            </nav>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Sezione titolo="Nel periodo" className="lg:col-span-2">
                    {numeri ? (
                        <>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                                <Numero etichetta="Appuntamenti" valore={numeroIt(numeri.appuntamenti)} forte />
                                <Numero
                                    etichetta="Fissaggio"
                                    valore={numeri.fissaggio === null ? '—' : `${numeri.fissaggio}%`}
                                    nota="sui lead chiamati"
                                />
                                <Numero etichetta="Chiamate" valore={numeroIt(numeri.chiamate)} />
                                <Numero
                                    etichetta="Risposte"
                                    valore={numeroIt(numeri.risposte)}
                                    nota={numeri.tassoRisposta === null ? undefined : `${numeri.tassoRisposta}% delle chiamate`}
                                />
                            </div>
                            <div className="mt-6">
                                <Riga etichetta="Lead chiamati" valore={numeroIt(numeri.leadChiamati)} />
                                <Riga
                                    etichetta="Confermati dalle Conferme"
                                    nota="degli appuntamenti fissati nel periodo"
                                    valore={numeri.appuntamenti > 0 ? `${numeroIt(numeri.confermati)} su ${numeroIt(numeri.appuntamenti)}` : '—'}
                                />
                                <Riga
                                    etichetta="Presentati alla call"
                                    nota="confermati e presenti, degli stessi appuntamenti"
                                    valore={numeri.appuntamenti > 0 ? `${numeroIt(numeri.presentati)} su ${numeroIt(numeri.appuntamenti)}` : '—'}
                                />
                            </div>
                        </>
                    ) : <NonDisponibile />}
                </Sezione>

                <Sezione titolo="Questa settimana">
                    {obiettivi ? (
                        <div>
                            {diretta ? (
                                <>
                                    <Riga etichetta="Appuntamenti di oggi" valore={`${numeroIt(diretta.fissatiOggi)} su ${numeroIt(diretta.scalino)}`} forte />
                                    <Riga
                                        etichetta="Presenze"
                                        nota={diretta.presenze >= diretta.presenzeObiettivo ? 'da lunedì, obiettivo raggiunto: si può andare oltre' : 'da lunedì, si può andare oltre'}
                                        valore={`${numeroIt(diretta.presenze)}, obiettivo ${numeroIt(diretta.presenzeObiettivo)}`}
                                    />
                                    <Riga etichetta="Confermati dalle Conferme" nota="da lunedì" valore={numeroIt(obiettivi.weeklyConfirmed)} />
                                </>
                            ) : (
                                <>
                                    <Riga etichetta="Appuntamenti di oggi" valore={conTarget(obiettivi.todayAppointments, obiettivi.dailyApptTarget)} forte />
                                    <Riga etichetta="Confermati dalle Conferme" nota="da lunedì" valore={conTarget(obiettivi.weeklyConfirmed, obiettivi.weeklyConfirmedTarget)} />
                                </>
                            )}
                            <Riga etichetta="Contratti firmati" nota="tuoi lead chiusi dai venditori, da lunedì" valore={numeroIt(obiettivi.weeklyClosedCount)} />
                            <Riga etichetta="Fatturato dei tuoi lead" valore={euroIt(Math.round(obiettivi.weeklyRevenueEur))} />
                        </div>
                    ) : <NonDisponibile />}
                </Sezione>
            </div>

            <Sezione titolo={periodo.granularita === 'hour' ? 'Ora per ora' : 'Giorno per giorno'} className="mt-4">
                {andamento === null ? <NonDisponibile /> : <Andamento righe={andamento} />}
            </Sezione>

            <Sezione titolo="Resa per tentativo" className="mt-4">
                {tentativi === null ? <NonDisponibile /> : <Tentativi righe={tentativi} />}
            </Sezione>
        </PaginaDiretta>
    )
}

function Numero({ etichetta, valore, nota, forte = false }: { etichetta: string; valore: string; nota?: string; forte?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="text-[14px] text-[var(--d-muted)]">{etichetta}</div>
            <div className={`mt-1 text-[32px] font-semibold leading-none tabular-nums ${forte ? 'text-[var(--d-orange)]' : ''}`}>{valore}</div>
            {nota && <div className="mt-1.5 text-[13px] leading-snug text-[var(--d-muted)]">{nota}</div>}
        </div>
    )
}

function Andamento({ righe }: { righe: PuntoAndamento[] }) {
    const massimo = Math.max(1, ...righe.map(r => r.chiamate))
    if (righe.every(r => r.chiamate === 0 && r.appuntamenti === 0)) {
        return <Vuoto>Nessuna chiamata e nessun appuntamento nel periodo.</Vuoto>
    }
    // Una riga per ora o per giorno. Da sm in su: etichetta, barra, numeri; sul
    // telefono i numeri accanto all'etichetta e la barra sotto, a tutta riga.
    // La colonna dei numeri ha una larghezza fissa, così le barre partono e
    // finiscono tutte allo stesso punto e si confrontano.
    return (
        <ul className="flex flex-col gap-2.5 text-[14px]">
            {righe.map(r => (
                <li key={r.etichetta} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 sm:grid-cols-[4.75rem_minmax(0,1fr)_15rem] sm:items-center">
                    <div className="col-start-1 row-start-1 tabular-nums text-[var(--d-muted)]">{r.etichetta}</div>
                    <div className="col-start-2 row-start-1 whitespace-nowrap text-right tabular-nums sm:col-start-3">
                        {numeroIt(r.chiamate)} <span className="text-[var(--d-muted)]">{parola(r.chiamate, 'chiamata', 'chiamate')}</span>
                        {r.appuntamenti > 0 && (
                            <>
                                <span className="text-[var(--d-muted)]">, </span>
                                <span className="font-semibold">{numeroIt(r.appuntamenti)}</span>
                                <span className="text-[var(--d-muted)]"> {parola(r.appuntamenti, 'appuntamento', 'appuntamenti')}</span>
                            </>
                        )}
                    </div>
                    <div className="col-span-2 row-start-2 h-2.5 overflow-hidden rounded-[3px] bg-[#3D3D3D] sm:col-span-1 sm:col-start-2 sm:row-start-1" aria-hidden="true">
                        <div className="h-full bg-[#8C8C8C]" style={{ width: `${(r.chiamate / massimo) * 100}%` }} />
                    </div>
                </li>
            ))}
        </ul>
    )
}

function Tentativi({ righe }: { righe: CallAttemptMetricsRow[] }) {
    const nessuna = righe.every(r => r.nuovi.calls === 0 && r.database.calls === 0)
    if (nessuna) return <Vuoto>Nessuna chiamata nel periodo.</Vuoto>
    return (
        <>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-x-12">
                <TabellaTentativi titolo="Lead nuovi" righe={righe.map(r => ({ tentativo: r.attempt, b: r.nuovi }))} />
                <TabellaTentativi titolo="Database" righe={righe.map(r => ({ tentativo: r.attempt, b: r.database }))} />
            </div>
            <div className="mt-4 text-[13px] leading-relaxed text-[var(--d-muted)]">
                Il tentativo è la posizione della chiamata nella storia del lead. Il tetto resta 3 tentativi a vuoto. Qui contano tutte le chiamate del periodo, anche fuori dal turno.
            </div>
        </>
    )
}

function TabellaTentativi({ titolo, righe }: { titolo: string; righe: { tentativo: string; b: CallAttemptBucket }[] }) {
    const cella = (b: CallAttemptBucket, v: number) => (b.calls === 0 ? '—' : `${v}%`)
    return (
        <table className="w-full text-[14px] tabular-nums">
            <caption className="mb-2 text-left text-[14px] font-semibold">{titolo}</caption>
            <thead>
                <tr className="text-[13px] text-[var(--d-muted)]">
                    <th scope="col" className="pb-2 text-left font-medium">Tentativo</th>
                    <th scope="col" className="pb-2 text-right font-medium">Chiamate</th>
                    <th scope="col" className="pb-2 text-right font-medium">Risposta</th>
                    <th scope="col" className="pb-2 text-right font-medium">Fissaggio</th>
                </tr>
            </thead>
            <tbody>
                {righe.map(({ tentativo, b }) => (
                    <tr key={tentativo} className="border-t-2 border-[#2E2E2E]">
                        <th scope="row" className="py-2 text-left font-medium">{tentativo}</th>
                        <td className="py-2 text-right">{numeroIt(b.calls)}</td>
                        <td className="py-2 text-right">{cella(b, b.answerPct)}</td>
                        <td className="py-2 text-right">{cella(b, b.apptPct)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
