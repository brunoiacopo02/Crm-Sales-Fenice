"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, users, confirmationsNotes, leadEvents, notifications, calendarEvents } from "@/db/schema"
import { eq, asc, desc, and, or, like, between, isNull } from "drizzle-orm"
import crypto from "crypto"
import { createGoogleCalendarEvent, checkFreeBusy } from "@/lib/googleCalendar"
import { addHours } from "date-fns"
import { awardXpAndCoins } from "@/lib/gamificationEngine"

export async function getConfermeAppointments(filters: {
    startDate?: Date;
    endDate?: Date;
    timeSlot?: "mattina" | "pomeriggio" | "tutto";
    searchQuery?: string;
    confermeStatus?: "da_lavorare" | "confermati" | "scartati" | "tutti";
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    const conditions = [
        eq(leads.status, 'APPOINTMENT')
    ]

    if (filters.searchQuery) {
        const q = `%${filters.searchQuery}%`
        conditions.push(
            or(
                like(leads.name, q),
                like(leads.email, q),
                like(leads.phone, q)
            )!
        )
    }

    if (filters.confermeStatus) {
        if (filters.confermeStatus === "da_lavorare") {
            conditions.push(isNull(leads.confirmationsOutcome))
        } else if (filters.confermeStatus === "confermati") {
            conditions.push(eq(leads.confirmationsOutcome, "confermato"))
        } else if (filters.confermeStatus === "scartati") {
            conditions.push(eq(leads.confirmationsOutcome, "scartato"))
        }
    } else {
        // default "da_lavorare" se non passano status
        conditions.push(isNull(leads.confirmationsOutcome))
    }

    if (filters.startDate && filters.endDate) {
        conditions.push(between(leads.appointmentDate, filters.startDate, filters.endDate))
    }

    const query = await db.select({
        lead: leads,
        gdo: users,
    }).from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(and(...conditions))
        .orderBy(asc(leads.appointmentDate))

    let results = await query;

    // Filter time slot in JS to handle timezone easily
    if (filters.timeSlot && filters.timeSlot !== "tutto") {
        results = results.filter(row => {
            if (!row.lead.appointmentDate) return false;
            if (row.lead.appointmentDate) {
                // Get hour in Europe/Rome
                const d = new Date(row.lead.appointmentDate);
                const hourStr = new Intl.DateTimeFormat('it-IT', {
                    hour: 'numeric',
                    timeZone: 'Europe/Rome',
                    hour12: false
                }).format(d);
                const hour = parseInt(hourStr, 10);

                if (filters.timeSlot === "mattina") {
                    return hour >= 8 && hour < 15;
                } else if (filters.timeSlot === "pomeriggio") {
                    return hour >= 15 && hour <= 23;
                }
            }
            return true;
        })
    }

    const grouped: Record<string, typeof results> = {};
    const daDefinire: typeof results = [];

    for (const item of results) {
        if (item.lead.confNeedsReschedule) {
            daDefinire.push(item);
            continue;
        }

        if (item.lead.appointmentDate) {
            const d = new Date(item.lead.appointmentDate);
            const hourStr = new Intl.DateTimeFormat('it-IT', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Europe/Rome',
                hour12: false
            }).format(d);
            const hourKey = hourStr.split(':')[0] + ":00";
            if (!grouped[hourKey]) grouped[hourKey] = [];
            grouped[hourKey].push(item);
        } else {
            daDefinire.push(item);
        }
    }

    return {
        groupedByHour: grouped,
        daDefinire: daDefinire,
        flatList: results
    };
}

export async function updateLeadDataConferme(leadId: string, currentVersion: number, data: { name: string, email: string, appointmentDate: Date, appointmentNote: string }) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    // fetch old
    const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
    if (!oldLead) throw new Error("Lead not found")

    // Concurrency Check
    if (oldLead.version !== currentVersion) {
        throw new Error("CONCURRENCY_ERROR")
    }

    await db.update(leads).set({
        name: data.name,
        email: data.email,
        appointmentDate: data.appointmentDate,
        appointmentNote: data.appointmentNote,
        version: oldLead.version + 1,
        updatedAt: new Date()
    }).where(eq(leads.id, leadId))

    // Audit Log
    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: "conferme_edited_lead",
        userId: session.user.id,
        timestamp: new Date(),
        metadata: {
            old: { name: oldLead.name, email: oldLead.email, appointmentDate: oldLead.appointmentDate, appointmentNote: oldLead.appointmentNote },
            new: data
        }
    })

    return { success: true }
}

export async function getConfermeNotes(leadId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    return await db.select({
        note: confirmationsNotes,
        author: users
    }).from(confirmationsNotes)
        .leftJoin(users, eq(confirmationsNotes.authorId, users.id))
        .where(eq(confirmationsNotes.leadId, leadId))
        .orderBy(desc(confirmationsNotes.createdAt))

}

