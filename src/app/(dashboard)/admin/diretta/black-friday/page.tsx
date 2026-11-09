import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { toRomeDateStr } from "@/lib/dateUtils"
import { euroIt, numeroIt, numeroItFino } from "@/lib/diretta/formato"
import { leggiMonitorBf } from "@/lib/blackFriday/monitorDb"
import {
    ORE_APPUNTAMENTO_SENZA_ESITO, ORE_FERMO_SUL_BOT, ORE_RIDATO_NON_CHIAMATO,
    type Imbuto, type MonitorBf, type RigaConfronto,
} from "@/lib/blackFriday/monitor"
import { Indietro, NonDisponibile, PaginaAdmin, Sezione, TitoloAdmin, Vuoto } from "@/components/diretta/admin/ui"
import { AggiornaBlackFriday } from "./AggiornaBlackFriday"

export const dynamic = "force-dynamic"

/**
 * Monitor del Black Friday in tempo reale (PO 09/11/2026): imbuto per giorno
 * di ingresso, dove il bot lascia i lead, canali, confronto coi funnel del
 * bot, tabella dei GDO e "da tenere d'occhio". Solo ADMIN. Dati del CRM in
 * cache 45 secondi (src/lib/blackFriday/monitorDb.ts), pagina riletta ogni
 * minuto a scheda visibile. Chat, risposte, numero WhatsApp e versione di
 * Mario stanno nel database del bot, che il CRM non legge: quelle voci sono
 * segnate come non disponibili.
 */
export default async function BlackFridayPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")
    const m = await leggiMonitorBf()

    return (
        <PaginaAdmin larga>
            <Indietro href="/admin/diretta">Centro di controllo</Indietro>
            <TitoloAdmin
                prima="Black Friday"
                accento="in diretta"
                sotto={<>Tutti i lead Black Friday entrati nel CRM da sabato 7/11. Le percentuali sono sempre sul totale dei lead, come per i GDO, salvo dove è scritto.</>}
            />
            {!m ? (
                <div className="mt-6 rounded-[16px] bg-[#262626] p-5"><NonDisponibile /></div>
            ) : (
                <Contenuto m={m} />
            )}
        </PaginaAdmin>
    )
}

// ── Formati ──────────────────────────────────────────────────────────────

const n = (v: number) => numeroIt(v)
const pc = (v: number | null) => (v === null ? "—" : `${numeroItFino(v, 1)}%`)
const GIORNI_SETTIMANA = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"]

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

// ── Pezzi ────────────────────────────────────────────────────────────────

const TH = "whitespace-nowrap px-3 pb-2 text-right text-[13px] font-normal text-[#BFBFBF] first:pl-0 first:text-left"
const TD = "whitespace-nowrap border-t-2 border-[#2E2E2E] px-3 py-2 text-right align-top first:pl-0"
const TH_RIGA = "whitespace-nowrap border-t-2 border-[#2E2E2E] py-2 pr-3 text-left align-top font-normal"

