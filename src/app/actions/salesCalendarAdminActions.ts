"use server"

/**
 * Azioni sul calendario venditori per chi lo GUARDA da fuori (Conferme,
 * Direzione, Admin) invece di compilarlo (quello è `salesCalendarActions.ts`,
 * ad uso dei venditori stessi).
 *
 * Il Task 9 aggiunge `reportSalesAbsence`. Il Task 10 aggiungerà altre
 * funzioni per la vista Direzione e per l'annullamento delle multe
 * (`voidCalendarPenalty`): questo file è pensato per crescere, non per
 * restare a una funzione sola.
 */

import { db } from "@/db"
import { leads, users, salesAvailabilitySlots, salesSlotBlocks, salesWeekPlans, salesLatePenalties, notifications, leadEvents } from "@/db/schema"
import { and, eq, gte, lt, lte, or, sql, isNull, inArray, desc } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea, type TenantContext } from "@/lib/tenancy"
import { slotStartFor, slotKey, weekStartFor, weeklyDeadline } from "@/lib/venditore/calendarSlots"
import { absenceReportCheck, absenceRefusalMessage, CALENDAR_PENALTY_EUR, type CalendarPenaltyKind } from "@/lib/venditore/calendarRules"
import { romeMonthKey } from "@/lib/venditore/latePenalties"
import { formatRomeAppointmentLabel, toRomeDateStr, monthBoundsRome } from "@/lib/dateUtils"
import { weekCoverage } from "@/lib/venditore/calendarQueries"
import type { CoverageCell } from "@/lib/venditore/calendarCoverage"
import { revalidatePath } from "next/cache"

/**
 * Traduzione degli errori di SESSIONE in messaggi leggibili.
 *
 * `requireCalendarSupervisor` e `assertSalesArea` lanciano: se la chiamata sta
 * fuori dal `try` l'eccezione risale al client come "An error occurred in the
 * Server Components render", cioè una schermata rossa al posto di "ricarica la
 * pagina". Dentro il `try`, questa funzione riconosce i due casi che hanno un
 * messaggio utile da dare; tutto il resto resta un errore generico + log.
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
 * "Il venditore aveva lo slot libero e non c'era": multa da 50 €, subito.
 * L'admin può annullarla (voidCalendarPenalty): attrito zero per chi segnala,
 * controllo a posteriori per chi decide.
 */
