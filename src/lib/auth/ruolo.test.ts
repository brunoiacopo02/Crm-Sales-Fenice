// Ruolo per le azioni ADMIN e MANAGER della Diretta: dalla tabella users, mai
// dai metadati della sessione (revisione del 25/10/2026). Regola pura più un
// controllo statico sui file nuovi del ramo, come serverActions.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ruoloAmmesso } from './ruolo'

test('ruolo ammesso: riga presente, account attivo, ruolo fra quelli richiesti', () => {
    assert.equal(ruoloAmmesso({ role: 'ADMIN', isActive: true }, ['ADMIN']), true)
    assert.equal(ruoloAmmesso({ role: 'MANAGER', isActive: true }, ['CONFERME', 'MANAGER', 'ADMIN']), true)
    assert.equal(ruoloAmmesso({ role: 'GDO', isActive: true }, ['ADMIN']), false)       // metadati falsificati: il DB dice GDO
    assert.equal(ruoloAmmesso({ role: 'ADMIN', isActive: false }, ['ADMIN']), false)    // account disattivato
    assert.equal(ruoloAmmesso(undefined, ['ADMIN']), false)                             // nessuna riga in users
    assert.equal(ruoloAmmesso(null, ['ADMIN']), false)
    assert.equal(ruoloAmmesso({ role: 'admin', isActive: true }, ['ADMIN']), false)
})

const SRC = join(process.cwd(), 'src')

// Action e pagine admin nuove della Diretta.
const FILE_ADMIN = [
    'app/actions/direttaActions.ts',
    'app/actions/confermeDirettaActions.ts',
    'app/actions/quoteActions.ts',
    'app/actions/negozioActions.ts',
    'app/actions/squadraActions.ts',
    'app/(dashboard)/admin/diretta/page.tsx',
    'app/(dashboard)/admin/diretta/conferme/page.tsx',
    'app/(dashboard)/admin/premi/page.tsx',
    'app/(dashboard)/admin/citazioni/page.tsx',
    // Centro di controllo dell'admin (ramo admin, 25/10/2026).
    'app/actions/centroDirettaActions.ts',
    'app/(dashboard)/admin/diretta/obiettivi/page.tsx',
    'app/(dashboard)/admin/diretta/registro/page.tsx',
]

test('le action e le pagine admin della Diretta non leggono il ruolo dai metadati', () => {
    for (const f of FILE_ADMIN) {
        const codice = readFileSync(join(SRC, f), 'utf8')
        assert.doesNotMatch(codice, /user_metadata\??\.role/, `${f}: ruolo dai metadati della sessione`)
        assert.doesNotMatch(codice, /\b(ctx|tenant|session\.user)\.role\s*[!=]==?\s*['"](ADMIN|MANAGER)['"]/, `${f}: controllo ADMIN/MANAGER su ctx.role`)
        assert.doesNotMatch(codice, /['"](ADMIN|MANAGER)['"][^\n]*\]\.includes\(\s*(ctx|tenant|session\.user)\.role/, `${f}: controllo ADMIN/MANAGER su ctx.role`)
        assert.match(codice, /from ['"]@\/lib\/auth\/ruoloDb['"]/, `${f}: deve usare il ruolo della tabella users`)
    }
})
