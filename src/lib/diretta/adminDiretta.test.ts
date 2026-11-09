// Veste Diretta dell'admin e centro di controllo (PO 25/10/2026): menu ricavato
// da quello classico, collegamenti del centro alle pagine di dettaglio e
// controlli statici sui file della cornice.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Phone } from 'lucide-react'
import { MENU_ADMIN_DIRETTA, VOCE_CENTRO_DIRETTA, gruppoDellaPagina, menuAdminDiretta, voceAttiva, type GruppoMenu } from '@/components/diretta/menu'

const SRC = join(process.cwd(), 'src')
const leggi = (f: string) => readFileSync(join(SRC, f), 'utf8')

const v = (href: string, name = href) => ({ name, href, icon: Phone })

// Forma del menu classico dell'admin (Sidebar.tsx), ridotta.
const CLASSICO: GruppoMenu[] = [
    {
        label: 'Direzione',
        items: [
            v('/panoramica-generale', 'Sales Manager'), v('/manager-targets', 'Target & Previsioni'),
            v('/admin/carico-conferme', 'Carico Conferme'), v('/admin/diretta/black-friday', 'Black Friday in diretta'),
        ],
    },
    { label: 'GDO', items: [v('/kpi-gdo', 'KPI GDO'), { ...v('/richieste-contatto', 'Richieste di Contatto'), badge: 3 }] },
    { label: 'Lead & Import', items: [v('/import', 'Importa Lead'), v('/admin/diretta/regia-lead', 'Regia dei lead')] },
    {
        label: 'Gamification',
        items: [v('/admin/diretta', 'Diretta: centro di controllo'), v('/admin/diretta/conferme'), v('/manager-rpg-monitor'), v('/team/store')],
    },
    { label: 'Team', items: [v('/team', 'Gestione Account'), v('/admin/citazioni', 'Citazioni del giorno')] },
]

test('menu admin Rinascita: centro in cima, pagine della gamification nuova nel gruppo Rinascita', () => {
    const m = menuAdminDiretta(CLASSICO)
    assert.equal(m.centro.href, '/admin/diretta')
    assert.ok(!m.gruppi.some(g => g.label === 'Diretta'))
    const diretta = m.gruppi.find(g => g.label === 'Rinascita')
    assert.ok(diretta)
    assert.deepEqual(diretta.items.map(i => i.href), MENU_ADMIN_DIRETTA.map(i => i.href))
    for (const href of ['/admin/citazioni', '/admin/premi', '/admin/diretta/registro', '/admin/diretta/conferme', '/classifica']) {
        assert.ok(diretta.items.some(i => i.href === href), href)
    }
})

test('menu admin Diretta: le voci classiche restano, la vecchia gamification no', () => {
    const m = menuAdminDiretta(CLASSICO)
    const tutte = [m.centro, ...m.gruppi.flatMap(g => g.items)].map(i => i.href)
    for (const href of ['/panoramica-generale', '/manager-targets', '/kpi-gdo', '/richieste-contatto', '/import', '/team']) {
        assert.ok(tutte.includes(href), href)
    }
    assert.ok(!tutte.includes('/manager-rpg-monitor'))
    assert.ok(!tutte.includes('/team/store'))
    // ogni voce una volta sola
    assert.equal(new Set(tutte).size, tutte.length)
})

test('menu admin Diretta: nomi in italiano, gruppi senza "&", badge conservati', () => {
    const m = menuAdminDiretta(CLASSICO)
    const voci = m.gruppi.flatMap(g => g.items)
    assert.equal(voci.find(i => i.href === '/manager-targets')?.name, 'Target e previsioni')
    assert.equal(voci.find(i => i.href === '/import')?.name, 'Importa lead')
    assert.equal(voci.find(i => i.href === '/team')?.name, 'Gestione account')
    assert.equal(voci.find(i => i.href === '/richieste-contatto')?.badge, 3)
    assert.ok(m.gruppi.every(g => !g.label.includes('&')))
    assert.ok(m.gruppi.some(g => g.label === 'Lead e import'))
    // Team diventa Amministrazione, senza le citazioni (spostate in Rinascita) e con gli accessi
    assert.deepEqual(m.gruppi.find(g => g.label === 'Amministrazione')?.items.map(i => i.href), ['/team', '/admin/accessi'])
})

