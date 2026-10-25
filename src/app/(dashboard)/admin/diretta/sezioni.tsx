// Sezioni del centro di controllo della Diretta (/admin/diretta). Componenti
// server: i dati arrivano già letti dalla pagina, qui si mettono in parole.
// Ore e giorni sono assoluti (alle 17:42), mai "X minuti fa": la pagina si
// ridisegna da sola una volta al minuto.

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import type { CentroDiretta, ControlliCentro, MovimentoCentro, RegistroCentro } from "@/app/actions/centroDirettaActions"
import type { ConfermeBonusSettings } from "@/app/actions/confermeDirettaActions"
import type { GamificationTargets, Fascia } from "@/lib/diretta/config"
import type { AdminCalendarDay } from "@/lib/quotes/adminTypes"
import { fraseCronaca, fraseSquadra, oraParlata, statoFinestra, traguardo } from "@/lib/diretta/home"
import { progressoSquadra } from "@/lib/conferme/bonus"
import { nomeValuta } from "@/lib/diretta/negozio"
import {
    causaleTesto, esitoTesto, euroTesto, giorniTesto, importoConSegno, maiuscola, riepilogoCalendario,
    statoLeadTesto, statoVoce, statoVoceTesto, type StatoVoce, type Valuta,
} from "@/lib/diretta/centro"
import { BarraScalini, NonDisponibile, Riga, Sezione, Vuoto, oraDi, quando } from "@/components/diretta/admin/ui"
import { numeroIt } from "@/lib/diretta/formato"

const numero = (n: number) => numeroIt(n)
const prezzo = (currency: string, n: number) => `${numero(n)} ${nomeValuta(currency, n)}`

/** Sottotitolo dentro una sezione. */
function Sottotitolo({ children }: { children: React.ReactNode }) {
    return <h3 className="mb-2 text-[14px] font-semibold text-[#F2F2F2]">{children}</h3>
}

/** Orario di una fascia in parole: "dalle 18 alle 19". */
function fasciaTesto(f: Fascia): string {
    const parla = (hhmm: string) => (hhmm.endsWith(':00') ? String(Number(hhmm.slice(0, 2))) : hhmm)
    return `dalle ${parla(f.start)} alle ${parla(f.end)}`
}

// ── Oggi ─────────────────────────────────────────────────────────────────

const FORZIERE: Record<string, string> = {
    giorno_1: 'Squadra, primo obiettivo',
    giorno_2: 'Squadra, obiettivo pieno',
    punta_1: 'Ora di punta, primo obiettivo',
    punta_2: 'Ora di punta, obiettivo pieno',
}

