import test from 'node:test';
import assert from 'node:assert/strict';
import { richiamoDalBotDiventaNota, buildRichiamoDegradatoNote } from './richiamoGuard';

test('solo RICHIAMO viene degradato a nota', () => {
    assert.equal(richiamoDalBotDiventaNota('RICHIAMO'), true);
    for (const o of ['APPUNTAMENTO', 'DA_SCARTARE', 'NON_RISPOSTO', 'INTERROTTO', 'NOTA', 'CONTATTO_UMANO']) {
        assert.equal(richiamoDalBotDiventaNota(o), false, `${o} non deve essere degradato`);
    }
});

test('la nota dice il quando quando il bot lo manda come data', () => {
    const n = buildRichiamoDegradatoNote({ date: '2026-10-05T15:00:00+02:00' });
    assert.ok(n.includes('VOLEVA ESSERE RISENTITO'));
    assert.ok(n.includes('05/10/2026'));
    assert.ok(!n.toLowerCase().includes('richiamo fissato'));
});

test('la nota dice il quando quando il bot lo manda come periodo', () => {
    const n = buildRichiamoDegradatoNote({ periodo: 'a settembre' });
    assert.ok(n.includes('a settembre'));
});

test('la nota regge senza data e senza periodo', () => {
    const n = buildRichiamoDegradatoNote({});
    assert.ok(n.includes('non ha detto quando'));
});

test('la nota porta la nota originale del bot quando c\'è', () => {
    const n = buildRichiamoDegradatoNote({ periodo: 'a ottobre', note: 'sta cambiando lavoro' });
    assert.ok(n.includes('sta cambiando lavoro'));
});
