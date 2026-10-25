/**
 * Ripartenza 26/10/2026 (PO 25/10/2026 sera): la quarta chiamata ("4ª Recupero")
 * si svuota per tutti i GDO, da lunedì si riparte da 0.
 *
 * Chi sta nella coda: lead REJECTED con callCount 3 e causale
 * "irreperibile (3 tentativi vuoti)" (o il vecchio refuso "irriperebile"),
 * scartati negli ultimi 30 giorni, assegnati a un GDO (getPipelineLeads in
 * src/app/actions/pipelineActions.ts). Sono GIÀ scartati: la coda li ripesca
 * per un ultimo tentativo. "Scartarli" qui vuol dire chiudere quel ripescaggio
 * per sempre, senza falsare niente:
 *   - discardReason diventa "irreperibile (3 tentativi vuoti) - ripartenza
 *     26/10: quarta chiamata svuotata". Il prefisso "irreperibile" resta, così
 *     il codice marketing (UNREACHABLE) e ogni analisi per prefisso non
 *     cambiano; la coda, che vuole la causale esatta, non li trova più.
 *   - stato, callCount e updatedAt restano come sono. updatedAt NON si tocca:
 *     il feed /api/bot/lead-status e il throughput di /kpi-gdo leggono
 *     updatedAt, e un aggiornamento in blocco li inonderebbe.
 *   - version + 1 (lock ottimistico di chi avesse la card aperta).
 *   - un evento QUARTA_CHIAMATA_SVUOTATA per lead con la causale di prima,
 *     per poterlo ripristinare (--ripristina).
 *
 * Perché non lo scarto standard (updateLeadOutcome DA_SCARTARE): scriverebbe
 * un callLog finto (una chiamata mai fatta nei KPI), porterebbe callCount a 4
 * e, cambiando la causale, accoderebbe un webhook marketing `lead.rejected`
 * per ogni lead (acceso in prod). Questo script non chiama nessun effetto
 * esterno: niente webhook, niente bot, niente ActiveCampaign, niente notifiche.
 * Resta il trigger di broadcast su leads, che è per istruzione e per company:
 * un solo segnale "leads cambiati" per tutto il blocco.
 *
 * Non si toccano: lead con appuntamento, presenza o esito/chiusura del
 * venditore; i lead del lancio (la coda li filtra già); Serenamente (solo
 * company fenice); il bot fissatore; i lead di prova se non di un GDO di prova.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/quarta-chiamata-svuota.ts [--esegui | --ripristina]
 *
 * Dry-run di default: stampa quanti lead e di chi.
 */

import crypto from 'node:crypto'
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { leadEvents, leads, users } from '../../src/db/schema'
import { LANCIO_BUCKET, LANCIO_FUNNEL } from '../../src/lib/lancio/intake'

const FENICE = 'fenice'
const EVENTO = 'QUARTA_CHIAMATA_SVUOTATA'
const NOTA = 'Ripartenza 26/10: quarta chiamata svuotata'
const CAUSALI_CODA = ['irreperibile (3 tentativi vuoti)', 'irriperebile (3 tentativi vuoti)']
const NUOVA_CAUSALE = 'irreperibile (3 tentativi vuoti) - ripartenza 26/10: quarta chiamata svuotata'

async function ripristina() {
    const eventi = await db.select({ leadId: leadEvents.leadId, metadata: leadEvents.metadata })
        .from(leadEvents)
        .where(and(eq(leadEvents.companyId, FENICE), eq(leadEvents.eventType, EVENTO)))
    console.log(`Eventi ${EVENTO}: ${eventi.length}`)
    if (!process.argv.includes('--esegui')) {
        console.log('Dry-run: aggiungi --esegui a --ripristina per rimettere le causali di prima.')
        return
    }
    let n = 0
    await db.transaction(async (tx) => {
        for (const e of eventi) {
            const prima = (e.metadata as { discardReasonPrima?: string } | null)?.discardReasonPrima
            if (!prima) continue
            const r = await tx.update(leads)
                .set({ discardReason: prima, version: sql`${leads.version} + 1` })
                .where(and(eq(leads.id, e.leadId), eq(leads.discardReason, NUOVA_CAUSALE)))
                .returning({ id: leads.id })
            n += r.length
        }
    })
    console.log(`Ripristinati: ${n}`)
}

