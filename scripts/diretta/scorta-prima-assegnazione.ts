/**
 * Accensione della scorta delle prime chiamate (PO 29/10/2026) per i GDO del giro.
 *
 * Per ogni GDO: in prima chiamata restano visibili i vergini (ultimi 7 giorni),
 * le stelle (chat interrotte, chi ha scritto, chat riprese) e i "Ti ha cercato",
 * più i 40 migliori del resto (stella > letti JOB SIMULATOR/TELEGRAM > letti
 * CORSO 10 ORE > resto, i più recenti prima). Gli altri vanno nella scorta: restano
 * assegnati al GDO con stato e tentativi invariati, la ricerca li trova, e si
 * sbloccano 30 alla volta quando il GDO non ha più niente da chiamare.
 * Poi si accende l'interruttore users.scortaAttiva. Regole: src/lib/diretta/scorta.ts.
 * La stessa accensione (accendiScorta di scortaDb) c'è per un GDO alla volta nel
 * monitor di /import (solo ADMIN), con Spegni e Sblocca 30.
 *
 * Scrive solo users.scortaAttiva, leads.scortaStato/scortaDal e i movimenti
 * (gdoScortaMovimenti). Assegnatari, stati, tentativi, updatedAt e version non si
 * toccano: distribuzione e KPI non cambiano.
 *
 * Richiede la migrazione 0059 applicata. La prova a vuoto funziona anche senza.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/scorta-prima-assegnazione.ts
 *        [--esegui | --ripristina [--file=...] [--esegui]]
 */

import fs from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { users } from '../../src/db/schema'
import { conStella, eVergine, primaAssegnazione, rangoScorta, SBLOCCO, VISIBILI_INIZIALI, type LeadScorta } from '../../src/lib/diretta/scorta'
import { accendiScorta, leggiPrimeChiamate, spegniScorta } from '../../src/lib/diretta/scortaDb'

const FENICE = 'fenice'
const CARTELLA_RIPRISTINO = 'C:/Users/bruno/Desktop/CRM GDO/scripts/diretta/ripristino'
const PREFISSO_FILE = 'scorta-prima-assegnazione-'
/** 107 è Noemi, appena entrata: i suoi lead vengono dalla ridistribuzione del 30/10. */
const GDO = [105, 106, 107, 110, 115, 116, 119] as const

interface RigaRipristino { gdoId: string; gdoCode: number; scortaAttivaPrima: boolean }

const opzione = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3)

async function migrazioneApplicata(): Promise<boolean> {
    const r = await db.execute(sql`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'scortaStato'`)
    return r.rows.length > 0
}

function conta(lista: readonly LeadScorta[], ids: readonly string[]) {
    const perId = new Map(lista.map((l) => [l.id, l]))
    const sel = ids.map((id) => perId.get(id)!).filter(Boolean)
    const r = [0, 0, 0, 0]
    for (const l of sel) r[rangoScorta(l)]++
    return { stelle: r[3], lettiJsTg: r[2], lettiC10: r[1], resto: r[0] }
}

