/**
 * Recupero una tantum (PO 25/09/2026): i lead che il bot ha scartato a settembre
 * come "numero inesistente" perché il WhatsApp non arrivava. Un numero senza
 * WhatsApp può essere una linea vera: nessun GDO li aveva mai chiamati a voce.
 *
 * Tiene solo i chiamabili:
 *   - cellulare italiano (3xx, 9-10 cifre) o fisso (0…), dopo aver tolto +39/0039;
 *   - niente cifre ripetute (6+ uguali) né sequenze tipo 1234567;
 *   - niente phoneSuspicious;
 *   - niente infornate a senso unico (lista 133, decisione PO 16/09);
 *   - niente gemello per telefono già vivo nel CRM (status diverso da REJECTED);
 *   - un solo lead per telefono.
 * Gli esteri restano fuori.
 *
 * Assegna a round-robin a GDO 106, 112, 119, come un lead ridato dal bot
 * (status NEW, callCount 0, evento REASSIGNED_FROM_BOT).
 *
 *   node --import tsx --env-file=.env scripts/recupera-senza-whatsapp.ts [--esegui]
 */
import { db } from '@/db'
import { leads, leadEvents, users } from '@/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import crypto from 'node:crypto'
import { BATCH_SENSO_UNICO } from '@/lib/intakeBatch'

const FENICE = 'fenice'
const GDO_CODES = [106, 112, 119]
const ESEGUI = process.argv.includes('--esegui')

function normalizza(phone: string): string {
    const d = phone.replace(/\D/g, '')
    if (d.startsWith('0039')) return d.slice(4)
    if (d.startsWith('39') && d.length >= 11) return d.slice(2)
    return d
}

function motivoScarto(nd: string, sospetto: boolean | null): string | null {
    if (!/^(3[1-9]\d{7,8}|0\d{5,10})$/.test(nd)) return 'formato/estero'
    if (/(\d)\1{5,}/.test(nd) || /(0123456|1234567|2345678|3456789|9876543)/.test(nd)) return 'finto'
    if (sospetto) return 'sospetto'
    return null
}

async function main() {
    const [bot] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.companyId, FENICE), eq(users.gdoCode, 201))).limit(1)
    const gdo = await db.select({ id: users.id, code: users.gdoCode }).from(users)
        .where(and(eq(users.companyId, FENICE), inArray(users.gdoCode, GDO_CODES)))
    if (!bot || gdo.length !== GDO_CODES.length) throw new Error('utenti non trovati')
    gdo.sort((a, b) => (a.code ?? 0) - (b.code ?? 0))

    const candidati = await db.select({
        id: leads.id, phone: leads.phone, name: leads.name, funnel: leads.funnel,
        sospetto: leads.phoneSuspicious, intakeBatch: leads.intakeBatch,
        discardReason: leads.discardReason, callCount: leads.callCount,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        eq(leads.assignedToId, bot.id),
        eq(leads.status, 'REJECTED'),
        sql`lower(trim(${leads.discardReason})) = 'numero inesistente'`,
        sql`${leads.updatedAt} >= '2026-09-01T00:00:00+02:00'`,
    ))

    // Telefoni (ultime 9 cifre) di lead Fenice vivi: un gemello già in lavorazione
    // non va raddoppiato.
    const vivi = await db.select({ k: sql<string>`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9)` })
        .from(leads).where(and(eq(leads.companyId, FENICE), sql`${leads.status} <> 'REJECTED'`))
    const telefoniVivi = new Set(vivi.map(v => v.k))

    const scarti: Record<string, number> = {}
    const visti = new Set<string>()
    const tenuti: typeof candidati = []
    for (const c of candidati) {
        const nd = normalizza(c.phone)
        const k = nd.slice(-9)
        let motivo = motivoScarto(nd, c.sospetto)
        if (!motivo && c.intakeBatch && BATCH_SENSO_UNICO.includes(c.intakeBatch)) motivo = 'lista 133 (senso unico)'
        if (!motivo && telefoniVivi.has(k)) motivo = 'gemello già vivo'
        if (!motivo && visti.has(k)) motivo = 'doppione nel gruppo'
        if (motivo) { scarti[motivo] = (scarti[motivo] ?? 0) + 1; continue }
        visti.add(k)
        tenuti.push(c)
    }

    console.log(`candidati: ${candidati.length}  chiamabili: ${tenuti.length}`)
    console.log('scartati:', scarti)
    const perGdo: Record<number, number> = {}
    tenuti.forEach((_, i) => { const g = gdo[i % gdo.length].code!; perGdo[g] = (perGdo[g] ?? 0) + 1 })
    console.log('ripartizione:', perGdo)
    console.log('esempi:', tenuti.slice(0, 5).map(t => `${t.phone} ${t.funnel}`))
    if (!ESEGUI) { console.log('\nDRY-RUN: nessuna scrittura. Rilancia con --esegui.'); return }

    const now = new Date()
    let scritti = 0, saltati = 0
    for (let i = 0; i < tenuti.length; i++) {
        const c = tenuti[i]
        const g = gdo[i % gdo.length]
        await db.transaction(async (tx) => {
            // Riafferma il predicato: se nel frattempo il lead è cambiato, si salta.
            const res = await tx.update(leads).set({
                status: 'NEW', callCount: 0, assignedToId: g.id,
                assignedAt: sql`COALESCE(${leads.assignedAt}, ${now})`,
                discardReason: null, recallDate: null, recallNote: null, recallMissedAt: null,
                updatedAt: now, version: sql`${leads.version} + 1`,
            }).where(and(
                eq(leads.id, c.id), eq(leads.companyId, FENICE), eq(leads.status, 'REJECTED'),
                eq(leads.assignedToId, bot.id),
                sql`lower(trim(${leads.discardReason})) = 'numero inesistente'`,
            )).returning({ id: leads.id })
            if (res.length === 0) { saltati++; return }
            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(), leadId: c.id, eventType: 'REASSIGNED_FROM_BOT',
                userId: g.id, timestamp: now, companyId: FENICE,
                metadata: {
                    reason: 'mai_risposto', fromBot: bot.id, toGdo: g.id,
                    note: 'recupero_senza_whatsapp_settembre (PO 25/09/2026)',
                    precedente: { status: 'REJECTED', discardReason: c.discardReason, callCount: c.callCount },
                },
            })
            scritti++
        })
    }
    console.log(`\nscritti: ${scritti}  saltati: ${saltati}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
