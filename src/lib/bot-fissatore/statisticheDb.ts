// Letture dal database della pagina /statistiche-fissatore (28/10/2026).
// Non è un file "use server": queste funzioni non controllano il ruolo e non
// devono diventare action chiamabili dal browser. Le chiama
// src/app/actions/fissatoreStatsActions.ts dopo il controllo del ruolo.
// Tutte le letture stanno nel mese scelto e nel mese prima (Disk IO).

import { aliasedTable, and, eq, exists, gte, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { callLogs, leadEvents, leads } from "@/db/schema"
import { monthBoundsRome } from "@/lib/dateUtils"
import { leadVero } from "@/lib/prova/sql"
import { eLeadDelLancio } from "@/lib/diretta/instradamento"
import { contaNeiKpi } from "@/lib/intakeBatch"
import {
    funnelDelBot, lineaDelPiano, mesePrecedente,
    type FunnelDelBot, type LeadDelBot, type LineaDelPiano,
} from "./statisticheFissatore"

const FENICE = 'fenice'
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
            isTest: leads.isTest,
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
    // Infornata anomala (flood lista 133 del 15/09/2026): conta solo chi il bot
    // ha davvero contattato, con la regola canonica `contaNeiKpi` (la stessa di
    // marketingActions per i lead acquisiti). Si applica ai ricevuti e non agli
    // appuntamenti: un appuntamento nato dall'infornata è vero.
    // Un lead ha un solo primo ASSIGNED; due eventi nello stesso istante esatto passerebbero entrambi.
    const perLead = new Map<string, typeof coorte[number]>()
    for (const l of coorte) {
        if (eLeadDelLancio(l) || !contaNeiKpi(l) || perLead.has(l.leadId)) continue
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

function funnelDelMese(
    dati: Awaited<ReturnType<typeof leggiCoorteFunnel>>,
    start: Date, end: Date,
): FunnelDelBot {
    // Prima restituzione per lead (oggi nessun lead ne ha più di una, audit 28/10).
    const restituzione = new Map<string, NonNullable<LeadDelBot['restituzione']>>()
    const segnali = new Map<string, Date[]>()
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
            const arr = segnali.get(e.leadId) ?? []
            arr.push(e.timestamp)
            segnali.set(e.leadId, arr)
        }
    }
    const coorte: LeadDelBot[] = []
    for (const l of dati.perLead.values()) {
        if (l.at < start || l.at >= end) continue
        coorte.push({
            assegnatoIl: l.at,
            logDelBot: dati.log.get(l.leadId) ?? [],
            restituzione: restituzione.get(l.leadId) ?? null,
            segnali: segnali.get(l.leadId) ?? [],
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
