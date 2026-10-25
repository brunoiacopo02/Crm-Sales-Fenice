/**
 * Go-live Diretta (PO 25/10/2026): i lead del lancio Web Dev AI si tolgono ai GDO.
 *
 * Ripete l'operazione del 24/10 (memoria project_lancio_tolto_ai_gdo) su quello
 * che fosse rientrato nel frattempo, per esempio da una redistribuzione dei
 * "non assegnati" con il funnel del lancio. Per ogni lead aperto (NEW o
 * IN_PROGRESS) del lancio in mano a un GDO umano:
 *   - assignedToId → null, lancioPool → 'ARCHIVIATO';
 *   - evento RIDATO_PARCHEGGIATO, motivo 'lancio_tolto_a_tutti', con `tolto_a`
 *     e `recallDate` nei metadata, per poterlo ripristinare;
 *   - stato, callCount e richiamo restano come sono (come il 24/10).
 *
 * "Del lancio" = `eLeadDelLancio`: bucket LANCIO_WEBDEV_2026, funnel 'Lancio
 * Web Dev AI', lancioPool o gruppo di prova valorizzati. I pool database (DB_*)
 * non sono il lancio. Non si toccano appuntamenti, presenze, scartati e i lead
 * del bot (chi scrive al bot lo gestisce il bot).
 *
 * Al 25/10/2026 sera la SELECT di controllo trovava 0 lead da togliere: lo
 * script serve a chiudere il varco fino al go-live, ed è idempotente (un lead
 * tolto non è più di nessun GDO, quindi non ricompare).
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/lead-togli-lancio.ts [--esegui]
 *
 * Dry-run di default: stampa quanti lead e di chi.
 */

import crypto from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { leadEvents, leads, users } from '../../src/db/schema'
import { LANCIO_BUCKET, LANCIO_FUNNEL } from '../../src/lib/lancio/intake'

const FENICE = 'fenice'
const NOTA = 'PO 25/10/2026: go-live Diretta, lead del lancio tolti ai GDO'

async function main() {
    const esegui = process.argv.includes('--esegui')

    const umani = await db.select({ id: users.id, gdoCode: users.gdoCode })
        .from(users)
        .where(and(eq(users.role, 'GDO'), eq(users.isBot, false)))
    const idUmani = umani.map((u) => u.id)
    const codice = new Map(umani.map((u) => [u.id, u.gdoCode]))
    if (idUmani.length === 0) {
        console.log('Nessun GDO umano: niente da fare.')
        return
    }

    // Stesso predicato in lettura e in scrittura: un lead cambiato di mano fra
    // la SELECT e la transazione non viene toccato.
    const predicato = and(
        eq(leads.companyId, FENICE),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.presentedAt),
        isNull(leads.appointmentDate),
        inArray(leads.assignedToId, idUmani),
        or(
            eq(leads.launchBucket, LANCIO_BUCKET),
            eq(leads.funnel, LANCIO_FUNNEL),
            isNotNull(leads.lancioPool),
            isNotNull(leads.humanTestCohort),
        ),
    )

    const candidati = await db.select({
        id: leads.id,
        assignedToId: leads.assignedToId,
        recallDate: leads.recallDate,
    }).from(leads).where(predicato)

    const perGdo = new Map<string, number>()
    for (const l of candidati) {
        const k = String(codice.get(l.assignedToId ?? '') ?? l.assignedToId)
        perGdo.set(k, (perGdo.get(k) ?? 0) + 1)
    }
    console.log(`Lead del lancio aperti in mano ai GDO: ${candidati.length}`)
    for (const [gdo, n] of [...perGdo].sort()) console.log(`  GDO ${gdo}: ${n}`)
    console.log(`  di cui con richiamo: ${candidati.filter((l) => l.recallDate).length}`)

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. Rilancia con --esegui per applicare.')
        return
    }
    if (candidati.length === 0) return

    const now = new Date()
    const tolti = await db.transaction(async (tx) => {
        // Rilettura sotto lock con lo stesso predicato: il `tolto_a` scritto
        // nell'evento è quello vero al momento della scrittura.
        const bloccati = await tx.select({
            id: leads.id,
            assignedToId: leads.assignedToId,
            recallDate: leads.recallDate,
        }).from(leads)
            .where(and(predicato, inArray(leads.id, candidati.map((l) => l.id))))
            .for('update')
        if (bloccati.length === 0) return 0

        await tx.update(leads)
            .set({ assignedToId: null, lancioPool: 'ARCHIVIATO', updatedAt: now, version: sql`${leads.version} + 1` })
            .where(and(predicato, inArray(leads.id, bloccati.map((l) => l.id))))

        await tx.insert(leadEvents).values(bloccati.map((l) => ({
            id: crypto.randomUUID(),
            leadId: l.id,
            eventType: 'RIDATO_PARCHEGGIATO',
            userId: null,
            timestamp: now,
            metadata: {
                nota: NOTA,
                motivo: 'lancio_tolto_a_tutti',
                tolto_a: l.assignedToId,
                recallDate: l.recallDate ? l.recallDate.toISOString() : null,
            },
            companyId: FENICE,
        })))
        return bloccati.length
    })
    console.log(`\nScritto: ${tolti} lead tolti ai GDO (lancioPool ARCHIVIATO).`)
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
