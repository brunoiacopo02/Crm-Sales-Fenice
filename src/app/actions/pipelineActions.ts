"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, callLogs, pipelineSnapshots, users, leadEvents, botContactRequests } from "@/db/schema"
import { CONFERME_DISCARD_RESET } from "@/lib/confermeReset"
import { contaNeiKpiSql } from "@/lib/intakeBatch"
import { isRecoverableCategory } from "@/lib/bot-fissatore/contactRequests"
import { oraArrivo, eVergineDelGiorno, ordinaPrimaChiamata, type EventoLead } from "@/lib/diretta/arrivo"
import { paroleDelLead } from "@/lib/diretta/vistaGdo"
import { eLeadDelLancio } from "@/lib/diretta/instradamento"
import { dayBoundsRome } from "@/lib/dateUtils"
import { eq, and, ne, isNull, isNotNull, inArray, lt, or, lte, desc, gte, sql } from "drizzle-orm"
import crypto from "crypto"
import { determineLeadSection } from "@/lib/eventLogger"
import { subDays } from "date-fns"
import { after } from "next/server"
import { awardFissato, evaluateTeamChests, reverseFissato, riallineaScaliniDopoUscita } from "@/lib/economy/awards"
import { confermeNonHannoToccato, fissatoPremiabile, type FissatoReward } from "@/lib/economy/rules"
import { enqueueMarketingWebhook } from "@/lib/marketing-webhooks/enqueue"
import { notifyAppointmentToBot } from "@/lib/agendaBot"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { LANCIO_BUCKET } from "@/lib/lancio/intake"
import { leadDelMondoDiAccount, rifiutoMondoDiverso } from "@/lib/prova/sql"

// Controlla se il GDO ha un tasso di fissaggio < 14% negli ultimi 7 giorni
async function checkFourthCallEligibility(gdoId: string, companyId: string): Promise<boolean> {
    const sevenDaysAgo = subDays(new Date(), 7)

    const recentLogs = await db.select({
        leadId: callLogs.leadId,
        outcome: callLogs.outcome
    })
        .from(callLogs)
        .where(
            and(
                eq(callLogs.companyId, companyId),
                eq(callLogs.userId, gdoId),
                gte(callLogs.createdAt, sevenDaysAgo)
            )
        )


    if (recentLogs.length === 0) return false // Nessuna chiamata -> nessuna quarta chiamata attivata per default

    // Tasso fissaggio: Appuntamenti / Contacted Leads (dove Contacted = almeno 1 log).
    // Usiamo lo stesso approccio di KpiAdvancedActions: 
    const uniqueContacted = new Set(recentLogs.map(l => l.leadId)).size
    const appointments = recentLogs.filter(l => l.outcome === 'APPUNTAMENTO').length

    if (uniqueContacted === 0) return false

    const apptRate = Math.round((appointments / uniqueContacted) * 100)
    return apptRate < 14
}

