"use server"

import { db } from "@/db"
import {
    leads, users, salesAvailabilitySlots, salesSlotBlocks, salesWeekPlans, salesLatePenalties,
    salesWeekTemplateSlots,
} from "@/db/schema"
import { and, eq, gt, gte, lt, isNull, or, sql } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea, type TenantContext } from "@/lib/tenancy"
import { toRomeDateStr } from "@/lib/dateUtils"
import {
    weekSlots, weekStartFor, weeklyDeadline, slotKey, slotStartFor, romeInstant, addWeeks,
} from "@/lib/venditore/calendarSlots"
import { manualBlockCheck, blockRefusalMessage } from "@/lib/venditore/calendarRules"
import { weekCoverage } from "@/lib/venditore/calendarQueries"
import type { CoverageCell } from "@/lib/venditore/calendarCoverage"
import { isValidTemplateSlot, slotsFromTemplate, templateKey, type TemplateSlot } from "@/lib/venditore/calendarTemplate"
import { materializeTemplates } from "@/lib/venditore/calendarRunner"
import { revalidatePath } from "next/cache"
import crypto from "crypto"

/**
 * Ruoli ammessi al calendario venditori (spec §7, riga "Vedere la copertura"):
 * VENDITORE, CONFERME (il TL Conferme è un account CONFERME, vedi
 * `src/lib/confermeTl.ts`), MANAGER, ADMIN. Un GDO non compare in nessuna riga
 * di quella tabella: senza questo filtro leggeva copertura e nomi dei
 * venditori chiamando `getCalendarWeek` a mano.
 */
const CALENDAR_ROLES = ['VENDITORE', 'CONFERME', 'MANAGER', 'ADMIN']

/**
 * Forma di una chiave di slot come la manda il client: `YYYY-MM-DD@H`.
 * Serve come primo setaccio prima di `romeInstant`: `Number('abc')` è `NaN` e
 * una data invalida arrivava fino alla query, dove diventa un errore Postgres
 * (cioè un salvataggio fallito senza motivo leggibile) invece di una chiave
 * semplicemente scartata.
 */
const SLOT_KEY_RE = /^\d{4}-\d{2}-\d{2}@\d{1,2}$/

/**
 * Traduzione degli errori di SESSIONE in messaggi leggibili.
 *
 * `requireSalesSession` lancia `Unauthorized`, `assertSalesArea` un
 * `Forbidden: …`: se la chiamata sta fuori dal `try` l'eccezione risale al
 * client come errore di render invece che come "ricarica la pagina".
 *
 * Si riconosce il PREFISSO, non il messaggio esatto: `src/lib/tenancy.ts` non
 * lancia mai le due parole nude. `currentTenant` lancia `Unauthorized: no
 * Supabase user`, `assertSalesArea` `Forbidden: user … has area …`,
 * `assertSingleCompany` `Forbidden: azione non disponibile in modalità "Tutte
 * le aziende"`, `assertLeadInCompany` `Forbidden: lead … not found …`. Con un
 * match esatto nessuna di queste sarebbe stata riconosciuta e l'utente avrebbe
 * letto "riprova fra un momento" su un rifiuto che riprovando non cambia.
 *
 * Il testo dopo `Forbidden: ` viene restituito com'è quando c'è: è il modo in
 * cui `assertSingleCompany` spiega la modalità "Tutte le aziende", e
 * appiattirlo su "Non autorizzato." mandava a cercare un problema di permessi
 * dove il problema era solo lo switch azienda.
 */
function sessionErrorMessage(e: unknown): string | null {
    if (!(e instanceof Error)) return null
    const msg = e.message
    if (msg === 'Unauthorized' || msg.startsWith('Unauthorized:')) {
        return 'Sessione scaduta: ricarica la pagina.'
    }
    if (msg.startsWith('Forbidden')) {
        const dettaglio = msg.slice('Forbidden'.length).replace(/^:\s*/, '').trim()
        return dettaglio.length > 0 ? dettaglio : 'Non autorizzato.'
    }
    return null
}

/**
 * Sessione sales minima + guardia di ruolo. Il "chi può fare cosa" fine
 * (scrivere solo il proprio calendario, guardare quello altrui) resta dentro
 * ogni funzione esportata: qui si chiude solo la porta a chi non ha titolo di
 * entrare affatto.
 */
