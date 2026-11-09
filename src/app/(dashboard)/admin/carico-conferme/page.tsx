import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { numeroIt, numeroItFino } from "@/lib/diretta/formato"
import { leggiCaricoConferme } from "@/lib/conferme/caricoConfermeDb"
import type { CaricoConferme, Conteggio, GiornoCarico, RigaGruppo } from "@/lib/conferme/caricoConferme"
import { Indietro, NonDisponibile, PaginaAdmin, Sezione, TitoloAdmin, Vuoto } from "@/components/diretta/admin/ui"
import { AggiornaCarico } from "./AggiornaCarico"

export const dynamic = "force-dynamic"

/**
 * Carico di lavoro delle Conferme nei prossimi due giorni lavorativi (PO
 * 09/11/2026), nella sezione Sales Manager del menu. Solo lettura, solo ADMIN.
 * Regole in src/lib/conferme/caricoConferme.ts (le stesse della board,
 * boardWindow.ts); dati in cache 45 secondi, pagina riletta ogni minuto a
 * scheda visibile.
 */
export default async function CaricoConfermePage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")
    const c = await leggiCaricoConferme()

    return (
        <PaginaAdmin larga>
            <Indietro href="/panoramica-generale">Sales Manager</Indietro>
            <TitoloAdmin
                prima="Carico delle"
                accento="Conferme"
                sotto={<>Quanti lead le Conferme devono sentire domani e dopodomani, con le stesse regole della loro board. Mattina vuol dire prima delle 15, pomeriggio dalle 15. Le percentuali sono sempre sul totale.</>}
            />
            {!c ? (
                <div className="mt-6 rounded-[16px] bg-[#262626] p-5"><NonDisponibile /></div>
            ) : (
                <Contenuto c={c} />
            )}
        </PaginaAdmin>
    )
}

// ── Formati ──────────────────────────────────────────────────────────────

const n = (v: number) => numeroIt(v)
const GIORNI_SETTIMANA = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"]

function etichettaGiorno(g: string): string {
    const d = new Date(`${g}T12:00:00Z`)
    return `${GIORNI_SETTIMANA[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`
}

function oraConSecondi(iso: string): string {
    const p = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(iso))
    const v = (t: string) => p.find(x => x.type === t)?.value ?? "00"
    return `${v("hour")}:${v("minute")}:${v("second")}`
}

/** Percentuale sul totale, sempre. */
function pc(parte: number, totale: number): string {
    return totale > 0 ? `${numeroItFino((parte / totale) * 100, 1)}%` : "—"
}

// ── Pezzi ────────────────────────────────────────────────────────────────

const TH = "whitespace-nowrap px-3 pb-2 text-right text-[13px] font-normal text-[#BFBFBF] first:pl-0 first:text-left"
const TD = "whitespace-nowrap border-t-2 border-[#2E2E2E] px-3 py-2 text-right align-top first:pl-0"
const TH_RIGA = "whitespace-nowrap border-t-2 border-[#2E2E2E] py-2 pr-3 text-left align-top font-normal"

function Tabella({ intestazioni, children, min = 560 }: { intestazioni: string[]; children: ReactNode; min?: number }) {
    return (
        <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-[14px] tabular-nums" style={{ minWidth: min }}>
                <thead><tr>{intestazioni.map((h, i) => <th key={i} scope="col" className={TH}>{h}</th>)}</tr></thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    )
}

function Piccolo({ children }: { children: ReactNode }) {
    return <div className="text-[12.5px] font-normal text-[#BFBFBF]">{children}</div>
}

function Numero({ valore, etichetta, forte = false }: { valore: string; etichetta: ReactNode; forte?: boolean }) {
    return (
        <div className={`min-w-0 rounded-[16px] p-4 sm:p-5 ${forte ? "bg-[#33261A]" : "bg-[#1F1F1F]"}`}>
            <div className={`text-[30px] font-semibold leading-none tracking-[-0.02em] sm:text-[36px] ${forte ? "text-[#FF9330]" : ""}`}>{valore}</div>
            <div className="mt-2 text-[13.5px] leading-snug text-[#BFBFBF]">{etichetta}</div>
        </div>
    )
}

function Sottotitolo({ children }: { children: ReactNode }) {
    return <h3 className="mb-2 text-[14px] font-semibold text-[#F2F2F2]">{children}</h3>
}

