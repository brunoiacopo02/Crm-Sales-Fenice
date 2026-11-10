import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PINNED_FUNNELS,
    byVolumeThenName,
    funnelKey,
    isServiceFunnel,
    etichettaFunnel,
    orderFunnels,
} from './marketingFunnels';

const noWeight = byVolumeThenName(() => 0, () => 0);

test('funnelKey fonde le grafie della stessa cosa', () => {
    assert.equal(funnelKey('Database'), 'DATABASE');
    assert.equal(funnelKey('DATABASE'), 'DATABASE');
    assert.equal(funnelKey('  Lancio Web Dev AI '), 'LANCIO WEB DEV AI');
    assert.equal(funnelKey(null), '');
});

test('il Corso 10 ore TikTok ha una riga sua, mai dentro il Corso 10 ore', () => {
    for (const g of ['CORSO10ORE-TK', 'corso-10-ore-tk', 'Corso 10 ore TK', 'corso10oretk', 'CORSO_10_ORE_TK']) {
        assert.equal(funnelKey(g), 'CORSO10ORE-TK', g);
    }
    assert.equal(funnelKey('CORSO 10 ORE'), 'CORSO 10 ORE');
    assert.equal(funnelKey('corso10ore'), 'CORSO10ORE');
    assert.ok(PINNED_FUNNELS.includes('CORSO10ORE-TK' as never));
    const i = PINNED_FUNNELS.indexOf('CORSO 10 ORE');
    assert.equal(PINNED_FUNNELS[i + 1], 'CORSO10ORE-TK');
    assert.equal(etichettaFunnel('CORSO10ORE-TK'), 'CORSO 10 ORE TIKTOK');
    assert.equal(etichettaFunnel('TELEGRAM'), 'TELEGRAM');
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
    const lead: Record<string, number> = { 'LANCIO WEB DEV AI': 50, SMM: 83, INBOUND: 0, JOBSIMULATOR: 0 };
    const app: Record<string, number> = { 'LANCIO WEB DEV AI': 0, SMM: 0, INBOUND: 11, JOBSIMULATOR: 0 };
    const out = orderFunnels(
        ['INBOUND', 'JOBSIMULATOR', 'SMM', 'Lancio Web Dev AI'],
        byVolumeThenName((f) => lead[f] ?? 0, (f) => app[f] ?? 0),
    );
    assert.deepEqual(out.slice(PINNED_FUNNELS.length), [
        'SMM',                 // 83 lead
        'LANCIO WEB DEV AI',   // 50 lead
        'INBOUND',             // 0 lead ma 11 appuntamenti
        'JOBSIMULATOR',        // 0 e 0
    ]);
});

test('i funnel di servizio non entrano mai nell ordine', () => {
    const out = orderFunnels(['test', 'BLT', '', 'SMM'], noWeight);
    assert.deepEqual(out, [...PINNED_FUNNELS, 'SMM']);
});
