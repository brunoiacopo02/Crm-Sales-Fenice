"use client"

import { useMemo, useState } from "react"
import { Download, Bot } from "lucide-react"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import type { LeadIaVocale } from "@/app/actions/iaVocaleActions"

const MOTIVI: Record<string, string> = {
    tetto_gdo_raggiunto: "GDO pieni (20 al giorno)",
    gdo_assente: "Tolto a un GDO assente",
}

/** Una cella CSV: separatore `;` (Excel italiano), virgolette raddoppiate. */
const cella = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`

/**
 * Coda dell'IA vocale (PO 06/10/2026): l'amministrazione scarica l'Excel e lo
 * passa all'IA che chiama. La lista si aggiorna da sola a ogni apertura.
 */
export function IaVocaleClient({ righe }: { righe: LeadIaVocale[] }) {
    const [soloOggi, setSoloOggi] = useState(false)
    const oggi = format(new Date(), "yyyy-MM-dd")
    const visibili = useMemo(
        () => (soloOggi ? righe.filter(r => format(new Date(r.inCodaDal), "yyyy-MM-dd") === oggi) : righe),
        [righe, soloOggi, oggi],
    )

    const scarica = () => {
        const intestazione = ["Nome", "Telefono", "Email", "Funnel", "In coda dal", "Motivo", "Nota del bot"].map(cella).join(";")
        const corpo = visibili.map(r => [
            r.nome, r.telefono, r.email, r.funnel,
            format(new Date(r.inCodaDal), "dd/MM/yyyy HH:mm"),
            r.motivo ? (MOTIVI[r.motivo] ?? r.motivo) : "",
            r.notaBot,
        ].map(cella).join(";"))
        // BOM: Excel apre l'UTF-8 con gli accenti giusti.
        const blob = new Blob(["﻿" + [intestazione, ...corpo].join("\r\n")], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `lead-ia-vocale-${oggi}${soloOggi ? "-oggi" : ""}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="mx-auto max-w-7xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Bot className="h-6 w-6 text-brand-orange" />
                    <h1 className="text-2xl font-bold text-ash-900">Lead per IA vocale</h1>
                    <span className="rounded-full bg-ash-100 px-2 py-0.5 text-sm font-bold text-ash-700">{visibili.length}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-sm text-ash-700">
                        <input type="checkbox" checked={soloOggi} onChange={e => setSoloOggi(e.target.checked)} />
                        Solo quelli entrati oggi
                    </label>
                    <button
                        onClick={scarica}
                        disabled={visibili.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
                    >
                        <Download className="h-4 w-4" /> Scarica Excel
                    </button>
                </div>
            </div>
            <p className="mb-4 text-sm text-ash-600">
                Lead nuovi ridati dal bot che non sono andati ai GDO (massimo 20 a testa al giorno) o tolti ai GDO assenti.
                Escono da qui da soli se vengono riassegnati o scartati nel CRM.
            </p>
            <div className="overflow-x-auto rounded-xl border border-ash-200/60 bg-white shadow-soft">
                <table className="min-w-full text-sm">
                    <thead className="bg-ash-50 text-left text-xs font-bold uppercase tracking-wide text-ash-600">
                        <tr>
                            <th className="px-3 py-2">Nome</th>
                            <th className="px-3 py-2">Telefono</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2">Funnel</th>
                            <th className="px-3 py-2">In coda dal</th>
                            <th className="px-3 py-2">Motivo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibili.length === 0 && (
                            <tr><td colSpan={6} className="px-3 py-8 text-center text-ash-500">Nessun lead in coda.</td></tr>
                        )}
                        {visibili.map(r => (
                            <tr key={r.id} className="border-t border-ash-100">
                                <td className="px-3 py-2 font-semibold text-ash-900">{r.nome}</td>
                                <td className="px-3 py-2 text-ash-800">{r.telefono}</td>
                                <td className="px-3 py-2 text-ash-600">{r.email}</td>
                                <td className="px-3 py-2 text-ash-600">{r.funnel}</td>
                                <td className="px-3 py-2 text-ash-600">{format(new Date(r.inCodaDal), "d MMM HH:mm", { locale: it })}</td>
                                <td className="px-3 py-2 text-ash-600">{r.motivo ? (MOTIVI[r.motivo] ?? r.motivo) : ""}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