export async function addConfermeNote(leadId: string, text: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    const newNote = {
        id: crypto.randomUUID(),
        leadId,
        authorId: session.user.id,
        text,
        createdAt: new Date()
    }

    await db.insert(confirmationsNotes).values(newNote)
    return newNote
}

async function getSalespersonName(userId?: string) {
    if (!userId) return null;
    const user = (await db.select().from(users).where(eq(users.id, userId)))[0];
    return user ? (user.displayName || user.name || userId) : userId;
}

export async function setConfermeOutcome(leadId: string, currentVersion: number, outcome: "scartato" | "confermato", reason?: string, salespersonAssigned?: string) {
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" }
        }

        const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
        if (!oldLead) return { success: false, error: "Lead not found" }
        if (oldLead.version !== currentVersion) {
            console.error(`@@@ VERSION MISMATCH @@@ DB version: ${oldLead.version}, Client version: ${currentVersion}`);
            return { success: false, error: `CONCURRENCY_ERROR: DB è alla versione ${oldLead.version} ma il client ha inviato la versione ${currentVersion}` }
        }

        await db.update(leads).set({
            confirmationsOutcome: outcome,
            confirmationsDiscardReason: reason || null,
            confirmationsUserId: session.user.id,
            confirmationsTimestamp: new Date(),
            salespersonAssigned: await getSalespersonName(salespersonAssigned) || salespersonAssigned || null,
            salespersonUserId: salespersonAssigned || null,
            salespersonAssignedAt: salespersonAssigned ? new Date() : null,
            version: oldLead.version + 1,
            updatedAt: new Date()
        }).where(eq(leads.id, leadId))

        // Handle Calendar Event Creation
        if (outcome === "confermato" && salespersonAssigned && oldLead.appointmentDate) {
            const apptDate = new Date(oldLead.appointmentDate);
            const endTime = addHours(apptDate, 1);

            // FreeBusy Check
            const isFree = await checkFreeBusy(salespersonAssigned, apptDate, endTime);
            if (!isFree) {
                return { success: false, error: "Il venditore selezionato ha già un impegno in questa fascia oraria in Google Calendar." };
            }

            // Appuntamento durerà di default 1 ora
            await createGoogleCalendarEvent(
                salespersonAssigned,
                {
                    summary: `Appuntamento CRM: ${oldLead.name}`,
                    description: `Lead: ${oldLead.name}\nTelefono: ${oldLead.phone}\nEmail: ${oldLead.email || 'N/A'}\nFunnel: ${oldLead.funnel || 'N/A'}\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
                    startTime: apptDate,
                    endTime: endTime,
                    attendees: oldLead.email ? [{ email: oldLead.email }] : []
                },
                leadId,
                "appointment"
            ).then(res => console.log("Google Event Result:", res)).catch(err => {
                console.error("Could not create calendar event:", err.message)
                if (err.response) console.error("Google Auth Response:", err.response.data);
            })
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_outcome_set",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { outcome, reason, salespersonAssigned }
        })

        // Notifiche Live (Pilota E2E)
        if (outcome === "confermato" && salespersonAssigned) {
            const spName = await getSalespersonName(salespersonAssigned) || salespersonAssigned

            // Notifica al GDO
            if (oldLead.assignedToId) {
                await db.insert(notifications).values({
                    id: crypto.randomUUID(),
                    recipientUserId: oldLead.assignedToId,
                    type: 'appointment_confirmed',
                    title: 'Appuntamento Confermato! 🎉',
                    body: `Ottimo lavoro! Il tuo appuntamento per ${oldLead.name} è stato confermato e assegnato a ${spName}.`,
                    metadata: { leadId },
                    status: 'unread',
                    createdAt: new Date()
                })
            }

            // Notifica al Venditore
            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: salespersonAssigned, // L'argomento è l'ID utente!
                type: 'appointment_assigned',
                title: 'Nuovo Appuntamento! 📅',
                body: `Ti è stato assegnato un nuovo appuntamento confermato con ${oldLead.name}.`,
                metadata: { leadId },
                status: 'unread',
                createdAt: new Date()
            })
        }

        return { success: true }
    } catch (error: any) {
        console.error("@@@ CRITICAL ERROR IN setConfermeOutcome @@@", error);
        return { success: false, error: `INTERNAL_ERROR: ${error.message}` };
    }
}

export async function setSalespersonOutcome(leadId: string, currentVersion: number, outcome: "Chiuso" | "Non chiuso" | "Lead non presenziato", notes?: string) {
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" }
        }

        const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
        if (!oldLead) return { success: false, error: "Lead not found" }
        if (oldLead.version !== currentVersion) return { success: false, error: `CONCURRENCY_ERROR` }

        // Gamification RPC: Award only if it's the first time outcome is set
        if (!oldLead.salespersonOutcome && oldLead.assignedToId) {
            if (outcome === 'Chiuso') {
                await awardXpAndCoins(oldLead.assignedToId, "CHIUSO", leadId).catch(e => console.error("GameEngine CHIUSO err:", e));
            } else if (outcome === 'Non chiuso') {
                await awardXpAndCoins(oldLead.assignedToId, "PRESENZIATO", leadId).catch(e => console.error("GameEngine PRESENZIATO err:", e));
            }
        }

        await db.update(leads).set({
            salespersonOutcome: outcome,
            salespersonOutcomeNotes: notes || null,
            salespersonOutcomeAt: new Date(),
            version: oldLead.version + 1,
            updatedAt: new Date()
        }).where(eq(leads.id, leadId))

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "salesperson_outcome_set",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { outcome, notes }
        })

        return { success: true }
    } catch (error: any) {
        console.error("@@@ ERR IN setSalespersonOutcome @@@", error);
        return { success: false, error: error.message };
    }
}

export async function recordConfermeNoAnswer(leadId: string, currentVersion: number) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
    if (!oldLead) throw new Error("Lead not found");
    if (oldLead.version !== currentVersion) throw new Error("CONCURRENCY_ERROR");

    let toUpdate: any = { version: oldLead.version + 1, updatedAt: new Date() };

    if (!oldLead.confCall1At) {
        toUpdate.confCall1At = new Date();
    } else if (!oldLead.confCall2At) {
        toUpdate.confCall2At = new Date();
    } else if (!oldLead.confCall3At) {
        toUpdate.confCall3At = new Date();
    } else {
        return { success: false, error: "Tutti i tentalivi NR sono stati effettuati." };
    }

    await db.update(leads).set(toUpdate).where(eq(leads.id, leadId));

    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: "conferme_no_answer",
        userId: session.user.id,
        timestamp: new Date(),
        metadata: { fieldUpdated: Object.keys(toUpdate).find(k => k.startsWith('confCall')) }
    });

    return { success: true };
}

import { deleteGoogleCalendarEvent } from "@/lib/googleCalendar";

export async function scheduleConfermeRecall(leadId: string, currentVersion: number, payload: {
    recallDate?: Date | null,
    vslUnseen: boolean,
    newAppointmentDate?: Date | null,
    needsReschedule?: boolean
}) {
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            throw new Error("Unauthorized")
        }

        const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
        if (!oldLead) throw new Error("Lead not found");
        if (oldLead.version !== currentVersion) throw new Error("CONCURRENCY_ERROR");

        let toUpdate: any = {
            recallDate: payload.recallDate || null,
            confVslUnseen: payload.vslUnseen,
            confNeedsReschedule: payload.needsReschedule || false,
            version: oldLead.version + 1,
            updatedAt: new Date()
        };

        let calendarNeedsUpdate = false;
        let oldApptDate = oldLead.appointmentDate;
        let newApptDate = oldApptDate;

        if (payload.needsReschedule) {
            toUpdate.appointmentDate = null;
            newApptDate = null;
            if (oldLead.confirmationsOutcome === "confermato") calendarNeedsUpdate = true;
        } else if (payload.newAppointmentDate) {
            toUpdate.appointmentDate = payload.newAppointmentDate;
            newApptDate = payload.newAppointmentDate;
            if (oldLead.appointmentDate?.getTime() !== payload.newAppointmentDate.getTime() && oldLead.confirmationsOutcome === "confermato") {
                calendarNeedsUpdate = true;
            }
        }

        await db.update(leads).set(toUpdate).where(eq(leads.id, leadId));

        // Handle Calendar if already confirmed and shift/removal happened
        if (calendarNeedsUpdate && oldLead.salespersonUserId) {
            const calEvents = await db.select().from(calendarEvents).where(eq(calendarEvents.leadId, leadId));
            const evt = calEvents.find(e => e.eventType === "appointment");

            if (evt && evt.googleEventId) {
                // Delete old event
                await deleteGoogleCalendarEvent(oldLead.salespersonUserId, evt.googleEventId).catch((e: any) => console.error("GCal delete err:", e));
                await db.delete(calendarEvents).where(eq(calendarEvents.id, evt.id));
            }

            // recreate if new appointment date is set
            if (!payload.needsReschedule && newApptDate) {
                const endT = addHours(new Date(newApptDate), 1);
                await createGoogleCalendarEvent(
                    oldLead.salespersonUserId,
                    {
                        summary: `Appuntamento CRM: ${oldLead.name}`,
                        description: `Riprogrammato. Lead: ${oldLead.name}\nTelefono: ${oldLead.phone}\nEmail: ${oldLead.email || 'N/A'}\nFunnel: ${oldLead.funnel || 'N/A'}\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
                        startTime: new Date(newApptDate),
                        endTime: endT,
                        attendees: oldLead.email ? [{ email: oldLead.email }] : []
                    },
                    leadId,
                    "appointment"
                ).catch(err => console.error("Could not recreate calendar event:", err.message));
            }
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_recall_scheduled",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { payload }
        });

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
