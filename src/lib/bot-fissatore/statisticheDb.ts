// Letture dal database della pagina /statistiche-fissatore (28/10/2026).
// Non è un file "use server": queste funzioni non controllano il ruolo e non
// devono diventare action chiamabili dal browser. Le chiama
// src/app/actions/fissatoreStatsActions.ts dopo il controllo del ruolo.
// Tutte le letture stanno nel mese scelto e nel mese prima (Disk IO).

import { aliasedTable, and, eq, exists, gte, inArray, isNull, lt, notExists, sql } from "drizzle-orm"
import { db } from "@/db"
import { callLogs, leadEvents, leads } from "@/db/schema"
import { monthBoundsRome } from "@/lib/dateUtils"
import { leadVero } from "@/lib/prova/sql"
import { eLeadDelLancio } from "@/lib/diretta/instradamento"
import {
    funnelDelBot, lineaDelPiano, mesePrecedente,
    type FunnelDelBot, type LeadDelBot, type LineaDelPiano,
} from "./statisticheFissatore"

const FENICE = 'fenice'
const ROUTING_BOT = ['bot_first', 'bot_only']
/** Eventi che dicono che il lead ha scritto o parlato col bot. */
const EVENTI_SEGNALE = ['BOT_REPORT', 'INBOUND_MESSAGE', 'BOT_CONTACT_REQUEST']
const EVENTO_RESTITUZIONE = 'REASSIGNED_FROM_BOT'

export interface NumeriDelMese {
    mese: string
    funnel: FunnelDelBot
    linea: LineaDelPiano
}

type Evento = { leadId: string; eventType: string; metadata: unknown; timestamp: Date }

/**
 * Coorte A dei due mesi in una lettura: lead col PRIMO evento ASSIGNED con
 * routing bot_first/bot_only nel periodo. Gli ASSIGNED del routing li scrive
 * il sistema (userId nullo): con userId IS NULL la lettura resta sull'indice
 * (companyId, userId, eventType, timestamp).
 */