export function SezioneOggi({ centro }: { centro: CentroDiretta }) {
    const s = centro.squadra
    if (!s) {
        return <Sezione titolo="Oggi"><NonDisponibile /></Sezione>
    }
    const adesso = new Date(centro.calcolatoAlle)
    const o = s.obiettivi
    const finestra = s.puntaInizio && s.puntaFine ? { start: new Date(s.puntaInizio), end: new Date(s.puntaFine) } : null
    const punta = statoFinestra(adesso, finestra)
    const forzieri = centro.forzieri

    return (
        <Sezione titolo="Oggi" href="/classifica" linkTesto="Pagina Squadra">
            <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
                <div className="min-w-0">
                    <div className="text-[14px] text-[#BFBFBF]">Fissati della squadra</div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-[56px] font-semibold leading-none tracking-[-0.03em]">{s.fissati}</span>
                        {s.fissati < o.squadra[1] && <span className="text-[18px] text-[#BFBFBF]">su {traguardo(s.fissati, o.squadra)}</span>}
                    </div>
                    <div className="mt-4"><BarraScalini valore={s.fissati} scalini={o.squadra} etichetta="Fissati della squadra" /></div>
                    <div className="mt-2 text-[14px] leading-snug">{fraseSquadra(s.fissati, o.squadra)}</div>

                    <div className="mt-7 text-[14px] text-[#BFBFBF]">
                        {finestra ? <>Ora di punta, dalle {oraParlata(finestra.start)} alle {oraParlata(finestra.end)}</> : 'Ora di punta'}
                    </div>
                    {!finestra || !punta ? (
                        <div className="mt-1 text-[14px]">Oggi niente ora di punta.</div>
                    ) : punta.fase === 'prima' ? (
                        <div className="mt-1 text-[14px] leading-snug">
                            Non è ancora iniziata. Obiettivo di squadra {o.punta[0]}, poi {o.punta[1]}.
                        </div>
                    ) : (
                        <>
                            <div className="mt-1 flex items-baseline gap-2">
                                <span className="text-[36px] font-semibold leading-none">{s.punta}</span>
                                {s.punta < o.punta[1] && <span className="text-[16px] text-[#BFBFBF]">su {traguardo(s.punta, o.punta)}</span>}
                            </div>
                            <div className="mt-3"><BarraScalini valore={s.punta} scalini={o.punta} etichetta="Fissati nell'ora di punta" /></div>
                            <div className="mt-2 text-[14px] leading-snug">
                                {punta.fase === 'durante'
                                    ? `In corso, fino alle ${oraParlata(finestra.end)}.`
                                    : s.punta >= o.punta[1] ? 'Chiusa con l\'obiettivo pieno.'
                                        : s.punta >= o.punta[0] ? 'Chiusa con il primo obiettivo preso.'
                                            : `Chiusa sotto l'obiettivo di ${o.punta[0]}.`}
                            </div>
                        </>
                    )}
                </div>

                <div className="min-w-0">
                    <Sottotitolo>Forzieri aperti</Sottotitolo>
                    {forzieri === null ? (
                        <NonDisponibile />
                    ) : forzieri.length === 0 ? (
                        <Vuoto>
                            Nessuno per ora. Il primo si apre a {o.squadra[0]} fissati di squadra
                            {finestra ? ` o a ${o.punta[0]} nell'ora di punta` : ''}.
                        </Vuoto>
                    ) : (
                        <div>
                            {forzieri.map(f => (
                                <Riga
                                    key={f.id}
                                    etichetta={FORZIERE[f.kind] ?? f.kind}
                                    nota={`Alle ${oraDi(f.apertoAlle)}, a ${f.raggiunto} fissati. ${f.persone === 1 ? '1 persona' : `${f.persone} persone`}${f.piume > 0 ? `, ${f.piume} con una Piuma` : ''}.`}
                                    valore={f.tier === 'leggendario' ? 'Leggendario' : 'Raro'}
                                />
                            ))}
                        </div>
                    )}

                    <div className="mt-7">
                        <Sottotitolo>In diretta</Sottotitolo>
                        {s.cronaca.length === 0 ? (
                            <Vuoto>Ancora nessun appuntamento oggi.</Vuoto>
                        ) : (
                            <ol>
                                {s.cronaca.slice(0, 5).map(c => (
                                    <li key={c.id} className="flex gap-3 border-t-2 border-[#2E2E2E] py-2 text-[14px] first:border-t-0 first:pt-0">
                                        <span className="w-11 shrink-0 tabular-nums text-[#BFBFBF]">{oraDi(c.at)}</span>
                                        <span className="min-w-0">{fraseCronaca(c.nome || 'Qualcuno', false, c.giorno)}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                </div>
            </div>
        </Sezione>
    )
}

// ── Controlli anti-imbroglio ─────────────────────────────────────────────

export function SezioneControlli({ controlli, oggi }: { controlli: ControlliCentro | null; oggi: string }) {
    return (
        <Sezione titolo="Controlli anti-imbroglio" href="/admin/diretta/registro?storni=1" linkTesto="Tutti gli storni">
            {!controlli ? <NonDisponibile /> : <ControlliCorpo c={controlli} oggi={oggi} />}
        </Sezione>
    )
}

function ControlliCorpo({ c, oggi }: { c: ControlliCentro; oggi: string }) {
    const fissati = c.persone.reduce((a, p) => a + p.fissati, 0)
    const tolti = c.persone.reduce((a, p) => a + p.tolti, 0)
    return (
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
            <div className="min-w-0">
                <Sottotitolo>Fissati di oggi, persona per persona</Sottotitolo>
                {c.persone.length === 0 ? (
                    <Vuoto>Oggi la squadra non ha ancora fissato appuntamenti.</Vuoto>
                ) : (
                    <>
                        <table className="w-full text-[14px]">
                            <thead>
                                <tr className="text-left text-[13px] text-[#BFBFBF]">
                                    <th scope="col" className="pb-2 font-normal">Persona</th>
                                    <th scope="col" className="pb-2 text-right font-normal">Fissati</th>
                                    <th scope="col" className="pb-2 text-right font-normal">Validi</th>
                                    <th scope="col" className="pb-2 text-right font-normal">Tolti</th>
                                </tr>
                            </thead>
                            <tbody>
                                {c.persone.map(p => (
                                    <tr key={p.userId} className="border-t-2 border-[#2E2E2E]">
                                        <td className="py-2 pr-2">{p.nome || 'Senza nome'}</td>
                                        <td className="py-2 text-right tabular-nums">{p.fissati}</td>
                                        <td className="py-2 text-right tabular-nums">{p.validi}</td>
                                        <td className={`py-2 text-right tabular-nums ${p.tolti > 0 ? 'font-semibold text-[#FF9330]' : 'text-[#BFBFBF]'}`}>{p.tolti}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                            Contano solo i validi, cioè ancora in appuntamento: {fissati - tolti} su {fissati}.
                        </div>
                    </>
                )}

                {c.tolti.length > 0 && (
                    <div className="mt-6">
                        <Sottotitolo>Gli ultimi tolti</Sottotitolo>
                        <ol>
                            {c.tolti.slice(0, 5).map(t => (
                                <li key={`${t.leadId}-${t.fissatoAlle}`} className="border-t-2 border-[#2E2E2E] py-2 text-[14px] leading-snug first:border-t-0 first:pt-0">
                                    <div>
                                        <span className="tabular-nums text-[#BFBFBF]">{oraDi(t.fissatoAlle)}</span>{' '}
                                        {t.persona || 'Qualcuno'} fissa {t.lead || 'un lead'}
                                    </div>
                                    <div className="text-[13px] text-[#BFBFBF]">
                                        {t.poi
                                            ? `Poi ${esitoTesto(t.poi.outcome)} alle ${oraDi(t.poi.at)}${t.poi.persona ? `, da ${t.poi.persona}` : ''}.`
                                            : `Adesso è ${statoLeadTesto(t.stato)}.`}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}
            </div>

            <div className="min-w-0">
                <Sottotitolo>Storni della settimana</Sottotitolo>
                <Riga
                    etichetta="Scintille"
                    nota={c.storni.righe.S === 1 ? '1 storno' : `${c.storni.righe.S} storni`}
                    valore={numero(c.storni.totale.S)}
                />
                <Riga
                    etichetta="Piume"
                    nota={c.storni.righe.P === 1 ? '1 storno' : `${c.storni.righe.P} storni`}
                    valore={numero(c.storni.totale.P)}
                />
                {c.storni.ultimi.length > 0 && (
                    <div className="mt-5">
                        <Movimenti righe={c.storni.ultimi.slice(0, 4)} oggi={oggi} />
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Registro delle monete ────────────────────────────────────────────────

function Movimenti({ righe, oggi }: { righe: MovimentoCentro[]; oggi: string }) {
    return (
        <ol>
            {righe.map(m => (
                <li key={m.id} className="flex items-baseline justify-between gap-3 border-t-2 border-[#2E2E2E] py-2 text-[14px] first:border-t-0 first:pt-0">
                    <div className="min-w-0">
                        <div className="truncate">
                            <span className="tabular-nums text-[#BFBFBF]">{quando(m.at, oggi)}</span>{' '}
                            {m.persona || 'Senza nome'}
                        </div>
                        <div className="truncate text-[13px] text-[#BFBFBF]">{causaleTesto(m.reason)}</div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                        {importoConSegno(m.amount)} {nomeValuta(m.currency, Math.abs(m.amount))}
                    </div>
                </li>
            ))}
        </ol>
    )
}

const VALUTE: { v: Valuta; nome: string }[] = [{ v: 'S', nome: 'Scintille' }, { v: 'P', nome: 'Piume' }]

export function SezioneRegistro({ registro, oggi }: { registro: RegistroCentro | null; oggi: string }) {
    return (
        <Sezione titolo="Registro delle monete" href="/admin/diretta/registro" linkTesto="Tutti i movimenti">
            {!registro ? <NonDisponibile /> : (
                <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
                    <div className="min-w-0">
                        <Sottotitolo>Questa settimana</Sottotitolo>
                        <table className="w-full text-[14px]">
                            <thead>
                                <tr className="text-left text-[13px] text-[#BFBFBF]">
                                    <th scope="col" className="pb-2 font-normal"><span className="sr-only">Valuta</span></th>
                                    <th scope="col" className="pb-2 text-right font-normal">Emesse</th>
                                    <th scope="col" className="pb-2 text-right font-normal">Spese</th>
                                    <th scope="col" className="pb-2 text-right font-normal">Stornate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {VALUTE.map(({ v, nome }) => (
                                    <tr key={v} className="border-t-2 border-[#2E2E2E]">
                                        <th scope="row" className="py-2 pr-2 text-left font-normal">{nome}</th>
                                        <td className="py-2 text-right tabular-nums">{numero(registro.totali[v].emesse)}</td>
                                        <td className="py-2 text-right tabular-nums">{numero(registro.totali[v].spese)}</td>
                                        <td className="py-2 text-right tabular-nums">{numero(registro.totali[v].stornate)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                            Le spese sono al netto dei rimborsi del negozio. L&apos;azzeramento del primo giorno non conta.
                        </div>

                        <div className="mt-6 grid grid-cols-2 gap-6">
                            {([['Scintille', registro.topScintille], ['Piume', registro.topPiume]] as const).map(([nome, elenco]) => (
                                <div key={nome} className="min-w-0">
                                    <Sottotitolo>Chi ha più {nome}</Sottotitolo>
                                    {elenco.length === 0 ? <Vuoto>Nessun saldo.</Vuoto> : (
                                        <ol>
                                            {elenco.map(s => (
                                                <li key={s.id} className="flex items-baseline justify-between gap-2 border-t-2 border-[#2E2E2E] py-1.5 text-[14px] first:border-t-0 first:pt-0">
                                                    <Link href={`/admin/diretta/registro?persona=${s.id}`} className="min-w-0 truncate hover:underline">
                                                        {s.persona || 'Senza nome'}
                                                    </Link>
                                                    <span className="shrink-0 tabular-nums">{numero(s.valore)}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="min-w-0">
                        <Sottotitolo>Ultimi movimenti</Sottotitolo>
                        {registro.ultimi.length === 0 ? <Vuoto>Il registro è ancora vuoto.</Vuoto> : <Movimenti righe={registro.ultimi} oggi={oggi} />}
                    </div>
                </div>
            )}
        </Sezione>
    )
}

// ── Richieste del negozio ────────────────────────────────────────────────

export function SezioneNegozio({ negozio, oggi }: { negozio: CentroDiretta['negozio']; oggi: string }) {
    return (
        <Sezione titolo="Richieste del negozio" href="/admin/premi" linkTesto="Gestisci">
            {!negozio ? <NonDisponibile /> : negozio.daGestire === 0 ? (
                <Vuoto>Nessuna richiesta da gestire.</Vuoto>
            ) : (
                <>
                    <div className="flex items-baseline gap-2">
                        <span className="text-[40px] font-semibold leading-none text-[#FF9330]">{negozio.daGestire}</span>
                        <span className="text-[15px] text-[#BFBFBF]">da gestire</span>
                    </div>
                    <div className="mt-4">
                        {negozio.prime.map(r => (
                            <Riga
                                key={r.id}
                                etichetta={r.persona || 'Senza nome'}
                                nota={`${r.articolo}, ${quando(r.createdAt, oggi)}`}
                                valore={prezzo(r.currency, r.price)}
                            />
                        ))}
                    </div>
                </>
            )}
        </Sezione>
    )
}

// ── Citazione e consiglio ────────────────────────────────────────────────

/** "Citazione approvata, consiglio da approvare": lo stato dei due nella riga di un giorno. */
function statoBreve(kind: 'citazione' | 'vendita', stato: StatoVoce): string {
    const f = kind === 'citazione'
    switch (stato) {
        case 'manca': return 'manca'
        case 'da_approvare': return 'da approvare'
        case 'approvata': return f ? 'approvata' : 'approvato'
        case 'approvata_vuota': return f ? 'approvata senza riflessione' : 'approvato, solo la frase'
    }
}

export function SezioneCitazioni({ calendario }: { calendario: { ok: true; days: AdminCalendarDay[] } | { ok: false; error: string } }) {
    if (!calendario.ok) {
        return <Sezione titolo="Citazione e consiglio" href="/admin/citazioni" linkTesto="Approva"><NonDisponibile /></Sezione>
    }
    const days = calendario.days
    const r = riepilogoCalendario(days)
    const primo = days[0]
    const vuoto = days.every(d => !d.citazione.quote && !d.vendita.quote)

    return (
        <Sezione titolo="Citazione e consiglio" href="/admin/citazioni" linkTesto="Approva">
            {days.length === 0 || vuoto ? (
                <Vuoto>Il calendario è vuoto: citazioni e consigli non sono ancora stati caricati.</Vuoto>
            ) : (
                <>
                    <Riga
                        etichetta="Senza riflessione approvata"
                        valore={`${r.citazioni.length} su ${r.giorni}`}
                        forte={r.citazioni.length > 0}
                    />
                    <Riga
                        etichetta="Senza consiglio approvato"
                        valore={`${r.consigli.length} su ${r.giorni}`}
                        forte={r.consigli.length > 0}
                    />
                    <div className="mt-1 text-[13px] text-[#BFBFBF]">Nei prossimi {giorniTesto(r.giorni)} lavorativi.</div>

                    {primo && (
                        <div className="mt-6">
                            <Sottotitolo>{primo.isToday ? 'Oggi' : maiuscola(primo.label)}</Sottotitolo>
                            {(['citazione', 'vendita'] as const).map(kind => {
                                const e = primo[kind]
                                const stato = statoVoce(e)
                                return (
                                    <div key={kind} className="border-t-2 border-[#2E2E2E] py-2.5 first:border-t-0 first:pt-0">
                                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                                            <span className="text-[#BFBFBF]">{kind === 'citazione' ? 'Citazione' : 'Consiglio di vendita'}</span>
                                            <span className={stato === 'da_approvare' || stato === 'manca' ? 'font-semibold text-[#FF9330]' : 'text-[#BFBFBF]'}>
                                                {statoVoceTesto(stato, kind)}
                                            </span>
                                        </div>
                                        {e.quote && (
                                            <>
                                                <div className="mt-1 line-clamp-2 text-[14px] leading-snug">
                                                    {e.quote.text.trim() || e.quote.technique || 'Senza frase'}
                                                </div>
                                                <div className="mt-0.5 text-[13px] text-[#BFBFBF]">{e.quote.author}</div>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {days.length > 1 && (
                        <div className="mt-5">
                            <Sottotitolo>I prossimi giorni</Sottotitolo>
                            <ol>
                                {days.slice(1, 6).map(d => (
                                    <li key={d.day} className="border-t-2 border-[#2E2E2E] py-2 text-[14px] first:border-t-0 first:pt-0">
                                        <Link href={`/admin/citazioni#giorno-${d.day}`} className="block rounded-[8px] hover:text-[#FFFFFF]">
                                            <div>{maiuscola(d.label)}</div>
                                            <div className="text-[13px] text-[#BFBFBF]">
                                                Citazione {statoBreve('citazione', statoVoce(d.citazione))}, consiglio {statoBreve('vendita', statoVoce(d.vendita))}
                                            </div>
                                        </Link>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </>
            )}
        </Sezione>
    )
}

// ── Bonus Conferme ───────────────────────────────────────────────────────

export function SezioneBonusConferme({ bonus, adesso }: { bonus: ConfermeBonusSettings | null; adesso: Date }) {
    if (!bonus) {
        return <Sezione titolo="Bonus Conferme" href="/admin/diretta/conferme" linkTesto="Modifica"><NonDisponibile /></Sezione>
    }
    const { config } = bonus
    const conteggio = bonus.anteprima[config.unita][config.periodo]
    const p = progressoSquadra(conteggio, config)
    const unita = config.unita === 'chiusure' ? { una: 'chiusura', tante: 'chiusure' } : { una: 'presenza', tante: 'presenze' }
    const periodo = config.periodo === 'settimana'
        ? 'della settimana'
        : `di ${new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long' }).format(adesso)}`
    // Il bonus si paga a testa, a ciascun account delle Conferme (PO 25/10/2026).
    const frase = p.oltre > 0
        ? `${p.oltre} oltre la soglia: ${euroTesto(p.euro)} maturati a testa.`
        : `Ne ${p.mancano === 1 ? 'manca 1' : `mancano ${p.mancano}`} alla prima da ${euroTesto(config.euroPerUnita)} a testa.`

    return (
        <Sezione titolo="Bonus Conferme" href="/admin/diretta/conferme" linkTesto="Modifica">
            <div className="flex items-baseline gap-2">
                <span className="text-[40px] font-semibold leading-none">{p.conteggio}</span>
                <span className="text-[15px] text-[#BFBFBF]">su {p.soglia}</span>
            </div>
            <div className="mt-1 text-[14px]">{maiuscola(unita.tante)} {periodo} della squadra.</div>
            <div className="mt-3 text-[14px] font-semibold">{frase}</div>
            <div className="mt-1 text-[13px] text-[#BFBFBF]">
                Dalla {p.soglia + 1}ª {unita.una} in poi, {euroTesto(config.euroPerUnita)} a testa per ognuna.
            </div>
        </Sezione>
    )
}

// ── Obiettivi ────────────────────────────────────────────────────────────

export function SezioneObiettivi({ o }: { o: GamificationTargets }) {
    const pause = (elenco: Fascia[]) => elenco.length === 0 ? 'nessuna' : elenco.map(fasciaTesto).join(' e ')
    return (
        <Sezione titolo="Obiettivi" href="/admin/diretta/obiettivi" linkTesto="Modifica">
            <div className="grid gap-x-10 md:grid-cols-2">
                <div className="min-w-0">
                    <Riga etichetta="Fissati al giorno, a testa" valore={`${o.personale[0]} e ${o.personale[1]}`} />
                    <Riga etichetta="Fissati di squadra al giorno" valore={`${o.squadra[0]} e ${o.squadra[1]}`} />
                    <Riga
                        etichetta="Ora di punta, di squadra"
                        valore={`${o.punta[0]} e ${o.punta[1]}`}
                        nota={`${maiuscola(fasciaTesto(o.puntaFeriale))}, sabato ${fasciaTesto(o.puntaSabato)}.`}
                    />
                </div>
                <div className="min-w-0 border-t-2 border-[#2E2E2E] pt-2.5 md:border-t-0 md:pt-0">
                    <Riga
                        etichetta="Turno"
                        valore={fasciaTesto(o.turnoFeriale)}
                        nota={`Sabato ${fasciaTesto(o.turnoSabato)}.`}
                    />
                    <Riga
                        etichetta="Pause"
                        valore={String(o.pauseFeriali.length)}
                        nota={`${maiuscola(pause(o.pauseFeriali))}. Sabato ${pause(o.pauseSabato)}.`}
                    />
                    <Riga
                        etichetta="Presenze a settimana"
                        valore={String(o.presenzeObiettivo)}
                        nota={`Dalla ${o.presenzeSogliaEuro + 1}ª, ${euroTesto(o.euroPerPresenza)} l'una.`}
                    />
                </div>
            </div>
        </Sezione>
    )
}

// ── Premi della settimana (pagina del ramo economia) ─────────────────────

export function LinkPremiSettimana() {
    return (
        <Link
            href="/admin/diretta/premi-settimana"
            className="flex items-center justify-between gap-3 rounded-[16px] bg-[#262626] px-5 py-4 transition-colors hover:bg-[#2E2E2E] sm:px-6"
        >
            <div className="min-w-0">
                <div className="text-[17px] font-semibold">Premi della settimana</div>
                <div className="mt-1 text-[14px] leading-snug text-[#BFBFBF]">
                    Classifica dei primi tre, bonus presenze dei GDO e bonus Conferme: chi pagare, settimana per settimana.
                </div>
            </div>
            <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-[#BFBFBF]" strokeWidth={1.5} />
        </Link>
    )
}
