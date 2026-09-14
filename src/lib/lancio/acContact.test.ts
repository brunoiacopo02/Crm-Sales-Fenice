import test from 'node:test';
import assert from 'node:assert/strict';
import { lancioContactId, readLancioAcContact } from './acContact';

// ------------------------------------------------------------ id

test('id: numerico, stringa o assente', () => {
    assert.equal(lancioContactId({ id: 123 }), '123');
    assert.equal(lancioContactId({ id: '456' }), '456');
    assert.equal(lancioContactId({}), null);
    assert.equal(lancioContactId({ id: '' }), null);
    assert.equal(lancioContactId(null), null);
});

// ------------------------------------------------------------ nome

test('nome: nome + cognome, con i trim, e il fallback della spec', () => {
    assert.equal(readLancioAcContact({ firstName: ' Mario ', lastName: ' Rossi ', phone: '3331234567' })?.name, 'Mario Rossi');
    assert.equal(readLancioAcContact({ firstName: 'Mario', phone: '3331234567' })?.name, 'Mario');
    assert.equal(readLancioAcContact({ lastName: 'Rossi', phone: '3331234567' })?.name, 'Rossi');
    assert.equal(readLancioAcContact({ phone: '3331234567' })?.name, 'Lead senza nome');
    assert.equal(readLancioAcContact({ firstName: '   ', lastName: '  ', phone: '3331234567' })?.name, 'Lead senza nome');
});

// ------------------------------------------------------------ email

test('email: trim, vuota diventa null', () => {
    assert.equal(readLancioAcContact({ email: ' a@b.it ', phone: '3331234567' })?.email, 'a@b.it');
    assert.equal(readLancioAcContact({ email: '   ', phone: '3331234567' })?.email, null);
    assert.equal(readLancioAcContact({ phone: '3331234567' })?.email, null);
});

// ------------------------------------------------------------ telefono
// Regole identiche a handleLancioIntake nel webhook AC: strict, poi lenient,
// poi il prefisso +39 si toglie (nel CRM i numeri italiani stanno senza).

test('mobile italiano: normalizzato e senza +39', () => {
    const r = readLancioAcContact({ phone: ' 333 123 4567 ', firstName: 'Mario' });
    assert.equal(r?.phone, '3331234567');
    assert.equal(r?.phoneSuspicious, false);
});

test('numero gia con +39: il prefisso si toglie una volta sola', () => {
    assert.equal(readLancioAcContact({ phone: '+39 333 1234567' })?.phone, '3331234567');
    assert.equal(readLancioAcContact({ phone: '0039 333 1234567' })?.phone, '3331234567');
});

test('prefisso estero: resta, il + compreso', () => {
    assert.equal(readLancioAcContact({ phone: '+33 612345678' })?.phone, '+33612345678');
});

test('numero troppo corto: passa dal lenient e resta, ma marcato sospetto', () => {
    const r = readLancioAcContact({ phone: '12345678' });
    assert.equal(r?.phone, '12345678');
    assert.equal(r?.phoneSuspicious, true);
});

test('0000000000: entra nel bucket ma sospetto (prefisso 00 -> strict fallisce)', () => {
    const r = readLancioAcContact({ phone: '0000000000' });
    assert.equal(r?.phone, '0000000000');
    assert.equal(r?.phoneSuspicious, true);
});

test('telefono assente o senza cifre: null (il sync lo conta in skippedNoPhone)', () => {
    assert.equal(readLancioAcContact({ phone: '' }), null);
    assert.equal(readLancioAcContact({}), null);
    assert.equal(readLancioAcContact({ phone: '   ' }), null);
    assert.equal(readLancioAcContact({ phone: 'non lo dico' }), null);
});
