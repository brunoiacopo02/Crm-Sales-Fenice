// Pagine della Diretta raggiungibili dai menu (revisione del 25/10/2026):
// profilo e storico pause per il GDO, bonus e obiettivi delle Conferme per l'admin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MENU_GDO_DIRETTA, MENU_GDO_DIRETTA_PERSONALE } from '@/components/diretta/menu'

const SRC = join(process.cwd(), 'src')
const leggi = (f: string) => readFileSync(join(SRC, f), 'utf8')

test('menu Diretta del GDO: profilo raggiungibile, pausa tolta, si può uscire', () => {
    const tutte = [...MENU_GDO_DIRETTA, ...MENU_GDO_DIRETTA_PERSONALE].map(v => v.href)
    assert.ok(tutte.includes('/profilo'))
    assert.ok(!tutte.includes('/storico-pause'))
    // senza sidebar il GDO esce dal pulsante nella barra in alto
    assert.match(leggi('components/Topbar.tsx'), /aria-label="Esci"/)
    assert.equal(new Set(tutte).size, tutte.length)
    // la barra in alto resta di sei voci: il profilo ci arriva dall'avatar
    assert.equal(MENU_GDO_DIRETTA.length, 6)
    assert.match(leggi('components/Topbar.tsx'), /href="\/profilo"/)
    // il menu a scomparsa mostra anche le voci personali
    assert.match(leggi('components/Sidebar.tsx'), /MENU_GDO_DIRETTA_PERSONALE/)
})

test('bonus e obiettivi delle Conferme: collegati da /admin/diretta e dalla Sidebar admin', () => {
    // Il centro di controllo disegna le sue sezioni in sezioni.tsx.
    const centro = leggi('app/(dashboard)/admin/diretta/page.tsx') + leggi('app/(dashboard)/admin/diretta/sezioni.tsx')
    assert.match(centro, /href="\/admin\/diretta\/conferme"/)
    assert.match(leggi('components/Sidebar.tsx'), /href: "\/admin\/diretta\/conferme"/)
})