async function requireSalesSession() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Unauthorized")

    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (!CALENDAR_ROLES.includes(ctx.role)) throw new Error("Unauthorized")
    return { userId: ctx.userId, role: ctx.role, email: ctx.email, ctx }
}

/**
 * Venditori attivi visibili dal tenant corrente. Stesso pattern di
 * `getVenditoriAgenda` (confermeActions.ts): i venditori sono staff
 * condiviso, hanno `companyId='fenice'` e operano su altre aziende tramite
 * `allowedCompanies`. Filtrare sul solo `companyId` svuota la pagina su
 * Serenamente — bug già capitato e documentato lì.
 */
async function activeVenditori(ctx: TenantContext) {
    const rows = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        calendarExempt: users.calendarExempt,
    }).from(users).where(and(
        or(
            sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
        ),
        eq(users.role, 'VENDITORE'),
        eq(users.isActive, true),
    ))
    return rows.map(r => ({
        id: r.id,
        name: r.displayName || r.name || 'Venditore',
        calendarExempt: r.calendarExempt,
    }))
}

export interface CalendarWeekView {
    weekStartIso: string
    deadlineIso: string
    editable: boolean
    readOnlyReason: 'settimana_passata' | 'altro_venditore' | null
    isExempt: boolean
    /**
     * Di CHI e' il calendario in questa vista: chi guarda (il caso normale) o
     * il venditore scelto con `?venditore=<id>` da ADMIN/MANAGER/CONFERME.
     *
     * Il client deve ripassarlo ad ogni ricarica — cambio settimana compreso.
     * Senza, `getCalendarWeek` senza `salesUserId` ricade sul chiamante e la
     * pagina scivola in silenzio sul proprio calendario: si crede di guardare
     * lui e si stanno guardando le proprie ore.
     */
    targetUserId: string
    mySlots: string[]
    /**
     * true = ESISTE una riga `salesWeekPlans` per questa settimana, cioe'
     * `mySlots` e' una DICHIARAZIONE. false = `mySlots` e' solo una PROPOSTA
     * calcolata qui (il default verde o la settimana tipo non ancora
     * materializzata) e a DB non c'e' nulla.
     *
     * Serve a due cose, entrambe invisibili senza questo campo:
     * 1. il bottone Salva: con il default verde `mySlots` coincide gia' con la
     *    selezione iniziale, quindi "modificato?" e' falso all'apertura e il
     *    bottone nascerebbe spento proprio sul caso piu' frequente ("sono
     *    disponibile tutta la settimana"). Chi accetta la proposta non
     *    riuscirebbe a salvarla, e alle 14:00 prenderebbe la multa;
     * 2. il colore delle celle NON selezionate: rosso ("non disponibile") e'
     *    una scelta della persona e si mostra solo dove una scelta c'e' stata;
     *    su una proposta restano bianche (`libero`).
     *
     * NOTA: oggi coincide con `submittedAtIso !== null` (la colonna
     * `submittedAt` e' notNull, quindi piano presente <=> data presente), ma le
     * due domande sono diverse — "esiste un piano?" contro "quando e' stato
     * compilato?" — e la coincidenza regge solo finche' quella colonna resta
     * notNull. Sta scritto qui perche' si legga, non si deduca.
     */
    declared: boolean
    /**
     * La settimana tipo del venditore mostrato (indipendente da come e' nata
     * `mySlots`): serve al client per la scheda di gestione del modello.
     */
    template: TemplateSlot[]
    /**
     * true se `mySlots` proviene dal modello (righe 2 o 2-bis di
     * `getCalendarWeek`): settimana senza `salesWeekPlans` propria ma con un
     * modello impostato. Quando esiste gia' una riga di piano, riflette
     * `salesWeekPlans.fromTemplate` (vera per le settimane materializzate dal
     * cron, false per quelle compilate a mano).
     */
    fromTemplate: boolean
    /**
     * `orphan` = blocco FOLLOWUP il cui lead non e' piu' assegnato a questo
     * venditore: e' l'unico che `unblockSlot` accetta di togliere, e la UI deve
     * saperlo distinguere per non spegnere il bottone su uno stato senza uscita.
     */
    myBlocks: Array<{ slotKey: string; kind: string; leadId: string | null; leadName: string | null; orphan: boolean }>
    myAppointments: Array<{ slotKey: string; leadId: string; leadName: string }>
    submittedAtIso: string | null
    slotCount: number
    late: boolean
    penaltyIso: string | null
    coverage: CoverageCell[]
    venditori: Array<{ id: string; name: string }>
}