/** Valore con la sua percentuale sul totale sotto. */
function ConPc({ v, totale }: { v: number; totale: number }) {
    return <>{n(v)}{v > 0 && <Piccolo>{pc(v, totale)}</Piccolo>}</>
}

// ── Pagina ───────────────────────────────────────────────────────────────

function Contenuto({ c }: { c: CaricoConferme }) {
    return (
        <>
            <AggiornaCarico oraDati={oraConSecondi(c.calcolatoAlle)} />
            <CallPerOra c={c} />
            {c.giorni.map(g => <Giorno key={g.giorno} g={g} />)}
            <ComeSiConta />
        </>
    )
}

function CallPerOra({ c }: { c: CaricoConferme }) {
    return (
        <Sezione titolo="Le call di domani e dopodomani, per ora" className="mt-4">
            <Tabella intestazioni={["Giorno", "Mattina (prima delle 15)", "Pomeriggio (dalle 15)", "Totale", "Confermati", "Scartati", "Da fare"]} min={720}>
                {c.giorni.map(g => (
                    <tr key={g.giorno}>
                        <th scope="row" className={TH_RIGA}>
                            {etichettaGiorno(g.giorno)}
                            {g.callFuoriBoard > 0 && <Piccolo>{n(g.callFuoriBoard)} prima delle 9 o dopo le 21: fuori dalla board</Piccolo>}
                        </th>
                        <td className={TD}><ConPc v={g.call.mattina} totale={g.call.totale} /></td>
                        <td className={TD}><ConPc v={g.call.pomeriggio} totale={g.call.totale} /></td>
                        <td className={`${TD} font-semibold`}>{n(g.call.totale)}</td>
                        <td className={TD}><ConPc v={g.call.confermati} totale={g.call.totale} /></td>
                        <td className={TD}><ConPc v={g.call.scartati} totale={g.call.totale} /></td>
                        <td className={`${TD} font-semibold text-[#FF9330]`}><ConPc v={g.call.daFare} totale={g.call.totale} /></td>
                    </tr>
                ))}
            </Tabella>
            {c.callDomenica > 0 && (
                <div className="mt-3 text-[13.5px] leading-snug text-[#FF9330]">
                    {c.callDomenica === 1 ? "C'è 1 call" : `Ci sono ${n(c.callDomenica)} call`} di domenica: la domenica le Conferme non lavorano e la board non le porta in nessun giorno.
                </div>
            )}
        </Sezione>
    )
}

const GRUPPI: { chiave: keyof GiornoCarico["lavoro"]; nome: (g: GiornoCarico) => string; nota: string }[] = [
    { chiave: "giorno_stesso", nome: g => `Call di ${etichettaGiorno(g.giorno)}`, nota: "le chiamate del giorno stesso, fino a 3" },
    { chiave: "prima_chiamata", nome: g => `Call di ${etichettaGiorno(g.giornoDopo)}`, nota: "1ª chiamata il giorno prima, le altre il giorno della call" },
    { chiave: "richiamo", nome: () => "Richiami delle Conferme", nota: "parcheggiati e richiami a orario che cadono in questo giorno" },
]

