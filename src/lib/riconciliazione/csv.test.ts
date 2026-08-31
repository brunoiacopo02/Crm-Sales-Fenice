import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv';

test('legge un CSV semplice', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('rispetta le virgole dentro i campi quotati', () => {
    assert.deepEqual(parseCsv('a,b\n"Rossi, Mario",2'), [['a', 'b'], ['Rossi, Mario', '2']]);
});

test('gestisce le virgolette raddoppiate', () => {
    assert.deepEqual(parseCsv('a\n"dice ""ciao"""'), [['a'], ['dice "ciao"']]);
});

test('gestisce CRLF e ignora la riga finale vuota', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('tiene i campi vuoti al posto giusto', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
});
