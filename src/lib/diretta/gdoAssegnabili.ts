// GDO a cui un admin può dare lead a mano dalle card di /import (accantonati,
// database punteggio alto). Modulo server, NON "use server": così non diventa
// un'azione chiamabile dal browser.

import { and, eq, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema"
import { isTeamMember } from "@/lib/diretta/config"

export type GdoAssegnabile = { id: string; nome: string }

/** GDO della squadra assegnabili nell'azienda attiva: attivi, umani, con nome vero, in ordine di nome. */
export async function gdoAssegnabili(companyId: string): Promise<GdoAssegnabile[]> {
    const righe = await db.select({
        id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, isTest: users.isTest,
        firstName: users.firstName,
    }).from(users).where(and(
        eq(users.role, 'GDO'),
        eq(users.isActive, true),
        or(
            sql`${companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, companyId)),
        ),
    ))
    return righe
        .filter(u => isTeamMember({ ...u, isActive: !!u.isActive }))
        .map(u => ({ id: u.id, nome: u.firstName!.trim() }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
}
