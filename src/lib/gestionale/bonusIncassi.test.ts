import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcolaBonusIncassi, scaglioniBonusIncassi, formatPct, formatBonus, fraseBonusIncassi, type ContrattoBonus, type IncassoBonus } from './bonusIncassi'

const NOV = '2026-11'

function contratto(id: string, over: Partial<ContrattoBonus> = {}): ContrattoBonus {
    return { id, dataFirma: '2026-11-05', importoTotaleCents: 200_000, statoPagamento: 'Pagamento programmato', clienteNome: 'Cliente', clienteCognome: id, ...over }
}
function pagamento(contrattoId: string, data: string | null, importoCents: number, contaCommissione = true): IncassoBonus {
    return { contrattoId, data, importoCents, contaCommissione }
}
/** n contratti firmati a novembre, i primi `pagati` saldati nel mese. */
function mese(n: number, pagati: number): { contratti: ContrattoBonus[]; incassi: IncassoBonus[] } {
    const contratti = Array.from({ length: n }, (_, i) => contratto(`c${i}`, { statoPagamento: i < pagati ? 'Pagato' : 'Pagamento programmato' }))
    const incassi = contratti.slice(0, pagati).map(c => pagamento(c.id, '2026-11-10', 200_000))
    return { contratti, incassi }
}

test('scaglioni: ottobre 85/90, da novembre 80/85/90, prima niente', () => {
    assert.deepEqual(scaglioniBonusIncassi('2026-09'), [])
    assert.deepEqual(scaglioniBonusIncassi('2026-10'), [{ minPct: 85, bonusPct: 0.5 }, { minPct: 90, bonusPct: 1 }])
    assert.deepEqual(scaglioniBonusIncassi('2026-11'), [{ minPct: 80, bonusPct: 0.5 }, { minPct: 85, bonusPct: 1 }, { minPct: 90, bonusPct: 1.5 }])
    assert.deepEqual(scaglioniBonusIncassi('2027-02'), scaglioniBonusIncassi('2026-11'))
})

test('saldo intero nel mese: pagato; niente incassi: da saldare con residuo', () => {
    const r = calcolaBonusIncassi(NOV, [contratto('a', { statoPagamento: 'Pagato' }), contratto('b', { importoTotaleCents: 300_000 })], [pagamento('a', '2026-11-06', 200_000)])
    assert.equal(r.firmati, 2)
    assert.equal(r.pagati, 1)
    assert.equal(r.pct, 50)
    assert.equal(r.firmatoCents, 500_000)
    assert.equal(r.pagatoCents, 200_000)
    assert.equal(r.pctEuro, 40)
    assert.deepEqual(r.daSaldare, [{ id: 'b', cliente: 'Cliente b', dataFirma: '2026-11-05', importoCents: 300_000, incassatoCents: 0, residuoCents: 300_000, statoPagamento: 'Pagamento programmato', saldatoIl: null }])
})

test('gli incassi che non contano (primo accesso, costo finanziaria) non pagano il contratto', () => {
    const r = calcolaBonusIncassi(NOV, [contratto('a')], [pagamento('a', '2026-11-05', 100, false), pagamento('a', '2026-11-06', 200_000, false)])
    assert.equal(r.pagati, 0)
    assert.equal(r.daSaldare[0].incassatoCents, 0)
})

test('incassi >= importo entro fine mese: pagato anche se lo stato non e ancora Pagato', () => {
    const r = calcolaBonusIncassi(NOV, [contratto('a')], [pagamento('a', '2026-11-06', 50_000), pagamento('a', '2026-11-30', 150_000)])
    assert.equal(r.pagati, 1)
    assert.deepEqual(r.daSaldare, [])
})

test('finanziato: stato Pagato, incassi sotto l importo, saldo nel mese = pagato nel mese', () => {
    const r = calcolaBonusIncassi(NOV, [contratto('a', { importoTotaleCents: 208_000, statoPagamento: 'Pagato' })], [pagamento('a', '2026-11-03', 177_400), pagamento('a', '2026-11-03', 10_025, false)])
    assert.equal(r.pagati, 1)
    assert.equal(r.pagatoCents, 208_000)
})

