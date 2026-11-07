/**
 * Recupero dei contatti della lista AC "Black Friday 2026" rimasti fuori dal CRM
 * (PO 07/11/2026). Il 07/11 5 contatti su 7 della lista non sono entrati come lead
 * BLACK FRIDAY: erano contatti AC gia' noti (liste vecchie bloccate 130/133, lista del
 * lancio, o un `update` che riempiva solo gli utm del lead vecchio). Dal commit che
 * accompagna questo script il webhook li riprende; qui si ripassa ogni contatto della
 * lista dal webhook di produzione, cosi' il recupero segue la stessa strada dei lead
 * futuri: lead NUOVO BLACK FRIDAY, assegnato al bot, push al bot ed eventi IMPORTED e
 * ASSIGNED tracciati. I lead vecchi non si toccano.
 *
 *   node --import tsx --env-file=<env di produzione> scripts/diretta/bf-recupero-lista.ts [--esegui]
 *
 * Env: DATABASE_URL, ACTIVECAMPAIGN_URL, ACTIVECAMPAIGN_API_KEY,
 * ACTIVECAMPAIGN_WEBHOOK_SECRET, CRM_URL (default https://crm-sales-fenice.vercel.app).
 *
 * Dry-run di default: elenca i contatti della lista e chi ha gia' un lead BLACK FRIDAY.
 * Con --esegui chiama il webhook per chi non ce l'ha e scrive il file di ripristino in
 * scripts/diretta/ripristino/ (i lead creati: per annullare, metterli REJECTED o
 * cancellarli insieme ai loro eventi). Idempotente: chi ha gia' un lead BLACK FRIDAY
 * viene saltato. ESCLUDI: contatti da non riprendere (numero finto).
 */

import fs from 'node:fs'
import path from 'node:path'
import { and, eq, or, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { leads } from '../../src/db/schema'

const FENICE = 'fenice'
const LISTA = 'black friday 2026'
/** 17955: "test instagram", numero finto (3334567876), nella lista dal 26/10. */
const ESCLUDI = new Set(['17955'])

const env = (k: string) => {
    const v = process.env[k]
    if (!v) throw new Error(`env ${k} mancante`)
    return v
}

async function ac(p: string) {
    const r = await fetch(`${env('ACTIVECAMPAIGN_URL')}/api/3/${p}`, { headers: { 'Api-Token': env('ACTIVECAMPAIGN_API_KEY') } })
    if (!r.ok) throw new Error(`AC ${r.status} su ${p}`)
    return r.json()
}

async function main() {
    const esegui = process.argv.includes('--esegui')
    const liste = ((await ac('lists?limit=100&filters[name]=black')).lists ?? []) as { id: string; name: string }[]
    const lista = liste.find((l) => l.name.trim().toLowerCase() === LISTA)
    if (!lista) throw new Error('lista "Black Friday 2026" non trovata su AC')

    const contatti: { id: string; phone: string; firstName: string }[] = []
    for (let off = 0; ; off += 100) {
        const r = await ac(`contacts?listid=${lista.id}&status=1&limit=100&offset=${off}`)
        contatti.push(...(r.contacts ?? []))
        if (!r.contacts || r.contacts.length < 100) break
    }
    console.log(`Lista ${lista.id} "${lista.name}": ${contatti.length} contatti`)

    const daFare: typeof contatti = []
    for (const c of contatti) {
        const cifre = String(c.phone ?? '').replace(/\D/g, '').slice(-10)
        const [bf] = await db.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, FENICE),
            eq(leads.funnel, 'BLACK FRIDAY'),
            cifre.length >= 6
                ? or(eq(leads.acContactId, String(c.id)), sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10) = ${cifre}`)
                : eq(leads.acContactId, String(c.id)),
        )).limit(1)
        const stato = ESCLUDI.has(String(c.id)) ? 'escluso' : bf ? `gia' BF (${bf.id})` : 'DA RIPRENDERE'
        console.log(`  ${c.id} ${c.firstName ?? ''} ${cifre}: ${stato}`)
        if (!bf && !ESCLUDI.has(String(c.id))) daFare.push(c)
    }
    if (!esegui) {
        console.log(`\nDry-run: ${daFare.length} da riprendere. Rilancia con --esegui.`)
        return
    }

    const crm = process.env.CRM_URL || 'https://crm-sales-fenice.vercel.app'
    const esiti: unknown[] = []
    for (const c of daFare) {
        const body = new URLSearchParams({ type: 'subscribe', list: String(lista.id), 'contact[id]': String(c.id), initiated_by: 'recupero_bf_07_11' })
        const r = await fetch(`${crm}/api/webhooks/activecampaign?secret=${encodeURIComponent(env('ACTIVECAMPAIGN_WEBHOOK_SECRET'))}`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
        })
        const j = await r.json().catch(() => ({}))
        console.log(`  ${c.id}: ${r.status} ${JSON.stringify(j)}`)
        esiti.push({ acContactId: c.id, status: r.status, risposta: j })
        await new Promise((res) => setTimeout(res, 1500))
    }
    const dir = path.join('scripts', 'diretta', 'ripristino')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `bf-recupero-lista-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
    fs.writeFileSync(file, JSON.stringify({
        nota: 'PO 07/11/2026: contatti della lista AC Black Friday 2026 ripresi come lead BLACK FRIDAY (bot). Ripristino: i leadId creati sono in risposta.leadId; i lead vecchi non sono stati toccati.',
        esiti,
    }, null, 2))
    console.log(`\nRipristino: ${file}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
