import test from 'node:test';
import assert from 'node:assert/strict';
import {
    avvisoOraAffollata, contaPerOra, oreMenoPiene, parseSogliaOraAffollata, SOGLIA_ORA_AFFOLLATA_DEFAULT,
} from './oreOccupate';

// Martedì 10/11/2026 come l'ha visto il PO la sera del 09/11 (89 appuntamenti).
const MARTEDI = { 9: 0, 10: 19, 11: 6, 12: 4, 13: 2, 14: 4, 15: 7, 16: 10, 17: 2, 18: 13, 19: 9, 20: 6, 21: 7 };

test('contaPerOra: ora di Roma, giorni chiesti sempre presenti, il resto ignorato', () => {
    const c = contaPerOra([
        new Date('2026-11-10T09:00:00Z'), // 10:00 Roma (CET)
        new Date('2026-11-10T09:00:00Z'),
        new Date('2026-11-10T20:00:00Z'), // 21:00 Roma
        new Date('2026-11-10T22:00:00Z'), // 23:00 Roma: fuori dalle ore di call
        new Date('2026-11-12T09:00:00Z'), // giorno non chiesto
        null,
    ], ['2026-11-10', '2026-11-11']);
    assert.equal(c['2026-11-10'][10], 2);
    assert.equal(c['2026-11-10'][21], 1);
    assert.equal(c['2026-11-10'][15], 0);
    assert.deepEqual(Object.values(c['2026-11-11']).reduce((a, b) => a + b, 0), 0);
    assert.equal(c['2026-11-12'], undefined);
});

test('soglia: default se manca o non valida', () => {
    assert.equal(parseSogliaOraAffollata(null), SOGLIA_ORA_AFFOLLATA_DEFAULT);
    assert.equal(parseSogliaOraAffollata('abc'), SOGLIA_ORA_AFFOLLATA_DEFAULT);
    assert.equal(parseSogliaOraAffollata('0'), SOGLIA_ORA_AFFOLLATA_DEFAULT);
    assert.equal(parseSogliaOraAffollata(' 12 '), 12);
});

test('oreMenoPiene: le meno piene, mai le 9; agenda vuota non ricade sulle 10', () => {
    // 13 e 17 hanno 2 call; fra 12 e 14 (4 ciascuna) vince la 14, piu' vicina al centro.
    assert.deepEqual(oreMenoPiene(MARTEDI, 3), [13, 14, 17]);
    assert.deepEqual(oreMenoPiene(MARTEDI, 2), [13, 17]);
    const vuoto = Object.fromEntries([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((h) => [h, 0]));
    assert.deepEqual(oreMenoPiene(vuoto, 2), [15, 16]);
    assert.ok(!oreMenoPiene(vuoto, 4).includes(10));
});

test('avviso GDO: ora piena -> avviso con le ore piu libere; ora tranquilla -> niente', () => {
    const a = avvisoOraAffollata('2026-11-10T10:00', MARTEDI, 8);
    assert.equal(a, "Alle 10:00 ci sono già 19 appuntamenti. Se il lead può, proponi un'altra ora (più libere: 13:00, 14:00, 17:00); se può solo a quell'ora, fissa pure.");
    assert.equal(avvisoOraAffollata('2026-11-10T12:00', MARTEDI, 8), null);
    assert.equal(avvisoOraAffollata('2026-11-10T18:00', MARTEDI, 14), null);
    assert.equal(avvisoOraAffollata('2026-11-10T10:00', null, 8), null);
    assert.equal(avvisoOraAffollata('', MARTEDI, 8), null);
});