export async function reportSalesAbsence(
    salesUserId: string,
    slotIso: string,
    note?: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const role = user?.user_metadata?.role as string | undefined
        if (!user || !role || !["CONFERME", "ADMIN"].includes(role)) {
            return { success: false, error: "Non autorizzato." }
        }
        const ctx = await currentTenant()
        assertSalesArea(ctx)

        const slotDate = new Date(slotIso)
        if (Number.isNaN(slotDate.getTime())) return { success: false, error: "Data non valida." }
        const slot = slotStartFor(slotDate)
        if (!slot) return { success: false, error: "Ora fuori dal calendario." }
        const slotEnd = new Date(slot.getTime() + 3_600_000)

        // Staff condiviso multi-tenant: stesso pattern di getVenditoriAgenda
        // (allowedCompanies). Senza questo filtro un salesUserId di un'altra
        // azienda passerebbe comunque, e la multa/notifica finirebbero scritte
        // con il companyId di chi chiama invece che con quello vero del
        // venditore: un buco di isolamento fra tenant, non una svista.
        const tenantScope = or(
            sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
        )

        const [venditore] = await db.select({ calendarExempt: users.calendarExempt, name: users.name })
            .from(users).where(and(eq(users.id, salesUserId), tenantScope))
        if (!venditore) return { success: false, error: "Venditore non trovato." }

        // Disponibilita' e blocchi si leggono SENZA `eq(companyId)`: sono
        // tabelle per-utente, non per-azienda (vedi la nota in
        // `calendarQueries.ts`). Con il filtro azienda una Conferma su
        // Serenamente vedeva ogni slot come "non dichiarato".
        const [declared] = await db.select({ id: salesAvailabilitySlots.id })
            .from(salesAvailabilitySlots).where(and(
                eq(salesAvailabilitySlots.salesUserId, salesUserId),
                eq(salesAvailabilitySlots.slotStart, slot),
            ))
        const [blocked] = await db.select({ id: salesSlotBlocks.id })
            .from(salesSlotBlocks).where(and(
                eq(salesSlotBlocks.salesUserId, salesUserId),
                eq(salesSlotBlocks.slotStart, slot),
                // Solo i blocchi NATI PRIMA dell'inizio dello slot valgono come
                // "il venditore aveva avvisato". Un follow-up spostato a cose
                // fatte su un'ora gia' passata creerebbe un blocco retrodatato
                // e spegnerebbe il bottone "Non c'era" con una motivazione
                // falsa: nessuno aveva avvisato nessuno.
                lte(salesSlotBlocks.createdAt, slot),
            ))
        const [reported] = await db.select({ id: salesLatePenalties.id })
            .from(salesLatePenalties).where(and(
                // Niente `eq(companyId)`: l'indice unico che difende davvero
                // questo slot è `sales_penalties_userkind_uq (salesUserId, kind,
                // dueAt)`, che l'azienda NON la contiene. Con il filtro, una
                // Conferma su Serenamente non vedeva la segnalazione fatta su
                // Fenice, credeva lo slot libero e l'insert le veniva assorbito
                // dal conflitto: "segnalato" a video, nessuna multa nuova.
                eq(salesLatePenalties.salesUserId, salesUserId),
                eq(salesLatePenalties.kind, 'ABSENT_SLOT'),
                eq(salesLatePenalties.dueAt, slot),
                // Conta anche le multe annullate: l'annullamento e' una decisione
                // dell'admin su quello slot, non una cancellazione. Contarle e'
                // anche cio' che tiene il controllo allineato all'indice unico,
                // che non distingue le righe annullate: senza, l'inserimento
                // verrebbe assorbito e risponderemmo "fatto" senza fare nulla.
            ))

        const decision = absenceReportCheck({
            slotStart: slot,
            now: new Date(),
            declared: !!declared,
            blocked: !!blocked,
            exempt: venditore.calendarExempt,
            alreadyReported: !!reported,
        })
        if (!decision.ok) return { success: false, error: absenceRefusalMessage(decision.reason) }

        // Il lead dell'eventuale appuntamento in quello slot: serve a chi legge la
        // multa per capire quale appuntamento è saltato.
        const [appuntamento] = await db.select({ id: leads.id })
            .from(leads).where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.salespersonUserId, salesUserId),
                gte(leads.appointmentDate, slot),
                lt(leads.appointmentDate, slotEnd),
            ))

        const inserted = await db.insert(salesLatePenalties).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            salesUserId,
            leadId: appuntamento?.id ?? null,
            kind: 'ABSENT_SLOT',
            dueAt: slot,
            detectedAt: new Date(),
            amountEur: CALENDAR_PENALTY_EUR,
            monthKey: romeMonthKey(slot),
            reportedBy: user.id,
            note: note || null,
        }).onConflictDoNothing().returning({ id: salesLatePenalties.id })

        // Se onConflictDoNothing non ha scritto nulla, la multa su quello slot
        // esiste già (corsa fra due segnalazioni, o una riga di un'altra
        // azienda che il pre-check qui sopra ora vede). Rispondere `success:
        // true` sarebbe una bugia: nessuna multa nuova è stata scritta, e chi
        // segnala meritava di saperlo invece di vedere "fatto".
        if (inserted.length === 0) {
            return { success: false, error: 'Assenza già segnalata per questo slot.' }
        }

        await db.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: salesUserId,
            type: 'calendar_penalty',
            title: 'Multa: assenza su slot disponibile',
            body: `Segnalata assenza ${formatRomeAppointmentLabel(slot)}: trattenuta di ${CALENDAR_PENALTY_EUR} €.`,
            metadata: { slot: slot.toISOString() },
            companyId: ctx.companyId,
        })

        revalidatePath('/conferme')
        revalidatePath('/calendari-venditori')
        return { success: true }
    } catch (e) {
        const sessione = sessionErrorMessage(e)
        if (sessione) return { success: false, error: sessione }
        console.error('reportSalesAbsence:', e)
        return { success: false, error: 'Segnalazione non riuscita: riprova fra un momento.' }
    }
}

