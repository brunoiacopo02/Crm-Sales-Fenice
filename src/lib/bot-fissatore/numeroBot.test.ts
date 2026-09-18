import test from 'node:test';
import assert from 'node:assert/strict';
import { numeroBotPerNuovoLead, tettoBot2, TETTO_BOT2_DEFAULT } from './numeroBot';

const conEnv = (v: string | undefined, fn: () => void) => {
    const prima = process.env.BOT2_DAILY_CAP;
    if (v === undefined) delete process.env.BOT2_DAILY_CAP; else process.env.BOT2_DAILY_CAP = v;
    try { fn(); } finally {
        if (prima === undefined) delete process.env.BOT2_DAILY_CAP; else process.env.BOT2_DAILY_CAP = prima;
    }
};

test('sotto il tetto va al numero nuovo', () => {
    assert.equal(numeroBotPerNuovoLead(0, 150), 2);
    assert.equal(numeroBotPerNuovoLead(149, 150), 2);
});

test('al tetto e oltre torna al numero storico', () => {
    assert.equal(numeroBotPerNuovoLead(150, 150), 1);
    assert.equal(numeroBotPerNuovoLead(400, 150), 1);
});

test('conteggio sconosciuto: numero storico, mai il nuovo', () => {
    assert.equal(numeroBotPerNuovoLead(-1, 150), 1);
    assert.equal(numeroBotPerNuovoLead(NaN, 150), 1);
    assert.equal(numeroBotPerNuovoLead(Infinity, 150), 1);
});

test('tetto a zero: tutto al numero storico', () => {
    assert.equal(numeroBotPerNuovoLead(0, 0), 1);
});

test('il tetto si legge da env e un valore assurdo ricade sul default', () => {
    conEnv('40', () => assert.equal(tettoBot2(), 40));
    for (const v of ['tanti', '-5', '2.5', '99999']) {
        conEnv(v, () => assert.equal(tettoBot2(), TETTO_BOT2_DEFAULT, `valore "${v}"`));
    }
    conEnv(undefined, () => assert.equal(tettoBot2(), TETTO_BOT2_DEFAULT));
});
