"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, users, confirmationsNotes, leadEvents, notifications, calendarEvents } from "@/db/schema"
import { eq, desc, and, or, like, between, isNull, isNotNull, asc, gte, lte, inArray, sql } from "drizzle-orm"
import crypto from "crypto"
import { createGoogleCalendarEvent, checkFreeBusy, getBusySlotsForUser, hasCalendarConnection } from "@/lib/googleCalendar"
import { addHours } from "date-fns"
import { awardXpAndCoins } from "@/lib/gamificationEngine"
import { incrementChestProgress } from "@/app/actions/chestActions"
import { attackBoss, checkAndAdvanceStage } from "@/app/actions/adventureActions"
import { maybeDropCreature } from "@/app/actions/creatureActions"
import { enqueueMarketingWebhook } from "@/lib/marketing-webhooks/enqueue"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
// Legacy team-adventure imports removed: Conferme gamification is now individual.

export async function getConfermeAppointments(filters: {
    startDate?: Date;
    endDate?: Date;
    timeSlot?: "mattina" | "pomeriggio" | "tutto";
    searchQuery?: string;
    confermeStatus?: "da_lavorare" | "confermati" | "scartati" | "storico" | "tutti";
    fetchMode?: "strict_kanban" | "all";
    /** Su quale colonna applicare il filtro startDate/endDate.
     *  Default: appointmentDate. Per lo storico si usa confirmationsTimestamp
     *  (il giorno in cui il lead è stato effettivamente confermato/scartato). */
    dateFilterField?: "appointmentDate" | "confirmationsTimestamp";
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const conditions = [
        eq(leads.companyId, ctx.companyId),
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
        const col = filters.dateFilterField === "confirmationsTimestamp" ? leads.confirmationsTimestamp : leads.appointmentDate;
        conditions.push(between(col, filters.startDate, filters.endDate));
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

        // Override una tantum: venerdì 2026-04-24 il sabato successivo
        // (2026-04-25) è festa. Oggi le Conferme devono chiamare gli
        // appuntamenti di LUNEDÌ mattina invece di sabato mattina,
        // perché domani non si lavora. Rimuovere/aggiornare questa
        // costante quando passa il giorno o per prossime festività.
        const isHolidayOverrideFriday = todayStr === '04/24/2026';

        // Override una tantum: giovedì 2026-04-30 il venerdì successivo
        // (2026-05-01, Festa dei Lavoratori) è festa. Oggi le Conferme
        // devono chiamare gli appuntamenti di SABATO mattina invece di
        // venerdì mattina, perché domani non si lavora e nessuno potrà
        // chiamare gli app di sabato venerdì. Costante datata: si
        // auto-disattiva dopo oggi.
        const isHolidayOverrideThursday = todayStr === '04/30/2026';

        // Override una tantum: lunedì 2026-06-01 il martedì successivo
        // (2026-06-02, Festa della Repubblica) è festa. Oggi le Conferme
        // devono chiamare gli appuntamenti di MERCOLEDÌ mattina invece di
        // martedì mattina, perché domani non si lavora. Costante datata:
        // si auto-disattiva dopo oggi.
        const isHolidayOverrideMonday = todayStr === '06/01/2026';

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
                // Override festivo: il 24/04/2026 (Ven) salta sabato festivo,
                // next work day = Lunedì (+3).
                nextWorkDay.setDate(nextWorkDay.getDate() + (isHolidayOverrideFriday ? 3 : 1));
            } else if (romeDayOfWeek === 'sat') {
                nextWorkDay.setDate(nextWorkDay.getDate() + 2); // Monday
            } else if (romeDayOfWeek === 'sun') {
                nextWorkDay.setDate(nextWorkDay.getDate() + 1); // Monday
            } else {
                // Mon-Thu. Override festivo: il 30/04/2026 (Gio) salta
                // venerdì 1° maggio, next work day = Sabato (+2).
                // Override festivo: il 01/06/2026 (Lun) salta martedì
                // 2 giugno (Festa Repubblica), next work day = Mercoledì (+2).
                const skipTomorrow = isHolidayOverrideThursday || isHolidayOverrideMonday;
                nextWorkDay.setDate(nextWorkDay.getDate() + (skipTomorrow ? 2 : 1));
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
                    // Override festivo: next work day è Lunedì (normale giorno
                    // lavorativo), nessuna eccezione 13-14 applicabile.
                    if (isHolidayOverrideFriday) return true;
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

    // Attach ultima nota Conferme per lead (per anteprima nella riga board)
    const leadIds = Array.from(new Set(results.map(r => r.lead.id)));
    const notesMap = new Map<string, { text: string; createdAt: Date; authorId: string }>();
    if (leadIds.length > 0) {
        const allNotes = await db.select({
            leadId: confirmationsNotes.leadId,
            text: confirmationsNotes.text,
            createdAt: confirmationsNotes.createdAt,
            authorId: confirmationsNotes.authorId,
        }).from(confirmationsNotes)
            .where(and(
                eq(confirmationsNotes.companyId, ctx.companyId),
                inArray(confirmationsNotes.leadId, leadIds),
            ))
            .orderBy(desc(confirmationsNotes.createdAt));
        for (const n of allNotes) {
            if (!notesMap.has(n.leadId)) {
                notesMap.set(n.leadId, { text: n.text, createdAt: n.createdAt, authorId: n.authorId });
            }
        }
    }

    type RowWithNote = (typeof results)[number] & { lastConfermeNote: { text: string; createdAt: Date; authorId: string } | null };
    const withNotes: RowWithNote[] = results.map(r => ({
        ...r,
        lastConfermeNote: notesMap.get(r.lead.id) ?? null,
    }));

    const grouped: Record<string, RowWithNote[]> = {};
    const daDefinire: RowWithNote[] = [];

    for (const item of withNotes) {
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
        flatList: withNotes
    };
}

export async function updateLeadDataConferme(leadId: string, currentVersion: number, data: { name: string, email: string, appointmentDate: Date, appointmentNote: string }) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    // fetch old (tenant-scoped)
    const oldLead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
    )))[0]
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
    }).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
        eq(leads.version, oldLead.version),
    ))
    .returning({ id: leads.id })

    if (updated.length === 0) {
        throw new Error("CONCURRENCY_ERROR")
    }

    // Marketing webhook: emit appointment.set only if the appointment date actually changed
    if (oldLead.appointmentDate?.getTime() !== data.appointmentDate?.getTime()) {
        // Se stiamo SPOSTANDO un appuntamento esistente (entrambe le date valorizzate),
        // emettiamo prima un appointment.rescheduled così il marketing chiude il vecchio
        // record SET invece di creare un secondo record orfano.
        if (oldLead.appointmentDate && data.appointmentDate) {
            await enqueueMarketingWebhook({
                eventType: 'appointment.rescheduled',
                leadId,
                actorUserId: session.user.id,
                previousAppointmentDate: oldLead.appointmentDate,
                newAppointmentDate: data.appointmentDate,
            }).catch((e: unknown) => console.error("Marketing webhook (appointment.rescheduled) err:", e));
        }
        await enqueueMarketingWebhook({
            eventType: 'appointment.set',
            leadId,
            actorUserId: session.user.id,
        }).catch((e: unknown) => console.error("Marketing webhook (appointment.set) err:", e));
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
        },
        companyId: ctx.companyId,
    })

    return { success: true }
}

