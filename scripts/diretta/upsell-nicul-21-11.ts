/**
 * Titolare 21/11/2026: Marina Nicul (c8f0805c, Sales 008, chiusa il 22/09/2026 per
 * 2.079 € gold) ha fatto a novembre un upsell: due righe di amministrazione da 590 €
 * (2770308c del 19/11 e a090c371 del 20/11), totale 1.180 €, "Pagamento programmato".
 * Il titolare vuole i 1.180 € nel fatturato di NOVEMBRE.
 *
 * MECCANISMO REPLICATO (nessun altro esiste, vedi report): e' quello che la
 * riconciliazione fatturato usa per i gia' clienti di ottobre (Monnet 1.450 €,
 * Cervantes 1.187 €, runs 07c0e341 e adfb0d19): famiglia "lead-assente" di
 * applicaCorrezioniCome (src/lib/riconciliazione/engine.ts). Si crea una SCHEDA NUOVA:
 *   leads: funnel 'FUORI FUNNEL', Chiuso, salespersonOutcomeAt = data firma (12:00 UTC),
 *          closeAmountEur = somma del mese, salespersonAssigned/UserId = Sales 008,
 *          NIENTE presentedAt/appointmentDate/assignedToId, closeProduct null;
 *   salesAttempts: un tentativo #0 Chiuso con lo stesso importo;
 *   riconciliazioneRuns (source 'csv') + riconciliazioneEntries (createdLead=true):
 *          la run e' annullabile dalla pagina Riconciliazione;
 *   deal.closed_won nell'outbox marketing (come enqueueMarketingWebhook).
 * UPSELL (titolare 21/11/2026): la scheda nuova nasce con leads.closeIsUpsell = true
 * (migrazione 0064, DA APPLICARE PRIMA: senza la colonna lo script si ferma alla prima
 * lettura). Con il contrassegno i 1.180 € entrano nel fatturato/firmato di novembre di
 * Sales 008 ma la scheda NON conta come chiusura (src/lib/kpi/chiusure.ts): niente +1
 * nel numero di chiusure, nel closing rate, nelle classifiche e nei bonus a numero.
 * La scheda di settembre NON viene toccata.
 * Il foglio Database Clienti di novembre ha le due righe (806, 808) unite in un
 * contratto da 1.180 € del 19/11: con la scheda presente il confronto di novembre la
 * aggancia (telefono|mese, stesso importo, tentativo concorde) e non segnala nulla.
 *
 * Data: la riconciliazione unisce le righe dello stesso mese in un solo contratto e
 * prende la data della prima riga: 19/11/2026 12:00 UTC.
 * NON fa: syncPiumeForLeads (la scheda non ha GDO assegnatario, nessuna piuma comunque).
 *
 * Prima di scrivere controlla: scheda di settembre invariata (Chiuso 2.079 gold, v4,
 * Sales 008), le due righe gestionale (non cancellate, non Stand-by, 590 €, Sales 008,
 * stesso telefono), nessuna scheda FUORI FUNNEL gia' chiusa a novembre per quel telefono.
 * Il ripristino viene scritto PRIMA della transazione.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/upsell-nicul-21-11.ts [--esegui | --ripristina <file>]
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { db } from '../../src/db'
import {
    gestionaleContratti, leadEvents, leads, marketingWebhookDeliveries, riconciliazioneEntries, riconciliazioneRuns, salesAttempts, users,
} from '../../src/db/schema'
import { buildLeadAssenteRow } from '../../src/lib/riconciliazione/leadAssente'
import { resolveAttemptWrite } from '../../src/lib/venditorePerformance/guard'
import { buildDealClosedWon } from '../../src/lib/marketing-webhooks/payload-builders'

const COMPANY_ID = 'fenice'
const ADMIN_ID = 'a9572fa1-1824-49b2-b523-ed68ec262702'
const LEAD_SETTEMBRE = 'c8f0805c-340d-4816-8745-228a141a3162'
const RIGHE = ['2770308c-4cbd-4c5b-8527-b4bd75d6fdac', 'a090c371-b974-4f8f-8c27-0a32be427a6c']
const VENDITORE = 'Sales 008'
const TOTALE = 1180
const FIRMA = new Date('2026-11-19T12:00:00.000Z')
const tel = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(-9)
const dir = path.join(process.cwd(), 'scripts', 'diretta', 'ripristino')

async function ripristina(file: string) {
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'))
    await db.transaction(async (tx) => {
        await tx.delete(riconciliazioneEntries).where(eq(riconciliazioneEntries.runId, snap.runId))
        await tx.delete(riconciliazioneRuns).where(eq(riconciliazioneRuns.id, snap.runId))
        await tx.delete(leadEvents).where(eq(leadEvents.leadId, snap.leadId))
        await tx.delete(salesAttempts).where(eq(salesAttempts.id, snap.attemptId))
        await tx.delete(leads).where(and(eq(leads.id, snap.leadId), eq(leads.funnel, 'FUORI FUNNEL')))
    })
    console.log('Scheda nuova, tentativo e run eliminati. Il deal.closed_won in outbox (se già consegnato) va corretto a mano.')
}

async function main() {
    const iRip = process.argv.indexOf('--ripristina')
    if (iRip >= 0) { await ripristina(process.argv[iRip + 1]); process.exit(0) }
    const esegui = process.argv.includes('--esegui')

    const [sett] = await db.select().from(leads).where(eq(leads.id, LEAD_SETTEMBRE))
    if (!sett) throw new Error('Scheda di settembre non trovata')
    const [venditore] = await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.companyId, COMPANY_ID), eq(users.name, VENDITORE)))
    if (!venditore) throw new Error(`Utente ${VENDITORE} non trovato`)
    const righe = await db.select().from(gestionaleContratti).where(and(...[eq(gestionaleContratti.companyId, COMPANY_ID)]))
        .then(r => r.filter(c => RIGHE.includes(c.id)))
    const gia = (await db.select().from(leads).where(and(
        eq(leads.funnel, 'FUORI FUNNEL'), eq(leads.salespersonOutcome, 'Chiuso'),
        gte(leads.salespersonOutcomeAt, new Date('2026-10-31T23:00:00Z')), lt(leads.salespersonOutcomeAt, new Date('2026-11-30T23:00:00Z')),
    ))).filter(l => tel(l.phone) === tel(sett.phone))

    console.log(`Scheda settembre: ${sett.name} v${sett.version} ${sett.salespersonOutcome} ${sett.closeProduct} ${sett.closeAmountEur} esitoAt=${sett.salespersonOutcomeAt?.toISOString()} venditore=${sett.salespersonAssigned} (NON viene toccata)`)
    for (const c of righe) console.log(`Gestionale ${c.id.slice(0, 8)} firma=${c.dataFirma} ${c.importoTotaleCents / 100}€ stato=${c.statoPagamento} vend=${c.venditoreCode} tel=${c.clienteTelefono} deleted=${c.deletedAt?.toISOString() ?? null}`)

    const problemi: string[] = []
    if (sett.version !== 4 || sett.salespersonOutcome !== 'Chiuso' || Number(sett.closeAmountEur) !== 2079 || sett.salespersonAssigned !== VENDITORE) problemi.push('scheda di settembre cambiata')
    if (righe.length !== 2) problemi.push(`righe gestionale trovate ${righe.length} (attese 2)`)
    for (const c of righe) {
        if (c.deletedAt) problemi.push(`${c.id.slice(0, 8)} cancellata`)
        if ((c.statoPagamento ?? '').trim().toLowerCase() === 'stand-by') problemi.push(`${c.id.slice(0, 8)} in Stand-by`)
        if (c.importoTotaleCents !== 59000) problemi.push(`${c.id.slice(0, 8)} importo ${c.importoTotaleCents / 100}`)
        if (c.venditoreCode !== VENDITORE) problemi.push(`${c.id.slice(0, 8)} venditore ${c.venditoreCode}`)
        if (tel(c.clienteTelefono) !== tel(sett.phone)) problemi.push(`${c.id.slice(0, 8)} telefono diverso`)
        if (!c.dataFirma?.startsWith('2026-11')) problemi.push(`${c.id.slice(0, 8)} firma non a novembre`)
    }
    if (righe.reduce((s, c) => s + c.importoTotaleCents, 0) / 100 !== TOTALE) problemi.push('somma righe diversa da 1.180')
    if (gia.length) problemi.push(`esiste già una scheda FUORI FUNNEL chiusa a novembre per questo telefono (${gia.map(l => l.id).join(',')})`)
    if (problemi.length) { console.log(`\nFERMO: ${problemi.join('; ')}`); process.exit(1) }

    const phone = righe[0].clienteTelefono!.startsWith('+') ? righe[0].clienteTelefono!.replace(/\s/g, '') : `+39${tel(righe[0].clienteTelefono)}`
    const email = (righe[0].clienteEmail ?? '').trim().toLowerCase() || null
    const sheet = { fullName: 'Marina Nicul', email, signedAt: FIRMA, amountEur: TOTALE, salesCode: VENDITORE }
    const leadId = crypto.randomUUID()
    const attemptId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    const entryId = crypto.randomUUID()
    const riga = buildLeadAssenteRow({ leadId, companyId: COMPANY_ID, phone, sheet, salesUserId: venditore.id, upsell: true })
    if (riga.closeIsUpsell !== true) throw new Error('La scheda deve nascere con closeIsUpsell = true')
    const attemptWrite = resolveAttemptWrite({ attempts: [], outcome: 'Chiuso', cycleStartAt: null, leadHasOutcome: false, occasion: 'current' })
    const attemptNumber = attemptWrite.mode === 'insert' ? attemptWrite.attemptNumber : 0

    console.log(`\n--- ${esegui ? 'ESECUZIONE' : 'DRY-RUN'} ---`)
    console.log('leads: INSERT (PRIMA: nessuna riga)  ->  DOPO:')
    console.log(JSON.stringify({ ...riga, salespersonOutcomeAt: riga.salespersonOutcomeAt.toISOString(), '(default colonna)': 'status=NEW, version=1, callCount=0; presentedAt/appointmentDate/assignedToId/closeProduct = null' }, null, 2))
    console.log(`salesAttempts: INSERT #${attemptNumber} outcome=Chiuso closeAmountEur=${TOTALE} outcomeAt=${FIRMA.toISOString()} salesUserId=${venditore.id} closeProduct=null`)
    console.log(`riconciliazioneRuns: INSERT id=${runId} monthKey=2026-11 source=csv appliedBy=ADMIN entryCount=1`)
    console.log(`riconciliazioneEntries: INSERT family=lead-assente createdLead=true before={lead:{},attempt:null} after={lead:{name,email,phone,funnel,closeAmountEur:${TOTALE},closeIsUpsell:true,salespersonOutcome:Chiuso,...},attempt:{...}}`)
    console.log(`Effetto: +${TOTALE} € nel firmato di novembre di ${VENDITORE}, +0 chiusure (closeIsUpsell = true)`)
    console.log('marketingWebhookDeliveries: deal.closed_won (pending) per la scheda nuova')
    console.log(`leadEvents: INSERT eventType=RECONCILED userId=ADMIN metadata=${JSON.stringify({ monthKey: '2026-11', family: 'lead-assente', runId })} (come logLeadEvent dell'engine, dopo la transazione)`)
    console.log(`Scheda settembre ${LEAD_SETTEMBRE}: INVARIATA (Chiuso 2.079 €, 22/09/2026)`)
    console.log('NON eseguito: syncPiumeForLeads (nessun GDO assegnatario)')

    if (!esegui) { console.log('\nDry-run: nessuna scrittura. Rilancia con --esegui.'); process.exit(0) }

    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `upsell-nicul-21-11-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(file, JSON.stringify({ leadId, attemptId, runId, entryId, schedaSettembrePrima: sett, gestionale: righe }, null, 2))
    console.log(`Stato salvato in ${file}`)

    await db.transaction(async (tx) => {
        await tx.insert(riconciliazioneRuns).values({ id: runId, companyId: COMPANY_ID, monthKey: '2026-11', source: 'csv', appliedBy: ADMIN_ID, entryCount: 1 })
        await tx.insert(leads).values(riga)
        await tx.insert(salesAttempts).values({
            id: attemptId, leadId, companyId: COMPANY_ID, salesUserId: venditore.id, attemptNumber,
            outcome: 'Chiuso', outcomeAt: FIRMA, closeAmountEur: TOTALE,
        })
        await tx.insert(riconciliazioneEntries).values({
            id: entryId, runId, leadId, family: 'lead-assente', createdLead: true,
            before: { lead: {}, attempt: null },
            after: {
                lead: { name: sheet.fullName, email, phone, funnel: 'FUORI FUNNEL', closeAmountEur: TOTALE, closeIsUpsell: true, salespersonOutcome: 'Chiuso', salespersonAssigned: VENDITORE, salespersonOutcomeAt: FIRMA.toISOString() },
                attempt: { id: attemptId, outcome: 'Chiuso', outcomeAt: FIRMA.toISOString(), closeProduct: null, attemptNumber, closeAmountEur: TOTALE },
            },
        })
    })
    console.log('Transazione ok')
    await db.insert(leadEvents).values({
        id: crypto.randomUUID(), leadId, eventType: 'RECONCILED', userId: ADMIN_ID, timestamp: new Date(), companyId: COMPANY_ID,
        metadata: { monthKey: '2026-11', family: 'lead-assente', runId },
    })

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId))
    const [actor] = await db.select({ id: users.id, name: users.name, displayName: users.displayName, role: users.role }).from(users).where(eq(users.id, ADMIN_ID))
    const [ultimo] = await db.select({ targetUrl: marketingWebhookDeliveries.targetUrl }).from(marketingWebhookDeliveries)
        .where(eq(marketingWebhookDeliveries.eventType, 'deal.closed_won')).orderBy(desc(marketingWebhookDeliveries.createdAt)).limit(1)
    if (ultimo && !lead.isTest) {
        const envelope = buildDealClosedWon({ lead, actor: actor ?? null, occurredAt: new Date() })
        await db.insert(marketingWebhookDeliveries).values({
            id: envelope.eventId, eventType: envelope.eventType, leadId: lead.id, payload: envelope,
            targetUrl: ultimo.targetUrl, status: 'pending', nextAttemptAt: new Date(),
        }).onConflictDoNothing({ target: marketingWebhookDeliveries.id })
        console.log('deal.closed_won messo in outbox', envelope.eventId)
    }
    console.log(`FATTO: scheda ${leadId} ${lead.funnel} ${lead.salespersonOutcome} ${lead.closeAmountEur}; ripristino ${path.basename(file)}`)
    process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
