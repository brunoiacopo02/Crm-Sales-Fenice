// Distribuzione automatica (PO 07/11/2026): letture e scritture sul DB. Le
// regole, e il piano scritto per esteso, sono in automatico.ts.
//
// Giro serale (cron /api/cron/diretta-serale):
//   leggiGiro → pianoSerale (puro) → applicaSerale.
// Scorta generale (dentro sbloccaSeVuota di scortaDb.ts):
//   prendiDalSerbatoio.
//
// Scritture come gli script manuali del 06/11, così /import, i KPI e il feed
// del bot vedono quello che vedevano allora:
//  - accantonamento: assignedToId null, scorta azzerata, version + 1, evento
//    RIDATO_PARCHEGGIATO (motivo, tolto_a). updatedAt intatto;
//  - riequilibrio: assignedToId, assignedAt COALESCE, version + 1, evento
//    REASSIGNED_ADMIN (reason, fromAssigneeId, toAssigneeId). updatedAt
//    intatto; il trigger leads_scorta_reset rimette il lead "da classificare"
//    e la board di chi lo riceve lo classifica (vergini e stelle in cima, il
//    resto in scorta);
//  - scorta generale: assignedToId, assignedAt COALESCE, scortaStato
//    'visibile' con scortaDal = ora (un'ondata, come uno sblocco), updatedAt
//    sfalsato di 1 ms (il feed del bot ha il cursore su updatedAt), evento
//    ASSIGNED (source 'scorta_generale'), movimento 'scorta_generale'.
// Ogni scrittura rilegge il lead sotto lock (FOR UPDATE) e lo salta se nel
// frattempo è cambiato (version diversa, o non è più di chi era).

import crypto from 'crypto'
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { botContactRequests, callLogs, gdoScortaMovimenti, leadEvents, leads, users } from '@/db/schema'
import { isTeamMember } from './config'
import { eLeadDelLancio } from './instradamento'
import { datiDaEventi, type EventoScorta } from './scorta'
import {
    GIORNI_ASSENZA, MOTIVO_ACCANTONAMENTO, MOTIVO_RIEQUILIBRIO, daSerbatoio,
    type GdoGiro, type LeadGiro, type LeadSerbatoio, type PianoSerale,
} from './automatico'
import { EVENTO_RIDATO_PARCHEGGIATO } from '@/lib/bot-fissatore/iaVocale'
import { LANCIO_FUNNEL } from '@/lib/lancio/intake'
import { contaNeiKpiSql } from '@/lib/intakeBatch'
import { notificaBfArrivati } from './notificaBfDb'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Esecutore = typeof db | Tx

export const FENICE = 'fenice'

function lotti<T>(lista: readonly T[], n = 500): T[][] {
    const out: T[][] = []
    for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n))
    return out
}

export interface GdoLetto extends GdoGiro { nome: string }

/** I GDO della squadra di Fenice (niente bot, niente prova, niente senza nome) con l'ultima chiamata. */
export async function leggiGdoGiro(ora: Date, ex: Esecutore = db): Promise<GdoLetto[]> {
    const righe = await ex.select({
        id: users.id, gdoCode: users.gdoCode, role: users.role, isActive: users.isActive, isBot: users.isBot,
        isTest: users.isTest, firstName: users.firstName, acAutoIntake: users.acAutoIntake,
        botReturnIntake: users.botReturnIntake, createdAt: users.createdAt,
    }).from(users).where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isActive, true)))
    const squadra = righe.filter(u => isTeamMember({ ...u, isActive: !!u.isActive }) && u.gdoCode != null)
    if (squadra.length === 0) return []
    // Basta sapere se ha chiamato di recente: si guarda un po' più indietro della soglia.
    const dal = new Date(ora.getTime() - (GIORNI_ASSENZA + 4) * 24 * 3600 * 1000)
    const chiamate = await ex.select({ userId: callLogs.userId, ultima: sql<Date | string>`max(${callLogs.createdAt})` })
        .from(callLogs)
        .where(and(inArray(callLogs.userId, squadra.map(u => u.id)), gt(callLogs.createdAt, dal)))
        .groupBy(callLogs.userId)
    const ultima = new Map(chiamate.map(c => [c.userId, new Date(c.ultima)]))
    return squadra.map(u => ({
        id: u.id,
        codice: u.gdoCode!,
        nome: u.firstName!.trim(),
        inGiro: u.acAutoIntake || u.botReturnIntake,
        ultimaChiamata: ultima.get(u.id) ?? null,
        creatoIl: u.createdAt,
    }))
}

