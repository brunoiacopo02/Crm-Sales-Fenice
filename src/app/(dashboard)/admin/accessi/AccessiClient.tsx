"use client"

// Elenco degli accessi con la reimpostazione di email e password, una riga
// alla volta (si apre con Reimposta).

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { reimpostaCredenziali, type AccessoTeam } from "@/app/actions/credenzialiActions"
import { bottone } from "@/components/diretta/admin/ui"
import { PASSWORD_MIN } from "@/lib/auth/credenziali"

const RUOLI: Record<string, string> = {
    GDO: "GDO", CONFERME: "Conferme", VENDITORE: "Venditore", MANAGER: "Manager", TL: "Team leader",
}
const CAMPO = "h-10 w-full rounded-[8px] border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[14px] text-[#F2F2F2] placeholder:text-[#8C8C8C] [color-scheme:dark] focus:border-[#FF9330] focus:outline-none"
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

export function AccessiClient({ righe }: { righe: AccessoTeam[] }) {
    const [cerca, setCerca] = useState("")
    const [soloAttivi, setSoloAttivi] = useState(true)
    const mostrate = useMemo(() => {
        const f = fold(cerca.trim())
        return righe.filter(r => (!soloAttivi || r.attivo) && (!f || fold(`${r.nome} ${r.email} ${RUOLI[r.ruolo] ?? r.ruolo}`).includes(f)))
    }, [righe, cerca, soloAttivi])

    return (
        <div className="mt-8 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <input type="search" value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca per nome, email o ruolo" aria-label="Cerca un account" className={`${CAMPO} max-w-sm`} />
                <label className="flex cursor-pointer items-center gap-2 text-[14px] text-[#BFBFBF]">
                    <input type="checkbox" checked={soloAttivi} onChange={e => setSoloAttivi(e.target.checked)} className="h-4 w-4 accent-[#FF9330]" />
                    Solo account attivi
                </label>
            </div>
            <div className="rounded-[16px] bg-[#262626]">
                {mostrate.length === 0 && <div className="p-5 text-[14px] text-[#BFBFBF]">Nessun account.</div>}
                {mostrate.map(r => <RigaAccesso key={r.id} r={r} />)}
            </div>
        </div>
    )
}

function RigaAccesso({ r }: { r: AccessoTeam }) {
    const router = useRouter()
    const [aperta, setAperta] = useState(false)
    const [email, setEmail] = useState(r.email)
    const [password, setPassword] = useState("")
    const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null)
    const [pending, startTransition] = useTransition()

    const salva = () => {
        setEsito(null)
        startTransition(async () => {
            try {
                const res = await reimpostaCredenziali(r.id, { email, password })
                if (!res.ok) { setEsito({ ok: false, testo: res.error }); return }
                setPassword("")
                setEsito({ ok: true, testo: password ? "Fatto. Comunica tu la password nuova alla persona." : "Fatto." })
                router.refresh()
            } catch {
                setEsito({ ok: false, testo: "Connessione assente. Riprova tra poco." })
            }
        })
    }

    return (
        <div className="border-b-2 border-[#2E2E2E] px-5 py-4 last:border-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">
                        {r.nome}
                        <span className="font-normal text-[#BFBFBF]">, {RUOLI[r.ruolo] ?? r.ruolo}{r.attivo ? "" : ", disattivato"}</span>
                    </div>
                    <div className="mt-0.5 break-all text-[14px] text-[#BFBFBF]">{r.email || "Senza email"}</div>
                </div>
                <button type="button" className={bottone(aperta ? "testo" : "linea", "piccola")} onClick={() => { setAperta(a => !a); setEsito(null) }} aria-expanded={aperta}>
                    {aperta ? "Chiudi" : "Reimposta"}
                </button>
            </div>
            {aperta && (
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                    <label className="text-[13px] text-[#BFBFBF]">
                        Email di accesso
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={`${CAMPO} mt-1.5`} />
                    </label>
                    <label className="text-[13px] text-[#BFBFBF]">
                        Password nuova (vuota = resta com&apos;è)
                        <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder={`Almeno ${PASSWORD_MIN} caratteri`} autoComplete="off" className={`${CAMPO} mt-1.5`} />
                    </label>
                    <button type="button" className={bottone("primario")} disabled={pending} onClick={salva}>
                        {pending ? "Un attimo" : "Salva"}
                    </button>
                </div>
            )}
            {esito && <div role="status" className={`mt-2 text-[14px] ${esito.ok ? "text-[#F2F2F2]" : "font-semibold text-[#FF9330]"}`}>{esito.testo}</div>}
        </div>
    )
}
