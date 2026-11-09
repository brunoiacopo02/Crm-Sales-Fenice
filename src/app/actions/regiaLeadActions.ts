"use server"

// Regia dei lead (/admin/diretta/regia-lead, PO 09/11/2026): le action della
// pagina. Solo ADMIN, letto dalla tabella users (conRuoloDb): ogni export passa
// da soloAdmin(). La logica sta in src/lib/diretta/regia.ts (regole pure) e
// regiaDb.ts (letture e scritture). Ogni operazione ha la sua anteprima e
// lascia una riga nello storico da cui si annulla.

import { revalidatePath, updateTag } from "next/cache"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { normalizzaFiltri } from "@/lib/diretta/regia"
import {
    ErroreRegia, TAG_REGIA, annullaOperazione, anteprimaInterruttori, anteprimaSingolo, eseguiChiusura, eseguiInterruttori,
    eseguiMassa, fotografiaAppuntamento, leggiElenco, leggiPanoramica, leggiPersone, leggiStorico, pianificaMassa,
    registraToltoAppuntamento,
    type AnteprimaInterruttori, type AnteprimaSingolo, type ElencoRegia, type EsitoMassa, type OperazioneStorico,
    type PanoramicaRegia, type PersonaRegia, type PianoMassa, type Posizione, type RichiestaInterruttori, type RichiestaMassa,
    type RichiestaSingolo, type TipoMassa, type TipoSingolo, type VocePiano,
} from "@/lib/diretta/regiaDb"

type Esito<T> = { ok: true; dati: T } | { ok: false; errore: string }

async function soloAdmin(): Promise<string | null> {
    const u = await conRuoloDb(["ADMIN"])
    return u?.id ?? null
}

async function prova<T>(nome: string, f: () => Promise<T>): Promise<Esito<T>> {
    try {
        return { ok: true, dati: await f() }
    } catch (e) {
        if (e instanceof ErroreRegia) return { ok: false, errore: e.message }
        console.error(`[regia lead] ${nome}`, e)
        return { ok: false, errore: "Qualcosa non ha funzionato. Niente è stato cambiato a metà: riprova." }
    }
}

const NO = { ok: false as const, errore: "Solo gli admin possono usare la regia dei lead." }

/** Dopo una scrittura: panoramica fresca e pagine dei GDO rilette. */
function dopoScrittura() {
    updateTag(TAG_REGIA)
    revalidatePath("/admin/diretta/regia-lead")
}

// ── Letture ──────────────────────────────────────────────────────────────

export async function leggiPanoramicaRegia(): Promise<Esito<{ panoramica: PanoramicaRegia; storico: OperazioneStorico[] }>> {
    if (!(await soloAdmin())) return NO
    return prova("panoramica", async () => ({ panoramica: await leggiPanoramica(), storico: await leggiStorico() }))
}

/** "Aggiorna ora": butta la cache della panoramica. */
export async function aggiornaRegia(): Promise<{ success: boolean }> {
    if (!(await soloAdmin())) return { success: false }
    updateTag(TAG_REGIA)
    return { success: true }
}

export async function leggiLeadRegia(sorgente: string, filtri: unknown): Promise<Esito<ElencoRegia>> {
    if (!(await soloAdmin())) return NO
    if (typeof sorgente !== "string" || sorgente.length > 100) return { ok: false, errore: "Sorgente non valida." }
    return prova("elenco", async () => leggiElenco(sorgente, normalizzaFiltri(filtri), await leggiPersone()))
}

// ── Operazioni di massa ──────────────────────────────────────────────────

export interface InputMassa {
    tipo: TipoMassa
    sorgente: string
    ids?: string[] | null
    filtri?: unknown
    quanti?: number | null
    destinatari?: string[]
    posizione?: Posizione
    motivo?: string
    ancheGiaContattati?: boolean
}

function richiestaMassa(x: InputMassa): RichiestaMassa {
    if (!["sposta", "al_bot", "accantona", "cima"].includes(x?.tipo)) throw new ErroreRegia("Operazione sconosciuta.")
    const ids = Array.isArray(x.ids) ? x.ids.filter(i => typeof i === "string").slice(0, 500) : null
    const quanti = typeof x.quanti === "number" && Number.isInteger(x.quanti) && x.quanti > 0 ? x.quanti : null
    return {
        tipo: x.tipo,
        sorgente: String(x.sorgente ?? ""),
        ids: ids && ids.length ? ids : null,
        filtri: ids && ids.length ? null : normalizzaFiltri(x.filtri),
        quanti,
        destinatari: Array.isArray(x.destinatari) ? x.destinatari.filter(i => typeof i === "string").slice(0, 30) : [],
        posizione: x.posizione === "scorta" ? "scorta" : "cima",
        motivo: typeof x.motivo === "string" ? x.motivo.slice(0, 300) : "",
        ancheGiaContattati: x.ancheGiaContattati === true,
    }
}

export async function anteprimaMassa(input: InputMassa): Promise<Esito<PianoMassa>> {
    if (!(await soloAdmin())) return NO
    return prova("anteprima", async () => (await pianificaMassa(richiestaMassa(input), await leggiPersone())).piano)
}