export async function getConfermeNotes(leadId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    return await db.select({
        note: confirmationsNotes,
        author: users
    }).from(confirmationsNotes)
        .leftJoin(users, eq(confirmationsNotes.authorId, users.id))
        .where(and(
            eq(confirmationsNotes.companyId, ctx.companyId),
            eq(confirmationsNotes.leadId, leadId),
        ))
        .orderBy(desc(confirmationsNotes.createdAt))

}

export async function addConfermeNote(leadId: string, text: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const newNote = {
        id: crypto.randomUUID(),
        leadId,
        authorId: session.user.id,
        text,
        createdAt: new Date(),
        companyId: ctx.companyId,
    }

    await db.insert(confirmationsNotes).values(newNote)
    return newNote
}

async function getSalespersonName(userId: string | undefined, companyId: string) {
    if (!userId) return null;
    const user = (await db.select().from(users).where(and(
        eq(users.id, userId),
        // staff condiviso: risolvi il nome se il venditore è accessibile all'azienda attiva
        or(
            sql`${companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, companyId)),
        ),
    )))[0];
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

        const ctx = await currentTenant()
        assertSalesArea(ctx)

        const oldLead = (await db.select().from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
        )))[0]
        if (!oldLead) return { success: false, error: "Lead not found" }
        if (oldLead.version !== currentVersion) {
            console.error(`Version mismatch - DB: ${oldLead.version}, client: ${currentVersion}`);
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
            salespersonAssigned: await getSalespersonName(salespersonAssigned, ctx.companyId) || salespersonAssigned || null,
            salespersonUserId: salespersonAssigned || null,
            salespersonAssignedAt: salespersonAssigned ? new Date() : null,
            version: oldLead.version + 1,
            updatedAt: new Date()
        }).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, oldLead.version),
        ))
        .returning({ id: leads.id })

        if (updated.length === 0) {
            return { success: false, error: 'CONCURRENCY_ERROR' }
        }

        // Marketing webhook: appointment outcome (and optional deal.assigned)
        await enqueueMarketingWebhook({
            eventType: 'appointment.outcome',
            leadId,
            actorUserId: session.user.id,
        }).catch((e: unknown) => console.error("Marketing webhook (appointment.outcome) err:", e));

        if (salespersonAssigned) {
            await enqueueMarketingWebhook({
                eventType: 'deal.assigned',
                leadId,
                actorUserId: session.user.id,
            }).catch((e: unknown) => console.error("Marketing webhook (deal.assigned) err:", e));
        }

        // Create Calendar Event after successful DB update
        if (outcome === "confermato" && salespersonAssigned && oldLead.appointmentDate) {
            const apptDate = new Date(oldLead.appointmentDate);
            const endTime = addHours(apptDate, 1);

            await createGoogleCalendarEvent(
                salespersonAssigned,
                {
                    summary: `Appuntamento ${oldLead.companyId === 'serenamente' ? 'Serenamente' : 'CRM'}: ${oldLead.name}`,
                    description: `Lead: ${oldLead.name}\nTelefono: ${oldLead.phone}\nEmail: ${oldLead.email || 'N/A'}\nFunnel: ${oldLead.funnel || 'N/A'}\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
                    startTime: apptDate,
                    endTime: endTime,
                    attendees: oldLead.email ? [{ email: oldLead.email }] : []
                },
                leadId,
                "appointment"
            ).catch(err => {
                console.error("Could not create calendar event:", err.message)
            })
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_outcome_set",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { outcome, reason, salespersonAssigned },
            companyId: ctx.companyId,
        })

        // Gamification: award XP/coins to Conferme worker on confirmation.
        // Unified per-user gamification — every Conferme has their own chest/adventure/creatures.
        let rewardData = null;
        if (outcome === "confermato") {
            rewardData = await awardXpAndCoins(session.user.id, "CONFERMATO", leadId, ctx.companyId).catch(e => { console.error("GameEngine CONFERMATO err:", e); return null; });

            // Individual progress for the Conferme user
            incrementChestProgress(session.user.id, 'conferme', 1).catch(e => console.error("Chest conferme err:", e));
            attackBoss(session.user.id, 'conferma').catch(e => console.error("Adventure conferma err:", e));
            checkAndAdvanceStage(session.user.id).catch(e => console.error("Adventure stage check conferma err:", e));
            maybeDropCreature(session.user.id).catch(e => console.error("Creature drop conferma (conferme user) err:", e));

            // Also credit the originating GDO with a creature drop chance (their lead got confirmed)
            if (oldLead.assignedToId && oldLead.assignedToId !== session.user.id) {
                maybeDropCreature(oldLead.assignedToId).catch(e => console.error("Creature drop conferma (gdo) err:", e));
            }
        }

        // Notifiche Live (Pilota E2E)
        if (outcome === "confermato" && salespersonAssigned) {
            const spName = await getSalespersonName(salespersonAssigned, ctx.companyId) || salespersonAssigned

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
                    createdAt: new Date(),
                    companyId: ctx.companyId,
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
                createdAt: new Date(),
                companyId: ctx.companyId,
            })
        }

        return { success: true, rewardData }
    } catch (error: any) {
        console.error("setConfermeOutcome error:", error);
        return { success: false, error: `INTERNAL_ERROR: ${error.message}` };
    }
}

