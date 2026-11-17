/**
 * Titolare 16/11/2026: "i lead database come provenienza devono avere tutti database".
 *
 * Dal 16/11 il giro "database al bot" (src/lib/marketingQueue/databaseAlBot.ts) scrive
 * `funnel = 'Database'` quando il bot apre un lead. Questo script fa lo stesso sui lead
 * aperti PRIMA: quelli con un evento `DATABASE_BOT` di apertura (esito `aperto`,
 * `aperto_duplicato`, `apertura_non_partita`) e una provenienza diversa da database.
 * Per ognuno:
 *   - `funnel` → 'Database' (chi e' gia' database, in qualunque grafia, non si tocca);
 *   - un evento `DATABASE_PROVENIENZA` con `funnelPrima`, per poterla rimettere.
 * Cambia SOLO la provenienza: assegnatario, stato, infornata, `launchBucket`, coda
 * marketing (`funnelOrigine` della riga di coda) restano come sono.
 *
 * Idempotente: rilanciato non trova piu' niente da cambiare.
 *
 *   node --import tsx --env-file=.env.production.local scripts/diretta/database-provenienza-recupero.ts [--esegui] [--escludi-lancio]
 *   node --import tsx --env-file=.env.production.local scripts/diretta/database-provenienza-recupero.ts --ripristina [--esegui] [--anche-giro]
 *
 * A secco di default: stampa i conteggi per provenienza di prima e non scrive niente.
 *
 * `--escludi-lancio`: lascia fuori i lead del lancio Web Dev AI (launchBucket), se il
 *   titolare vuole decidere a parte su quelli.
 * `--ripristina`: rimette la provenienza di prima ai lead cambiati dal recupero (solo se
 *   oggi sono ancora database: una provenienza cambiata nel frattempo non si sovrascrive)
 *   e scrive un evento `DATABASE_PROVENIENZA` di ripristino. Con `--anche-giro` anche a
 *   quelli cambiati dal giro del cron (evento `DATABASE_BOT` con `funnelCambiato`).
 */

import crypto from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leadEvents, leads } from '@/db/schema'
import { LANCIO_BUCKET } from '@/lib/lancio/intake'
import {
    ESITI_APERTO_DAL_BOT, EVENTO_DATABASE_BOT, EVENTO_PROVENIENZA_DATABASE, FUNNEL_DATABASE, eFunnelDatabase, funnelNonDatabaseSql,
} from '@/lib/marketingQueue/database'
import { segnaProvenienzaDatabase } from '@/lib/marketingQueue/databaseAlBot'

const FENICE = 'fenice'
const NOTA = 'Titolare 16/11/2026: i lead database come provenienza devono avere tutti database'

function conta<T>(righe: readonly T[], chiave: (r: T) => string): [string, number][] {
    const m = new Map<string, number>()
    for (const r of righe) m.set(chiave(r), (m.get(chiave(r)) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'it'))
}

const etichetta = (funnel: string | null) => funnel ?? '(senza provenienza)'

async function recupero(esegui: boolean, escludiLancio: boolean) {
    const tutti = await db.select({
        id: leads.id, funnel: leads.funnel, launchBucket: leads.launchBucket, intakeBatch: leads.intakeBatch,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        sql.raw(funnelNonDatabaseSql('"leads"."funnel"')),
        // `"leads"."id"` per esteso: in una select a tabella singola Drizzle toglie la
        // qualificazione e dentro la sottoquery `"id"` finirebbe su "leadEvents".
        sql`EXISTS (
            SELECT 1 FROM "leadEvents" e
            WHERE e."leadId" = "leads"."id" AND e."eventType" = ${EVENTO_DATABASE_BOT}
              AND e.metadata->>'esito' IN (${sql.join(ESITI_APERTO_DAL_BOT.map((x) => sql`${x}`), sql`, `)})
        )`,
    ))
    const delLancio = tutti.filter((l) => l.launchBucket === LANCIO_BUCKET)
    const candidati = escludiLancio ? tutti.filter((l) => l.launchBucket !== LANCIO_BUCKET) : tutti

    console.log(`Lead aperti dal bot come database con una provenienza diversa: ${tutti.length}`)
    console.log(`  di cui del lancio Web Dev AI (launchBucket): ${delLancio.length}${escludiLancio ? ' — ESCLUSI (--escludi-lancio)' : ''}`)
    console.log(`Da portare a '${FUNNEL_DATABASE}': ${candidati.length}`)
    console.log('\nPer provenienza di prima:')
    for (const [f, n] of conta(candidati, (l) => etichetta(l.funnel))) console.log(`  ${f}: ${n}`)
    console.log('\nPer infornata:')
    for (const [b, n] of conta(candidati, (l) => l.intakeBatch ?? '(nessuna: scheda lasciata dov\'e\')')) console.log(`  ${b}: ${n}`)

    if (!esegui) {
        console.log('\nA secco: nessuna scrittura. Rilancia con --esegui per applicare.')
        return
    }
    if (candidati.length === 0) return

    const now = new Date()
    const cambiati = await db.transaction(async (tx) => {
        let n = 0
        // Uno alla volta: `segnaProvenienzaDatabase` rilegge la provenienza sotto lock, quindi
        // il `funnelPrima` scritto nell'evento e' quello vero al momento della scrittura.
        for (const l of candidati) {
            const provenienza = await segnaProvenienzaDatabase(tx, l.id, now)
            if (!provenienza.funnelCambiato) continue
            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(), leadId: l.id, eventType: EVENTO_PROVENIENZA_DATABASE, userId: null, timestamp: now,
                metadata: { origine: 'recupero', funnelPrima: provenienza.funnelPrima, funnelDopo: FUNNEL_DATABASE, nota: NOTA },
                companyId: FENICE,
            })
            n++
        }
        return n
    })
    console.log(`\nScritto: ${cambiati} lead portati a '${FUNNEL_DATABASE}' (un evento ${EVENTO_PROVENIENZA_DATABASE} ciascuno).`)
}

