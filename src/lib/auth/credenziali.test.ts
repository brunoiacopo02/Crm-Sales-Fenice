import { test } from 'node:test'
import assert from 'node:assert/strict'
import { controllaRichiesta, emailValida } from './credenziali'

const base = { emailAttuale: 'gdo116@fenice.local', email: 'gdo116@fenice.local', password: '', ripeti: '' }

test('credenziali: almeno una cosa da cambiare', () => {
    assert.deepEqual(controllaRichiesta(base), { ok: false, errore: 'niente' })
    // la stessa email scritta in maiuscolo non è un cambio
    assert.deepEqual(controllaRichiesta({ ...base, email: ' GDO116@fenice.local ' }), { ok: false, errore: 'niente' })
})

test('credenziali: email nuova valida, password lunga e ripetuta uguale', () => {
    assert.deepEqual(controllaRichiesta({ ...base, email: 'Lavinia@Fenice.it' }), { ok: true, email: 'lavinia@fenice.it', password: null })
    assert.deepEqual(controllaRichiesta({ ...base, email: 'non-una-mail' }), { ok: false, errore: 'email' })
    assert.deepEqual(controllaRichiesta({ ...base, password: '1234' , ripeti: '1234' }), { ok: false, errore: 'password_corta' })
    assert.deepEqual(controllaRichiesta({ ...base, password: 'segreta123', ripeti: 'segreta124' }), { ok: false, errore: 'password_diverse' })
    assert.deepEqual(controllaRichiesta({ ...base, password: 'segreta123', ripeti: 'segreta123' }), { ok: true, email: null, password: 'segreta123' })
    assert.equal(emailValida('a@b.it'), true)
    assert.equal(emailValida('a b@c.it'), false)
})
