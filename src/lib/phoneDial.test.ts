import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDialablePhone, telHref } from './phoneDial';

test('mobile nazionale resta uguale', () => {
    assert.equal(toDialablePhone('3281234567'), '3281234567');
});

test('+39 davanti a un mobile viene tolto', () => {
    assert.equal(toDialablePhone('+393281234567'), '3281234567');
});

test('0039 e +0039 davanti a un mobile vengono tolti', () => {
    assert.equal(toDialablePhone('00393281234567'), '3281234567');
    assert.equal(toDialablePhone('+00393281234567'), '3281234567');
});

test('+039 (zero spurio) davanti a un mobile viene tolto', () => {
    assert.equal(toDialablePhone('+0393209530413'), '3209530413');
});

test('39 senza + davanti a un mobile di 10 cifre viene tolto', () => {
    assert.equal(toDialablePhone('393276799702'), '3276799702');
});

test('spazi, trattini, punti e parentesi vengono tolti', () => {
    assert.equal(toDialablePhone('+39 328 123 4567'), '3281234567');
    assert.equal(toDialablePhone('+39-328-123-4567'), '3281234567');
    assert.equal(toDialablePhone('(+39) 328.123.4567'), '3281234567');
    assert.equal(toDialablePhone(' 328 1234567 '), '3281234567');
});

test('+39 davanti a un fisso viene tolto', () => {
    assert.equal(toDialablePhone('+390636119716'), '0636119716');
    assert.equal(toDialablePhone('+39 02 6100394'), '026100394');
});

test('fisso nazionale (anche 039 di Monza) resta uguale', () => {
    assert.equal(toDialablePhone('0636119716'), '0636119716');
    assert.equal(toDialablePhone('0392345678'), '0392345678');
});

test('39 senza + davanti a un fisso NON viene toccato (ambiguo)', () => {
    assert.equal(toDialablePhone('39061234567'), '39061234567');
});

test('+ davanti a un mobile italiano senza 39 viene tolto', () => {
    assert.equal(toDialablePhone('+3208242902'), '3208242902');
});

test('numeri esteri restano come sono', () => {
    assert.equal(toDialablePhone('+33695449516'), '+33695449516');
    assert.equal(toDialablePhone('+351912238718'), '+351912238718');
    assert.equal(toDialablePhone('+13053816136'), '+13053816136');
    assert.equal(toDialablePhone('+44 20 7946 0958'), '+44 20 7946 0958');
    assert.equal(toDialablePhone('+064279080088'), '+064279080088');
});

test('numeri corti o strani restano come sono', () => {
    assert.equal(toDialablePhone('349185389'), '349185389');
    assert.equal(toDialablePhone('+3912345'), '+3912345');
    assert.equal(toDialablePhone('328 123 4567 int. 2'), '328 123 4567 int. 2');
});

test('vuoti e null', () => {
    assert.equal(toDialablePhone(null), '');
    assert.equal(toDialablePhone(undefined), '');
    assert.equal(toDialablePhone('   '), '');
});

test('telHref usa il numero da chiamare senza spazi', () => {
    assert.equal(telHref('+39 328 123 4567'), 'tel:3281234567');
    assert.equal(telHref('+44 20 7946 0958'), 'tel:+442079460958');
});
