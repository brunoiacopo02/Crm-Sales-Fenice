"use server"

import { db } from "@/db"
import { leads, leadEvents, users } from "@/db/schema"
import { eq, desc, and } from "drizzle-orm"
import crypto from "crypto"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { nomeVeroOppure } from "@/lib/diretta/nomeSql"
import { assegnatarioPerGdo, eventoTimelinePerGdo } from "@/lib/diretta/vistaGdo"
import { leadDelMondoDiAccount, rifiutoMondoDiverso } from "@/lib/prova/sql"
import { daRifissareDalleConferme, notaConfermePerGdo } from "@/lib/diretta/daRifissare"
import { noteDelBotSulLead } from "@/lib/diretta/noteBotDb"
import { leadPerGdo, notaDaSalvareDalGdo } from "@/lib/diretta/noteBotPerGdo"

export async function getLeadProfile(leadId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const leadRow = (await db.select({
            id: leads.id,
            name: leads.name,
            email: leads.email,
            phone: leads.phone,
            funnel: leads.funnel,
            status: leads.status,
            callCount: leads.callCount,
            assignedToId: leads.assignedToId,
            // Nome vero del GDO (firstName), non "GDO 1xx" (PO 25/10/2026).
            assignedToName: nomeVeroOppure(users.firstName, users.name),
            assignedToIsBot: users.isBot,
            lastCallDate: leads.lastCallDate,
            lastCallNote: leads.lastCallNote,
            agendaSentAt: leads.agendaSentAt,
            recallDate: leads.recallDate,
            appointmentDate: leads.appointmentDate,
            appointmentNote: leads.appointmentNote,
            appointmentCreatedAt: leads.appointmentCreatedAt,
            discardReason: leads.discardReason,
            confNeedsReschedule: leads.confNeedsReschedule,
            confirmationsOutcome: leads.confirmationsOutcome,
            confRecallNotes: leads.confRecallNotes,
            version: leads.version,
            createdAt: leads.createdAt,
            updatedAt: leads.updatedAt,
        })
            .from(leads)
            .leftJoin(users, eq(leads.assignedToId, users.id))
            // Prova (migr. 0050): un account di prova apre solo i lead di prova,
            // nessun altro apre un lead di prova.
            .where(and(eq(leads.id, leadId), eq(leads.companyId, ctx.companyId), leadDelMondoDiAccount(ctx.userId))))
        [0]

    if (!leadRow) return null
    const { assignedToIsBot, confNeedsReschedule, confirmationsOutcome, confRecallNotes, ...resto } = leadRow
    // PO 29/10/2026: appuntamento che le Conferme stanno rifissando. La scheda
    // lo dice a chiunque la apra, con il giorno del richiamo e la nota delle
    // Conferme (al GDO solo se non nomina il bot).
    const daRifissare = daRifissareDalleConferme({ status: resto.status, appointmentDate: resto.appointmentDate, confNeedsReschedule, confirmationsOutcome })
        ? {
            richiamoIl: resto.recallDate,
            nota: ctx.role === 'GDO' ? notaConfermePerGdo(confRecallNotes) : (confRecallNotes?.trim() || null),
        }
        : null
    const lead = { ...resto, daRifissare }

    const events = await db.select({
            id: leadEvents.id,
            eventType: leadEvents.eventType,
            userId: leadEvents.userId,
            userName: nomeVeroOppure(users.firstName, users.name),
            userIsBot: users.isBot,
            fromSection: leadEvents.fromSection,
            toSection: leadEvents.toSection,
            metadata: leadEvents.metadata,
            timestamp: leadEvents.timestamp,
        })
            .from(leadEvents)
            .leftJoin(users, eq(leadEvents.userId, users.id))
            .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.companyId, ctx.companyId)))
            .orderBy(desc(leadEvents.timestamp))

    // Il GDO non vede mai il bot (PO 25/10/2026): l'assegnatario bot diventa
    // "In lavorazione" e la timeline arriva già filtrata e rinominata, così nel
    // browser non passa né un'etichetta né un metadata del bot. Per admin,
    // manager e Conferme la scheda resta quella di sempre.
    if (ctx.role === 'GDO') {
        // Le note del bot (ultima chiamata, appuntamento, motivo di scarto) non
        // arrivano al browser: si riconoscono dalla fonte, non dalle parole
        // (PO 29/10/2026). Se la lettura fallisce, via le note: mai una in più.
        const noteBot = await noteDelBotSulLead(leadId).catch(() => null)
        const leadGdo = noteBot
            ? leadPerGdo(lead, noteBot)
            : { ...lead, lastCallNote: null, appointmentNote: null, discardReason: null }
        return {
            lead: { ...leadGdo, assignedToName: assegnatarioPerGdo(lead.assignedToName, assignedToIsBot) },
            events: events.flatMap(e => {
                const v = eventoTimelinePerGdo(e, ctx.userId)
                return v ? [{
                    id: e.id,
                    eventType: v.tipo,
                    label: v.etichetta,
                    testo: v.testo,
                    userName: v.operatore,
                    fromSection: v.fromSection,
                    toSection: v.toSection,
                    metadata: null,
                    timestamp: e.timestamp,
                }] : []
            }),
        }
    }

    return {
        lead,
        events: events.map(e => ({
            id: e.id,
            eventType: e.eventType,
            userId: e.userId,
            userName: e.userName,
            fromSection: e.fromSection,
            toSection: e.toSection,
            metadata: e.metadata || null,
            timestamp: e.timestamp,
        }))
    }
}

