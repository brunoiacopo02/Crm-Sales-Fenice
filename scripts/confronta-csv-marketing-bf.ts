/**
 * Confronto CSV del marketing ↔ CRM per i lead di una landing (default: Black Friday).
 * SOLA LETTURA: non scrive niente, non chiama AC né il bot.
 *
 *   node --import tsx --env-file=.env.local scripts/confronta-csv-marketing-bf.ts <file.csv> [--pagina blackfriday2026] [--dal 2026-11-07] [--dettaglio] [--json out.json]
 *
 * Il CSV è l'export della landing del marketing (colonne: created_at, pagina, nome,
 * email, telefono, utm_*, ac_status...). Ogni riga è un invio del modulo: la stessa
 * persona può comparire più volte, per questo si conta per PERSONA (telefono, o email
 * se il telefono manca).
 *
 * Per ogni persona del CSV:
 *  - BF            c'è un lead BLACK FRIDAY vero (nel perimetro della pagina BF);
 *  - ALTRO_FUNNEL  c'è un lead con lo stesso telefono/email ma non BLACK FRIDAY;
 *  - SOLO_TEST     c'è solo come lead di prova;
 *  - ASSENTE       nessun lead; si dice se c'è uno scarto in acIntakeFailures.
 * Verso opposto: lead BF del CRM (dal --dal) che non sono nel CSV, divisi per origine
 * (wa.me/inbound, inserzioni, altre). Telefono confrontato sulle ultime 9 cifre.
 */
import fs from 'node:fs'
import Papa from 'papaparse'
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { db } from '../src/db'
import { acIntakeFailures, leadEvents, leads } from '../src/db/schema'

const FENICE = 'fenice'
const BF = 'BLACK FRIDAY'

function arg(nome: string): string | undefined {
    const i = process.argv.indexOf(nome)
    return i > 0 ? process.argv[i + 1] : undefined
}

export function cifre9(t: string | null | undefined): string {
    const d = String(t ?? '').replace(/\D/g, '')
    return d.length >= 9 ? d.slice(-9) : ''
}

const mail = (e: string | null | undefined) => String(e ?? '').trim().toLowerCase()

type Riga = Record<string, string>
type Persona = { chiave: string; tel: string; email: string; nome: string; righe: Riga[]; primo: string }

