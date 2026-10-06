import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { leggiCodaIaVocale, MOTIVI_IA_VOCALE } from "@/lib/iaVocaleQuery"

export const dynamic = "force-dynamic"

/**
 * Coda dell'IA vocale in CSV per il Google Sheet aziendale dell'amministrazione, che la
 * rilegge da solo con IMPORTDATA (PO 06/10/2026: il foglio e' accessibile solo agli
 * account aziendali). Niente sessione, un Google Sheet non ne ha: protetta da
 * `?token=` = IA_VOCALE_EXPORT_TOKEN (confronto a tempo costante); senza env la rotta
 * e' spenta. Dentro ci sono nomi e telefoni: il link vive solo nella formula del foglio.
 */
export async function GET(req: NextRequest) {
    const atteso = process.env.IA_VOCALE_EXPORT_TOKEN
    const dato = req.nextUrl.searchParams.get("token") ?? ""
    if (!atteso) return new NextResponse("export non configurato", { status: 503 })
    const a = Buffer.from(dato)
    const b = Buffer.from(atteso)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return new NextResponse("forbidden", { status: 403 })

    const righe = await leggiCodaIaVocale("fenice")
    const cella = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`
    const quando = (iso: string) =>
        new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
    const csv = [
        ["Nome", "Telefono", "Email", "Funnel", "In coda dal", "Motivo"].map(cella).join(","),
        ...righe.map(r => [r.nome, r.telefono, r.email, r.funnel, quando(r.inCodaDal), r.motivo ? (MOTIVI_IA_VOCALE[r.motivo] ?? r.motivo) : ""].map(cella).join(",")),
    ].join("\n")
    return new NextResponse(csv, {
        headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" },
    })
}
