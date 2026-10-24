// Registro unico di Scintille ('S') e Piume ('P') (migr. 0045, PO 25/10/2026).
//
// Ogni movimento ha una chiave idempotente: se la riga esiste già non si
// accredita di nuovo (INSERT ... ON CONFLICT DO NOTHING). Il saldo cache su
// users.scintille / users.piume si aggiorna nella stessa transazione e solo
// se la riga è stata davvero inserita. Gli storni sono righe negative con la
// loro chiave ('storno:<chiave originale>').

import { randomUUID } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { currencyLedger, users } from '@/db/schema'

export type Currency = 'S' | 'P'

export interface CreditInput {
    userId: string
    currency: Currency
    amount: number
    reason: string
    idemKey: string
    leadId?: string | null
    metadata?: Record<string, unknown> | null
    companyId?: string
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Accredita (o addebita, se amount < 0) una volta sola per idemKey. Ritorna true se ha scritto. */
export async function creditOnce(input: CreditInput, tx?: Tx): Promise<boolean> {
    if (!Number.isInteger(input.amount) || input.amount === 0) return false
    const run = async (t: Tx) => {
        const inserted = await t.insert(currencyLedger).values({
            id: randomUUID(),
            userId: input.userId,
            currency: input.currency,
            amount: input.amount,
            reason: input.reason,
            idemKey: input.idemKey,
            leadId: input.leadId ?? null,
            metadata: input.metadata ?? null,
            companyId: input.companyId ?? 'fenice',
        }).onConflictDoNothing({ target: currencyLedger.idemKey }).returning({ id: currencyLedger.id })
        if (inserted.length === 0) return false
        const col = input.currency === 'S' ? users.scintille : users.piume
        await t.update(users)
            .set(input.currency === 'S'
                ? { scintille: sql`${col} + ${input.amount}` }
                : { piume: sql`${col} + ${input.amount}` })
            .where(eq(users.id, input.userId))
        return true
    }
    return tx ? run(tx) : db.transaction(run)
}

/** Storna un accredito precedente (se esiste e non è già stornato). */
export async function reverseOnce(originalIdemKey: string, reason: string, tx?: Tx): Promise<boolean> {
    const run = async (t: Tx) => {
        const [orig] = await t.select().from(currencyLedger).where(eq(currencyLedger.idemKey, originalIdemKey)).limit(1)
        if (!orig) return false
        return creditOnce({
            userId: orig.userId,
            currency: orig.currency as Currency,
            amount: -orig.amount,
            reason,
            idemKey: `storno:${originalIdemKey}`,
            leadId: orig.leadId,
            metadata: { storno: originalIdemKey },
            companyId: orig.companyId,
        }, t)
    }
    return tx ? run(tx) : db.transaction(run)
}
