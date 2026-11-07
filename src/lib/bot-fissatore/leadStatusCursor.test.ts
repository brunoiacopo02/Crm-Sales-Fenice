import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareKey, encodeCursor, parseCursor, type LeadStatusCursor } from './leadStatusCursor';

// Simula la query del feed: (updatedAt, id) > cursore, ordine (updatedAt, id), limit + 1.
function pagina(rows: LeadStatusCursor[], cursor: LeadStatusCursor | null, limit: number) {
    const ordinate = [...rows].sort(compareKey);
    const dopo = cursor ? ordinate.filter(r => compareKey(r, cursor) > 0) : ordinate;
    const page = dopo.slice(0, limit);
    const last = page[page.length - 1];
    return {
        page,
        hasMore: dopo.length > limit,
        nextCursor: last ? encodeCursor(last) : cursor ? encodeCursor(cursor) : null,
    };
}

function consuma(rows: LeadStatusCursor[], limit: number) {
    let cursor: LeadStatusCursor | null = null;
    const visti: string[] = [];
    let pagine = 0;
    for (;;) {
        const p = pagina(rows, cursor, limit);
        if (p.page.length === 0) break;
        pagine++;
        visti.push(...p.page.map(r => r.id));
        cursor = parseCursor(p.nextCursor);
        if (!p.hasMore) break;
        assert.ok(pagine < 50, 'il cursore non avanza');
    }
    return { pagine, visti };
}

const ISTANTE = '2026-10-19T13:09:33.289260Z';

test('1.000 righe con lo stesso updatedAt: 5 pagine da 200, nessuna persa né doppia', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ updatedAt: ISTANTE, id: `lead-${String(i).padStart(4, '0')}` }));
    const { pagine, visti } = consuma(rows, 200);
    assert.equal(pagine, 5);
    assert.equal(visti.length, 1000);
    assert.equal(new Set(visti).size, 1000);
});

test('il blocco in mezzo ad altre righe: ordine conservato, niente buchi ai bordi', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ updatedAt: ISTANTE, id: `lead-${i}` }));
    rows.push({ updatedAt: '2026-10-19T13:09:33.289259Z', id: 'zzz-prima' });
    rows.push({ updatedAt: '2026-10-19T13:09:33.289261Z', id: 'aaa-dopo' });
    const { pagine, visti } = consuma(rows, 200);
    assert.equal(pagine, 6);
    assert.equal(new Set(visti).size, 1002);
    assert.equal(visti[0], 'zzz-prima');
    assert.equal(visti[1001], 'aaa-dopo');
});

test('parseCursor: formato nuovo sì, since vecchio e malformati no', () => {
    assert.deepEqual(parseCursor(`${ISTANTE}|abc|def`), { updatedAt: ISTANTE, id: 'abc|def' });
    assert.equal(parseCursor('2026-10-19T13:09:33.289Z'), null); // since vecchio: va mandato come `since`
    assert.equal(parseCursor('2026-10-19T13:09:33.289Z|'), null);
    assert.equal(parseCursor('|abc'), null);
    assert.equal(parseCursor('ieri|abc'), null);
    assert.equal(parseCursor(42), null);
    assert.equal(encodeCursor({ updatedAt: ISTANTE, id: 'x' }), `${ISTANTE}|x`);
});
