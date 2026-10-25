/**
 * Go-live Diretta (PO 25/10/2026): riattivazione degli account GDO.
 *
 *   - 107 (Noemi) e 116 (Lavinia): isActive=true e statsActive=true, tornano a
 *     fissare da lunedì 26/10;
 *   - 118 (Lorenzo, ex Fabio): è già attivo, si garantisce statsActive=true.
 *     Con --118-senza-centralino anche phoneTimeTracked=false: è un setter da
 *     remoto, e se non chiama dal centralino il suo turno nei tabulati
 *     risulterebbe tempo fermo (la scheda "Tempo al telefono" lo escluderebbe).
 *     Da decidere con Bruno: di default non si tocca.
 *
 * Le password sono già impostate (25/10) e le sessioni del 118 revocate: qui
 * si toccano solo i flag della tabella users. I flag dei lead (Freschi, Ridati,
 * Tetto/gg) li scrive lead-instradamento.ts, da lanciare dopo questo.
 *
 * Dry-run di default. Idempotente: rilanciato non trova più niente da cambiare.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/account-attiva.ts [--esegui] [--118-senza-centralino]
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../src/db'
import { users } from '../../src/db/schema'

const FENICE = 'fenice'

type Flag = { isActive: boolean; statsActive: boolean; phoneTimeTracked: boolean }

async function main() {
    const esegui = process.argv.includes('--esegui')
    const senzaCentralino118 = process.argv.includes('--118-senza-centralino')

    const voluti: Record<number, Partial<Flag>> = {
        107: { isActive: true, statsActive: true },
        116: { isActive: true, statsActive: true },
        118: { statsActive: true, ...(senzaCentralino118 ? { phoneTimeTracked: false } : {}) },
    }

    const righe = await db.select({
        id: users.id,
        gdoCode: users.gdoCode,
        firstName: users.firstName,
        isBot: users.isBot,
        isActive: users.isActive,
        statsActive: users.statsActive,
        phoneTimeTracked: users.phoneTimeTracked,
    }).from(users).where(and(
        eq(users.companyId, FENICE),
        eq(users.role, 'GDO'),
        inArray(users.gdoCode, Object.keys(voluti).map(Number)),
    ))

    const piano: { id: string; codice: number; patch: Partial<Flag>; descr: string }[] = []
    for (const codice of Object.keys(voluti).map(Number)) {
        const r = righe.find((x) => x.gdoCode === codice)
        if (!r) { console.log(`GDO ${codice}: account non trovato, salto.`); continue }
        if (r.isBot) { console.log(`GDO ${codice}: è un bot, salto.`); continue }
        const patch: Partial<Flag> = {}
        const cambi: string[] = []
        for (const [k, v] of Object.entries(voluti[codice]) as [keyof Flag, boolean][]) {
            if (r[k] !== v) { patch[k] = v; cambi.push(`${k} ${r[k]} → ${v}`) }
        }
        const nome = r.firstName ? ` ${r.firstName}` : ''
        if (cambi.length === 0) { console.log(`GDO ${codice}${nome}: già a posto.`); continue }
        piano.push({ id: r.id, codice, patch, descr: `GDO ${codice}${nome}: ${cambi.join(', ')}` })
    }

    for (const p of piano) console.log(p.descr)
    if (!senzaCentralino118) console.log('(phoneTimeTracked del 118 non toccato: aggiungi --118-senza-centralino se non usa il centralino)')

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. Rilancia con --esegui per applicare.')
        return
    }
    if (piano.length === 0) return

    await db.transaction(async (tx) => {
        for (const p of piano) {
            await tx.update(users).set(p.patch).where(and(
                eq(users.id, p.id),
                eq(users.companyId, FENICE),
                eq(users.role, 'GDO'),
                eq(users.isBot, false),
            ))
        }
    })
    console.log(`\nScritto: ${piano.length} account aggiornati.`)
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
