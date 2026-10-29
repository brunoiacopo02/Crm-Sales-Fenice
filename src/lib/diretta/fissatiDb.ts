// Lettura dal DB della squadra e dei fissati della Diretta (definizione in
// ./fissati.ts). La usano la home, l'inizio turno, la pagina Squadra, gli
// scalini personali e i forzieri: numeri mostrati e premi vengono dalla stessa
// query.
//
// Carico: i callLog APPUNTAMENTO delle persone nel periodo passano dall'indice
// per persona e data; lo stato del lead arriva per chiave primaria.

import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { callLogs, leads, users } from '@/db/schema'
import { isTeamMember } from './config'
import { soloValidi } from './fissati'
import { sqlRigaConta } from './inizioAccount'
import { leggiInizioAccount } from './vistaDa'

/** db oppure una transazione: basta che sappia fare select. */
type Lettore = Pick<typeof db, 'select'>

export interface FissatoLetto {
    id: string
    userId: string | null
    leadId: string
    createdAt: Date
}

/**
 * Fissati validi di `userIds` in [start, end), dal più recente: callLog
 * APPUNTAMENTO il cui lead è ancora in appuntamento. Lo stesso lead può
 * comparire più volte (rifissato): i conteggi lo contano una volta.
 */
export async function leggiFissati(
    q: { companyId: string; userIds: readonly string[]; start: Date; end: Date },
    lettore: Lettore = db,
): Promise<FissatoLetto[]> {
    if (q.userIds.length === 0) return []
    // Account ripartito (118, PO 29/10/2026): i fissati di chi c'era prima non sono suoi.
    const inizio = await leggiInizioAccount()
    const righe = await lettore.select({
        id: callLogs.id,
        userId: callLogs.userId,
        leadId: callLogs.leadId,
        createdAt: callLogs.createdAt,
        stato: leads.status,
    })
        .from(callLogs)
        .innerJoin(leads, eq(leads.id, callLogs.leadId))
        .where(and(
            eq(callLogs.companyId, q.companyId),
            q.userIds.length === 1 ? eq(callLogs.userId, q.userIds[0]) : inArray(callLogs.userId, [...q.userIds]),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            gte(callLogs.createdAt, q.start),
            lt(callLogs.createdAt, q.end),
            sqlRigaConta(inizio, callLogs.userId, callLogs.createdAt),
        ))
        .orderBy(desc(callLogs.createdAt), desc(callLogs.id))
    return soloValidi(righe).map(r => ({ id: r.id, userId: r.userId, leadId: r.leadId, createdAt: r.createdAt }))
}

export interface MembroLetto {
    id: string
    role: string
    isActive: boolean
    isBot: boolean | null
    isTest: boolean
    firstName: string | null
    displayName: string | null
    name: string | null
    profileImageUrl: string | null
}

/** La squadra dell'azienda: GDO umani attivi con un nome vero (108, 201 e l'account di prova restano fuori). */
export async function leggiMembriSquadra(companyId: string, lettore: Lettore = db): Promise<MembroLetto[]> {
    const roster = await lettore.select({
        id: users.id,
        role: users.role,
        isActive: users.isActive,
        isBot: users.isBot,
        isTest: users.isTest,
        firstName: users.firstName,
        displayName: users.displayName,
        name: users.name,
        profileImageUrl: users.profileImageUrl,
    })
        .from(users)
        .where(and(
            eq(users.role, 'GDO'),
            eq(users.isActive, true),
            eq(users.isBot, false),
            eq(users.isTest, false),
            isNotNull(users.firstName),
            or(
                eq(users.companyId, companyId),
                sql`${companyId} = ANY(${users.allowedCompanies})`,
            ),
        ))
    return roster.filter(isTeamMember)
}
