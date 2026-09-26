/**
 * Correzione PO 25/09/2026 sul recupero di recupera-senza-whatsapp.ts: i lead
 * vanno divisi fra QUATTRO GDO (106, 112, 114, 119), non tre. Rifà il
 * round-robin su tutti i lead del recupero ancora intatti (NEW, callCount 0,
 * ancora in mano al GDO a cui li aveva dati il recupero) e sposta solo quelli
 * il cui destinatario cambia.
 *
 *   node --import tsx --env-file=.env scripts/ridistribuisci-senza-whatsapp.ts [--esegui]
 */
import { db } from '@/db'
import { leads, leadEvents, users } from '@/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import crypto from 'node:crypto'

const FENICE = 'fenice'
const GDO_CODES = [106, 112, 114, 119]
const NOTA = 'recupero_senza_whatsapp_settembre (PO 25/09/2026)'
const ESEGUI = process.argv.includes('--esegui')

async function main() {
    const gdo = await db.select({ id: users.id, code: users.gdoCode }).from(users)
        .where(and(eq(users.companyId, FENICE), inArray(users.gdoCode, GDO_CODES)))
    if (gdo.length !== GDO_CODES.length) throw new Error('utenti non trovati')
    gdo.sort((a, b) => (a.code ?? 0) - (b.code ?? 0))

    const recuperati = await db.select({ id: leads.id, assignedToId: leads.assignedToId })
        .from(leads)
        .innerJoin(leadEvents, and(
            eq(leadEvents.leadId, leads.id),
            eq(leadEvents.eventType, 'REASSIGNED_FROM_BOT'),
            sql`${leadEvents.metadata}->>'note' = ${NOTA}`,
        ))
        .where(and(eq(leads.companyId, FENICE), eq(leads.status, 'NEW'), eq(leads.callCount, 0)))
        .orderBy(leads.id)

    // Il nuovo round-robin parte da chi ha già il lead: a parità di quota, si
    // spostano solo gli eccedenti.
    const quota = Math.floor(recuperati.length / gdo.length)
    const resto = recuperati.length % gdo.length
    const target = new Map(gdo.map((g, i) => [g.id, quota + (i < resto ? 1 : 0)]))
    const tenuti = new Map(gdo.map(g => [g.id, 0]))
    const daSpostare: { id: string; da: string | null }[] = []
    for (const l of recuperati) {
        const g = l.assignedToId
        if (g && target.has(g) && tenuti.get(g)! < target.get(g)!) tenuti.set(g, tenuti.get(g)! + 1)
        else daSpostare.push({ id: l.id, da: g })
    }
    const mosse: { id: string; da: string | null; a: string }[] = []
    for (const g of gdo) {
        while (tenuti.get(g.id)! < target.get(g.id)! && daSpostare.length) {
            const l = daSpostare.shift()!
            mosse.push({ ...l, a: g.id })
            tenuti.set(g.id, tenuti.get(g.id)! + 1)
        }
    }
    const code = new Map(gdo.map(g => [g.id, g.code]))
    console.log(`recuperati intatti: ${recuperati.length}  da spostare: ${mosse.length}`)
    console.log('finale per GDO:', Object.fromEntries(gdo.map(g => [g.code, tenuti.get(g.id)])))
    if (!ESEGUI) { console.log('DRY-RUN'); return }

    const now = new Date()
    let scritti = 0, saltati = 0
    for (const m of mosse) {
        await db.transaction(async (tx) => {
            const res = await tx.update(leads)
                .set({ assignedToId: m.a, updatedAt: now, version: sql`${leads.version} + 1` })
                .where(and(eq(leads.id, m.id), eq(leads.status, 'NEW'), eq(leads.callCount, 0),
                    m.da ? eq(leads.assignedToId, m.da) : sql`${leads.assignedToId} is null`))
                .returning({ id: leads.id })
            if (!res.length) { saltati++; return }
            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(), leadId: m.id, eventType: 'ASSIGNED', userId: m.a,
                timestamp: now, companyId: FENICE,
                metadata: { note: 'ridistribuzione recupero senza WhatsApp fra 4 GDO (PO 25/09/2026)', da: m.da, a: m.a, daGdo: code.get(m.da ?? ''), aGdo: code.get(m.a) },
            })
            scritti++
        })
    }
    console.log(`scritti: ${scritti}  saltati: ${saltati}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