test('stato Pagato ma saldo datato il mese dopo: NON pagato nel mese, in elenco come saldato dopo', () => {
    const c = contratto('a', { dataFirma: '2026-10-29', importoTotaleCents: 367_000, statoPagamento: 'Pagato' })
    const r = calcolaBonusIncassi('2026-10', [c], [pagamento('a', '2026-10-30', 5_000), pagamento('a', '2026-11-04', 362_000)])
    assert.equal(r.firmati, 1)
    assert.equal(r.pagati, 0)
    assert.equal(r.daSaldare[0].saldatoIl, '2026-11-04')
    assert.equal(r.daSaldare[0].residuoCents, 0)
    assert.equal(r.daSaldare[0].incassatoCents, 367_000)
})

test('finanziato saldato il mese dopo: residuo 0 perche lo stato e Pagato', () => {
    const c = contratto('a', { dataFirma: '2026-10-31', importoTotaleCents: 395_900, statoPagamento: 'Pagato' })
    const r = calcolaBonusIncassi('2026-10', [c], [pagamento('a', '2026-11-10', 335_000)])
    assert.equal(r.pagati, 0)
    assert.equal(r.daSaldare[0].residuoCents, 0)
    assert.equal(r.daSaldare[0].saldatoIl, '2026-11-10')
})

test('stato Pagato senza nessun pagamento registrato: non si puo datare, non conta', () => {
    const r = calcolaBonusIncassi(NOV, [contratto('a', { statoPagamento: 'Pagato' })], [])
    assert.equal(r.pagati, 0)
    assert.equal(r.daSaldare[0].saldatoIl, null)
})

test('pagamento senza data: non vale come incassato nel mese', () => {
    const r = calcolaBonusIncassi(NOV, [contratto('a', { statoPagamento: 'Pagato' })], [pagamento('a', null, 200_000)])
    assert.equal(r.pagati, 0)
})

test('acconto e basta: da saldare con incassato e residuo', () => {
    const r = calcolaBonusIncassi(NOV, [contratto('a')], [pagamento('a', '2026-11-06', 50_000)])
    assert.equal(r.daSaldare[0].incassatoCents, 50_000)
    assert.equal(r.daSaldare[0].residuoCents, 150_000)
})

test('stand-by, altri mesi e firma mancante non sono firmati del mese', () => {
    const r = calcolaBonusIncassi(NOV, [
        contratto('a', { statoPagamento: 'Stand-by' }),
        contratto('b', { dataFirma: '2026-10-31' }),
        contratto('c', { dataFirma: '2026-12-01' }),
        contratto('d', { dataFirma: null }),
        contratto('e'),
    ], [])
    assert.equal(r.firmati, 1)
    assert.equal(r.standBy, 1)
    assert.deepEqual(r.daSaldare.map(c => c.id), ['e'])
})

test('incassi di altri contratti non contano', () => {
    const r = calcolaBonusIncassi(NOV, [contratto('a')], [pagamento('altro', '2026-11-06', 200_000)])
    assert.equal(r.pagati, 0)
})

test('nessun contratto firmato: nessuna percentuale, nessuno scaglione', () => {
    const r = calcolaBonusIncassi(NOV, [], [])
    assert.equal(r.firmati, 0)
    assert.equal(r.pct, null)
    assert.equal(r.pctEuro, null)
    assert.equal(r.raggiunto, null)
    assert.equal(r.prossimo, null)
})

test('novembre: soglia esatta presa, e quanti ne mancano alla successiva', () => {
    let { contratti, incassi } = mese(10, 7)
    let r = calcolaBonusIncassi(NOV, contratti, incassi)
    assert.equal(r.raggiunto, null)
    assert.deepEqual(r.prossimo, { scaglione: { minPct: 80, bonusPct: 0.5 }, mancano: 1 })

    ;({ contratti, incassi } = mese(10, 8))
    r = calcolaBonusIncassi(NOV, contratti, incassi)
    assert.deepEqual(r.raggiunto, { minPct: 80, bonusPct: 0.5 })
    assert.deepEqual(r.prossimo, { scaglione: { minPct: 85, bonusPct: 1 }, mancano: 1 })

    ;({ contratti, incassi } = mese(10, 9))
    r = calcolaBonusIncassi(NOV, contratti, incassi)
    assert.deepEqual(r.raggiunto, { minPct: 90, bonusPct: 1.5 })
    assert.equal(r.prossimo, null)
})

test('mancano: arrotonda in su sui contratti interi', () => {
    // 7 firmati, 3 pagati: l'80% di 7 = 5,6 -> servono 6 pagati -> ne mancano 3.
    const { contratti, incassi } = mese(7, 3)
    const r = calcolaBonusIncassi(NOV, contratti, incassi)
    assert.deepEqual(r.prossimo, { scaglione: { minPct: 80, bonusPct: 0.5 }, mancano: 3 })
})

