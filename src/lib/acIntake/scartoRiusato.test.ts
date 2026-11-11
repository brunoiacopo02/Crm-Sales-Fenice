import test from 'node:test';
import assert from 'node:assert/strict';
import { FINESTRA_RIUSO_SCARTO_MS, inizioRiusoScarto } from './scartoRiusato';

const riusabile = (creata: Date, now: Date) => creata.getTime() >= inizioRiusoScarto(now).getTime();

test('la finestra di riuso è di 24 ore', () => {
    assert.equal(FINESTRA_RIUSO_SCARTO_MS, 86_400_000);
    const now = new Date('2026-11-10T21:10:37Z');
    assert.equal(inizioRiusoScarto(now).toISOString(), '2026-11-09T21:10:37.000Z');
});

test('una raffica dello stesso contatto riusa la riga (un minuto prima)', () => {
    const now = new Date('2026-11-09T19:05:30Z');
    assert.equal(riusabile(new Date('2026-11-09T19:04:30Z'), now), true);
});

test('una riga di due mesi prima non assorbe il blocco nuovo (caso 114857, 15/09 -> 10/11)', () => {
    const now = new Date('2026-11-10T21:10:37Z');
    assert.equal(riusabile(new Date('2026-09-15T16:58:04Z'), now), false);
});

test('al limite delle 24 ore si riusa ancora, un attimo dopo no', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    assert.equal(riusabile(new Date('2026-11-10T12:00:00Z'), now), true);
    assert.equal(riusabile(new Date('2026-11-10T11:59:59Z'), now), false);
});
