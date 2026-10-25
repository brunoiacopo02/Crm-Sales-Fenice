'use server'

// Email e password di accesso (PO 25/10/2026).
// - Il GDO cambia le sue dal profilo, senza mail di conferma, dando la
//   password attuale.
// - L'admin vede sempre l'email di accesso di tutti e può reimpostare email e
//   password di chiunque: gli account sono strumenti aziendali.
// Il cambio lo fa public.cambia_credenziali (migr. 0053), chiamata solo da qui.
// Il ruolo si legge dalla tabella users, non dai metadati della sessione.

import { randomUUID } from 'crypto'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { notifications, users } from '@/db/schema'
import { conRuoloDb } from '@/lib/auth/ruoloDb'
import { personName } from '@/lib/diretta/config'
import {
    controllaPassword, controllaRichiesta, emailValida, messaggioCredenziali, normalizzaEmail,
    RUOLI_CREDENZIALI_PROPRIE, type ErroreCredenziali,
} from '@/lib/auth/credenziali'

export type EsitoCredenziali = { ok: true } | { ok: false; error: string }

const fallito = (e: ErroreCredenziali): EsitoCredenziali => ({ ok: false, error: messaggioCredenziali(e) })

async function cambia(userId: string, email: string | null, password: string | null): Promise<ErroreCredenziali | null> {
    const res = await db.execute(sql`select public.cambia_credenziali(${userId}, ${email}, ${password}) as esito`)
    const esito = (res as unknown as { esito: string }[])[0]?.esito ?? (res as unknown as { rows?: { esito: string }[] }).rows?.[0]?.esito
    if (esito === 'ok') return null
    if (esito === 'email_usata' || esito === 'utente') return esito
    return 'errore'
}

async function passwordGiusta(userId: string, password: string): Promise<boolean> {
    const res = await db.execute(sql`
        select (encrypted_password = extensions.crypt(${password}, encrypted_password)) as giusta
        from auth.users where id = ${userId}::uuid`)
    const riga = (res as unknown as { giusta: boolean }[])[0] ?? (res as unknown as { rows?: { giusta: boolean }[] }).rows?.[0]
    return riga?.giusta === true
}

/** L'email di accesso di chi guarda (per il modulo del profilo). */
export async function getMieCredenziali(): Promise<{ email: string; puoCambiare: boolean } | null> {
    const io = await conRuoloDb(['GDO', 'CONFERME', 'VENDITORE', 'MANAGER', 'ADMIN'])
    if (!io) return null
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, io.id)).limit(1)
    return { email: u?.email ?? '', puoCambiare: RUOLI_CREDENZIALI_PROPRIE.includes(io.role) }
}

/** Il GDO cambia la sua email e/o la sua password. Serve la password attuale. */
export async function cambiaMieCredenziali(input: { email: string; password: string; ripeti: string; attuale: string }): Promise<EsitoCredenziali> {
    const io = await conRuoloDb(RUOLI_CREDENZIALI_PROPRIE)
    if (!io) return fallito('ruolo')
    try {
        const [u] = await db.select({
            email: users.email, firstName: users.firstName, displayName: users.displayName, name: users.name, isTest: users.isTest,
        }).from(users).where(eq(users.id, io.id)).limit(1)
        if (!u) return fallito('utente')
        const richiesta = controllaRichiesta({ emailAttuale: u.email ?? '', email: input?.email ?? '', password: input?.password ?? '', ripeti: input?.ripeti ?? '' })
        if (!richiesta.ok) return fallito(richiesta.errore)
        if (!input?.attuale || !(await passwordGiusta(io.id, input.attuale))) return fallito('attuale')
        const errore = await cambia(io.id, richiesta.email, richiesta.password)
        if (errore) return fallito(errore)

        // L'admin lo sa sempre: con la nuova email sa con cosa entrare.
        if (!u.isTest) {
            const admins = await db.select({ id: users.id }).from(users)
                .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)))
            const cosa = [richiesta.email ? `email di accesso ora ${richiesta.email}` : null, richiesta.password ? 'password cambiata' : null]
                .filter(Boolean).join(', ')
            if (admins.length) {
                await db.insert(notifications).values(admins.map(a => ({
                    id: randomUUID(),
                    recipientUserId: a.id,
                    type: 'credenziali_cambiate',
                    title: 'Credenziali cambiate',
                    body: `${personName(u)}: ${cosa}. Da Accessi del team le reimposti quando vuoi.`,
                    metadata: { userId: io.id },
                    status: 'unread',
                    createdAt: new Date(),
                    companyId: 'fenice',
                })))
            }
        }
    } catch (e) {
        console.error('[credenziali] cambio del GDO', e)
        return fallito('errore')
    }
    revalidatePath('/profilo')
    return { ok: true }
}

export interface AccessoTeam {
    id: string
    nome: string
    ruolo: string
    email: string
    attivo: boolean
}

/** Solo admin: email di accesso di tutti gli account (bot e prova esclusi). */
export async function getAccessiTeam(): Promise<{ ok: true; righe: AccessoTeam[] } | { ok: false; error: string }> {
    const admin = await conRuoloDb(['ADMIN'])
    if (!admin) return { ok: false, error: 'Non autorizzato.' }
    const righe = await db.select({
        id: users.id, role: users.role, email: users.email, isActive: users.isActive,
        firstName: users.firstName, displayName: users.displayName, name: users.name,
    }).from(users)
        .where(and(sql`coalesce(${users.isBot}, false) = false`, ne(users.role, 'ADMIN')))
        .orderBy(asc(users.role), asc(users.firstName), asc(users.name))
    return {
        ok: true,
        righe: righe.map(r => ({ id: r.id, nome: personName(r), ruolo: r.role, email: r.email ?? '', attivo: r.isActive })),
    }
}

/** Solo admin: nuova email e/o nuova password per un account. */
export async function reimpostaCredenziali(userId: string, input: { email: string; password: string }): Promise<EsitoCredenziali> {
    const admin = await conRuoloDb(['ADMIN'])
    if (!admin) return fallito('ruolo')
    if (typeof userId !== 'string' || !userId) return fallito('utente')
    const email = normalizzaEmail(input?.email)
    const password = input?.password ?? ''
    if (email && !emailValida(email)) return fallito('email')
    if (password) {
        const e = controllaPassword(password)
        if (e) return fallito(e)
    }
    if (!email && !password) return fallito('niente')
    try {
        const [u] = await db.select({ role: users.role, email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
        if (!u) return fallito('utente')
        const errore = await cambia(userId, email && email !== normalizzaEmail(u.email) ? email : null, password || null)
        if (errore) return fallito(errore)
    } catch (e) {
        console.error('[credenziali] reimpostazione admin', e)
        return fallito('errore')
    }
    revalidatePath('/admin/accessi')
    return { ok: true }
}