export async function getPipelineLeads() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    const now = new Date()

    /**
     * "Ti hanno cercato": i lead con una richiesta di contatto umano ancora aperta.
     *
     * Va letta PRIMA della pipeline perché decide chi entra: fino all'11/09 un lead
     * assegnato dalla coda finiva in 2ª o 3ª chiamata (ha già il callCount del bot)
     * in fondo a un centinaio di card e senza nessun segno — e se aveva già 3
     * tentativi non compariva da nessuna parte, perché la pipeline filtra
     * `callCount < 3`, i richiami vogliono una `recallDate`, il recupero di 4ª vuole
     * `REJECTED`. La GDO riceveva la notifica e non trovava il lead: è successo a
     * 106 (Romina Viscardi, ferma dal 28/08) e a 118 (paolamelani melani).
     *
     * Decisione PO 2026-09-11: vanno in 1ª chiamata, con un badge, qualunque sia il
     * callCount. Sono poche decine, non spostano l'equilibrio della board.
     */
    const cercati = new Map<string, { category: string; reason: string }>()
    let recoverIds = new Set<string>()
    try {
        const rows = await db.select({
            leadId: botContactRequests.leadId,
            category: botContactRequests.category,
            reason: botContactRequests.reason,
        })
            .from(botContactRequests)
            .where(and(
                eq(botContactRequests.companyId, ctx.companyId),
                ne(botContactRequests.status, 'closed'),
            ))
        // Più richieste sullo stesso lead: vince la più recente (l'ordine di select
        // è quello di inserimento, quindi l'ultima scrittura sovrascrive).
        for (const r of rows) cercati.set(r.leadId, { category: r.category, reason: r.reason })
        recoverIds = new Set(rows.filter(r => isRecoverableCategory(r.category)).map(r => r.leadId))
    } catch (e) {
        console.error('[pipeline] lettura richieste contatto fallita', e)
    }
    const cercatiIds = [...cercati.keys()]

    // 1. Pipeline Calls (1, 2, 3) — tenant-scoped
    const pipelineBaseConditions = [
        eq(leads.companyId, ctx.companyId),
        // Prova (migr. 0050): l'account di prova vede solo i suoi lead di
        // prova, tutti gli altri (anche admin e manager) solo quelli veri.
        leadDelMondoDiAccount(userId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNull(leads.recallDate),
        // Chi ci ha cercato entra anche con 3+ tentativi alle spalle: è il bot ad
        // averli bruciati, e il lead ha appena chiesto che lo chiami una persona.
        cercatiIds.length
            ? or(lt(leads.callCount, 3), inArray(leads.id, cercatiIds))!
            : lt(leads.callCount, 3),
    ]
    if (isGdo) pipelineBaseConditions.push(eq(leads.assignedToId, userId))

    const pipelineLeads = await db.select()
        .from(leads)
        .where(and(...pipelineBaseConditions))
        .orderBy(desc(leads.createdAt), leads.id)  // più recenti in cima — `id` come tiebreaker per ordine stabile fra lead con stesso createdAt (es. bulk CSV import)


    // Un lead che ci ha cercato sta in 1ª chiamata qualunque sia il suo callCount:
    // è una chiamata da fare adesso, non il secondo tentativo di una sequenza.
    const firstCall = pipelineLeads.filter(l => l.callCount === 0 || cercati.has(l.id))
    const secondCall = pipelineLeads.filter(l => l.callCount === 1 && !cercati.has(l.id))
    const thirdCall = pipelineLeads.filter(l => l.callCount === 2 && !cercati.has(l.id))

    // 2ª/3ª chiamata: i lead fermi da più tempo in cima, quelli appena
    // richiamati in fondo (richiesta GDO 2026-06-11). Ordina per lastCallDate
    // crescente (mai chiamati/più vecchi prima), id come tiebreaker stabile.
    const byOldestCall = (a: { lastCallDate: Date | null; id: string }, b: { lastCallDate: Date | null; id: string }) => {
        const ta = a.lastCallDate ? new Date(a.lastCallDate).getTime() : 0
        const tb = b.lastCallDate ? new Date(b.lastCallDate).getTime() : 0
        if (ta !== tb) return ta - tb
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    }
    secondCall.sort(byOldestCall)
    thirdCall.sort(byOldestCall)

    // DIAG: capture every pipeline fetch with detail to investigate "lead spariscono"
    if (isGdo) {
        const firstCallIds = firstCall.map(l => `${l.id.slice(0,8)}/${l.launchBucket ? 'LCH' : 'std'}`).join(',')
        console.log(`[PIPE] ${new Date().toISOString()} u=${session.user.email} 1ª=${firstCall.length} (lch=${firstCall.filter(l => l.launchBucket).length}) 2ª=${secondCall.length} ids1ª=[${firstCallIds}]`)
    }

    // 2. Recalls (In arrivo & Scaduti) — tenant-scoped
    const recallBaseConditions = [
        eq(leads.companyId, ctx.companyId),
        leadDelMondoDiAccount(userId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNotNull(leads.recallDate)
    ]
    if (isGdo) recallBaseConditions.push(eq(leads.assignedToId, userId))

    const recallsLeads = await db.select()
        .from(leads)
        .where(and(...recallBaseConditions))
        .orderBy(leads.recallDate, leads.id)

    // PIPELINE SNAPSHOT: scrive un record in pipelineSnapshots ogni volta che cambia
    // la composizione delle tab per un GDO. Serve per diagnosticare "lead spariti" confrontando
    // snapshot consecutivi (vedi project_pipeline_sort_stability).
    if (isGdo) {
        try {
            const firstIds = firstCall.map(l => l.id).sort()
            const secondIds = secondCall.map(l => l.id).sort()
            const thirdIds = thirdCall.map(l => l.id).sort()
            const fingerprint = crypto.createHash('sha1')
                .update(firstIds.join(',') + '|' + secondIds.join(',') + '|' + thirdIds.join(','))
                .digest('hex')

            const lastSnap = await db.select({
                fingerprint: pipelineSnapshots.fingerprint,
                firstCallCount: pipelineSnapshots.firstCallCount,
                secondCallCount: pipelineSnapshots.secondCallCount,
                thirdCallCount: pipelineSnapshots.thirdCallCount,
            })
                .from(pipelineSnapshots)
                .where(and(
                    eq(pipelineSnapshots.companyId, ctx.companyId),
                    eq(pipelineSnapshots.userId, userId),
                ))
                .orderBy(desc(pipelineSnapshots.timestamp))
                .limit(1)

            if (!lastSnap[0] || lastSnap[0].fingerprint !== fingerprint) {
                // Le liste ID servono solo per diagnosticare i "lead spariti": le salviamo
                // esclusivamente quando una tab si restringe rispetto allo snapshot precedente.
                const shrunk = !!lastSnap[0] && (
                    firstCall.length < lastSnap[0].firstCallCount ||
                    secondCall.length < lastSnap[0].secondCallCount ||
                    thirdCall.length < lastSnap[0].thirdCallCount
                )
                await db.insert(pipelineSnapshots).values({
                    id: crypto.randomUUID(),
                    userId,
                    firstCallCount: firstCall.length,
                    secondCallCount: secondCall.length,
                    thirdCallCount: thirdCall.length,
                    recallsCount: recallsLeads.length,
                    firstCallIds: shrunk ? firstIds : [],
                    secondCallIds: shrunk ? secondIds : [],
                    thirdCallIds: shrunk ? thirdIds : [],
                    fingerprint,
                    companyId: ctx.companyId,
                })
            }
        } catch (e) {
            console.error('[pipelineSnapshot] write failed', e)
        }
    }


    // Gli appuntamenti storici non si leggono più qui (PO 25/10/2026): la home
    // non li usa, e la query portava a ogni caricamento tutti gli APPOINTMENT
    // del GDO. La pagina /appuntamenti ha le sue action.

    // 3. Fourth Call "Recupero"
    let isFourthCallActive = false
    let fourthCall: typeof recallBaseConditions[] = [] // typing alias hack per array vuoto o tipato corr.
    let fourthCallLeads: any[] = []

    if (isGdo) {
        isFourthCallActive = await checkFourthCallEligibility(userId, ctx.companyId)

        if (isFourthCallActive) {
            const thirtyDaysAgo = subDays(now, 30)

            const fourthCallConditions = [
                eq(leads.companyId, ctx.companyId),
                // Prova (migr. 0050): come la 1ª-3ª chiamata e i richiami.
                leadDelMondoDiAccount(userId),
                eq(leads.status, 'REJECTED'),
                eq(leads.callCount, 3),
                // Il refuso storico "irriperebile" è stato corretto in "irreperibile"
                // (pipelineActions.ts, auto-scarto NON_RISPOSTO), ma i lead scartati
                // prima del fix restano nel DB con la vecchia grafia: matchiamo entrambe,
                // altrimenti la "quarta chiamata" smette di trovare candidati.
                or(
                    eq(leads.discardReason, "irreperibile (3 tentativi vuoti)"),
                    eq(leads.discardReason, "irriperebile (3 tentativi vuoti)"),
                ),
                gte(leads.updatedAt, thirtyDaysAgo)
            ]
            if (isGdo) fourthCallConditions.push(eq(leads.assignedToId, userId))

            fourthCallLeads = (await db.select()
                .from(leads)
                .where(and(...fourthCallConditions))
                .orderBy(desc(leads.updatedAt)))
                // I lead del lancio sono tolti ai GDO (PO 24-25/10/2026), anche
                // quelli scartati che il recupero rimetterebbe in board.
                .filter(l => !eLeadDelLancio(l))

        }
    }

    // Detector duplicati telefono (non bloccante): numeri normalizzati alle
    // ultime 10 cifre presenti su più lead della company. Dieci e non nove: a
    // nove si fondono 134 gruppi di numeri realmente diversi (6.565 gruppi a 9
    // cifre contro 6.459 a 10). Le card mostrano un badge; il dettaglio si
    // carica on-demand con getLeadsWithSamePhone().
    //
    // Per il GDO (PO 25/10/2026) si guardano solo i numeri dei lead che ha in
    // board: il badge non cambia, perché il conteggio resta su tutta la company
    // (un collega che ha lo stesso numero fa duplicato come prima), ma la query
    // passa dall'indice leads_company_phonekey_idx invece di raggruppare tutta
    // la tabella a ogni caricamento (misurato: ~240 ms e 94k buffer contro pochi ms).
    const phoneKey = (p: string | null) => (p || '').replace(/\D/g, '').slice(-10)
    let dupPhoneKeys = new Set<string>()
    try {
        const phoneKeyExpr = sql<string>`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10)`
        // Gli scarti di un'infornata anomala non fanno duplicato: sono copie
        // tecniche dello stesso numero, non due persone che ci hanno lasciato i
        // dati due volte. Il flood del 15/09/2026 ha acceso il badge su 6.811
        // lead legittimi — 1.645 ancora aperti e 902 con un appuntamento — e un
        // GDO che vede "duplicato" su una card buona ci perde tempo, o peggio la scarta.
        const contaDuplicati = (numeri?: string[]) => db.select({ key: phoneKeyExpr })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                contaNeiKpiSql(),
                numeri ? inArray(phoneKeyExpr, numeri) : undefined,
            ))
            .groupBy(phoneKeyExpr)
            .having(sql`count(*) > 1`)

        if (isGdo) {
            const numeri = [...new Set([...pipelineLeads, ...recallsLeads].map(l => phoneKey(l.phone)))]
                .filter(k => k.length >= 6)
            for (let i = 0; i < numeri.length; i += 1000) {
                for (const r of await contaDuplicati(numeri.slice(i, i + 1000))) {
                    if (r.key) dupPhoneKeys.add(r.key)
                }
            }
        } else {
            const dupRows = await contaDuplicati()
            dupPhoneKeys = new Set(dupRows.map(r => r.key).filter(k => !!k && k.length >= 6))
        }
    } catch (e) {
        console.error('[dupPhones] detection failed', e)
    }

    // Ridati dal bot con chat interrotta (PO 19/10/2026): la persona ha parlato col
    // bot e poi si e' fermata. Sono i ridati che rendono, e con tre GDO presenti vanno
    // chiamati per primi: stella sulla card e cima di ogni tab. Conta l'ULTIMA
    // restituzione del lead, come nel resto del codice sui ridati.
    //
    // La stessa lettura dà anche l'ora di arrivo vera e i vergini del giorno (PO
    // 25/10/2026): oltre ai ritorni dal bot porta gli assegnamenti (ASSIGNED,
    // REASSIGNED_ADMIN) e i passaggi al bot (BOT_PUSHED), in una query sola.
    const chatInterrotta = new Set<string>()
    const eventiAssegnazione = new Map<string, EventoLead[]>()
    const ridatiDalBot = new Set<string>()
    const passatiDalBot = new Set<string>()
    try {
        // Solo per la board di un GDO: la vista admin prende i lead di tutta la
        // company e leggerne gli eventi a ogni caricamento costerebbe troppo.
        const candidati = isGdo ? pipelineLeads.map(l => l.id) : []
        const ultimoMotivo = new Map<string, string | null>()
        for (let i = 0; i < candidati.length; i += 1000) {
            const rows = await db.select({
                leadId: leadEvents.leadId,
                eventType: leadEvents.eventType,
                userId: leadEvents.userId,
                timestamp: leadEvents.timestamp,
                reason: sql<string | null>`${leadEvents.metadata}->>'reason'`,
                toAssigneeId: sql<string | null>`${leadEvents.metadata}->>'toAssigneeId'`,
                assignedToUser: sql<string | null>`${leadEvents.metadata}->>'assignedToUser'`,
            })
                .from(leadEvents)
                .where(and(
                    inArray(leadEvents.eventType, ['REASSIGNED_FROM_BOT', 'REASSIGNED_ADMIN', 'ASSIGNED', 'BOT_PUSHED']),
                    inArray(leadEvents.leadId, candidati.slice(i, i + 1000)),
                ))
                .orderBy(desc(leadEvents.timestamp))
            for (const r of rows) {
                if (r.eventType === 'BOT_PUSHED') { passatiDalBot.add(r.leadId); continue }
                if (r.eventType === 'REASSIGNED_FROM_BOT') {
                    ridatiDalBot.add(r.leadId)
                    if (!ultimoMotivo.has(r.leadId)) ultimoMotivo.set(r.leadId, r.reason)
                }
                const lista = eventiAssegnazione.get(r.leadId)
                if (lista) lista.push(r)
                else eventiAssegnazione.set(r.leadId, [r])
            }
        }
        // La stella resta sui soli lead fuori dai pool, come prima del 25/10.
        const fuoriDaiPool = new Set(pipelineLeads.filter(l => !l.launchBucket).map(l => l.id))
        for (const [id, reason] of ultimoMotivo) if (reason === 'chat_interrotta' && fuoriDaiPool.has(id)) chatInterrotta.add(id)
    } catch (e) {
        console.error('[pipeline] lettura eventi di assegnazione fallita', e)
    }

    // Lead tornati dal bot con un sì già dato (aveva confermato e l'appuntamento non
    // è mai nato, oppure ha risposto dopo il 3° NR) e, più in generale, chi ha chiesto
    // di parlare con una persona: `cercati` e `recoverIds` sono letti in cima, prima
    // della query di pipeline, perché decidono anche chi entra in board.
    //
    // Del "ti ha cercato" al GDO arrivano solo le parole del lead (PO 25/10/2026):
    // il motivo scritto dal bot e la categoria ("non si fida della chat") restano
    // fuori dalle schermate GDO.
    const withDupFlag = <T extends { phone: string; id: string }>(arr: T[]) =>
        arr.map(l => ({
            ...l,
            duplicatePhone: dupPhoneKeys.has(phoneKey(l.phone)),
            confermatoAlBot: recoverIds.has(l.id),
            chiamaPerPrimo: chatInterrotta.has(l.id),
            tiHaCercato: cercati.has(l.id),
            cercatoMotivo: paroleDelLead(cercati.get(l.id)?.reason),
        }))

    // Ora di arrivo vera (ultima assegnazione al proprietario attuale) e
    // vergini del giorno, per le tab della pipeline. "Arrivato X fa" lo
    // calcola la card nel browser: qui c'è solo l'istante.
    const inizioOggi = dayBoundsRome(now).start
    type PerArrivo = {
        id: string; status: string; callCount: number; source: string | null; launchBucket: string | null
        assignedToId: string | null; assignedAt: Date | null; createdAt: Date; tiHaCercato: boolean
    }
    const withArrivo = <T extends PerArrivo>(arr: T[]) =>
        arr.map(l => ({
            ...l,
            arrivedAt: oraArrivo({
                eventi: eventiAssegnazione.get(l.id) ?? [],
                proprietario: l.assignedToId,
                assignedAt: l.assignedAt,
                createdAt: l.createdAt,
            }),
            vergine: isGdo && eVergineDelGiorno({
                ...l,
                ridatoDalBot: ridatiDalBot.has(l.id),
                passatoDalBot: passatiDalBot.has(l.id),
            }, inizioOggi),
        }))

    /**
     * Chi ci ha cercato va chiamato per primo, e subito dopo chi aveva già detto sì:
     * è l'unico ordinamento in cui la marcatura serve davvero a qualcosa. Dentro i
     * gruppi l'ordine preesistente resta identico — `sort` in JS è stabile, quindi
     * non tocca il tiebreaker su `id` che tiene ferme le card fra un caricamento e
     * l'altro (fix del 14/05: senza, i GDO vedevano "sparire" i lead).
     */
    const urgentRank = (l: { tiHaCercato: boolean; confermatoAlBot: boolean }) =>
        (l.tiHaCercato ? 2 : 0) + (l.confermatoAlBot ? 1 : 0)
    const recoverableFirst = <T extends { tiHaCercato: boolean; confermatoAlBot: boolean }>(arr: T[]) =>
        [...arr].sort((a, b) => urgentRank(b) - urgentRank(a))
    // Lancio Web Dev (PO 07/10/2026): nella 1ª e nella 2ª chiamata i lead del lancio
    // stanno sempre in cima, sopra anche i "ti ha cercato" degli altri funnel. Dentro
    // ciascun gruppo restano l'ordine urgente e quello di prima (sort stabile).
    // Sopra tutti, i lead del test "solo umani" (106 e 119): sono i più caldi della live.
    // Dal 19/10/2026 (PO) sopra anche a quelli, i ridati con chat interrotta (stella).
    type PerRank = { launchBucket: string | null; humanTestCohort: string | null; tiHaCercato: boolean; confermatoAlBot: boolean; chiamaPerPrimo: boolean }
    const lancioRank = (l: PerRank) =>
        (l.chiamaPerPrimo ? 16 : 0) + (l.humanTestCohort ? 8 : 0) + (l.launchBucket === LANCIO_BUCKET ? 4 : 0) + urgentRank(l)
    const lancioOnTop = <T extends PerRank>(arr: T[]) =>
        [...arr].sort((a, b) => lancioRank(b) - lancioRank(a))
    const starredFirst = <T extends PerRank>(arr: T[]) =>
        [...arr].sort((a, b) => (Number(b.chiamaPerPrimo) * 4 + urgentRank(b)) - (Number(a.chiamaPerPrimo) * 4 + urgentRank(a)))

    return {
        // 1ª chiamata (PO 25/10/2026): vergini del giorno in cima appena arrivano,
        // poi le priorità di prima, poi l'ora di arrivo più recente, `id` come spareggio.
        firstCall: ordinaPrimaChiamata(withArrivo(withDupFlag(firstCall)), lancioRank),
        secondCall: lancioOnTop(withArrivo(withDupFlag(secondCall))),
        thirdCall: starredFirst(withArrivo(withDupFlag(thirdCall))),
        fourthCall: fourthCallLeads,
        isFourthCallActive,
        recalls: recoverableFirst(withDupFlag(recallsLeads)),
    }
}