async function main() {
    const file = process.argv[2]
    if (!file || file.startsWith('--')) throw new Error('uso: confronta-csv-marketing-bf.ts <file.csv> [--pagina p] [--dal yyyy-mm-dd] [--dettaglio] [--json out]')
    const pagina = arg('--pagina') ?? 'blackfriday2026'
    const dalStr = arg('--dal') ?? '2026-11-07'
    const dal = new Date(`${dalStr}T00:00:00+01:00`)
    const dettaglio = process.argv.includes('--dettaglio')

    const testo = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
    const tutte = Papa.parse<Riga>(testo, { header: true, skipEmptyLines: true }).data
    const righe = tutte.filter(r => r.pagina === pagina)

    // Persone: stesso telefono = stessa persona; senza telefono si usa l'email.
    const persone = new Map<string, Persona>()
    for (const r of righe) {
        const tel = cifre9(r.telefono)
        const email = mail(r.email)
        const chiave = tel ? `t:${tel}` : email ? `e:${email}` : `r:${r.event_id || r.created_at}`
        const p = persone.get(chiave) ?? { chiave, tel, email, nome: (r.nome ?? '').trim(), righe: [], primo: r.created_at }
        p.righe.push(r)
        if (r.created_at < p.primo) p.primo = r.created_at
        if (!p.email && email) p.email = email
        persone.set(chiave, p)
    }
    const nelPeriodo = [...persone.values()].filter(p => new Date(p.primo) >= dal)

    const tels = [...new Set([...persone.values()].map(p => p.tel).filter(Boolean))]
    const emails = [...new Set([...persone.values()].map(p => p.email).filter(Boolean))]
    const telSql = sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9)`

    const trovati = await db.select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, funnel: leads.funnel,
        status: leads.status, isTest: leads.isTest, createdAt: leads.createdAt, source: leads.source,
        utmSource: leads.utmSource, utmMedium: leads.utmMedium, utmCampaign: leads.utmCampaign,
        launchBucket: leads.launchBucket, acContactId: leads.acContactId, assignedToId: leads.assignedToId, discardReason: leads.discardReason,
        tel9: sql<string>`${telSql}`,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        or(
            tels.length ? inArray(telSql, tels) : sql`false`,
            emails.length ? inArray(sql`lower(trim(${leads.email}))`, emails) : sql`false`,
        ),
    ))

    const acTrovati = [...new Set(trovati.map(l => l.acContactId).filter((x): x is string => !!x))]
    const scarti = await db.select({
        id: acIntakeFailures.id, acContactId: acIntakeFailures.acContactId, reason: acIntakeFailures.reason, email: acIntakeFailures.email,
        phoneRaw: acIntakeFailures.phoneRaw, createdAt: acIntakeFailures.createdAt, resolvedAt: acIntakeFailures.resolvedAt,
    }).from(acIntakeFailures).where(and(
        eq(acIntakeFailures.companyId, FENICE),
        gte(acIntakeFailures.createdAt, new Date(dal.getTime() - 14 * 864e5)),
        or(
            emails.length ? inArray(sql`lower(trim(${acIntakeFailures.email}))`, emails) : sql`false`,
            tels.length ? inArray(sql`right(regexp_replace(coalesce(${acIntakeFailures.phoneRaw}, ''), '\\D', '', 'g'), 9)`, tels) : sql`false`,
            acTrovati.length ? inArray(acIntakeFailures.acContactId, acTrovati) : sql`false`,
        ),
    ))

    // Perimetro BF della pagina /admin/diretta/black-friday: funnel BF, vero,
    // nato dal `dal` oppure convertito a BF dal `dal`.
    const convertiti = await db.selectDistinct({ leadId: leadEvents.leadId }).from(leadEvents).where(and(
        gte(leadEvents.timestamp, dal),
        or(
            eq(leadEvents.eventType, 'BF_CONVERTITO'),
            and(eq(leadEvents.eventType, 'AC_UPDATED'), sql`${leadEvents.metadata}->'changes' @> ${JSON.stringify([`funnel → ${BF}`])}::jsonb`),
        ),
    ))
    const idConvertiti = new Set(convertiti.map(c => c.leadId))
    const bfCrm = await db.select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, createdAt: leads.createdAt,
        source: leads.source, utmSource: leads.utmSource, utmMedium: leads.utmMedium, utmCampaign: leads.utmCampaign,
        status: leads.status,
    }).from(leads).where(and(eq(leads.companyId, FENICE), eq(leads.funnel, BF), eq(leads.isTest, false)))
    const perimetro = bfCrm.filter(l => l.createdAt >= dal || idConvertiti.has(l.id))

    const perTel = new Map<string, typeof trovati>()
    const perMail = new Map<string, typeof trovati>()
    for (const l of trovati) {
        if (l.tel9) perTel.set(l.tel9, [...(perTel.get(l.tel9) ?? []), l])
        const m = mail(l.email)
        if (m) perMail.set(m, [...(perMail.get(m) ?? []), l])
    }

    const esiti: { persona: Persona; classe: string; motivo: string; lead: typeof trovati }[] = []
    for (const p of nelPeriodo) {
        const cand = new Map<string, (typeof trovati)[number]>()
        for (const l of p.tel ? perTel.get(p.tel) ?? [] : []) cand.set(l.id, l)
        for (const l of p.email ? perMail.get(p.email) ?? [] : []) cand.set(l.id, l)
        const lista = [...cand.values()]
        const veri = lista.filter(l => !l.isTest)
        const bfVeri = veri.filter(l => (l.funnel ?? '').toUpperCase() === BF)
        let classe: string
        let motivo = ''
        // Scarti del webhook AC: per email, telefono o contatto AC dei lead trovati
        // (le righe blocked_list sono una per contatto: la data è quella del primo blocco).
        const acIds = new Set(lista.map(l => l.acContactId).filter(Boolean))
        const sc = scarti.filter(s => (p.email && mail(s.email) === p.email) || (p.tel && cifre9(s.phoneRaw) === p.tel) || (s.acContactId && acIds.has(s.acContactId)))
        const scarto = sc.length ? `acIntakeFailures: ${[...new Set(sc.map(x => x.reason))].join(', ')}${sc.every(x => x.resolvedAt) ? ' (risolto)' : ''}` : ''
        if (bfVeri.length) {
            const nelPerim = bfVeri.some(l => perimetro.some(x => x.id === l.id))
            classe = nelPerim ? 'BF' : 'BF_FUORI_PERIMETRO'
            if (!p.tel) motivo = 'trovato per email'
        } else if (veri.length) {
            classe = 'ALTRO_FUNNEL'
            const dopo = veri.filter(l => l.createdAt.getTime() >= new Date(p.primo).getTime() - 5 * 60e3)
            motivo = (scarto ? `${scarto}; ` : 'nessuno scarto; ') + (dopo.length
                ? `lead nuovo non BF: ${dopo.map(l => `${l.funnel}/${l.status}`).join(', ')}`
                : `solo scheda vecchia`)
        } else if (lista.length) {
            classe = 'SOLO_TEST'
        } else {
            classe = 'ASSENTE'
            motivo = scarto || (p.tel ? 'nessuna traccia' : 'telefono vuoto nel CSV, nessuna traccia')
        }
        if (/^test /i.test(p.nome) || p.righe.every(r => /^test/i.test(r.nome ?? ''))) classe = 'PROVA_MARKETING'
        esiti.push({ persona: p, classe, motivo, lead: lista })
    }

    // Verso opposto: lead BF del CRM che non stanno nel CSV.
    const telCsv = new Set(tels)
    const mailCsv = new Set(emails)
    const fuoriCsv = perimetro.filter(l => !telCsv.has(cifre9(l.phone)) && !(l.email && mailCsv.has(mail(l.email))))
    const origine = (l: (typeof perimetro)[number]) =>
        l.source === 'whatsapp_inbound' || /wa\.me|whatsapp/i.test(`${l.source} ${l.utmSource}`) ? `inbound WhatsApp (${l.source})`
            : `${l.source ?? 'senza source'} / ${l.utmSource ?? '-'} / ${l.utmCampaign ?? '-'}`

    const conta = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => m.set(k(x), (m.get(k(x)) ?? 0) + 1), new Map<string, number>())

    console.log(`CSV: ${tutte.length} righe totali, ${righe.length} della pagina "${pagina}", ${persone.size} persone (${nelPeriodo.length} dal ${dalStr})`)
    console.log(`CRM: ${perimetro.length} lead BF nel perimetro della pagina BF (funnel BF, veri, nati o convertiti dal ${dalStr})`)
    console.log('\nPersone del CSV per esito:')
    for (const [k, n] of conta(esiti, e => e.classe)) console.log(`  ${k.padEnd(20)} ${n}`)
    console.log('\nMotivi (non BF):')
    for (const [k, n] of [...conta(esiti.filter(e => e.classe !== 'BF'), e => `${e.classe}: ${e.motivo.replace(/[a-z0-9]{8}-[a-z0-9-]+/g, '')}`)].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`)
    console.log(`\nLead BF del CRM non presenti nel CSV: ${fuoriCsv.length}`)
    for (const [k, n] of [...conta(fuoriCsv, origine)].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`)

    if (dettaglio) {
        console.log('\nDettaglio persone non BF:')
        for (const e of esiti.filter(e => e.classe !== 'BF')) {
            console.log(`  ${e.persona.primo.slice(0, 16)} ${e.persona.nome.slice(0, 20).padEnd(20)} tel ...${e.persona.tel.slice(-4)} righe=${e.persona.righe.length} ${e.classe} ${e.motivo} ${e.lead.map(l => l.id.slice(0, 8)).join(',')}`)
        }
    }
    const out = arg('--json')
    if (out) {
        fs.writeFileSync(out, JSON.stringify({
            esiti: esiti.map(e => ({ chiave: e.persona.chiave, nome: e.persona.nome, email: e.persona.email, tel: e.persona.tel, primo: e.persona.primo, righe: e.persona.righe.length, utm: e.persona.righe.map(r => [r.utm_source, r.utm_medium, r.utm_campaign]), classe: e.classe, motivo: e.motivo, lead: e.lead })),
            fuoriCsv,
        }, null, 2))
        console.log(`\nJSON scritto in ${out}`)
    }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
