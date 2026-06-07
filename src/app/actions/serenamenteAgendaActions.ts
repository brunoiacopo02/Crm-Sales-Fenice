"use server"
import { db } from "@/db"
import { leads } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { logLeadEvent } from "@/lib/eventLogger"

const AGENDA_URL = process.env.SERENAMENTE_AGENDA_URL ?? "https://web-app-messaggistica.vercel.app/api/send-agenda"

/** Normalizza un numero IT a E.164 best-effort (check silenzioso anti-errori). */
function normalizePhoneIT(raw: string): string | null {
    if (!raw) return null
    let p = raw.replace(/[^\d+]/g, "")
    if (!p) return null
    if (p.startsWith("+")) return p
    if (p.startsWith("00")) return "+" + p.slice(2)
    if (p.startsWith("39") && p.length >= 12) return "+" + p
    p = p.replace(/^0+/, "")
    if (!p) return null
    return "+39" + p
}

export type SendAgendaSerenamenteResult = { success: boolean; alreadySent?: boolean; error?: string; sid?: string }

export async function sendAgendaSerenamente(leadId: string): Promise<SendAgendaSerenamenteResult> {
    const ctx = await currentTenant(); assertSalesArea(ctx)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: "Non autenticato" }

    const secret = process.env.SERENAMENTE_AGENDA_SECRET
    if (!secret) return { success: false, error: "Config mancante: SERENAMENTE_AGENDA_SECRET non impostato" }

    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.companyId, ctx.companyId)))
    if (!lead) return { success: false, error: "Lead non trovato" }

    const phone = normalizePhoneIT(lead.phone || "")
    if (!phone) return { success: false, error: "Numero di telefono mancante o non valido" }

    const fullName = (lead.name || "").trim()
    const parts = fullName.split(/\s+/).filter(Boolean)
    const firstName = parts[0] || undefined
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined

    try {
        const res = await fetch(AGENDA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-agenda-secret": secret },
            body: JSON.stringify({ phone, firstName, lastName, email: lead.email || undefined }),
        })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok === false) {
            return { success: false, error: data?.error || `Errore invio (HTTP ${res.status})` }
        }

        const wasSent = lead.agendaSentAt !== null
        await db.update(leads).set({ agendaSentAt: new Date() })
            .where(and(eq(leads.id, leadId), eq(leads.companyId, ctx.companyId)))

        await logLeadEvent({
            leadId,
            eventType: "AGENDA_SENT",
            userId: user.id,
            metadata: { channel: "twilio", sid: data?.sid ?? null, conversationId: data?.conversationId ?? null, resend: wasSent },
            companyId: ctx.companyId,
        })

        return { success: true, alreadySent: wasSent, sid: data?.sid }
    } catch (e: any) {
        console.error("sendAgendaSerenamente error:", e)
        return { success: false, error: e?.message || "Errore invio agenda" }
    }
}
