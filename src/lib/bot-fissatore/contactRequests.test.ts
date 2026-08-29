import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactCategoryLabel, contactLane, isLeadLocked, normalizeContactCategory } from './contactRequests';

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

test('isLeadLocked: un lead appuntato non si sposta', () => {
    assert.equal(isLeadLocked('APPOINTMENT', null), true);
});

test('isLeadLocked: una presenza latchata blocca anche se lo status e cambiato', () => {
    assert.equal(isLeadLocked('NEW', new Date('2026-07-01T10:00:00Z')), true);
});

test('isLeadLocked: un lead libero si sposta', () => {
    assert.equal(isLeadLocked('NEW', null), false);
    assert.equal(isLeadLocked('IN_PROGRESS', null), false);
    assert.equal(isLeadLocked('REJECTED', null), false);
});

test('contactLane: un lead appuntato e delle Conferme', () => {
    assert.equal(contactLane('APPOINTMENT'), 'conferme');
});

test('contactLane: tutto il resto resta agli admin/GDO', () => {
    assert.equal(contactLane('NEW'), 'gdo');
    assert.equal(contactLane('IN_PROGRESS'), 'gdo');
    assert.equal(contactLane('REJECTED'), 'gdo');
});

test('normalizeContactCategory: il motivo del 3o NR non finisce in "altro"', () => {
    assert.equal(normalizeContactCategory('risposta_dopo_terzo_nr'), 'risposta_dopo_terzo_nr');
    assert.equal(normalizeContactCategory('risposta_dopo_3nr'), 'risposta_dopo_terzo_nr');
    assert.equal(normalizeContactCategory('Risposta Dopo Terzo Tentativo'), 'risposta_dopo_terzo_nr');
});

test('normalizeContactCategory: un motivo ignoto resta "altro" e non fa fallire la richiesta', () => {
    assert.equal(normalizeContactCategory('qualcosa_che_non_conosciamo'), 'altro');
});
