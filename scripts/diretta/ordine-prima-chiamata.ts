/**
 * Prova dell'ordine della 1ª chiamata (PO 10/11/2026), in sola lettura: per i GDO
 * indicati rifà in produzione il calcolo di getPipelineLeads (stesso perimetro di
 * leggiPrimeChiamate, stessa visibilità della scorta, stessa priorità della board,
 * stessa ordinaPrimaChiamata) e stampa le prime N posizioni con il tipo di ciascun
 * lead. Con --prima stampa accanto anche la posizione con l'ordine di prima.
 * Non scrive niente: non classifica gli arrivi e non sblocca la scorta.
 *
 *   node --import tsx --env-file=<env di produzione> scripts/diretta/ordine-prima-chiamata.ts 105 116 [--n 15]
 */

import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '../../src/db'
import { botContactRequests, leads, users } from '../../src/db/schema'
import { dayBoundsRome } from '../../src/lib/dateUtils'
import { ordinaPrimaChiamata, tipoPrimaChiamata } from '../../src/lib/diretta/arrivo'
import { leggiPrimeChiamate } from '../../src/lib/diretta/scortaDb'
import { conStella, eVergine, PESO_ONDATA, prioritaScorta, rangoOndata, visibileInPrimaChiamata } from '../../src/lib/diretta/scorta'
import { isRecoverableCategory } from '../../src/lib/bot-fissatore/contactRequests'
import { LANCIO_BUCKET } from '../../src/lib/lancio/intake'

const FENICE = 'fenice'

async function main() {
    const args = process.argv.slice(2)
    const iN = args.indexOf('--n')
    const n = iN >= 0 ? Number(args[iN + 1]) : 15
    const codici = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--n').map(Number)
    const now = new Date()
    const inizioOggi = dayBoundsRome(now).start

    for (const codice of codici) {
        const [u] = await db.select({ id: users.id, nome: users.firstName, scorta: users.scortaAttiva })
            .from(users).where(and(eq(users.companyId, FENICE), eq(users.gdoCode, codice))).limit(1)
        if (!u) { console.log(`GDO ${codice}: non trovato`); continue }
        const lista = await leggiPrimeChiamate(FENICE, u.id)
        const extra = lista.length ? await db.select({ id: leads.id, name: leads.name, humanTestCohort: leads.humanTestCohort })
            .from(leads).where(inArray(leads.id, lista.map(l => l.id))) : []
        const perId = new Map(extra.map(e => [e.id, e]))
        const richieste = lista.length ? await db.select({ leadId: botContactRequests.leadId, category: botContactRequests.category })
            .from(botContactRequests).where(and(eq(botContactRequests.companyId, FENICE), ne(botContactRequests.status, 'closed'), inArray(botContactRequests.leadId, lista.map(l => l.id)))) : []
        const recover = new Set(richieste.filter(r => isRecoverableCategory(r.category)).map(r => r.leadId))

        const visibili = u.scorta ? lista.filter(l => visibileInPrimaChiamata(l, now)) : lista
        const ondata = rangoOndata(lista, now)
        const righe = visibili.map(l => {
            const chiamaPerPrimo = conStella(l)
            const urgent = (l.cercato ? 2 : 0) + (recover.has(l.id) ? 1 : 0)
            const lancioRank = (chiamaPerPrimo ? 16 : 0) + (perId.get(l.id)?.humanTestCohort ? 8 : 0) + (l.launchBucket === LANCIO_BUCKET ? 4 : 0) + urgent
            const maiContattato = eVergine(l, now)
            return {
                ...l,
                nome: perId.get(l.id)?.name ?? '',
                chiamaPerPrimo, tiHaCercato: l.cercato, maiContattato,
                vergine: maiContattato && l.createdAt.getTime() >= inizioOggi.getTime(),
                prio: u.scorta ? (ondata.get(l.id) ?? 0) * PESO_ONDATA + lancioRank * 8 + prioritaScorta(l, now) : lancioRank,
            }
        })
        const nuovo = ordinaPrimaChiamata(righe, r => r.prio)
        // Ordine di prima (fino al 10/11): BF, vergine del giorno, priorità, arrivo, id.
        const bf = (r: typeof righe[number]) => (r.funnel ?? '').trim().toUpperCase() === 'BLACK FRIDAY'
        const vecchio = [...righe].sort((a, b) => {
            if (bf(a) !== bf(b)) return bf(a) ? -1 : 1
            if (a.vergine !== b.vergine) return a.vergine ? -1 : 1
            const p = b.prio - a.prio
            if (p !== 0) return p
            const t = b.arrivedAt.getTime() - a.arrivedAt.getTime()
            if (t !== 0) return t
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        })
        const posPrima = new Map(vecchio.map((r, i) => [r.id, i + 1]))
        const conteggio = new Map<string, number>()
        for (const r of nuovo) conteggio.set(tipoPrimaChiamata(r), (conteggio.get(tipoPrimaChiamata(r)) ?? 0) + 1)
        console.log(`\nGDO ${codice} ${u.nome} — scorta ${u.scorta ? 'accesa' : 'spenta'}, 1ª chiamata visibile: ${nuovo.length} (${[...conteggio].map(([t, c]) => `${t} ${c}`).join(', ')})`)
        nuovo.slice(0, n).forEach((r, i) => {
            const det = r.ultimoInstradato ? `${r.ultimoMotivo}/${r.ultimoInstradato}` : r.ultimoMotivo ?? (r.passatoDalBot ? 'passato dal bot' : '-')
            console.log(`${String(i + 1).padStart(2)}. ${tipoPrimaChiamata(r).padEnd(15)} ${(r.funnel ?? '').padEnd(14).slice(0, 14)} ${r.nome.slice(0, 22).padEnd(22)} arrivo ${r.arrivedAt.toISOString().slice(5, 16)} motivo ${det}  (prima: ${posPrima.get(r.id)})`)
        })
    }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
