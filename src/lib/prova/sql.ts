// Condizioni Drizzle per tenere la prova fuori dai numeri veri (migr. 0050,
// PO 25/10/2026). Le regole sono in ./regole.ts.
//
// Attenzione al FROM: leadVero() e leadDelMondoDi() citano leads."isTest" e
// vanno solo in query che hanno `leads` nel FROM o in una JOIN; accountVero()
// lo stesso con `users`. Per le tabelle che hanno soltanto l'id di chi ha
// scritto la riga (callLogs, leadEvents, ...) c'è nonDaAccountDiProva().

import { eq, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import { leads, users } from '@/db/schema'
import { erroreMondoDiverso, stessoMondo, type ConMarcatore } from './regole'

/** Solo lead veri: per ogni conteggio, pool, ridistribuzione e invio verso l'esterno. */
export function leadVero(): SQL {
    return eq(leads.isTest, false)
}

/** Solo account veri: rose di GDO e Conferme per KPI, classifiche, bonus e instradamento. */
export function accountVero(): SQL {
    return eq(users.isTest, false)
}

/** I lead che vede chi guarda: un account di prova solo quelli di prova, tutti gli altri solo quelli veri. */
export function leadDelMondoDi(viewerDiProva: boolean): SQL {
    return eq(leads.isTest, viewerDiProva)
}

/**
 * Come leadDelMondoDi, ma legge il marcatore dell'account dentro la stessa
 * query (sottoquery per chiave primaria, calcolata una volta): per le letture
 * che girano spesso, come gli avvisi delle Conferme, niente viaggio in più al
 * database. Un account senza riga in users vede i lead veri.
 */
export function leadDelMondoDiAccount(userId: string): SQL {
    return sql`${leads.isTest} = coalesce((select u."isTest" from "users" u where u."id" = ${userId}), false)`
}

/**
 * Righe non scritte da un account di prova, per le tabelle che hanno solo l'id
 * dell'autore (callLogs.userId, leadEvents.userId, ...). Le righe senza autore
 * restano: sono del bot o di sistema.
 */
export function nonDaAccountDiProva(col: AnyPgColumn): SQL {
    return or(
        isNull(col),
        notInArray(col, db.select({ id: users.id }).from(users).where(eq(users.isTest, true))),
    )!
}

/** L'account è di prova (riga di users). Un id sconosciuto non lo è. */
export async function accountDiProva(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false
    const [u] = await db.select({ isTest: users.isTest }).from(users).where(eq(users.id, userId)).limit(1)
    return u?.isTest === true
}

/** Il lead è di prova. Un id sconosciuto non lo è. */
export async function leadDiProva(leadId: string | null | undefined): Promise<boolean> {
    if (!leadId) return false
    const [l] = await db.select({ isTest: leads.isTest }).from(leads).where(eq(leads.id, leadId)).limit(1)
    return l?.isTest === true
}

/**
 * Il messaggio con cui rifiutare se l'account `userId` e il lead (già letto)
 * non stanno dalla stessa parte (prova con prova, vero con vero), altrimenti
 * null. Una lettura per chiave primaria dell'account.
 */
export async function rifiutoMondoDiverso(lead: ConMarcatore, userId: string | null | undefined): Promise<string | null> {
    const account = { isTest: await accountDiProva(userId) }
    return stessoMondo(lead, account) ? null : erroreMondoDiverso(account)
}