export async function setSalespersonOutcome(
    leadId: string,
    currentVersion: number,
    outcome: "Chiuso" | "Non chiuso" | "Lead non presenziato",
    notes?: string,
    closeAmountEur?: number | null,
    /**
     * Data della chiusura (Date o ISO string). OBBLIGATORIA quando outcome === 'Chiuso':
     * il lead viene contato nel ciclo / settimana corrispondente a questa data,
     * non a `new Date()` server-side. Per outcome diversi è opzionale e
     * default a `new Date()` (oggi).
     */
    closedAt?: Date | string | null,
) {
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" }
        }

        // Validazione "Chiuso": importo + data sempre obbligatori. Senza
        // di entrambi, lo storico chiusure perde precisione (giorno errato
        // o fatturato mancante).
        if (outcome === 'Chiuso') {
            if (typeof closeAmountEur !== 'number' || !(closeAmountEur > 0)) {
                return { success: false, error: 'CLOSE_AMOUNT_REQUIRED' }
            }
            if (!closedAt) {
                return { success: false, error: 'CLOSE_DATE_REQUIRED' }
            }
        }

        const outcomeAt: Date = closedAt
            ? (closedAt instanceof Date ? closedAt : new Date(closedAt))
            : new Date();
        if (Number.isNaN(outcomeAt.getTime())) {
            return { success: false, error: 'CLOSE_DATE_INVALID' }
        }

        const ctx = await currentTenant()
        assertSalesArea(ctx)

        const oldLead = (await db.select().from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
        )))[0]
        if (!oldLead) return { success: false, error: "Lead not found" }
        if (oldLead.version !== currentVersion) return { success: false, error: `CONCURRENCY_ERROR` }

        // Gamification: reward only on first outcome set (idempotent).
        // Both the GDO (lead owner) AND the Conferme user get individual progress for their work.
        let rewardData = null;
        if (!oldLead.salespersonOutcome && oldLead.assignedToId) {
            const isConfermeRole = session.user.role === 'CONFERME';
            if (outcome === 'Chiuso') {
                rewardData = await awardXpAndCoins(oldLead.assignedToId, "CHIUSO", leadId, ctx.companyId).catch(e => { console.error("GameEngine CHIUSO err:", e); return null; });

                // Individual progress for the GDO (lead owner)
                incrementChestProgress(oldLead.assignedToId, 'chiusure', 1).catch(e => console.error("Chest chiusure GDO err:", e));
                attackBoss(oldLead.assignedToId, 'chiusura').catch(e => console.error("Adventure chiusura err:", e));
                checkAndAdvanceStage(oldLead.assignedToId).catch(e => console.error("Adventure stage check chiusura err:", e));
                maybeDropCreature(oldLead.assignedToId).catch(e => console.error("Creature drop chiusura err:", e));

                // Individual progress for the Conferme user who logged the close
                if (isConfermeRole && session.user.id !== oldLead.assignedToId) {
                    incrementChestProgress(session.user.id, 'chiusure', 1).catch(e => console.error("Chest chiusure CONFERME err:", e));
                    attackBoss(session.user.id, 'chiusura').catch(e => console.error("Adventure chiusura CONFERME err:", e));
                    checkAndAdvanceStage(session.user.id).catch(e => console.error("Adventure stage check chiusura CONFERME err:", e));
                    maybeDropCreature(session.user.id).catch(e => console.error("Creature drop chiusura CONFERME err:", e));
                }
            } else if (outcome === 'Non chiuso') {
                rewardData = await awardXpAndCoins(oldLead.assignedToId, "PRESENZIATO", leadId, ctx.companyId).catch(e => { console.error("GameEngine PRESENZIATO err:", e); return null; });

                // Individual progress for the GDO
                incrementChestProgress(oldLead.assignedToId, 'presenze', 1).catch(e => console.error("Chest presenze GDO err:", e));
                attackBoss(oldLead.assignedToId, 'presenza').catch(e => console.error("Adventure presenza err:", e));
                checkAndAdvanceStage(oldLead.assignedToId).catch(e => console.error("Adventure stage check presenza err:", e));
                maybeDropCreature(oldLead.assignedToId).catch(e => console.error("Creature drop presenza err:", e));

                // Individual progress for the Conferme user
                if (isConfermeRole && session.user.id !== oldLead.assignedToId) {
                    incrementChestProgress(session.user.id, 'presenze', 1).catch(e => console.error("Chest presenze CONFERME err:", e));
                    attackBoss(session.user.id, 'presenza').catch(e => console.error("Adventure presenza CONFERME err:", e));
                    checkAndAdvanceStage(session.user.id).catch(e => console.error("Adventure stage check presenza CONFERME err:", e));
                    maybeDropCreature(session.user.id).catch(e => console.error("Creature drop presenza CONFERME err:", e));
                }
            }
        }

        // closeAmountEur: only written when outcome === 'Chiuso' and a valid positive number is provided.
        // Uses a conditional spread so Drizzle gets a properly-typed partial update object
        // (Record<string, unknown> at the call site was silently breaking Drizzle's value mapping).
        const closeAmountPatch = (outcome === 'Chiuso' && typeof closeAmountEur === 'number' && closeAmountEur > 0)
            ? { closeAmountEur }
            : {};

        const updated = await db.update(leads).set({
            salespersonOutcome: outcome,
            salespersonOutcomeNotes: notes || null,
            salespersonOutcomeAt: outcomeAt,
            version: oldLead.version + 1,
            updatedAt: new Date(),
            ...closeAmountPatch,
        }).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, oldLead.version),
        ))
          .returning({ id: leads.id })

        if (updated.length === 0) {
            return { success: false, error: 'CONCURRENCY_ERROR' }
        }

        // Marketing webhook: deal closed (won/lost based on outcome)
        const closedEventType = outcome === 'Chiuso' ? 'deal.closed_won' : 'deal.closed_lost';
        await enqueueMarketingWebhook({
            eventType: closedEventType,
            leadId,
            actorUserId: session.user.id,
        }).catch((e: unknown) => console.error(`Marketing webhook (${closedEventType}) err:`, e));

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "salesperson_outcome_set",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { outcome, notes },
            companyId: ctx.companyId,
        })

        return { success: true, rewardData }
    } catch (error: any) {
        console.error("setSalespersonOutcome error:", error);
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

        const ctx = await currentTenant()
        assertSalesArea(ctx)

        const oldLead = (await db.select().from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
        )))[0];
        if (!oldLead) return { success: false, error: "Lead not found" };
        if (oldLead.version !== currentVersion) return { success: false, error: "CONCURRENCY_ERROR" };

        let toUpdate: any = { version: oldLead.version + 1, updatedAt: new Date(), confSnoozeAt: null };
        let isAutoDiscard = false;

        if (!oldLead.confCall1At) {
            toUpdate.confCall1At = new Date();
        } else if (!oldLead.confCall2At) {
            toUpdate.confCall2At = new Date();
        } else if (!oldLead.confCall3At) {
            // 3° NR: auto-scarta nello stesso update
            toUpdate.confCall3At = new Date();
            isAutoDiscard = true;
            toUpdate.confirmationsOutcome = 'scartato';
            toUpdate.confirmationsDiscardReason = '3 NR consecutivi';
            toUpdate.confirmationsUserId = session.user.id;
            toUpdate.confirmationsTimestamp = new Date();
        } else {
            // Stato impossibile post-migrazione: 3 NR già registrati ma outcome ancora null.
            // Avviene solo per lead in transizione dal vecchio sistema (4 NR).
            // Comportamento safe: scarta come "3 NR consecutivi" senza toccare i campi data.
            isAutoDiscard = true;
            toUpdate.confirmationsOutcome = 'scartato';
            toUpdate.confirmationsDiscardReason = '3 NR consecutivi';
            toUpdate.confirmationsUserId = session.user.id;
            toUpdate.confirmationsTimestamp = new Date();
        }

        const updated = await db.update(leads).set(toUpdate)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, oldLead.version),
        ))
        .returning({ id: leads.id });

        if (updated.length === 0) {
            return { success: false, error: "CONCURRENCY_ERROR" }
        }

        // Marketing webhook: if auto-discarded after 3 NR, emit appointment.outcome (NON_CONFERMATO)
        if (isAutoDiscard) {
            await enqueueMarketingWebhook({
                eventType: 'appointment.outcome',
                leadId,
                actorUserId: session.user.id,
            }).catch((e: unknown) => console.error("Marketing webhook (appointment.outcome auto-discard) err:", e));
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: isAutoDiscard ? "conferme_auto_discarded_3nr" : "conferme_no_answer",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: isAutoDiscard
                ? { reason: '3 NR consecutivi', autoDiscard: true }
                : { fieldUpdated: Object.keys(toUpdate).find(k => k.startsWith('confCall')) },
            companyId: ctx.companyId,
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

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const oldLead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
    )))[0];
    if (!oldLead) throw new Error("Lead not found");
    if (oldLead.version !== currentVersion) throw new Error("CONCURRENCY_ERROR");

    let toUpdate: any = { version: oldLead.version + 1, updatedAt: new Date() };
    let fieldCleared: string | null = null;
    let restoredFromAutoDiscard = false;

    // Se il lead è stato auto-scartato al 3° NR, l'undo deve riportarlo "in lavorazione".
    if (oldLead.confCall3At
        && oldLead.confirmationsOutcome === 'scartato'
        && oldLead.confirmationsDiscardReason === '3 NR consecutivi') {
        toUpdate.confCall3At = null;
        toUpdate.confCall3Duration = null;
        toUpdate.confirmationsOutcome = null;
        toUpdate.confirmationsDiscardReason = null;
        toUpdate.confirmationsUserId = null;
        toUpdate.confirmationsTimestamp = null;
        fieldCleared = "confCall3At";
        restoredFromAutoDiscard = true;
    } else if (oldLead.confCall3At) {
        toUpdate.confCall3At = null;
        toUpdate.confCall3Duration = null;
        fieldCleared = "confCall3At";
    } else if (oldLead.confCall2At) {
        toUpdate.confCall2At = null;
        toUpdate.confCall2Duration = null;
        fieldCleared = "confCall2At";
    } else if (oldLead.confCall1At) {
        toUpdate.confCall1At = null;
        toUpdate.confCall1Duration = null;
        fieldCleared = "confCall1At";
    } else {
        return { success: false, error: "Nessun NR da annullare." };
    }

    const updated = await db.update(leads).set(toUpdate)
    .where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
        eq(leads.version, oldLead.version),
    ))
    .returning({ id: leads.id });

    if (updated.length === 0) {
        throw new Error("CONCURRENCY_ERROR");
    }

    // Remove the last conferme_no_answer event for this lead (tenant-scoped)
    const lastEvent = await db.select().from(leadEvents)
        .where(and(
            eq(leadEvents.companyId, ctx.companyId),
            eq(leadEvents.leadId, leadId),
            eq(leadEvents.eventType, "conferme_no_answer"),
        ))
        .orderBy(desc(leadEvents.timestamp))
        .limit(1);

    if (lastEvent.length > 0) {
        await db.delete(leadEvents).where(and(
            eq(leadEvents.companyId, ctx.companyId),
            eq(leadEvents.id, lastEvent[0].id),
        ));
    }

    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: "conferme_nr_undone",
        userId: session.user.id,
        timestamp: new Date(),
        metadata: { fieldCleared, restoredFromAutoDiscard },
        companyId: ctx.companyId,
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

        const ctx = await currentTenant()
        assertSalesArea(ctx)

        const oldLead = (await db.select().from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
        )))[0];
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
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, oldLead.version),
        ))
        .returning({ id: leads.id });

        if (updated.length === 0) {
            throw new Error("CONCURRENCY_ERROR");
        }

        // Marketing webhook: emit appointment.set when reschedule sets a new date
        // (skip when needsReschedule clears the date — that's not a "set")
        if (!payload.needsReschedule && payload.newAppointmentDate
            && oldApptDate?.getTime() !== payload.newAppointmentDate.getTime()) {
            // Se esiste una vecchia data (riprogrammazione vera), prima notifichiamo
            // il rescheduled così marketing chiude il vecchio record.
            if (oldApptDate) {
                await enqueueMarketingWebhook({
                    eventType: 'appointment.rescheduled',
                    leadId,
                    actorUserId: session.user.id,
                    previousAppointmentDate: oldApptDate,
                    newAppointmentDate: payload.newAppointmentDate,
                }).catch((e: unknown) => console.error("Marketing webhook (appointment.rescheduled) err:", e));
            }
            await enqueueMarketingWebhook({
                eventType: 'appointment.set',
                leadId,
                actorUserId: session.user.id,
            }).catch((e: unknown) => console.error("Marketing webhook (appointment.set reschedule) err:", e));
        }

        // Handle Calendar if already confirmed and shift/removal happened
        if (calendarNeedsUpdate && oldLead.salespersonUserId) {
            const calEvents = await db.select().from(calendarEvents).where(and(
                eq(calendarEvents.companyId, ctx.companyId),
                eq(calendarEvents.leadId, leadId),
            ));
            const evt = calEvents.find(e => e.eventType === "appointment");

            if (evt && evt.googleEventId) {
                // Delete old event
                await deleteGoogleCalendarEvent(oldLead.salespersonUserId, evt.googleEventId).catch((e: any) => console.error("GCal delete err:", e));
                await db.delete(calendarEvents).where(and(
                    eq(calendarEvents.companyId, ctx.companyId),
                    eq(calendarEvents.id, evt.id),
                ));
            }

            // recreate if new appointment date is set
            if (!payload.needsReschedule && newApptDate) {
                const endT = addHours(new Date(newApptDate), 1);
                await createGoogleCalendarEvent(
                    oldLead.salespersonUserId,
                    {
                        summary: `Appuntamento ${oldLead.companyId === 'serenamente' ? 'Serenamente' : 'CRM'}: ${oldLead.name}`,
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
            metadata: { payload },
            companyId: ctx.companyId,
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

        const ctx = await currentTenant()
        assertSalesArea(ctx)

        const oldLead = (await db.select().from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
        )))[0];
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
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, oldLead.version),
        ))
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
            metadata: { snoozeAt },
            companyId: ctx.companyId,
        });

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

