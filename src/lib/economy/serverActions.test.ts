// Anti-imbroglio della nuova economia (PO 25/10/2026): controllo statico sul
// codice. In un file "use server" ogni export è un endpoint raggiungibile dal
// browser, quindi nessuno di quei file deve poter muovere Scintille o Piume da
// solo: i saldi cambiano solo dentro src/lib/economy (non "use server"),
// chiamato dagli esiti con il ruolo giusto.
//
// Se un'action deve davvero toccare i saldi (per esempio l'acquisto nel
// negozio, con transazione e controllo del saldo lato server, o una rettifica
// ADMIN), va aggiunta qui sotto in AUTORIZZATE dopo averla rivista.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(process.cwd(), 'src')

/** Server action rivedute che possono importare il registro. Percorsi relativi a src/, con '/'. */
const AUTORIZZATE: string[] = []

function fileTs(dir: string): string[] {
    const out: string[] = []
    for (const nome of readdirSync(dir)) {
        const p = join(dir, nome)
        if (statSync(p).isDirectory()) out.push(...fileTs(p))
        else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.ts$/.test(nome)) out.push(p)
    }
    return out
}

/** Vero se la prima istruzione del file è la direttiva "use server". */
function isUseServer(codice: string): boolean {
    const senzaCommenti = codice.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*/g, '').trimStart()
    return /^["']use server["']/.test(senzaCommenti)
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/')
const serverActions = fileTs(SRC).filter(p => isUseServer(readFileSync(p, 'utf8')))

test('il controllo trova davvero le server action', () => {
    const nomi = serverActions.map(rel)
    assert.ok(nomi.includes('app/actions/pipelineActions.ts'))
    assert.ok(nomi.includes('app/actions/economyActions.ts'))
    assert.ok(serverActions.length > 30, `trovate ${serverActions.length}`)
})

test('i moduli che scrivono sul registro non sono server action', () => {
    for (const f of ['ledger.ts', 'awards.ts', 'rules.ts', 'legacy.ts']) {
        const codice = readFileSync(join(SRC, 'lib', 'economy', f), 'utf8')
        assert.equal(isUseServer(codice), false, `src/lib/economy/${f} non deve essere "use server"`)
    }
})

test('nessuna server action importa creditOnce/reverseOnce dal registro (salvo quelle rivedute)', () => {
    const colpevoli = serverActions
        .filter(p => !AUTORIZZATE.includes(rel(p)))
        .filter(p => /from\s+["'](@\/lib\/economy\/ledger|\.{1,2}\/[^"']*economy\/ledger)["']/.test(readFileSync(p, 'utf8')))
        .map(rel)
    assert.deepEqual(colpevoli, [])
})

test('nessuna server action scrive scintille o piume sulla tabella users', () => {
    const colpevoli = serverActions
        .filter(p => !AUTORIZZATE.includes(rel(p)))
        .filter(p => /\b(scintille|piume)\s*:\s*(sql`|[^,}\n]*\+)/.test(readFileSync(p, 'utf8')))
        .map(rel)
    assert.deepEqual(colpevoli, [])
})

test('le action dei forzieri leggono e segnano l\'apertura, non accreditano', () => {
    const codice = readFileSync(join(SRC, 'app', 'actions', 'economyActions.ts'), 'utf8')
    assert.doesNotMatch(codice, /from\s+["'][^"']*economy\/(awards|ledger)["']/)
    assert.doesNotMatch(codice, /\b(creditOnce|reverseOnce)\s*\(/)
    assert.doesNotMatch(codice, /\b(scintille|piume)\b/)
})
