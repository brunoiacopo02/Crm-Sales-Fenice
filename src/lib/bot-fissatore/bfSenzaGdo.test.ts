import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bfDaRiprendere, type CandidatoBf } from './bfSenzaGdoRegole'
import { instradamentoRidato } from './maiConsegnato'
import { accantonabile, pianoAccantonamento, type GdoGiro, type LeadGiro } from '../diretta/automatico'

const NOTA_MAI_RISPOSTO = 'Sequenza completa: 1 messaggi consegnati, mai una risposta. Da provare a voce.'

// Bug 08-09/11/2026 (Giovanna, Raffaella Napoli): BF ridato mai_risposto e parcheggiato.
test('BF ridato mai_risposto non letto -> giro GDO, mai parcheggiato', () => {
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, false, 'BLACK FRIDAY'), 'giro_gdo')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, null, 'BLACK FRIDAY'), 'giro_gdo')
    assert.equal(instradamentoRidato('mai_risposto', null, undefined, ' black friday '), 'giro_gdo')
    assert.equal(instradamentoRidato('chat_interrotta', null, null, 'BLACK FRIDAY'), 'giro_gdo')
})

test('gli altri funnel mai_risposto non letti restano parcheggiati', () => {
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, false, 'JOB SIMULATOR'), 'parcheggia')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, null, null), 'parcheggia')
    assert.equal(instradamentoRidato('mai_risposto', NOTA_MAI_RISPOSTO, false, 'Black Summer'), 'parcheggia')
})

const base = (p: Partial<CandidatoBf> = {}): CandidatoBf => ({
    assignedToId: null, status: 'NEW', appointmentDate: null, presentedAt: null, confirmationsUserId: null,
    reservedSalespersonId: null, isTest: false, tornatoDalBot: true, ...p,
})

test('BF senza GDO da riprendere: aperto, di nessuno, tornato dal bot', () => {
    assert.equal(bfDaRiprendere(base()), true)
    assert.equal(bfDaRiprendere(base({ status: 'IN_PROGRESS' })), true)
    assert.equal(bfDaRiprendere(base({ assignedToId: 'g116' })), false, 'già di qualcuno')
    assert.equal(bfDaRiprendere(base({ tornatoDalBot: false })), false, 'fresco mai passato dal bot: non si tocca')
    assert.equal(bfDaRiprendere(base({ status: 'REJECTED' })), false)
    assert.equal(bfDaRiprendere(base({ status: 'APPOINTMENT' })), false)
    assert.equal(bfDaRiprendere(base({ appointmentDate: new Date() })), false)
    assert.equal(bfDaRiprendere(base({ presentedAt: new Date() })), false)
    assert.equal(bfDaRiprendere(base({ confirmationsUserId: 'c1' })), false)
    assert.equal(bfDaRiprendere(base({ reservedSalespersonId: 's1' })), false)
    assert.equal(bfDaRiprendere(base({ isTest: true })), false)
})

const ORA = new Date('2026-11-09T20:45:00+01:00')
const giorniFa = (n: number) => new Date(ORA.getTime() - n * 24 * 3600 * 1000)
let n = 0
function lead(p: Partial<LeadGiro> = {}): LeadGiro {
    return {
        id: `l${n++}`, status: 'NEW', callCount: 0, source: 'activecampaign', launchBucket: null, funnel: 'TELEGRAM',
        createdAt: giorniFa(10), updatedAt: giorniFa(2), scortaStato: 'scorta', scortaDal: giorniFa(2),
        cercato: false, ultimoMotivo: 'mai_risposto', ultimoInstradato: 'letto', passatoDalBot: true,
        arrivedAt: giorniFa(3), assignedToId: 'g105', recallDate: null, appointmentDate: null, presentedAt: null,
        lastCallDate: null, inConferme: false, lancio: false, ridatoDalBot: true, version: 1,
        ...p,
    }
}

test('giro serale: un BF ridato oltre 8 giorni non si accantona mai', () => {
    assert.equal(accantonabile(lead(), ORA), true)
    assert.equal(accantonabile(lead({ funnel: 'BLACK FRIDAY' }), ORA), false)
    assert.equal(accantonabile(lead({ funnel: 'black friday' }), ORA), false)
    // GDO a 80: si accantonano 20 ridati vecchi, mai i BF anche se sono i più vecchi.
    const g: GdoGiro[] = [{ id: 'g105', codice: 105, inGiro: true, ultimaChiamata: giorniFa(0.1), creatoIl: giorniFa(200) }]
    const bf = Array.from({ length: 10 }, () => lead({ funnel: 'BLACK FRIDAY', createdAt: giorniFa(20) }))
    const altri = Array.from({ length: 70 }, () => lead())
    const piano = pianoAccantonamento(g, [...bf, ...altri], ORA)
    assert.equal(piano.length, 20)
    const idBf = new Set(bf.map(l => l.id))
    assert.ok(piano.every(a => !idBf.has(a.leadId)))
})