/**
 * Cancel a Conferme recall (snooze or park) and restore the lead to
 * its normal board position.
 *
 * - Snooze cancel: clears confSnoozeAt → lead reappears in its appointment hour slot.
 * - Park cancel:   clears confNeedsReschedule, restores appointmentDate from recallDate
 *                  → lead reappears in the pomeriggio/mattina board.
 */
export async function cancelConfermeRecall(
    leadId: string,
    currentVersion: number,
    recallType: "snooze" | "park"
) {
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" };
        }

        const ctx = await currentTenant()
        assertSalesArea(ctx)

        const oldLead = (await db.select().from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
        )))[0];
        if (!oldLead) return { success: false, error: "Lead not found" };
        if (oldLead.version !== currentVersion) return { success: false, error: "CONCURRENCY_ERROR" };

        let toUpdate: any = {
            version: oldLead.version + 1,
            updatedAt: new Date(),
        };

        if (recallType === "snooze") {
            toUpdate.confSnoozeAt = null;
            toUpdate.confRecallNotes = null;
        } else {
            // Park cancel: restore appointmentDate from recallDate
            if (!oldLead.recallDate) {
                return { success: false, error: "Nessuna data di richiamo trovata per ripristinare l'appuntamento." };
            }
            toUpdate.confNeedsReschedule = false;
            toUpdate.appointmentDate = oldLead.recallDate;
            toUpdate.recallDate = null;
            toUpdate.confRecallNotes = null;
        }

        const updated = await db.update(leads).set(toUpdate)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.id, leadId),
                eq(leads.version, oldLead.version),
            ))
            .returning({ id: leads.id });

        if (updated.length === 0) {
            return { success: false, error: "CONCURRENCY_ERROR" };
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: recallType === "snooze" ? "conferme_snooze_cancelled" : "conferme_recall_cancelled",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: {
                recallType,
                restoredAppointmentDate: recallType === "park" ? oldLead.recallDate : null,
            },
            companyId: ctx.companyId,
        });

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

