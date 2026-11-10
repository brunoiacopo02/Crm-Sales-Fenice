/**
 * BF senza WhatsApp fermi sul bot (PO 10/11/2026). Sei lead BLACK FRIDAY hanno
 * ricevuto l'apertura con errore Twilio 63024 (il numero non ha WhatsApp): nessun
 * messaggio consegnato, nessuna risposta, chat ancora 'active' sul bot. La regola
 * di sempre li avrebbe ridati ai GDO solo a 24 ore dall'apertura.
 *
 * Qui si danno SUBITO ai GDO umani in turno (esclusi Noemi 107, Giusy 109,
 * Beatrice 112 e il bot), uno a testa, a chi ha meno BF da chiamare. Stessi campi
 * della restituzione (`reassignBotLeadToHumanPool`, ramo giro GDO): lead NEW,
 * callCount 0, richiamo azzerato, assignedAt con il latch, evento
 * REASSIGNED_FROM_BOT con reason 'mai_risposto' e instradato 'mai_consegnato'
 * (cosi' scorta, statistiche e notifica BF lo leggono come un ridato senza
 * WhatsApp). Poi la notifica BF (`notificaBfArrivati`). Le chat sul bot si
 * chiudono a parte (handed_off_reason 'numero_senza_whatsapp').
 *
 *   node --import tsx --env-file=<env di produzione> scripts/diretta/bf-senza-whatsapp-10-11.ts [--esegui]
 *
 * Dry-run di default. Idempotente: un lead che non e' piu' del bot viene saltato.
 * Ripristino: scripts/diretta/ripristino/bf-senza-whatsapp-<ora>.json (stato di
 * prima di ogni lead e id degli eventi scritti).
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { leads, leadEvents, users } from '../../src/db/schema'
import { notificaBfArrivati } from '../../src/lib/diretta/notificaBfDb'

const FENICE = 'fenice'
const BOT = '867dd21a-3236-46a8-b719-d0b97ff90538'
/** In ordine di arrivo: il piu' vecchio va per primo a chi ha meno BF. */
const LEAD = [
    { conv: 32207, leadId: 'a138bc35-eaac-431b-ab0e-88b42dfb1e5a' },
    { conv: 32220, leadId: '34700036-eb37-40b8-a419-aa01fb1a62ee' },
    { conv: 32239, leadId: '83f0a81b-8863-4324-a102-aa7a612a1309' },
    { conv: 32242, leadId: '639c53e8-a702-4c6f-a870-fbaadd2abe21' },
    { conv: 32259, leadId: '05652695-1718-440b-ad9c-e4dba3824764' },
    { conv: 32297, leadId: '53d8a9c6-4c44-4f4c-b236-96bc71d63ea2' },
]
/**
 * GDO in turno alle 13:50 del 10/11: chi ha chiamato nell'ultima mezz'ora
 * (lastCallDate dei suoi lead). Lavinia 116 non ha chiamate oggi; 107, 109 e 112
 * esclusi dal PO.
 */
const IN_TURNO = [105, 106, 110, 115, 119]
const NOTA_BOT = 'WhatsApp mai consegnato (numero senza WhatsApp, errore Twilio 63024: 1 messaggio inviati, nessuno arrivato). Il numero può essere valido: chiamare a voce.'