/**
 * Dettaglio duplicati: tutti gli ALTRI lead della company con lo stesso numero
 * (normalizzato alle ultime 10 cifre) del lead dato. Mostra chi li ha in carico,
 * l'ultimo esito e le date — così il GDO evita di richiamare numeri già gestiti
 * da un collega. Sola lettura, non bloccante.
 */
export async function getLeadsWithSamePhone(leadId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    // Prova (migr. 0050): un lead dell'altra parte non esiste per chi guarda,
    // e i duplicati mostrati sono solo quelli della sua parte.
    const [target] = await db.select({ id: leads.id, phone: leads.phone })
        .from(leads)
        .where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId), leadDelMondoDiAccount(ctx.userId)))
        .limit(1)
    if (!target) return { success: false as const, error: 'Lead non trovato' }

    const key = (target.phone || '').replace(/\D/g, '').slice(-10)
    if (key.length < 6) return { success: true as const, duplicates: [] }

    const phoneKeyExpr = sql<string>`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10)`
    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        funnel: leads.funnel,
        status: leads.status,
        callCount: leads.callCount,
        lastCallDate: leads.lastCallDate,
        recallDate: leads.recallDate,
        appointmentDate: leads.appointmentDate,
        salespersonOutcome: leads.salespersonOutcome,
        discardReason: leads.discardReason,
        assignedToName: users.displayName,
        assignedToRealName: users.name,
        assignedToFirstName: users.firstName,
        assignedToIsBot: users.isBot,
    })
        .from(leads)
        .leftJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            ne(leads.id, leadId),
            leadDelMondoDiAccount(ctx.userId),
            sql`${phoneKeyExpr} = ${key}`,
            // Coerente con il badge "duplicato" di getPipelineLeads: le copie
            // tecniche di un'infornata anomala non sono un collega che ha già
            // in mano quel numero, e non vanno mostrate come tali.
            contaNeiKpiSql(),
        ))
        .orderBy(desc(leads.updatedAt))
        .limit(10)

    // Al GDO un numero in mano al bot si mostra come "In lavorazione", senza
    // nome (PO 25/10/2026). Admin e manager vedono l'assegnatario come prima.
    const perGdo = ctx.role === 'GDO'
    return {
        success: true as const,
        duplicates: rows.map(r => {
            const inLavorazione = perGdo && r.assignedToIsBot === true
            return {
                id: r.id,
                name: r.name,
                funnel: r.funnel,
                status: r.status,
                callCount: r.callCount,
                lastCallDate: r.lastCallDate ? r.lastCallDate.toISOString() : null,
                recallDate: r.recallDate ? r.recallDate.toISOString() : null,
                appointmentDate: r.appointmentDate ? r.appointmentDate.toISOString() : null,
                salespersonOutcome: r.salespersonOutcome,
                discardReason: r.discardReason,
                // Nome vero del collega (firstName) prima del codice "GDO 1xx" (PO 25/10/2026).
                assignedToName: inLavorazione ? null : (r.assignedToFirstName?.trim() || r.assignedToRealName || r.assignedToName || 'Non assegnato'),
                inLavorazione,
            }
        }),
    }
}