/**
 * Richiami Conferme ("risentire dopo" / snooze) imminenti o scaduti su TUTTE
 * le aziende consentite all'operatore, inclusa quella attiva. Alimenta il
 * banner blu globale ConfermeRecallBanner (QA Conferme 2026-06-12): prima
 * le sveglie snooze vivevano solo dentro il board della azienda attiva,
 * quindi "non arrivavano o non sempre".
 */
export async function getConfermeRecallAlerts(): Promise<Array<{
    id: string
    name: string
    phone: string | null
    snoozeAt: string
    notes: string | null
    companyId: string
}>> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!["CONFERME", "MANAGER", "ADMIN"].includes(ctx.role)) return []
    if (ctx.isAllCompanies) return []

    const soon = new Date(Date.now() + 30 * 60 * 1000)
    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        confSnoozeAt: leads.confSnoozeAt,
        confRecallNotes: leads.confRecallNotes,
        companyId: leads.companyId,
    })
        .from(leads)
        .where(and(
            inArray(leads.companyId, ctx.allowedCompanies),
            isNull(leads.confirmationsOutcome),
            isNotNull(leads.confSnoozeAt),
            lte(leads.confSnoozeAt, soon),
        ))
        .orderBy(asc(leads.confSnoozeAt))
        .limit(8)

    return rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        snoozeAt: (r.confSnoozeAt as Date).toISOString(),
        notes: r.confRecallNotes,
        companyId: r.companyId,
    }))
}