/** I lead aperti dei GDO dati, con tutto quello che serve alle regole. */
export async function leggiLeadAperti(gdoIds: string[], ex: Esecutore = db): Promise<LeadGiro[]> {
    if (gdoIds.length === 0) return []
    const righe = await ex.select({
        id: leads.id, status: leads.status, callCount: leads.callCount, source: leads.source,
        launchBucket: leads.launchBucket, funnel: leads.funnel, lancioPool: leads.lancioPool,
        humanTestCohort: leads.humanTestCohort, createdAt: leads.createdAt, updatedAt: leads.updatedAt,
        scortaStato: leads.scortaStato, scortaDal: leads.scortaDal, assignedToId: leads.assignedToId,
        assignedAt: leads.assignedAt, recallDate: leads.recallDate, appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt, lastCallDate: leads.lastCallDate, version: leads.version,
        confirmationsUserId: leads.confirmationsUserId, confirmationsOutcome: leads.confirmationsOutcome,
        confCall1At: leads.confCall1At, reservedSalespersonId: leads.reservedSalespersonId,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        eq(leads.isTest, false),
        inArray(leads.assignedToId, gdoIds),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
    ))
    const ids = righe.map(r => r.id)

    const cercati = new Set<string>()
    const eventi = new Map<string, EventoScorta[]>()
    const ridati = new Set<string>()
    for (const blocco of lotti(ids)) {
        for (const r of await ex.select({ leadId: botContactRequests.leadId }).from(botContactRequests)
            .where(and(inArray(botContactRequests.leadId, blocco), ne(botContactRequests.status, 'closed')))) cercati.add(r.leadId)
        const rows = await ex.select({
            leadId: leadEvents.leadId, eventType: leadEvents.eventType, userId: leadEvents.userId, timestamp: leadEvents.timestamp,
            reason: sql<string | null>`${leadEvents.metadata}->>'reason'`,
            instradato: sql<string | null>`${leadEvents.metadata}->>'instradato'`,
            toAssigneeId: sql<string | null>`${leadEvents.metadata}->>'toAssigneeId'`,
            assignedToUser: sql<string | null>`${leadEvents.metadata}->>'assignedToUser'`,
        }).from(leadEvents).where(and(
            inArray(leadEvents.eventType, ['REASSIGNED_FROM_BOT', 'REASSIGNED_ADMIN', 'ASSIGNED', 'BOT_PUSHED']),
            inArray(leadEvents.leadId, blocco),
        ))
        for (const r of rows) {
            if (r.eventType === 'REASSIGNED_FROM_BOT') ridati.add(r.leadId)
            const l = eventi.get(r.leadId)
            if (l) l.push(r)
            else eventi.set(r.leadId, [r])
        }
    }

    return righe.map(r => ({
        id: r.id, status: r.status, callCount: r.callCount, source: r.source, launchBucket: r.launchBucket,
        funnel: r.funnel, createdAt: r.createdAt, updatedAt: r.updatedAt, scortaStato: r.scortaStato,
        scortaDal: r.scortaDal, cercato: cercati.has(r.id),
        ...datiDaEventi(eventi.get(r.id) ?? [], r.assignedToId, r.assignedAt, r.createdAt),
        assignedToId: r.assignedToId, recallDate: r.recallDate, appointmentDate: r.appointmentDate,
        presentedAt: r.presentedAt, lastCallDate: r.lastCallDate, version: r.version,
        inConferme: !!(r.confirmationsUserId || r.confirmationsOutcome || r.confCall1At || r.reservedSalespersonId),
        lancio: eLeadDelLancio(r),
        ridatoDalBot: ridati.has(r.id),
    }))
}

