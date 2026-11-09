import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FINESTRA_NOTIFICA_BF_MS, TIPO_NOTIFICA_BF, daNotificareBf, idNotificaBf, notificaBf, type ArrivoBf } from './notificaBf'
import { oraArrivo } from './arrivo'

const ORA = new Date('2026-11-09T15:30:00Z')
const arrivo = (p: Partial<ArrivoBf> = {}): ArrivoBf => ({
    leadId: 'L1', gdoId: 'G106', nome: 'Mario Rossi', funnel: 'BLACK FRIDAY', status: 'NEW',
    arrivo: new Date('2026-11-09T15:00:00Z'), companyId: 'fenice', ...p,
})

test('notifica BF: solo lead Black Friday aperti, arrivati da poco', () => {
    assert.equal(daNotificareBf(arrivo(), ORA), true)
    assert.equal(daNotificareBf(arrivo({ funnel: ' black friday ' }), ORA), true)
    assert.equal(daNotificareBf(arrivo({ funnel: 'CORSO 10 ORE' }), ORA), false)
    assert.equal(daNotificareBf(arrivo({ status: 'APPOINTMENT' }), ORA), false)
    assert.equal(daNotificareBf(arrivo({ status: 'REJECTED' }), ORA), false)
    assert.equal(daNotificareBf(arrivo({ status: 'IN_PROGRESS' }), ORA), true)
    assert.equal(daNotificareBf(arrivo({ arrivo: new Date(ORA.getTime() - FINESTRA_NOTIFICA_BF_MS - 1) }), ORA), false)
})

test('notifica BF: riga per la campanella, id stabile per lead + GDO + arrivo', () => {
    const r = notificaBf(arrivo())
    assert.equal(r.type, TIPO_NOTIFICA_BF)
    assert.equal(r.recipientUserId, 'G106')
    assert.equal(r.title, 'Lead Black Friday: chiamalo subito')
    assert.equal(r.body, 'Mario Rossi è in cima alla prima chiamata. Priorità su tutto.')
    assert.deepEqual(r.metadata, { leadId: 'L1', coda: 'first', funnel: 'BLACK FRIDAY' })
    assert.equal(r.id, notificaBf(arrivo()).id)
    // nuovo arrivo dello stesso lead allo stesso GDO = altra notifica
    assert.notEqual(r.id, notificaBf(arrivo({ arrivo: new Date('2026-11-09T15:20:00Z') })).id)
    assert.notEqual(r.id, notificaBf(arrivo({ gdoId: 'G110' })).id)
    assert.equal(notificaBf(arrivo({ nome: '  ' })).body.startsWith('Un lead Black Friday'), true)
})

test('notifica BF: la chiave del percorso che assegna e della pipeline coincide (ora di arrivo dagli eventi)', () => {
    const eventi = [
        { eventType: 'REASSIGNED_FROM_BOT', userId: 'G106', timestamp: new Date('2026-11-09T14:00:00.123Z') },
        { eventType: 'BOT_PUSHED', userId: 'BOT', timestamp: new Date('2026-11-09T15:00:00Z') },
    ]
    const a = oraArrivo({ eventi, proprietario: 'G106', assignedAt: new Date('2026-11-07T10:00:00Z'), createdAt: new Date('2026-11-07T10:00:00Z') })
    assert.equal(idNotificaBf('L1', 'G106', a), 'lead_bf_arrivato:L1:G106:' + Date.parse('2026-11-09T14:00:00.123Z'))
})