test('menu admin Rinascita: a menu non ancora letto c\'è solo il centro; senza Gamification il gruppo Rinascita si aggiunge', () => {
    assert.deepEqual(menuAdminDiretta([]).gruppi, [])
    const senza = menuAdminDiretta([{ label: 'GDO', items: [v('/kpi-gdo')] }])
    assert.deepEqual(senza.gruppi.map(g => g.label), ['GDO', 'Rinascita', 'Amministrazione'])
    assert.equal(VOCE_CENTRO_DIRETTA.href, '/admin/diretta')
})

test('menu admin Rinascita: gruppi a tendina nell\'ordine fisso, Direzione diventa Sales Manager, Riservato in Amministrazione', () => {
    const m = menuAdminDiretta([
        { label: 'Riservato', items: [v('/previsionale'), v('/riconciliazione')] },
        { label: 'Qualità', items: [v('/qualita-lead')] },
        { label: 'Marketing', items: [v('/marketing-analytics')] },
        { label: 'Conferme', items: [v('/conferme'), v('/conferme/analytics')] },
        ...CLASSICO,
    ])
    assert.deepEqual(m.gruppi.map(g => g.label), ['Sales Manager', 'GDO', 'Conferme', 'Lead e import', 'Marketing', 'Rinascita', 'Amministrazione'])
    assert.deepEqual(m.gruppi.find(g => g.label === 'Marketing')?.items.map(i => i.href), ['/qualita-lead', '/marketing-analytics'])
    assert.deepEqual(m.gruppi.find(g => g.label === 'Amministrazione')?.items.map(i => i.href), ['/previsionale', '/riconciliazione', '/team', '/admin/accessi'])
})

test('menu admin Rinascita: il gruppo della pagina corrente è quello della voce più lunga', () => {
    const gruppi = [
        { label: 'Conferme', items: [v('/conferme')] },
        { label: 'Altro', items: [v('/conferme/analytics')] },
        { label: 'Rinascita', items: [v('/admin/premi')] },
    ]
    assert.equal(gruppoDellaPagina(gruppi, '/conferme'), 'Conferme')
    assert.equal(gruppoDellaPagina(gruppi, '/conferme/analytics'), 'Altro')
    assert.equal(gruppoDellaPagina(gruppi, '/admin/premi/nuovo'), 'Rinascita')
    assert.equal(gruppoDellaPagina(gruppi, '/kpi-gdo'), null)
    assert.equal(voceAttiva('/', '/kpi-gdo'), false)
})

// ── Controlli statici ───────────────────────────────────────────────────