/** Tabella che scorre di lato nel suo contenitore. */
function Tabella({ intestazioni, children, min = 520 }: { intestazioni: string[]; children: ReactNode; min?: number }) {
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

function Chip({ children, tipo }: { children: ReactNode; tipo: "attenzione" | "ok" }) {
    return (
        <span className={`ml-1.5 inline-block rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold ${tipo === "attenzione" ? "bg-[#3D2611] text-[#FF9330]" : "bg-[#16352A] text-[#5CC792]"}`}>
            {children}
        </span>
    )
}

function SenzaBot({ children }: { children: ReactNode }) {
    return (
        <div className="rounded-[10px] border-2 border-dashed border-[#3D3D3D] px-4 py-3 text-[13.5px] leading-snug text-[#BFBFBF]">
            <span className="font-semibold text-[#F2F2F2]">Dati del bot non disponibili.</span> {children}
        </div>
    )
}

function Numero({ valore, etichetta, forte = false }: { valore: string; etichetta: ReactNode; forte?: boolean }) {
    return (
        <div className={`min-w-0 rounded-[16px] p-4 sm:p-5 ${forte ? "bg-[#33261A]" : "bg-[#262626]"}`}>
            <div className={`text-[30px] font-semibold leading-none tracking-[-0.02em] sm:text-[36px] ${forte ? "text-[#FF9330]" : ""}`}>{valore}</div>
            <div className="mt-2 text-[13.5px] leading-snug text-[#BFBFBF]">{etichetta}</div>
        </div>
    )
}

function Sottotitolo({ children }: { children: ReactNode }) {
    return <h3 className="mb-2 text-[14px] font-semibold text-[#F2F2F2]">{children}</h3>
}

// ── Pagina ───────────────────────────────────────────────────────────────

function Contenuto({ m }: { m: MonitorBf }) {
    const T = m.imbuto.totale
    return (
        <>
            <AggiornaBlackFriday oraDati={oraConSecondi(m.calcolatoAlle)} />

            {!m.controlli.ok && (
                <div role="alert" className="mt-4 rounded-[16px] border-2 border-[#FF7A70] bg-[#262626] p-4 text-[14px]">
                    Le somme non tornano: {m.controlli.errori.join("; ")}.
                </div>
            )}

            <section aria-label="I numeri di adesso" className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Numero valore={n(T.entrati)} etichetta="lead entrati" />
                <Numero valore="—" etichetta="rispondono: serve il database del bot" />
                <Numero forte valore={n(T.appuntamenti)} etichetta={<>appuntamenti, il {pc(T.pctAppuntamenti)} dei lead</>} />
                <Numero valore={n(T.confermati)} etichetta={<>confermati dalle Conferme, {n(T.inAttesa)} in attesa</>} />
                <Numero valore={n(T.presenti)} etichetta={<>presenti alla call, {n(T.futuri)} call ancora da fare</>} />
                <Numero forte valore={euroIt(T.euroChiusi)} etichetta={<>{T.chiusi === 1 ? "1 chiusura" : `${n(T.chiusi)} chiusure`}, {n(T.nonChiusi)} non chiusi</>} />
            </section>

            <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                    <SezioneImbuto m={m} />
                    <SezioneGdo m={m} />
                    <SezioneConfronto m={m} />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                    <SezioneAttenzioni m={m} />
                    <SezioneEsiti m={m} />
                    <SezioneProvenienza m={m} />
                </div>
            </div>

            <p className="mt-6 max-w-4xl text-[13px] leading-relaxed text-[#BFBFBF]">
                Fonte: CRM (lead, eventi, chiamate). Lead di prova esclusi. Le percentuali sono arrotondate a un decimale.
                Le somme di imbuto, esiti e lead in mano sono ricontrollate a ogni lettura.
            </p>
        </>
    )
}

// 3. Imbuto per giorno di ingresso
function SezioneImbuto({ m }: { m: MonitorBf }) {
    const oggi = toRomeDateStr(new Date(m.calcolatoAlle))
    const G = m.imbuto.giorni
    const T = m.imbuto.totale
    const righe: [string, (x: Imbuto) => ReactNode, boolean?][] = [
        ["Lead entrati", x => n(x.entrati)],
        ["Appuntamenti fissati", x => <>{n(x.appuntamenti)}<Piccolo>{pc(x.pctAppuntamenti)} dei lead</Piccolo></>, true],
        ["Confermati dalle Conferme", x => n(x.confermati)],
        ["Scartati dalle Conferme", x => n(x.scartati)],
        ["In attesa delle Conferme", x => n(x.inAttesa)],
        ["Presenti alla call", x => n(x.presenti)],
        ["Chiusi", x => <>{n(x.chiusi)}{x.euroChiusi > 0 && <Piccolo>{euroIt(x.euroChiusi)}</Piccolo>}</>, true],
        ["Non chiusi", x => n(x.nonChiusi)],
        ["Appuntamenti ancora da fare", x => n(x.futuri)],
    ]
    const motivi = Object.entries(T.motiviScarto).sort((a, b) => b[1] - a[1])
    return (
        <Sezione titolo="L'imbuto, giorno per giorno">
            <Tabella intestazioni={["Passaggio", ...G.map(g => etichettaGiorno(g.giorno) + (g.giorno === oggi ? " *" : "")), "Totale"]} min={140 + 90 * (G.length + 1)}>
                {righe.map(([etichetta, f, forte]) => (
                    <tr key={etichetta} className={forte ? "bg-[#2E2A24]" : ""}>
                        <th scope="row" className={`${TH_RIGA} ${forte ? "font-semibold" : ""}`}>{etichetta}</th>
                        {G.map(g => <td key={g.giorno} className={TD}>{f(g.dati)}</td>)}
                        <td className={`${TD} font-semibold`}>{f(T)}</td>
                    </tr>
                ))}
            </Tabella>
            <div className="mt-3">
                <SenzaBot>Con chat del bot, primo messaggio consegnato e hanno risposto stanno nel database del bot.</SenzaBot>
            </div>
            <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                Giorno di ingresso in ora di Roma. * Oggi è ancora in corso: gli appuntamenti di chi è entrato oggi arrivano nelle prossime ore.
                {motivi.length > 0 && <> Scarti delle Conferme: {motivi.map(([k, v]) => `${v} "${k}"`).join(", ")}.</>}
            </div>
        </Sezione>
    )
}

// 6. Tabella GDO
function SezioneGdo({ m }: { m: MonitorBf }) {
    const { righe, bot, bfSenzaAssegnatario } = m.gdo
    const R = m.ridati
    return (
        <Sezione titolo="I GDO e i lead">
            <Tabella intestazioni={["GDO", "Lead aperti", "Mai chiamati", "Richiami oggi", "Chiamate oggi", "Appunt. oggi", "Lead BF in mano"]} min={720}>
                {righe.map(g => (
                    <tr key={`${g.codice}-${g.nome}`} className={g.attivo ? "" : "text-[#8C8C8C]"}>
                        <th scope="row" className={TH_RIGA}>{g.codice} {g.nome}{!g.attivo && <Piccolo>account disattivato</Piccolo>}</th>
                        <td className={TD}>{n(g.aperti)}</td>
                        <td className={TD}>{n(g.maiChiamati)}</td>
                        <td className={TD}>{n(g.richiamiOggi)}{g.richiamiScaduti > 0 && <Chip tipo="attenzione">{g.richiamiScaduti} scaduti</Chip>}</td>
                        <td className={TD}>{n(g.chiamateOggi)}</td>
                        <td className={TD}>{n(g.appuntamentiOggi)}</td>
                        <td className={TD}>
                            {n(g.bfInMano)}
                            {g.bfInMano > 0 && (g.bfDaChiamare > 0
                                ? <Chip tipo="attenzione">{g.bfDaChiamare} da chiamare</Chip>
                                : <Chip tipo="ok">tutti chiamati</Chip>)}
                        </td>
                    </tr>
                ))}
                <tr className="bg-[#2E2A24]">
                    <th scope="row" className={TH_RIGA}>201 Bot<Piccolo>solo lead BF</Piccolo></th>
                    <td className={TD}>—</td><td className={TD}>—</td><td className={TD}>—</td><td className={TD}>—</td><td className={TD}>—</td>
                    <td className={TD}>
                        {n(bot.bfInMano)}
                        <Piccolo>{n(bot.conAppuntamento)} con appuntamento · {n(bot.aperti)} chat aperte{bot.scartati > 0 ? ` · ${n(bot.scartati)} scartati` : ""}</Piccolo>
                    </td>
                </tr>
            </Tabella>
            <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                Lead aperti e mai chiamati: tutti i funnel. Richiami e chiamate: oggi, ora di Roma. BF da chiamare: aperti e mai chiamati da un GDO.
                {bfSenzaAssegnatario > 0 && <> Lead BF senza assegnatario: {n(bfSenzaAssegnatario)}.</>}
                {" "}Lead BF ridati dal bot ai GDO: {n(R.totale)}
                {R.totale > 0 && <> ({n(R.perMotivo.mai_risposto ?? 0)} mai risposto, {n(R.perMotivo.chat_interrotta ?? 0)} chat interrotta)</>}.
                {" "}Chiamati da un GDO dopo il passaggio: {n(R.chiamatiDaGdo)}. Appuntamenti fissati dai GDO: {n(R.fissatiDaiGdo)}.
                {R.tornatiConAppuntamentoDalBot > 0 && <> Fissati poi dal bot: {n(R.tornatiConAppuntamentoDalBot)}.</>}
                {" "}Ancora da chiamare: {n(R.daChiamare)}.
            </div>
        </Sezione>
    )
}

// 2. Confronto con gli altri funnel del bot
function SezioneConfronto({ m }: { m: MonitorBf }) {
    const C = m.confronto
    const riga = (r: RigaConfronto, forte = false, sotto = false) => (
        <tr key={r.funnel} className={forte ? "bg-[#2E2A24]" : ""}>
            <th scope="row" className={`${TH_RIGA} ${sotto ? "pl-3 text-[#BFBFBF]" : ""} ${forte ? "font-semibold" : ""}`}>{sotto ? `di cui ${nomeFunnel(r.funnel)}` : r.funnel}</th>
            <td className={TD}>{n(r.lead)}</td>
            <td className={TD}>—</td>
            <td className={TD}>{n(r.appuntamenti)}<Piccolo>{pc(r.pctAppuntamenti)} dei lead</Piccolo></td>
            <td className={TD}>{r.etaMediaOre === null ? "—" : `${n(Math.round(r.etaMediaOre))} h`}</td>
        </tr>
    )
    const barre = C.bf ? [
        { nome: "Black Friday", v: C.bf.pctAppuntamenti, bf: true },
        { nome: "Altri funnel", v: C.altri.pctAppuntamenti, bf: false },
    ] : []
    const max = Math.max(1, ...barre.map(b => b.v ?? 0))
    return (
        <Sezione titolo="Rispetto agli altri lead del bot">
            {barre.length > 0 && (
                <div className="mb-4">
                    <Sottotitolo>Fissano un appuntamento</Sottotitolo>
                    <div className="space-y-2">
                        {barre.map(b => (
                            <div key={b.nome} className="grid grid-cols-[96px_minmax(0,1fr)_56px] items-center gap-3 text-[14px]">
                                <span className="truncate">{b.nome}</span>
                                <div className="h-3 overflow-hidden rounded-[3px] bg-[#3D3D3D]">
                                    <div className={`h-full ${b.bf ? "bg-[#FF9330]" : "bg-[#8C8C8C]"}`} style={{ width: `${((b.v ?? 0) / max) * 100}%` }} />
                                </div>
                                <span className="text-right font-semibold">{pc(b.v)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <Tabella intestazioni={["Gruppo", "Lead", "Rispondono", "Appuntamenti", "Età media"]} min={560}>
                {C.bf && riga({ ...C.bf, funnel: "Black Friday" }, true)}
                {riga(C.altri)}
                {C.dettaglio.map(r => riga(r, false, true))}
            </Tabella>
            <div className="mt-3 space-y-3">
                <div className="text-[13px] leading-snug text-[#BFBFBF]">
                    Lead entrati dal 7/11 e passati dal bot, per funnel; appuntamenti su tutti i lead del gruppo. L&apos;età media dice quanto tempo hanno avuto:
                    un gruppo più giovane ha esiti meno maturi.
                </div>
                <SenzaBot>Le risposte e il confronto sulle sole chat nuove si leggono dalle conversazioni del bot.</SenzaBot>
            </div>
        </Sezione>
    )
}

function nomeFunnel(f: string): string {
    return ({ "CORSO 10 ORE": "Corso 10 ore", "JOB SIMULATOR": "Job Simulator", TELEGRAM: "Telegram" } as Record<string, string>)[f] ?? f
}

// 7. Da tenere d'occhio
function SezioneAttenzioni({ m }: { m: MonitorBf }) {
    return (
        <Sezione titolo="Da tenere d'occhio">
            {m.attenzioni.length === 0 ? (
                <Vuoto>Niente da segnalare adesso.</Vuoto>
            ) : (
                <ul className="space-y-2.5">
                    {m.attenzioni.map(a => (
                        <li key={a.chiave} className="rounded-[10px] border-l-4 border-[#FF9330] bg-[#2E2E2E] px-4 py-3 text-[14px] leading-snug">
                            <div className="font-semibold">{a.titolo}</div>
                            <div className="mt-0.5 text-[13.5px] text-[#BFBFBF]">{a.testo}</div>
                        </li>
                    ))}
                </ul>
            )}
            <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                Regole: ridati dal bot non chiamati da più di {ORE_RIDATO_NON_CHIAMATO} ore, lead BF aperti senza assegnatario,
                lead ancora col bot e senza appuntamento da più di {ORE_FERMO_SUL_BOT} ore, appuntamenti passati da più
                di {ORE_APPUNTAMENTO_SENZA_ESITO} ore senza presenza né esito. La resa per numero WhatsApp richiede i dati del bot.
            </div>
        </Sezione>
    )
}

// 4. Esiti (dal CRM)
function SezioneEsiti({ m }: { m: MonitorBf }) {
    const max = Math.max(1, ...m.esiti.voci.map(v => v.lead))
    return (
        <Sezione titolo="Dove il bot ha lasciato i lead">
            {m.esiti.voci.length === 0 ? <Vuoto>Ancora nessun lead.</Vuoto> : (
                <div className="space-y-2.5">
                    {m.esiti.voci.map(v => (
                        <div key={v.chiave} className="text-[14px]">
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="min-w-0">{v.nome}</span>
                                <span className="shrink-0 font-semibold">{n(v.lead)} <span className="font-normal text-[#BFBFBF]">{pc(v.pct)}</span></span>
                            </div>
                            <div className="mt-1 h-2.5 overflow-hidden rounded-[3px] bg-[#3D3D3D]">
                                <div className={`h-full ${v.chiave.startsWith("appuntamento") ? "bg-[#5CC792]" : "bg-[#8C8C8C]"}`} style={{ width: `${(v.lead / max) * 100}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                Su {n(m.esiti.totale)} lead, letto dal CRM: chiamate ed eventi del bot. Il bot ridà il lead ai GDO dopo circa 24 ore di silenzio.
                Lo stato interno della chat (in corso, in pausa, chiusa su un altro lead) sta nel database del bot.
            </div>
        </Sezione>
    )
}

// 5. Provenienza
function SezioneProvenienza({ m }: { m: MonitorBf }) {
    return (
        <Sezione titolo="Da dove arrivano">
            <Sottotitolo>Per canale</Sottotitolo>
            <Tabella intestazioni={["Canale", "Lead", "Rispondono", "Appunt.", "Presenti", "Chiusi"]} min={460}>
                {m.canali.map(c => (
                    <tr key={c.chiave}>
                        <th scope="row" className={TH_RIGA}>{c.nome}</th>
                        <td className={TD}>{n(c.lead)}</td>
                        <td className={TD}>—</td>
                        <td className={TD}>{n(c.appuntamenti)}<Piccolo>{pc(c.pctAppuntamenti)}</Piccolo></td>
                        <td className={TD}>{n(c.presenti)}</td>
                        <td className={TD}>{n(c.chiusi)}</td>
                    </tr>
                ))}
            </Tabella>
            <div className="mt-4 space-y-3">
                <Sottotitolo>Nuovi o già in chat col bot · Per numero WhatsApp · Mario Sonnet o Opus</Sottotitolo>
                <SenzaBot>
                    Servono le conversazioni del bot (data di nascita della chat, numero, versione di Mario).
                    Per Sonnet e Opus la percentuale andrebbe su chi ha risposto, perché la versione si sceglie alla prima risposta.
                </SenzaBot>
            </div>
        </Sezione>
    )
}