/**
 * Filtro di appartenenza per lo staff venditori condiviso fra aziende
 * (`allowedCompanies`): stesso pattern di `getVenditoriAgenda`/`activeVenditori`.
 * Un `eq(companyId)` secco svuota la pagina su Serenamente.
 */
function venditoreTenantScope(ctx: TenantContext) {
    return or(
        sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
        and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
    )
}

/**
 * Guardia della vista Direzione. CONFERME guarda in sola lettura (e senza la
 * scheda Multe: spec §6.2); ADMIN e MANAGER vedono tutto, ma solo ADMIN può
 * annullare una multa o cambiare l'esenzione (spec §7) — `canWrite` riflette
 * esattamente questo, non un generico "ruolo gestionale".
 */
async function requireCalendarSupervisor(): Promise<{ userId: string; role: string; canWrite: boolean; ctx: TenantContext }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !role || !["ADMIN", "MANAGER", "CONFERME"].includes(role)) {
        throw new Error("Unauthorized")
    }
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return { userId: user.id, role, canWrite: role === 'ADMIN', ctx }
}

export interface SupervisionView {
    weekStartIso: string
    coverage: CoverageCell[]
    venditori: Array<{ id: string; name: string; calendarExempt: boolean }>
    matrix: Array<{ salesUserId: string; slotKeys: string[] }>
    compilation: Array<{
        salesUserId: string
        submittedAtIso: string | null
        slotCount: number
        late: boolean
        /** Importo della multa "calendario non compilato" per questa settimana, o null. */
        penaltyEur: number | null
        /** Esente (spec §4.3): stato proprio, non "non compilato". */
        exempt: boolean
        /**
         * `salesWeekPlans.fromTemplate` di questa riga: qui `submittedAtIso` è
         * garantito derivare da una riga vera (`planRows`, mai una proposta non
         * materializzata come in `getCalendarWeek`), quindi combinarli è sicuro
         * e dice se la settimana è stata compilata a mano o dal cron.
         */
        fromTemplate: boolean
        /**
         * Ha compilato, ma ZERO ore: formalmente in regola, in pratica
         * imprenotabile tutta la settimana. Nasce qui e basta — l'ordinamento
         * di questa lista, la pastiglia "0 ore: imprenotabile" e il conteggio
         * in testa alla scheda leggono tutti questo campo. Quando la
         * definizione viveva in tre copie (una per posto) bastava che una
         * dimenticasse `!exempt` per far comparire gli esenti fra gli
         * imprenotabili in un punto solo dei tre.
         */
        zeroOre: boolean
    }>
    penalties: Array<{
        id: string
        salesUserId: string
        kind: CalendarPenaltyKind
        dueAt: string
        amountEur: number
        note: string | null
        reportedByName: string | null
        voidedAtIso: string | null
        voidReason: string | null
        leadName: string | null
    }>
    monthKey: string
    totalEur: number
}

/**
 * Vista completa di supervisione: stessa `weekCoverage` delle altre due
 * schermate (mai un secondo calcolo), più compilazione e multe del mese
 * richiesto (default: il mese corrente).
 *
 * La scheda Multe è riservata ad ADMIN/MANAGER (spec §6.2): per un account
 * CONFERME il registro non viene nemmeno LETTO, e la risposta esce con
 * `penalties: []` e `totalEur: 0`. Nasconderlo solo a video (`showMulte` nel
 * client) lasciava le righe dentro il payload della server action, leggibili
 * da chiunque aprisse la scheda di rete: la trattenuta di un collega è un dato
 * di paga, non un dettaglio di UI.
 *
 * Resta invece visibile a tutti la pastiglia "Multa" della scheda Compilazione
 * (`missingRows`): dice che QUELLA settimana non è stata compilata, ed è il
 * fatto su cui le Conferme lavorano — non il registro del mese.
 */
