/**
 * L'account del bot fissatore (GDO 201) di Fenice.
 *
 * Quattro filtri, non due: `isBot` da solo non basta perché un domani un
 * secondo account automatico (o un bot disattivato) risponderebbe alla stessa
 * query e il lancio finirebbe intestato a lui. Questa è l'unica definizione:
 * `lancioPoolActions.findBotId` e `botGuard.loadLancioLead` la chiamano
 * entrambe, così "chi è il bot" non può divergere fra la card del pool e le
 * API che il bot stesso chiama.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { LANCIO_COMPANY } from './intake'

/** null = l'account non esiste o è disattivo. */
export async function findLancioBotId(): Promise<string | null> {
    const [bot] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, LANCIO_COMPANY),
        eq(users.role, 'GDO'),
        eq(users.isBot, true),
        eq(users.isActive, true),
    )).limit(1)
    return bot?.id ?? null
}