export async function updateLeadContactInfo(
    leadId: string,
    currentVersion: number,
    data: {
        name: string
        phone: string
        email: string
        lastCallNote: string
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const ctx = await currentTenant()
        assertSalesArea(ctx)
        const name = data.name.trim()
        const phone = data.phone.trim()
        const email = data.email.trim()
        const lastCallNote = data.lastCallNote.trim()

        if (!name) return { success: false, error: "Il nome è obbligatorio." }
        if (phone.length < 5) return { success: false, error: "Il telefono deve avere almeno 5 cifre." }

        const [corrente] = await db.select({ isTest: leads.isTest, lastCallNote: leads.lastCallNote }).from(leads)
            .where(and(eq(leads.id, leadId), eq(leads.companyId, ctx.companyId))).limit(1)
        const rifiuto = corrente ? await rifiutoMondoDiverso(corrente, ctx.userId) : null
        if (rifiuto) return { success: false, error: rifiuto }

        // Il GDO non ha visto la nota del bot (campo vuoto nella scheda): se salva
        // i dati di contatto senza scrivere una nota, quella del bot resta.
        const notaSalvata = ctx.role === 'GDO' && corrente
            ? notaDaSalvareDalGdo(lastCallNote || null, corrente.lastCallNote, await noteDelBotSulLead(leadId))
            : (lastCallNote || null)

        const updated = await db.update(leads).set({
            name,
            phone,
            email: email || null,
            lastCallNote: notaSalvata,
            version: currentVersion + 1,
            updatedAt: new Date(),
        }).where(
            and(eq(leads.id, leadId), eq(leads.version, currentVersion), eq(leads.companyId, ctx.companyId))
        ).returning({ id: leads.id })

        if (updated.length === 0) {
            return { success: false, error: "CONCURRENCY_ERROR" }
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "contact_info_edited",
            metadata: JSON.stringify({ note: "Dati contatto aggiornati dal ContactDrawer" }),
            timestamp: new Date(),
            companyId: ctx.companyId,
        })

        return { success: true }
    } catch (err: any) {
        if (err?.code === "23505") {
            return { success: false, error: "Questo numero di telefono è già associato a un altro lead." }
        }
        console.error("updateLeadContactInfo error:", err)
        return { success: false, error: "Errore durante il salvataggio." }
    }
}
