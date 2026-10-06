import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import { leadEvents, leads } from "@/db/schema"
import { EVENTO_IA_VOCALE } from "@/lib/bot-fissatore/iaVocale"

export type LeadIaVocale = {
    id: string; nome: string; telefono: string; email: string | null; funnel: string | null
    inCodaDal: string; motivo: string | null; notaBot: string | null
}

export const MOTIVI_IA_VOCALE: Record<string, string> = {
    tetto_gdo_raggiunto: "GDO pieni (20 al giorno)",
    gdo_assente: "Tolto a GDO assente",
}

/**
 * Coda dell'IA vocale (PO 06/10/2026): lead nuovi ridati dal bot che non sono
 * andati a un GDO. Restano in coda finche' sono fuori dal CRM dei GDO
 * (assignedToId null) e ancora NEW: se un admin li riassegna o li scarta escono da soli.
 * Senza controllo di sessione: lo fanno i chiamanti (azione admin, export col token).
 */
export async function leggiCodaIaVocale(companyId: string): Promise<LeadIaVocale[]> {
    const eventi = await db.select({ leadId: leadEvents.leadId, timestamp: leadEvents.timestamp, metadata: leadEvents.metadata })
        .from(leadEvents)
        .where(and(eq(leadEvents.companyId, companyId), eq(leadEvents.eventType, EVENTO_IA_VOCALE)))
        .orderBy(desc(leadEvents.timestamp))
    const ultimo = new Map<string, { timestamp: Date; metadata: unknown }>()
    for (const e of eventi) if (!ultimo.has(e.leadId)) ultimo.set(e.leadId, e)
    const ids = [...ultimo.keys()]
    if (ids.length === 0) return []

    const righe: LeadIaVocale[] = []
    for (let i = 0; i < ids.length; i += 500) {
        const rows = await db.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, funnel: leads.funnel })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                inArray(leads.id, ids.slice(i, i + 500)),
                isNull(leads.assignedToId),
                eq(leads.status, 'NEW'),
            ))
        for (const r of rows) {
            const e = ultimo.get(r.id)!
            const m = (e.metadata ?? {}) as { motivo?: string; botNote?: string | null }
            righe.push({
                id: r.id, nome: r.name ?? '', telefono: r.phone ?? '', email: r.email, funnel: r.funnel,
                inCodaDal: e.timestamp.toISOString(), motivo: m.motivo ?? null, notaBot: m.botNote ?? null,
            })
        }
    }
    return righe.sort((a, b) => b.inCodaDal.localeCompare(a.inCodaDal) || a.nome.localeCompare(b.nome))
}
