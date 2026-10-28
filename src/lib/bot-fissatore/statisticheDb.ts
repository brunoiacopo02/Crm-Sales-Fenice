// Letture dal database della pagina /statistiche-fissatore (28/10/2026).
// Non è un file "use server": queste funzioni non controllano il ruolo e non
// devono diventare action chiamabili dal browser. Le chiama
// src/app/actions/fissatoreStatsActions.ts dopo il controllo del ruolo.
// Tutte le letture stanno nel mese scelto e nel mese prima (Disk IO).

import { aliasedTable, and, eq, exists, gte, inArray, isNotNull, isNull, lt, ne, notExists, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { callLogs, leadEvents, leads } from "@/db/schema"
import { monthBoundsRome } from "@/lib/dateUtils"
import { leadVero } from "@/lib/prova/sql"
import {
    eLeadEvergreen, funnelDelBot, lavoroDeiGdo, lineaDelPiano, mesePrecedente,
    type FunnelDelBot, type LavoroDeiGdo, type LeadDelBot, type LeadRidato, type LineaDelPiano,
} from "./statisticheFissatore"

const FENICE = 'fenice'
/** Eventi che dicono che il lead ha scritto o parlato col bot. */
const EVENTI_SEGNALE = ['BOT_REPORT', 'INBOUND_MESSAGE', 'BOT_CONTACT_REQUEST']
const EVENTO_RESTITUZIONE = 'REASSIGNED_FROM_BOT'

export interface NumeriDelMese {
    mese: string
    funnel: FunnelDelBot
    linea: LineaDelPiano
    /** Lead fissati dal bot nel mese, per data di fissaggio (evergreen). */
    appuntamentiDelMese: number
    /** Lead della coorte A ridati dal bot e come li lavorano i GDO. */
    ridatiAiGdo: LavoroDeiGdo
}

type Evento = { leadId: string; eventType: string; metadata: unknown; timestamp: Date }

/**
 * ASSIGNED che dà il lead all'account del bot, nel periodo.
 *
 * L'assegnatario sta nei metadata: `assignedToUser` per l'intake (webhook AC,
 * import, lancio), `a` per i passaggi fatti a mano o in blocco (riequilibrio,
 * riscaldamento). Non si usa l'etichetta `routing`: esiste solo dal 27/08/2026
 * e `bot_first` vuol dire "va ai GDO, il bot passa avanti finché è sotto il
 * minimo", quindi molti bot_first al bot non ci sono mai arrivati
 * (coordinatore 28/10/2026).
 *
 * Gli ASSIGNED verso il bot li scrive il sistema (userId nullo) o il bot
 * stesso: col filtro su userId la lettura resta sull'indice
 * (companyId, userId, eventType, timestamp) invece di scorrere tutti gli
 * ASSIGNED del periodo.
 */
function assegnatoAlBot(t: typeof leadEvents, botId: string, da: Date, a: Date) {
    return and(
        eq(t.companyId, FENICE),
        or(isNull(t.userId), eq(t.userId, botId)),
        eq(t.eventType, 'ASSIGNED'),
        gte(t.timestamp, da),
        lt(t.timestamp, a),
        sql`coalesce(${t.metadata}->>'assignedToUser', ${t.metadata}->>'a') = ${botId}`,
    )
}

/**
 * Coorte A dei due mesi in una lettura: lead il cui PRIMO evento ASSIGNED li
 * dà al bot e cade nel periodo.
 */
async function leggiCoorteFunnel(botId: string, da: Date, a: Date) {
    const prima = aliasedTable(leadEvents, 'ass_prima')
    const ass = aliasedTable(leadEvents, 'ass_bot')
    // Stessa lettura come sottoquery (alias diverso) per restituzioni e segnali:
    // un viaggio solo. Prende qualche lead in più (prova, lancio, non-primi):
    // li scarta il filtro su perLead.
    const leadAssegnatiAlBot = db.select({ id: ass.leadId }).from(ass).where(assegnatoAlBot(ass, botId, da, a))

    const [coorte, logRows, eventi] = await Promise.all([
        db.select({
            leadId: leadEvents.leadId,
            at: leadEvents.timestamp,
            assignedToId: leads.assignedToId,
            launchBucket: leads.launchBucket,
            funnel: leads.funnel,
            lancioPool: leads.lancioPool,
            humanTestCohort: leads.humanTestCohort,
            intakeBatch: leads.intakeBatch,
        })
            .from(leadEvents)
            .innerJoin(leads, eq(leads.id, leadEvents.leadId))
            .where(and(
                assegnatoAlBot(leadEvents, botId, da, a),
                notExists(db.select({ x: sql`1` }).from(prima).where(and(
                    eq(prima.leadId, leadEvents.leadId),
                    eq(prima.eventType, 'ASSIGNED'),
                    lt(prima.timestamp, leadEvents.timestamp),
                ))),
                leadVero(),
            )),
        // Log del bot dal primo giorno del periodo: indice (userId, createdAt).
        db.select({ leadId: callLogs.leadId, outcome: callLogs.outcome, discardReason: callLogs.discardReason, at: callLogs.createdAt })
            .from(callLogs)
            .where(and(
                eq(callLogs.userId, botId),
                gte(callLogs.createdAt, da),
                inArray(callLogs.outcome, ['APPUNTAMENTO', 'DA_SCARTARE']),
            )),
        // Restituzioni e segnali dei lead assegnati al bot nel periodo (indice su leadId).
        db.select({
            leadId: leadEvents.leadId, eventType: leadEvents.eventType, metadata: leadEvents.metadata, timestamp: leadEvents.timestamp,
        })
            .from(leadEvents)
            .where(and(
                inArray(leadEvents.leadId, leadAssegnatiAlBot),
                inArray(leadEvents.eventType, [EVENTO_RESTITUZIONE, ...EVENTI_SEGNALE]),
                gte(leadEvents.timestamp, da),
            )),
    ])
    // Solo evergreen (PO 28/10/2026): fuori lanci, liste e database, flood del
    // 15/09 compreso. Prova già esclusa nel WHERE.
    // Un lead ha un solo primo ASSIGNED; due eventi nello stesso istante esatto passerebbero entrambi.
    const perLead = new Map<string, typeof coorte[number]>()
    for (const l of coorte) {
        if (!eLeadEvergreen(l) || perLead.has(l.leadId)) continue
        perLead.set(l.leadId, l)
    }

    const log = new Map<string, LeadDelBot['logDelBot']>()
    for (const r of logRows) {
        if (!perLead.has(r.leadId)) continue
        const arr = log.get(r.leadId) ?? []
        arr.push({ outcome: r.outcome, discardReason: r.discardReason, at: r.at })
        log.set(r.leadId, arr)
    }
    const eventiCoorte: Evento[] = eventi.filter(e => perLead.has(e.leadId))
    return { perLead, log, eventi: eventiCoorte }
}

type Coorte = Awaited<ReturnType<typeof leggiCoorteFunnel>>
type Restituzione = NonNullable<LeadDelBot['restituzione']>

/** Prima restituzione e segnali per lead (oggi nessun lead ha più di una restituzione, audit 28/10). */
function restituzioniESegnali(eventi: Evento[]) {
    const restituzione = new Map<string, Restituzione>()
    const segnali = new Map<string, Date[]>()
    for (const e of eventi) {
        if (e.eventType === EVENTO_RESTITUZIONE) {
            const m = (e.metadata ?? {}) as { reason?: unknown; toGdo?: unknown }
            const cur = restituzione.get(e.leadId)
            if (!cur || e.timestamp < cur.at) {
                restituzione.set(e.leadId, {
                    reason: typeof m.reason === 'string' ? m.reason : null,
                    toGdo: typeof m.toGdo === 'string' && m.toGdo ? m.toGdo : null,
                    at: e.timestamp,
                })
            }
        } else {
            const arr = segnali.get(e.leadId) ?? []
            arr.push(e.timestamp)
            segnali.set(e.leadId, arr)
        }
    }
    return { restituzione, segnali }
}

function funnelDelMese(
    dati: Coorte, ev: ReturnType<typeof restituzioniESegnali>,
    start: Date, end: Date,
): FunnelDelBot {
    const coorte: LeadDelBot[] = []
    for (const l of dati.perLead.values()) {
        if (l.at < start || l.at >= end) continue
        coorte.push({
            assegnatoIl: l.at,
            logDelBot: dati.log.get(l.leadId) ?? [],
            restituzione: ev.restituzione.get(l.leadId) ?? null,
            segnali: ev.segnali.get(l.leadId) ?? [],
            assignedToId: l.assignedToId,
        })
    }
    return funnelDelBot(coorte)
}

const BLOCCO_ID = 2000

/**
 * Per i lead della coorte ridati a un GDO: gli APPUNTAMENTO scritti da un
 * utente che non è il bot dal primo giorno del periodo (indice leadId,
 * createdAt) e i campi di oggi dell'appuntamento (chiave primaria). Solo i
 * lead già trovati nella coorte, niente storico.
 */
async function leggiLavoroGdo(botId: string, ids: string[], da: Date) {
    const blocchi: string[][] = []
    for (let i = 0; i < ids.length; i += BLOCCO_ID) blocchi.push(ids.slice(i, i + BLOCCO_ID))
    const risultati = await Promise.all(blocchi.map(b => Promise.all([
        db.select({ leadId: callLogs.leadId, at: callLogs.createdAt })
            .from(callLogs)
            .where(and(
                inArray(callLogs.leadId, b),
                eq(callLogs.outcome, 'APPUNTAMENTO'),
                gte(callLogs.createdAt, da),
                isNotNull(callLogs.userId),
                ne(callLogs.userId, botId),
            )),
        db.select({
            id: leads.id,
            appointmentDate: leads.appointmentDate,
            confirmationsOutcome: leads.confirmationsOutcome,
            presentedAt: leads.presentedAt,
            salespersonOutcome: leads.salespersonOutcome,
        })
            .from(leads)
            .where(inArray(leads.id, b)),
    ])))
    const logGdo = new Map<string, Date[]>()
    const appuntamento = new Map<string, Omit<LeadRidato, 'restituzione' | 'assignedToId' | 'fissaggi'>>()
    for (const [logRows, leadRows] of risultati) {
        for (const r of logRows) {
            const arr = logGdo.get(r.leadId) ?? []
            arr.push(r.at)
            logGdo.set(r.leadId, arr)
        }
        for (const l of leadRows) {
            appuntamento.set(l.id, {
                appointmentDate: l.appointmentDate,
                confirmationsOutcome: l.confirmationsOutcome,
                presentedAt: l.presentedAt,
                salespersonOutcome: l.salespersonOutcome,
            })
        }
    }
    return { logGdo, appuntamento }
}

function lavoroDelMese(
    dati: Coorte, ev: ReturnType<typeof restituzioniESegnali>, gdo: Awaited<ReturnType<typeof leggiLavoroGdo>>,
    start: Date, end: Date, ora: Date,
): LavoroDeiGdo {
    const ridati: LeadRidato[] = []
    for (const l of dati.perLead.values()) {
        if (l.at < start || l.at >= end) continue
        const restituzione = ev.restituzione.get(l.leadId)
        if (!restituzione) continue
        const app = gdo.appuntamento.get(l.leadId)
        ridati.push({
            restituzione,
            assignedToId: l.assignedToId,
            fissaggi: [
                ...(dati.log.get(l.leadId) ?? []).filter(c => c.outcome === 'APPUNTAMENTO').map(c => ({ at: c.at, delBot: true })),
                ...(gdo.logGdo.get(l.leadId) ?? []).map(at => ({ at, delBot: false })),
            ],
            appointmentDate: app?.appointmentDate ?? null,
            confirmationsOutcome: app?.confirmationsOutcome ?? null,
            presentedAt: app?.presentedAt ?? null,
            salespersonOutcome: app?.salespersonOutcome ?? null,
        })
    }
    return lavoroDeiGdo(ridati, ora)
}

/**
 * Coorte B dei due mesi: appuntamenti con appointmentDate nel periodo e già
 * passati, su lead dove il bot ha registrato un APPUNTAMENTO. Solo evergreen, prova esclusa.
 */
async function leggiAppuntamentiDelBot(botId: string, da: Date, a: Date) {
    const rows = await db.select({
        appointmentDate: leads.appointmentDate,
        confirmationsOutcome: leads.confirmationsOutcome,
        presentedAt: leads.presentedAt,
        salespersonOutcome: leads.salespersonOutcome,
        launchBucket: leads.launchBucket,
        intakeBatch: leads.intakeBatch,
        funnel: leads.funnel,
        lancioPool: leads.lancioPool,
        humanTestCohort: leads.humanTestCohort,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, FENICE),
            gte(leads.appointmentDate, da),
            lt(leads.appointmentDate, a),
            leadVero(),
            exists(db.select({ x: sql`1` }).from(callLogs).where(and(
                eq(callLogs.leadId, leads.id),
                eq(callLogs.userId, botId),
                eq(callLogs.outcome, 'APPUNTAMENTO'),
            ))),
        ))
    return rows.filter(eLeadEvergreen)
}