/**
 * Restituisce tutti gli appuntamenti dei venditori (lead con
 * salespersonUserId e appointmentDate valorizzati) nell'intervallo
 * richiesto. Raggruppato per venditore. Usato dalle Conferme per
 * decidere a chi assegnare nuovi appuntamenti in base al carico.
 */
export async function getVenditoriAgenda(startDate: Date, endDate: Date): Promise<{
    venditori: Array<{
        id: string;
        name: string;
        hasGoogleCalendar: boolean;
        appointments: Array<{
            leadId: string;
            leadName: string;
            leadPhone: string | null;
            funnel: string | null;
            appointmentDate: Date;
            appointmentNote: string | null;
            confirmationsOutcome: string | null;
        }>;
        /** Slot occupati sul Google Calendar primario del venditore
         *  (riunioni/impegni NON tracciati dal CRM). Vuoto se il venditore
         *  non ha connesso Google. */
        busySlots: Array<{ start: Date; end: Date }>;
    }>;
}> {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role as string | undefined;
    if (!supabaseUser || !role || !["CONFERME", "MANAGER", "ADMIN"].includes(role)) {
        throw new Error("Unauthorized");
    }

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    // Staff condiviso multi-tenant: i venditori hanno companyId='fenice' e
    // operano su Serenamente via allowedCompanies. Filtrare solo su companyId
    // svuotava il calendario su Serenamente (QA Conferme 2026-06-12).
    const venditori = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
    }).from(users).where(and(
        or(
            sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
        ),
        eq(users.role, 'VENDITORE'),
        eq(users.isActive, true),
    ));

    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        funnel: leads.funnel,
        appointmentDate: leads.appointmentDate,
        appointmentNote: leads.appointmentNote,
        confirmationsOutcome: leads.confirmationsOutcome,
        salespersonUserId: leads.salespersonUserId,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        isNotNull(leads.salespersonUserId),
        isNotNull(leads.appointmentDate),
        gte(leads.appointmentDate, startDate),
        lte(leads.appointmentDate, endDate),
    )).orderBy(asc(leads.appointmentDate));

    // Fetch busy slots da Google Calendar in parallelo per ogni venditore.
    // Best-effort: chi non ha connesso Google torna array vuoto.
    const busyResults = await Promise.all(
        venditori.map(async v => {
            try {
                const [slots, connected] = await Promise.all([
                    getBusySlotsForUser(v.id, startDate, endDate),
                    hasCalendarConnection(v.id),
                ]);
                return { id: v.id, slots, connected };
            } catch {
                return { id: v.id, slots: [], connected: false };
            }
        }),
    );
    const busyByVenditore = new Map(busyResults.map(b => [b.id, b]));

    return {
        venditori: venditori
            .map(v => {
                const busy = busyByVenditore.get(v.id);
                const apptSet = new Set(
                    rows
                        .filter(r => r.salespersonUserId === v.id && r.appointmentDate)
                        .map(r => (r.appointmentDate as Date).getTime()),
                );
                // Filtra gli slot busy Google che coincidono con appuntamenti CRM
                // per evitare doppioni visivi (l'evento calendar creato dal CRM stesso).
                const externalBusy = (busy?.slots || []).filter(
                    s => !apptSet.has(s.start.getTime()),
                );
                return {
                    id: v.id,
                    name: v.displayName || v.name || 'Venditore',
                    hasGoogleCalendar: busy?.connected ?? false,
                    appointments: rows
                        .filter(r => r.salespersonUserId === v.id && r.appointmentDate)
                        .map(r => ({
                            leadId: r.id,
                            leadName: r.name || 'Senza nome',
                            leadPhone: r.phone ?? null,
                            funnel: r.funnel ?? null,
                            appointmentDate: r.appointmentDate as Date,
                            appointmentNote: r.appointmentNote ?? null,
                            confirmationsOutcome: r.confirmationsOutcome ?? null,
                        })),
                    busySlots: externalBusy,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'it')),
    };
}

