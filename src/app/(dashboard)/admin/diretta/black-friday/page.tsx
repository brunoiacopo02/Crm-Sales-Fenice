import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { toRomeDateStr } from "@/lib/dateUtils"
import { euroIt, numeroIt, numeroItFino } from "@/lib/diretta/formato"
import { leggiMonitorBf } from "@/lib/blackFriday/monitorDb"
import {
    MIN_LEAD_NUMERO, ORE_APPUNTAMENTO_SENZA_ESITO, ORE_FERMO_SUL_BOT, ORE_RIDATO_NON_CHIAMATO, PCT_CONSEGNA_MINIMA, PUNTI_RESA_BASSA,
    type CascataSm, type Imbuto, type MonitorBf, type RigaConfronto, type RigaGruppo,
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
 * Mario arrivano dal bot (/api/bot/statistiche-bf, stessa cache): se il bot non
 * risponde quelle voci sono segnate come non disponibili e il resto resta.
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
                sotto={<>Tutti i lead Black Friday entrati nel CRM da sabato 7/11, compresi quelli diventati Black Friday dopo (per loro conta la data della conversione). Le percentuali sono sempre sul totale dei lead, come per i GDO, salvo dove è scritto.</>}
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
                {T.risposto === null
                    ? <Numero valore="—" etichetta="rispondono: il bot non ha risposto, riprova fra poco" />
                    : <Numero valore={n(T.risposto)} etichetta={<>rispondono al bot, il {pc(T.pctRisposto)} dei lead</>} />}
                <Numero forte valore={n(T.appuntamenti)} etichetta={<>appuntamenti, il {pc(T.pctAppuntamenti)} dei lead</>} />
                <Numero valore={n(T.confermati)} etichetta={<>confermati dalle Conferme, {n(T.inAttesa)} in attesa</>} />
                <Numero valore={n(T.presenti)} etichetta={<>presenti alla call, {n(T.futuri)} call ancora da fare</>} />
                <Numero forte valore={euroIt(T.euroChiusi)} etichetta={<>{T.chiusi === 1 ? "1 chiusura" : `${n(T.chiusi)} chiusure`}, {n(T.nonChiusi)} non chiusi</>} />
            </section>

            <PercentualiInCima m={m} />

            {!m.bot && (
                <div className="mt-4">
                    <SenzaBot>Il bot non ha risposto in tempo: chat, consegne, risposte, numeri WhatsApp e Mario tornano alla prossima lettura. I numeri del CRM sono aggiornati.</SenzaBot>
                </div>
            )}

            <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                    <SezioneImbuto m={m} />
                    <SezioneSalesManager m={m} />
                    <SezioneGdo m={m} />
                    <SezioneConfronto m={m} />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                    <SezioneAttenzioni m={m} />
                    <SezioneEsiti m={m} />
                    <SezioneProvenienza m={m} />
                    <SezioneBot m={m} />
                </div>
            </div>

            <p className="mt-6 max-w-4xl text-[13px] leading-relaxed text-[#BFBFBF]">
                Fonte: CRM (lead, eventi, chiamate) e database del bot (chat, consegne, risposte, numero, Mario{m.bot ? `, letto alle ${oraConSecondi(m.bot.lettoAlle)}` : ", non disponibile ora"}).
                Lead di prova esclusi. Le percentuali sono arrotondate a un decimale.
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
    const conPct = (v: number | null, p: number | null) => (v === null ? "—" : <>{n(v)}<Piccolo>{pc(p)} dei lead</Piccolo></>)
    const righeBot: [string, (x: Imbuto) => ReactNode, boolean?][] = m.bot ? [
        ["Con chat del bot", x => conPct(x.conChat, x.pctConChat)],
        ["Primo messaggio consegnato", x => conPct(x.consegnato, x.pctConsegnato)],
        ["Hanno risposto", x => conPct(x.risposto, x.pctRisposto), true],
    ] : []
    const righe: [string, (x: Imbuto) => ReactNode, boolean?][] = [
        ["Lead entrati", x => n(x.entrati)],
        ...righeBot,
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
            {!m.bot && (
                <div className="mt-3">
                    <SenzaBot>Con chat del bot, primo messaggio consegnato e hanno risposto arrivano dal bot, che ora non ha risposto.</SenzaBot>
                </div>
            )}
            <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                Giorno di ingresso in ora di Roma. Con chat: il bot ha scritto al lead da 2 minuti prima dell&apos;ingresso in poi.
                Consegnato: un messaggio del bot dopo l&apos;ingresso risulta consegnato o letto su WhatsApp. Hanno risposto: almeno un messaggio del lead dopo l&apos;ingresso. * Oggi è ancora in corso: gli appuntamenti di chi è entrato oggi arrivano nelle prossime ore.
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

function Barre({ titolo, voci }: { titolo: string; voci: { nome: string; v: number | null; bf: boolean }[] }) {
    const max = Math.max(1, ...voci.map(b => b.v ?? 0))
    return (
        <div>
            <Sottotitolo>{titolo}</Sottotitolo>
            <div className="space-y-2">
                {voci.map(b => (
                    <div key={b.nome} className="grid grid-cols-[112px_minmax(0,1fr)_56px] items-center gap-3 text-[14px]">
                        <span className="truncate">{b.nome}</span>
                        <div className="h-3 overflow-hidden rounded-[3px] bg-[#3D3D3D]">
                            <div className={`h-full ${b.bf ? "bg-[#FF9330]" : "bg-[#8C8C8C]"}`} style={{ width: `${((b.v ?? 0) / max) * 100}%` }} />
                        </div>
                        <span className="text-right font-semibold">{pc(b.v)}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// 2. Confronto con gli altri funnel del bot
function SezioneConfronto({ m }: { m: MonitorBf }) {
    const C = m.confronto
    const conBot = C.fonte === "bot"
    const riga = (r: RigaConfronto, forte = false, sotto = false) => (
        <tr key={r.funnel} className={forte ? "bg-[#2E2A24]" : ""}>
            <th scope="row" className={`${TH_RIGA} ${sotto ? "pl-3 text-[#BFBFBF]" : ""} ${forte ? "font-semibold" : ""}`}>{sotto ? `di cui ${nomeFunnel(r.funnel)}` : r.funnel}</th>
            <td className={TD}>{n(r.lead)}</td>
            <td className={TD}>{r.risposto === null ? "—" : <>{n(r.risposto)}<Piccolo>{pc(r.pctRisposto)}</Piccolo></>}</td>
            <td className={TD}>{n(r.appuntamenti)}<Piccolo>{pc(r.pctAppuntamenti)}</Piccolo></td>
            <td className={TD}>{r.etaMediaOre === null ? "—" : `${n(Math.round(r.etaMediaOre))} h`}</td>
        </tr>
    )
    const barre = (chiave: "pctRisposto" | "pctAppuntamenti") => [
        { nome: "BF tutti i lead", v: C.bfTutti[chiave], bf: true },
        ...(C.bfChatNuove ? [{ nome: "BF chat nuove", v: C.bfChatNuove[chiave], bf: true }] : []),
        { nome: "Altri funnel", v: C.altri[chiave], bf: false },
    ]
    return (
        <Sezione titolo="Rispetto agli altri lead del bot">
            <div className="mb-4 grid gap-4 md:grid-cols-2">
                {conBot && <Barre titolo="Rispondono" voci={barre("pctRisposto")} />}
                <Barre titolo="Fissano un appuntamento" voci={barre("pctAppuntamenti")} />
            </div>
            <Tabella intestazioni={["Gruppo", conBot ? "Lead / chat" : "Lead", "Rispondono", "Appuntamenti", "Età media"]} min={560}>
                {riga(C.bfTutti, true)}
                {C.bfChatNuove && riga(C.bfChatNuove, true)}
                {riga(C.altri)}
                {C.dettaglio.map(r => riga(r, false, true))}
            </Tabella>
            <div className="mt-3 space-y-3">
                <div className="text-[13px] leading-snug text-[#BFBFBF]">
                    {conBot ? (
                        <>
                            BF tutti i lead: i lead BF entrati dal 7/11, anche quelli già in chat col bot; appuntamenti dal CRM, età dall&apos;ingresso.
                            BF solo chat nuove e altri funnel: le chat del bot nate dal 7/11, per funnel attuale della chat; appuntamento = esito APPUNTAMENTO del bot,
                            età dalla nascita della chat. Le % sono sul totale dei lead o delle chat del gruppo.
                        </>
                    ) : (
                        <>Lead entrati dal 7/11 e passati dal bot, per funnel; appuntamenti su tutti i lead del gruppo.</>
                    )}
                    {" "}L&apos;età media dice quanto tempo hanno avuto: un gruppo più giovane ha esiti meno maturi.
                </div>
                {!conBot && <SenzaBot>Le risposte e il confronto sulle sole chat nuove arrivano dal bot, che ora non ha risposto.</SenzaBot>}
            </div>
        </Sezione>
    )
}

// Percentuali come nel Sales Manager, in cima
function PercentualiInCima({ m }: { m: MonitorBf }) {
    const S = m.salesManager
    const voci: [string, (c: CascataSm) => number | null, string][] = [
        ["fissaggio", c => c.pctFissaggio, "appuntamenti sui lead"],
        ["conferme", c => c.pctConferme, "confermati sugli appuntamenti"],
        ["presenze", c => c.pctPresenze, "presenti sui confermati"],
        ["chiusure", c => c.pctChiusure, "chiusi sui presenti"],
    ]
    return (
        <section aria-label="Percentuali come nel Sales Manager" className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {voci.map(([nome, f, sotto]) => (
                <div key={nome} className="min-w-0 rounded-[16px] bg-[#262626] p-4">
                    <div className="text-[13px] text-[#BFBFBF]">% {nome} <span className="text-[12px]">· come nel Sales Manager</span></div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                        <span className="text-[26px] font-semibold leading-tight text-[#FF9330]">{pc(f(S.bf))}</span>
                        <span className="text-[14px] text-[#BFBFBF]">altri funnel {S.altri ? pc(f(S.altri)) : "—"}</span>
                    </div>
                    <div className="mt-1 text-[12.5px] text-[#BFBFBF]">{sotto}</div>
                </div>
            ))}
        </section>
    )
}

// Percentuali come nel Sales Manager, per giorno di ingresso
function SezioneSalesManager({ m }: { m: MonitorBf }) {
    const S = m.salesManager
    const oggi = toRomeDateStr(new Date(m.calcolatoAlle))
    const colonne: { chiave: string; titolo: string; c: CascataSm | null; altri?: boolean }[] = [
        ...S.giorni.map(g => ({ chiave: g.giorno, titolo: etichettaGiorno(g.giorno) + (g.giorno === oggi ? " *" : ""), c: g.dati })),
        { chiave: "tot", titolo: "BF totale", c: S.bf },
        { chiave: "altri", titolo: "Altri funnel", c: S.altri, altri: true },
    ]
    const righe: [string, (c: CascataSm) => ReactNode, boolean?][] = [
        ["Lead", c => n(c.lead)],
        ["Appuntamenti fissati", c => n(c.app)],
        ["% fissaggio", c => pc(c.pctFissaggio), true],
        ["Confermati", c => n(c.conferme)],
        ["% conferme", c => pc(c.pctConferme), true],
        ["Presenti", c => <>{n(c.presenze)}{c.presenze !== c.presenzeConfermate && <Piccolo>{n(c.presenzeConfermate)} dalle Conferme</Piccolo>}</>],
        ["% presenze", c => pc(c.pctPresenze), true],
        ["Chiusi", c => <>{n(c.chiusi)}{c.euro > 0 && <Piccolo>{euroIt(c.euro)}</Piccolo>}</>],
        ["% chiusure", c => pc(c.pctChiusure), true],
    ]
    return (
        <Sezione titolo="Percentuali come nel Sales Manager">
            <Tabella intestazioni={["Passaggio", ...colonne.map(c => c.titolo)]} min={140 + 90 * colonne.length}>
                {righe.map(([etichetta, f, forte]) => (
                    <tr key={etichetta} className={forte ? "bg-[#2E2A24]" : ""}>
                        <th scope="row" className={`${TH_RIGA} ${forte ? "font-semibold" : ""}`}>{etichetta}</th>
                        {colonne.map(c => (
                            <td key={c.chiave} className={`${TD} ${c.chiave === "tot" ? "font-semibold" : ""} ${c.altri ? "text-[#BFBFBF]" : ""}`}>{c.c ? f(c.c) : "—"}</td>
                        ))}
                    </tr>
                ))}
            </Tabella>
            <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                Stesse definizioni della tabella Numeri mensili del Sales Manager (Panoramica Generale): % fissaggio = appuntamenti fissati sui lead;
                % conferme = confermati sugli appuntamenti; % presenze = presenti passati dalle Conferme sui confermati; % chiusure = chiusi su tutti i presenti.
                Ogni passaggio conta nel periodo in cui è avvenuto (fissaggio, conferma, presenza, firma). BF: lead per giorno di ingresso.
                Altri funnel: tutti i lead non BF entrati dal 7/11 a ora (data di assegnazione, lead dei pool solo se assegnati, infornate escluse dai KPI fuori)
                e i loro passaggi nello stesso periodo.
            </div>
        </Sezione>
    )
}

// Nuovi o già in chat, numero WhatsApp, Mario (dal bot)
function SezioneBot({ m }: { m: MonitorBf }) {
    const B = m.bot
    const tabella = (righe: RigaGruppo[], mario = false) => (
        <Tabella intestazioni={["Gruppo", "Lead", "Consegnato", "Rispondono", "Appunt.", ...(mario ? ["Appunt. su chi risponde"] : [])]} min={mario ? 560 : 460}>
            {righe.map(g => (
                <tr key={g.chiave}>
                    <th scope="row" className={TH_RIGA}>{g.nome}</th>
                    <td className={TD}>{n(g.lead)}</td>
                    <td className={TD}>{n(g.consegnato)}<Piccolo>{pc(g.pctConsegnato)}</Piccolo></td>
                    <td className={TD}>{n(g.risposto)}<Piccolo>{pc(g.pctRisposto)}</Piccolo></td>
                    <td className={TD}>{n(g.appuntamenti)}<Piccolo>{pc(g.pctAppuntamenti)}</Piccolo></td>
                    {mario && <td className={TD}>{pc(g.pctAppuntamentiSuRisposto)}</td>}
                </tr>
            ))}
        </Tabella>
    )
    return (
        <Sezione titolo="Chat del bot sui lead BF">
            {!B ? (
                <SenzaBot>Nuovi o già in chat, numero WhatsApp e versione di Mario arrivano dal bot, che ora non ha risposto.</SenzaBot>
            ) : (
                <div className="space-y-5">
                    <div>
                        <Sottotitolo>Nuovi o già in chat col bot</Sottotitolo>
                        {tabella(B.nuoviNoti)}
                    </div>
                    <div>
                        <Sottotitolo>Per numero WhatsApp</Sottotitolo>
                        {tabella(B.numeri)}
                    </div>
                    <div>
                        <Sottotitolo>Mario Sonnet o Opus</Sottotitolo>
                        {tabella(B.mario, true)}
                        <div className="mt-2 text-[13px] leading-snug text-[#BFBFBF]">
                            Unica eccezione alla regola delle % sui lead: la versione di Mario si sceglie alla prima risposta del lead, quindi chi non ha mai risposto non ha
                            una versione. Per confrontare Sonnet e Opus guarda l&apos;ultima colonna, appuntamenti su chi ha risposto.
                        </div>
                    </div>
                    <div className="text-[13px] leading-snug text-[#BFBFBF]">
                        Percentuali sui lead del gruppo. Già in chat: la chat del bot esisteva più di 10 minuti prima dell&apos;ingresso BF. Appuntamenti dal CRM.
                    </div>
                </div>
            )}
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
                Regole: ridati dal bot non chiamati da più di {ORE_RIDATO_NON_CHIAMATO} ore di turno GDO (feriali 13:30-20:00, sabato 10:00-16:30, domenica non conta),
                lead BF aperti senza assegnatario,
                lead ancora col bot e senza appuntamento da più di {ORE_FERMO_SUL_BOT} ore, appuntamenti passati da più
                di {ORE_APPUNTAMENTO_SENZA_ESITO} ore senza presenza né esito, numeri WhatsApp con almeno {MIN_LEAD_NUMERO} lead BF che consegnano l&apos;apertura
                a meno dell&apos;{PCT_CONSEGNA_MINIMA}% dei lead o che fanno rispondere {PUNTI_RESA_BASSA} punti meno della media BF.
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
                Le risposte, per giorno e per gruppo, sono nell&apos;imbuto e nella sezione delle chat del bot.
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
                        <td className={TD}>{c.risposto === null ? "—" : <>{n(c.risposto)}<Piccolo>{pc(c.pctRisposto)}</Piccolo></>}</td>
                        <td className={TD}>{n(c.appuntamenti)}<Piccolo>{pc(c.pctAppuntamenti)}</Piccolo></td>
                        <td className={TD}>{n(c.presenti)}</td>
                        <td className={TD}>{n(c.chiusi)}</td>
                    </tr>
                ))}
            </Tabella>
            <div className="mt-3 text-[13px] leading-snug text-[#BFBFBF]">
                Percentuali sui lead del canale. Inserzioni Meta: sorgente Meta o Facebook a pagamento. Email al database: le email del lancio Black Friday
                (sorgente Email o ActiveCampaign); la mail di un altro lancio va in Altro.
            </div>
        </Sezione>
    )
}
