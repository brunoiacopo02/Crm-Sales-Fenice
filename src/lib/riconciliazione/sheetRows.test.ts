import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseAmount,
    parseSheetDate,
    tutorToSalesCode,
    parseSheetRows,
    SheetUnavailableError,
} from './sheetRows';

const HEADER = ['cf', 'MAIL', 'NUM', 'NOME', 'COGNOME', 'FIRMA CONTRATTO', 'Stato di Pagamento', 'Valori contratti', 'Entrate', 'ANCORA DA SALDARE', 'TUTOR'];

function row(over: Partial<Record<'mail' | 'num' | 'nome' | 'cognome' | 'data' | 'stato' | 'importo' | 'tutor', string>> = {}): string[] {
    return [
        '',
        over.mail ?? 'mario.rossi@example.com',
        over.num ?? '3663515565',
        over.nome ?? 'Mario',
        over.cognome ?? 'Rossi',
        over.data ?? '01/08/2026',
        over.stato ?? 'Pagamento programmato',
        over.importo ?? '€ 1.390',
        '', '',
        over.tutor ?? 'Paolo S.',
    ];
}

test('parseAmount legge il formato italiano del foglio', () => {
    assert.equal(parseAmount('€ 1.390'), 1390);
    assert.equal(parseAmount('€ 2.079,50'), 2079.5);
    assert.equal(parseAmount('€ 300'), 300);
    assert.equal(parseAmount(''), 0);
    assert.equal(parseAmount(null), 0);
});

test('parseSheetDate legge dd/mm/yyyy e rifiuta il resto', () => {
    const d = parseSheetDate('01/08/2026');
    assert.ok(d);
    assert.equal(d!.getUTCFullYear(), 2026);
    assert.equal(d!.getUTCMonth(), 7);
    assert.equal(d!.getUTCDate(), 1);
    assert.equal(parseSheetDate('2026-08-01'), null);
    assert.equal(parseSheetDate(''), null);
});

test('tutorToSalesCode mappa i sei venditori noti e solo quelli', () => {
    assert.equal(tutorToSalesCode('Paolo S.'), 'Sales 004');
    assert.equal(tutorToSalesCode('Giacomo O.'), 'Sales 008');
    assert.equal(tutorToSalesCode('Bruno B.'), 'Sales 001');
    assert.equal(tutorToSalesCode('Matteo D.'), null);
    assert.equal(tutorToSalesCode('Amministrazione'), null);
    assert.equal(tutorToSalesCode(''), null);
});

test('tiene solo il mese richiesto', () => {
    const out = parseSheetRows([HEADER, row({ data: '01/08/2026' }), row({ data: '15/07/2026', num: '3331112222' })], '2026-08');
    assert.equal(out.length, 1);
    assert.equal(out[0].monthKey, '2026-08');
});

test('esclude Stand-by e tiene tutti gli altri stati', () => {
    const rows = [
        HEADER,
        row({ stato: 'Stand-by', num: '3331110001' }),
        row({ stato: 'Recupero', num: '3331110002' }),
        row({ stato: 'Avvocato', num: '3331110003' }),
        row({ stato: 'Sollecito', num: '3331110004' }),
        row({ stato: 'Pagato', num: '3331110005' }),
    ];
    const out = parseSheetRows(rows, '2026-08');
    assert.equal(out.length, 4);
    assert.ok(!out.some(c => c.paymentStatuses.includes('Stand-by')));
});

test('somma due righe dello stesso cliente nello stesso mese (caso Dell Aglio)', () => {
    const rows = [
        HEADER,
        row({ importo: '€ 800', num: '3401234567' }),
        row({ importo: '€ 729', num: '3401234567', data: '20/08/2026' }),
    ];
    const out = parseSheetRows(rows, '2026-08');
    assert.equal(out.length, 1);
    assert.equal(out[0].amountEur, 1529);
    assert.deepEqual(out[0].sourceRows, [2, 3]);
});

test('due contratti dello stesso cliente in mesi diversi NON si sommano (rifirme)', () => {
    const rows = [HEADER, row({ importo: '€ 800' }), row({ importo: '€ 729', data: '10/07/2026' })];
    assert.equal(parseSheetRows(rows, '2026-08')[0].amountEur, 800);
    assert.equal(parseSheetRows(rows, '2026-07')[0].amountEur, 729);
});

test('normalizza telefono e mail', () => {
    const out = parseSheetRows([HEADER, row({ num: '+39 366 3515565', mail: '  Mario.Rossi@Example.com ' })], '2026-08');
    assert.equal(out[0].phone, '+393663515565');
    assert.equal(out[0].email, 'mario.rossi@example.com');
});

test('un tutor non mappato non fa fallire la lettura, lascia salesCode null', () => {
    const out = parseSheetRows([HEADER, row({ tutor: 'Matteo D.' })], '2026-08');
    assert.equal(out[0].salesCode, null);
    assert.equal(out[0].tutor, 'Matteo D.');
});

test('un foglio con #REF! alza SheetUnavailableError', () => {
    assert.throws(() => parseSheetRows([['#REF!']], '2026-08'), SheetUnavailableError);
});

test('un foglio vuoto o senza righe dati alza SheetUnavailableError', () => {
    assert.throws(() => parseSheetRows([], '2026-08'), SheetUnavailableError);
    assert.throws(() => parseSheetRows([HEADER], '2026-08'), SheetUnavailableError);
});

test('un mese senza contratti restituisce lista vuota, non un errore', () => {
    const out = parseSheetRows([HEADER, row({ data: '01/08/2026' })], '2026-01');
    assert.deepEqual(out, []);
});

test('data 01/08/2026 nel foglio continua a keyare a 2026-08 (Rome timezone invariante)', () => {
    // Sheet dates sono a mezzogiorno UTC = 14:00 Roma lo stesso giorno.
    // monthKeyOf con Rome timezone non deve cambiarli.
    const out = parseSheetRows([HEADER, row({ data: '01/08/2026' })], '2026-08');
    assert.equal(out.length, 1);
    assert.equal(out[0].monthKey, '2026-08');
    assert.equal(out[0].key, '+393663515565|2026-08');
});
