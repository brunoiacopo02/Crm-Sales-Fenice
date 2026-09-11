import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getBiweeklyCycle,
    getBiweeklyCycleByIndex,
    getRecentClosedCycles,
    BRIDGE_CYCLE_INDEX,
} from './biweeklyCycle';

/** Istante UTC corrispondente a un orario Europe/Rome. */
const rome = (iso: string, offset: string) => new Date(`${iso}${offset}`);

test('oggi (11 set 2026) cade nel ciclo 31 ago - 13 set, 2a settimana', () => {
    const c = getBiweeklyCycle(rome('2026-09-11T15:00:00', '+02:00'));
    assert.equal(c.startDateStr, '2026-08-31');
    assert.equal(c.endDateStr, '2026-09-13');
    assert.equal(c.label, '31 ago - 13 set');
    assert.equal(c.index, 8);
});

test('il primo istante del 31 agosto apre il ciclo riallineato', () => {
    const c = getBiweeklyCycle(rome('2026-08-31T00:00:00', '+02:00'));
    assert.equal(c.index, 8);
    assert.equal(c.startDateStr, '2026-08-31');
});

test("l'ultimo istante del 30 agosto sta ancora nel raccordo, non nel ciclo nuovo", () => {
    const c = getBiweeklyCycle(rome('2026-08-30T23:59:59.999', '+02:00'));
    assert.equal(c.index, BRIDGE_CYCLE_INDEX);
    assert.equal(c.isBridge, true);
    assert.equal(c.startDateStr, '2026-08-24');
    assert.equal(c.endDateStr, '2026-08-30');
});

test('lo storico prima del riallineamento resta identico (10-23 ago = indice 7)', () => {
    const c = getBiweeklyCycle(rome('2026-08-23T12:00:00', '+02:00'));
    assert.equal(c.index, 7);
    assert.equal(c.startDateStr, '2026-08-10');
    assert.equal(c.endDateStr, '2026-08-23');
    assert.equal(c.label, '10-23 ago');
});

test("il primo ciclo storico e' ancora 4-17 mag (indice 0)", () => {
    const c = getBiweeklyCycle(rome('2026-05-04T00:00:00', '+02:00'));
    assert.equal(c.index, 0);
    assert.equal(c.label, '4-17 mag');
});

test('il raccordo 24-30 ago non compare nello storico dei cicli chiusi', () => {
    const closed = getRecentClosedCycles(4, rome('2026-09-11T15:00:00', '+02:00'));
    assert.deepEqual(closed.map(c => c.label), [
        '10-23 ago',
        '27 lug - 9 ago',
        '13-26 lug',
        '29 giu - 12 lug',
    ]);
    assert.ok(closed.every(c => !c.isBridge));
});

test('i cicli sono contigui: end di uno = start del successivo', () => {
    for (let i = 0; i <= 12; i++) {
        if (i === 7) continue; // il raccordo interrompe volutamente la continuita'
        const a = getBiweeklyCycleByIndex(i);
        const b = getBiweeklyCycleByIndex(i + 1);
        assert.equal(a.end.getTime(), b.start.getTime(), `ciclo ${i} -> ${i + 1}`);
    }
});

test('il ciclo 7 finisce il 23 ago e il ciclo 8 parte il 31: in mezzo c\'e\' il raccordo', () => {
    const sette = getBiweeklyCycleByIndex(7);
    const otto = getBiweeklyCycleByIndex(8);
    const raccordo = getBiweeklyCycleByIndex(BRIDGE_CYCLE_INDEX);
    assert.equal(sette.end.getTime(), raccordo.start.getTime());
    assert.equal(raccordo.end.getTime(), otto.start.getTime());
});

test('i confini restano mezzanotte Rome anche dopo la fine dell\'ora legale', () => {
    // 26 ott 2026 e' gia' CET (+01:00): l'ora legale finisce domenica 25 ott.
    const c = getBiweeklyCycleByIndex(12);
    assert.equal(c.startDateStr, '2026-10-26');
    assert.equal(c.start.toISOString(), '2026-10-25T23:00:00.000Z');
    assert.equal(c.endDateStr, '2026-11-08');
});

test('ogni ciclo standard dura 14 giorni, il raccordo 7', () => {
    const giorni = (c: { start: Date; end: Date }) =>
        Math.round((c.end.getTime() - c.start.getTime()) / 86_400_000);
    // 14 giorni pieni anche a cavallo del cambio ora? no: quel ciclo dura 14g + 1h.
    assert.equal(giorni(getBiweeklyCycleByIndex(8)), 14);
    assert.equal(giorni(getBiweeklyCycleByIndex(BRIDGE_CYCLE_INDEX)), 7);
});
