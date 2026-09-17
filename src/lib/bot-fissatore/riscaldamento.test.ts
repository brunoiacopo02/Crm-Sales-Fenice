import test from 'node:test';
import assert from 'node:assert/strict';
import {
    eImmacolato, pianificaRiscaldamento, leggiConfigRiscaldamento,
    SCAGLIONE_DEFAULT, type LeadCandidato, type ConfigRiscaldamento,
} from './riscaldamento';

const CHIAVI = ['BOT_WARMUP', 'BOT_WARMUP_BATCH', 'BOT_WARMUP_SOURCE'] as const;

function withEnv(env: Partial<Record<(typeof CHIAVI)[number], string>>, fn: () => void) {
    const prima = Object.fromEntries(CHIAVI.map((k) => [k, process.env[k]]));
    const set = (k: string, v: string | undefined) => {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    };
    for (const k of CHIAVI) set(k, env[k]);
    try { fn(); } finally { for (const k of CHIAVI) set(k, prima[k]); }
}

const lead = (over: Partial<LeadCandidato> = {}): LeadCandidato => ({
    id: 'L1', toccatoDalBot: false, infornata: null,
    status: 'NEW', callCount: 0, appointmentDate: null, presentedAt: null,
    ...over,
});

const cfg = (over: Partial<ConfigRiscaldamento> = {}): ConfigRiscaldamento => ({
    attivo: true, scaglione: 50, sorgente: 'GDO 114', ...over,
});

// ---------------------------------------------------------------- immacolato

test('un lead nuovo mai toccato e spostabile', () => {
    assert.equal(eImmacolato(lead()), true);
});

test('un lead gia passato dal bot NON si sposta: sarebbe la seconda apertura', () => {
    assert.equal(eImmacolato(lead({ toccatoDalBot: true })), false);
});

test('un lead di un infornata anomala NON si sposta', () => {
    assert.equal(eImmacolato(lead({ infornata: 'DB_LISTA133_20260915' })), false);
});

test('un lead gia chiamato da un GDO NON si sposta', () => {
    assert.equal(eImmacolato(lead({ callCount: 1 })), false);
});

test('un lead in lavorazione NON si sposta', () => {
    assert.equal(eImmacolato(lead({ status: 'IN_PROGRESS' })), false);
});

test('un lead con appuntamento NON si sposta, nemmeno se lo stato sembra aperto', () => {
    assert.equal(eImmacolato(lead({ appointmentDate: new Date('2026-09-20T10:00:00Z') })), false);
    assert.equal(eImmacolato(lead({ status: 'APPOINTMENT' })), false);
});

test('un lead con una presenza registrata NON si sposta', () => {
    assert.equal(eImmacolato(lead({ presentedAt: new Date('2026-09-10T10:00:00Z') })), false);
});

// ---------------------------------------------------------------- piano

test('prende i primi N candidati e dice quanti ne restano', () => {
    const candidati = Array.from({ length: 142 }, (_, i) => lead({ id: `L${i}` }));
    const p = pianificaRiscaldamento({ candidati, config: cfg({ scaglione: 50 }) });
    assert.equal(p.daSpostare.length, 50);
    assert.equal(p.residui, 92);
    assert.equal(p.motivo, 'ok');
    assert.equal(p.daSpostare[0], 'L0');
});

test('meno candidati dello scaglione: li prende tutti, zero residui', () => {
    const candidati = Array.from({ length: 12 }, (_, i) => lead({ id: `L${i}` }));
    const p = pianificaRiscaldamento({ candidati, config: cfg({ scaglione: 50 }) });
    assert.equal(p.daSpostare.length, 12);
    assert.equal(p.residui, 0);
});

test('i non immacolati non entrano nel conteggio dei residui', () => {
    const candidati = [
        lead({ id: 'buono' }),
        lead({ id: 'gia_del_bot', toccatoDalBot: true }),
        lead({ id: 'flood', infornata: 'DB_LISTA133_20260915' }),
    ];
    const p = pianificaRiscaldamento({ candidati, config: cfg({ scaglione: 10 }) });
    assert.deepEqual(p.daSpostare, ['buono']);
    assert.equal(p.residui, 0);
});

test('a giro spento non sposta niente', () => {
    const p = pianificaRiscaldamento({ candidati: [lead()], config: cfg({ attivo: false }) });
    assert.deepEqual(p.daSpostare, []);
    assert.equal(p.motivo, 'spento');
});

test('nessun candidato buono: lo dice invece di fingere un giro riuscito', () => {
    const p = pianificaRiscaldamento({ candidati: [lead({ toccatoDalBot: true })], config: cfg() });
    assert.equal(p.motivo, 'nessun_candidato');
});

test('lista vuota non esplode', () => {
    const p = pianificaRiscaldamento({ candidati: [], config: cfg() });
    assert.equal(p.motivo, 'nessun_candidato');
});

// ---------------------------------------------------------------- config

test('senza BOT_WARMUP il giro e SPENTO: toglie lead a una persona, non parte per dimenticanza', () => {
    withEnv({}, () => {
        assert.equal(leggiConfigRiscaldamento().attivo, false);
    });
});

test('BOT_WARMUP=on accende, off spegne', () => {
    withEnv({ BOT_WARMUP: 'on' }, () => assert.equal(leggiConfigRiscaldamento().attivo, true));
    withEnv({ BOT_WARMUP: '1' }, () => assert.equal(leggiConfigRiscaldamento().attivo, true));
    withEnv({ BOT_WARMUP: 'off' }, () => assert.equal(leggiConfigRiscaldamento().attivo, false));
});

test('lo scaglione si configura, ma un valore assurdo ricade sul default', () => {
    withEnv({ BOT_WARMUP: 'on', BOT_WARMUP_BATCH: '25' }, () => {
        assert.equal(leggiConfigRiscaldamento().scaglione, 25);
    });
    for (const v of ['tanti', '0', '-5', '3.5', '9999']) {
        withEnv({ BOT_WARMUP: 'on', BOT_WARMUP_BATCH: v }, () => {
            assert.equal(leggiConfigRiscaldamento().scaglione, SCAGLIONE_DEFAULT, `valore "${v}"`);
        });
    }
});

test('la sorgente si configura e ha un default', () => {
    withEnv({ BOT_WARMUP: 'on' }, () => assert.equal(leggiConfigRiscaldamento().sorgente, 'GDO 114'));
    withEnv({ BOT_WARMUP: 'on', BOT_WARMUP_SOURCE: 'GDO 118' }, () => {
        assert.equal(leggiConfigRiscaldamento().sorgente, 'GDO 118');
    });
});