export async function getCalendarSupervision(
    weekStartIso?: string,
    monthKeyInput?: string,
): Promise<SupervisionView> {
    const { role, ctx } = await requireCalendarSupervisor()

    // Una data illeggibile dal client ricade sulla settimana corrente invece di
    // propagare `Invalid Date` fin dentro le query (dove diventa un errore di
    // Postgres, cioè una pagina rotta).
    const richiesta = weekStartIso ? new Date(weekStartIso) : null
    const weekStart = richiesta && !Number.isNaN(richiesta.getTime())
        ? weekStartFor(richiesta)
        : weekStartFor(new Date())
    const weekStartStr = toRomeDateStr(weekStart)
    const deadline = weeklyDeadline(weekStart)
    const monthKey = monthKeyInput || romeMonthKey(new Date())

    // Costruita sempre, ESEGUITA solo se chi guarda ha diritto al registro:
    // una query Drizzle non parte finché non la si attende.
    // `leftJoin` su leads: le multe CALENDAR_MISSING non hanno lead e
    // sparirebbero con un innerJoin (lo stesso bug che il Task 11 corregge
    // altrove — non va introdotto qui).
    const penaltyRegistryQuery = db.select({
        id: salesLatePenalties.id,
        salesUserId: salesLatePenalties.salesUserId,
        kind: salesLatePenalties.kind,
        dueAt: salesLatePenalties.dueAt,
        amountEur: salesLatePenalties.amountEur,
        note: salesLatePenalties.note,
        voidedAt: salesLatePenalties.voidedAt,
        voidReason: salesLatePenalties.voidReason,
        leadName: leads.name,
        reporterName: users.name,
        reporterDisplayName: users.displayName,
    }).from(salesLatePenalties)
        .leftJoin(leads, eq(salesLatePenalties.leadId, leads.id))
        .leftJoin(users, eq(salesLatePenalties.reportedBy, users.id))
        .where(and(
            eq(salesLatePenalties.companyId, ctx.companyId),
            or(
                eq(salesLatePenalties.kind, 'CALENDAR_MISSING'),
                eq(salesLatePenalties.kind, 'ABSENT_SLOT'),
            ),
            eq(salesLatePenalties.monthKey, monthKey),
        ))
        .orderBy(desc(salesLatePenalties.dueAt))
    type PenaltyRegistryRow = Awaited<typeof penaltyRegistryQuery>[number]
    const penaltyRegistry: PenaltyRegistryRow[] | Promise<PenaltyRegistryRow[]> =
        role === 'CONFERME' ? [] : penaltyRegistryQuery

    const [coverage, venditoriRows, availRows, planRows, missingRows, penaltyRows] = await Promise.all([
        weekCoverage(ctx, weekStart),
        db.select({
            id: users.id,
            name: users.name,
            displayName: users.displayName,
            calendarExempt: users.calendarExempt,
        }).from(users).where(and(
            venditoreTenantScope(ctx),
            eq(users.role, 'VENDITORE'),
            eq(users.isActive, true),
        )).orderBy(users.name),
        db.select({
            salesUserId: salesAvailabilitySlots.salesUserId,
            slotStart: salesAvailabilitySlots.slotStart,
        }).from(salesAvailabilitySlots).where(
            // Per-utente, non per-azienda: vedi la nota in calendarQueries.ts.
            eq(salesAvailabilitySlots.weekStart, weekStartStr),
        ),
        db.select({
            salesUserId: salesWeekPlans.salesUserId,
            submittedAt: salesWeekPlans.submittedAt,
            slotCount: salesWeekPlans.slotCount,
            late: salesWeekPlans.late,
            fromTemplate: salesWeekPlans.fromTemplate,
        }).from(salesWeekPlans).where(
            // Per-utente, non per-azienda: vedi la nota in calendarQueries.ts.
            eq(salesWeekPlans.weekStart, weekStartStr),
        ),
        // Chi ha già la multa "calendario non compilato" per QUESTA scadenza
        // (annullate escluse): serve solo alla pastiglia "Multa" della scheda
        // Compilazione, indipendente dal monthKey della scheda Multe.
        db.select({
            salesUserId: salesLatePenalties.salesUserId,
            amountEur: salesLatePenalties.amountEur,
        })
            .from(salesLatePenalties).where(and(
                eq(salesLatePenalties.companyId, ctx.companyId),
                eq(salesLatePenalties.kind, 'CALENDAR_MISSING'),
                eq(salesLatePenalties.dueAt, deadline),
                isNull(salesLatePenalties.voidedAt),
            )),
        // Registro del mese. Per CONFERME è già un array vuoto: vedi la nota in
        // testa alla funzione.
        penaltyRegistry,
    ])

    const venditori = venditoriRows.map(v => ({
        id: v.id,
        name: v.displayName || v.name || 'Venditore',
        calendarExempt: v.calendarExempt,
    }))

    const declaredByUser = new Map<string, string[]>()
    for (const row of availRows) {
        const arr = declaredByUser.get(row.salesUserId) ?? []
        arr.push(slotKey(row.slotStart))
        declaredByUser.set(row.salesUserId, arr)
    }
    const matrix = venditori.map(v => ({ salesUserId: v.id, slotKeys: declaredByUser.get(v.id) ?? [] }))

    const planByUser = new Map(planRows.map(p => [p.salesUserId, p]))
    // L'importo vero della multa, non una costante riscritta a video: il giorno
    // che i 50 € cambiano, la scheda dice ancora la verità sulle righe vecchie.
    const penaltyByUser = new Map(missingRows.map(r => [r.salesUserId, r.amountEur]))
    const compilation = venditori.map(v => {
        const plan = planByUser.get(v.id)
        const submittedAtIso = plan?.submittedAt ? plan.submittedAt.toISOString() : null
        // Le ore VERE della settimana, non il denormalizzato del piano: è la
        // stessa lista che disegna la matrice Venditore × ore e la griglia
        // di copertura, già in memoria qui sopra. `salesWeekPlans.slotCount`
        // è una copia, e una copia si disallinea (un'ora tolta a mano su una
        // settimana materializzata dal modello non tocca la riga di piano):
        // la scheda diceva "12 ore" accanto a una riga che ne mostrava 10.
        const slotCount = declaredByUser.get(v.id)?.length ?? 0
        return {
            salesUserId: v.id,
            submittedAtIso,
            slotCount,
            late: plan?.late ?? false,
            penaltyEur: penaltyByUser.get(v.id) ?? null,
            exempt: v.calendarExempt,
            fromTemplate: plan?.fromTemplate ?? false,
            // Unica definizione di "compilato zero ore" di tutto il modulo:
            // vedi il commento sul campo nel tipo qui sopra.
            zeroOre: !!submittedAtIso && slotCount === 0 && !v.calendarExempt,
        }
    })
    // Prima i non compilati: sono il motivo per cui qualcuno apre questa scheda.
    // Gli esenti NON sono "non compilati" (spec §4.3): restano in fondo insieme
    // a chi ha compilato, altrimenti Sales 001 guiderebbe la lista degli
    // inadempienti ogni settimana per sempre.
    //
    // Subito dopo, chi ha compilato ZERO ore. Formalmente ha adempiuto — la
    // riga di piano c'è, nessuna multa automatica scatta — ma il risultato per
    // l'azienda è identico a non aver compilato: quel venditore è imprenotabile
    // tutta la settimana e nella scheda spariva in mezzo ai "A mano" verdi, con
    // un innocuo `0` nella colonna Ore. Qui sale dove si vede; se debba
    // diventare multa è una decisione del PO, non di questo ordinamento.
    const inadempiente = (r: { submittedAtIso: string | null; exempt: boolean }) =>
        !r.submittedAtIso && !r.exempt
    const rango = (r: { submittedAtIso: string | null; exempt: boolean; zeroOre: boolean }) =>
        inadempiente(r) ? 0 : (r.zeroOre ? 1 : 2)
    compilation.sort((a, b) => rango(a) - rango(b))

    const penalties = penaltyRows.map(r => ({
        id: r.id,
        salesUserId: r.salesUserId,
        kind: r.kind as CalendarPenaltyKind,
        dueAt: r.dueAt.toISOString(),
        amountEur: r.amountEur,
        note: r.note,
        reportedByName: r.reporterDisplayName || r.reporterName || null,
        voidedAtIso: r.voidedAt ? r.voidedAt.toISOString() : null,
        voidReason: r.voidReason,
        leadName: r.leadName,
    }))
    // I totali escludono sempre le righe annullate: non è un filtro di vista,
    // è il vincolo di prodotto sull'annullamento (spec §7).
    const totalEur = penalties.reduce((sum, p) => sum + (p.voidedAtIso ? 0 : p.amountEur), 0)

    return {
        weekStartIso: weekStart.toISOString(),
        coverage,
        venditori,
        matrix,
        compilation,
        penalties,
        monthKey,
        totalEur,
    }
}