/**
 * Appuntamenti fissati dal bot nel periodo, per data di fissaggio: chiamate
 * APPUNTAMENTO del bot (indice userId, createdAt) su lead evergreen veri.
 * Un lead fissato due volte nello stesso mese conta una volta.
 */
async function leggiFissaggiDelBot(botId: string, da: Date, a: Date) {
    const rows = await db.select({
        leadId: callLogs.leadId,
        at: callLogs.createdAt,
        launchBucket: leads.launchBucket,
        intakeBatch: leads.intakeBatch,
        funnel: leads.funnel,
        lancioPool: leads.lancioPool,
        humanTestCohort: leads.humanTestCohort,
    })
        .from(callLogs)
        .innerJoin(leads, eq(leads.id, callLogs.leadId))
        .where(and(
            eq(callLogs.userId, botId),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            gte(callLogs.createdAt, da),
            lt(callLogs.createdAt, a),
            leadVero(),
        ))
    return rows.filter(eLeadEvergreen)
}

function appuntamentiNelPeriodo(rows: { leadId: string; at: Date }[], start: Date, end: Date): number {
    return new Set(rows.filter(r => r.at >= start && r.at < end).map(r => r.leadId)).size
}

/** Numeri del mese e del mese prima. `ora` taglia gli appuntamenti non ancora passati. */
export async function calcolaNumeriFissatore(
    botId: string, mese: string, ora: Date,
): Promise<{ questo: NumeriDelMese; prima: NumeriDelMese }> {
    const mesePrima = mesePrecedente(mese)
    const b = monthBoundsRome(mese)
    const p = monthBoundsRome(mesePrima)
    const fineAppuntamenti = b.end < ora ? b.end : ora
    const [coorte, appuntamenti, fissaggi] = await Promise.all([
        leggiCoorteFunnel(botId, p.start, b.end),
        leggiAppuntamentiDelBot(botId, p.start, fineAppuntamenti),
        leggiFissaggiDelBot(botId, p.start, b.end),
    ])
    const ev = restituzioniESegnali(coorte.eventi)
    const idsAUnGdo = [...coorte.perLead.keys()].filter(id => !!ev.restituzione.get(id)?.toGdo)
    const gdo = await leggiLavoroGdo(botId, idsAUnGdo, p.start)

    const linea = (start: Date, end: Date) => lineaDelPiano(appuntamenti.filter(a =>
        a.appointmentDate !== null && a.appointmentDate >= start && a.appointmentDate < end))
    const delMese = (m: string, x: { start: Date; end: Date }): NumeriDelMese => ({
        mese: m,
        funnel: funnelDelMese(coorte, ev, x.start, x.end),
        linea: linea(x.start, x.end),
        appuntamentiDelMese: appuntamentiNelPeriodo(fissaggi, x.start, x.end),
        ridatiAiGdo: lavoroDelMese(coorte, ev, gdo, x.start, x.end, ora),
    })
    return { questo: delMese(mese, b), prima: delMese(mesePrima, p) }
}
