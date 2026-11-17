import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eOraDelGiroSim } from './orario'

test('orario del giro: lun-sab dalle 9 alle 20 di Roma, con ora solare e legale', () => {
    // sabato 14/11/2026, ora solare (UTC+1)
    assert.equal(eOraDelGiroSim(new Date('2026-11-14T07:05:00Z')), false) // 08:05
    assert.equal(eOraDelGiroSim(new Date('2026-11-14T08:05:00Z')), true) // 09:05
    assert.equal(eOraDelGiroSim(new Date('2026-11-14T19:05:00Z')), true) // 20:05
    assert.equal(eOraDelGiroSim(new Date('2026-11-14T20:05:00Z')), false) // 21:05
    // domenica 15/11/2026
    assert.equal(eOraDelGiroSim(new Date('2026-11-15T10:05:00Z')), false)
    // lunedì 15/06/2026, ora legale (UTC+2)
    assert.equal(eOraDelGiroSim(new Date('2026-06-15T07:05:00Z')), true) // 09:05
    assert.equal(eOraDelGiroSim(new Date('2026-06-15T18:05:00Z')), true) // 20:05
    assert.equal(eOraDelGiroSim(new Date('2026-06-15T19:05:00Z')), false) // 21:05
})