const giorno = (d: Date) => d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function main() {
    const esegui = process.argv.includes('--esegui')
    if (process.argv.includes('--ripristina')) return annulla(esegui)

    const applicata = await migrazioneApplicata()
    if (!applicata) console.log('ATTENZIONE: migrazione 0059 NON applicata. Prova a vuoto senza le colonne della scorta.\n')
    if (esegui && !applicata) throw new Error('Applica prima la migrazione 0059: niente da scrivere.')

    const tutti = await db.select({
        id: users.id, gdoCode: users.gdoCode, firstName: users.firstName, isBot: users.isBot, isTest: users.isTest,
        isActive: users.isActive, role: users.role,
        ...(applicata ? { scortaAttiva: users.scortaAttiva } : {}),
    }).from(users).where(eq(users.companyId, FENICE))
    const unico = (c: number) => {
        const g = tutti.filter((x) => x.gdoCode === c && x.role === 'GDO' && x.isActive && !x.isBot && !x.isTest)
        if (g.length !== 1) throw new Error(`GDO ${c}: ${g.length} account attivi, mi fermo`)
        return g[0]
    }
    const gdo = GDO.map(unico)
    const ora = new Date()

    console.log(`Visibili oltre ai sempre visibili: ${VISIBILI_INIZIALI}. Sblocco: ${SBLOCCO} alla volta.\n`)
    console.log('GDO                  | 1ª ch. | vergini | stelle | cercati | +migliori | VISIBILI | SCORTA | sblocchi da 30 | i migliori: stelle/JS-TG/C10/resto | scorta: JS-TG/C10/resto | migliori arrivati')
    const piani: { g: typeof gdo[number]; lista: LeadScorta[]; piano: ReturnType<typeof primaAssegnazione> }[] = []
    let totScorta = 0
    for (const g of gdo) {
        const lista = await leggiPrimeChiamate(FENICE, g.id, db, { senzaColonneScorta: !applicata })
        const piano = primaAssegnazione(lista, ora)
        piani.push({ g, lista, piano })
        const sempre = new Set(piano.sempre)
        const perId = new Map(lista.map((l) => [l.id, l]))
        const vergini = piano.sempre.filter((id) => eVergine(perId.get(id)!, ora)).length
        const cercati = piano.sempre.filter((id) => perId.get(id)!.cercato).length
        const stelle = piano.sempre.filter((id) => conStella(perId.get(id)!) && !perId.get(id)!.cercato).length
        const migliori = piano.visibili.filter((id) => !sempre.has(id))
        const cm = conta(lista, migliori)
        const cs = conta(lista, piano.scorta)
        const arrivi = migliori.map((id) => perId.get(id)!.arrivedAt.getTime())
        const finestra = arrivi.length ? `${giorno(new Date(Math.min(...arrivi)))} → ${giorno(new Date(Math.max(...arrivi)))}` : '—'
        totScorta += piano.scorta.length
        console.log([
            `${g.firstName?.trim()} (${g.gdoCode})`.padEnd(20),
            String(lista.filter((l) => l.callCount === 0 || l.cercato).length).padStart(6),
            String(vergini).padStart(7),
            String(stelle).padStart(6),
            String(cercati).padStart(7),
            String(migliori.length).padStart(9),
            String(piano.visibili.length).padStart(8),
            String(piano.scorta.length).padStart(6),
            String(Math.ceil(piano.scorta.length / SBLOCCO)).padStart(14),
            `${cm.stelle}/${cm.lettiJsTg}/${cm.lettiC10}/${cm.resto}`.padStart(34),
            `${cs.lettiJsTg}/${cs.lettiC10}/${cs.resto}`.padStart(23),
            finestra,
        ].join(' | '))
    }
    console.log(`\nTotale lead che vanno nella scorta: ${totScorta}. Restano tutti assegnati a chi li ha.`)
    if (applicata) console.log(`Interruttore oggi: ${gdo.map((g) => `${g.firstName?.trim()} ${'scortaAttiva' in g && g.scortaAttiva ? 'acceso' : 'spento'}`).join(', ')}`)

    if (!esegui) { console.log('\nDry-run: nessuna scrittura. --esegui per applicare.'); return }

    // ── File di ripristino ─────────────────────────────────────────────────
    fs.mkdirSync(CARTELLA_RIPRISTINO, { recursive: true })
    const file = path.join(CARTELLA_RIPRISTINO, `${PREFISSO_FILE}${ora.toISOString().replace(/[:.]/g, '-')}.json`)
    const righe: RigaRipristino[] = gdo.map((g) => ({ gdoId: g.id, gdoCode: g.gdoCode!, scortaAttivaPrima: 'scortaAttiva' in g ? !!g.scortaAttiva : false }))
    fs.writeFileSync(file, JSON.stringify({
        creato: ora.toISOString(),
        gdo: righe,
        piani: piani.map((p) => ({ gdoId: p.g.id, visibili: p.piano.visibili, scorta: p.piano.scorta })),
    }, null, 1))
    console.log(`\nFile di ripristino: ${file}`)

    // ── Scrittura: un GDO alla volta, ognuno nella sua transazione ─────────
    for (const g of gdo) {
        // Senza soloSeSpenta accendiScorta non restituisce mai null.
        const r = (await accendiScorta(FENICE, g.id, new Date()))!
        console.log(`${g.firstName?.trim()} (${g.gdoCode}): ${r.visibili.length} visibili, ${r.scorta.length} in scorta, interruttore acceso.`)
    }
    console.log(`Per annullare: --ripristina --file=${file} --esegui`)
}

async function annulla(esegui: boolean) {
    let file = opzione('file')
    if (!file) {
        const nomi = fs.readdirSync(CARTELLA_RIPRISTINO).filter((f) => f.startsWith(PREFISSO_FILE) && f.endsWith('.json')).sort()
        if (!nomi.length) throw new Error(`Nessun file di ripristino in ${CARTELLA_RIPRISTINO}`)
        file = path.join(CARTELLA_RIPRISTINO, nomi[nomi.length - 1])
    }
    const dati = JSON.parse(fs.readFileSync(file, 'utf8')) as { gdo: RigaRipristino[] }
    console.log(`Ripristino da ${file}: interruttore spento e stati della scorta azzerati per ${dati.gdo.map((g) => g.gdoCode).join(', ')}.`)
    if (!esegui) { console.log('Prova a vuoto. Aggiungi --esegui per scrivere.'); return }
    for (const g of dati.gdo) {
        const n = await spegniScorta(FENICE, g.gdoId, new Date())
        if (g.scortaAttivaPrima) await db.update(users).set({ scortaAttiva: true }).where(eq(users.id, g.gdoId))
        console.log(`GDO ${g.gdoCode}: ${n} lead tornati visibili${g.scortaAttivaPrima ? ' (interruttore era già acceso: riacceso)' : ''}.`)
    }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1) })
