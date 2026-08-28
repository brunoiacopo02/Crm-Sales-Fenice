import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactCategoryLabel, normalizeContactCategory } from './contactRequests';

test('le categorie canoniche passano invariate', () => {
    assert.equal(normalizeContactCategory('prezzo'), 'prezzo');
    assert.equal(normalizeContactCategory('disdetta'), 'disdetta');
});

test('i sinonimi del fornitore vengono ricondotti alle nostre categorie', () => {
    assert.equal(normalizeContactCategory('richiamo_generico'), 'richiamo');
    assert.equal(normalizeContactCategory('dubbio_prezzo'), 'prezzo');
    assert.equal(normalizeContactCategory('non_si_fida'), 'sfiducia_bot');
    assert.equal(normalizeContactCategory('link_non_funziona'), 'problema_tecnico');
});

test('spazi, trattini e maiuscole non rompono il riconoscimento', () => {
    assert.equal(normalizeContactCategory('  Dubbio Prezzo '), 'prezzo');
    assert.equal(normalizeContactCategory('richiamo-generico'), 'richiamo');
});

test('un motivo sconosciuto diventa altro invece di far fallire la richiesta', () => {
    // La regola che conta: una categoria sbagliata è un fastidio, una richiesta
    // persa è un lead perso. Le parole esatte del lead restano comunque in reason.
    assert.equal(normalizeContactCategory('categoria_che_non_esiste'), 'altro');
    assert.equal(normalizeContactCategory(undefined), 'altro');
    assert.equal(normalizeContactCategory(null), 'altro');
    assert.equal(normalizeContactCategory(42), 'altro');
    assert.equal(normalizeContactCategory(''), 'altro');
});

test('ogni categoria ha un\'etichetta leggibile e le ignote ricadono su Altro', () => {
    assert.equal(contactCategoryLabel('sfiducia_bot'), 'Non si fida della chat');
    assert.equal(contactCategoryLabel('boh'), 'Altro');
});
