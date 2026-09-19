import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PINNED_FUNNELS,
    byVolumeThenName,
    funnelKey,
    isServiceFunnel,
    orderFunnels,
} from './marketingFunnels';

const noWeight = byVolumeThenName(() => 0, () => 0);

test('funnelKey fonde le grafie della stessa cosa', () => {
    assert.equal(funnelKey('Database'), 'DATABASE');
    assert.equal(funnelKey('DATABASE'), 'DATABASE');
    assert.equal(funnelKey('  Lancio Web Dev AI '), 'LANCIO WEB DEV AI');
    assert.equal(funnelKey(null), '');
});

test('esclusi solo i funnel di test/servizio', () => {
    assert.equal(isServiceFunnel('test'), true);
    assert.equal(isServiceFunnel('BLT'), true);
    assert.equal(isServiceFunnel(''), true);
    assert.equal(isServiceFunnel(null), true);
    assert.equal(isServiceFunnel('Lancio Web Dev AI'), false);
    assert.equal(isServiceFunnel('CORSO10ORE-TK'), false);
});

test('i funnel storici restano in testa e nel loro ordine, anche a zero', () => {
    const out = orderFunnels([], noWeight);
    assert.deepEqual(out, [...PINNED_FUNNELS]);
});

test('un funnel nuovo compare in coda e non duplica i pinned', () => {
    const out = orderFunnels(['Lancio Web Dev AI', 'DATABASE', 'Database'], noWeight);
    assert.deepEqual(out, [...PINNED_FUNNELS, 'LANCIO WEB DEV AI']);
    assert.equal(out.filter((f) => f === 'DATABASE').length, 1);
});

test('la coda è ordinata per volume, poi per la seconda chiave, poi alfabetico', () => {
    const lead: Record<string, number> = { 'LANCIO WEB DEV AI': 50, SMM: 83, 'CORSO10ORE-TK': 0, JOBSIMULATOR: 0 };
    const app: Record<string, number> = { 'LANCIO WEB DEV AI': 0, SMM: 0, 'CORSO10ORE-TK': 11, JOBSIMULATOR: 0 };
    const out = orderFunnels(
        ['CORSO10ORE-TK', 'JOBSIMULATOR', 'SMM', 'Lancio Web Dev AI'],
        byVolumeThenName((f) => lead[f] ?? 0, (f) => app[f] ?? 0),
    );
    assert.deepEqual(out.slice(PINNED_FUNNELS.length), [
        'SMM',                 // 83 lead
        'LANCIO WEB DEV AI',   // 50 lead
        'CORSO10ORE-TK',       // 0 lead ma 11 appuntamenti
        'JOBSIMULATOR',        // 0 e 0
    ]);
});

test('i funnel di servizio non entrano mai nell ordine', () => {
    const out = orderFunnels(['test', 'BLT', '', 'SMM'], noWeight);
    assert.deepEqual(out, [...PINNED_FUNNELS, 'SMM']);
});
