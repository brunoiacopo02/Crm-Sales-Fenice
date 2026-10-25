"use client"

// Interruttori della Diretta per ruolo (GDO, Conferme, admin). Spenta, ognuno
// vede il CRM di prima; si accende e si spegne senza deploy. Dopo il cambio la
// pagina si ridisegna: se è quello dell'admin, cambia anche la cornice.

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { setDirettaFlag } from "@/app/actions/direttaActions"
import type { RuoloDiretta } from "@/lib/diretta/config"
import { bottone } from "@/components/diretta/admin/ui"

const RUOLI: { ruolo: RuoloDiretta; nome: string; chi: string }[] = [
    { ruolo: 'GDO', nome: 'GDO', chi: 'i GDO' },
    { ruolo: 'CONFERME', nome: 'Conferme', chi: 'le Conferme' },
    { ruolo: 'ADMIN', nome: 'Admin', chi: "l'admin" },
]

export function InterruttoriDiretta({ flags }: { flags: Record<RuoloDiretta, boolean> }) {
    const router = useRouter()
    const [stato, setStato] = useState(flags)
    const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null)
    const [inCorso, avvia] = useTransition()

    // La pagina si ridisegna da sola: se un interruttore cambia altrove, si allinea.
    useEffect(() => {
        setStato({ GDO: flags.GDO, CONFERME: flags.CONFERME, ADMIN: flags.ADMIN })
    }, [flags.GDO, flags.CONFERME, flags.ADMIN])

    const cambia = (ruolo: RuoloDiretta, chi: string) => {
        const acceso = !stato[ruolo]
        const avviso = ruolo === 'ADMIN'
            ? `${acceso ? 'Accendere' : 'Spegnere'} la Diretta per l'admin? Cornice e menu cambiano subito.`
            : `${acceso ? 'Accendere' : 'Spegnere'} la Diretta per ${chi}? Chi ha il CRM aperto la vede cambiare al primo aggiornamento della pagina.`
        if (!window.confirm(avviso)) return
        avvia(async () => {
            try {
                const r = await setDirettaFlag(ruolo, acceso)
                if (r.success) {
                    setStato(s => ({ ...s, [ruolo]: acceso }))
                    setMessaggio({ ok: true, testo: `Diretta ${acceso ? 'accesa' : 'spenta'} per ${chi}.` })
                    router.refresh()
                } else {
                    setMessaggio({ ok: false, testo: r.error || 'Non salvato.' })
                }
            } catch {
                setMessaggio({ ok: false, testo: 'Connessione assente. Riprova tra poco.' })
            }
        })
    }

    return (
        <div>
            {RUOLI.map(({ ruolo, nome, chi }) => (
                <div key={ruolo} className="flex items-center justify-between gap-4 border-t-2 border-[#2E2E2E] py-2.5 first:border-t-0 first:pt-0">
                    <div className="min-w-0 text-[14px]">
                        {nome}
                        <span className={`ml-2 ${stato[ruolo] ? 'font-semibold text-[#F2F2F2]' : 'text-[#BFBFBF]'}`}>
                            {stato[ruolo] ? 'accesa' : 'spenta'}
                        </span>
                    </div>
                    <button
                        type="button"
                        disabled={inCorso}
                        onClick={() => cambia(ruolo, chi)}
                        aria-label={`${stato[ruolo] ? 'Spegni' : 'Accendi'} la Diretta per ${chi}`}
                        className={bottone(stato[ruolo] ? 'linea' : 'primario', 'piccola')}
                    >
                        {stato[ruolo] ? 'Spegni' : 'Accendi'}
                    </button>
                </div>
            ))}
            {messaggio && (
                <div role="status" className={`mt-3 text-[13px] ${messaggio.ok ? 'text-[#BFBFBF]' : 'text-[#FF9330]'}`}>
                    {messaggio.testo}
                </div>
            )}
        </div>
    )
}