export async function leggiGiro(ora: Date) {
    const gdos = await leggiGdoGiro(ora)
    const lista = await leggiLeadAperti(gdos.map(g => g.id))
    return { gdos, lista }
}

export interface EsitoSerale { accantonati: number; spostati: number; saltati: number }

/**
 * Applica il piano serale in UNA transazione: lock consultivo della scorta di
 * ogni GDO coinvolto (in ordine, niente stalli con lo sblocco), rilettura FOR
 * UPDATE, e chi è cambiato dal piano si salta.
 */
export async function applicaSerale(piano: PianoSerale, lista: readonly LeadGiro[], ora: Date): Promise<EsitoSerale> {
    const perId = new Map(lista.map(l => [l.id, l]))
    const sposta = piano.riequilibrio.spostamenti
    const coinvolti = [...new Set([...piano.accantonati.map(a => a.da), ...sposta.flatMap(s => [s.da, s.a])])].sort()
    const tutti = [...piano.accantonati.map(a => a.leadId), ...sposta.map(s => s.leadId)]
    if (tutti.length === 0) return { accantonati: 0, spostati: 0, saltati: 0 }

    const esito = await applicaSeraleTx(piano, lista, ora, perId, sposta, coinvolti, tutti)
    // Lead Black Friday spostati a un altro GDO: notifica al destinatario (PO 09/11/2026).
    if (esito.spostati > 0) await notificaBfArrivati(sposta.map(s => s.leadId))
    return esito
}

