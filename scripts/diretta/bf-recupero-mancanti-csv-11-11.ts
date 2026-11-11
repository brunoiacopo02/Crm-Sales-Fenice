/**
 * Recupero delle persone della landing Black Friday che mancano nel CRM (PO 11/11/2026).
 *
 * Parte dal JSON scritto da scripts/confronta-csv-marketing-bf.ts (--json), prende le
 * persone ALTRO_FUNNEL / ASSENTE e le ripassa dal webhook AC di produzione, cioè la
 * stessa strada di un lead BF normale: funnel BLACK FRIDAY, bot fuori tetto, controlli
 * sui doppioni, blocco della lista 137 compreso. Niente SQL a mano.
 *
 *   node --import tsx --env-file=<env di produzione> scripts/diretta/bf-recupero-mancanti-csv-11-11.ts <confronto.json> [--esegui]
 *
 * Env: DATABASE_URL, ACTIVECAMPAIGN_URL, ACTIVECAMPAIGN_API_KEY,
 * ACTIVECAMPAIGN_WEBHOOK_SECRET, CRM_URL (default https://crm-sales-fenice.vercel.app).
 *
 * Dry-run di default: per ogni persona dice se ha già un lead BF (salta), se il
 * contatto AC non ha telefono (salta: il webhook lo scarterebbe), se è ancora iscritto
 * alla lista 137 (salta: il webhook lo bloccherebbe, regola PO del 09/11) o se è
 * PRONTO. Con --esegui chiama il webhook solo per i PRONTI, al massimo 30, e scrive il
 * file di ripristino in scripts/diretta/ripristino/. Ogni lead creato fa partire
 * l'apertura BF del bot (il bot rispetta i suoi orari di invio). Idempotente.
 */
import fs from 'node:fs'
import path from 'node:path'
import { and, eq, or, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { leads } from '../../src/db/schema'

const FENICE = 'fenice'
const LISTA_BLOCCATA = '137'
const LISTA_BF = 'black friday 2026'
const MASSIMO = 30

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

type Esito = { nome: string; email: string; tel: string; primo: string; classe: string; motivo: string }

async function main() {
    const file = process.argv[2]
    if (!file || file.startsWith('--')) throw new Error('uso: bf-recupero-mancanti-csv-11-11.ts <confronto.json> [--esegui]')
    const esegui = process.argv.includes('--esegui')
    const { esiti } = JSON.parse(fs.readFileSync(file, 'utf8')) as { esiti: Esito[] }
    const mancanti = esiti.filter(e => e.classe === 'ALTRO_FUNNEL' || e.classe === 'ASSENTE')

    const liste = ((await ac('lists?limit=100&filters[name]=black')).lists ?? []) as { id: string; name: string }[]
    const listaBf = liste.find(l => l.name.trim().toLowerCase() === LISTA_BF)
    if (!listaBf) throw new Error('lista "Black Friday 2026" non trovata su AC')

    const pronti: { contactId: string; nome: string }[] = []
    for (const p of mancanti) {
        const etichetta = `${p.primo.slice(0, 16)} ${p.nome.slice(0, 18).padEnd(18)}`
        if (!p.email) { console.log(`  ${etichetta} senza email nel CSV: salto`); continue }
        const contatti = ((await ac(`contacts?email=${encodeURIComponent(p.email)}`)).contacts ?? []) as { id: string; phone: string }[]
        const c = contatti[0]
        if (!c) { console.log(`  ${etichetta} contatto AC non trovato: salto`); continue }
        const cifre = String(c.phone ?? '').replace(/\D/g, '').slice(-10)
        const [bf] = await db.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, FENICE), eq(leads.funnel, 'BLACK FRIDAY'), eq(leads.isTest, false),
            cifre.length >= 6
                ? or(eq(leads.acContactId, String(c.id)), sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10) = ${cifre}`)
                : eq(leads.acContactId, String(c.id)),
        )).limit(1)
        if (bf) { console.log(`  ${etichetta} AC ${c.id}: ha già un lead BF (${bf.id.slice(0, 8)}): salto`); continue }
        if (!cifre) { console.log(`  ${etichetta} AC ${c.id}: senza telefono su AC: salto`); continue }
        const iscr = ((await ac(`contacts/${c.id}/contactLists`)).contactLists ?? []) as { list: string; status: string }[]
        if (iscr.some(i => String(i.list) === LISTA_BLOCCATA && String(i.status) === '1')) {
            console.log(`  ${etichetta} AC ${c.id}: ancora iscritto alla lista 137 (il webhook lo bloccherebbe): salto`)
            continue
        }
        console.log(`  ${etichetta} AC ${c.id}: PRONTO`)
        pronti.push({ contactId: String(c.id), nome: p.nome })
        await new Promise(r => setTimeout(r, 250))
    }
    console.log(`\n${pronti.length} pronti su ${mancanti.length} mancanti.`)
    if (!esegui) { console.log('Dry-run: rilancia con --esegui per ripassarli dal webhook.'); return }
    if (pronti.length > MASSIMO) throw new Error(`${pronti.length} pronti, oltre il massimo di ${MASSIMO}: fermo`)

    const crm = process.env.CRM_URL || 'https://crm-sales-fenice.vercel.app'
    const esiti2: unknown[] = []
    for (const c of pronti) {
        const body = new URLSearchParams({ type: 'subscribe', list: String(listaBf.id), 'contact[id]': c.contactId, initiated_by: 'recupero_bf_csv_11_11' })
        const r = await fetch(`${crm}/api/webhooks/activecampaign?secret=${encodeURIComponent(env('ACTIVECAMPAIGN_WEBHOOK_SECRET'))}`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
        })
        const j = await r.json().catch(() => ({}))
        console.log(`  ${c.contactId}: ${r.status} ${JSON.stringify(j)}`)
        esiti2.push({ acContactId: c.contactId, status: r.status, risposta: j })
        await new Promise(res => setTimeout(res, 1500))
    }
    const dir = path.join('scripts', 'diretta', 'ripristino')
    fs.mkdirSync(dir, { recursive: true })
    const out = path.join(dir, `bf-recupero-mancanti-csv-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
    fs.writeFileSync(out, JSON.stringify({
        nota: 'PO 11/11/2026: persone della landing BF mancanti nel CRM ripassate dal webhook AC. Ripristino: i leadId creati sono in risposta.leadId (metterli REJECTED); i lead vecchi non sono stati toccati.',
        esiti: esiti2,
    }, null, 2))
    console.log(`\nRipristino: ${out}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