/**
 * Vista completa della settimana: la propria (default) o quella di un altro
 * venditore per chi ha visibilità gestionale (ADMIN/MANAGER/CONFERME). La
 * copertura è sempre inclusa: è interna, non riservata al singolo venditore.
 */
export async function getCalendarWeek(input?: {
    weekStartIso?: string
    salesUserId?: string
}): Promise<CalendarWeekView> {
    const { userId, role, ctx } = await requireSalesSession()

    // Una data illeggibile dal client ricade sulla settimana corrente: senza,
    // `Invalid Date` arrivava fino alle query e la pagina si rompeva.
    const richiesta = input?.weekStartIso ? new Date(input.weekStartIso) : null
    const weekStart = richiesta && !Number.isNaN(richiesta.getTime())
        ? weekStartFor(richiesta)
        : weekStartFor(new Date())
    // `addWeeks`, mai `+ 7 * 86_400_000`: nelle due settimane del cambio d'ora
    // l'aritmetica in millisecondi sposta il confine di un'ora, e blocchi e
    // appuntamenti del sabato sera (o del lunedì alle 9) cadevano fuori dalla
    // finestra — cioè sparivano dalla griglia proprio in quelle due settimane.
    const weekEnd = addWeeks(weekStart, 1)
    const weekStartStr = toRomeDateStr(weekStart)
    const deadline = weeklyDeadline(weekStart)

    // Solo lo staff gestionale può guardare il calendario di un altro
    // venditore; chiunque altro vede sempre e solo il proprio, a prescindere
    // da cosa arriva dal client.
    const canPickOthers = ['ADMIN', 'MANAGER', 'CONFERME'].includes(role)
    const targetUserId = (input?.salesUserId && canPickOthers) ? input.salesUserId : userId

    const isCurrentOrFuture = weekStart >= weekStartFor(new Date())
    const isSelf = targetUserId === userId
    const editable = isCurrentOrFuture && isSelf && role === 'VENDITORE'
    const readOnlyReason: CalendarWeekView['readOnlyReason'] = !isCurrentOrFuture
        ? 'settimana_passata'
        : (!isSelf ? 'altro_venditore' : null)

    const [availRows, blockRows, apptRows, planRows, templateRows, penaltyRows, coverage, venditoriRows] = await Promise.all([
        // Niente `eq(companyId)` su queste tre tabelle: sono per-utente, non
        // per-azienda (vedi la nota in `calendarQueries.ts`). Un venditore
        // loggato su Serenamente deve vedere la disponibilità che ha dichiarato,
        // non una pagina vuota.
        db.select({ slotStart: salesAvailabilitySlots.slotStart })
            .from(salesAvailabilitySlots)
            .where(and(
                eq(salesAvailabilitySlots.salesUserId, targetUserId),
                eq(salesAvailabilitySlots.weekStart, weekStartStr),
            )),
        db.select({
            slotStart: salesSlotBlocks.slotStart,
            kind: salesSlotBlocks.kind,
            leadId: salesSlotBlocks.leadId,
            leadName: leads.name,
            leadOwner: leads.salespersonUserId,
        }).from(salesSlotBlocks)
            .leftJoin(leads, eq(salesSlotBlocks.leadId, leads.id))
            .where(and(
                eq(salesSlotBlocks.salesUserId, targetUserId),
                gte(salesSlotBlocks.slotStart, weekStart),
                lt(salesSlotBlocks.slotStart, weekEnd),
            )),
        db.select({
            appointmentDate: leads.appointmentDate,
            leadId: leads.id,
            leadName: leads.name,
        }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, targetUserId),
            gte(leads.appointmentDate, weekStart),
            lt(leads.appointmentDate, weekEnd),
        )),
        db.select({
            submittedAt: salesWeekPlans.submittedAt,
            slotCount: salesWeekPlans.slotCount,
            late: salesWeekPlans.late,
            fromTemplate: salesWeekPlans.fromTemplate,
        }).from(salesWeekPlans).where(and(
            eq(salesWeekPlans.salesUserId, targetUserId),
            eq(salesWeekPlans.weekStart, weekStartStr),
        )).limit(1),
        // Niente `eq(companyId)`: tabella per-utente, vedi NOTA COMUNE in schema.ts.
        db.select({ dow: salesWeekTemplateSlots.dow, hour: salesWeekTemplateSlots.hour })
            .from(salesWeekTemplateSlots)
            .where(eq(salesWeekTemplateSlots.salesUserId, targetUserId)),
        db.select({ dueAt: salesLatePenalties.dueAt })
            .from(salesLatePenalties)
            .where(and(
                eq(salesLatePenalties.companyId, ctx.companyId),
                eq(salesLatePenalties.salesUserId, targetUserId),
                eq(salesLatePenalties.kind, 'CALENDAR_MISSING'),
                eq(salesLatePenalties.dueAt, deadline),
                isNull(salesLatePenalties.voidedAt),
            )).limit(1),
        weekCoverage(ctx, weekStart),
        activeVenditori(ctx),
    ])

    const myAppointments = apptRows.flatMap(r => {
        if (!r.appointmentDate) return []
        const slot = slotStartFor(r.appointmentDate)
        if (!slot) return []
        return [{ slotKey: slotKey(slot), leadId: r.leadId, leadName: r.leadName }]
    })

    const plan = planRows[0]
    const penalty = penaltyRows[0]
    const targetInfo = venditoriRows.find(v => v.id === targetUserId)
    const template: TemplateSlot[] = templateRows.map(r => ({ dow: r.dow, hour: r.hour }))

    // Le tre sorgenti di `mySlots`, in ordine — NESSUNA scrittura qui, solo
    // lettura e calcolo puro: il pre-riempimento e' una proposta al client,
    // non una dichiarazione (vedi il commento sulla regola in cima al file
    // del brief). Finche' il venditore non preme Salva, a DB non cambia nulla.
    let mySlots: string[]
    let fromTemplate: boolean
    const now = new Date()
    if (plan) {
        // 1) Cio' che e' gia' stato salvato (a mano o dal cron): comportamento
        // di oggi, invariato.
        mySlots = availRows.map(r => slotKey(r.slotStart))
        fromTemplate = plan.fromTemplate
    } else if (template.length > 0 && isSelf) {
        // 2) Nessun piano salvato, ma il venditore ha un modello: proponiamo
        // le sue ore, senza scriverle. Anche questa e' una PROPOSTA, quindi
        // vale solo sul proprio calendario, per la stessa ragione del ramo 3
        // qui sotto: su un calendario altrui una Conferma vedrebbe verde,
        // proverebbe a fissare, e il muro la respingerebbe perche' a DB quelle
        // ore non ci sono ancora.
        mySlots = slotsFromTemplate(template, weekStart, now).map(slotKey)
        fromTemplate = true
    } else if (isSelf) {
        // 3) Nessun piano, nessun modello: il default verde. Tutte le ore
        // future della settimana, escluse quelle gia' passate.
        //
        // SOLO sul proprio calendario: il verde qui e' una PROPOSTA rivolta a
        // chi guarda ("parto da tutto disponibile, togli quello che non va"),
        // non un fatto sul venditore. Su un calendario altrui
        // (`/mio-calendario?venditore=<id>`, aperto da ADMIN/MANAGER/CONFERME)
        // diventerebbe l'affermazione "e' disponibile 78 ore", mentre la
        // scheda Copertura dice "0 disponibili" e la supervisione dice "No":
        // tre superfici, tre risposte diverse sullo stesso fatto.
        mySlots = weekSlots(weekStart).filter(s => s > now).map(slotKey)
        fromTemplate = false
    } else {
        // 4) Calendario di un altro venditore senza piano: niente da mostrare.
        // Su una persona diversa da chi guarda si mostrano solo i DATI VERI —
        // il ramo 1 e basta. Il client, vedendo `declared: false`, lascia le
        // celle bianche (mai compilato) invece di tingerle di rosso (ha scelto
        // di non esserci).
        mySlots = []
        fromTemplate = false
    }

    return {
        weekStartIso: weekStart.toISOString(),
        deadlineIso: deadline.toISOString(),
        editable,
        readOnlyReason,
        isExempt: targetInfo?.calendarExempt ?? false,
        targetUserId,
        mySlots,
        declared: plan !== undefined,
        template,
        fromTemplate,
        myBlocks: blockRows.map(r => ({
            slotKey: slotKey(r.slotStart),
            kind: r.kind,
            leadId: r.leadId,
            leadName: r.leadName,
            orphan: r.kind === 'FOLLOWUP' && r.leadOwner !== targetUserId,
        })),
        myAppointments,
        submittedAtIso: plan?.submittedAt ? plan.submittedAt.toISOString() : null,
        slotCount: plan?.slotCount ?? 0,
        late: plan?.late ?? false,
        penaltyIso: penalty?.dueAt ? penalty.dueAt.toISOString() : null,
        coverage,
        venditori: venditoriRows.map(v => ({ id: v.id, name: v.name })),
    }
}

