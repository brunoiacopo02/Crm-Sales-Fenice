"use server"

import crypto from "crypto"
import { after } from "next/server"
import { addHours } from "date-fns"
import { and, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { calendarEvents, callLogs, leadEvents, leads, notifications, salesSlotBlocks, users } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea, assertSingleCompany } from "@/lib/tenancy"
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from "@/lib/googleCalendar"
import { enqueueMarketingWebhook } from "@/lib/marketing-webhooks/enqueue"
import { romeInstant, slotKey, slotStartFor } from "@/lib/venditore/calendarSlots"
import { toRomeDateStr } from "@/lib/dateUtils"
import { SELF_BOOKED_OUTCOME } from "@/lib/salesPipeline/sentinel"
import { pickMostLoadedGdo } from "@/lib/salesPipeline/feeding"
import { selfBookingCheck } from "@/lib/salesPipeline/selfBooking"
import { DEFAULT_SALES_PIPELINE_CONFIG, type SalesPipelineConfig } from "@/lib/salesPipeline/config"
import { readSalesPipelineConfig } from "./salesPipelineConfigActions"

/**
 * Chi puo' usare la pipeline autonoma: il venditore configurato, e nessun
 * altro. Ritorna null se la pipeline e' spenta o se non e' lui.
 */
export async function requireSalesPipelineUser(): Promise<
    { userId: string; companyId: string; name: string } | null
> {
    const cfg = await readSalesPipelineConfig()
    if (!cfg.enabled || !cfg.salesUserId) return null

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    if (user.id !== cfg.salesUserId) return null
    if ((user.user_metadata as any)?.role !== 'VENDITORE') return null

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const row = (await db.select({ name: users.name, displayName: users.displayName })
        .from(users).where(eq(users.id, user.id)))[0]

    return {
        userId: user.id,
        companyId: ctx.companyId,
        name: row?.name || row?.displayName || 'Venditore',
    }
}

/**
 * Il venditore si fissa l'appuntamento da solo.
 *
 * Modellata su `bookLancio` (src/lib/lancio/booking.ts), che e' il precedente
 * esatto: un appuntamento che nasce gia' fuori dal giro delle Conferme.
 *
 * Tre cose per cui esiste il lock e non basta il controllo ottimistico:
 *  - lo slot e' una risorsa condivisa col resto del CRM (una Conferma puo'
 *    assegnargli un lead sulla stessa ora nello stesso istante), e oggi nel
 *    CRM NON esiste nessuna prenotazione atomica: due scritture sullo stesso
 *    slot passano entrambe e il doppio booking si scopre solo dopo;
 *  - a valle di questa scrittura parte un invito vero a un cliente vero;
 *  - l'evento Google non e' idempotente: due giri = due inviti.
 */
