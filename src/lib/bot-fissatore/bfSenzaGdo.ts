// Lead BLACK FRIDAY ridati dal bot rimasti senza assegnatario (PO 07/11/2026:
// «i BF ridati vanno ai GDO con priorità su tutto, sempre visibili»).
//
// Il ritorno dal bot (reassign.ts) non li parcheggia più, ma possono restare
// senza GDO se in quel momento nessuno ha il flag Ridati acceso (note
// `no_eligible_gdo`), oppure perché parcheggiati prima della regola. Questa
// funzione li riprende e li dà al prossimo GDO del giro dei ridati, con lo
// stesso turno (`prossimoGdoRidati`, tetto ignorato come per i BF ridati).
// Gira alla lettura della pipeline dei GDO (al massimo una volta al minuto
// per istanza) e nel giro serale.
//
// Scrittura come assegna-bf-fermi-09-11 per un lead senza assegnatario:
// assignedToId, assignedAt COALESCE, scortaStato 'visibile', updatedAt ora,
// version + 1, evento REASSIGNED_ADMIN (reason 'bf_senza_gdo',
// fromAssigneeId null, toAssigneeId). Solo lead passati dal bot: un BF fresco
// non assegnato (quarantena, in attesa del push) non si tocca.

import crypto from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leadEvents, leads, users } from '@/db/schema'
import { EVENTO_RIDATO_PARCHEGGIATO } from './iaVocale'
import { prossimoGdoRidati } from './reassign'
import { notificaBfArrivati } from '@/lib/diretta/notificaBfDb'
import { BLACK_FRIDAY_FUNNEL } from '@/lib/acIntake/blackFriday'
import { bfDaRiprendere } from './bfSenzaGdoRegole'

const FENICE = 'fenice'
export const MOTIVO_BF_SENZA_GDO = 'bf_senza_gdo'

const tornatoDalBotSql = sql<boolean>`exists (select 1 from "leadEvents" e where e."leadId" = "leads"."id" and e."eventType" in ('REASSIGNED_FROM_BOT', ${EVENTO_RIDATO_PARCHEGGIATO}))`

async function candidati(): Promise<string[]> {
    const righe = await db.select({
        id: leads.id, assignedToId: leads.assignedToId, status: leads.status, appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt, confirmationsUserId: leads.confirmationsUserId,
        reservedSalespersonId: leads.reservedSalespersonId, isTest: leads.isTest, tornatoDalBot: tornatoDalBotSql,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        eq(leads.funnel, BLACK_FRIDAY_FUNNEL),
        isNull(leads.assignedToId),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
    )).limit(200)
    return righe.filter(r => bfDaRiprendere({ ...r, isTest: !!r.isTest, tornatoDalBot: !!r.tornatoDalBot })).map(r => r.id)
}

/** Riprende i BF senza GDO e li assegna. Ritorna quanti ne ha dati. Mai lancia. */
export async function assegnaBfSenzaGdo(ora: Date = new Date()): Promise<number> {
    try {
        const ids = await candidati()
        if (ids.length === 0) return 0
        const dati: string[] = []
        let i = 0
        for (const id of ids) {
            const ts = new Date(ora.getTime() + i++)
            const ok = await db.transaction(async (tx) => {
                const [l] = await tx.select({
                    assignedToId: leads.assignedToId, status: leads.status, appointmentDate: leads.appointmentDate,
                    presentedAt: leads.presentedAt, confirmationsUserId: leads.confirmationsUserId,
                    reservedSalespersonId: leads.reservedSalespersonId, isTest: leads.isTest, funnel: leads.funnel,
                }).from(leads).where(eq(leads.id, id)).for('update')
                if (!l || l.funnel !== BLACK_FRIDAY_FUNNEL) return false
                if (!bfDaRiprendere({ ...l, isTest: !!l.isTest, tornatoDalBot: true })) return false
                const gdoId = (await prossimoGdoRidati(tx, ts)) ?? (await prossimoGdoRidati(tx, ts, true))
                if (!gdoId) return false
                await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'scorta:' + gdoId}))`)
                await tx.update(leads).set({
                    assignedToId: gdoId, assignedAt: sql`COALESCE(${leads.assignedAt}, ${ts})`,
                    scortaStato: 'visibile', scortaDal: null, updatedAt: ts, version: sql`${leads.version} + 1`,
                }).where(and(eq(leads.id, id), isNull(leads.assignedToId)))
                await tx.update(users).set({ botReturnLastAssignedAt: ts }).where(eq(users.id, gdoId))
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: id, eventType: 'REASSIGNED_ADMIN', userId: null, timestamp: ts,
                    metadata: { reason: MOTIVO_BF_SENZA_GDO, tipo: 'bf_fermo', fromAssigneeId: null, toAssigneeId: gdoId },
                    companyId: FENICE,
                })
                return true
            })
            if (ok) dati.push(id)
        }
        if (dati.length > 0) {
            console.log(`[bf senza GDO] ${dati.length} lead BF dati ai GDO`)
            await notificaBfArrivati(dati, ora)
        }
        return dati.length
    } catch (e) {
        console.error('[bf senza GDO]', e)
        return 0
    }
}

let ultimoGiro = 0
/** Come assegnaBfSenzaGdo, al massimo una volta al minuto per istanza (lettura pipeline). */
export async function assegnaBfSenzaGdoAlPiuOgniMinuto(ora: Date = new Date()): Promise<number> {
    if (ora.getTime() - ultimoGiro < 60_000) return 0
    ultimoGiro = ora.getTime()
    return assegnaBfSenzaGdo(ora)
}
