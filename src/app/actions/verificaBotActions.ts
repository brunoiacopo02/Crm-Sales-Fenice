"use server"

/**
 * "App da verificare" nella board Conferme (PO 07/11/2026).
 *
 * Regole in src/lib/conferme/verificaBot.ts, stato scritto da POST /api/bot/verifica-presenza.
 * Come le confAlert*, nessuna UPDATE qui tocca `version` o `updatedAt`: il ping Broadcast
 * 'leads' del trigger 0019 parte comunque e allinea tutti gli schermi.
 */

import crypto from "crypto"
import { db } from "@/db"
import { internalAlerts, leads, notifications } from "@/db/schema"
import { caricaCoorteVerifica } from "@/lib/conferme/verificaBotDb"
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { leadDelMondoDiAccount } from "@/lib/prova/sql"
import { logLeadEvent } from "@/lib/eventLogger"
import {
    statoVerifica,
    motivoDaChiamare,
    type StatoVerifica,
} from "@/lib/conferme/verificaBot"

export type AppDaVerificareRow = {
    id: string
    name: string
    phone: string | null
    companyId: string
    appointmentDate: string
    salespersonName: string | null
    stato: StatoVerifica
    dueAt: string | null
    motivo: string | null
    risposta: string | null
}

export type AppDaVerificarePayload = {
    rows: AppDaVerificareRow[]
    /** Prossimo istante in cui uno stato cambia da solo (messaggio, scadenza 30 min). */
    nextWakeAt: string | null
}

const RUOLI = new Set(["CONFERME", "MANAGER", "ADMIN"])

async function ctxVerifica() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!RUOLI.has(ctx.role)) return null
    return ctx
}

export async function getAppDaVerificare(): Promise<AppDaVerificarePayload> {
    const ctx = await ctxVerifica()
    if (!ctx) return { rows: [], nextWakeAt: null }
    const now = new Date()
    const rows = await caricaCoorteVerifica(ctx.allowedCompanies, ctx.userId, now)

    const wake: number[] = []
    const out: AppDaVerificareRow[] = rows.map(r => {
        const s = statoVerifica(r, now)
        if ((s.stato === 'attesa_messaggio' || s.stato === 'in_attesa') && s.dueAt) wake.push(s.dueAt.getTime())
        return {
            id: r.id,
            name: r.name,
            phone: r.phone,
            companyId: r.companyId,
            appointmentDate: (r.appointmentDate as Date).toISOString(),
            salespersonName: r.salespersonName || r.salespersonRealName || null,
            stato: s.stato,
            dueAt: s.dueAt ? s.dueAt.toISOString() : null,
            motivo: s.stato === 'da_chiamare' ? motivoDaChiamare(r.botVerificaEsito) : null,
            risposta: r.botVerificaRisposta,
        }
    })
    // Dopo l'invio previsto il bot ha 5 minuti di giro: si ricontrolla anche lì.
    const futuri = wake.filter(t => t > now.getTime())
    return { rows: out, nextWakeAt: futuri.length ? new Date(Math.min(...futuri)).toISOString() : null }
}

/**
 * La verifica si ancora alla call di adesso: se quella registrata era di una data
 * vecchia (call spostata), il messaggio e la risposta di allora non valgono più.
 * Postgres valuta le espressioni di SET sui valori di prima dell'UPDATE.
 */
const cambiata = sql`${leads.botVerificaApptAt} is distinct from ${leads.appointmentDate}`
const ancoraAllaCall = {
    botVerificaApptAt: sql`${leads.appointmentDate}`,
    botVerificaSentAt: sql`case when ${cambiata} then null else ${leads.botVerificaSentAt} end`,
    botVerificaEsito: sql`case when ${cambiata} then null else ${leads.botVerificaEsito} end`,
    botVerificaRisposta: sql`case when ${cambiata} then null else ${leads.botVerificaRisposta} end`,
}

