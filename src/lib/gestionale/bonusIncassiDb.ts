// Letture per il bonus incassi del mese (regole pure in ./bonusIncassi.ts).
// Chi chiama decide CHI puo' vedere cosa: un venditore solo se stesso
// (`soloUserId` dalla sessione), manager e admin tutti.

import { db } from '@/db'
import { users, gestionaleContratti, gestionaleIncassi } from '@/db/schema'
import { and, eq, gte, inArray, isNotNull, isNull, lt, type SQL } from 'drizzle-orm'
import { personName } from '@/lib/diretta/config'
import { calcolaBonusIncassi, type BonusIncassi, type ContrattoBonus, type IncassoBonus } from './bonusIncassi'

export type BonusIncassiVenditore = { salesUserId: string; nome: string; codice: string; bonus: BonusIncassi }

/** `dataFirma` e' una data senza ora: il mese va dal giorno 1 al giorno 1 del mese dopo, senza fusi. */
function monthBounds(mese: string): { from: string; to: string } {
    const [y, m] = mese.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    return { from: `${mese}-01`, to: `${next}-01` }
}

/**
 * Stato del bonus incassi nel mese `YYYY-MM`, una riga per venditore (attivo, o
 * con contratti firmati nel mese). `soloUserId` limita a un venditore.
 */
export async function loadBonusIncassiMese(mese: string, opts: { soloUserId?: string; companyFilter?: SQL } = {}): Promise<BonusIncassiVenditore[]> {
    const { from, to } = monthBounds(mese)
    const dove = [eq(users.role, 'VENDITORE')]
    if (opts.soloUserId) dove.push(eq(users.id, opts.soloUserId))
    if (opts.companyFilter) dove.push(opts.companyFilter)

    const [venditori, contratti] = await Promise.all([
        db.select({ id: users.id, name: users.name, displayName: users.displayName, firstName: users.firstName, isActive: users.isActive })
            .from(users).where(and(...dove)),
        db.select({
            id: gestionaleContratti.id, salesUserId: gestionaleContratti.salesUserId, dataFirma: gestionaleContratti.dataFirma,
            importoTotaleCents: gestionaleContratti.importoTotaleCents, statoPagamento: gestionaleContratti.statoPagamento,
            clienteNome: gestionaleContratti.clienteNome, clienteCognome: gestionaleContratti.clienteCognome,
        }).from(gestionaleContratti).where(and(
            isNull(gestionaleContratti.deletedAt),
            gte(gestionaleContratti.dataFirma, from),
            lt(gestionaleContratti.dataFirma, to),
            opts.soloUserId ? eq(gestionaleContratti.salesUserId, opts.soloUserId) : isNotNull(gestionaleContratti.salesUserId),
        )),
    ])

    const ids = contratti.map(c => c.id)
    const incassi: IncassoBonus[] = []
    for (let i = 0; i < ids.length; i += 500) {
        incassi.push(...await db.select({
            contrattoId: gestionaleIncassi.contrattoId, data: gestionaleIncassi.data,
            importoCents: gestionaleIncassi.importoCents, contaCommissione: gestionaleIncassi.contaCommissione,
        }).from(gestionaleIncassi).where(and(isNull(gestionaleIncassi.deletedAt), inArray(gestionaleIncassi.contrattoId, ids.slice(i, i + 500)))))
    }

    const perVenditore = new Map<string, ContrattoBonus[]>()
    for (const c of contratti) {
        if (!c.salesUserId) continue
        const lista = perVenditore.get(c.salesUserId)
        if (lista) lista.push(c); else perVenditore.set(c.salesUserId, [c])
    }
    return venditori
        .filter(v => v.isActive || perVenditore.has(v.id))
        .map(v => ({
            salesUserId: v.id,
            nome: personName(v),
            codice: v.displayName || v.name || '',
            bonus: calcolaBonusIncassi(mese, perVenditore.get(v.id) ?? [], incassi),
        }))
        .sort((a, b) => a.codice.localeCompare(b.codice))
}