export async function updateLeadOutcome(
    leadId: string,
    outcome: 'DA_SCARTARE' | 'NON_RISPOSTO' | 'RICHIAMO' | 'APPUNTAMENTO',
    note: string,
    date?: Date, // recallDate or appointmentDate
    userId?: string,
    discardReason?: string, // New field
    currentVersion?: number, // Optimistic locking
    scriptCompleted?: boolean, // Script tracking
    serviceCtx?: { companyId: string; actorUserId: string; isBot: boolean } // Bot/service-account bypass
) {

    let ctx: { companyId: string }
    let effectiveUserId: string | undefined
    let isBotActor = false
    let actorRole: string | undefined
    let sessionUserId: string | undefined

    if (serviceCtx) {
        // Service account (bot fissatore): nessuna sessione Supabase, tenant esplicito.
        ctx = { companyId: serviceCtx.companyId }
        effectiveUserId = serviceCtx.actorUserId
        isBotActor = serviceCtx.isBot
        actorRole = 'GDO'   // il bot e' un account GDO mascherato: il ramo e' gia' gestito da isBotActor
    } else {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        sessionUserId = session?.user?.id
        effectiveUserId = userId || sessionUserId

        const tenant = await currentTenant()
        assertSalesArea(tenant)
        ctx = { companyId: tenant.companyId }
        // Il ruolo si legge da `currentTenant`, non da `user_metadata` in
        // diretta: currentTenant applica `meta.role ?? 'GDO'`, che e' la
        // convenzione di tutto il CRM. Letto crudo, un GDO con i metadata
        // incompleti risulterebbe senza ruolo e smetterebbe in silenzio di
        // guadagnare le Scintille del fissato.
        actorRole = tenant.role
    }

    // Un appuntamento del venditore DEVE nascere da `setSalesSelfAppointment`:
    // e' l'unico punto che scrive la sentinella `autofissato`, ed e' quella a
    // tenerlo fuori dal giro Conferme, dai KPI dei GDO e dai webhook di
    // conferma. Passando di qui nascerebbe un appuntamento senza sentinella,
    // indistinguibile da uno dei GDO.
    //
    // La guardia e' "rifiuta il VENDITORE", non "consenti solo il GDO", ed e'
    // deliberato: questa funzione e' raggiungibile da piu' ruoli di quanti
    // sembri. In `Topbar.tsx` il gate sul ruolo copre solo la casella di
    // ricerca (`:201`), mentre la `<ContactDrawer>` e' montata fuori (`:393`) e
    // si apre anche dal click su una notifica, che arriva anche alle Conferme;
    // e `/richiami` e' aperta a GDO, ADMIN, MANAGER e TL, con la `OutcomeModal`
    // che offre "Appuntamento". Un gate GDO-only toglierebbe la capacita' di
    // fissare a quattro ruoli che ce l'hanno, e la toglierebbe in silenzio.
    // Gli altri esiti (richiamo, non risposto, scarto) restano liberi anche al
    // venditore: li registra dalla sua board.
    if (!serviceCtx && outcome === 'APPUNTAMENTO' && actorRole === 'VENDITORE') {
        return {
            success: false,
            error: "Un venditore non fissa l'appuntamento da qui: si fissa dalla tua pipeline (/mia-pipeline), che e' l'unico punto che lo marca come autofissato e lo tiene fuori dal giro delle Conferme.",
        }
    }

    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
    )))[0]
    if (!lead) throw new Error("Lead non trovato")

    // Prova (migr. 0050): un account di prova esita solo lead di prova, e
    // nessun altro (GDO, bot, admin) esita un lead di prova. Conta chi è in
    // sessione, non lo `userId` passato dal client.
    const rifiuto = await rifiutoMondoDiverso(lead, serviceCtx ? serviceCtx.actorUserId : sessionUserId)
    if (rifiuto) return { success: false, error: rifiuto }

    // Optimistic locking check
    if (currentVersion !== undefined && lead.version !== currentVersion) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    const fromSection = determineLeadSection(lead)

    const now = new Date()
    let newCallCount = lead.callCount + 1 // INCREMENTO ASSOLUTO PER OGNI OUTCOME
    let newStatus = lead.status
    let recallDate: Date | null = null
    let appointmentDate: Date | null = null
    let appointmentCreatedAt: Date | null = null

    // Create Call Log (tenant-scoped)
    await db.insert(callLogs).values({
        id: crypto.randomUUID(),
        leadId,
        userId: effectiveUserId || null,
        outcome,
        note,
        discardReason: discardReason || null,
        scriptCompleted: scriptCompleted || false,
        createdAt: now,
        companyId: ctx.companyId,
    })

    if (outcome === 'DA_SCARTARE') {
        newStatus = 'REJECTED'
    }
    else if (outcome === 'NON_RISPOSTO') {
        if (newCallCount >= 4) {
            newStatus = 'REJECTED'
            discardReason = "irreperibile (4 tentativi vuoti)"
        } else if (newCallCount === 3) {
            newStatus = 'REJECTED'
            discardReason = "irreperibile (3 tentativi vuoti)"
        } else {
            newStatus = 'IN_PROGRESS'
        }
    }
    else if (outcome === 'RICHIAMO') {
        newStatus = 'IN_PROGRESS'
        recallDate = date || null
    }
    else if (outcome === 'APPUNTAMENTO') {
        newStatus = 'APPOINTMENT'
        appointmentDate = date || null
        appointmentCreatedAt = now
    }

    // Compute recallNote: preserve original recall note unless this outcome is RICHIAMO (then update it)
    // Clear it only when the lead transitions to a state without a recall (REJECTED, APPOINTMENT)
    let newRecallNote = lead.recallNote
    if (outcome === 'RICHIAMO') {
        newRecallNote = note || null
    } else if (outcome === 'DA_SCARTARE' || outcome === 'APPUNTAMENTO') {
        newRecallNote = null
    }

    // Badge "richiamo non risposto": NR su un lead che aveva un richiamo
    // programmato → marca recallMissedAt. Nuovo richiamo o uscita dalla
    // pipeline lo azzerano.
    let newRecallMissedAt = lead.recallMissedAt
    if (outcome === 'NON_RISPOSTO' && lead.recallDate) {
        newRecallMissedAt = now
    } else if (outcome === 'RICHIAMO' || outcome === 'DA_SCARTARE' || outcome === 'APPUNTAMENTO') {
        newRecallMissedAt = null
    }

    // Nuovo appuntamento su un lead scartato dalle Conferme: lo scarto
    // precedente viene azzerato (altrimenti resta nella lista scarti) e il
    // ciclo NR Conferme riparte da zero. Se invece era solo parcheggiato o
    // snoozato, risolve parcheggio/snooze (QA Conferme 2026-06-12).
    const confermeReset = outcome === 'APPUNTAMENTO'
        ? (lead.confirmationsOutcome === 'scartato'
            ? CONFERME_DISCARD_RESET
            : (lead.confNeedsReschedule || lead.confSnoozeAt
                ? { confNeedsReschedule: false as const, confSnoozeAt: null }
                : {}))
        : {}

    // Update lead record (atomic version check in WHERE prevents TOCTOU race)
    const updated = await db.update(leads)
        .set({
            ...confermeReset,
            status: newStatus,
            callCount: newCallCount,
            lastCallDate: now,
            lastCallNote: note,
            recallNote: newRecallNote,
            recallMissedAt: newRecallMissedAt,
            recallDate,
            appointmentDate,
            appointmentNote: outcome === 'APPUNTAMENTO' ? note : lead.appointmentNote,
            appointmentCreatedAt,
            discardReason: discardReason || lead.discardReason,
            version: lead.version + 1,
            updatedAt: now,
        })
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, lead.version),
        ))
        .returning({ id: leads.id })

    if (updated.length === 0) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    // Nuova economia (PO 25/10/2026). Le vecchie ricompense (forzieri a
    // progressi, boss, avventura, creature, duelli, loot, obiettivi di squadra,
    // XP e monete) non si chiamano più: walletCoins resta congelato com'è.
    // Le Scintille vanno solo al GDO della squadra che ha fissato di persona:
    // niente bot (201) né IA vocale (108), che passano dal serviceCtx e non
    // hanno comunque un nome in squadra; niente premi se il client ha passato
    // un `userId` diverso da chi è in sessione; niente per le chiamate grezze.
    const premiabile = fissatoPremiabile({
        serviceCtx: !!serviceCtx, isBot: isBotActor, actorRole, sessionUserId, effectiveUserId,
    })
    let rewardData: FissatoReward | null = null

    if (outcome === 'APPUNTAMENTO') {
        // Traccia il reset dello scarto Conferme nella timeline del lead.
        if (lead.confirmationsOutcome === 'scartato') {
            try {
                await db.insert(leadEvents).values({
                    id: crypto.randomUUID(),
                    leadId,
                    eventType: 'conferme_scarto_reset',
                    userId: effectiveUserId || null,
                    timestamp: now,
                    metadata: {
                        previousDiscardReason: lead.confirmationsDiscardReason,
                        trigger: 'gdo_new_appointment',
                    },
                    companyId: ctx.companyId,
                })
            } catch (e) {
                console.error("conferme_scarto_reset event err:", e)
            }
        }

        // Marketing webhook: notify external CRM that an appointment was set
        await enqueueMarketingWebhook({
            eventType: 'appointment.set',
            leadId,
            actorUserId: effectiveUserId ?? null,
        }).catch((e: unknown) => console.error("Marketing webhook (appointment.set) err:", e));

        // Bot: data e ora dell'appuntamento, che quando è partita l'agenda non
        // esistevano ancora. Saltato se a fissare è il bot stesso — quella data
        // ce l'ha appena mandata lui.
        if (!isBotActor) {
            await notifyAppointmentToBot({
                lead: { id: leadId, phone: lead.phone, name: lead.name, funnel: lead.funnel, companyId: ctx.companyId },
                appointmentAt: appointmentDate,
                trigger: 'fissato',
            });
        }

        // Scintille del fissato e scalini personali: stanno nella risposta, la
        // UI le mostra subito. Restituisce null per chi non è in squadra.
        // I forzieri di squadra si valutano dopo la risposta, senza rallentarla.
        if (premiabile && sessionUserId) {
            rewardData = await awardFissato({ userId: sessionUserId, leadId, companyId: ctx.companyId, at: now })
                .catch((e: unknown) => { console.error("Economia fissato err:", e); return null })
            if (rewardData) {
                const companyId = ctx.companyId
                const valutaForzieri = () => evaluateTeamChests({ companyId, at: now })
                    .catch((e: unknown) => console.error("Economia forzieri err:", e))
                try {
                    after(valutaForzieri)
                } catch {
                    await valutaForzieri()
                }
            }
        }
    } else if (lead.status === 'APPOINTMENT') {
        // Appuntamento tolto con un altro esito prima che le Conferme lo
        // vedessero: le Scintille del fissato tornano indietro, così fissare e
        // togliere subito non rende niente. Se poi lo rifissa, il lead paga di
        // nuovo una volta sola. Il ciclo da stornare si ricostruisce dalla
        // storia del lead (callLog ed eventi prima di questo esito), non da
        // appointmentCreatedAt, che un rifissaggio riscrive.
        if (!isBotActor && confermeNonHannoToccato(lead)) {
            await reverseFissato(lead, now, 'appuntamento tolto con un altro esito')
                .catch((e: unknown) => console.error("Economia storno fissato err:", e))
        }
        // Il lead non è più in appuntamento: per chi l'aveva fissato oggi è un
        // fissato valido in meno, e gli scalini sopra il nuovo conteggio si stornano.
        await riallineaScaliniDopoUscita(leadId, ctx.companyId, now)
            .catch((e: unknown) => console.error("Economia scalini dopo uscita err:", e))
    }

    // Marketing: il lead e' morto qui. Copre i tre casi che passano da questa
    // funzione — scarto a mano del GDO, auto-scarto al terzo/quarto tentativo
    // vuoto, e scarto del bot, che richiama updateLeadOutcome con serviceCtx.
    // Guardia sulla causale, non sullo stato: updateLeadOutcome non blocca mai
    // un esito su un lead già REJECTED (vedi la "quarta chiamata" abilitata da
    // checkFourthCallEligibility, in cima a questo file) — un lead
    // auto-scartato al 3° NON_RISPOSTO
    // può essere recuperato dal GDO ed esitato DA_SCARTARE con la causale
    // vera (es. "non ha soldi"). Quello è un evento nuovo e deve partire.
    // Va soppresso solo il caso che la guardia originale proteggeva: il bot
    // che ri-manda lo stesso identico esito con la stessa causale (es. senza
    // lock ottimistico). Confrontiamo quindi la causale che sta per essere
    // scritta sul lead (discardReason, eventualmente già riassegnata sopra
    // nel ramo NON_RISPOSTO) con quella già presente sul lead PRIMA di questo
    // update (lead.discardReason, il valore letto a inizio funzione).
    const nextDiscardReason = discardReason || lead.discardReason
    const isRejectionNews = lead.status !== 'REJECTED' || nextDiscardReason !== lead.discardReason
    if (newStatus === 'REJECTED' && isRejectionNews && (outcome === 'DA_SCARTARE' || outcome === 'NON_RISPOSTO')) {
        await enqueueMarketingWebhook({
            eventType: 'lead.rejected',
            leadId,
            actorUserId: effectiveUserId ?? null,
            rejection: {
                stage: 'GDO',
                automatic: outcome === 'NON_RISPOSTO',
                byBot: isBotActor,
            },
        }).catch((e: unknown) => console.error("Marketing webhook (lead.rejected GDO) err:", e));
    }

    return { success: true, rewardData }
}
