// Numeri di una settimana lun-sab per i premi in euro (classifica, bonus
// presenze dei GDO, bonus di squadra delle Conferme). Solo lettura, lato
// server: i conti sono in ./premiSettimana.ts, le stesse definizioni della
// pagina Squadra e della colonna arancione delle Conferme.
//
// Carico: una manciata di query a settimana, lanciate dall'admin quando chiude
// i premi (non a ogni visita).

import { and, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leads, users } from '@/db/schema'
import { countPresences } from '@/lib/presenceCounting'
import { isTeamMember, personName } from '@/lib/diretta/config'
import { contaFissati } from '@/lib/diretta/fissati'
import { leggiFissati } from '@/lib/diretta/fissatiDb'
import { isConfermePersona } from './rules'
import type { NumeriSettimana, SettimanaLunSab } from './premiSettimana'

/** Nome di un account delle Conferme: il nome vero, poi quello storico ("Alberto"), mai "(Conferme)". */
const nomeConferme = (u: { firstName: string | null; name: string | null; displayName: string | null; id: string }) =>
    u.firstName?.trim() || u.name || u.displayName || u.id

export async function leggiNumeriSettimana(companyId: string, s: SettimanaLunSab): Promise<NumeriSettimana> {
    // GDO umani con un nome (fuori 108 e 201). Anche chi è stato disattivato
    // dopo: se ha lavorato quella settimana, il suo bonus va pagato.
    const roster = await db.select({
        id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot,
        firstName: users.firstName, displayName: users.displayName, name: users.name,
    }).from(users).where(and(
        eq(users.role, 'GDO'),
        eq(users.isBot, false),
        isNotNull(users.firstName),
        or(eq(users.companyId, companyId), sql`${companyId} = ANY(${users.allowedCompanies})`),
    ))
    const gdo = roster.filter(u => !!u.firstName?.trim())
    const ids = gdo.map(u => u.id)
    const [presenze, fissati] = await Promise.all([
        Promise.all(ids.map(id => countPresences(id, s.start, s.end, companyId))),
        leggiFissati({ companyId, userIds: ids, start: s.start, end: s.end }),
    ])
    const fissatiPer = contaFissati(fissati).perUtente
    const righeGdo = gdo
        .map((u, i) => ({ u, userId: u.id, nome: personName(u), presenze: presenze[i].total, fissati: fissatiPer[u.id] ?? 0 }))
        .filter(r => isTeamMember(r.u) || r.presenze > 0 || r.fissati > 0)
        .map(r => ({ userId: r.userId, nome: r.nome, presenze: r.presenze, fissati: r.fissati }))

    // Conferme: lead confermati da un account CONFERME, come nella colonna
    // arancione (chiusure per salespersonOutcomeAt, presenze per presentedAt).
    const accountConferme = db.select({ id: users.id }).from(users).where(eq(users.role, 'CONFERME'))
    const confermatiDalleConferme = and(
        eq(leads.companyId, companyId),
        eq(leads.confirmationsOutcome, 'confermato'),
        inArray(leads.confirmationsUserId, accountConferme),
    )
    const [chiusure, presenzeConf, chiHaConfermato] = await Promise.all([
        db.select({ id: leads.id }).from(leads).where(and(
            confermatiDalleConferme,
            eq(leads.salespersonOutcome, 'Chiuso'),
            gte(leads.salespersonOutcomeAt, s.start),
            lt(leads.salespersonOutcomeAt, s.end),
        )),
        db.select({ id: leads.id }).from(leads).where(and(
            confermatiDalleConferme,
            gte(leads.presentedAt, s.start),
            lt(leads.presentedAt, s.end),
        )),
        db.selectDistinct({ userId: leads.confirmationsUserId }).from(leads).where(and(
            confermatiDalleConferme,
            gte(leads.confirmationsTimestamp, s.start),
            lt(leads.confirmationsTimestamp, s.end),
        )),
    ])
    // "A testa": le persone delle Conferme che hanno lavorato la settimana
    // (almeno una conferma), così un account fermo o condiviso non prende niente.
    const idsConferme = chiHaConfermato.map(r => r.userId).filter((x): x is string => !!x)
    const persone = idsConferme.length
        ? await db.select({
            id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot,
            firstName: users.firstName, name: users.name, displayName: users.displayName,
        }).from(users).where(inArray(users.id, idsConferme))
        : []

    return {
        lunedi: s.lunedi,
        gdo: righeGdo,
        conferme: {
            chiusure: chiusure.length,
            presenze: presenzeConf.length,
            persone: persone.filter(isConfermePersona)
                .map(u => ({ userId: u.id, nome: nomeConferme(u) }))
                .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })),
        },
    }
}
