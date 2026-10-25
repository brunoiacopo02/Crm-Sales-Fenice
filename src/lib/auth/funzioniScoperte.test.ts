// Funzioni scoperte (PO 25/10/2026): le action che cambiavano stipendi, target
// dei venditori, monete o creavano account senza controllare il ruolo sono
// state tolte. Controllo statico sul codice, come serverActions.test.ts: in un
// file "use server" ogni export è un endpoint raggiungibile dal browser.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(process.cwd(), 'src')

function fileTs(dir: string): string[] {
    const out: string[] = []
    for (const nome of readdirSync(dir)) {
        const p = join(dir, nome)
        if (statSync(p).isDirectory()) out.push(...fileTs(p))
        else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.ts$/.test(nome)) out.push(p)
    }
    return out
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/')
const tutti = fileTs(SRC)

const TOLTE = ['seedGdoAccounts', 'updateGdoBaseSalary', 'updateVenditoreSalesTarget', 'addGdoCoins', 'getVenditoriWithTargets']

/** Il codice senza commenti: nei commenti i nomi delle funzioni tolte possono restare. */
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('le funzioni scoperte non esistono più, né come action né come import', () => {
    for (const nome of TOLTE) {
        const dove = tutti.filter(p => new RegExp(`\\b${nome}\\b`).test(senzaCommenti(readFileSync(p, 'utf8')))).map(rel)
        assert.deepEqual(dove, [], `${nome} trovata in ${dove.join(', ')}`)
    }
})

/** Le export async di un file, col corpo fino alla export successiva. */
function exportConCorpo(codice: string): { nome: string; corpo: string }[] {
    const re = /export async function (\w+)/g
    const posizioni = [...codice.matchAll(re)].map(m => ({ nome: m[1], da: m.index! }))
    return posizioni.map((p, i) => ({ nome: p.nome, corpo: codice.slice(p.da, posizioni[i + 1]?.da ?? codice.length) }))
}

test('teamActions: ogni action che scrive controlla il ruolo dal DB', () => {
    const codice = readFileSync(join(SRC, 'app', 'actions', 'teamActions.ts'), 'utf8')
    const scrivono = exportConCorpo(codice).filter(f => /\bdb\.(update|insert|delete)\(/.test(f.corpo))
    assert.ok(scrivono.length >= 3, `trovate ${scrivono.length}`)
    for (const f of scrivono) assert.match(f.corpo, /await requireTeamEditor\(/, f.nome)
})

test('gestionePoolActions: ogni action passa da requireAdmin', () => {
    const codice = readFileSync(join(SRC, 'app', 'actions', 'gestionePoolActions.ts'), 'utf8')
    const azioni = exportConCorpo(codice)
    assert.ok(azioni.some(f => f.nome === 'setDailyReturnCap'))
    for (const f of azioni) assert.match(f.corpo, /await requireAdmin\(\)/, f.nome)
})