async function main() {
    if (process.argv.includes('--ripristina')) return ripristina()
    const esegui = process.argv.includes('--esegui')

    const gdo = await db.select({ id: users.id, gdoCode: users.gdoCode })
        .from(users)
        .where(and(eq(users.role, 'GDO'), eq(users.isBot, false)))
    const codice = new Map(gdo.map((u) => [u.id, u.gdoCode]))
    if (gdo.length === 0) return console.log('Nessun GDO: niente da fare.')

    const trentaGiorniFa = new Date(Date.now() - 30 * 86_400_000)

    // Stesso predicato in lettura e in scrittura.
    const predicato = and(
        eq(leads.companyId, FENICE),
        eq(leads.status, 'REJECTED'),
        eq(leads.callCount, 3),
        inArray(leads.discardReason, CAUSALI_CODA),
        gte(leads.updatedAt, trentaGiorniFa),
        inArray(leads.assignedToId, gdo.map((u) => u.id)),
        isNull(leads.appointmentDate),
        isNull(leads.presentedAt),
        isNull(leads.salespersonOutcome),
        isNull(leads.closeAmountEur),
        // Fuori il lancio, come nella coda (eLeadDelLancio).
        or(isNull(leads.launchBucket), sql`${leads.launchBucket} <> ${LANCIO_BUCKET}`),
        or(isNull(leads.funnel), sql`${leads.funnel} <> ${LANCIO_FUNNEL}`),
        isNull(leads.lancioPool),
        isNull(leads.humanTestCohort),
        // Prova: un lead di prova solo se è di un GDO di prova, e viceversa.
        sql`${leads.isTest} = coalesce((select u."isTest" from "users" u where u."id" = ${leads.assignedToId}), false)`,
    )

    const candidati = await db.select({
        id: leads.id,
        assignedToId: leads.assignedToId,
        discardReason: leads.discardReason,
    }).from(leads).where(predicato)

    const perGdo = new Map<string, number>()
    for (const l of candidati) {
        const k = String(codice.get(l.assignedToId ?? '') ?? l.assignedToId)
        perGdo.set(k, (perGdo.get(k) ?? 0) + 1)
    }
    console.log(`Lead in quarta chiamata da svuotare: ${candidati.length}`)
    for (const [g, n] of [...perGdo].sort()) console.log(`  GDO ${g}: ${n}`)

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. Rilancia con --esegui per applicare.')
        return
    }
    if (candidati.length === 0) return

    const now = new Date()
    const fatti = await db.transaction(async (tx) => {
        const bloccati = await tx.select({
            id: leads.id,
            assignedToId: leads.assignedToId,
            discardReason: leads.discardReason,
        }).from(leads)
            .where(and(predicato, inArray(leads.id, candidati.map((l) => l.id))))
            .for('update')
        if (bloccati.length === 0) return 0

        await tx.update(leads)
            .set({ discardReason: NUOVA_CAUSALE, version: sql`${leads.version} + 1` })
            .where(and(predicato, inArray(leads.id, bloccati.map((l) => l.id))))

        await tx.insert(leadEvents).values(bloccati.map((l) => ({
            id: crypto.randomUUID(),
            leadId: l.id,
            eventType: EVENTO,
            userId: null,
            fromSection: 'Quarta chiamata',
            toSection: 'Scartati',
            timestamp: now,
            metadata: {
                nota: NOTA,
                gdo: l.assignedToId,
                discardReasonPrima: l.discardReason,
                discardReasonDopo: NUOVA_CAUSALE,
            },
            companyId: FENICE,
        })))
        return bloccati.length
    })
    console.log(`\nScritto: ${fatti} lead tolti dalla quarta chiamata.`)
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
