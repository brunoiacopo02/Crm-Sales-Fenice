import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    pianoTieni, interesse, puoRestare, motivoUscita, confrontaMigliori,
    type LeadEreditato,
} from './ridatiDaTenere'

const d = (s: string) => new Date(`2026-10-${s}:00Z`)

function lead(id: string, p: Partial<LeadEreditato> = {}): LeadEreditato {
    return {
        id, callCount: 0, chiamateTotali: 0, ridatoIl: d('15T10:00'), ultimoSegnale: null,
        tiHaCercato: false, chatInterrotta: false, richiamo: false, giaLavorato: false,
        ...p,
    }
}

test('restano solo i ridati in prima chiamata', () => {
    assert.equal(puoRestare(lead('a')), true)
    assert.equal(puoRestare(lead('b', { callCount: 1 })), false)
    assert.equal(puoRestare(lead('c', { callCount: 2 })), false)
    assert.equal(puoRestare(lead('d', { ridatoIl: null })), false)
    assert.equal(puoRestare(lead('e', { richiamo: true })), false)
})

test('interesse: ti ha cercato, poi ha scritto dopo la restituzione, poi chat interrotta', () => {
    assert.equal(interesse(lead('a', { tiHaCercato: true })), 3)
    assert.equal(interesse(lead('b', { ultimoSegnale: d('17T09:00') })), 2)
    // un messaggio di prima della restituzione non è un "ha scritto di nuovo"
    assert.equal(interesse(lead('c', { ultimoSegnale: d('14T09:00') })), 0)
    assert.equal(interesse(lead('d', { chatInterrotta: true })), 1)
    assert.equal(interesse(lead('e')), 0)
})

test('ordine: mai chiamati prima, poi interesse, poi il più recente, poi l id', () => {
    const lista = [
        lead('vecchio', { ridatoIl: d('10T10:00') }),
        lead('recente', { ridatoIl: d('19T10:00') }),
        lead('chiamato-prima', { ridatoIl: d('20T10:00'), chiamateTotali: 2 }),
        lead('ha-riscritto', { ridatoIl: d('12T10:00'), ultimoSegnale: d('13T10:00') }),
        lead('cercato', { ridatoIl: d('11T10:00'), tiHaCercato: true }),
        lead('b-pari', { ridatoIl: d('18T10:00') }),
        lead('a-pari', { ridatoIl: d('18T10:00') }),
    ]
    assert.deepEqual([...lista].sort(confrontaMigliori).map(l => l.id), [
        'cercato', 'ha-riscritto', 'recente', 'a-pari', 'b-pari', 'vecchio', 'chiamato-prima',
    ])
})

test('ultimo segno di vita: un messaggio recente vale più della data di restituzione', () => {
    // a parità di interesse vince chi si è fatto sentire per ultimo
    const a = lead('a', { ridatoIl: d('13T10:00'), ultimoSegnale: d('19T10:00') })
    const b = lead('b', { ridatoIl: d('18T10:00'), ultimoSegnale: d('18T12:00') })
    assert.deepEqual([b, a].sort(confrontaMigliori).map(l => l.id), ['a', 'b'])
})

test('piano: tiene N ridati, il resto esce col motivo, nessun lead si perde', () => {
    const lista = [
        ...Array.from({ length: 50 }, (_, i) => lead(`r${String(i).padStart(2, '0')}`, { ridatoIl: d(`${String(10 + (i % 10)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`) })),
        lead('seconda', { callCount: 1 }),
        lead('terza', { callCount: 2 }),
        lead('database', { ridatoIl: null, callCount: 1 }),
        lead('mai-dal-bot', { ridatoIl: null }),
        lead('richiamo', { richiamo: true, callCount: 1 }),
    ]
    const p = pianoTieni(lista, 35)
    assert.equal(p.tenuti.length, 35)
    assert.equal(p.parcheggiati.length, lista.length - 35)
    assert.equal(new Set([...p.tenuti.map(l => l.id), ...p.parcheggiati.map(x => x.lead.id)]).size, lista.length)
    assert.ok(p.tenuti.every(puoRestare))
    const motivo = new Map(p.parcheggiati.map(x => [x.lead.id, x.motivo]))
    assert.equal(motivo.get('seconda'), 'gia_chiamato')
    assert.equal(motivo.get('terza'), 'gia_chiamato')
    assert.equal(motivo.get('database'), 'gia_chiamato')
    assert.equal(motivo.get('mai-dal-bot'), 'non_ridato')
    assert.equal(motivo.get('richiamo'), 'richiamo')
    assert.equal(p.parcheggiati.filter(x => x.motivo === 'ridato_oltre_il_limite').length, 15)
    // i tenuti sono i più recenti: nessun parcheggiato "oltre il limite" è più recente dell'ultimo tenuto
    const ultimoTenuto = Math.min(...p.tenuti.map(l => l.ridatoIl!.getTime()))
    for (const x of p.parcheggiati.filter(x => x.motivo === 'ridato_oltre_il_limite')) {
        assert.ok(x.lead.ridatoIl!.getTime() <= ultimoTenuto, x.lead.id)
    }
})

test('piano: i lead già lavorati dal nuovo titolare restano sempre e occupano un posto', () => {
    const lista = [
        lead('lavorato-1', { giaLavorato: true, callCount: 1 }),
        lead('lavorato-2', { giaLavorato: true, callCount: 2, ridatoIl: null }),
        lead('a', { ridatoIl: d('19T10:00') }),
        lead('b', { ridatoIl: d('18T10:00') }),
        lead('c', { ridatoIl: d('17T10:00') }),
    ]
    const p = pianoTieni(lista, 3)
    assert.deepEqual(p.tenuti.map(l => l.id).sort(), ['a', 'lavorato-1', 'lavorato-2'])
    assert.deepEqual(p.parcheggiati.map(x => x.lead.id).sort(), ['b', 'c'])
    // più lavorati che posti: restano tutti i lavorati, nessuno scelto in più
    const tutti = pianoTieni(lista, 1)
    assert.deepEqual(tutti.tenuti.map(l => l.id).sort(), ['lavorato-1', 'lavorato-2'])
})

test('piano: idempotente, rilanciato sui lead rimasti non toglie più niente', () => {
    const lista = Array.from({ length: 80 }, (_, i) => lead(`l${i}`, { ridatoIl: new Date(Date.UTC(2026, 9, 1 + (i % 20), i % 24)) }))
    const primo = pianoTieni(lista, 35)
    // dopo il primo giro il titolare ne chiama alcuni: passano in seconda chiamata
    const rimasti = primo.tenuti.map((l, i) => (i % 3 === 0 ? { ...l, callCount: 1, giaLavorato: true } : l))
    const secondo = pianoTieni(rimasti, 35)
    assert.equal(secondo.parcheggiati.length, 0)
    assert.equal(secondo.tenuti.length, 35)
})

test('motivo di uscita, uno per caso', () => {
    assert.equal(motivoUscita(lead('a', { richiamo: true })), 'richiamo')
    assert.equal(motivoUscita(lead('b', { callCount: 1 })), 'gia_chiamato')
    assert.equal(motivoUscita(lead('c', { ridatoIl: null })), 'non_ridato')
    assert.equal(motivoUscita(lead('d')), 'ridato_oltre_il_limite')
})
