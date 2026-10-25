"use client"

// "Le tue credenziali" nel profilo del GDO (PO 25/10/2026): email e password
// di accesso cambiate da qui, senza mail di conferma, dando la password
// attuale. L'admin le può sempre reimpostare da Accessi del team (lo si dice
// a voce, non nella schermata).

import { useEffect, useState, useTransition } from "react"
import { cambiaMieCredenziali, getMieCredenziali } from "@/app/actions/credenzialiActions"
import { PASSWORD_MIN } from "@/lib/auth/credenziali"
import { btn } from "./ui"

const CAMPO = "h-10 w-full rounded-[8px] border-2 border-[var(--d-line)] bg-transparent px-3 text-sm text-[var(--d-text)] placeholder:text-[var(--d-faint)] focus:border-[var(--d-muted)] focus:outline-none"

export function CredenzialiDiretta() {
    const [attuali, setAttuali] = useState<{ email: string; puoCambiare: boolean } | null>(null)
    const [aperta, setAperta] = useState(false)
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [ripeti, setRipeti] = useState("")
    const [attuale, setAttuale] = useState("")
    const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null)
    const [pending, startTransition] = useTransition()

    useEffect(() => {
        getMieCredenziali().then(c => { setAttuali(c); if (c) setEmail(c.email) }).catch(() => { })
    }, [])

    if (!attuali?.puoCambiare) return null

    const salva = () => {
        setEsito(null)
        startTransition(async () => {
            try {
                const r = await cambiaMieCredenziali({ email, password, ripeti, attuale })
                if (!r.ok) { setEsito({ ok: false, testo: r.error }); return }
                setAttuali({ ...attuali, email: email.trim().toLowerCase() || attuali.email })
                setPassword(""); setRipeti(""); setAttuale("")
                setEsito({ ok: true, testo: "Fatto. Dal prossimo accesso usa le credenziali nuove." })
                setAperta(false)
            } catch {
                setEsito({ ok: false, testo: "Connessione assente. Riprova tra poco." })
            }
        })
    }

    return (
        <section aria-label="Le tue credenziali" className="rounded-[16px] bg-[var(--d-surface)] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-lg font-semibold">Le tue credenziali</h2>
                    <div className="mt-1 break-all text-sm text-[var(--d-muted)]">Entri con {attuali.email || "la tua email"}.</div>
                </div>
                <button type="button" className={btn.linea} onClick={() => { setAperta(a => !a); setEsito(null) }} aria-expanded={aperta}>
                    {aperta ? "Chiudi" : "Cambia email o password"}
                </button>
            </div>
            {aperta && (
                <div className="mt-5 grid max-w-2xl gap-4 sm:grid-cols-2">
                    <label className="text-sm text-[var(--d-muted)] sm:col-span-2">
                        Email di accesso
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className={`${CAMPO} mt-1.5`} />
                    </label>
                    <label className="text-sm text-[var(--d-muted)]">
                        Password nuova (vuota = resta com&apos;è)
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder={`Almeno ${PASSWORD_MIN} caratteri`} className={`${CAMPO} mt-1.5`} />
                    </label>
                    <label className="text-sm text-[var(--d-muted)]">
                        Ripeti la password nuova
                        <input type="password" value={ripeti} onChange={e => setRipeti(e.target.value)} autoComplete="new-password" className={`${CAMPO} mt-1.5`} />
                    </label>
                    <label className="text-sm text-[var(--d-muted)] sm:col-span-2">
                        Password attuale, per confermare
                        <input type="password" value={attuale} onChange={e => setAttuale(e.target.value)} autoComplete="current-password" className={`${CAMPO} mt-1.5 sm:max-w-sm`} />
                    </label>
                    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                        <button type="button" className={btn.primario} disabled={pending || !attuale} onClick={salva}>
                            {pending ? "Un attimo" : "Salva"}
                        </button>
                    </div>
                </div>
            )}
            {esito && <div role="status" className={`mt-3 text-sm ${esito.ok ? "text-[var(--d-text)]" : "font-semibold text-[var(--d-orange)]"}`}>{esito.testo}</div>}
        </section>
    )
}
