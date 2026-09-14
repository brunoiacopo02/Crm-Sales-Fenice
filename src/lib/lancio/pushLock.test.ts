import test from 'node:test';
import assert from 'node:assert/strict';
import { LANCIO_PUSH_LOCK_KEY, lockPreso } from './pushLock';

test('la chiave del lock e stabile: cambiarla significa due push in parallelo', () => {
    assert.equal(LANCIO_PUSH_LOCK_KEY, 'lancio_push');
});

test('preso: le due forme in cui drizzle puo tornare le righe', () => {
    assert.equal(lockPreso({ rows: [{ preso: true }] }), true);
    assert.equal(lockPreso([{ preso: true }]), true);
});

test('non preso: c e gia un push in corso', () => {
    assert.equal(lockPreso({ rows: [{ preso: false }] }), false);
    assert.equal(lockPreso([{ preso: false }]), false);
});

test('nel dubbio NON si spinge: qualunque risposta strana vale "occupato"', () => {
    // Sbagliare in questa direzione ferma il push (rumoroso, si riclicca);
    // sbagliare nell'altra aprirebbe due volte la stessa chat.
    for (const strano of [null, undefined, {}, { rows: [] }, [], { rows: [{}] }, { rows: [{ preso: 't' }] }, 'ok', 1]) {
        assert.equal(lockPreso(strano), false, `risposta ${JSON.stringify(strano) ?? 'undefined'}`);
    }
});
