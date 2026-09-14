import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCELTA_BY_KIND, isStessaPrenotazione } from './booking'
import type { LancioLeadRow } from './botGuard'

// Le scritture di booking.ts sono DB: qui si copre la parte che decide da
// sola, cioe' la dedup del doppio invio e la traduzione fascia -> lancioScelta
// (se sbagliasse, la pagina /lancio mostrerebbe la scelta di un altro).

const AT = new Date('2026-10-06T10:00:00+02:00')

function lead(over: Partial<LancioLeadRow> = {}): Pick<LancioLeadRow, 'lancioScelta' | 'appointmentDate'> {
    return { lancioScelta: null, appointmentDate: null, ...over }
}

test('le tre fasce scrivono tre scelte diverse', () => {
    assert.equal(SCELTA_BY_KIND.mattina, 'app_mattina')
    assert.equal(SCELTA_BY_KIND.pomeriggio, 'app_pomeriggio')
    assert.equal(SCELTA_BY_KIND.dopodomani, 'app_dopodomani')
})

test('stessa fascia e stesso istante: e\' il re-invio della stessa richiesta', () => {
    assert.equal(isStessaPrenotazione(lead({ lancioScelta: 'app_mattina', appointmentDate: AT }), 'mattina', AT), true)
    // Tolleranza 60 s: l'ISO puo' tornare arrotondato.
    const quasi = new Date(AT.getTime() + 45_000)
    assert.equal(isStessaPrenotazione(lead({ lancioScelta: 'app_mattina', appointmentDate: quasi }), 'mattina', AT), true)
})

test('un\'altra ora, un\'altra fascia o nessun appuntamento: prenotazione nuova', () => {
    const altraOra = new Date('2026-10-06T11:00:00+02:00')
    assert.equal(isStessaPrenotazione(lead({ lancioScelta: 'app_mattina', appointmentDate: altraOra }), 'mattina', AT), false)
    // Stesso istante ma il lead era stato messo in una fascia diversa: non e' dedup.
    assert.equal(isStessaPrenotazione(lead({ lancioScelta: 'app_pomeriggio', appointmentDate: AT }), 'mattina', AT), false)
    assert.equal(isStessaPrenotazione(lead({ lancioScelta: 'app_mattina' }), 'mattina', AT), false)
    assert.equal(isStessaPrenotazione(lead(), 'mattina', AT), false)
})

test('chiamata_subito non e\' una prenotazione: il lead si puo\' prenotare dopo', () => {
    assert.equal(isStessaPrenotazione(lead({ lancioScelta: 'chiamata_subito', appointmentDate: AT }), 'mattina', AT), false)
})
