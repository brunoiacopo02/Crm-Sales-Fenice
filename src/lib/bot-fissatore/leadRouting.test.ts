import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoutingWindow, getLeadRouting, BOT_DAILY_CAP } from './leadRouting';

/** Istante UTC → Date. Il server Vercel gira in UTC, la regola è su Europe/Rome. */
const utc = (iso: string) => new Date(iso);

function withEnv(value: string | undefined, fn: () => void) {
    const prev = process.env.BOT_ROUTING;
    if (value === undefined) delete process.env.BOT_ROUTING;
    else process.env.BOT_ROUTING = value;
    try { fn(); } finally {
        if (prev === undefined) delete process.env.BOT_ROUTING;
        else process.env.BOT_ROUTING = prev;
    }
}

// ---------------------------------------------------------------- feriali

// 2026-08-24 è un lunedì. Agosto è ora legale (CEST, +2): 11:00 UTC = 13:00 a Roma.
test('feriale: alle 12:59 il lead è ancora del bot, alle 13:00 passa alla fascia GDO', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-24T10:59:00Z')), 'bot_only');
    assert.equal(resolveRoutingWindow(utc('2026-08-24T11:00:00Z')), 'bot_first');
});

test('feriale: alle 19:59 siamo ancora nella fascia GDO, alle 20:00 torna tutto al bot', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-24T17:59:00Z')), 'bot_first');
    assert.equal(resolveRoutingWindow(utc('2026-08-24T18:00:00Z')), 'bot_only');
});

test('feriale: la notte è sempre del bot', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-24T22:00:00Z')), 'bot_only'); // mezzanotte a Roma (martedì)
    assert.equal(resolveRoutingWindow(utc('2026-08-25T01:00:00Z')), 'bot_only'); // 03:00 a Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-25T05:30:00Z')), 'bot_only'); // 07:30 a Roma
});

test('la fascia GDO vale tutti i giorni feriali, non solo il lunedì', () => {
    // 25→28 agosto 2026 = martedì → venerdì, alle 15:00 di Roma
    for (const day of ['25', '26', '27', '28']) {
        assert.equal(resolveRoutingWindow(utc(`2026-08-${day}T13:00:00Z`)), 'bot_first', `giorno ${day}`);
    }
});

// ---------------------------------------------------------------- sabato

// 2026-08-22 è un sabato. Turno GDO 10:00 → 16:30.
test('sabato: prima delle 10:00 i lead sono del bot', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-22T07:59:00Z')), 'bot_only'); // 09:59 Roma
});

test('sabato: dalle 10:00 alle 16:30 i lead vanno ai GDO, bot escluso anche se sotto quota', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-22T08:00:00Z')), 'gdo_only'); // 10:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T12:00:00Z')), 'gdo_only'); // 14:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T14:29:00Z')), 'gdo_only'); // 16:29 Roma
});

test('sabato: a fine turno (16:30) tutto torna al bot', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-22T14:30:00Z')), 'bot_only'); // 16:30 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T20:00:00Z')), 'bot_only'); // 22:00 Roma
});

// ---------------------------------------------------------------- domenica

// 2026-08-23 è una domenica.
test('domenica: tutto al bot a qualsiasi ora, anche nella fascia in cui il sabato lavorano i GDO', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-23T06:00:00Z')), 'bot_only'); // 08:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-23T09:00:00Z')), 'bot_only'); // 11:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-23T13:00:00Z')), 'bot_only'); // 15:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-23T21:00:00Z')), 'bot_only'); // 23:00 Roma
});

// ---------------------------------------------------------------- ora legale

test('la fascia segue l\'ora di Roma, non quella UTC (ora solare)', () => {
    // 15 gennaio 2026 è un giovedì, CET (+1): 12:00 UTC = 13:00 a Roma.
    assert.equal(resolveRoutingWindow(utc('2026-01-15T11:59:00Z')), 'bot_only');  // 12:59 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-15T12:00:00Z')), 'bot_first'); // 13:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-15T18:59:00Z')), 'bot_first'); // 19:59 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-15T19:00:00Z')), 'bot_only');  // 20:00 Roma
});

test('il giorno della settimana è quello di Roma, non quello UTC', () => {
    // 2026-08-23T22:30:00Z = lunedì 24 agosto 00:30 a Roma: notte feriale, non domenica.
    assert.equal(resolveRoutingWindow(utc('2026-08-23T22:30:00Z')), 'bot_only');
    // 2026-08-22T22:30:00Z = domenica 23 agosto 00:30 a Roma.
    assert.equal(resolveRoutingWindow(utc('2026-08-22T22:30:00Z')), 'bot_only');
    // Il caso che distingue davvero: sabato 22 alle 08:00 Roma è ancora venerdì 21 in nessun fuso
    // usato qui, ma alle 12:00 Roma di sabato la regola sabato deve vincere su quella feriale.
    assert.equal(resolveRoutingWindow(utc('2026-08-22T10:00:00Z')), 'gdo_only'); // sabato 12:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-21T10:00:00Z')), 'bot_only'); // venerdì 12:00 Roma
});

// ---------------------------------------------------------------- interruttore

test('senza env la regola è attiva', () => {
    withEnv(undefined, () => {
        assert.equal(getLeadRouting(utc('2026-08-24T11:00:00Z')), 'bot_first');
    });
});

test('BOT_ROUTING=off riporta il round-robin storico', () => {
    for (const off of ['off', 'OFF', 'none', 'disabled', 'false', '0']) {
        withEnv(off, () => {
            assert.equal(getLeadRouting(utc('2026-08-24T11:00:00Z')), 'legacy');
            assert.equal(getLeadRouting(utc('2026-08-23T09:00:00Z')), 'legacy');
        });
    }
});

test('un valore non riconosciuto non spegne la regola', () => {
    withEnv('si', () => {
        assert.equal(getLeadRouting(utc('2026-08-24T11:00:00Z')), 'bot_first');
    });
});

test('il tetto giornaliero del bot è 100', () => {
    assert.equal(BOT_DAILY_CAP, 100);
});