/**
 * Salva la disponibilità dichiarata per una settimana intera (sostituisce le
 * righe esistenti, non le somma) e registra/aggiorna `salesWeekPlans`.
 * `submittedAt`/`late` sono la prova del PRIMO salvataggio: il cron del
 * lunedì li legge per decidere le multe, quindi non si toccano più dopo.
 */
export async function saveCalendarWeek(
    weekStartIso: string,
    slotKeys: string[],
): Promise<{ success: boolean; error?: string; late?: boolean }> {
    // Sessione e validazione dell'input DENTRO il try: `requireSalesSession`
    // lancia, e da fuori quell'eccezione arrivava al client come pagina rotta
    // invece che come messaggio ("Sessione scaduta: ricarica la pagina").
    let late = false
    try {
        const { userId, role, ctx } = await requireSalesSession()
        if (role !== 'VENDITORE') {
            return { success: false, error: 'Solo i venditori compilano il proprio calendario.' }
        }

        const richiesta = new Date(weekStartIso)
        if (Number.isNaN(richiesta.getTime())) {
            return { success: false, error: 'Data non valida.' }
        }
        const weekStart = weekStartFor(richiesta)
        if (weekStart < weekStartFor(new Date())) {
            return { success: false, error: 'Le settimane passate non si modificano.' }
        }

        // Ricostruisce ogni chiave ricevuta dal client e la scarta se non
        // appartiene alla griglia di questa settimana: un client può mandare
        // qualunque cosa, non ci fidiamo delle chiavi in ingresso.
        const validKeys = new Set(weekSlots(weekStart).map(s => slotKey(s)))
        const valid = (Array.isArray(slotKeys) ? slotKeys : [])
            .map(key => {
                if (typeof key !== 'string' || !SLOT_KEY_RE.test(key)) return null
                const [dateStr, h] = key.split('@')
                const instant = romeInstant(dateStr, Number(h))
                return validKeys.has(slotKey(instant)) ? instant : null
            })
            .filter((d): d is Date => d !== null)

        const now = new Date()

        // Le ore GIÀ INIZIATE non si toccano più, nemmeno nella settimana corrente.
        // Sono la prova di quello che il venditore aveva offerto: la finestra di
        // segnalazione delle Conferme dura 48 ore e si sovrappone a quella di
        // modifica, quindi senza questa guardia bastava togliere la spunta alle
        // 11:00 per cancellare la prova dell'assenza delle 9:00 e spegnere il
        // bottone "Non c'era". La spec §4.7 dà per scontato che lo stato attuale
        // di uno slot passato coincida con quello che era: questa riga è ciò che
        // lo rende vero. Il resto della settimana continua a funzionare.
        const futuri = valid.filter(slot => slot > now)

        // Il client puo' mandare la stessa ora due volte: senza questa deduplica
        // l'insert violerebbe l'unique (salesUserId, slotStart) dentro la transazione.
        const perChiave = new Map<string, Date>()
        for (const slot of futuri) perChiave.set(slotKey(slot), slot)
        const unici = [...perChiave.values()]

        const weekStartStr = toRomeDateStr(weekStart)
        late = now > weeklyDeadline(weekStart)

        await db.transaction(async (tx) => {
            // Cancellazione limitata agli slot non ancora iniziati: le righe
            // passate restano dove sono (vedi sopra). Niente `eq(companyId)`:
            // tabella per-utente, non per-azienda.
            await tx.delete(salesAvailabilitySlots).where(and(
                eq(salesAvailabilitySlots.salesUserId, userId),
                eq(salesAvailabilitySlots.weekStart, weekStartStr),
                gt(salesAvailabilitySlots.slotStart, now),
            ))

            if (unici.length > 0) {
                await tx.insert(salesAvailabilitySlots).values(unici.map(slotStart => ({
                    id: crypto.randomUUID(),
                    // `companyId` resta valorizzato come PROVENIENZA (da quale
                    // azienda stava lavorando chi ha salvato), non come filtro:
                    // la riga vale su tutte le aziende del venditore.
                    companyId: ctx.companyId,
                    salesUserId: userId,
                    slotStart,
                    weekStart: weekStartStr,
                })))
                    // La DELETE qui sopra ha già ripulito il futuro di questa
                    // settimana: una riga uguale può essere arrivata solo dal
                    // cron (`materializeTemplates`) fra la DELETE e questa
                    // INSERT, e dichiara esattamente la stessa ora per la stessa
                    // persona — vale quanto la nostra. Senza, quella corsa
                    // faceva fallire l'intera transazione e il venditore vedeva
                    // "Salvataggio non riuscito" su un salvataggio legittimo.
                    .onConflictDoNothing()
            }

            // `slotCount` sono le ore della settimana DOPO il salvataggio,
            // quelle passate comprese: conta `unici` soltanto sarebbe un
            // numero calante di ora in ora, e la scheda Compilazione
            // mostrerebbe "0 ore" al sabato sera a chi aveva dichiarato tutto.
            const rimaste = await tx.select({ id: salesAvailabilitySlots.id })
                .from(salesAvailabilitySlots).where(and(
                    eq(salesAvailabilitySlots.salesUserId, userId),
                    eq(salesAvailabilitySlots.weekStart, weekStartStr),
                ))
            const slotCount = rimaste.length

            await tx.insert(salesWeekPlans).values({
                id: crypto.randomUUID(),
                companyId: ctx.companyId,
                salesUserId: userId,
                weekStart: weekStartStr,
                submittedAt: now,
                updatedAt: now,
                slotCount,
                late,
            }).onConflictDoUpdate({
                target: [salesWeekPlans.salesUserId, salesWeekPlans.weekStart],
                // submittedAt e late NON si toccano: sono la prova del primo
                // salvataggio, letta dal cron delle multe.
                // Un salvataggio dalla griglia e' un atto della persona: la settimana smette
                // di essere "da settimana tipo" anche se il modello l'aveva materializzata.
                // submittedAt e late restano: sono la prova del PRIMO salvataggio.
                set: { slotCount, updatedAt: now, fromTemplate: false },
            })
        })
    } catch (e) {
        const sessione = sessionErrorMessage(e)
        if (sessione) return { success: false, error: sessione }
        console.error('saveCalendarWeek:', e)
        return { success: false, error: 'Salvataggio non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/mio-calendario')
    return { success: true, late }
}

/**
 * Blocca uno slot già dichiarato disponibile per un imprevisto (preavviso
 * minimo di un'ora, niente se c'è già un appuntamento: vedi `manualBlockCheck`).
 */
export async function blockSlot(
    slotIso: string,
    note?: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        // Sessione e validazione dentro il try: vedi `saveCalendarWeek`.
        const { userId, role, ctx } = await requireSalesSession()
        if (role !== 'VENDITORE') {
            return { success: false, error: 'Solo i venditori bloccano il proprio calendario.' }
        }

        const richiesta = new Date(slotIso)
        if (Number.isNaN(richiesta.getTime())) return { success: false, error: 'Data non valida.' }
        const slot = slotStartFor(richiesta)
        if (!slot) return { success: false, error: 'Ora fuori dal calendario.' }
        const slotEnd = new Date(slot.getTime() + 60 * 60_000)

        const [availRows, blockRows, apptRows] = await Promise.all([
            db.select({ slotStart: salesAvailabilitySlots.slotStart })
                .from(salesAvailabilitySlots)
                .where(and(
                    // Tabella per-utente, non per-azienda: vedi calendarQueries.ts.
                    eq(salesAvailabilitySlots.salesUserId, userId),
                    eq(salesAvailabilitySlots.slotStart, slot),
                )).limit(1),
            db.select({ id: salesSlotBlocks.id })
                .from(salesSlotBlocks)
                .where(and(
                    eq(salesSlotBlocks.salesUserId, userId),
                    eq(salesSlotBlocks.slotStart, slot),
                )).limit(1),
            db.select({ id: leads.id })
                .from(leads)
                .where(and(
                    eq(leads.companyId, ctx.companyId),
                    eq(leads.salespersonUserId, userId),
                    gte(leads.appointmentDate, slot),
                    lt(leads.appointmentDate, slotEnd),
                )).limit(1),
        ])

        const decision = manualBlockCheck({
            slotStart: slot,
            now: new Date(),
            declared: availRows.length > 0,
            hasAppointment: apptRows.length > 0,
            alreadyBlocked: blockRows.length > 0,
        })
        if (!decision.ok) {
            return { success: false, error: blockRefusalMessage(decision.reason, slot) }
        }

        // Il doppio click e' un no-op, non un errore: la guardia vera e' l'indice
        // parziale a DB sales_slot_blocks_manual_uq (salesUserId, slotStart) WHERE
        // kind='MANUAL' (Task 2) — niente transazione qui, basta il conflitto.
        await db.insert(salesSlotBlocks).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            salesUserId: userId,
            slotStart: slot,
            kind: 'MANUAL',
            createdBy: userId,
            note: note ?? null,
        }).onConflictDoNothing()
    } catch (e) {
        const sessione = sessionErrorMessage(e)
        if (sessione) return { success: false, error: sessione }
        console.error('blockSlot:', e)
        return { success: false, error: 'Blocco non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/mio-calendario')
    return { success: true }
}