/**
 * Annulla una multa calendario. Definitivo per quello slot (decisione Task 9):
 * non esiste un `voidCalendarPenalty(..., false)` che la riapra.
 */
export async function voidCalendarPenalty(
    penaltyId: string,
    reason: string,
): Promise<{ success: boolean; error?: string }> {
    // `salesLatePenalties` è una tabella sola per due registri distinti: i 50 €
    // del calendario (qui) e i 10 € dei ritardi (Monitor Vendite, Task 11).
    // Questa funzione è competente solo sul primo: senza questo filtro,
    // chiamandola con l'id di una multa APPOINTMENT/FOLLOWUP la annullerebbe
    // lo stesso, perché altrimenti il where guarda solo id+companyId.
    const calendarKindScope = or(
        eq(salesLatePenalties.kind, 'CALENDAR_MISSING'),
        eq(salesLatePenalties.kind, 'ABSENT_SLOT'),
    )

    try {
        // Sessione e validazione DENTRO il try: una sessione scaduta qui
        // lanciava "Unauthorized" fino al client, che mostrava una pagina
        // rotta invece di "ricarica la pagina".
        const { userId, role, ctx } = await requireCalendarSupervisor()
        if (role !== 'ADMIN') return { success: false, error: 'Non autorizzato.' }

        const trimmed = reason?.trim()
        if (!trimmed) return { success: false, error: 'Serve un motivo.' }

        const [existing] = await db.select({
            id: salesLatePenalties.id,
            voidedAt: salesLatePenalties.voidedAt,
        }).from(salesLatePenalties).where(and(
            eq(salesLatePenalties.id, penaltyId),
            eq(salesLatePenalties.companyId, ctx.companyId),
            calendarKindScope,
        )).limit(1)

        if (!existing) return { success: false, error: 'Multa non trovata.' }
        if (existing.voidedAt) return { success: false, error: 'Multa già annullata.' }

        await db.update(salesLatePenalties).set({
            voidedAt: new Date(),
            voidedBy: userId,
            voidReason: trimmed,
        }).where(and(
            eq(salesLatePenalties.id, penaltyId),
            eq(salesLatePenalties.companyId, ctx.companyId),
            calendarKindScope,
        ))
    } catch (e) {
        const sessione = sessionErrorMessage(e)
        if (sessione) return { success: false, error: sessione }
        console.error('voidCalendarPenalty:', e)
        return { success: false, error: 'Annullamento non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/calendari-venditori')
    return { success: true }
}

/**
 * Esenzione dall'obbligo di calendario. Solo ADMIN (spec §7): niente multe
 * automatiche né segnalabilità di assenza per chi è esente.
 */
export async function setCalendarExempt(
    salesUserId: string,
    exempt: boolean,
): Promise<{ success: boolean; error?: string }> {
    try {
        // Sessione dentro il try, come in `voidCalendarPenalty`.
        const { role, ctx } = await requireCalendarSupervisor()
        if (role !== 'ADMIN') return { success: false, error: 'Non autorizzato.' }

        const updated = await db.update(users).set({ calendarExempt: exempt }).where(and(
            eq(users.id, salesUserId),
            eq(users.role, 'VENDITORE'),
            venditoreTenantScope(ctx),
        )).returning({ id: users.id })

        if (updated.length === 0) return { success: false, error: 'Venditore non trovato.' }
    } catch (e) {
        const sessione = sessionErrorMessage(e)
        if (sessione) return { success: false, error: sessione }
        console.error('setCalendarExempt:', e)
        return { success: false, error: 'Aggiornamento non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/calendari-venditori')
    revalidatePath('/mio-calendario')
    return { success: true }
}

export interface ForcedBooking {
    id: string
    /** Quando è avvenuta la forzatura (ISO), non l'ora dell'appuntamento. */
    at: string
    leadId: string
    leadName: string | null
    salesName: string | null
    confermaName: string | null
    /** L'ora forzata dell'appuntamento (ISO), letta da metadata.appointmentAt. */
    appointmentAt: string | null
    /** Motivo tecnico del rifiuto del muro: 'fuori_griglia' | 'non_dichiarato' | 'bloccato'. */
    reason: string | null
    /** Motivo scritto dalla Conferma per scavalcare il muro. */
    motivo: string | null
}

/**
 * Le forzature del mese (spec Task 5): ogni riga `leadEvents` con
 * `eventType = 'appointment_forced'` è una Conferma che ha scritto un
 * appuntamento fuori dal muro dichiarato dal venditore. Visibile anche a
 * CONFERME (a differenza della scheda Multe): sono loro a produrle, e
 * vederle scoraggia l'abuso della valvola "Fissa comunque".
 *
 * `leftJoin` su leads e su users: una riga di forzatura deve comparire anche
 * se il lead è stato nel frattempo cancellato o la Conferme disattivata —
 * un innerJoin la farebbe sparire in silenzio.
 */
export async function getForcedBookings(monthKey?: string): Promise<ForcedBooking[]> {
    const { ctx } = await requireCalendarSupervisor()
    const mk = monthKey || romeMonthKey(new Date())
    const { start, end } = monthBoundsRome(mk)

    const rows = await db.select({
        id: leadEvents.id,
        timestamp: leadEvents.timestamp,
        leadId: leadEvents.leadId,
        metadata: leadEvents.metadata,
        leadName: leads.name,
        confermaName: users.name,
        confermaDisplayName: users.displayName,
    })
        .from(leadEvents)
        .leftJoin(leads, eq(leadEvents.leadId, leads.id))
        .leftJoin(users, eq(leadEvents.userId, users.id))
        .where(and(
            eq(leadEvents.companyId, ctx.companyId),
            eq(leadEvents.eventType, 'appointment_forced'),
            gte(leadEvents.timestamp, start),
            lt(leadEvents.timestamp, end),
        ))
        .orderBy(desc(leadEvents.timestamp))

    // Il venditore forzato vive dentro `metadata` (jsonb), non è una FK
    // risolvibile in join: si risolve con una seconda query, sullo stesso
    // scope di appartenenza dello staff condiviso (venditoreTenantScope) —
    // stesso pattern del nome venditore altrove in questo file.
    const salesIds = new Set<string>()
    for (const r of rows) {
        const meta = r.metadata as Record<string, unknown> | null
        const sid = meta && typeof meta.salesUserId === 'string' ? meta.salesUserId : null
        if (sid) salesIds.add(sid)
    }
    const salesNameById = new Map<string, string>()
    if (salesIds.size > 0) {
        const salesRows = await db.select({
            id: users.id,
            name: users.name,
            displayName: users.displayName,
        }).from(users).where(and(
            venditoreTenantScope(ctx),
            inArray(users.id, Array.from(salesIds)),
        ))
        for (const s of salesRows) salesNameById.set(s.id, s.displayName || s.name || s.id)
    }

    // Una riga scritta male (metadata incompleto o non un oggetto) non deve
    // far esplodere la pagina: ogni campo si legge con un controllo di tipo,
    // mai un accesso diretto che rischia un undefined.metadata.
    return rows.map(r => {
        const meta = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>
        const salesUserId = typeof meta.salesUserId === 'string' ? meta.salesUserId : null
        const appointmentAtRaw = meta.appointmentAt
        const appointmentAt = typeof appointmentAtRaw === 'string'
            ? appointmentAtRaw
            : (appointmentAtRaw instanceof Date ? appointmentAtRaw.toISOString() : null)
        const reason = typeof meta.reason === 'string' ? meta.reason : null
        const motivo = typeof meta.motivo === 'string' ? meta.motivo : null

        return {
            id: r.id,
            at: r.timestamp.toISOString(),
            leadId: r.leadId,
            leadName: r.leadName,
            salesName: salesUserId ? (salesNameById.get(salesUserId) ?? null) : null,
            confermaName: r.confermaDisplayName || r.confermaName || null,
            appointmentAt,
            reason,
            motivo,
        }
    })
}
