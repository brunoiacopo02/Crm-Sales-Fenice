import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notaAppuntamento, parseAgendaMario, segretoValido, sceltaLead, siNo } from './payload'

// Il contratto lo scrive Federico (docs/mario/webhook-agenda.md nel suo repo):
// qui si copre il confine fra il suo payload e il nostro CRM.

const ADESSO = Date.parse('2026-10-06T09:00:00Z')

function corpo(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        evento: 'appuntamento_fissato',
        versione: 1,
        id_invio: 'agenda:11111111-2222-3333-4444-555555555555',
        tentativo: 1,
        inviato_il: '2026-10-06T09:00:04.512Z',
        richiesta_id: '11111111-2222-3333-4444-555555555555',
        chiamata_id: null,
        mk_contact_id: null,
        nome: 'Giulia',
        telefono: '+393331234567',
        email: 'giulia@example.it',
        appuntamento: {
            inizio: '2026-10-08T15:00:00+02:00',
            testo: 'giovedì 8 ottobre alle 15:00',
            giorno: '2026-10-08',
            ora: '15:00',
            fuso: 'Europe/Rome',
        },
        riassunto: 'Lavora: sì (commessa) · Figli a carico: no · Vuole cambiare lavoro.',
        lavora: 'sì',
        figli_a_carico: 'no',
        ...over,
    }
}

test('payload completo: si legge tutto', () => {
    const r = parseAgendaMario(corpo(), ADESSO)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.value.idInvio, 'agenda:11111111-2222-3333-4444-555555555555')
    assert.equal(r.value.chiaveTelefono, '3331234567')
    assert.equal(r.value.inizio.toISOString(), '2026-10-08T13:00:00.000Z')
    assert.equal(r.value.lavora, true)
    assert.equal(r.value.figli, false)
    assert.equal(r.value.nome, 'Giulia')
})

test('evento diverso o versione nuova: rifiutato, non si indovina il significato', () => {
    assert.deepEqual(parseAgendaMario(corpo({ evento: 'altro' }), ADESSO), { ok: false, reason: 'evento_ignoto' })
    assert.deepEqual(parseAgendaMario(corpo({ versione: 2 }), ADESSO), { ok: false, reason: 'versione_ignota' })
})

test('campi obbligatori mancanti', () => {
    assert.deepEqual(parseAgendaMario('x', ADESSO), { ok: false, reason: 'bad_request' })
    assert.deepEqual(parseAgendaMario(corpo({ id_invio: '' }), ADESSO), { ok: false, reason: 'id_invio_mancante' })
    assert.deepEqual(parseAgendaMario(corpo({ telefono: '12' }), ADESSO), { ok: false, reason: 'telefono_non_valido' })
    assert.deepEqual(parseAgendaMario(corpo({ appuntamento: null }), ADESSO), { ok: false, reason: 'data_mancante' })
    // Numeri segnaposto: non devono agganciare i lead finti che il CRM contiene.
    assert.deepEqual(parseAgendaMario(corpo({ telefono: '+390000000001' }), ADESSO), { ok: false, reason: 'telefono_non_valido' })
    assert.deepEqual(parseAgendaMario(corpo({ telefono: '3333333333' }), ADESSO), { ok: false, reason: 'telefono_non_valido' })
})

test("data senza scarto di fuso: rifiutata, un'ora sbagliata in silenzio vale meno di un errore", () => {
    const r = parseAgendaMario(corpo({ appuntamento: { inizio: '2026-10-08T15:00:00' } }), ADESSO)
    assert.deepEqual(r, { ok: false, reason: 'data_senza_offset' })
})

test('appuntamento gia passato: non si registra', () => {
    const r = parseAgendaMario(corpo({ appuntamento: { inizio: '2026-10-06T10:00:00+02:00' } }), ADESSO)
    assert.deepEqual(r, { ok: false, reason: 'appuntamento_passato' })
})

test('lavora e figli: solo "sì" vale vero, n.d. e null valgono no', () => {
    assert.equal(siNo('sì'), true)
    assert.equal(siNo('si'), true)
    assert.equal(siNo('SÌ'), true)
    assert.equal(siNo('no'), false)
    assert.equal(siNo('n.d.'), false)
    assert.equal(siNo(null), false)
    assert.equal(siNo(undefined), false)
})

test('nota: si riconosce chi ha fissato e si porta il riassunto', () => {
    assert.equal(notaAppuntamento('Vuole cambiare lavoro.'), '[Mario vocale] Vuole cambiare lavoro.')
    assert.equal(notaAppuntamento(null), '[Mario vocale] appuntamento fissato al telefono')
    assert.equal(notaAppuntamento('   '), '[Mario vocale] appuntamento fissato al telefono')
})

test('segreto: confronto esatto, e senza segreto configurato non passa nessuno', () => {
    assert.equal(segretoValido('abc', 'abc'), true)
    assert.equal(segretoValido('abd', 'abc'), false)
    assert.equal(segretoValido(null, 'abc'), false)
    assert.equal(segretoValido('abc', undefined), false)
    assert.equal(segretoValido('', ''), false)
})

test('scelta del lead: prima quello in coda IA vocale, poi il piu recente', () => {
    const vecchio = { id: 'a', inCodaIaVocale: false, createdAt: new Date('2026-01-01') }
    const nuovo = { id: 'b', inCodaIaVocale: false, createdAt: new Date('2026-09-01') }
    const coda = { id: 'c', inCodaIaVocale: true, createdAt: new Date('2025-12-01') }
    assert.equal(sceltaLead([]), null)
    assert.equal(sceltaLead([vecchio, nuovo])?.id, 'b')
    assert.equal(sceltaLead([vecchio, coda, nuovo])?.id, 'c')
})
