import test from 'node:test';
import assert from 'node:assert/strict';
import {
    UTM_FIELD_IDS, readFieldLocal, readUtmFields, hasAnyUtm, indexFieldValuesByContact,
} from './utmFields';
import { buildLancioLeadRow } from '../lancio/intake';

/** Una risposta AC vera (lista 132, contatto 230768, letta il 19/09/2026). */
const FIELD_VALUES_REALI = [
    { contact: '230768', field: '31', value: 'Facebook' },
    { contact: '230768', field: '32', value: 'Paid' },
    { contact: '230768', field: '33', value: 'Cbo - Lancio Web Dev AI - test video e creative' },
    { contact: '230768', field: '34', value: '17/09 - Broad - test video' },
    { contact: '230768', field: '35', value: 'Video 1 Marta - vuoi diventare' },
    { contact: '230768', field: '44', value: 'fb.1.1789717860847.Iwc...' },
    { contact: '230768', field: '2', value: 'Lancio Web Developer AI' },
];

test('gli id dei custom field sono quelli del webhook', () => {
    assert.deepEqual(UTM_FIELD_IDS, {
        utmSource: '31', utmMedium: '32', utmCampaign: '33', utmContent: '34', utmTerm: '35',
    });
});

test('mappa i cinque UTM da una risposta AC vera', () => {
    assert.deepEqual(readUtmFields(FIELD_VALUES_REALI), {
        utmSource: 'Facebook',
        utmMedium: 'Paid',
        utmCampaign: 'Cbo - Lancio Web Dev AI - test video e creative',
        utmContent: '17/09 - Broad - test video',
        utmTerm: 'Video 1 Marta - vuoi diventare',
    });
});

test('i campi non UTM non finiscono negli UTM', () => {
    const utm = readUtmFields(FIELD_VALUES_REALI);
    assert.equal(Object.values(utm).includes('Lancio Web Developer AI'), false);
    assert.equal(Object.values(utm).some((v) => String(v).startsWith('fb.1.')), false);
});

test('fieldValues assenti, null o vuoti: cinque null, e nessun crash', () => {
    const vuoto = { utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null };
    assert.deepEqual(readUtmFields([]), vuoto);
    assert.deepEqual(readUtmFields(undefined), vuoto);
    assert.deepEqual(readUtmFields(null), vuoto);
    // Non e' un array (AC ha risposto storto): non deve esplodere.
    assert.deepEqual(readUtmFields({ field: '31', value: 'x' } as never), vuoto);
});

test('valore vuoto o di soli spazi vale null, non stringa vuota', () => {
    assert.deepEqual(readUtmFields([
        { contact: '1', field: '31', value: '' },
        { contact: '1', field: '32', value: '   ' },
        { contact: '1', field: '33', value: null },
        { contact: '1', field: '34', value: '  Broad  ' },
    ]), {
        utmSource: null, utmMedium: null, utmCampaign: null, utmContent: 'Broad', utmTerm: null,
    });
});

test('il campo id numerico (non stringa) viene riconosciuto lo stesso', () => {
    assert.equal(readFieldLocal([{ contact: 1, field: 31, value: 'Facebook' }], '31'), 'Facebook');
});

test('hasAnyUtm: basta un campo solo', () => {
    assert.equal(hasAnyUtm({ utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null }), false);
    assert.equal(hasAnyUtm({ utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: 'Video 1' }), true);
});

test('il sideload di include=fieldValues si indicizza per contatto', () => {
    const byContact = indexFieldValuesByContact([
        ...FIELD_VALUES_REALI,
        { contact: '230783', field: '31', value: 'Instagram' },
        { contact: 230790, field: '31', value: 'Google' }, // id numerico
    ]);
    assert.equal(byContact.size, 3);
    assert.equal(readUtmFields(byContact.get('230768')).utmSource, 'Facebook');
    assert.equal(readUtmFields(byContact.get('230783')).utmSource, 'Instagram');
    assert.equal(readUtmFields(byContact.get('230790')).utmSource, 'Google');
    // Un contatto che nel sideload non c'e' non e' un errore: cinque null.
    assert.equal(readUtmFields(byContact.get('999999')).utmSource, null);
});

test('sideload assente o sporco: mappa vuota, si importa senza UTM come prima', () => {
    assert.equal(indexFieldValuesByContact(undefined).size, 0);
    assert.equal(indexFieldValuesByContact(null).size, 0);
    assert.equal(indexFieldValuesByContact('boh').size, 0);
    // Righe senza `contact` (es. /contacts/{id}/fieldValues) non sono indicizzabili.
    assert.equal(indexFieldValuesByContact([{ field: '31', value: 'Facebook' }]).size, 0);
    assert.equal(indexFieldValuesByContact([null, undefined, 3]).size, 0);
});

test('la riga lead del sync porta gli UTM fino alle colonne (era il bug)', () => {
    const byContact = indexFieldValuesByContact(FIELD_VALUES_REALI);
    const row = buildLancioLeadRow({
        id: 'L1', name: 'Mario Rossi', phone: '3331234567', email: null,
        acContactId: '230768', phoneSuspicious: false, botId: 'BOT', now: new Date('2026-09-19T10:00:00Z'),
        utm: readUtmFields(byContact.get('230768')),
    });
    assert.equal(row.utmSource, 'Facebook');
    assert.equal(row.utmMedium, 'Paid');
    assert.equal(row.utmCampaign, 'Cbo - Lancio Web Dev AI - test video e creative');
    assert.equal(row.utmContent, '17/09 - Broad - test video');
    assert.equal(row.utmTerm, 'Video 1 Marta - vuoi diventare');
});

test('contatto senza UTM su AC: la riga resta a null, non a stringa vuota', () => {
    const row = buildLancioLeadRow({
        id: 'L2', name: 'X', phone: '3331234567', email: null,
        acContactId: '1', phoneSuspicious: false, botId: 'BOT', now: new Date(),
        utm: readUtmFields(indexFieldValuesByContact([]).get('1')),
    });
    assert.equal(row.utmSource, null);
    assert.equal(row.utmTerm, null);
});
