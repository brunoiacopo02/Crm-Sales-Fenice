import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { numeroIt, numeroItFino } from "@/lib/diretta/formato"
import { calcolaSimGdo, leggiUltimoGiro, type EsitoSimGdo, type UltimoGiro } from "@/lib/simGdo/run"
import { PREFISSO_MINIMO, type RigaCalcolata, type UtenteGdo } from "@/lib/simGdo/giro"
import { COLORI_HEX } from "@/lib/simGdo/celle"
import { MIN_CHIAMATE, FATTORE_ROSSO, type Colore } from "@/lib/simGdo/tasso"
import { PRIMA_ORA, ULTIMA_ORA } from "@/lib/simGdo/orario"
import { toRomeDateStr } from "@/lib/dateUtils"
import { Indietro, PaginaAdmin, Sezione, TitoloAdmin, Vuoto, oraDi, quando } from "@/components/diretta/admin/ui"

export const dynamic = "force-dynamic"

/**
 * SIM GDO (PO 14/11/2026): il tasso di risposta di oggi di ogni riga del
 * foglio delle SIM, lo stesso che il giro orario scrive nella colonna
 * "TASSO DI RSP.". Solo ADMIN. La pagina ricalcola adesso senza scrivere nulla;
 * l'ultimo giro dice cosa è stato scritto e quando. Regole in src/lib/simGdo/.
 */
export default async function SimGdoPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")
    const [esito, ultimo] = await Promise.all([
        calcolaSimGdo({ scrivi: false }).catch((e: unknown) => ({ errore: e instanceof Error ? e.message : "Errore ignoto." })),
        leggiUltimoGiro().catch(() => null),
    ])

    return (
        <PaginaAdmin larga>
            <Indietro href="/panoramica-generale">Sales Manager</Indietro>
            <TitoloAdmin
                prima="Tasso di risposta delle"
                accento="SIM GDO"
                sotto={<>Il tasso di oggi di ogni riga del foglio delle SIM. Ogni ora, dal lunedì al sabato fra le {PRIMA_ORA} e le {ULTIMA_ORA}, il CRM lo scrive nella colonna del tasso e colora la cella: se crolla da un giorno all&apos;altro la SIM può essere finita in spam.</>}
            />
            <UltimoGiroUi g={ultimo} />
            {"righe" in esito && esito.ok ? (
                <Contenuto e={esito} />
            ) : (
                <Sezione titolo="Foglio non leggibile" className="mt-4">
                    <Vuoto>{("errore" in esito && esito.errore) || "Errore ignoto."} Il giro orario in questo caso non scrive niente.</Vuoto>
                </Sezione>
            )}
            <ComeSiConta />
        </PaginaAdmin>
    )
}

// ── Formati ──────────────────────────────────────────────────────────────

const n = (v: number) => numeroIt(v)
const pc = (v: number | null) => (v === null ? "—" : `${numeroItFino(v * 100, 1)}%`)

const NOME_COLORE: Record<Colore, string> = { grigio: "grigia", rosso: "rossa", verde: "verde" }

function persona(u: UtenteGdo): string {
    const codice = u.gdoCode ? `GDO ${u.gdoCode}` : "GDO"
    return u.firstName ? `${u.firstName} (${codice})` : codice
}

function nomeCrm(r: RigaCalcolata): string {
    return r.utente ? persona(r.utente) : "—"
}

// ── Pezzi ────────────────────────────────────────────────────────────────

const TH = "whitespace-nowrap px-3 pb-2 text-right text-[13px] font-normal text-[#BFBFBF] first:pl-0 first:text-left"
const TD = "whitespace-nowrap border-t-2 border-[#2E2E2E] px-3 py-2 text-right align-top first:pl-0"
const TD_SX = "border-t-2 border-[#2E2E2E] px-3 py-2 text-left align-top first:pl-0"

function Tabella({ intestazioni, children, min = 760 }: { intestazioni: string[]; children: ReactNode; min?: number }) {
    return (
        <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full text-[14px] tabular-nums" style={{ minWidth: min }}>
                <thead><tr>{intestazioni.map((h, i) => <th key={i} scope="col" className={TH}>{h}</th>)}</tr></thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    )
}

function Piccolo({ children, arancio = false }: { children: ReactNode; arancio?: boolean }) {
    return <div className={`text-[12.5px] font-normal leading-snug ${arancio ? "text-[#FF9330]" : "text-[#BFBFBF]"}`}>{children}</div>
}