export async function setSalesSelfAppointment(input: {
    leadId: string
    currentVersion: number
    at: Date
    note?: string
}): Promise<{ success: boolean; error?: string; alreadyBooked?: boolean }> {
    const me = await requireSalesPipelineUser()
    if (!me) return { success: false, error: 'Pipeline non attiva per questo utente.' }

    const at = new Date(input.at)
    if (Number.isNaN(at.getTime())) return { success: false, error: 'Data non valida.' }

    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, me.companyId),
        eq(leads.id, input.leadId),
    )))[0]
    if (!lead) return { success: false, error: 'Lead non trovato.' }
    if (lead.assignedToId !== me.userId) {
        return { success: false, error: 'Questo lead non e\' nella tua pipeline.' }
    }
    if (lead.version !== input.currentVersion) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    // Guardia anti-doppio-fissaggio. E' il difetto noto di updateLeadOutcome
    // (il bot ha la sua guardia, l'UI GDO no): qui due clic significano due
    // eventi Google Calendar e due inviti allo stesso cliente.
    if (lead.status === 'APPOINTMENT' && lead.appointmentDate) {
        return { success: true, alreadyBooked: true }
    }

    const slot = slotStartFor(at)
    const dayStart = romeInstant(toRomeDateStr(at), 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    const now = new Date()
    const key = slot ? slotKey(slot) : `fuori-griglia:${at.toISOString()}`

    const esito = await db.transaction(async (tx) => {
        // Lock per ORA, non globale: serializza solo chi vuole lo stesso slot.
        // Seed 4 = pipeline venditore (0 telefono, 1 contatto AC, 2 push, 3 lancio).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'sales-self:' + me.userId + ':' + key}, 4))`)

        // Blocchi e appuntamenti si rileggono QUI DENTRO, dopo il lock: quello
        // che si e' visto un minuto fa non e' una promessa.
        // Niente filtro companyId sugli appuntamenti, come in checkBookingAllowed:
        // il venditore e' una persona sola, un appuntamento su un'altra azienda
        // gli occupa l'ora lo stesso.
        const [dayBlocks, dayAppointments] = await Promise.all([
            tx.select({ slotStart: salesSlotBlocks.slotStart }).from(salesSlotBlocks).where(and(
                eq(salesSlotBlocks.salesUserId, me.userId),
                gte(salesSlotBlocks.slotStart, dayStart),
                lt(salesSlotBlocks.slotStart, dayEnd),
            )),
            tx.select({ appointmentDate: leads.appointmentDate }).from(leads).where(and(
                eq(leads.salespersonUserId, me.userId),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, dayStart),
                lt(leads.appointmentDate, dayEnd),
                ne(leads.id, input.leadId),
            )),
        ])

        const decision = selfBookingCheck({
            slot,
            blocked: !!slot && dayBlocks.some(b => slotKey(b.slotStart) === key),
            occupied: !!slot && dayAppointments.some(a => slotKey(a.appointmentDate!) === key),
            at,
        })
        if (!decision.ok) return { ok: false as const, error: decision.message }

        const updated = await tx.update(leads).set({
            status: 'APPOINTMENT',
            appointmentDate: at,
            appointmentCreatedAt: now,
            appointmentNote: input.note?.trim() || null,
            callCount: lead.callCount + 1,
            lastCallDate: now,
            lastCallNote: input.note?.trim() || null,
            recallDate: null,
            recallNote: null,
            recallMissedAt: null,
            // Il perno. NON 'confermato': cosi' esce dalle board Conferme
            // (filtrano IS NULL) e non viene contato come conferma da nessuno
            // (tutti confrontano con 'confermato').
            confirmationsOutcome: SELF_BOOKED_OUTCOME,
            // Restano NULL di proposito: nessuno delle Conferme ha lavorato
            // questo lead, e valorizzarli lo farebbe entrare nelle query di
            // attribuzione per-operatore.
            confirmationsUserId: null,
            confirmationsTimestamp: null,
            salespersonUserId: me.userId,
            salespersonAssigned: me.name,
            salespersonAssignedAt: now,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(
            eq(leads.id, input.leadId),
            eq(leads.version, lead.version),
        )).returning({ id: leads.id })

        if (updated.length === 0) return { ok: false as const, error: 'CONCURRENCY_ERROR' }

        await tx.insert(callLogs).values({
            id: crypto.randomUUID(),
            leadId: input.leadId,
            userId: me.userId,
            outcome: 'APPUNTAMENTO',
            note: input.note?.trim() || null,
            companyId: me.companyId,
        })

        await tx.insert(leadEvents).values([
            {
                id: crypto.randomUUID(), leadId: input.leadId, eventType: 'APPOINTMENT_SET',
                userId: me.userId, timestamp: now,
                metadata: { source: 'sales_pipeline', at: at.toISOString() },
                companyId: me.companyId,
            },
            {
                id: crypto.randomUUID(), leadId: input.leadId, eventType: 'SALES_SELF_BOOKED',
                userId: me.userId, timestamp: now,
                metadata: { at: at.toISOString(), slot: slot ? slotKey(slot) : null },
                companyId: me.companyId,
            },
        ])

        return { ok: true as const }
    })

    if (!esito.ok) return { success: false, error: esito.error }

    // Calendar e webhook fuori dalla risposta: le API di Google non devono
    // poter far aspettare (o fallire) un appuntamento gia' scritto.
    after(async () => {
        await createGoogleCalendarEvent(
            me.userId,
            {
                summary: `Appuntamento CRM: ${lead.name}`,
                description: `Lead: ${lead.name}\nTelefono: ${lead.phone}\nEmail: ${lead.email || 'N/A'}\nFunnel: ${lead.funnel || 'N/A'}\nOrigine: pipeline autonoma venditore\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
                startTime: at,
                endTime: addHours(at, 1),
                attendees: lead.email ? [{ email: lead.email }] : [],
            },
            input.leadId,
            'appointment',
        ).catch((e: any) => console.error('[sales-pipeline] Google Calendar fallito:', e?.message ?? e))

        // appointment.set e deal.assigned SI: l'appuntamento esiste e ha un
        // venditore. appointment.outcome NO: non c'e' nessun esito Conferme da
        // comunicare, e mandarlo farebbe contare una conferma a valle.
        for (const eventType of ['appointment.set', 'deal.assigned'] as const) {
            await enqueueMarketingWebhook({ eventType, leadId: input.leadId, actorUserId: me.userId })
                .catch((e: unknown) => console.error(`[sales-pipeline] webhook ${eventType} err:`, e))
        }

        // NESSUN notifyAppointmentToBot: in questa pipeline l'agenda la manda
        // il venditore in autonomia (decisione PO 2026-09-21). Aggiungerlo
        // farebbe scrivere il bot su WhatsApp a un lead gestito a voce.
    })

    return { success: true }
}

/**
 * Sposta un appuntamento autofissato. L'evento Google si cancella e si
 * ricrea: un patch della sola data lascerebbe il vecchio Meet valido, e il
 * cliente si presenterebbe su una stanza che il venditore non apre.
 */
export async function moveSalesSelfAppointment(input: {
    leadId: string
    currentVersion: number
    at: Date
    note?: string
}): Promise<{ success: boolean; error?: string }> {
    const me = await requireSalesPipelineUser()
    if (!me) return { success: false, error: 'Pipeline non attiva per questo utente.' }

    const at = new Date(input.at)
    // Stessa validazione di `setSalesSelfAppointment`: una data non valida
    // arriverebbe fino alla UPDATE e ci scriverebbe un `Invalid Date`.
    if (Number.isNaN(at.getTime())) return { success: false, error: 'Data non valida.' }

    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, me.companyId),
        eq(leads.id, input.leadId),
    )))[0]
    if (!lead) return { success: false, error: 'Lead non trovato.' }
    // Due rifiuti distinti, perche' sono due errori diversi da capire: uno e'
    // "e' di un altro venditore", l'altro e' "questo appuntamento non l'hai
    // fissato tu, l'ha lavorato il giro Conferme" — e in quel secondo caso
    // spostarlo da qui salterebbe le Conferme senza che nessuno lo sappia.
    if (lead.salespersonUserId !== me.userId) {
        return { success: false, error: 'Questo appuntamento non e\' tuo.' }
    }
    if (lead.confirmationsOutcome !== SELF_BOOKED_OUTCOME) {
        return { success: false, error: 'Questo appuntamento non l\'hai fissato tu dalla tua pipeline: si sposta dal giro di sempre.' }
    }
    // Guardia difensiva: senza un appuntamento vivo non c'e' niente da
    // spostare, e la UPDATE qui sotto rimetterebbe una data su un lead che
    // qualcuno ha appena annullato.
    if (lead.status !== 'APPOINTMENT' || !lead.appointmentDate) {
        return { success: false, error: 'Questo lead non ha piu\' un appuntamento da spostare.' }
    }
    if (lead.version !== input.currentVersion) return { success: false, error: 'CONCURRENCY_ERROR' }

    const slot = slotStartFor(at)
    const dayStart = romeInstant(toRomeDateStr(at), 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const key = slot ? slotKey(slot) : `fuori-griglia:${at.toISOString()}`
    const now = new Date()

    const esito = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'sales-self:' + me.userId + ':' + key}, 4))`)

        const [dayBlocks, dayAppointments] = await Promise.all([
            tx.select({ slotStart: salesSlotBlocks.slotStart }).from(salesSlotBlocks).where(and(
                eq(salesSlotBlocks.salesUserId, me.userId),
                gte(salesSlotBlocks.slotStart, dayStart),
                lt(salesSlotBlocks.slotStart, dayEnd),
            )),
            tx.select({ appointmentDate: leads.appointmentDate }).from(leads).where(and(
                eq(leads.salespersonUserId, me.userId),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, dayStart),
                lt(leads.appointmentDate, dayEnd),
                ne(leads.id, input.leadId),
            )),
        ])

        const decision = selfBookingCheck({
            slot,
            blocked: !!slot && dayBlocks.some(b => slotKey(b.slotStart) === key),
            occupied: !!slot && dayAppointments.some(a => slotKey(a.appointmentDate!) === key),
            at,
        })
        if (!decision.ok) return { ok: false as const, error: decision.message }

        const updated = await tx.update(leads).set({
            appointmentDate: at,
            appointmentNote: input.note?.trim() || lead.appointmentNote,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, input.leadId), eq(leads.version, lead.version)))
            .returning({ id: leads.id })
        if (updated.length === 0) return { ok: false as const, error: 'CONCURRENCY_ERROR' }

        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(), leadId: input.leadId,
            eventType: 'SALES_SELF_BOOKED', userId: me.userId, timestamp: now,
            metadata: { at: at.toISOString(), moved: true, from: lead.appointmentDate?.toISOString() ?? null },
            companyId: me.companyId,
        })
        return { ok: true as const }
    })

    if (!esito.ok) return { success: false, error: esito.error }

    after(async () => {
        // Cancella il vecchio evento, poi ricrea. `calendarEvents` tiene il
        // legame lead -> googleEventId. Solo 'appointment': un domani con un
        // promemoria separato, questo giro non deve toccarlo (confermeActions.ts:1601).
        const old = await db.select().from(calendarEvents).where(and(
            eq(calendarEvents.leadId, input.leadId),
            eq(calendarEvents.userId, me.userId),
            eq(calendarEvents.eventType, 'appointment'),
        ))
        for (const e of old) {
            // googleEventId e' nullable a schema (evento creato ma Google non ha
            // mai risposto con un id): senza guardia, deleteGoogleCalendarEvent
            // non compila (si aspetta string, non string | null). Se manca, non
            // c'e' niente da cancellare su Google: la riga locale e' solo stale.
            if (!e.googleEventId) {
                await db.delete(calendarEvents).where(eq(calendarEvents.id, e.id))
                continue
            }
            // La riga si cancella SOLO se Google conferma la cancellazione.
            // Se falliamo qui (Google giu', token scaduto) e cancelliamo comunque
            // la riga, il vecchio invito resta vivo sul calendario del cliente E
            // perdiamo il legame per ritrovarlo: due inviti, un orfano invisibile.
            const deleted = await deleteGoogleCalendarEvent(me.userId, e.googleEventId)
                .catch((err: any) => {
                    console.error('[sales-pipeline] delete GCal fallita:', err?.message ?? err)
                    return false
                })
            if (deleted) {
                await db.delete(calendarEvents).where(eq(calendarEvents.id, e.id))
            } else {
                console.error(`[sales-pipeline] evento Google orfano dopo spostamento: leadId=${input.leadId} googleEventId=${e.googleEventId}`)
            }
        }
        await createGoogleCalendarEvent(
            me.userId,
            {
                summary: `Appuntamento CRM: ${lead.name}`,
                description: `Lead: ${lead.name}\nTelefono: ${lead.phone}\nEmail: ${lead.email || 'N/A'}\nFunnel: ${lead.funnel || 'N/A'}\nOrigine: pipeline autonoma venditore (spostato)\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
                startTime: at,
                endTime: addHours(at, 1),
                attendees: lead.email ? [{ email: lead.email }] : [],
            },
            input.leadId,
            'appointment',
        ).catch((e: any) => console.error('[sales-pipeline] Google Calendar fallito:', e?.message ?? e))
    })

    return { success: true }
}

/**
 * I lead nella pipeline del venditore. Stesse esclusioni della board GDO
 * (pipelineActions.ts:107) — e stesso tiebreaker su `id` su ENTRAMBE le query
 * (pipeline e richiami, come pipelineActions.ts:123 e :162), senza il quale i
 * lead importati in blocco ballano fra un caricamento e l'altro: le date
 * identiche arrivano a blocchi dagli import, non sono l'eccezione.
 */
export async function getSalesPipelineLeads(): Promise<{
    firstCall: any[]; secondCall: any[]; thirdCall: any[]; recalls: any[]
}> {
    const me = await requireSalesPipelineUser()
    if (!me) return { firstCall: [], secondCall: [], thirdCall: [], recalls: [] }

    const base = [
        eq(leads.companyId, me.companyId),
        eq(leads.assignedToId, me.userId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
    ]

    const [pipeline, recalls] = await Promise.all([
        db.select().from(leads)
            .where(and(...base, isNull(leads.recallDate), lt(leads.callCount, 3)))
            .orderBy(desc(leads.createdAt), leads.id),
        db.select().from(leads)
            .where(and(...base, isNotNull(leads.recallDate)))
            .orderBy(leads.recallDate, leads.id),
    ])

    return {
        firstCall: pipeline.filter(l => l.callCount === 0),
        secondCall: pipeline.filter(l => l.callCount === 1),
        thirdCall: pipeline.filter(l => l.callCount === 2),
        recalls,
    }
}

export interface SalesSelfAppointment {
    id: string
    name: string
    phone: string
    appointmentDate: Date
    appointmentNote: string | null
    version: number
}

/**
 * Gli appuntamenti che il venditore si e' fissato da solo e che deve ancora
 * fare. Accanto a `getSalesPipelineLeads`, che questi li esclude apposta
 * (`status != 'APPOINTMENT'`): senza una lettura dedicata un autofissato non
 * lo potrebbe spostare nessuno — `updateGdoAppointment` vuole un GDO, le
 * Conferme il lead non lo vedono, e `scheduleConfermeRecall` e' gated su
 * 'confermato'.
 *
 * Solo dal futuro in poi: un appuntamento gia' passato non si sposta, si
 * esita. La finestra parte dall'istante della lettura, non da mezzanotte,
 * perche' quello che conta e' se c'e' ancora tempo per avvisare il cliente.
 */
export async function getSalesSelfAppointments(): Promise<SalesSelfAppointment[]> {
    const me = await requireSalesPipelineUser()
    if (!me) return []

    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        appointmentDate: leads.appointmentDate,
        appointmentNote: leads.appointmentNote,
        version: leads.version,
    }).from(leads).where(and(
        eq(leads.companyId, me.companyId),
        eq(leads.salespersonUserId, me.userId),
        eq(leads.confirmationsOutcome, SELF_BOOKED_OUTCOME),
        eq(leads.status, 'APPOINTMENT'),
        isNotNull(leads.appointmentDate),
        gte(leads.appointmentDate, new Date()),
    )).orderBy(leads.appointmentDate, leads.id)

    return rows.map(r => ({ ...r, appointmentDate: r.appointmentDate! }))
}

/**
 * Sposta `count` lead ridati dal bot nella pipeline del venditore, prendendoli
 * dal GDO piu' carico. Si toglie lavoro a chi e' ingolfato, non a chi sta
 * girando bene.
 *
 * "Ridato dal bot" e' l'evento REASSIGNED_FROM_BOT, non `callCount = 0`: un
 * rimbalzo del bot azzera il contatore e sembrerebbe un lead mai chiamato.
 */
export async function assignBotReturnsToSalesPipeline(
    count: number,
): Promise<{ success: boolean; error?: string; moved?: number }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // Azione di SCRITTURA: in "Tutte le aziende" non si lavora (tenancy.ts:147).
    // Qui conta il doppio, perche' `appSettings` non ha companyId e quindi
    // `cfg.salesUserId` e' globale: senza questa guardia un admin che crede di
    // lavorare sull'aggregato sposterebbe i lead di una sola azienda.
    assertSingleCompany(ctx)
    if (ctx.role !== 'ADMIN' && ctx.role !== 'MANAGER') {
        return { success: false, error: 'Solo ADMIN e MANAGER possono assegnare lead alla pipeline.' }
    }
    const cfg = await readSalesPipelineConfig()
    if (!cfg.enabled || !cfg.salesUserId) return { success: false, error: 'Pipeline spenta.' }
    if (!Number.isInteger(count) || count < 1 || count > 50) {
        return { success: false, error: 'Quantita non valida (1-50).' }
    }

    // Il venditore della config deve essere un venditore VERO di QUESTA azienda.
    // `salesUserId` e' una stringa qualunque per il parser, e `appSettings` non
    // ha companyId: senza questa verifica un admin in contesto Serenamente
    // sposterebbe lead Serenamente a un venditore Fenice, e un id inesistente
    // farebbe violazione di FK su `leads.assignedToId`.
    const [venditore] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.id, cfg.salesUserId),
        eq(users.companyId, ctx.companyId),
        eq(users.role, 'VENDITORE'),
        eq(users.isActive, true),
    )).limit(1)
    if (!venditore) {
        return { success: false, error: 'Il venditore della pipeline non e\' un venditore attivo di questa azienda.' }
    }

    const target = venditore.id
    const now = new Date()

    // Carico per GDO: lead nuovi ancora da chiamare.
    const carico = await db.select({
        gdoId: leads.assignedToId,
        nuovi: sql<number>`count(*)::int`,
    }).from(leads).innerJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(users.role, 'GDO'),
            eq(users.isActive, true),
            eq(users.isBot, false),
            eq(leads.callCount, 0),
            ne(leads.status, 'REJECTED'),
            ne(leads.status, 'APPOINTMENT'),
        )).groupBy(leads.assignedToId)

    const ordered = pickMostLoadedGdo(
        carico.filter(r => r.gdoId).map(r => ({ gdoId: r.gdoId as string, nuovi: r.nuovi })),
    )

    let moved = 0
    /** Quanti lead sono stati tolti a ciascun GDO: serve per avvisarlo. */
    const movedByGdo = new Map<string, number>()
    for (const gdoId of ordered) {
        if (moved >= count) break
        const candidates = await db.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.assignedToId, gdoId),
            ne(leads.status, 'REJECTED'),
            ne(leads.status, 'APPOINTMENT'),
            // Doppia guardia, la stessa del ribilanciamento dei pool
            // (gdoPools/rebalance.ts:82 e il cron rebalance-gdo): lo stato
            // aperto NON basta a credere libero un lead. Un IN_PROGRESS con
            // `appointmentDate` valorizzato e' uno stato reale (esito venditore
            // rimosso, rifissaggio, follow-up), e spostarlo riscriverebbe a
            // posteriori a chi sono attribuiti appuntamento, KPI e bonus.
            isNull(leads.appointmentDate),
            isNull(leads.presentedAt),
            // Stessa soglia della board del venditore (`getSalesPipelineLeads`
            // mostra solo `callCount < 3`): un ridato gia' chiamato tre volte
            // sparirebbe dalla board del GDO senza comparire in quella del
            // venditore, e non lo vedrebbe piu' nessuno.
            lt(leads.callCount, 3),
            sql`exists (select 1 from "leadEvents" e where e."leadId" = ${leads.id} and e."eventType" = 'REASSIGNED_FROM_BOT')`,
        )).orderBy(leads.createdAt, leads.id).limit(count - moved)

        for (const c of candidates) {
            await db.transaction(async (tx) => {
                await tx.update(leads).set({
                    assignedToId: target,
                    // assignedAt e' il latch della PRIMA presa in carico: non si riscrive.
                    updatedAt: now,
                    // `version` e' il lock ottimistico di tutto il CRM, e ogni
                    // altra riassegnazione del repo lo incrementa
                    // (gestionePoolActions.ts:257, redistributeLeadsActions.ts:317,
                    // bot-fissatore/reassign.ts:118, il cron di rebalance). Senza,
                    // il GDO che ha il lead aperto nella board tiene in mano la
                    // version vecchia e il suo "registra esito" scrive lo stesso
                    // su un lead che non e' piu' suo.
                    version: sql`${leads.version} + 1`,
                }).where(eq(leads.id, c.id))
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: c.id,
                    eventType: 'SALES_PIPELINE_ASSIGNED',
                    userId: target, timestamp: now,
                    metadata: { source: 'bot_return', fromGdoId: gdoId },
                    companyId: ctx.companyId,
                })
            })
            moved++
            movedByGdo.set(gdoId, (movedByGdo.get(gdoId) ?? 0) + 1)
        }
    }

    // Il GDO a cui i lead sono stati tolti deve saperlo, e sapere perche'.
    // In questo CRM "lead spariti" e' una frase con una storia (14/05): un
    // GDO che si accorge da solo che la board si e' accorciata apre un caso,
    // e la risposta e' in una tabella che lui non vede. Best-effort: se la
    // campanella fallisce, i lead sono comunque spostati.
    if (movedByGdo.size > 0) {
        const notifiedAt = new Date()
        await db.insert(notifications).values(
            [...movedByGdo.entries()].map(([gdoId, n]) => ({
                id: crypto.randomUUID(),
                recipientUserId: gdoId,
                type: 'sales_pipeline_leads_moved',
                title: '📤 Lead spostati dalla tua pipeline',
                body: n === 1
                    ? '1 lead ridato dal fissatore e\' passato alla pipeline autonoma del venditore (test in corso). Non l\'hai perso: lo sta lavorando lui.'
                    : `${n} lead ridati dal fissatore sono passati alla pipeline autonoma del venditore (test in corso). Non li hai persi: li sta lavorando lui.`,
                metadata: { movedCount: n, salesUserId: target },
                status: 'unread',
                createdAt: notifiedAt,
                companyId: ctx.companyId,
            })),
        ).catch(e => console.error('[sales-pipeline] notifica al GDO di origine fallita', e))
    }

    return { success: true, moved }
}

/** Quanti lead freschi sono gia' stati dirottati alla pipeline, in tutto. */
export async function countDivertedFresh(companyId: string): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` })
        .from(leadEvents).where(and(
            eq(leadEvents.companyId, companyId),
            eq(leadEvents.eventType, 'SALES_PIPELINE_ASSIGNED'),
            sql`${leadEvents.metadata}->>'source' = 'fresh'`,
        ))
    return rows[0]?.n ?? 0
}

/** Quanti lead ridati dal bot sono gia' stati assegnati alla pipeline, in tutto. */
async function countBotReturnsAssigned(companyId: string): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` })
        .from(leadEvents).where(and(
            eq(leadEvents.companyId, companyId),
            eq(leadEvents.eventType, 'SALES_PIPELINE_ASSIGNED'),
            sql`${leadEvents.metadata}->>'source' = 'bot_return'`,
        ))
    return rows[0]?.n ?? 0
}

export interface SalesPipelineOverviewLead {
    id: string
    name: string
    phone: string
    status: string
    callCount: number
    appointmentDate: Date | null
    confirmationsOutcome: string | null
}

/**
 * Riepilogo per la pagina di regolazione: config attuale, i due contatori
 * (freschi dirottati e ridati assegnati) e i lead oggi in pipeline.
 *
 * I lead restano visibili anche dopo che sono diventati appuntamenti: si
 * prendono sia quelli ancora assegnati al venditore (`assignedToId`) sia
 * quelli gia' autofissati (`salespersonUserId` + sentinella 'autofissato'),
 * altrimenti un appuntamento fissato sparirebbe dalla tabella nello stesso
 * istante in cui viene creato.
 */
export async function getSalesPipelineOverview(): Promise<{
    config: SalesPipelineConfig
    divertedFresh: number
    botReturns: number
    leads: SalesPipelineOverviewLead[]
}> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!['ADMIN', 'MANAGER'].includes(ctx.role)) {
        return { config: DEFAULT_SALES_PIPELINE_CONFIG, divertedFresh: 0, botReturns: 0, leads: [] }
    }

    const config = await readSalesPipelineConfig()

    const [divertedFresh, botReturns] = await Promise.all([
        countDivertedFresh(ctx.companyId),
        countBotReturnsAssigned(ctx.companyId),
    ])

    let leadRows: SalesPipelineOverviewLead[] = []
    if (config.salesUserId) {
        leadRows = await db.select({
            id: leads.id,
            name: leads.name,
            phone: leads.phone,
            status: leads.status,
            callCount: leads.callCount,
            appointmentDate: leads.appointmentDate,
            confirmationsOutcome: leads.confirmationsOutcome,
        }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            or(
                eq(leads.assignedToId, config.salesUserId),
                and(
                    eq(leads.salespersonUserId, config.salesUserId),
                    eq(leads.confirmationsOutcome, SELF_BOOKED_OUTCOME),
                ),
            ),
        )).orderBy(desc(leads.createdAt), leads.id)
    }

    return { config, divertedFresh, botReturns, leads: leadRows }
}
