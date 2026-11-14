// Salvadanaio delle Conferme nella colonna arancione (titolare 14/11/2026): il
// bonus di squadra che la persona ha preso la settimana scorsa e quello del
// mese finora. Sempre per persona, mai il totale di squadra in euro; il
// conteggio delle chiusure di squadra resta perché spiega da dove viene la
// cifra. Solo visualizzazione: i conti sono in src/lib/economy/premiMese.ts,
// letti sul server al caricamento della pagina (cache 2 minuti).

import type { SalvadanaioConferme as Salvadanaio, SettimanaConferme } from "@/lib/economy/premiMese"
import { dateSettimana, nomeMese } from "@/lib/economy/premiMese"
import { formatEuro } from "./ui"

const maiuscola = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Squadra: 28 chiusure, 12 oltre la 16ª". */
export function fraseSquadra(s: SettimanaConferme): string {
    if (s.conteggio === null) return 'Quella settimana il bonus non era a settimana.'
    const unita = s.unita === 'presenze'
        ? (s.conteggio === 1 ? 'presenza' : 'presenze')
        : (s.conteggio === 1 ? 'chiusura' : 'chiusure')
    return `Squadra: ${s.conteggio} ${unita}, ${s.oltre} oltre la ${s.soglia}ª.`
}

function Voce({ titolo, euro, sotto }: { titolo: string; euro: number; sotto: string }) {
    return (
        <div className="border-t-2 border-[var(--d-orange-ink)]/20 py-2 first:border-t-0">
            <div className="flex items-baseline justify-between gap-3 text-[15px]">
                <div>{titolo}</div>
                <div className="font-semibold tabular-nums">{formatEuro(euro)}</div>
            </div>
            <div className="text-[13px]">{sotto}</div>
        </div>
    )
}

export function SalvadanaioConferme({ scorsa, mese }: { scorsa: SettimanaConferme | null; mese: Salvadanaio }) {
    const nome = nomeMese(mese.mese)
    const c = mese.inCorso
    return (
        <section aria-label="Il tuo bonus" className="space-y-3">
            <div className="rounded-lg border-2 border-[var(--d-orange-ink)]/20 px-4 py-3">
                {scorsa ? (
                    <>
                        <div className="flex items-baseline justify-between gap-3">
                            <h2 className="text-base font-medium">Settimana scorsa ({dateSettimana(scorsa.lunedi, scorsa.sabato)})</h2>
                            <div className="text-2xl font-semibold tabular-nums">{formatEuro(scorsa.euro)}</div>
                        </div>
                        <div className="mt-1 text-[13px]">{fraseSquadra(scorsa)}</div>
                    </>
                ) : (
                    <>
                        <h2 className="text-base font-medium">Settimana scorsa</h2>
                        <div className="mt-1 text-[13px]">Il bonus di squadra non c&apos;era ancora.</div>
                    </>
                )}
            </div>

            <div className="rounded-lg border-2 border-[var(--d-orange-ink)]/20 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-base font-medium">{maiuscola(nome)}, finora</h2>
                    <div className="text-2xl font-semibold tabular-nums">{formatEuro(mese.euroMese)}</div>
                </div>
                <div className="mt-2">
                    {mese.settimane.length === 0 && (
                        <div className="text-[13px]">
                            {c ? `La prima settimana di ${nome} si chiude sabato.` : `Le settimane di ${nome} non sono ancora iniziate.`}
                        </div>
                    )}
                    {mese.settimane.map(w => (
                        <Voce key={w.lunedi} titolo={dateSettimana(w.lunedi, w.sabato)} euro={w.euro} sotto={fraseSquadra(w)} />
                    ))}
                    {c && (
                        <Voce
                            titolo="Questa settimana, in maturazione"
                            euro={c.euro}
                            sotto={c.euro === 0 && c.euroATesta > 0
                                ? `${fraseSquadra(c)} Vale ${formatEuro(c.euroATesta)} a testa per chi conferma almeno un appuntamento.`
                                : fraseSquadra(c)}
                        />
                    )}
                </div>
            </div>
        </section>
    )
}
