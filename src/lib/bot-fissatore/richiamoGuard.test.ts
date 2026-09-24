import test from 'node:test';
import assert from 'node:assert/strict';
import { richiamoDalBotDiventaNota, buildRichiamoDegradatoNote } from './richiamoGuard';
import { isSameBotNoteIntent } from './noteDedup';

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

// botNoteIntentKey (noteDedup.ts) taglia al primo punto seguito da spazio/fine
// stringa (o prima di "motivo:", qui assente). Se il "quando" cade DOPO quel
// punto, due RICHIAMO degradati con date/periodi diversi finiscono con la
// stessa chiave e il secondo viene marcato come duplicato del primo —
// silenziando la notifica alle Conferme su una richiesta di rifissaggio
// diversa dalla precedente (vedi route.ts, ramo NOTA, isDuplicate).
test('due note degradate con date diverse non sono lo stesso intento', () => {
    const a = buildRichiamoDegradatoNote({ date: '2026-10-05T15:00:00+02:00' });
    const b = buildRichiamoDegradatoNote({ date: '2026-11-12T09:30:00+01:00' });
    assert.equal(isSameBotNoteIntent(a, b), false);
});

test('due note degradate con periodo diverso non sono lo stesso intento', () => {
    const a = buildRichiamoDegradatoNote({ periodo: 'a settembre' });
    const b = buildRichiamoDegradatoNote({ periodo: 'a ottobre' });
    assert.equal(isSameBotNoteIntent(a, b), false);
});

test('due note degradate identiche sono lo stesso intento', () => {
    const a = buildRichiamoDegradatoNote({ date: '2026-10-05T15:00:00+02:00', note: 'sta cambiando lavoro' });
    const b = buildRichiamoDegradatoNote({ date: '2026-10-05T15:00:00+02:00', note: 'sta cambiando lavoro' });
    assert.equal(isSameBotNoteIntent(a, b), true);
});