async function applicaSeraleTx(
    piano: PianoSerale, _lista: readonly LeadGiro[], ora: Date, perId: Map<string, LeadGiro>,
    sposta: PianoSerale['riequilibrio']['spostamenti'], coinvolti: string[], tutti: string[],
): Promise<EsitoSerale> {
    return db.transaction(async (tx) => {
        for (const g of coinvolti) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'scorta:' + g}))`)
        const adesso = new Map<string, { assignedToId: string | null; version: number }>()
        for (const blocco of lotti(tutti)) {
            for (const r of await tx.select({ id: leads.id, assignedToId: leads.assignedToId, version: leads.version })
                .from(leads).where(inArray(leads.id, blocco)).for('update')) adesso.set(r.id, r)
        }
        const invariato = (id: string, da: string) => {
            const r = adesso.get(id)
            const prima = perId.get(id)
            return !!r && !!prima && r.assignedToId === da && r.version === prima.version
        }
        let saltati = 0

        const acc = piano.accantonati.filter(a => invariato(a.leadId, a.da))
        saltati += piano.accantonati.length - acc.length
        for (const b of lotti(acc)) {
            await tx.update(leads).set({ assignedToId: null, scortaStato: null, scortaDal: null, version: sql`${leads.version} + 1` })
                .where(inArray(leads.id, b.map(a => a.leadId)))
            await tx.insert(leadEvents).values(b.map(a => ({
                id: crypto.randomUUID(), leadId: a.leadId, eventType: EVENTO_RIDATO_PARCHEGGIATO, userId: null, timestamp: ora,
                metadata: { motivo: MOTIVO_ACCANTONAMENTO, nota: 'Giro serale automatico: ridato dal bot oltre 8 giorni, GDO oltre 60 in prima chiamata', tolto_a: a.da, recallDate: null },
                companyId: FENICE,
            })))
        }

        const sp = sposta.filter(s => invariato(s.leadId, s.da))
        saltati += sposta.length - sp.length
        const perDest = new Map<string, typeof sp>()
        for (const s of sp) perDest.set(s.a, [...(perDest.get(s.a) ?? []), s])
        for (const [a, gruppo] of perDest) {
            for (const b of lotti(gruppo)) {
                await tx.update(leads).set({ assignedToId: a, assignedAt: sql`COALESCE(${leads.assignedAt}, ${ora})`, version: sql`${leads.version} + 1` })
                    .where(inArray(leads.id, b.map(s => s.leadId)))
                await tx.insert(leadEvents).values(b.map(s => ({
                    id: crypto.randomUUID(), leadId: s.leadId, eventType: 'REASSIGNED_ADMIN', userId: null, timestamp: ora,
                    metadata: { reason: MOTIVO_RIEQUILIBRIO, motivo: s.motivo, tipo: s.tipo, fromAssigneeId: s.da, toAssigneeId: s.a },
                    companyId: FENICE,
                })))
            }
        }
        return { accantonati: acc.length, spostati: sp.length, saltati }
    })
}

// ── Scorta generale ──────────────────────────────────────────────────────────

/** Accantonato recuperabile per la prima chiamata: il predicato del serbatoio, uguale in lettura e sotto lock. */
function nelSerbatoio(companyId: string) {
    return and(
        eq(leads.companyId, companyId),
        isNull(leads.assignedToId),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        eq(leads.callCount, 0),
        isNull(leads.recallDate),
        isNull(leads.appointmentDate),
        isNull(leads.presentedAt),
        isNull(leads.reservedSalespersonId),
        isNull(leads.confirmationsUserId),
        eq(leads.phoneSuspicious, false),
        // Nessun bucket: fuori il lancio e anche la coda marketing (MKT_CODA,
        // "database punteggio alto"), che resta a mano su /import.
        isNull(leads.launchBucket),
        or(isNull(leads.funnel), ne(leads.funnel, LANCIO_FUNNEL)),
        isNull(leads.lancioPool),
        isNull(leads.humanTestCohort),
        contaNeiKpiSql(),
        sql`exists (select 1 from "leadEvents" e where e."leadId" = ${leads.id} and e."eventType" = ${EVENTO_RIDATO_PARCHEGGIATO})`,
        sql`not exists (select 1 from "botContactRequests" r where r."leadId" = ${leads.id} and r."status" <> 'closed')`,
    )
}

/** Quanti candidati si leggono per scegliere i migliori: il serbatoio intero oggi è sotto il migliaio. */
const LETTURA_SERBATOIO = 1500

/** Il serbatoio con i dati per ordinarlo. */
export async function leggiSerbatoio(companyId: string, ex: Esecutore = db): Promise<LeadSerbatoio[]> {
    const righe = await ex.select({ id: leads.id, createdAt: leads.createdAt }).from(leads)
        .where(nelSerbatoio(companyId)).orderBy(desc(leads.createdAt), desc(leads.id)).limit(LETTURA_SERBATOIO)
    if (righe.length === 0) return []
    const ultimo = new Map<string, { t: number; reason: string | null; instradato: string | null }>()
    const parcheggio = new Map<string, { t: number; motivo: string | null }>()
    const bot = new Set<string>()
    for (const blocco of lotti(righe.map(r => r.id))) {
        const ev = await ex.select({
            leadId: leadEvents.leadId, eventType: leadEvents.eventType, timestamp: leadEvents.timestamp,
            reason: sql<string | null>`${leadEvents.metadata}->>'reason'`,
            instradato: sql<string | null>`${leadEvents.metadata}->>'instradato'`,
            motivo: sql<string | null>`${leadEvents.metadata}->>'motivo'`,
        }).from(leadEvents).where(and(
            inArray(leadEvents.eventType, ['REASSIGNED_FROM_BOT', 'BOT_PUSHED', EVENTO_RIDATO_PARCHEGGIATO]),
            inArray(leadEvents.leadId, blocco),
        ))
        for (const e of ev) {
            const t = new Date(e.timestamp).getTime()
            if (e.eventType === 'BOT_PUSHED') bot.add(e.leadId)
            else if (e.eventType === 'REASSIGNED_FROM_BOT') {
                if (!ultimo.has(e.leadId) || ultimo.get(e.leadId)!.t < t) ultimo.set(e.leadId, { t, reason: e.reason, instradato: e.instradato })
            } else if (!parcheggio.has(e.leadId) || parcheggio.get(e.leadId)!.t < t) parcheggio.set(e.leadId, { t, motivo: e.motivo })
        }
    }
    return righe.map(r => ({
        id: r.id,
        createdAt: r.createdAt,
        ultimoMotivo: ultimo.get(r.id)?.reason ?? null,
        ultimoInstradato: ultimo.get(r.id)?.instradato ?? null,
        passatoDalBot: bot.has(r.id),
        motivoAccantonamento: parcheggio.get(r.id)?.motivo ?? null,
    }))
}

const ON = new Set(['1', 'on', 'true'])
export function scortaGeneraleAccesa(): boolean {
    return ON.has((process.env.SCORTA_GENERALE_ENABLED ?? '').trim().toLowerCase())
}

/** Serbatoio letto vuoto di recente: per qualche minuto non si rilegge a ogni caricamento della board. */
let vuotoFinoA = 0
const PAUSA_SE_VUOTO_MS = 5 * 60_000

/**
 * Dà al GDO fino a `quanti` lead del serbatoio, i migliori e i più freschi,
 * già visibili. Va chiamata DENTRO la transazione con il lock della scorta del
 * GDO (sbloccaSeVuota). Solo per un GDO della squadra in giro. Restituisce gli
 * id assegnati.
 */
export async function prendiDalSerbatoio(tx: Tx, companyId: string, userId: string, ora: Date, quanti: number): Promise<string[]> {
    if (!scortaGeneraleAccesa() || companyId !== FENICE) return []
    if (Date.now() < vuotoFinoA) return []
    const [u] = await tx.select({
        role: users.role, isActive: users.isActive, isBot: users.isBot, isTest: users.isTest, firstName: users.firstName,
        acAutoIntake: users.acAutoIntake, botReturnIntake: users.botReturnIntake,
    }).from(users).where(eq(users.id, userId)).limit(1)
    if (!u || !isTeamMember({ ...u, isActive: !!u.isActive }) || !(u.acAutoIntake || u.botReturnIntake)) return []

    const scelti = daSerbatoio(await leggiSerbatoio(companyId, tx), quanti)
    if (scelti.length === 0) { vuotoFinoA = Date.now() + PAUSA_SE_VUOTO_MS; return [] }
    // Sotto lock, con lo stesso predicato: due GDO insieme non prendono lo stesso lead.
    const presi = await tx.select({ id: leads.id }).from(leads)
        .where(and(nelSerbatoio(companyId), inArray(leads.id, scelti.map(s => s.id))))
        .for('update', { of: leads, skipLocked: true })
    const liberi = new Set(presi.map(p => p.id))
    const ids = scelti.map(s => s.id).filter(id => liberi.has(id))
    if (ids.length === 0) return []

    const base = ora.getTime()
    const fatti: string[] = []
    for (let i = 0; i < ids.length; i++) {
        const quando = new Date(base + i)
        const res = await tx.update(leads).set({
            assignedToId: userId,
            assignedAt: sql`COALESCE(${leads.assignedAt}, ${quando})`,
            scortaStato: 'visibile',
            scortaDal: ora,
            updatedAt: quando,
            version: sql`${leads.version} + 1`,
        }).where(and(eq(leads.id, ids[i]), isNull(leads.assignedToId))).returning({ id: leads.id })
        if (res.length) fatti.push(ids[i])
    }
    if (fatti.length === 0) return []
    await tx.insert(leadEvents).values(fatti.map((id, i) => ({
        id: crypto.randomUUID(), leadId: id, eventType: 'ASSIGNED', userId, timestamp: new Date(base + i),
        metadata: { source: 'scorta_generale', assignedToUser: userId }, companyId,
    })))
    await tx.insert(gdoScortaMovimenti).values({
        id: crypto.randomUUID(), companyId, userId, tipo: 'scorta_generale', quanti: fatti.length, leadIds: fatti, createdAt: ora,
    })
    return fatti
}
