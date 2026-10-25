import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { PAUSA_RIALLINEO_MS, serveRiallineare } from './veste'

test('veste: cornice e pagina uguali, niente refresh', () => {
    assert.equal(serveRiallineare({ uiLayout: 'diretta', paginaDiretta: true, ultimoRefresh: 0, adesso: 1e6 }), false)
    assert.equal(serveRiallineare({ uiLayout: null, paginaDiretta: false, ultimoRefresh: 0, adesso: 1e6 }), false)
})

test('veste: interruttore cambiato a sessione aperta, la cornice si riallinea', () => {
    // acceso: pagina Diretta dentro la cornice vecchia
    assert.equal(serveRiallineare({ uiLayout: null, paginaDiretta: true, ultimoRefresh: 0, adesso: 1e6 }), true)
    // spento: pagina classica dentro la cornice scura
    assert.equal(serveRiallineare({ uiLayout: 'diretta', paginaDiretta: false, ultimoRefresh: 0, adesso: 1e6 }), true)
})

test('veste: al massimo un refresh ogni 10 secondi', () => {
    const adesso = 1e6
    assert.equal(serveRiallineare({ uiLayout: null, paginaDiretta: true, ultimoRefresh: adesso - 2_000, adesso }), false)
    assert.equal(serveRiallineare({ uiLayout: null, paginaDiretta: true, ultimoRefresh: adesso - PAUSA_RIALLINEO_MS, adesso }), true)
})

// Controllo statico: ogni pagina che sceglie la veste leggendo l'interruttore
// deve montare VesteAllineata, altrimenti dopo un cambio a sessione aperta
// nasce dentro la cornice sbagliata.
const APP = join(process.cwd(), 'src', 'app')

function pagine(dir: string): string[] {
    const out: string[] = []
    for (const nome of readdirSync(dir)) {
        const p = join(dir, nome)
        if (statSync(p).isDirectory()) out.push(...pagine(p))
        else if (nome === 'page.tsx') out.push(p)
    }
    return out
}

test('le pagine che leggono l\'interruttore della Diretta montano VesteAllineata', () => {
    const lette = pagine(APP).filter(p => /\b(isDirettaOn|direttaAccesa)\(/.test(readFileSync(p, 'utf8')))
    assert.ok(lette.length >= 8, `trovate ${lette.length}`)
    const senza = lette
        .filter(p => !/<VesteAllineata\b/.test(readFileSync(p, 'utf8')))
        .map(p => relative(APP, p).split(sep).join('/'))
    assert.deepEqual(senza, [])
})

test('il div radice del layout porta il segno che VesteAllineata cerca', () => {
    const layout = readFileSync(join(APP, '(dashboard)', 'layout.tsx'), 'utf8')
    assert.match(layout, /data-radice-dashboard=/)
    assert.match(layout, /data-ui=\{diretta \? 'diretta' : undefined\}/)
})
