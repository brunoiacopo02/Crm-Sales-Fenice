// Scorta delle prime chiamate (PO 29/10/2026): letture e scritture sul DB.
// Le regole sono in scorta.ts (pure, testate); qui solo il collegamento.
//
// Chi lo usa:
//  - getPipelineLeads (pipelineActions): classifica gli arrivi e, se il GDO non
//    ha più niente da chiamare in prima chiamata, sblocca;
//  - updateLeadOutcome (pipelineActions): dopo un esito su una prima chiamata
//    registra il consumo e sblocca se il GDO è rimasto a zero;
//  - il monitor di /import (scortaActions) e lo script di accensione
//    (scripts/diretta/scorta-prima-assegnazione.ts).
//
// Scrive SOLO scortaStato/scortaDal dei lead e la tabella dei movimenti: mai
// assegnatario, stato, tentativi, updatedAt o version. Così nessun conteggio
// della distribuzione, nessun KPI e nessun lock ottimistico se ne accorge, e
// il feed del bot (cursore su updatedAt) non vede niente.

import crypto from 'crypto'
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { botContactRequests, gdoScortaMovimenti, leadEvents, leads, users } from '@/db/schema'
import { leadDelMondoDiAccount } from '@/lib/prova/sql'
import {
    classificaArrivi, daSbloccare, applicaScritti, datiDaEventi, eVergine, primaAssegnazione, primiDellaScorta,
    SBLOCCO, VISIBILI_INIZIALI, type EventoScorta, type LeadScorta,
} from './scorta'


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Esecutore = typeof db | Tx

// 'sblocco_manuale': sblocco chiesto dall'admin dal monitor di /import. La
// tabella dei movimenti non ha una colonna per le note (e la migrazione 0059 è
// già in prod): il tipo stesso è la nota. Il monitor lo conta come uno sblocco.
export type TipoMovimento = 'iniziale' | 'iniziale_scorta' | 'nascosti' | 'sblocco' | 'sblocco_manuale' | 'consumato' | 'vergini' | 'caldi' | 'spenta'

const LOTTO = 1000
function lotti<T>(lista: readonly T[], n = LOTTO): T[][] {
    const out: T[][] = []
    for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n))
    return out
}

/** La scorta è accesa per questo GDO? (false se l'utente non esiste). */
export async function scortaAccesa(userId: string, ex: Esecutore = db): Promise<boolean> {
    const [u] = await ex.select({ on: users.scortaAttiva }).from(users).where(eq(users.id, userId)).limit(1)
    return !!u?.on
}

/**
 * I lead in PRIMA CHIAMATA del GDO, con tutto quello che serve alle regole.
 * Stesso perimetro di getPipelineLeads: assegnati a lui, né scartati né in
 * appuntamento, senza richiamo, mai chiamati oppure con un "Ti ha cercato" aperto.
 */
