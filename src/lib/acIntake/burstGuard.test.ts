import test from 'node:test';
import assert from 'node:assert/strict';
import {
    decidiBurst, leggiBurstConfig, BURST_LIMIT_DEFAULT, BURST_WINDOW_MIN_DEFAULT,
} from './burstGuard';

/** Imposta le env dell'interruttore e le ripristina comunque vada. */
function withEnv(env: Record<string, string | undefined>, fn: () => void) {
    const chiavi = ['AC_INTAKE_BURST', 'AC_INTAKE_BURST_LIMIT', 'AC_INTAKE_BURST_WINDOW_MIN'];
    const prima = Object.fromEntries(chiavi.map((k) => [k, process.env[k]]));
    const set = (k: string, v: string | undefined) => {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    };
    for (const k of chiavi) set(k, env[k]);
    try { fn(); } finally { for (const k of chiavi) set(k, prima[k]); }
}

const cfg = (over: Partial<ReturnType<typeof leggiBurstConfig>> = {}) => ({
    attivo: true, limite: 100, finestraMinuti: 10, ...over,
});

test('sotto la soglia il lead passa', () => {
    assert.equal(decidiBurst({ conteggioInFinestra: 99, config: cfg() }).blocca, false);
});

test('raggiunta la soglia il lead viene fermato', () => {
    const d = decidiBurst({ conteggioInFinestra: 100, config: cfg() });
    assert.equal(d.blocca, true);
    assert.match(d.motivo ?? '', /^burst_guard:100_in_10min$/);
});

test('il traffico normale non fa mai scattare l interruttore', () => {
    // ~300 lead al giorno = 2 ogni 10 minuti. Anche dieci volte tanto passa.
    assert.equal(decidiBurst({ conteggioInFinestra: 20, config: cfg() }).blocca, false);
});

test('il flood del 15/09 sarebbe stato fermato', () => {
    // ~140 lead al minuto = ~1400 in 10 minuti.
    assert.equal(decidiBurst({ conteggioInFinestra: 1400, config: cfg() }).blocca, true);
});

test('un flusso esente non viene mai fermato, nemmeno in piena raffica', () => {
    assert.equal(decidiBurst({ conteggioInFinestra: 5000, config: cfg(), esente: true }).blocca, false);
});

test('a interruttore spento passa tutto', () => {
    assert.equal(decidiBurst({ conteggioInFinestra: 5000, config: cfg({ attivo: false }) }).blocca, false);
});

test('senza env valgono i valori di default', () => {
    withEnv({}, () => {
        const c = leggiBurstConfig();
        assert.equal(c.attivo, true);
        assert.equal(c.limite, BURST_LIMIT_DEFAULT);
        assert.equal(c.finestraMinuti, BURST_WINDOW_MIN_DEFAULT);
    });
});

test('AC_INTAKE_BURST=off spegne l interruttore', () => {
    withEnv({ AC_INTAKE_BURST: 'off' }, () => {
        assert.equal(leggiBurstConfig().attivo, false);
    });
});

test('una soglia scritta male non alza ne azzera il limite: vale il default', () => {
    for (const v of ['tanti', '0', '-5', '3.5', '']) {
        withEnv({ AC_INTAKE_BURST_LIMIT: v }, () => {
            assert.equal(leggiBurstConfig().limite, BURST_LIMIT_DEFAULT, `valore "${v}"`);
        });
    }
});

test('soglia e finestra si possono configurare', () => {
    withEnv({ AC_INTAKE_BURST_LIMIT: '250', AC_INTAKE_BURST_WINDOW_MIN: '5' }, () => {
        const c = leggiBurstConfig();
        assert.equal(c.limite, 250);
        assert.equal(c.finestraMinuti, 5);
    });
});