/** Le Conferme l'hanno presa in mano (aperta dall'avviso, confermata a voce): spenta per tutti. */
export async function segnaVerificaGestita(leadId: string): Promise<{ ok: boolean }> {
    const ctx = await ctxVerifica()
    if (!ctx) return { ok: false }
    await db.update(leads)
        .set({
            botVerificaGestitaAt: new Date(),
            ...ancoraAllaCall,
            confAlertSnoozedUntil: null,
        })
        .where(and(
            eq(leads.id, leadId),
            inArray(leads.companyId, ctx.allowedCompanies),
            leadDelMondoDiAccount(ctx.userId),
        ))
    await logLeadEvent({
        leadId, eventType: 'VERIFICA_GESTITA', userId: ctx.userId, companyId: ctx.companyId,
        metadata: { da: ctx.role },
    }).catch(() => { /* la timeline non blocca */ })
    return { ok: true }
}

function oraRoma(d: Date): string {
    return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(d)
}

/**
 * "Sparito": il lead non ha confermato col bot e non risponde alle Conferme. Si segna sul
 * lead e si avvisa il venditore assegnato con l'avviso a schermo (internalAlerts, lo
 * stesso del "Avviso dal Team") più la campanella. L'esito della trattativa NON si scrive
 * qui: lo mette il venditore dopo la call, perché il lead può ancora presentarsi.
 */
export async function segnaVerificaSparito(leadId: string): Promise<{ ok: boolean; error?: string; venditoreAvvisato?: boolean }> {
    const ctx = await ctxVerifica()
    if (!ctx) return { ok: false, error: 'Non autorizzato' }
    const now = new Date()

    const [lead] = await db.select({
        id: leads.id,
        name: leads.name,
        companyId: leads.companyId,
        appointmentDate: leads.appointmentDate,
        salespersonUserId: leads.salespersonUserId,
        botVerificaApptAt: leads.botVerificaApptAt,
        botVerificaSparitoAt: leads.botVerificaSparitoAt,
    }).from(leads).where(and(
        eq(leads.id, leadId),
        inArray(leads.companyId, ctx.allowedCompanies),
        leadDelMondoDiAccount(ctx.userId),
    )).limit(1)
    if (!lead) return { ok: false, error: 'Lead non trovato' }
    if (!lead.appointmentDate) return { ok: false, error: 'Il lead non ha un appuntamento' }
    // Uno "sparito" di una call vecchia (poi spostata) non conta per quella di adesso.
    const giaSparito = !!lead.botVerificaSparitoAt && !!lead.botVerificaApptAt
        && lead.botVerificaApptAt.getTime() === lead.appointmentDate.getTime()
    if (giaSparito) return { ok: true, venditoreAvvisato: false }

    // Compare-and-set: di due click in volo insieme ne passa uno, e una sola notifica.
    const upd = await db.update(leads)
        .set({
            botVerificaSparitoAt: now,
            botVerificaSparitoById: ctx.userId,
            botVerificaGestitaAt: now,
            ...ancoraAllaCall,
            confAlertSnoozedUntil: null,
        })
        .where(and(
            eq(leads.id, leadId),
            or(isNull(leads.botVerificaSparitoAt), sql`${leads.botVerificaApptAt} is distinct from ${leads.appointmentDate}`),
        ))
        .returning({ id: leads.id })
    if (upd.length === 0) return { ok: true, venditoreAvvisato: false }

    const quando = lead.appointmentDate ? oraRoma(lead.appointmentDate) : ''
    const testo = `${lead.name} (call delle ${quando}) non ha confermato col bot e non risponde alle Conferme: segnato SPARITO. Prova comunque all'orario della call e poi registra l'esito.`

    let venditoreAvvisato = false
    if (lead.salespersonUserId) {
        try {
            await db.insert(internalAlerts).values({
                id: crypto.randomUUID(),
                senderId: ctx.userId,
                receiverId: lead.salespersonUserId,
                message: testo,
                companyId: lead.companyId,
            })
            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: lead.salespersonUserId,
                type: 'lead_sparito_verifica',
                title: 'Lead probabilmente sparito',
                body: testo,
                metadata: { leadId },
                status: 'unread',
                createdAt: now,
                companyId: lead.companyId,
            })
            venditoreAvvisato = true
        } catch (e) {
            console.error('[verifica] avviso venditore fallito', e)
        }
    }

    await logLeadEvent({
        leadId, eventType: 'VERIFICA_SPARITO', userId: ctx.userId, companyId: lead.companyId,
        metadata: { appuntamentoAt: lead.appointmentDate?.toISOString() ?? null, venditore: lead.salespersonUserId, venditoreAvvisato },
    }).catch(() => { /* la timeline non blocca */ })

    return { ok: true, venditoreAvvisato }
}