async function leggiCoorteFunnel(botId: string, da: Date, a: Date) {
    const prima = aliasedTable(leadEvents, 'ass_prima')
    const ass = aliasedTable(leadEvents, 'ass_bot')
    const assegnatiAlBot = and(
        eq(leadEvents.companyId, FENICE),
        isNull(leadEvents.userId),
        eq(leadEvents.eventType, 'ASSIGNED'),
        gte(leadEvents.timestamp, da),
        lt(leadEvents.timestamp, a),
        inArray(sql<string>`${leadEvents.metadata}->>'routing'`, ROUTING_BOT),
    )
    // Stessa lettura come sottoquery (alias diverso) per restituzioni e segnali:
    // un viaggio solo invece di uno per blocco di id. Prende qualche lead in più
    // (prova, lancio, non-primi): li scarta il filtro su perLead.
    const leadAssegnatiAlBot = db.select({ id: ass.leadId }).from(ass).where(and(
        eq(ass.companyId, FENICE),
        isNull(ass.userId),
        eq(ass.eventType, 'ASSIGNED'),
        gte(ass.timestamp, da),
        lt(ass.timestamp, a),
        inArray(sql<string>`${ass.metadata}->>'routing'`, ROUTING_BOT),
    ))
    const [coorte, logRows, eventi] = await Promise.all([db.select({
        leadId: leadEvents.leadId,
        at: leadEvents.timestamp,
        assignedToId: leads.assignedToId,
        launchBucket: leads.launchBucket,
        funnel: leads.funnel,
        lancioPool: leads.lancioPool,
        humanTestCohort: leads.humanTestCohort,
    })
        .from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(and(
            assegnatiAlBot,
            notExists(db.select({ x: sql`1` }).from(prima).where(and(
                eq(prima.leadId, leadEvents.leadId),
                eq(prima.eventType, 'ASSIGNED'),
                lt(prima.timestamp, leadEvents.timestamp),
            ))),
            leadVero(),
        )),
        // Log del bot dal primo giorno del periodo: indice (userId, createdAt).
        db.select({ leadId: callLogs.leadId, outcome: callLogs.outcome, discardReason: callLogs.discardReason })
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
    // Un lead ha un solo primo ASSIGNED; due eventi nello stesso istante esatto passerebbero entrambi.
    const perLead = new Map<string, typeof coorte[number]>()
    for (const l of coorte) if (!eLeadDelLancio(l) && !perLead.has(l.leadId)) perLead.set(l.leadId, l)

    const log = new Map<string, { outcome: string; discardReason: string | null }[]>()
    for (const r of logRows) {
        if (!perLead.has(r.leadId)) continue
        const arr = log.get(r.leadId) ?? []
        arr.push({ outcome: r.outcome, discardReason: r.discardReason })
        log.set(r.leadId, arr)
    }
    const eventiCoorte: Evento[] = eventi.filter(e => perLead.has(e.leadId))
    return { perLead, log, eventi: eventiCoorte }
}

function funnelDelMese(
    dati: Awaited<ReturnType<typeof leggiCoorteFunnel>>,
    start: Date, end: Date,
): FunnelDelBot {
    // Prima restituzione per lead (oggi nessun lead ne ha più di una, audit 28/10).
    const restituzione = new Map<string, { reason: string | null; toGdo: string | null; at: Date }>()
    const segnali = new Set<string>()
    for (const e of dati.eventi) {
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
            segnali.add(e.leadId)
        }
    }
    const coorte: LeadDelBot[] = []
    for (const l of dati.perLead.values()) {
        if (l.at < start || l.at >= end) continue
        const r = restituzione.get(l.leadId)
        coorte.push({
            logDelBot: dati.log.get(l.leadId) ?? [],
            restituzione: r ? { reason: r.reason, toGdo: r.toGdo } : null,
            segnaliDiRisposta: segnali.has(l.leadId),
            assignedToId: l.assignedToId,
        })
    }
    return funnelDelBot(coorte)
}

/**
 * Coorte B dei due mesi: appuntamenti con appointmentDate nel periodo e già
 * passati, su lead dove il bot ha registrato un APPUNTAMENTO. Lanci e prova esclusi.
 */
async function leggiAppuntamentiDelBot(botId: string, da: Date, a: Date) {
    const rows = await db.select({
        appointmentDate: leads.appointmentDate,
        confirmationsOutcome: leads.confirmationsOutcome,
        presentedAt: leads.presentedAt,
        salespersonOutcome: leads.salespersonOutcome,
        launchBucket: leads.launchBucket,
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
    return rows.filter(r => !eLeadDelLancio(r))
}

/** Numeri del mese e del mese prima. `ora` taglia gli appuntamenti non ancora passati. */
export async function calcolaNumeriFissatore(
    botId: string, mese: string, ora: Date,
): Promise<{ questo: NumeriDelMese; prima: NumeriDelMese }> {
    const mesePrima = mesePrecedente(mese)
    const b = monthBoundsRome(mese)
    const p = monthBoundsRome(mesePrima)
    const fineAppuntamenti = b.end < ora ? b.end : ora
    const [coorte, appuntamenti] = await Promise.all([
        leggiCoorteFunnel(botId, p.start, b.end),
        leggiAppuntamentiDelBot(botId, p.start, fineAppuntamenti),
    ])
    const linea = (start: Date, end: Date) => lineaDelPiano(appuntamenti.filter(a =>
        a.appointmentDate !== null && a.appointmentDate >= start && a.appointmentDate < end))
    return {
        questo: { mese, funnel: funnelDelMese(coorte, b.start, b.end), linea: linea(b.start, b.end) },
        prima: { mese: mesePrima, funnel: funnelDelMese(coorte, p.start, p.end), linea: linea(p.start, p.end) },
    }
}
