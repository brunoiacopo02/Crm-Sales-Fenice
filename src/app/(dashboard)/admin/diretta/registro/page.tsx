import Link from "next/link"
import { redirect } from "next/navigation"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { getRegistroDettaglio } from "@/app/actions/centroDirettaActions"
import { causaleTesto, importoConSegno } from "@/lib/diretta/centro"
import { nomeValuta } from "@/lib/diretta/negozio"
import { toRomeDateStr } from "@/lib/dateUtils"
import { Indietro, PaginaAdmin, TitoloAdmin, Vuoto, bottone, quando } from "@/components/diretta/admin/ui"

export const dynamic = "force-dynamic"

const NUM = new Intl.NumberFormat("it-IT")
const campo = "h-10 rounded-[8px] border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[14px] text-[#F2F2F2] [color-scheme:dark] focus:border-[#FF9330] focus:outline-none"

// Registro delle monete (PO 25/10/2026): gli ultimi movimenti di Scintille e
// Piume, per persona, valuta o soli storni. Ci si arriva dal centro di
// controllo. Solo ADMIN, letto dalla tabella users. I filtri stanno nell'URL,
// così un controllo si può rimandare con un link.
export default async function RegistroDirettaPage({ searchParams }: {
    searchParams: Promise<{ persona?: string; valuta?: string; storni?: string }>
}) {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const sp = await searchParams
    const storni = sp.storni === "1"
    const dati = await getRegistroDettaglio({ persona: sp.persona ?? null, valuta: sp.valuta ?? null, storni })
    if (!dati) redirect("/unauthorized")

    const oggi = toRomeDateStr(new Date())
    const filtrato = !!(sp.persona || sp.valuta || storni)

    return (
        <PaginaAdmin>
            <Indietro href="/admin/diretta">Centro di controllo</Indietro>
            <TitoloAdmin
                prima="Registro delle"
                accento="monete"
                sotto={`Gli ultimi ${dati.limite} movimenti di Scintille e Piume, dal più recente. Gli storni tolgono quello che un esito poi cambiato aveva dato.`}
            />

            <form method="get" className="mt-8 flex flex-wrap items-end gap-3 rounded-[16px] bg-[#262626] p-5 sm:p-6">
                <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-[14px]">
                    Persona
                    <select name="persona" defaultValue={dati.scelta?.id ?? ""} className={campo}>
                        <option value="">Tutti</option>
                        {dati.persone.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.persona || "Senza nome"}{p.ruolo === "CONFERME" ? ", Conferme" : ""}{p.isActive ? "" : ", non attivo"}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1.5 text-[14px]">
                    Valuta
                    <select name="valuta" defaultValue={sp.valuta === "S" || sp.valuta === "P" ? sp.valuta : ""} className={campo}>
                        <option value="">Tutte</option>
                        <option value="S">Scintille</option>
                        <option value="P">Piume</option>
                    </select>
                </label>
                <label className="flex h-10 items-center gap-2 text-[14px]">
                    <input type="checkbox" name="storni" value="1" defaultChecked={storni} className="h-4 w-4 accent-[#FF9330]" />
                    Solo storni
                </label>
                <button type="submit" className={bottone("primario")}>Filtra</button>
                {filtrato && <Link href="/admin/diretta/registro" className={bottone("testo")}>Togli i filtri</Link>}
            </form>

            {dati.scelta && (
                <div className="mt-4 rounded-[16px] bg-[#262626] px-5 py-4 text-[15px] sm:px-6">
                    Saldo di {dati.scelta.persona || "questa persona"}:{" "}
                    <span className="font-semibold tabular-nums">{NUM.format(dati.scelta.scintille)}</span> {nomeValuta("S", dati.scelta.scintille)} e{" "}
                    <span className="font-semibold tabular-nums">{NUM.format(dati.scelta.piume)}</span> {nomeValuta("P", dati.scelta.piume)}.
                </div>
            )}

            <section aria-label="Movimenti" className="mt-4 rounded-[16px] bg-[#262626] p-5 sm:p-6">
                {dati.movimenti.length === 0 ? (
                    <Vuoto>{filtrato ? "Nessun movimento con questi filtri." : "Il registro è ancora vuoto."}</Vuoto>
                ) : (
                    <ol>
                        {dati.movimenti.map(m => (
                            <li key={m.id} className="flex items-baseline justify-between gap-4 border-t-2 border-[#2E2E2E] py-2.5 text-[14px] first:border-t-0 first:pt-0">
                                <div className="min-w-0">
                                    <div className="truncate">
                                        <span className="tabular-nums text-[#BFBFBF]">{quando(m.at, oggi)}</span>{" "}
                                        <Link href={`/admin/diretta/registro?persona=${m.userId}`} className="hover:underline">
                                            {m.persona || "Senza nome"}
                                        </Link>
                                    </div>
                                    <div className="text-[13px] text-[#BFBFBF]">{causaleTesto(m.reason)}</div>
                                </div>
                                <div className="shrink-0 text-right tabular-nums">
                                    {importoConSegno(m.amount)} {nomeValuta(m.currency, Math.abs(m.amount))}
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
            </section>
        </PaginaAdmin>
    )
}
