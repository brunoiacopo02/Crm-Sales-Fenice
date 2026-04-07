"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, users, confirmationsNotes, leadEvents, notifications, calendarEvents } from "@/db/schema"
import { eq, asc, desc, and, or, like, between, isNull, isNotNull } from "drizzle-orm"
import crypto from "crypto"
import { createGoogleCalendarEvent, checkFreeBusy } from "@/lib/googleCalendar"
import { addHours } from "date-fns"
import { awardXpAndCoins } from "@/lib/gamificationEngine"

export async function getConfermeAppointments(filters: {
    startDate?: Date;
    endDate?: Date;
    timeSlot?: "mattina" | "pomeriggio" | "tutto";
    searchQuery?: string;
    confermeStatus?: "da_lavorare" | "confermati" | "scartati" | "storico" | "tutti";
    fetchMode?: "strict_kanban" | "all";
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
        } else if (filters.confermeStatus === "storico") {
            conditions.push(isNotNull(leads.confirmationsOutcome))
        }
    } else {
        // default "da_lavorare" se non passano status
        conditions.push(isNull(leads.confirmationsOutcome))
    }

    if (filters.fetchMode === 'strict_kanban') {
        const todayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const [month, day, year] = todayStr.split('/');
        const todayRome = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

        const start = new Date(todayRome);
        start.setDate(start.getDate() - 1);
        const end = new Date(todayRome);
        end.setDate(end.getDate() + 4);

        conditions.push(or(between(leads.appointmentDate, start, end), eq(leads.confNeedsReschedule, true))!);
    } else if (filters.startDate && filters.endDate) {
        conditions.push(between(leads.appointmentDate, filters.startDate, filters.endDate))
    }

    let query = db.select({
        lead: leads,
        gdo: users,
    }).from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(and(...conditions))
        .orderBy(desc(leads.appointmentCreatedAt)) // Better default ordering for all

    if (filters.fetchMode === 'all') {
        query = query.limit(500) as any;
    }

    let results = await query;

    // Filter time slot in JS to handle timezone easily
    if (filters.timeSlot && filters.timeSlot !== "tutto") {
        results = results.filter(row => {
            if (row.lead.confNeedsReschedule) return true; // Bypass timeframe hide for Parcheggiati
            if (!row.lead.appointmentDate) return false;

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
            return true;
        })
    }

    if (filters.fetchMode === 'strict_kanban') {
        const now = new Date();
        const romeDayOfWeekStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short' }).format(now); // Mon, Tue, etc.
        const romeDayOfWeek = romeDayOfWeekStr.substring(0, 3).toLowerCase();

        const todayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

        results = results.filter(row => {
            if (row.lead.confNeedsReschedule) return true; // Always show da definire
            if (!row.lead.appointmentDate) return false;

            const appt = new Date(row.lead.appointmentDate);
            const apptDateStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(appt);
            const apptHour = parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(appt), 10);

            const isToday = apptDateStr === todayStr;

            // Calculate tomorrow/next working day string
            const nextWorkDay = new Date(now);
            if (romeDayOfWeek === 'fri') {
                nextWorkDay.setDate(nextWorkDay.getDate() + 1); // Saturday
            } else if (romeDayOfWeek === 'sat') {
                nextWorkDay.setDate(nextWorkDay.getDate() + 2); // Monday
            } else if (romeDayOfWeek === 'sun') {
                nextWorkDay.setDate(nextWorkDay.getDate() + 1); // Monday
            } else {
                nextWorkDay.setDate(nextWorkDay.getDate() + 1); // Next day
            }
            const nextWorkDayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nextWorkDay);

            const isNextWorkDay = apptDateStr === nextWorkDayStr;

            if (romeDayOfWeek === 'sat') {
                // Saturday Rule: Today 13:00-21:00, Monday 09:00-14:00
                if (isToday && apptHour >= 13 && apptHour <= 21) return true;
                if (isNextWorkDay && apptHour >= 9 && apptHour <= 14) return true;
            } else if (romeDayOfWeek === 'fri') {
                // Friday Rule: Today 15:00-21:00, Saturday 09:00-14:00
                if (isToday && apptHour >= 15 && apptHour <= 21) return true;
                if (isNextWorkDay && apptHour >= 9 && apptHour <= 14) {
                    // Exception for 13:00 and 14:00 on Saturday
                    if (apptHour === 13 || apptHour === 14) {
                        if (!row.lead.appointmentCreatedAt) return false;
                        const created = new Date(row.lead.appointmentCreatedAt);
                        const hoursSinceCreated = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
                        if (hoursSinceCreated >= 12) return true;
                        return false;
                    }
                    return true;
                }
            } else if (romeDayOfWeek === 'sun') {
                // Sunday Rule: Tomorrow (Monday) 09:00-14:00
                if (isNextWorkDay && apptHour >= 9 && apptHour <= 14) return true;
            } else {
                // Mon-Thu Rule: Today 15:00-21:00, Tomorrow 09:00-14:00
                if (isToday && apptHour >= 15 && apptHour <= 21) return true;
                if (isNextWorkDay && apptHour >= 9 && apptHour <= 14) return true;
            }

            return false;
        });
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

    const updated = await db.update(leads).set({
        name: data.name,
        email: data.email,
        appointmentDate: data.appointmentDate,
        appointmentNote: data.appointmentNote,
        version: oldLead.version + 1,
        updatedAt: new Date()
    }).where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version)))
    .returning({ id: leads.id })

    if (updated.length === 0) {
        throw new Error("CONCURRENCY_ERROR")
    }

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

        // FreeBusy Check BEFORE DB update to avoid inconsistent state
        if (outcome === "confermato" && salespersonAssigned && oldLead.appointmentDate) {
            const apptDate = new Date(oldLead.appointmentDate);
            const endTime = addHours(apptDate, 1);

            const isFree = await checkFreeBusy(salespersonAssigned, apptDate, endTime);
            if (!isFree) {
                return { success: false, error: "Il venditore selezionato ha già un impegno in questa fascia oraria in Google Calendar." };
            }
        }

        const updated = await db.update(leads).set({
            confirmationsOutcome: outcome,
            confirmationsDiscardReason: reason || null,
            confirmationsUserId: session.user.id,
            confirmationsTimestamp: new Date(),
            salespersonAssigned: await getSalespersonName(salespersonAssigned) || salespersonAssigned || null,
            salespersonUserId: salespersonAssigned || null,
            salespersonAssignedAt: salespersonAssigned ? new Date() : null,
            version: oldLead.version + 1,
            updatedAt: new Date()
        }).where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version)))
        .returning({ id: leads.id })

        if (updated.length === 0) {
            return { success: false, error: 'CONCURRENCY_ERROR' }
        }

        // Create Calendar Event after successful DB update
        if (outcome === "confermato" && salespersonAssigned && oldLead.appointmentDate) {
            const apptDate = new Date(oldLead.appointmentDate);
            const endTime = addHours(apptDate, 1);

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

        // Gamification: award XP/coins to Conferme worker on confirmation
        if (outcome === "confermato") {
            await awardXpAndCoins(session.user.id, "CONFERMATO", leadId).catch(e => console.error("GameEngine CONFERMATO err:", e));
        }

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

        const updated = await db.update(leads).set({
            salespersonOutcome: outcome,
            salespersonOutcomeNotes: notes || null,
            salespersonOutcomeAt: new Date(),
            version: oldLead.version + 1,
            updatedAt: new Date()
        }).where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version)))
        .returning({ id: leads.id })

        if (updated.length === 0) {
            return { success: false, error: 'CONCURRENCY_ERROR' }
        }

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
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" }
        }

        const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
        if (!oldLead) return { success: false, error: "Lead not found" };
        if (oldLead.version !== currentVersion) return { success: false, error: "CONCURRENCY_ERROR" };

        let toUpdate: any = { version: oldLead.version + 1, updatedAt: new Date() };
        let isAutoDiscard = false;

        if (!oldLead.confCall1At) {
            toUpdate.confCall1At = new Date();
        } else if (!oldLead.confCall2At) {
            toUpdate.confCall2At = new Date();
        } else if (!oldLead.confCall3At) {
            toUpdate.confCall3At = new Date();
        } else {
            // 4th NR: auto-discard the lead
            isAutoDiscard = true;
            toUpdate.confirmationsOutcome = 'scartato';
            toUpdate.confirmationsDiscardReason = '4 NR consecutivi';
            toUpdate.confirmationsUserId = session.user.id;
            toUpdate.confirmationsTimestamp = new Date();
        }

        const updated = await db.update(leads).set(toUpdate)
        .where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version)))
        .returning({ id: leads.id });

        if (updated.length === 0) {
            return { success: false, error: "CONCURRENCY_ERROR" }
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: isAutoDiscard ? "conferme_auto_discarded_4nr" : "conferme_no_answer",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: isAutoDiscard
                ? { reason: '4 NR consecutivi', autoDiscard: true }
                : { fieldUpdated: Object.keys(toUpdate).find(k => k.startsWith('confCall')) }
        });

        return { success: true, autoDiscarded: isAutoDiscard };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function undoConfermeNoAnswer(leadId: string, currentVersion: number) {
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
    let fieldCleared: string | null = null;

    if (oldLead.confCall3At) {
        toUpdate.confCall3At = null;
        fieldCleared = "confCall3At";
    } else if (oldLead.confCall2At) {
        toUpdate.confCall2At = null;
        fieldCleared = "confCall2At";
    } else if (oldLead.confCall1At) {
        toUpdate.confCall1At = null;
        fieldCleared = "confCall1At";
    } else {
        return { success: false, error: "Nessun NR da annullare." };
    }

    const updated = await db.update(leads).set(toUpdate)
    .where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version)))
    .returning({ id: leads.id });

    if (updated.length === 0) {
        throw new Error("CONCURRENCY_ERROR");
    }

    // Remove the last conferme_no_answer event for this lead
    const lastEvent = await db.select().from(leadEvents)
        .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.eventType, "conferme_no_answer")))
        .orderBy(desc(leadEvents.timestamp))
        .limit(1);

    if (lastEvent.length > 0) {
        await db.delete(leadEvents).where(eq(leadEvents.id, lastEvent[0].id));
    }

    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: "conferme_nr_undone",
        userId: session.user.id,
        timestamp: new Date(),
        metadata: { fieldCleared }
    });

    return { success: true };
}