async function ripristino(esegui: boolean, ancheGiro: boolean) {
    // Le tracce in ordine di tempo: vale l'ultima per lead.
    const tracce = await db.select({
        leadId: leadEvents.leadId, eventType: leadEvents.eventType, metadata: leadEvents.metadata,
    }).from(leadEvents).where(and(
        eq(leadEvents.companyId, FENICE),
        ancheGiro
            ? sql`(${leadEvents.eventType} = ${EVENTO_PROVENIENZA_DATABASE}
                   OR (${leadEvents.eventType} = ${EVENTO_DATABASE_BOT} AND ${leadEvents.metadata}->>'funnelCambiato' = 'true'))`
            : eq(leadEvents.eventType, EVENTO_PROVENIENZA_DATABASE),
    )).orderBy(asc(leadEvents.timestamp))

    const ultima = new Map<string, { funnelPrima: string | null; ripristinato: boolean }>()
    for (const t of tracce) {
        const m = (t.metadata ?? {}) as { origine?: string; funnelPrima?: string | null }
        ultima.set(t.leadId, { funnelPrima: m.funnelPrima ?? null, ripristinato: m.origine === 'ripristino' })
    }
    const daRimettere = [...ultima].filter(([, t]) => !t.ripristinato).map(([leadId, t]) => ({ leadId, funnelPrima: t.funnelPrima }))

    const oggi = daRimettere.length === 0 ? [] : await db.select({ id: leads.id, funnel: leads.funnel }).from(leads)
        .where(and(eq(leads.companyId, FENICE), inArray(leads.id, daRimettere.map((d) => d.leadId))))
    const funnelOggi = new Map(oggi.map((l) => [l.id, l.funnel]))
    const validi = daRimettere.filter((d) => funnelOggi.has(d.leadId) && eFunnelDatabase(funnelOggi.get(d.leadId)))

    console.log(`Lead con una provenienza da rimettere${ancheGiro ? ' (recupero + giro del cron)' : ' (solo recupero)'}: ${daRimettere.length}`)
    console.log(`  ancora '${FUNNEL_DATABASE}' oggi (si ripristinano): ${validi.length}`)
    console.log(`  cambiati nel frattempo (non si toccano): ${daRimettere.length - validi.length}`)
    console.log('\nPer provenienza da rimettere:')
    for (const [f, n] of conta(validi, (d) => etichetta(d.funnelPrima))) console.log(`  ${f}: ${n}`)

    if (!esegui) {
        console.log('\nA secco: nessuna scrittura. Rilancia con --ripristina --esegui per applicare.')
        return
    }
    if (validi.length === 0) return

    const now = new Date()
    const rimessi = await db.transaction(async (tx) => {
        let n = 0
        for (const d of validi) {
            const [cur] = await tx.select({ funnel: leads.funnel }).from(leads).where(eq(leads.id, d.leadId)).for('update')
            if (!cur || !eFunnelDatabase(cur.funnel)) continue
            await tx.update(leads)
                .set({ funnel: d.funnelPrima, updatedAt: now, version: sql`${leads.version} + 1` })
                .where(eq(leads.id, d.leadId))
            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(), leadId: d.leadId, eventType: EVENTO_PROVENIENZA_DATABASE, userId: null, timestamp: now,
                metadata: { origine: 'ripristino', funnelPrima: cur.funnel, funnelDopo: d.funnelPrima, nota: 'Ripristino della provenienza di prima' },
                companyId: FENICE,
            })
            n++
        }
        return n
    })
    console.log(`\nScritto: ${rimessi} lead riportati alla provenienza di prima.`)
}

async function main() {
    const ha = (nome: string) => process.argv.includes(`--${nome}`)
    if (ha('ripristina')) await ripristino(ha('esegui'), ha('anche-giro'))
    else await recupero(ha('esegui'), ha('escludi-lancio'))
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