async function main() {
    const esegui = process.argv.includes('--esegui')
    const gdo = await db.select({ id: users.id, codice: users.gdoCode, nome: users.firstName }).from(users).where(and(
        eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isActive, true), eq(users.isBot, false),
        inArray(users.gdoCode, IN_TURNO),
    ))
    if (gdo.length !== IN_TURNO.length) throw new Error(`GDO in turno trovati ${gdo.length} su ${IN_TURNO.length}`)

    // BF da chiamare oggi per GDO: aperti, mai chiamati.
    const conti = await db.select({ uid: leads.assignedToId, n: sql<number>`count(*)::int` }).from(leads).where(and(
        eq(leads.companyId, FENICE), inArray(leads.assignedToId, gdo.map(g => g.id)),
        sql`upper(trim(coalesce(${leads.funnel}, ''))) = 'BLACK FRIDAY'`,
        eq(leads.status, 'NEW'), eq(leads.callCount, 0),
    )).groupBy(leads.assignedToId)
    const bf = new Map(gdo.map(g => [g.id, conti.find(c => c.uid === g.id)?.n ?? 0]))
    const ricevuti = new Map(gdo.map(g => [g.id, 0]))
    const codice = new Map(gdo.map(g => [g.id, g.codice ?? 0]))

    const prima = await db.select().from(leads).where(inArray(leads.id, LEAD.map(l => l.leadId)))
    const perId = new Map(prima.map(l => [l.id, l]))

    const piano: { conv: number; leadId: string; nome: string; gdoId: string; gdo: number; bfPrima: number }[] = []
    for (const { conv, leadId } of LEAD) {
        const l = perId.get(leadId)
        if (!l || l.assignedToId !== BOT || l.status !== 'NEW' || l.callCount !== 0) {
            console.log(`  ${leadId}: SALTATO (non piu' del bot o gia' lavorato)`)
            continue
        }
        // Uno a testa: prima chi ne ha ricevuti meno, poi chi ha meno BF, poi il codice.
        const scelto = [...gdo].sort((a, b) =>
            (ricevuti.get(a.id)! - ricevuti.get(b.id)!) || (bf.get(a.id)! - bf.get(b.id)!) || (codice.get(a.id)! - codice.get(b.id)!))[0]
        piano.push({ conv, leadId, nome: l.name, gdoId: scelto.id, gdo: codice.get(scelto.id)!, bfPrima: bf.get(scelto.id)! })
        ricevuti.set(scelto.id, ricevuti.get(scelto.id)! + 1)
        bf.set(scelto.id, bf.get(scelto.id)! + 1)
    }
    for (const p of piano) console.log(`  conv ${p.conv} ${p.nome} -> GDO ${p.gdo} (BF da chiamare prima: ${p.bfPrima})`)
    if (!esegui) {
        console.log(`\nDry-run: ${piano.length} da dare. Rilancia con --esegui.`)
        return
    }

    const now = new Date()
    const eventi: { leadId: string; eventId: string }[] = []
    for (const p of piano) {
        const eventId = crypto.randomUUID()
        const ok = await db.transaction(async (tx) => {
            const res = await tx.update(leads).set({
                status: 'NEW', callCount: 0, recallDate: null, recallNote: null, recallMissedAt: null,
                updatedAt: now, version: sql`${leads.version} + 1`,
                assignedToId: p.gdoId, assignedAt: sql`COALESCE(${leads.assignedAt}, ${now})`,
            }).where(and(eq(leads.id, p.leadId), eq(leads.assignedToId, BOT), eq(leads.callCount, 0)))
                .returning({ id: leads.id })
            if (res.length === 0) return false
            await tx.insert(leadEvents).values({
                id: eventId, leadId: p.leadId, eventType: 'REASSIGNED_FROM_BOT', userId: p.gdoId, timestamp: now,
                metadata: {
                    reason: 'mai_risposto', instradato: 'mai_consegnato', botNote: NOTA_BOT, fromBot: BOT, toGdo: p.gdoId,
                    manuale: 'bf_senza_whatsapp_10_11', motivo: 'numero_senza_whatsapp', conversationId: p.conv,
                },
                companyId: FENICE,
            })
            return true
        })
        console.log(`  ${p.leadId}: ${ok ? 'dato' : 'SALTATO in scrittura'}`)
        if (ok) eventi.push({ leadId: p.leadId, eventId })
    }
    const notifiche = await notificaBfArrivati(eventi.map(e => e.leadId), now)
    console.log(`Notifiche BF scritte: ${notifiche}`)

    const dir = path.join('scripts', 'diretta', 'ripristino')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `bf-senza-whatsapp-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
    fs.writeFileSync(file, JSON.stringify({
        nota: 'PO 10/11/2026: 6 BF con apertura 63024 dati subito ai GDO in turno. Ripristino: rimettere su ogni lead i campi di "prima" (assignedToId del bot, assignedAt, version) e cancellare gli eventi in "eventi"; sul bot riaprire le conversazioni (ai_status active, bot_outcome null, handed_off_reason null).',
        quando: now.toISOString(),
        piano,
        eventi,
        prima: prima.map(l => ({ id: l.id, assignedToId: l.assignedToId, assignedAt: l.assignedAt, status: l.status, callCount: l.callCount, version: l.version, recallDate: l.recallDate, updatedAt: l.updatedAt })),
    }, null, 2))
    console.log(`\nRipristino: ${file}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