test('20 firmati, 17 pagati = 85% esatto: scaglione +1% (nessun errore di virgola)', () => {
    const { contratti, incassi } = mese(20, 17)
    const r = calcolaBonusIncassi(NOV, contratti, incassi)
    assert.deepEqual(r.raggiunto, { minPct: 85, bonusPct: 1 })
    assert.deepEqual(r.prossimo, { scaglione: { minPct: 90, bonusPct: 1.5 }, mancano: 1 })
})

test('ottobre: 80% non basta (soglie 85/90)', () => {
    const contratti = Array.from({ length: 10 }, (_, i) => contratto(`c${i}`, { dataFirma: '2026-10-10', statoPagamento: i < 8 ? 'Pagato' : 'Sollecito' }))
    const incassi = contratti.slice(0, 8).map(c => pagamento(c.id, '2026-10-20', 200_000))
    const r = calcolaBonusIncassi('2026-10', contratti, incassi)
    assert.equal(r.pct, 80)
    assert.equal(r.raggiunto, null)
    assert.deepEqual(r.prossimo, { scaglione: { minPct: 85, bonusPct: 0.5 }, mancano: 1 })
})

test('settembre: percentuale si, scaglioni no', () => {
    const r = calcolaBonusIncassi('2026-09', [contratto('a', { dataFirma: '2026-09-10', statoPagamento: 'Pagato' })], [pagamento('a', '2026-09-11', 200_000)])
    assert.equal(r.pct, 100)
    assert.deepEqual(r.scaglioni, [])
    assert.equal(r.raggiunto, null)
    assert.equal(r.prossimo, null)
})

test('elenco da saldare: prima chi deve ancora pagare (residuo piu alto in testa), poi i saldati dopo', () => {
    const r = calcolaBonusIncassi('2026-10', [
        contratto('dopo', { dataFirma: '2026-10-20', statoPagamento: 'Pagato' }),
        contratto('piccolo', { dataFirma: '2026-10-20', importoTotaleCents: 100_000 }),
        contratto('grande', { dataFirma: '2026-10-20', importoTotaleCents: 400_000, statoPagamento: 'Sollecito' }),
    ], [pagamento('dopo', '2026-11-02', 200_000)])
    assert.deepEqual(r.daSaldare.map(c => c.id), ['grande', 'piccolo', 'dopo'])
})

test('formatPct tronca: sotto soglia non si legge mai la soglia', () => {
    assert.equal(formatPct(null), '—')
    assert.equal(formatPct(80), '80%')
    assert.equal(formatPct((17 / 20) * 100), '85%')
    assert.equal(formatPct((57 / 100) * 100), '57%')
    assert.equal(formatPct((2 / 3) * 100), '66,6%')
    assert.equal(formatPct(79.96), '79,9%')
    assert.equal(formatBonus(0.5), '+0,5%')
    assert.equal(formatBonus(1), '+1%')
})

test('frase: mancano / raggiunto / massimo / mese chiuso / bonus non ancora partito', () => {
    const f = (n: number, p: number, chiuso = false) => { const m = mese(n, p); return fraseBonusIncassi(calcolaBonusIncassi(NOV, m.contratti, m.incassi), chiuso) }
    assert.equal(f(10, 5), 'Ti mancano 3 contratti pagati per il +0,5%.')
    assert.equal(f(10, 7), 'Ti manca 1 contratto pagato per il +0,5%.')
    assert.equal(f(10, 8), 'Hai raggiunto il +0,5%. Ti manca 1 contratto pagato per il +1%.')
    assert.equal(f(10, 10), 'Hai raggiunto il +1,5%, il massimo.')
    assert.equal(f(0, 0), 'Nessun contratto firmato in questo mese.')
    assert.equal(f(10, 5, true), 'Mese chiuso senza bonus: mancavano 3 contratti pagati per il +0,5%.')
    assert.equal(f(10, 7, true), 'Mese chiuso senza bonus: mancava 1 contratto pagato per il +0,5%.')
    assert.equal(f(10, 9, true), 'Mese chiuso con il +1,5%.')
    assert.match(fraseBonusIncassi(calcolaBonusIncassi('2026-09', [], []), true), /partito a ottobre 2026/)
})