/**
 * Annulla lo scarto di un lead: rimette il lead "da lavorare" resettando
 * outcome, motivo, user e timestamp. Solo per lead scartati.
 */
export async function undoConfermeScarto(leadId: string, currentVersion: number): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" };
        }

        const ctx = await currentTenant()
        assertSalesArea(ctx)

        const oldLead = (await db.select().from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
        )))[0];
        if (!oldLead) return { success: false, error: "Lead not found" };
        if (oldLead.version !== currentVersion) {
            return { success: false, error: "CONCURRENCY_ERROR" };
        }
        if (oldLead.confirmationsOutcome !== "scartato") {
            return { success: false, error: "Il lead non è nello stato 'scartato'" };
        }

        const updated = await db.update(leads).set({
            confirmationsOutcome: null,
            confirmationsDiscardReason: null,
            confirmationsUserId: null,
            confirmationsTimestamp: null,
            version: oldLead.version + 1,
            updatedAt: new Date(),
        }).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, oldLead.version),
        ))
            .returning({ id: leads.id });

        if (updated.length === 0) {
            return { success: false, error: "CONCURRENCY_ERROR" };
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_undo_scarto",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: {
                previousDiscardReason: oldLead.confirmationsDiscardReason,
                previousConfirmationsUserId: oldLead.confirmationsUserId,
            },
            companyId: ctx.companyId,
        });

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
    }
}

// =====================================================================
// WEBINAR SELF-BOOKED — RIMOSSO 2026-05-12
// La sezione, il modal e le server action di assegnazione webinar→venditore
// sono stati eliminati a lancio concluso. La colonna leads.isSelfBooked
// resta nel DB come marker storico (chiusure del 12/05/2026).
// =====================================================================
