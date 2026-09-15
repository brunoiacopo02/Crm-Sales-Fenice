import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCELTA_BY_KIND, decideBooking } from './booking'
import { romeIso } from '@/lib/dateUtils'
import type { LancioLeadRow } from './botGuard'

// Le scritture di booking.ts sono DB: qui si copre la parte che decide da
// sola, cioe' cosa fare della richiesta guardando solo il lead — dedup del
// doppio invio, rifiuto del secondo appuntamento, traduzione fascia ->
// lancioScelta (se sbagliasse, /lancio mostrerebbe la scelta di un altro).

const AT = new Date('2026-10-06T10:00:00+02:00')

function lead(over: Partial<LancioLeadRow> = {}): Pick<LancioLeadRow, 'lancioScelta' | 'appointmentDate'> {
    return { lancioScelta: null, appointmentDate: null, ...over }
}

test('le tre fasce scrivono tre scelte diverse', () => {
    assert.equal(SCELTA_BY_KIND.mattina, 'app_mattina')
    assert.equal(SCELTA_BY_KIND.pomeriggio, 'app_pomeriggio')
    assert.equal(SCELTA_BY_KIND.dopodomani, 'app_dopodomani')
})

test('lead senza prenotazione: si prenota', () => {
    assert.deepEqual(decideBooking(lead(), 'mattina', AT), { azione: 'prenota' })
    // Data ma nessuna scelta del lancio (appuntamento di un altro funnel).
    assert.deepEqual(decideBooking(lead({ appointmentDate: AT }), 'mattina', AT), { azione: 'prenota' })
    // Scelta del lancio ma senza data: prenotazione monca, si finisce.
    assert.deepEqual(decideBooking(lead({ lancioScelta: 'app_mattina' }), 'mattina', AT), { azione: 'prenota' })
})

test('stesso istante: e\' il re-invio della stessa richiesta, non un secondo appuntamento', () => {
    assert.deepEqual(decideBooking(lead({ lancioScelta: 'app_mattina', appointmentDate: AT }), 'mattina', AT), { azione: 'dedup' })
    // Tolleranza 60 s: l'ISO puo' tornare arrotondato.
    const quasi = new Date(AT.getTime() + 45_000)
    assert.deepEqual(decideBooking(lead({ lancioScelta: 'app_mattina', appointmentDate: quasi }), 'mattina', AT), { azione: 'dedup' })
})

test('ha gia prenotato e chiede un\'altra ora: rifiutato, sposta chi di dovere', () => {
    const gia = new Date('2026-10-06T11:00:00+02:00')
    assert.deepEqual(decideBooking(lead({ lancioScelta: 'app_mattina', appointmentDate: gia }), 'mattina', AT), {
        azione: 'gia_prenotato', kind: 'mattina', at: gia,
    })
    // Anche cambiando fascia: il pomeriggio gia' preso non diventa mattina da qui.
    const pomeriggio = new Date('2026-10-06T16:00:00+02:00')
    assert.deepEqual(decideBooking(lead({ lancioScelta: 'app_pomeriggio', appointmentDate: pomeriggio }), 'mattina', AT), {
        azione: 'gia_prenotato', kind: 'pomeriggio', at: pomeriggio,
    })
    // Oltre i 60 s di tolleranza e' un'altra ora, non un re-invio.
    const quasiMaNo = new Date(AT.getTime() + 61_000)
    assert.equal(decideBooking(lead({ lancioScelta: 'app_dopodomani', appointmentDate: quasiMaNo }), 'mattina', AT).azione, 'gia_prenotato')
})

test('chiamata_subito e followup non sono prenotazioni: dopo si prenota', () => {
    assert.deepEqual(decideBooking(lead({ lancioScelta: 'chiamata_subito', appointmentDate: AT }), 'mattina', AT), { azione: 'prenota' })
    assert.deepEqual(decideBooking(lead({ lancioScelta: 'followup', appointmentDate: AT }), 'mattina', AT), { azione: 'prenota' })
})

test('l\'ora che torna al bot e ora italiana con offset, non UTC', () => {
    // Ora legale: +02:00, e le 10 restano le 10 (toISOString direbbe 08:00Z).
    assert.equal(romeIso(AT), '2026-10-06T10:00:00+02:00')
    // Ora solare: +01:00.
    assert.equal(romeIso(new Date('2026-12-06T10:00:00+01:00')), '2026-12-06T10:00:00+01:00')
    // Mezzanotte italiana: h23, non "24".
    assert.equal(romeIso(new Date('2026-10-06T00:00:00+02:00')), '2026-10-06T00:00:00+02:00')
})