import { deleteGoogleCalendarEvent } from "@/lib/googleCalendar";

export async function scheduleConfermeRecall(leadId: string, currentVersion: number, payload: {
    recallDate?: Date | null,
    vslSeen: boolean,
    newAppointmentDate?: Date | null,
    needsReschedule?: boolean,
    recallNotes?: string
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
            confVslSeen: payload.vslSeen,
            confNeedsReschedule: payload.needsReschedule || false,
            confRecallNotes: payload.recallNotes || null,
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

        const updated = await db.update(leads).set(toUpdate)
        .where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version)))
        .returning({ id: leads.id });

        if (updated.length === 0) {
            throw new Error("CONCURRENCY_ERROR");
        }

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

export async function setConfermeSnooze(leadId: string, currentVersion: number, snoozeAt: Date | null, payload?: { vslSeen?: boolean, snoozeNotes?: string }) {
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
            confSnoozeAt: snoozeAt,
            version: oldLead.version + 1,
            updatedAt: new Date()
        };

        if (payload?.vslSeen !== undefined) toUpdate.confVslSeen = payload.vslSeen;
        if (payload?.snoozeNotes !== undefined) toUpdate.confRecallNotes = payload.snoozeNotes;

        const updated = await db.update(leads).set(toUpdate)
        .where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version)))
        .returning({ id: leads.id });

        if (updated.length === 0) {
            throw new Error("CONCURRENCY_ERROR");
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_snooze_set",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { snoozeAt }
        });

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
