/**
 * Go-live Diretta (PO 25/10/2026), OPZIONE da far scegliere a Bruno: i lead
 * aperti che il GDO 118 ha ereditato da Fabio (180 su Fenice al 25/10, nessuno
 * del lancio) ridistribuiti a parti uguali fra i GDO della squadra.
 *
 * Il 118 da lunedì è Lorenzo, setter da remoto con le stesse logiche dei GDO:
 * se Bruno decide che quei lead restano a lui, questo script non va lanciato.
 *
 * Cosa sposta: lead Fenice NEW/IN_PROGRESS del GDO di partenza, senza
 * appuntamento né presenza, che non siano del lancio (quelli li toglie
 * lead-togli-lancio.ts) e che non siano scarti di un'infornata anomala (come in
 * /gestione, `contaNeiKpiSql`). I lead Serenamente restano dove sono: per GDO e
 * Conferme Serenamente non esiste più.
 *
 * Come: parti uguali, al massimo uno di differenza (`pianoRidistribuzione`).
 * Ogni lead spostato riceve un evento ASSIGNED col destinatario, che diventa la
 * sua "ora di arrivo" nella pipeline. `assignedAt` non si tocca (latch, migr.
 * 0027): il lead era già stato contato quando è entrato in circolo.
 *
 * Destinatari: di default i GDO della squadra (nome vero, attivi, non bot)
 * tranne il GDO di partenza e i codici in --esclusi (default 112,114, in
 * malattia). Con --a=105,106,... si scelgono a mano.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/lead-ridistribuisci-118.ts [--esegui]
 *        [--da=118] [--esclusi=112,114] [--a=105,106,107,110,115,116,119]
 *
 * Dry-run di default. Va lanciato DOPO account-attiva.ts se fra i destinatari
 * ci sono 107 e 116, altrimenti risultano spenti e restano fuori.
 */

import crypto from 'node:crypto'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { leadEvents, leads, users } from '../../src/db/schema'
import { contaNeiKpiSql } from '../../src/lib/intakeBatch'
import { LANCIO_BUCKET, LANCIO_FUNNEL } from '../../src/lib/lancio/intake'
import { pianoRidistribuzione } from '../../src/lib/diretta/instradamento'
import { isTeamMember } from '../../src/lib/diretta/config'

const FENICE = 'fenice'
const VIA = 'diretta_ridistribuzione_118'

function opzione(nome: string): string | undefined {
    const pref = `--${nome}=`
    return process.argv.find((a) => a.startsWith(pref))?.slice(pref.length)
}

function codici(raw: string | undefined, predefiniti: number[]): number[] {
    if (raw === undefined) return predefiniti
    if (raw.trim() === '') return []
    const lista = raw.split(',').map((s) => Number(s.trim()))
    if (lista.some((n) => !Number.isInteger(n))) throw new Error(`codici GDO non validi: ${raw}`)
    return lista
}

async function main() {
    const esegui = process.argv.includes('--esegui')
    const codiceDa = Number(opzione('da') ?? 118)
    const esclusi = codici(opzione('esclusi'), [112, 114])
    const sceltiAMano = opzione('a') === undefined ? null : codici(opzione('a'), [])

    const gdos = await db.select({
        id: users.id, gdoCode: users.gdoCode, role: users.role, isActive: users.isActive,
        isBot: users.isBot, firstName: users.firstName,
    }).from(users).where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO')))

    const da = gdos.find((g) => g.gdoCode === codiceDa)
    if (!da) throw new Error(`GDO ${codiceDa} non trovato`)

    const destinatari = gdos.filter((g) => {
        if (g.id === da.id || g.gdoCode == null) return false
        if (sceltiAMano) return sceltiAMano.includes(g.gdoCode) && g.isActive && !g.isBot
        return isTeamMember(g) && !esclusi.includes(g.gdoCode)
    }).sort((a, b) => (a.gdoCode ?? 0) - (b.gdoCode ?? 0))
    if (sceltiAMano) {
        const mancanti = sceltiAMano.filter((c) => !destinatari.some((g) => g.gdoCode === c))
        if (mancanti.length) throw new Error(`destinatari non validi o spenti: ${mancanti.join(', ')}`)
    }

    // Stesso predicato in lettura e in scrittura: un lead che nel frattempo il
    // GDO ha fissato, scartato o che è stato spostato non viene toccato.
    const predicato = and(
        eq(leads.companyId, FENICE),
        eq(leads.assignedToId, da.id),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.presentedAt),
        isNull(leads.appointmentDate),
        contaNeiKpiSql(),
        // Il lancio lo toglie lead-togli-lancio.ts: qui non si ridistribuisce.
        or(isNull(leads.launchBucket), ne(leads.launchBucket, LANCIO_BUCKET)),
        or(isNull(leads.funnel), ne(leads.funnel, LANCIO_FUNNEL)),
        isNull(leads.lancioPool),
        isNull(leads.humanTestCohort),
    )

    const candidati = await db.select({ id: leads.id, callCount: leads.callCount, recallDate: leads.recallDate })
        .from(leads).where(predicato)

    console.log(`Lead aperti del GDO ${codiceDa} da ridistribuire: ${candidati.length}`)
    console.log(`  mai chiamati: ${candidati.filter((l) => l.callCount === 0).length}, già chiamati: ${candidati.filter((l) => l.callCount > 0).length}, con richiamo: ${candidati.filter((l) => l.recallDate).length}`)
    console.log(`Destinatari (${destinatari.length}): ${destinatari.map((g) => `${g.gdoCode} ${g.firstName ?? ''}`.trim()).join(', ') || 'nessuno'}`)

    const piano = pianoRidistribuzione(candidati.map((l) => l.id), destinatari.map((g) => g.id))
    const perDest = new Map<string, string[]>()
    for (const s of piano) perDest.set(s.a, [...(perDest.get(s.a) ?? []), s.leadId])
    for (const g of destinatari) console.log(`  ${g.gdoCode}: ${perDest.get(g.id)?.length ?? 0}`)

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. Rilancia con --esegui per applicare.')
        return
    }
    if (piano.length === 0) {
        console.log('Niente da spostare.')
        return
    }

    const now = new Date()
    const spostati = await db.transaction(async (tx) => {
        let totale = 0
        for (const [dest, ids] of perDest) {
            const fatti = await tx.update(leads)
                .set({ assignedToId: dest, updatedAt: now, version: sql`${leads.version} + 1` })
                .where(and(predicato, inArray(leads.id, ids)))
                .returning({ id: leads.id })
            if (fatti.length === 0) continue
            await tx.insert(leadEvents).values(fatti.map((l) => ({
                id: crypto.randomUUID(),
                leadId: l.id,
                eventType: 'ASSIGNED',
                userId: dest,
                timestamp: now,
                metadata: { via: VIA, da: da.id, a: dest, assignedToUser: dest },
                companyId: FENICE,
            })))
            totale += fatti.length
        }
        return totale
    })
    console.log(`\nScritto: ${spostati} lead spostati dal GDO ${codiceDa}.`)
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
