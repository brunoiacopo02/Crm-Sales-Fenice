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
    { label: 'Direzione', items: [v('/panoramica-generale', 'Sales Manager'), v('/manager-targets', 'Target & Previsioni')] },
    { label: 'GDO', items: [v('/kpi-gdo', 'KPI GDO'), { ...v('/richieste-contatto', 'Richieste di Contatto'), badge: 3 }] },
    { label: 'Lead & Import', items: [v('/import', 'Importa Lead')] },
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

test('cornice: il layout dà all\'admin la veste Diretta con le pagine vecchie su superficie chiara', () => {
    const layout = leggi('app/(dashboard)/layout.tsx')
    assert.match(layout, /const direttaAdmin = diretta && session\.user\.role === 'ADMIN'/)
    // il <main> dell'admin resta chiaro e col carattere di sempre
    assert.match(layout, /direttaAdmin \? 'd-foglio-admin lg:rounded-tl-\[16px\]'/)
    assert.match(leggi('app/globals.css'), /\[data-ui="diretta"\] main\.d-foglio-admin \{[^}]*font-family: var\(--default-font-family/)
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
        '/admin/diretta/conferme', '/admin/diretta/registro', '/classifica',
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