/**
 * Toglie un blocco manuale. I blocchi `FOLLOWUP` di un lead ancora assegnato
 * non si toccano da qui: si liberano spostando il follow-up o registrandone
 * l'esito.
 *
 * Unica eccezione: il blocco ORFANO, cioè quello di un lead che non è più del
 * venditore (riassegnato, appuntamento annullato, esito rimosso da un percorso
 * che non ha liberato). Lì il venditore non ha nessuna strada per toglierlo —
 * il lead non è più suo — e lo slot resterebbe occupato per sempre, fuori dalla
 * copertura e non più segnalabile come assenza.
 */
export async function unblockSlot(slotIso: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Sessione e validazione dentro il try: vedi `saveCalendarWeek`.
        const { userId, role } = await requireSalesSession()
        if (role !== 'VENDITORE') {
            return { success: false, error: 'Solo i venditori sbloccano il proprio calendario.' }
        }

        const richiesta = new Date(slotIso)
        if (Number.isNaN(richiesta.getTime())) return { success: false, error: 'Data non valida.' }
        const slot = slotStartFor(richiesta)
        if (!slot) return { success: false, error: 'Ora fuori dal calendario.' }

        const [existing] = await db.select({
            id: salesSlotBlocks.id,
            kind: salesSlotBlocks.kind,
            leadId: salesSlotBlocks.leadId,
        })
            .from(salesSlotBlocks)
            .where(and(
                eq(salesSlotBlocks.salesUserId, userId),
                eq(salesSlotBlocks.slotStart, slot),
            ))
            .limit(1)

        if (!existing) return { success: true }
        if (existing.kind === 'FOLLOWUP') {
            // Il lead è ancora suo? Allora il blocco è vivo e va liberato dal
            // percorso giusto. Se non lo è più (o non esiste più), è orfano.
            const [lead] = existing.leadId
                ? await db.select({ salespersonUserId: leads.salespersonUserId })
                    .from(leads).where(eq(leads.id, existing.leadId)).limit(1)
                : []
            if (lead && lead.salespersonUserId === userId) {
                return { success: false, error: "Questo slot è occupato da un follow-up: spostalo o registrane l'esito." }
            }
        }

        await db.delete(salesSlotBlocks).where(eq(salesSlotBlocks.id, existing.id))
    } catch (e) {
        const sessione = sessionErrorMessage(e)
        if (sessione) return { success: false, error: sessione }
        console.error('unblockSlot:', e)
        return { success: false, error: 'Sblocco non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/mio-calendario')
    return { success: true }
}

