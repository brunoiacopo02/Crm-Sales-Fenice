import { test, describe } from 'node:test';
import assert from 'node:assert';
import { discardReasonCode, discardReasonLabel } from './discard-reasons';
import { GDO_DISCARD_REASONS, CONFERME_DISCARD_REASONS } from '@/lib/surveys/questions';

describe('discardReasonCode', () => {
    test('ogni causale della tendina GDO ha un codice suo', () => {
        for (const reason of GDO_DISCARD_REASONS) {
            assert.notStrictEqual(
                discardReasonCode(reason), 'OTHER',
                `"${reason}" non e' mappata: il marketing la vedrebbe come OTHER`,
            );
        }
    });

    test('ogni causale della tendina Conferme ha un codice suo', () => {
        for (const { value } of CONFERME_DISCARD_REASONS) {
            assert.notStrictEqual(
                discardReasonCode(value), 'OTHER',
                `"${value}" non e' mappata: il marketing la vedrebbe come OTHER`,
            );
        }
    });

    test('mappa le causali chiave sui codici concordati col receiver', () => {
        assert.strictEqual(discardReasonCode('non ha soldi'), 'NO_BUDGET');
        assert.strictEqual(discardReasonCode('non interessato'), 'NOT_INTERESTED');
        assert.strictEqual(discardReasonCode('numero inesistente'), 'INVALID_NUMBER');
        assert.strictEqual(discardReasonCode("non vuole prendere l'appuntamento"), 'REFUSED_APPOINTMENT');
        assert.strictEqual(discardReasonCode('attaccato in faccia'), 'HUNG_UP');
        assert.strictEqual(discardReasonCode('posticipa senza data'), 'POSTPONED_NO_DATE');
    });

    describe('auto-scarto per irreperibilita', () => {
        test('la grafia corretta da UNREACHABLE', () => {
            assert.strictEqual(discardReasonCode('irreperibile (3 tentativi vuoti)'), 'UNREACHABLE');
            assert.strictEqual(discardReasonCode('irreperibile (4 tentativi vuoti)'), 'UNREACHABLE');
        });

        test('il vecchio refuso "irriperebile" da comunque UNREACHABLE', () => {
            // Fino al 2026-08-24 il CRM scriveva questa stringa: i lead gia'
            // scartati non vanno persi.
            assert.strictEqual(discardReasonCode('irriperebile (3 tentativi vuoti)'), 'UNREACHABLE');
            assert.strictEqual(discardReasonCode('irriperebile (4 tentativi vuoti)'), 'UNREACHABLE');
        });

        test('anche l auto-scarto delle Conferme e irreperibilita', () => {
            assert.strictEqual(discardReasonCode('3 NR consecutivi'), 'UNREACHABLE');
        });
    });

    describe('robustezza', () => {
        test('una causale sconosciuta da OTHER invece di esplodere', () => {
            assert.strictEqual(discardReasonCode('il cane ha mangiato il contratto'), 'OTHER');
        });

        test('null e stringa vuota danno OTHER', () => {
            assert.strictEqual(discardReasonCode(null), 'OTHER');
            assert.strictEqual(discardReasonCode(undefined), 'OTHER');
            assert.strictEqual(discardReasonCode(''), 'OTHER');
        });

        test('maiuscole e spazi di troppo non cambiano il codice', () => {
            assert.strictEqual(discardReasonCode('  NON HA SOLDI  '), 'NO_BUDGET');
            assert.strictEqual(discardReasonCode('Non Ha Soldi'), 'NO_BUDGET');
        });
    });
});

describe('discardReasonLabel', () => {
    test('per le Conferme usa l etichetta gia definita nella tendina', () => {
        assert.strictEqual(discardReasonLabel('attaccato in faccia'), 'Attaccato in faccia');
        assert.strictEqual(discardReasonLabel('non ha soldi'), 'Non ha soldi');
    });

    test('per una causale fuori tendina restituisce il testo ripulito', () => {
        assert.strictEqual(discardReasonLabel('  irreperibile (3 tentativi vuoti)  '), 'irreperibile (3 tentativi vuoti)');
    });

    test('null da stringa vuota', () => {
        assert.strictEqual(discardReasonLabel(null), '');
    });
});
