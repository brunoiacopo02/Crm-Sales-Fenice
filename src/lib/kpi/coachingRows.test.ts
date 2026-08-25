import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeRow, isNrDiscard, matchesScope, isDatabaseFunnel,
    type CallFact, type ApptFact,
} from './coachingRows';

const D = (s: string) => new Date(s);

function call(over: Partial<CallFact> = {}): CallFact {
    return {
        leadId: 'lead-1', userId: 'gdo-1', createdAt: D('2026-07-21T10:00:00Z'),
        outcome: 'NON_RISPOSTO', rn: 1, funnel: 'Job Simulator', leadCallCount: 1, ...over,
    };
}
function appt(over: Partial<ApptFact> = {}): ApptFact {
    return {
        leadId: 'lead-1', assignedToId: 'gdo-1', apptSetAt: D('2026-07-21T10:00:00Z'),
        confirmationsOutcome: null, confirmationsDiscardReason: null,
        funnel: 'Job Simulator', ...over,
    };
}

describe('lavorati e media tentativi', () => {
    test('lavorati conta i lead distinti, non le chiamate', () => {
        const r = computeRow('w', [
            call({ leadId: 'a' }), call({ leadId: 'a', rn: 2 }), call({ leadId: 'b' }),
        ], []);
        assert.equal(r.lavorati, 2);
        assert.equal(r.chiamate, 3);
    });

    test('media tentativi = media dei tentativi TOTALI per lead, non del periodo', () => {
        // Il lead 'a' ha 5 tentativi in tutto, di cui 2 in questa finestra.
        // Deve pesare 5, non 2: altrimenti il valore dipenderebbe da quanto
        // e' larga la finestra e la baseline non sarebbe confrontabile con
        // una settimana.
        const r = computeRow('w', [
            call({ leadId: 'a', leadCallCount: 5 }),
            call({ leadId: 'a', leadCallCount: 5, rn: 2 }),
            call({ leadId: 'b', leadCallCount: 1 }),
        ], []);
        assert.equal(r.lavorati, 2);
        assert.equal(r.chiamate, 3);
        assert.equal(r.mediaTentativi, 3, '(5 + 1) / 2');
    });

    test('la media non cambia allargando la finestra sugli stessi lead', () => {
        // Stessi due lead, ma la finestra piu' larga include piu' loro chiamate.
        const stretta = computeRow('w', [
            call({ leadId: 'a', leadCallCount: 4 }), call({ leadId: 'b', leadCallCount: 2 }),
        ], []);
        const larga = computeRow('w', [
            call({ leadId: 'a', leadCallCount: 4 }), call({ leadId: 'a', leadCallCount: 4, rn: 2 }),
            call({ leadId: 'a', leadCallCount: 4, rn: 3 }), call({ leadId: 'b', leadCallCount: 2 }),
        ], []);
        assert.equal(stretta.mediaTentativi, larga.mediaTentativi);
    });

    test('senza chiamate non si inventa uno zero', () => {
        const r = computeRow('w', [], []);
        assert.equal(r.mediaTentativi, null);
        assert.equal(r.pctFissSuLavorati, null);
    });
});

describe('scarti alla prima chiamata', () => {
    test('conta solo i lead al loro primo contatto in assoluto', () => {
        // rn=2 e' un richiamo: anche se finisce in scarto non e' uno scarto
        // "a prima chiamata", e non deve entrare nel denominatore.
        const r = computeRow('w', [
            call({ leadId: 'a', rn: 1, outcome: 'DA_SCARTARE' }),
            call({ leadId: 'b', rn: 1, outcome: 'RICHIAMO' }),
            call({ leadId: 'c', rn: 2, outcome: 'DA_SCARTARE' }),
        ], []);
        assert.equal(r.primeChiamate, 2);
        assert.equal(r.scarti1a, 1);
        assert.equal(r.pctScarti1a, 50);
    });
});

describe('conferme: il pendente non e\' un fallimento', () => {
    test('i fissati non ancora esitati escono dal denominatore', () => {
        // Il caso reale del venerdi': 7 fissati in settimana, nessuno ancora
        // lavorato dalle Conferme. Prima leggeva 0%: falso.
        const r = computeRow('w', [], [
            appt({ leadId: '1' }), appt({ leadId: '2' }), appt({ leadId: '3' }),
        ]);
        assert.equal(r.fissati, 3);
        assert.equal(r.pendenti, 3);
        assert.equal(r.pctConf, null, 'senza esiti la percentuale non esiste, non e\' zero');
    });

    test('percentuale calcolata sugli esitati', () => {
        const r = computeRow('w', [], [
            appt({ leadId: '1', confirmationsOutcome: 'confermato' }),
            appt({ leadId: '2', confirmationsOutcome: 'scartato', confirmationsDiscardReason: '3 NR consecutivi' }),
            appt({ leadId: '3' }), // pendente
        ]);
        assert.equal(r.fissati, 3);
        assert.equal(r.pendenti, 1);
        assert.equal(r.pctConf, 50, '1 confermato su 2 esitati');
        assert.equal(r.scartiNr, 1);
        assert.equal(r.pctNr, 50);
    });
});

describe('isNrDiscard', () => {
    test('prende 3 NR e 4 NR', () => {
        assert.equal(isNrDiscard('3 NR consecutivi'), true);
        assert.equal(isNrDiscard('4 NR consecutivi'), true);
    });

    test('non prende le causali qualitative', () => {
        for (const r of [
            'non interessato', 'non ha soldi', 'solo informazioni',
            'posticipa senza data', 'attaccato in faccia', 'disoccupato',
            'non ha potere decisionale', 'straniero', 'non risponde',
            'numero inesistente', "non vuole prendere l'appuntamento",
        ]) {
            assert.equal(isNrDiscard(r), false, `"${r}" non deve contare come NR`);
        }
    });

    test('il confine di parola protegge dalle causali future', () => {
        // Il match originale era un includes('nr') nudo: oggi innocuo, ma
        // qualunque causale nuova con "nr" dentro sarebbe entrata di nascosto.
        assert.equal(isNrDiscard('numero non raggiungibile'), false);
        assert.equal(isNrDiscard(null), false);
    });
});

describe('scope funnel', () => {
    test('Database e non-Database si escludono', () => {
        assert.equal(isDatabaseFunnel('Database'), true);
        assert.equal(isDatabaseFunnel('DATABASE'), true);
        assert.equal(matchesScope('Database', 'DATABASE'), true);
        assert.equal(matchesScope('Database', 'NON_DATABASE'), false);
        assert.equal(matchesScope('Job Simulator', 'NON_DATABASE'), true);
        assert.equal(matchesScope('Job Simulator', 'ALL'), true);
    });
});

describe('mix di funnel', () => {
    test('pctDatabase si misura sui lead, non sulle chiamate', () => {
        // Un lead Database richiamato 3 volte non deve far sembrare la
        // settimana piu' "Database" di quanto sia.
        const r = computeRow('w', [
            call({ leadId: 'a', funnel: 'Database' }),
            call({ leadId: 'a', funnel: 'Database', rn: 2 }),
            call({ leadId: 'a', funnel: 'Database', rn: 3 }),
            call({ leadId: 'b', funnel: 'Job Simulator' }),
        ], []);
        assert.equal(r.lavorati, 2);
        assert.equal(r.pctDatabase, 50);
    });
});