export async function confermaMassa(input: InputMassa, inclusi: VocePiano[]): Promise<Esito<EsitoMassa>> {
    const adminId = await soloAdmin()
    if (!adminId) return NO
    return prova("conferma", async () => {
        const voci = (Array.isArray(inclusi) ? inclusi : []).slice(0, 500)
            .filter(v => v && typeof v.id === "string")
            .map(v => ({ id: v.id, nome: String(v.nome ?? ""), a: typeof v.a === "string" ? v.a : null }))
        const esito = await eseguiMassa(richiestaMassa(input), voci, adminId, await leggiPersone())
        dopoScrittura()
        return esito
    })
}

// ── Singolo lead ─────────────────────────────────────────────────────────

export interface InputSingolo { tipo: TipoSingolo; leadId: string; motivo?: string; tenutoId?: string | null }

function richiestaSingolo(x: InputSingolo): RichiestaSingolo {
    if (!["scarta", "doppione", "togli_appuntamento"].includes(x?.tipo)) throw new ErroreRegia("Operazione sconosciuta.")
    if (typeof x.leadId !== "string" || !x.leadId) throw new ErroreRegia("Lead mancante.")
    return {
        tipo: x.tipo, leadId: x.leadId,
        motivo: typeof x.motivo === "string" ? x.motivo.slice(0, 200) : "",
        tenutoId: typeof x.tenutoId === "string" && x.tenutoId.trim() ? x.tenutoId.trim() : null,
    }
}

export async function anteprimaLead(input: InputSingolo): Promise<Esito<AnteprimaSingolo>> {
    if (!(await soloAdmin())) return NO
    return prova("anteprima lead", async () => anteprimaSingolo(richiestaSingolo(input), await leggiPersone()))
}

export async function confermaLead(input: InputSingolo): Promise<Esito<{ operazioneId: string }>> {
    const adminId = await soloAdmin()
    if (!adminId) return NO
    return prova("conferma lead", async () => {
        const r = richiestaSingolo(input)
        const persone = await leggiPersone()
        let esito: { operazioneId: string }
        if (r.tipo === "togli_appuntamento") {
            const a = await anteprimaSingolo(r, persone)
            if (a.bloccato) throw new ErroreRegia(`Non si può: ${a.bloccato}.`)
            const prima = await fotografiaAppuntamento(r.leadId)
            if (!prima) throw new ErroreRegia("Lead non trovato.")
            // Stessa azione dell'annullamento admin di sempre (storni economia, calendario del venditore).
            const { cancelLeadAppointment } = await import("./appointmentActions")
            const fatto = await cancelLeadAppointment(r.leadId)
            if (!fatto.success) throw new ErroreRegia(fatto.error ?? "Non sono riuscito a togliere l'appuntamento.")
            esito = { operazioneId: await registraToltoAppuntamento(adminId, r.leadId, prima.nome, prima.foto, { assignedToId: prima.assignedToId, callCount: prima.callCount }) }
        } else {
            esito = await eseguiChiusura(r, adminId, persone)
        }
        dopoScrittura()
        return esito
    })
}

// ── Interruttori ─────────────────────────────────────────────────────────

function richiestaInterruttori(x: RichiestaInterruttori): RichiestaInterruttori {
    if (typeof x?.userId !== "string") throw new ErroreRegia("GDO mancante.")
    const cap = x.dailyFreshCap === null || x.dailyFreshCap === undefined ? null : Number(x.dailyFreshCap)
    return { userId: x.userId, isActive: !!x.isActive, acAutoIntake: !!x.acAutoIntake, botReturnIntake: !!x.botReturnIntake, dailyFreshCap: cap }
}

export async function anteprimaInterruttoriGdo(input: RichiestaInterruttori): Promise<Esito<AnteprimaInterruttori>> {
    if (!(await soloAdmin())) return NO
    return prova("anteprima interruttori", async () => anteprimaInterruttori(richiestaInterruttori(input), await leggiPersone()))
}

export async function confermaInterruttoriGdo(input: RichiestaInterruttori): Promise<Esito<{ operazioneId: string | null }>> {
    const adminId = await soloAdmin()
    if (!adminId) return NO
    return prova("interruttori", async () => {
        const esito = await eseguiInterruttori(richiestaInterruttori(input), adminId, await leggiPersone())
        dopoScrittura()
        revalidatePath("/gestione")
        return esito
    })
}

// ── Annulla ──────────────────────────────────────────────────────────────

export async function annullaOperazioneRegia(operazioneId: string): Promise<Esito<{ ripristinati: number; saltati: { id: string; nome: string; motivo: string }[] }>> {
    const adminId = await soloAdmin()
    if (!adminId) return NO
    return prova("annulla", async () => {
        if (typeof operazioneId !== "string") throw new ErroreRegia("Operazione mancante.")
        const esito = await annullaOperazione(operazioneId, adminId, await leggiPersone())
        dopoScrittura()
        revalidatePath("/gestione")
        return esito
    })
}

export type { PersonaRegia }