function Giorno({ g }: { g: GiornoCarico }) {
    const t = g.totaleLavoro
    return (
        <Sezione titolo={`${etichettaGiorno(g.giorno)[0].toUpperCase()}${etichettaGiorno(g.giorno).slice(1)}: chi sentire`} className="mt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Numero forte valore={n(t.daFare)} etichetta="lead da sentire in tutto" />
                <Numero valore={n(t.daFareMattina)} etichetta={<>con la call o il richiamo la mattina, il {pc(t.daFareMattina, t.daFare)} del totale</>} />
                <Numero valore={n(t.daFarePomeriggio)} etichetta={<>con la call o il richiamo il pomeriggio, il {pc(t.daFarePomeriggio, t.daFare)} del totale</>} />
            </div>

            <div className="mt-5">
                <Sottotitolo>Da dove arrivano</Sottotitolo>
                <Tabella intestazioni={["", "In lista", "Già confermati", "Già scartati", "Da sentire", "di cui mattina", "di cui pomeriggio"]} min={760}>
                    {GRUPPI.map(gr => {
                        const r = g.lavoro[gr.chiave]
                        return (
                            <tr key={gr.chiave}>
                                <th scope="row" className={TH_RIGA}>{gr.nome(g)}<Piccolo>{gr.nota}</Piccolo></th>
                                <td className={TD}>{n(r.totale)}</td>
                                <td className={TD}>{n(r.confermati)}</td>
                                <td className={TD}>{n(r.scartati)}</td>
                                <td className={`${TD} font-semibold text-[#FF9330]`}>{n(r.daFare)}</td>
                                <td className={TD}>{n(r.daFareMattina)}</td>
                                <td className={TD}>{n(r.daFarePomeriggio)}</td>
                            </tr>
                        )
                    })}
                    <tr>
                        <th scope="row" className={`${TH_RIGA} font-semibold`}>Totale</th>
                        <td className={`${TD} font-semibold`}>{n(t.totale)}</td>
                        <td className={`${TD} font-semibold`}><ConPc v={t.confermati} totale={t.totale} /></td>
                        <td className={`${TD} font-semibold`}><ConPc v={t.scartati} totale={t.totale} /></td>
                        <td className={`${TD} font-semibold text-[#FF9330]`}><ConPc v={t.daFare} totale={t.totale} /></td>
                        <td className={`${TD} font-semibold`}>{n(t.daFareMattina)}</td>
                        <td className={`${TD} font-semibold`}>{n(t.daFarePomeriggio)}</td>
                    </tr>
                </Tabella>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 2xl:grid-cols-3">
                <PerGruppo titolo="Per funnel" righe={g.perFunnel} totale={t} />
                <PerGruppo titolo="Per venditore assegnato" righe={g.perVenditore} totale={t} />
                <PerGruppo
                    titolo="Chi delle Conferme"
                    righe={g.perConferme}
                    totale={t}
                    nota="Il CRM non assegna i lead a una persona delle Conferme: lavorano tutte dalla stessa board. Qui c'è chi ha messo l'esito; chi è ancora da sentire è nella board comune."
                />
            </div>
        </Sezione>
    )
}

function PerGruppo({ titolo, righe, totale, nota }: { titolo: string; righe: RigaGruppo[]; totale: Conteggio; nota?: string }) {
    return (
        <div className="min-w-0">
            <Sottotitolo>{titolo}</Sottotitolo>
            {nota && <div className="mb-2 text-[13px] leading-snug text-[#BFBFBF]">{nota}</div>}
            {righe.length === 0 ? (
                <Vuoto>Nessun lead.</Vuoto>
            ) : (
                <Tabella intestazioni={["", "In lista", "Da sentire", "mattina", "pomeriggio", "Confermati", "Scartati"]} min={520}>
                    {righe.map(r => (
                        <tr key={r.nome} className={r.bf ? "bg-[#33261A]" : undefined}>
                            <th scope="row" className={`${TH_RIGA} ${r.bf ? "pl-2 font-semibold text-[#FF9330]" : ""}`}>
                                {r.nome}
                                <Piccolo>{pc(r.totale, totale.totale)} del totale</Piccolo>
                            </th>
                            <td className={TD}>{n(r.totale)}</td>
                            <td className={`${TD} font-semibold`}>{n(r.daFare)}</td>
                            <td className={TD}>{n(r.daFareMattina)}</td>
                            <td className={TD}>{n(r.daFarePomeriggio)}</td>
                            <td className={TD}>{n(r.confermati)}</td>
                            <td className={TD}>{n(r.scartati)}</td>
                        </tr>
                    ))}
                </Tabella>
            )}
        </div>
    )
}

function ComeSiConta() {
    return (
        <Sezione titolo="Come si conta" className="mt-4">
            <div className="max-w-4xl space-y-2 text-[14px] leading-relaxed text-[#BFBFBF]">
                <div>Le regole sono quelle della board delle Conferme. In una giornata di lavoro le Conferme sentono:</div>
                <div>1. le call di quel giorno dalle 9 alle 21 ancora senza esito (la colonna Oggi), con le chiamate del giorno stesso;</div>
                <div>2. le call del giorno lavorativo dopo, che prendono la 1ª chiamata il giorno prima se sono state fissate o spostate prima di quel giorno (la colonna Domani · 1ª chiamata; le call delle 9 sempre). Una call fissata domani per dopodomani non è ancora qui: arriva quando il GDO o il bot la fissano;</div>
                <div>3. i loro richiami che cadono in quel giorno: i parcheggiati con la data del richiamo e i richiami a orario.</div>
                <div>Le Conferme lavorano dal lunedì al sabato: le call del lunedì prendono la 1ª chiamata il sabato. È una fotografia di adesso: le call di domani che oggi ricevono la 1ª chiamata e vengono confermate passano fra i già confermati.</div>
            </div>
        </Sezione>
    )
}
