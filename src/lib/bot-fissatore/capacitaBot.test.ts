import test from 'node:test';
import assert from 'node:assert/strict';
import { capacitaDaTetti, tettoBotEffettivo, _azzeraCacheCapacita } from './capacitaBot';

/** I tetti del bot al 07/11/2026: somma 190. */
const TETTI_07_11 = {
    'whatsapp:+393520158061': 15,
    'whatsapp:+393520413199': 15,
    'whatsapp:+393522018718': 50,
    'whatsapp:+393522070047': 50,
    'whatsapp:+393522622245': 30,
    'whatsapp:+393522782508': 30,
};

async function conEnv(vals: Record<string, string | undefined>, fn: () => Promise<void>) {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vals)) {
        prev[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    _azzeraCacheCapacita();
    try { await fn(); } finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        _azzeraCacheCapacita();
    }
}

test('capacitaDaTetti: somma dei tetti di oggi = 190', () => {
    assert.equal(capacitaDaTetti(TETTI_07_11, { pause: {} })?.totale, 190);
});

test('capacitaDaTetti: esclusi i numeri a tetto 0 e quelli in pausa qualita', () => {
    const tetti = { ...TETTI_07_11, 'whatsapp:+393522070047': 0 };
    const stato = { pause: { '+393522018718': { fino: '2026-11-10', tettoPrima: 50, dal: '2026-11-07' } } };
    const c = capacitaDaTetti(tetti, stato);
    assert.equal(c?.totale, 90);
    assert.equal(c?.perNumero['+393522018718'], undefined);
    assert.equal(c?.perNumero['+393522070047'], undefined);
});

test('capacitaDaTetti: dopo le promozioni (2245/2508 a 50, 3199 a 30) = 245', () => {
    const tetti = { ...TETTI_07_11, 'whatsapp:+393522622245': 50, 'whatsapp:+393522782508': 50, 'whatsapp:+393520413199': 30 };
    assert.equal(capacitaDaTetti(tetti, null)?.totale, 245);
});

test('capacitaDaTetti: dati non usabili = null (vale l\'env)', () => {
    assert.equal(capacitaDaTetti(null, null), null);
    assert.equal(capacitaDaTetti([], null), null);
    assert.equal(capacitaDaTetti({ x: 'abc' }, null), null);
    // tutti fermi a 0 e' un dato vero: capacita' 0
    assert.equal(capacitaDaTetti({ a: 0 }, null)?.totale, 0);
});

test('tettoBotEffettivo: env assente = regola spenta (null), il bot non si chiama', async () => {
    await conEnv({ BOT_TETTO_GIORNALIERO: undefined }, async () => {
        let chiamato = false;
        const r = await tettoBotEffettivo({ leggi: async () => { chiamato = true; return null; } });
        assert.equal(r, null);
        assert.equal(chiamato, false);
    });
});

test('tettoBotEffettivo: bot leggibile = vale il bot', async () => {
    await conEnv({ BOT_TETTO_GIORNALIERO: '150', BOT_TETTO_DAL_BOT: undefined }, async () => {
        const r = await tettoBotEffettivo({ leggi: async () => ({ oggi: '2026-11-07', stato: { pause: {} }, tetti: TETTI_07_11 }) });
        assert.equal(r?.valore, 190);
        assert.equal(r?.fonte, 'bot');
        assert.equal(r?.env, 150);
    });
});

test('tettoBotEffettivo: bot giu\' = FALLBACK all\'env', async () => {
    await conEnv({ BOT_TETTO_GIORNALIERO: '190', BOT_TETTO_DAL_BOT: undefined }, async () => {
        const r = await tettoBotEffettivo({ leggi: async () => null });
        assert.equal(r?.valore, 190);
        assert.equal(r?.fonte, 'env');
        const r2 = await tettoBotEffettivo({ nowMs: Date.now() + 2 * 60_000, leggi: async () => { throw new Error('boom'); } });
        assert.equal(r2?.fonte, 'env');
    });
});

test('tettoBotEffettivo: cache 10 minuti sul valore letto, poi rilegge', async () => {
    await conEnv({ BOT_TETTO_GIORNALIERO: '190', BOT_TETTO_DAL_BOT: undefined }, async () => {
        let letture = 0;
        const t0 = Date.parse('2026-11-07T10:00:00Z');
        const leggi = async () => { letture++; return { oggi: '2026-11-07', stato: null, tetti: letture === 1 ? TETTI_07_11 : { a: 245 } }; };
        assert.equal((await tettoBotEffettivo({ nowMs: t0, leggi }))?.valore, 190);
        assert.equal((await tettoBotEffettivo({ nowMs: t0 + 9 * 60_000, leggi }))?.valore, 190);
        assert.equal(letture, 1);
        assert.equal((await tettoBotEffettivo({ nowMs: t0 + 11 * 60_000, leggi }))?.valore, 245);
        assert.equal(letture, 2);
    });
});

test('tettoBotEffettivo: dopo un errore si riprova dopo 1 minuto', async () => {
    await conEnv({ BOT_TETTO_GIORNALIERO: '190', BOT_TETTO_DAL_BOT: undefined }, async () => {
        let letture = 0;
        const t0 = Date.parse('2026-11-07T10:00:00Z');
        const leggi = async () => { letture++; return letture === 1 ? null : { oggi: '2026-11-07', stato: null, tetti: { a: 200 } }; };
        assert.equal((await tettoBotEffettivo({ nowMs: t0, leggi }))?.fonte, 'env');
        assert.equal((await tettoBotEffettivo({ nowMs: t0 + 30_000, leggi }))?.fonte, 'env');
        assert.equal((await tettoBotEffettivo({ nowMs: t0 + 61_000, leggi }))?.valore, 200);
    });
});

test('tettoBotEffettivo: BOT_TETTO_DAL_BOT=off forza l\'env', async () => {
    await conEnv({ BOT_TETTO_GIORNALIERO: '120', BOT_TETTO_DAL_BOT: 'off' }, async () => {
        const r = await tettoBotEffettivo({ leggi: async () => ({ oggi: '2026-11-07', stato: null, tetti: TETTI_07_11 }) });
        assert.equal(r?.valore, 120);
        assert.equal(r?.fonte, 'env_forzata');
        assert.equal(r?.dalBot, 190);
    });
});
