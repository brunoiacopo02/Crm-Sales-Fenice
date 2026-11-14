// Controlli statici sulla cornice di SIM GDO (PO 14/11/2026): pagina solo
// ADMIN, voce di menu nel Sales Manager, cron protetta e programmata.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Phone } from 'lucide-react'
import { gruppoDellaPagina, menuAdminDiretta } from '@/components/diretta/menu'

const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const PAGINA = 'src/app/(dashboard)/admin/sim-gdo/page.tsx'

test('pagina SIM GDO: solo ADMIN dalla tabella users, niente bottoni dentro span o p', () => {
    const codice = leggi(PAGINA)
    assert.match(codice, /if \(!\(await conRuoloDb\(\["ADMIN"\]\)\)\) redirect\("\/unauthorized"\)/)
    assert.doesNotMatch(codice, /<(span|p)\b(?:[^>]*[^/>])?>(?:(?!<\/\1>)[\s\S])*?<button\b/)
    assert.doesNotMatch(codice, /rounded-full|\buppercase\b|shadow-|bg-gradient|font-mono/)
    // la pagina non scrive sul foglio
    assert.match(codice, /calcolaSimGdo\(\{ scrivi: false \}\)/)
    assert.doesNotMatch(codice, /eseguiGiroSimGdo|scrivi: true/)
})

test('giro: aggancio per nome, la tabella pbxExtensions non si usa (PO 14/11/2026)', () => {
    for (const f of ['src/lib/simGdo/run.ts', 'src/lib/simGdo/giro.ts', PAGINA]) {
        assert.doesNotMatch(leggi(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\/|^\s*\*.*$/gm, ''), /pbxExtensions/, f)
    }
})

test('giro: rilettura del foglio subito prima del batchUpdate, si rinuncia se è cambiato', () => {
    const run = leggi('src/lib/simGdo/run.ts')
    const confronto = run.indexOf('impronta(seconda.valori) !== impronta(foglio.valori)')
    assert.ok(confronto > 0)
    assert.ok(confronto < run.indexOf('await salvaStato(stato)'))
    assert.ok(confronto < run.indexOf('await scriviFoglioSim('))
    // si scrive solo nella colonna del tasso, mai in DATA ULTIMO CAMBIO
    assert.deepEqual([...run.matchAll(/richiesteScrittura\(\{[^}]*colonnaTasso: ([\w.]+)/g)].map(m => m[1]), ['lettura.colonne.tasso'])
    assert.match(run, /FOGLIO_MODIFICATO = 'Foglio modificato durante il giro, riprovo al prossimo\.'/)
    // la media è della stessa azienda dei GDO agganciabili
    const media = run.slice(run.indexOf('async function leggiMedia'), run.indexOf('async function leggiLogsDiOggi'))
    assert.match(media, /eq\(users\.companyId, FENICE\)/)
})

test('menu: SIM GDO nel gruppo Direzione solo per l\'ADMIN, nel Sales Manager della Rinascita', () => {
    const sidebar = leggi('src/components/Sidebar.tsx')
    const direzione = sidebar.slice(sidebar.indexOf('label: "Direzione"'), sidebar.indexOf('label: "GDO"', sidebar.indexOf('label: "Direzione"')))
    assert.match(direzione, /role === "ADMIN" \? \[[^\]]*\{ name: "SIM GDO", href: "\/admin\/sim-gdo"/)
    const m = menuAdminDiretta([{ label: 'Direzione', items: [{ name: 'SIM GDO', href: '/admin/sim-gdo', icon: Phone }] }])
    assert.equal(gruppoDellaPagina(m.gruppi, '/admin/sim-gdo'), 'Sales Manager')
})

test('cron: Bearer prima di tutto, programmata ogni ora lun-sab in UTC', () => {
    const route = leggi('src/app/api/cron/sim-gdo/route.ts')
    const bearer = route.indexOf("req.headers.get('authorization') !== `Bearer ${secret}`")
    assert.ok(bearer > 0)
    assert.ok(bearer < route.indexOf('eseguiGiroSimGdo()'))
    assert.ok(bearer < route.indexOf('process.env.SIM_GDO_SYNC'))
    const vercel = JSON.parse(leggi('vercel.json')) as { crons: { path: string; schedule: string }[] }
    assert.deepEqual(vercel.crons.filter(c => c.path === '/api/cron/sim-gdo').map(c => c.schedule), ['5 7-19 * * 1-6'])
})
