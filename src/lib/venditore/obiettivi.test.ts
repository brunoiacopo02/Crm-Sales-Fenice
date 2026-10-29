import { test } from 'node:test'
import assert from 'node:assert/strict'
import { obiettiviDelMese, percentualeGuadagno, guadagnoCents, calcolaGuadagno, validaObiettivi } from './obiettivi'

const rows = [
    { salesUserId: 'a', yearMonth: '2026-10', target1Eur: 74000, target2Eur: 86500 },
    { salesUserId: 'a', yearMonth: '2027-01', target1Eur: 80000, target2Eur: 90000 },
    { salesUserId: 'b', yearMonth: '2026-11', target1Eur: 50000, target2Eur: null },
]

test('il mese senza valore prende il mese prima', () => {
    assert.deepEqual(obiettiviDelMese(rows, 'a', '2026-10'), { target1Eur: 74000, target2Eur: 86500, daMese: '2026-10' })
    assert.deepEqual(obiettiviDelMese(rows, 'a', '2026-12'), { target1Eur: 74000, target2Eur: 86500, daMese: '2026-10' })
    assert.deepEqual(obiettiviDelMese(rows, 'a', '2027-03'), { target1Eur: 80000, target2Eur: 90000, daMese: '2027-01' })
    assert.deepEqual(obiettiviDelMese(rows, 'a', '2026-09'), { target1Eur: null, target2Eur: null, daMese: null })
    assert.equal(obiettiviDelMese(rows, 'b', '2026-10').target1Eur, null)
})

test('percentuale: 10, 11 al primo, 12 al secondo', () => {
    const o = { target1Eur: 74000, target2Eur: 86500 }
    assert.equal(percentualeGuadagno(73999, o), 10)
    assert.equal(percentualeGuadagno(74000, o), 11)
    assert.equal(percentualeGuadagno(86499, o), 11)
    assert.equal(percentualeGuadagno(86500, o), 12)
    assert.equal(percentualeGuadagno(999999, { target1Eur: null, target2Eur: null }), 10)
})

test('guadagno = incasso / 1,22 x pct, come la commissione del gestionale', () => {
    // Gestionale ottobre, Sales 001: incassato 7.040,00 -> imponibile 577,05
    assert.equal(guadagnoCents(704000, 10), 57705)
    assert.equal(guadagnoCents(5612900, 10), 460074)
})

test('calcolaGuadagno con prossimo obiettivo', () => {
    const g = calcolaGuadagno({ incassatoCents: 5612900, firmatoEur: 66185, obiettivi: { target1Eur: 74000, target2Eur: 86500 } })
    assert.equal(g.pct, 10)
    assert.equal(g.baseCents, 460074)
    assert.equal(g.bonusCents, 0)
    assert.deepEqual(g.prossimo, { numero: 1, obiettivoEur: 74000, mancaEur: 7815, pct: 11, guadagnoCents: 506081 })
    const g2 = calcolaGuadagno({ incassatoCents: 1000000, firmatoEur: 80000, obiettivi: { target1Eur: 74000, target2Eur: 86500 } })
    assert.equal(g2.pct, 11)
    assert.equal(g2.prossimo?.numero, 2)
    assert.equal(g2.bonusCents, guadagnoCents(1000000, 11) - guadagnoCents(1000000, 10))
    const g3 = calcolaGuadagno({ incassatoCents: 1000000, firmatoEur: 90000, obiettivi: { target1Eur: 74000, target2Eur: 86500 } })
    assert.equal(g3.pct, 12)
    assert.equal(g3.prossimo, null)
})

test('validaObiettivi', () => {
    assert.equal(validaObiettivi(74000, 86500), null)
    assert.equal(validaObiettivi(null, null), null)
    assert.ok(validaObiettivi(86500, 74000))
    assert.ok(validaObiettivi(null, 1000))
    assert.ok(validaObiettivi(-1, null))
})
