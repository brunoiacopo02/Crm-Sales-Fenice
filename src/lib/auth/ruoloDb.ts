// Ruolo letto da public.users, non dai metadati della sessione (PO 25/10/2026).
//
// I metadati di Supabase Auth li può riscrivere l'utente stesso dal browser
// (auth.updateUser) finché la migrazione 0047 non è applicata, e il trigger
// che poi li blocca ignora i propri errori. Per le azioni ADMIN e MANAGER della
// Diretta (interruttori, obiettivi, bonus Conferme, citazioni, negozio,
// classifica) la fonte è la tabella users: una query per chiave primaria.

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { createClient } from '@/utils/supabase/server'
import { ruoloAmmesso, type RigaRuolo } from './ruolo'

export interface UtenteRuoloDb {
    id: string
    role: string
}

async function rigaInSessione(): Promise<{ id: string; riga: RigaRuolo | undefined } | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const [riga] = await db.select({ role: users.role, isActive: users.isActive })
        .from(users).where(eq(users.id, user.id)).limit(1)
    return { id: user.id, riga }
}

/** Utente in sessione con il suo ruolo nella tabella users; null senza sessione, senza riga o con l'account disattivato. */
export async function ruoloDb(): Promise<UtenteRuoloDb | null> {
    const s = await rigaInSessione()
    return s?.riga?.isActive ? { id: s.id, role: s.riga.role } : null
}

/** L'utente in sessione se nella tabella users ha uno dei `ruoli` (account attivo); altrimenti null. */
export async function conRuoloDb(ruoli: readonly string[]): Promise<UtenteRuoloDb | null> {
    const s = await rigaInSessione()
    return s?.riga && ruoloAmmesso(s.riga, ruoli) ? { id: s.id, role: s.riga.role } : null
}

/**
 * Come conRuoloDb per un utente già preso dalla sessione (ctx.userId di
 * currentTenant), senza rileggere la sessione: solo la riga della tabella users.
 */
export async function haRuoloDb(userId: string, ruoli: readonly string[]): Promise<boolean> {
    const [riga] = await db.select({ role: users.role, isActive: users.isActive })
        .from(users).where(eq(users.id, userId)).limit(1)
    return ruoloAmmesso(riga, ruoli)
}