/**
 * La settimana tipo del venditore che chiama. Sola lettura: nessuna scrittura
 * qui, coerente con `getCalendarWeek`.
 */
export async function getMyTemplate(): Promise<TemplateSlot[]> {
    // Sessione FUORI dal try, a differenza delle action che tornano
    // `{ success, error }`: qui non c'è un campo dove infilare un messaggio, e
    // un `[]` al posto di un errore di sessione direbbe "nessuna settimana
    // tipo" a chi invece ne ha una.
    const { userId, role } = await requireSalesSession()
    if (role !== 'VENDITORE') return []

    try {
        const rows = await db.select({
            dow: salesWeekTemplateSlots.dow,
            hour: salesWeekTemplateSlots.hour,
        }).from(salesWeekTemplateSlots)
            .where(eq(salesWeekTemplateSlots.salesUserId, userId))
        return rows
    } catch (e) {
        console.error('getMyTemplate:', e)
        return []
    }
}

/**
 * Sostituisce la settimana tipo del venditore che chiama (delete + insert in
 * transazione, mai una somma). Le voci non valide (fuori griglia) vengono
 * scartate in silenzio: un client puo' mandare qualunque cosa, non ci
 * fidiamo dell'input.
 *
 * Dopo il salvataggio, materializza subito le settimane future di questo
 * venditore (Task 3) cosi' l'effetto si vede senza aspettare il prossimo giro
 * di cron. Se la materializzazione fallisce, il modello resta comunque
 * salvato: la recupera il cron entro mezz'ora.
 */
