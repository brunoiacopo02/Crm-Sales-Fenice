import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentSlotWarning } from './appointmentSlotWarning';

const SAB_15 = new Date('2026-10-24T13:00:00Z'); // sab 24/10 15:00 Roma (CEST)
const PASSATO = 'Data nel passato o per oggi: fissa per domani o dopodomani, dalle 10:00 alle 21:00.';
const LONTANA = 'Data troppo lontana: fissa per domani o dopodomani, dalle 10:00 alle 21:00.';

test('sabato: lunedi e martedi ammessi (la domenica non conta)', () => {
    assert.equal(appointmentSlotWarning('2026-10-26T15:00', SAB_15), null);
    assert.equal(appointmentSlotWarning('2026-10-27T11:00', SAB_15), null);
});
test('lunedi 26/10: le Conferme attaccano alle 13, mattina non prenotabile', () => {
    assert.equal(
        appointmentSlotWarning('2026-10-26T11:00', SAB_15),
        'Lunedì 26 le Conferme attaccano alle 13: fissa dalle 15:00 alle 21:00.',
    );
});
test('sabato: mercoledi troppo lontano, oggi passato', () => {
    assert.equal(appointmentSlotWarning('2026-10-28T11:00', SAB_15), LONTANA);
    assert.equal(appointmentSlotWarning('2026-10-24T18:00', SAB_15), PASSATO);
});
test('domenica: messaggio dedicato', () => {
    assert.equal(
        appointmentSlotWarning('2026-10-25T11:00', SAB_15),
        'La domenica non si fissano appuntamenti: fissa per domani o dopodomani, dalle 10:00 alle 21:00.',
    );
});
test('usa il giorno di Roma, non UTC: mar 23:30 Roma -> mer 10:00 ok', () => {
    const now = new Date('2026-10-27T22:30:00Z'); // 23:30 Roma (CET dal 25/10)
    assert.equal(appointmentSlotWarning('2026-10-28T10:00', now), null);
});
test('orari: le 9 e fuori finestra', () => {
    const lun = new Date('2026-10-26T10:00:00Z');
    assert.equal(
        appointmentSlotWarning('2026-10-27T09:00', lun),
        "Le 9:00 solo se il lead non può in nessun altro orario: la fascia giusta è dalle 10:00 alle 21:00.",
    );
    assert.equal(appointmentSlotWarning('2026-10-27T22:00', lun), "Orario fuori finestra: l'appuntamento va dalle 10:00 alle 21:00.");
    assert.equal(appointmentSlotWarning('2026-10-27T21:00', lun), null);
});
test('input vuoto o invalido: nessun avviso', () => {
    assert.equal(appointmentSlotWarning('', SAB_15), null);
    assert.equal(appointmentSlotWarning('boh', SAB_15), null);
});
