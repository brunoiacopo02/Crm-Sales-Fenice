"use client"

// Storico dei premi in euro della settimana e calcolo a settimana chiusa.
// L'anteprima non scrive niente; "Registra" salva lo snapshot (e lo
// sostituisce, se la settimana era già registrata).

import { useState } from "react"
import { useRouter } from "next/navigation"
import { calcolaPremiSettimanaAdmin, type SettimanaPremi } from "@/app/actions/premiSettimanaActions"
import { euroPerPersona, type PremiSettimana } from "@/lib/economy/premiSettimana"

interface Regole {
    classifica: [number, number, number]
    minPresenze: number
    sogliaPresenze: number
    euroPresenza: number
    conferme: { unita: 'presenze' | 'chiusure'; periodo: 'settimana' | 'mese'; soglia: number; euro: number }
}

const eur = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n)
const giornoMese = (iso: string) => new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`))
const quando = (iso: string) => new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }).format(new Date(iso))

const btnScuro = "inline-flex h-9 items-center justify-center rounded-lg bg-brand-charcoal px-3 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
const btnLinea = "inline-flex h-9 items-center justify-center rounded-lg border border-ash-300 bg-white px-3 text-sm font-semibold text-ash-700 transition-colors hover:border-ash-500 disabled:opacity-60"

function RegoleBox({ r }: { r: Regole }) {
    const unita = r.conferme.unita === "chiusure" ? "chiusura" : "presenza"
    return (
        <div className="grid gap-3 rounded-2xl border border-ash-200 bg-white p-5 text-sm text-ash-700 sm:grid-cols-3">
            <div>
                <div className="font-semibold text-brand-charcoal">Classifica</div>
                <div className="mt-1">
                    Primi tre per presenze della settimana: {eur(r.classifica[0])}, {eur(r.classifica[1])}, {eur(r.classifica[2])} lordi.
                    A pari presenze contano i fissati validi, poi l&apos;ordine alfabetico. Serve almeno {r.minPresenze === 1 ? "una presenza" : `${r.minPresenze} presenze`}.
                </div>
            </div>
            <div>
                <div className="font-semibold text-brand-charcoal">Presenze GDO</div>
                <div className="mt-1">{eur(r.euroPresenza)} lordi per ogni presenza dalla {r.sogliaPresenze + 1}ª della settimana, a persona.</div>
            </div>
            <div>
                <div className="font-semibold text-brand-charcoal">Conferme</div>
                <div className="mt-1">
                    {r.conferme.periodo === "settimana"
                        ? <>{eur(r.conferme.euro)} lordi a testa per ogni {unita} di squadra oltre la {r.conferme.soglia}ª. A testa = chi ha confermato almeno un lead nella settimana.</>
                        : <>Il bonus Conferme è impostato a mese: qui non si chiude. Cambialo in /admin/diretta/conferme.</>}
                </div>
            </div>
        </div>
    )
}

function Tabella({ titolo, vuoto, colonne, righe }: { titolo: string; vuoto: string; colonne: string[]; righe: (string | number)[][] }) {
    return (
        <div>
            <div className="text-sm font-semibold text-brand-charcoal">{titolo}</div>
            {righe.length === 0 ? (
                <div className="mt-1 text-sm text-ash-500">{vuoto}</div>
            ) : (
                <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-sm tabular-nums">
                        <thead>
                            <tr className="text-ash-500">
                                {colonne.map((c, i) => <th key={c} className={`py-1 font-medium ${i > 0 ? "text-right" : ""}`}>{c}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {righe.map((r, i) => (
                                <tr key={i} className="border-t border-ash-100">
                                    {r.map((v, j) => <td key={j} className={`py-1.5 ${j > 0 ? "text-right" : ""}`}>{v}</td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

function Dettaglio({ p }: { p: PremiSettimana }) {
    const daPagare = euroPerPersona(p)
    return (
        <div className="mt-4 space-y-5">
            <Tabella
                titolo="Classifica"
                vuoto="Nessuno con abbastanza presenze."
                colonne={["Posizione", "Presenze", "Fissati validi", "Premio"]}
                righe={p.classifica.map(r => [`${r.posizione}° ${r.nome}`, r.presenze, r.fissati, eur(r.euro)])}
            />
            <Tabella
                titolo="Bonus presenze GDO"
                vuoto="Nessun GDO oltre la soglia."
                colonne={["GDO", "Presenze", "Pagate", "Bonus"]}
                righe={p.presenzeGdo.map(r => [r.nome, r.presenze, r.pagate, eur(r.euro)])}
            />
            <div>
                <div className="text-sm font-semibold text-brand-charcoal">Bonus Conferme</div>
                {!p.conferme ? (
                    <div className="mt-1 text-sm text-ash-500">Bonus a mese: non si chiude a settimana.</div>
                ) : (
                    <div className="mt-1 text-sm text-ash-700">
                        <span className="tabular-nums">{p.conferme.conteggio}</span> {p.conferme.unita} di squadra su una soglia di <span className="tabular-nums">{p.conferme.soglia}</span>
                        {p.conferme.oltre > 0
                            ? <>: {p.conferme.oltre} oltre, {eur(p.conferme.euroATesta)} a testa a {p.conferme.persone.map(x => x.nome).join(" e ") || "nessuno"}.</>
                            : <>: soglia non superata.</>}
                    </div>
                )}
            </div>
            <div className="rounded-xl bg-ash-50 p-4">
                <div className="flex items-baseline justify-between gap-4">
                    <div className="text-sm font-semibold text-brand-charcoal">Da pagare</div>
                    <div className="text-lg font-bold tabular-nums text-brand-charcoal">{eur(p.totaleEuro)}</div>
                </div>
                {daPagare.length > 0 && (
                    <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm text-ash-700 sm:grid-cols-2">
                        {daPagare.map(x => (
                            <li key={x.userId} className="flex justify-between gap-4">
                                <span>{x.nome}</span>
                                <span className="tabular-nums">{eur(x.euro)}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="mt-2 text-xs text-ash-500">Importi lordi, in busta paga.</div>
            </div>
        </div>
    )
}

export function PremiSettimanaClient({ settimane, regole }: { settimane: SettimanaPremi[]; regole: Regole }) {
    const router = useRouter()
    const [anteprime, setAnteprime] = useState<Record<string, PremiSettimana>>({})
    const [inCorso, setInCorso] = useState<string | null>(null)
    const [msg, setMsg] = useState<{ lunedi: string; testo: string; ok: boolean } | null>(null)
    const [conferma, setConferma] = useState<string | null>(null)

    const calcola = async (lunedi: string, registra: boolean) => {
        if (inCorso) return
        setInCorso(lunedi)
        setMsg(null)
        try {
            const r = await calcolaPremiSettimanaAdmin(lunedi, registra)
            if (!r.ok) {
                setMsg({ lunedi, testo: r.error, ok: false })
                return
            }
            setAnteprime(a => ({ ...a, [lunedi]: r.premi }))
            setConferma(null)
            if (r.registrata) {
                setMsg({ lunedi, testo: "Registrata.", ok: true })
                router.refresh()
            }
        } catch {
            setMsg({ lunedi, testo: "Connessione assente. Riprova tra poco.", ok: false })
        } finally {
            setInCorso(null)
        }
    }

    return (
        <div className="space-y-6">
            <RegoleBox r={regole} />
            {settimane.length === 0 && <div className="text-sm text-ash-500">Le settimane compaiono dal primo lunedì della nuova economia.</div>}
            {settimane.map(s => {
                const registrata = s.registrata
                const anteprima = anteprime[s.lunedi]
                const mostra = anteprima ?? registrata?.premi ?? null
                const occupato = inCorso === s.lunedi
                return (
                    <section key={s.lunedi} className="rounded-2xl border border-ash-200 bg-white p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h2 className="text-base font-bold text-brand-charcoal">
                                    Settimana {giornoMese(s.lunedi)} - {giornoMese(s.sabato)}
                                </h2>
                                <div className="mt-0.5 text-sm text-ash-500">
                                    {!s.chiusa
                                        ? "In corso: si registra dalla domenica."
                                        : registrata
                                            ? `Registrata il ${quando(registrata.computedAt)}${registrata.computedBy ? ` da ${registrata.computedBy}` : ""}.`
                                            : "Chiusa, da registrare."}
                                    {anteprima && !msg?.ok && " Quella sotto è un'anteprima, non registrata."}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" className={btnLinea} disabled={occupato} onClick={() => calcola(s.lunedi, false)}>
                                    {occupato ? "Calcolo..." : "Anteprima"}
                                </button>
                                {s.chiusa && !registrata && (
                                    <button type="button" className={btnScuro} disabled={occupato} onClick={() => calcola(s.lunedi, true)}>Registra</button>
                                )}
                                {s.chiusa && registrata && conferma !== s.lunedi && (
                                    <button type="button" className={btnLinea} disabled={occupato} onClick={() => setConferma(s.lunedi)}>Ricalcola</button>
                                )}
                                {s.chiusa && registrata && conferma === s.lunedi && (
                                    <button type="button" className={btnScuro} disabled={occupato} onClick={() => calcola(s.lunedi, true)}>Conferma: riscrivi</button>
                                )}
                            </div>
                        </div>
                        {msg?.lunedi === s.lunedi && (
                            <div className={`mt-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.testo}</div>
                        )}
                        {mostra && <Dettaglio p={mostra} />}
                    </section>
                )
            })}
        </div>
    )
}