export async function saveMyTemplate(slots: TemplateSlot[]): Promise<{ success: boolean; error?: string }> {
    let userId: string
    try {
        // Sessione e validazione dentro il try: vedi `saveCalendarWeek`.
        const sessione = await requireSalesSession()
        userId = sessione.userId
        if (sessione.role !== 'VENDITORE') {
            return { success: false, error: 'Solo i venditori impostano la propria settimana tipo.' }
        }
        const ctx = sessione.ctx

        const valid = (Array.isArray(slots) ? slots : []).filter(isValidTemplateSlot)
        // Dedup per (dow, hour): il client puo' mandare doppioni, e l'insert
        // violerebbe l'unique (salesUserId, dow, hour) dentro la transazione.
        const perChiave = new Map<string, TemplateSlot>()
        for (const s of valid) perChiave.set(templateKey(s.dow, s.hour), s)
        const unici = [...perChiave.values()]

        await db.transaction(async (tx) => {
            await tx.delete(salesWeekTemplateSlots).where(eq(salesWeekTemplateSlots.salesUserId, userId))

            if (unici.length > 0) {
                await tx.insert(salesWeekTemplateSlots).values(unici.map(s => ({
                    id: crypto.randomUUID(),
                    companyId: ctx.companyId,
                    salesUserId: userId,
                    dow: s.dow,
                    hour: s.hour,
                })))
            }
        })
    } catch (e) {
        const sessione = sessionErrorMessage(e)
        if (sessione) return { success: false, error: sessione }
        console.error('saveMyTemplate:', e)
        return { success: false, error: 'Salvataggio della settimana tipo non riuscito: riprova fra un momento.' }
    }

    try {
        // Solo questo venditore: senza `salesUserId` scatenerebbe una
        // scansione dell'intero team ad ogni salvataggio individuale.
        await materializeTemplates(new Date(), userId)
    } catch (e) {
        // Il modello e' comunque salvato: non facciamo fallire l'azione per
        // un problema della materializzazione, che il cron recupera da solo.
        console.error('saveMyTemplate: materializeTemplates:', e)
    }

    revalidatePath('/mio-calendario')
    return { success: true }
}

/**
 * Azzera la settimana tipo del venditore che chiama. Non tocca le settimane
 * gia' materializzate: restano come sono, sono ormai dichiarazioni a tutti
 * gli effetti.
 */
export async function clearMyTemplate(): Promise<{ success: boolean; error?: string }> {
    try {
        // Sessione dentro il try: vedi `saveCalendarWeek`.
        const { userId, role } = await requireSalesSession()
        if (role !== 'VENDITORE') {
            return { success: false, error: 'Solo i venditori gestiscono la propria settimana tipo.' }
        }

        await db.delete(salesWeekTemplateSlots).where(eq(salesWeekTemplateSlots.salesUserId, userId))
    } catch (e) {
        const sessione = sessionErrorMessage(e)
        if (sessione) return { success: false, error: sessione }
        console.error('clearMyTemplate:', e)
        return { success: false, error: 'Rimozione della settimana tipo non riuscita: riprova fra un momento.' }
    }

    revalidatePath('/mio-calendario')
    return { success: true }
}
