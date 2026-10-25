// Letture per richiesta della Diretta, condivise da layout e pagina: React
// cache() fa sì che nello stesso render l'interruttore e la riga dell'utente
// si leggano una volta sola, anche se li chiedono in due.

import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { personName } from './config'
import { isDirettaOn } from './settings'

export interface DirettaIo {
    id: string
    /** Nome da mostrare: il vero (firstName) se c'è, altrimenti quello di sessione. */
    nome: string
    /** Solo il nome vero di una persona, mai un codice "GDO 1xx": per il saluto. */
    nomeVero: string | null
    iniziale: string
    immagine: string | null
    scintille: number
    piume: number
}

/** Interruttore della Diretta per ruolo, letto una volta per richiesta. */
export const direttaAccesa = cache((role: string | null | undefined) => isDirettaOn(role))

/** La riga dell'utente per barra in alto, saluto e saldo. */
export const leggiIo = cache(async (userId: string, nomeSessione: string | null): Promise<DirettaIo> => {
    const [u] = await db.select({
        firstName: users.firstName,
        displayName: users.displayName,
        name: users.name,
        profileImageUrl: users.profileImageUrl,
        scintille: users.scintille,
        piume: users.piume,
    }).from(users).where(eq(users.id, userId)).limit(1)
    const nome = u?.firstName?.trim() || nomeSessione?.trim() || (u ? personName(u) : '') || 'Operatore'
    const sessione = nomeSessione?.trim() || null
    const nomeVero = u?.firstName?.trim() || (sessione && !/^gdo\s*\d+$/i.test(sessione) ? sessione : null)
    return {
        id: userId,
        nome,
        nomeVero,
        iniziale: (nomeVero ?? nome).charAt(0).toUpperCase(),
        immagine: u?.profileImageUrl || null,
        scintille: u?.scintille ?? 0,
        piume: u?.piume ?? 0,
    }
})
