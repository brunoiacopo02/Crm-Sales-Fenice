import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aziendeEffettive } from './aziende'

const entrambe = ['fenice', 'serenamente']

test('GDO e Conferme vedono solo Fenice: niente scelta, niente banner, niente lead Serenamente', () => {
    assert.deepEqual(aziendeEffettive('GDO', entrambe), ['fenice'])
    assert.deepEqual(aziendeEffettive('CONFERME', entrambe), ['fenice'])
})

test('admin, manager e venditori restano come prima', () => {
    for (const ruolo of ['ADMIN', 'MANAGER', 'VENDITORE', 'TL']) {
        assert.deepEqual(aziendeEffettive(ruolo, entrambe), entrambe, ruolo)
    }
})

test('un account che Fenice non ce l ha non perde la sua azienda', () => {
    assert.deepEqual(aziendeEffettive('GDO', ['serenamente']), ['serenamente'])
})

test('non modifica la lista ricevuta', () => {
    const lista = [...entrambe]
    aziendeEffettive('GDO', lista)
    assert.deepEqual(lista, entrambe)
})