export async function leggiPrimeChiamate(
    companyId: string, userId: string, ex: Esecutore = db,
    // Solo per la prova a vuoto dello script di accensione su un DB senza la
    // migrazione 0059: le colonne della scorta non si leggono (tutto null).
    opzioni: { senzaColonneScorta?: boolean } = {},
): Promise<LeadScorta[]> {
    const richieste = await ex.select({ leadId: botContactRequests.leadId })
        .from(botContactRequests)
        .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
        .where(and(
            eq(botContactRequests.companyId, companyId),
            ne(botContactRequests.status, 'closed'),
            eq(leads.assignedToId, userId),
        ))
    const cercati = new Set(richieste.map(r => r.leadId))

    const righe = await ex.select({
        id: leads.id, status: leads.status, callCount: leads.callCount, source: leads.source,
        launchBucket: leads.launchBucket, funnel: leads.funnel, createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
        scortaStato: opzioni.senzaColonneScorta ? sql<string | null>`null::text` : leads.scortaStato,
        scortaDal: opzioni.senzaColonneScorta ? sql<Date | null>`null::timestamptz` : leads.scortaDal,
        assignedAt: leads.assignedAt,
    }).from(leads).where(and(
        eq(leads.companyId, companyId),
        leadDelMondoDiAccount(userId),
        eq(leads.assignedToId, userId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNull(leads.recallDate),
        cercati.size ? or(eq(leads.callCount, 0), inArray(leads.id, [...cercati]))! : eq(leads.callCount, 0),
    ))

    const eventi = new Map<string, EventoScorta[]>()
    for (const blocco of lotti(righe.map(r => r.id))) {
        const rows = await ex.select({
            leadId: leadEvents.leadId,
            eventType: leadEvents.eventType,
            userId: leadEvents.userId,
            timestamp: leadEvents.timestamp,
            reason: sql<string | null>`${leadEvents.metadata}->>'reason'`,
            instradato: sql<string | null>`${leadEvents.metadata}->>'instradato'`,
            toAssigneeId: sql<string | null>`${leadEvents.metadata}->>'toAssigneeId'`,
            assignedToUser: sql<string | null>`${leadEvents.metadata}->>'assignedToUser'`,
        }).from(leadEvents).where(and(
            inArray(leadEvents.eventType, ['REASSIGNED_FROM_BOT', 'REASSIGNED_ADMIN', 'ASSIGNED', 'BOT_PUSHED']),
            inArray(leadEvents.leadId, blocco),
        ))
        for (const r of rows) {
            const l = eventi.get(r.leadId)
            if (l) l.push(r)
            else eventi.set(r.leadId, [r])
        }
    }

    return righe.map(r => ({
        id: r.id,
        status: r.status,
        callCount: r.callCount,
        source: r.source,
        launchBucket: r.launchBucket,
        funnel: r.funnel,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        scortaStato: r.scortaStato,
        scortaDal: r.scortaDal,
        cercato: cercati.has(r.id),
        ...datiDaEventi(eventi.get(r.id) ?? [], userId, r.assignedAt, r.createdAt),
    }))
}

async function registra(ex: Esecutore, companyId: string, userId: string, tipo: TipoMovimento, leadIds: string[], quando: Date) {
    if (leadIds.length === 0) return
    await ex.insert(gdoScortaMovimenti).values({
        id: crypto.randomUUID(), companyId, userId, tipo, quanti: leadIds.length, leadIds, createdAt: quando,
    })
}

/**
 * Scrive scortaStato su lead ancora del GDO. La condizione sullo stato di
 * partenza rende la scrittura atomica: due caricamenti che classificano gli
 * stessi arrivi insieme scrivono una volta sola, e il movimento conta solo le
 * righe scritte davvero. Restituisce gli id scritti.
 */
async function scriviStato(ex: Esecutore, userId: string, ids: string[], stato: 'visibile' | 'scorta', da: 'null' | 'scorta' | 'qualunque', quando: Date): Promise<string[]> {
    const scritti: string[] = []
    for (const blocco of lotti(ids, 300)) {
        const condStato = da === 'null' ? isNull(leads.scortaStato)
            : da === 'scorta' ? eq(leads.scortaStato, 'scorta')
                : undefined
        const res = await ex.update(leads)
            .set({ scortaStato: stato, scortaDal: stato === 'scorta' ? quando : null })
            .where(and(inArray(leads.id, blocco), eq(leads.assignedToId, userId), condStato))
            .returning({ id: leads.id })
        for (const r of res) scritti.push(r.id)
    }
    return scritti
}

/**
 * Classifica gli arrivi da classificare (scortaStato null) e li scrive:
 * vergini, stelle e "Ti ha cercato" visibili, il resto in fondo alla scorta.
 * Restituisce gli id scritti per stato, per aggiornare la lista in memoria.
 */
export async function classificaEScrivi(companyId: string, userId: string, lista: readonly LeadScorta[], ora: Date, ex: Esecutore = db): Promise<{ visibili: string[]; scorta: string[] }> {
    const { visibili, scorta } = classificaArrivi(lista, ora)
    if (visibili.length === 0 && scorta.length === 0) return { visibili: [], scorta: [] }
    const scrittiV = await scriviStato(ex, userId, visibili, 'visibile', 'null', ora)
    const scrittiS = await scriviStato(ex, userId, scorta, 'scorta', 'null', ora)
    const perId = new Map(lista.map(l => [l.id, l]))
    const vergini = scrittiV.filter(id => { const l = perId.get(id); return !!l && eVergine(l, ora) })
    const caldi = scrittiV.filter(id => !vergini.includes(id))
    await registra(ex, companyId, userId, 'vergini', vergini, ora)
    await registra(ex, companyId, userId, 'caldi', caldi, ora)
    await registra(ex, companyId, userId, 'nascosti', scrittiS, ora)
    return { visibili: scrittiV, scorta: scrittiS }
}

/**
 * Sblocco idempotente: se il GDO non ha più niente da chiamare in prima
 * chiamata, i primi 30 della scorta tornano visibili.
 *
 * Due richieste insieme (il caricamento della pipeline e l'esito appena dato,
 * o due schede aperte) non devono sbloccarne 60: tutto avviene in una
 * transazione che prende un lock consultivo per GDO
 * (pg_advisory_xact_lock), rilegge i lead DENTRO il lock, riclassifica gli
 * arrivi e decide. Chi arriva secondo aspetta, rilegge, trova i 30 già
 * visibili e non fa niente. L'UPDATE vale solo per lead ancora 'scorta'.
 *
 * Restituisce gli id sbloccati (vuoto = non serviva o scorta finita).
 */
export async function sbloccaSeVuota(companyId: string, userId: string, ora: Date = new Date()): Promise<string[]> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'scorta:' + userId}))`)
        if (!(await scortaAccesa(userId, tx))) return []
        const lista = await leggiPrimeChiamate(companyId, userId, tx)
        const scritti = await classificaEScrivi(companyId, userId, lista, ora, tx)
        const dopo = applicaScritti(lista, scritti)
        const ids = daSbloccare(dopo, ora, SBLOCCO)
        if (ids.length === 0) return []
        const sbloccati = await scriviStato(tx, userId, ids, 'visibile', 'scorta', ora)
        await registra(tx, companyId, userId, 'sblocco', sbloccati, ora)
        return sbloccati
    })
}

/**
 * Quanti lead già visibili e mai chiamati ha il GDO in prima chiamata (gli
 * arrivi ancora da classificare non contano: li classifica lo sblocco).
 */
export async function contaVisibiliDaChiamare(companyId: string, userId: string): Promise<number> {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(
        eq(leads.companyId, companyId),
        leadDelMondoDiAccount(userId),
        eq(leads.assignedToId, userId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNull(leads.recallDate),
        eq(leads.callCount, 0),
        or(
            eq(leads.scortaStato, 'visibile'),
            sql`exists (select 1 from "botContactRequests" r where r."leadId" = ${leads.id} and r."status" <> 'closed')`,
        ),
    ))
    return Number(r?.n ?? 0)
}

/**
 * Dopo un esito su una prima chiamata (updateLeadOutcome): se il GDO del lead
 * ha la scorta accesa, conta il consumo e, se non ha più niente da chiamare,
 * sblocca. Non lancia mai: un errore qui non deve far fallire l'esito.
 */
export async function dopoEsitoPrimaChiamata(companyId: string, gdoId: string, leadId: string, ora: Date = new Date()): Promise<void> {
    try {
        if (!(await scortaAccesa(gdoId))) return
        await registra(db, companyId, gdoId, 'consumato', [leadId], ora)
        // Controllo veloce senza lock: se c'è ancora un lead già visibile e mai
        // chiamato (o un "Ti ha cercato" mai chiamato), non serve sbloccare. A
        // zero decide sbloccaSeVuota, che sotto lock classifica anche gli arrivi.
        if (await contaVisibiliDaChiamare(companyId, gdoId) > 0) return
        await sbloccaSeVuota(companyId, gdoId, ora)
    } catch (e) {
        console.error('[scorta] dopo esito prima chiamata fallito', e)
    }
}

/**
 * Sblocco manuale (admin, monitor di /import): i primi 30 della scorta tornano
 * visibili anche se il GDO ha ancora lead da chiamare. Stesso lock dello
 * sblocco automatico; prima classifica gli arrivi, così chi è appena finito in
 * fondo resta in fondo. Restituisce gli id sbloccati (vuoto = scorta spenta o
 * vuota).
 */
export async function sbloccaManuale(companyId: string, userId: string, ora: Date = new Date(), quanti = SBLOCCO): Promise<string[]> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'scorta:' + userId}))`)
        if (!(await scortaAccesa(userId, tx))) return []
        const lista = await leggiPrimeChiamate(companyId, userId, tx)
        const dopo = applicaScritti(lista, await classificaEScrivi(companyId, userId, lista, ora, tx), ora)
        const ids = primiDellaScorta(dopo, quanti)
        if (ids.length === 0) return []
        const sbloccati = await scriviStato(tx, userId, ids, 'visibile', 'scorta', ora)
        await registra(tx, companyId, userId, 'sblocco_manuale', sbloccati, ora)
        return sbloccati
    })
}