test('cornice: il layout dà all\'admin la veste Diretta, pagine vecchie comprese', () => {
    const layout = leggi('app/(dashboard)/layout.tsx')
    assert.match(layout, /const direttaAdmin = diretta && session\.user\.role === 'ADMIN'/)
    // il <main> dell'admin ha la classe che accende la rimappa scura
    assert.match(layout, /direttaAdmin \? 'd-foglio-admin lg:rounded-tl-\[16px\]'/)
    const css = leggi('app/globals.css')
    // pagine vecchie scure (PO 25/10/2026 sera): carattere Poppins, fondo scuro,
    // bianco del tema rimappato sulla superficie; le pagine nuove tengono i loro colori
    assert.match(css, /\[data-ui="diretta"\] main\.d-foglio-admin \{[^}]*font-family: var\(--font-poppins\)/)
    assert.match(css, /\[data-ui="diretta"\] main\.d-foglio-admin \{[^}]*color-scheme: dark;[^}]*background-color: #171717/)
    assert.match(css, /\[data-ui="diretta"\] main\.d-foglio-admin \{[^}]*--color-white: #262626;/)
    assert.match(css, /\[data-ui="diretta"\] main\.d-foglio-admin \.d-pagina-nuova,[^{]*\{[^}]*--color-white: var\(--d-a-white\);/)
    assert.match(leggi('components/diretta/admin/ui.tsx'), /className="d-pagina-nuova /)
    const topbar = leggi('components/Topbar.tsx')
    assert.match(topbar, /ruolo === 'GDO' \|\| ruolo === 'CONFERME' \|\| ruolo === 'ADMIN'/)
    // l'admin non sceglie più l'azienda: niente switcher nella barra scura
    assert.doesNotMatch(topbar, /<SalesCompanySwitcher variant="diretta" \/>/)
    const sidebar = leggi('components/Sidebar.tsx')
    assert.match(sidebar, /if \(diretta && ruolo === 'ADMIN'\)/)
    assert.match(sidebar, /menuAdminDiretta\(/)
})

test('centro di controllo: collegato alle pagine di dettaglio', () => {
    const centro = leggi('app/(dashboard)/admin/diretta/page.tsx') + leggi('app/(dashboard)/admin/diretta/sezioni.tsx')
    for (const href of [
        '/admin/diretta/obiettivi', '/admin/citazioni', '/admin/premi', '/admin/diretta/premi-settimana',
        '/admin/diretta/salvadanai', '/admin/diretta/black-friday', '/admin/diretta/regia-lead', '/admin/diretta/conferme', '/admin/diretta/registro', '/classifica',
    ]) {
        assert.ok(centro.includes(`href="${href}`), href)
    }
})

test('pagine admin Diretta: in modalità Tutte le aziende non sono bloccate', () => {
    assert.match(leggi('components/sales/AllCompaniesGate.tsx'), /'\/admin',/)
})

// Bottoni mai dentro span o p (WSOD): controllo grezzo sui file nuovi.
const FILE_UI = [
    'app/(dashboard)/admin/diretta/page.tsx',
    'app/(dashboard)/admin/diretta/sezioni.tsx',
    'app/(dashboard)/admin/diretta/InterruttoriDiretta.tsx',
    'app/(dashboard)/admin/diretta/obiettivi/ObiettiviForm.tsx',
    'app/(dashboard)/admin/diretta/registro/page.tsx',
    'app/(dashboard)/admin/diretta/salvadanai/page.tsx',
    'app/(dashboard)/admin/diretta/black-friday/page.tsx',
    'app/(dashboard)/admin/diretta/black-friday/AggiornaBlackFriday.tsx',
    'app/(dashboard)/admin/diretta/regia-lead/page.tsx',
    'app/(dashboard)/admin/diretta/regia-lead/AggiornaRegia.tsx',
    'app/(dashboard)/admin/diretta/regia-lead/RegiaClient.tsx',
    'app/(dashboard)/admin/carico-conferme/page.tsx',
    'app/(dashboard)/admin/carico-conferme/AggiornaCarico.tsx',
    'components/diretta/SalvadanaioMese.tsx',
    'app/(dashboard)/admin/citazioni/CitazioniAdminClient.tsx',
    'components/diretta/admin/ui.tsx',
    'components/diretta/MenuAdminGruppi.tsx',
]

test('pagine admin Diretta: nessun bottone dentro span o p, niente pillole', () => {
    for (const f of FILE_UI) {
        const codice = leggi(f)
        assert.doesNotMatch(codice, /<(span|p)\b(?:[^>]*[^/>])?>(?:(?!<\/\1>)[\s\S])*?<button\b/, `${f}: bottone dentro span o p`)
        assert.doesNotMatch(codice, /rounded-full/, `${f}: pillola`)
        assert.doesNotMatch(codice, /\buppercase\b|tracking-wider|tracking-widest/, `${f}: maiuscolo spaziato`)
        assert.doesNotMatch(codice, /shadow-|bg-gradient|font-mono/, `${f}: ombre, gradienti o monospace`)
    }
})

test('menu admin (PO 09/11/2026): Carico Conferme e Black Friday nel Sales Manager, Regia dei lead in Lead e import, nessuno dei tre in Rinascita', () => {
    const m = menuAdminDiretta(CLASSICO)
    const gruppo = (label: string) => m.gruppi.find(g => g.label === label)?.items.map(i => i.href) ?? []
    assert.ok(gruppo('Sales Manager').includes('/admin/carico-conferme'))
    assert.ok(gruppo('Sales Manager').includes('/admin/diretta/black-friday'))
    assert.ok(gruppo('Lead e import').includes('/admin/diretta/regia-lead'))
    for (const href of ['/admin/carico-conferme', '/admin/diretta/black-friday', '/admin/diretta/regia-lead']) {
        assert.ok(!gruppo('Rinascita').includes(href), href)
        assert.ok(!MENU_ADMIN_DIRETTA.some(v => v.href === href), href)
    }
    // la pagina corrente apre il gruppo giusto, non la Rinascita del centro di controllo
    assert.equal(gruppoDellaPagina(m.gruppi, '/admin/diretta/black-friday'), 'Sales Manager')
    assert.equal(gruppoDellaPagina(m.gruppi, '/admin/diretta/regia-lead'), 'Lead e import')
    assert.equal(gruppoDellaPagina(m.gruppi, '/admin/carico-conferme'), 'Sales Manager')
    // nel menu classico le tre voci stanno nei gruppi giusti e solo per l'ADMIN
    const sidebar = leggi('components/Sidebar.tsx')
    const direzione = sidebar.slice(sidebar.indexOf('label: "Direzione"'), sidebar.indexOf('label: "GDO"', sidebar.indexOf('label: "Direzione"')))
    assert.match(direzione, /role === "ADMIN" \? \[\s*\{ name: "Carico Conferme", href: "\/admin\/carico-conferme"[\s\S]*?\{ name: "Black Friday in diretta", href: "\/admin\/diretta\/black-friday"/)
    const leadImport = sidebar.slice(sidebar.indexOf('label: "Lead & Import"'), sidebar.indexOf('label: "Qualità"', sidebar.indexOf('label: "Lead & Import"')))
    assert.match(leadImport, /role === "ADMIN" \? \[\{ name: "Regia dei lead", href: "\/admin\/diretta\/regia-lead"/)
    // le pagine restano solo ADMIN, dalla tabella users
    for (const f of ['app/(dashboard)/admin/carico-conferme/page.tsx', 'app/(dashboard)/admin/diretta/black-friday/page.tsx']) {
        assert.match(leggi(f), /if \(!\(await conRuoloDb\(\["ADMIN"\]\)\)\) redirect\("\/unauthorized"\)/, f)
    }
    assert.match(leggi('app/actions/caricoConfermeActions.ts'), /if \(!\(await conRuoloDb\(\['ADMIN'\]\)\)\) return \{ success: false \}/)
})

test('regia dei lead: in Lead e import, solo ADMIN dalla tabella users in pagina e in ogni action', () => {
    assert.match(leggi('app/(dashboard)/admin/diretta/regia-lead/page.tsx'), /if \(!\(await conRuoloDb\(\["ADMIN"\]\)\)\) redirect\("\/unauthorized"\)/)
    const codice = leggi('app/actions/regiaLeadActions.ts')
    assert.match(codice, /^"use server"/)
    // un re-export di tipi in un file "use server" rompe il modulo in produzione (ReferenceError, 09/11/2026)
    assert.doesNotMatch(codice, /^export type \{/m)
    const azioni = [...codice.matchAll(/export async function (\w+)/g)].map(m => ({ nome: m[1], da: m.index! }))
    assert.ok(azioni.length >= 9, `trovate ${azioni.length}`)
    azioni.forEach((a, i) => {
        const corpo = codice.slice(a.da, azioni[i + 1]?.da ?? codice.length)
        assert.match(corpo, /await soloAdmin\(\)/, a.nome)
    })
    // niente confirm()/alert() del browser: anteprima e conferma stanno nella pagina
    const client = leggi('app/(dashboard)/admin/diretta/regia-lead/RegiaClient.tsx')
    assert.doesNotMatch(client, /(window\.)?(confirm|alert)\(/)
})