function Numero({ valore, etichetta, forte = false }: { valore: string; etichetta: ReactNode; forte?: boolean }) {
    return (
        <div className={`min-w-0 rounded-[16px] p-4 sm:p-5 ${forte ? "bg-[#33261A]" : "bg-[#1F1F1F]"}`}>
            <div className={`text-[30px] font-semibold leading-none tracking-[-0.02em] sm:text-[36px] ${forte ? "text-[#FF9330]" : ""}`}>{valore}</div>
            <div className="mt-2 text-[13.5px] leading-snug text-[#BFBFBF]">{etichetta}</div>
        </div>
    )
}

/** Il colore come lo vede il titolare nel foglio. */
function Campione({ colore }: { colore: Colore | null }) {
    if (!colore) return <div className="text-[#6B6B6B]">vuota</div>
    return (
        <div className="inline-flex items-center gap-1.5">
            <div className="h-3.5 w-3.5 rounded-[3px]" style={{ backgroundColor: COLORI_HEX[colore] }} aria-hidden="true" />
            {NOME_COLORE[colore]}
        </div>
    )
}

function UltimoGiroUi({ g }: { g: UltimoGiro | null }) {
    const oggi = toRomeDateStr(new Date())
    return (
        <div className="mt-4 rounded-[16px] bg-[#262626] px-5 py-4 text-[14px] leading-relaxed sm:px-6">
            {!g ? (
                <div className="text-[#BFBFBF]">Il giro orario non è ancora passato: nel foglio non è stato scritto niente.</div>
            ) : (
                <div>
                    <span className="text-[#BFBFBF]">Ultimo giro: </span>
                    <span className="font-semibold">{quando(g.alle, oggi)}</span>
                    {" · "}
                    <span className={g.esito === "ok" ? "text-[#5FB37A]" : "font-semibold text-[#FF6B6B]"}>{g.esito === "ok" ? "riuscito" : "non riuscito"}</span>
                    <span className="text-[#BFBFBF]"> · {g.messaggio}</span>
                    {g.esito === "ok" && (
                        <div className="mt-1 text-[#BFBFBF]">
                            Celle scritte con il tasso: <span className="font-semibold text-[#F2F2F2]">{n(g.celleConValore)}</span>
                            {" · "}celle svuotate: <span className="font-semibold text-[#F2F2F2]">{n(g.celleSvuotate)}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Pagina ───────────────────────────────────────────────────────────────

const MOTIVO: Record<Exclude<RigaCalcolata["esito"], "agganciato">, string> = {
    nessuno: "Nessun GDO attivo del CRM ha un nome che corrisponde a quello del foglio. La cella resta vuota.",
    ambiguo: "Più GDO attivi del CRM corrispondono a questo nome: non so a chi agganciare la riga. La cella resta vuota.",
    interno_ripetuto: "Lo stesso interno compare in più righe: vale solo la prima.",
    aggancio_non_valido: "Il nome è tra gli agganci fissi (sim_gdo_agganci) ma il codice GDO indicato non è di un GDO attivo: non si ricade sul nome. La cella resta vuota.",
    gdo_ripetuto: "Lo stesso GDO risulta su più righe del foglio: tiene la riga col nome uguale, se è una sola; altrimenti restano vuote tutte.",
}

function Contenuto({ e }: { e: EsitoSimGdo }) {
    const agganciate = e.righe.filter(r => r.esito === "agganciato")
    const fuori = e.righe.filter(r => r.esito !== "agganciato")
    return (
        <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Numero forte valore={pc(e.mediaTasso)} etichetta={<>media di squadra dal 1 giugno 2026 a oggi ({n(e.media.risposte)} risposte su {n(e.media.chiamate)} chiamate)</>} />
                <Numero valore={pc(e.soglia)} etichetta={<>soglia rossa: sotto questo tasso, con almeno {MIN_CHIAMATE} chiamate, la cella è rossa ({numeroItFino(FATTORE_ROSSO * 100, 0)}% della media)</>} />
                <Numero valore={`${n(agganciate.length)} su ${n(e.righe.length)}`} etichetta={<>righe del foglio collegate per nome a un GDO attivo; colonna del tasso: {e.colonnaTasso}</>} />
            </div>

            <Sezione titolo={`Oggi, alle ${oraDi(e.adesso)}`} className="mt-4">
                <Tabella intestazioni={["Interno", "Nome nel foglio", "Nel CRM", "Numero", "Stato nel foglio", "Chiamate", "Risposte", "Tasso", "Cella"]} min={900}>
                    {e.righe.map(r => (
                        <tr key={r.riga}>
                            <td className={`${TD_SX} font-semibold`}>{r.interno}<Piccolo>riga {r.riga}</Piccolo></td>
                            <td className={TD_SX}>{r.nome || "—"}</td>
                            <td className={TD_SX}>
                                {nomeCrm(r)}
                                {r.esito !== "agganciato" && <Piccolo arancio>{r.esito === "nessuno" ? "nessun GDO con questo nome" : r.esito === "ambiguo" ? "nome ambiguo" : r.esito === "aggancio_non_valido" ? "aggancio fisso: codice GDO non valido" : r.esito === "gdo_ripetuto" ? `stesso GDO di riga ${r.stessoGdoDi.join(", ")}` : "interno ripetuto"}</Piccolo>}
                            </td>
                            <td className={TD_SX}>
                                {r.numero || "—"}
                                {r.ripartitoDal && <Piccolo arancio>conteggio ripartito alle {oraDi(r.ripartitoDal)} per cambio SIM segnato nel foglio</Piccolo>}
                                {e.cambiati.includes(r.interno) && <Piccolo>cambio SIM appena segnato nel foglio: lo registra il prossimo giro</Piccolo>}
                            </td>
                            <td className={TD_SX}>{r.stato || "—"}</td>
                            <td className={TD}>{r.esito === "agganciato" ? n(r.chiamate) : "—"}</td>
                            <td className={TD}>{r.esito === "agganciato" ? n(r.risposte) : "—"}</td>
                            <td className={`${TD} font-semibold`}>{pc(r.tasso)}</td>
                            <td className={TD_SX}><Campione colore={r.colore} /></td>
                        </tr>
                    ))}
                </Tabella>
                {e.righe.length === 0 && <Vuoto>Nel foglio non ci sono righe con un interno.</Vuoto>}
            </Sezione>

            <Sezione titolo="Righe non collegate" className="mt-4">
                {fuori.length === 0 ? (
                    <Vuoto>Tutte le righe del foglio sono collegate a un GDO del CRM.</Vuoto>
                ) : (
                    <div className="space-y-3">
                        {fuori.map(r => (
                            <div key={r.riga} className="border-t-2 border-[#2E2E2E] pt-3 text-[14px] leading-relaxed first:border-t-0 first:pt-0">
                                <div className="font-semibold">Interno {r.interno} · {r.nome || "senza nome"} (riga {r.riga})</div>
                                <div className="text-[#BFBFBF]">
                                    {MOTIVO[r.esito as keyof typeof MOTIVO]}
                                    {r.esito === "ambiguo" && <> Candidati: {r.candidati.map(persona).join(", ")}.</>}
                                    {r.esito === "gdo_ripetuto" && <> {r.candidati.map(persona).join(", ")}: stesso GDO di riga {r.stessoGdoDi.join(", ")}.</>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Sezione>
        </>
    )
}

function ComeSiConta() {
    return (
        <Sezione titolo="Come si conta" className="mt-4">
            <div className="max-w-4xl space-y-2 text-[14px] leading-relaxed text-[#BFBFBF]">
                <div>Tasso = risposte ÷ chiamate esitate dal GDO oggi, tutto l&apos;orario, sabato compreso. Risposta vuol dire ogni esito diverso da «non risposto». Gli scarti per numero inesistente non contano né come chiamata né come risposta.</div>
                <div>La riga del foglio si collega al GDO attivo il cui nome corrisponde al NOME del foglio: uguale, o con almeno {PREFISSO_MINIMO} lettere iniziali in comune senza accenti e senza «h» (RICCARDINO è Riccardo). Nessuno o più di uno: la riga resta vuota. L&apos;interno (colonna GDO) serve solo a riconoscere la riga.</div>
                <div>Quando nella colonna DATA ULTIMO CAMBIO compare un valore nuovo (qualunque cosa ci sia scritto), il conteggio di quella riga riparte dal giro che lo vede: per il resto della giornata contano solo le chiamate fatte da lì. Se la cella viene svuotata non riparte niente. Cambiare solo il numero non fa ripartire il conteggio. Il CRM non scrive mai in quella colonna.</div>
                <div>Cella grigia: meno di {MIN_CHIAMATE} chiamate oggi, il numero è scritto ma è presto per giudicare. Rossa: sotto il {numeroItFino(FATTORE_ROSSO * 100, 0)}% della media di squadra. Verde chiaro: tutto il resto. Vuota: riga non collegata o nessuna chiamata.</div>
                <div>La media di squadra è lo stesso conto su tutti i GDO dal 1 giugno 2026 a oggi (risposte totali ÷ chiamate totali), senza il bot, gli account di prova e il GDO 108.</div>
            </div>
        </Sezione>
    )
}