/**
 * Accensione per un GDO (script di prima assegnazione e bottone "Accendi
 * scorta" del monitor di /import): vergini, stelle e "Ti ha cercato" visibili,
 * i migliori 40 del resto visibili, gli altri in scorta, e l'interruttore
 * acceso. Tutto in una transazione con lo stesso lock dello sblocco.
 * Restituisce cosa ha scritto; null se `soloSeSpenta` e l'interruttore era già
 * acceso (dal monitor una seconda accensione rifarebbe la prima assegnazione
 * da capo: non si fa).
 */
export async function accendiScorta(companyId: string, userId: string, ora: Date = new Date(), quanti = VISIBILI_INIZIALI, opzioni: { soloSeSpenta?: boolean } = {}) {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'scorta:' + userId}))`)
        if (opzioni.soloSeSpenta && await scortaAccesa(userId, tx)) return null
        const lista = await leggiPrimeChiamate(companyId, userId, tx)
        const piano = primaAssegnazione(lista, ora, quanti)
        const visibili = await scriviStato(tx, userId, piano.visibili, 'visibile', 'qualunque', ora)
        const scorta = await scriviStato(tx, userId, piano.scorta, 'scorta', 'qualunque', ora)
        await tx.update(users).set({ scortaAttiva: true }).where(eq(users.id, userId))
        const sempre = new Set(piano.sempre)
        await registra(tx, companyId, userId, 'iniziale', visibili.filter(id => !sempre.has(id)), ora)
        await registra(tx, companyId, userId, 'iniziale_scorta', scorta, ora)
        return { lista, piano, visibili, scorta }
    })
}

/**
 * Spegnimento (ripristino dello script): interruttore spento e stati azzerati
 * sui lead del GDO, così il GDO vede tutto come prima e una riaccensione
 * riparte pulita.
 */
export async function spegniScorta(companyId: string, userId: string, ora: Date = new Date()): Promise<number> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'scorta:' + userId}))`)
        await tx.update(users).set({ scortaAttiva: false }).where(eq(users.id, userId))
        const res = await tx.update(leads)
            .set({ scortaStato: null, scortaDal: null })
            .where(and(eq(leads.companyId, companyId), eq(leads.assignedToId, userId), sql`${leads.scortaStato} is not null`))
            .returning({ id: leads.id })
        await registra(tx, companyId, userId, 'spenta', res.map(r => r.id), ora)
        return res.length
    })
}

/** Movimenti dal giorno dato, per il monitor. */
export async function movimentiDal(companyId: string, userIds: string[], dal: Date) {
    if (userIds.length === 0) return []
    return db.select({
        userId: gdoScortaMovimenti.userId,
        tipo: gdoScortaMovimenti.tipo,
        quanti: gdoScortaMovimenti.quanti,
        createdAt: gdoScortaMovimenti.createdAt,
    }).from(gdoScortaMovimenti).where(and(
        eq(gdoScortaMovimenti.companyId, companyId),
        inArray(gdoScortaMovimenti.userId, userIds),
        sql`${gdoScortaMovimenti.createdAt} >= ${dal}`,
    )).orderBy(desc(gdoScortaMovimenti.createdAt))
}
