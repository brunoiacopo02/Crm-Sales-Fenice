import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotsFromTemplate, isValidTemplateSlot, templateKey } from './calendarTemplate'
import { slotKey } from './calendarSlots'

const LUN = new Date('2026-09-14T00:00:00+02:00')   // lunedì
const PRIMA = new Date('2026-09-13T12:00:00+02:00') // domenica: tutta la settimana e' futura

test('il modello si espande sugli stessi giorni di tutte le settimane', () => {
    // 15:00 il lunedi (1) e il mercoledi (3)
    const slots = slotsFromTemplate([{ dow: 1, hour: 15 }, { dow: 3, hour: 15 }], LUN, PRIMA)
    assert.deepEqual(slots.map(slotKey), ['2026-09-14@15', '2026-09-16@15'])
})

test('le ore gia passate non si materializzano', () => {
    // meta' settimana: martedi 16 alle 16:30
    const meta = new Date('2026-09-15T16:30:00+02:00')
    const slots = slotsFromTemplate(
        [{ dow: 1, hour: 15 }, { dow: 2, hour: 15 }, { dow: 2, hour: 18 }, { dow: 3, hour: 15 }],
        LUN, meta,
    )
    // lunedi 15 e martedi 15 sono passate; restano martedi 18 e mercoledi 15
    assert.deepEqual(slots.map(slotKey), ['2026-09-15@18', '2026-09-16@15'])
})

test('un modello vuoto non produce niente', () => {
    assert.deepEqual(slotsFromTemplate([], LUN, PRIMA), [])
})

test('le voci fuori griglia sono scartate, non esplodono', () => {
    const slots = slotsFromTemplate(
        [{ dow: 7, hour: 15 }, { dow: 1, hour: 22 }, { dow: 1, hour: 8 }, { dow: 1, hour: 15 }],
        LUN, PRIMA,
    )
    assert.deepEqual(slots.map(slotKey), ['2026-09-14@15'])
})

test('isValidTemplateSlot accetta solo la griglia 1-6 / 9-21', () => {
    assert.equal(isValidTemplateSlot({ dow: 1, hour: 9 }), true)
    assert.equal(isValidTemplateSlot({ dow: 6, hour: 21 }), true)
    assert.equal(isValidTemplateSlot({ dow: 7, hour: 15 }), false)
    assert.equal(isValidTemplateSlot({ dow: 0, hour: 15 }), false)
    assert.equal(isValidTemplateSlot({ dow: 1, hour: 22 }), false)
    assert.equal(isValidTemplateSlot({ dow: 1, hour: 8 }), false)
})

test('templateKey e stabile e leggibile', () => {
    assert.equal(templateKey(3, 15), '3@15')
})
