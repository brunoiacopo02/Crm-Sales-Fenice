import { test, describe } from 'node:test';
import assert from 'node:assert';
import { operativaPeriodBounds, leaderboardPeriodBounds } from './periodBounds';

// Il server di produzione gira in UTC (Vercel). Tutti i casi qui sotto
// verificano che i bounds siano calendario Europe/Rome e non UTC: e' la
// classe di bug che dateUtils.ts ha gia' chiuso in 19 punti e che
// managerAdvancedActions.ts si era persa.

describe('operativaPeriodBounds', () => {
    describe('MESE', () => {
        test('parte dalla mezzanotte italiana del 1°, non da quella UTC', () => {
            // 24 agosto 2026, 12:00 Rome. Agosto = ora legale, Rome = UTC+2.
            const now = new Date('2026-08-24T12:00:00+02:00');
            const { start, end } = operativaPeriodBounds('MESE', now);

            // 1 ago 00:00 Rome = 31 lug 22:00 UTC
            assert.strictEqual(start.toISOString(), '2026-07-31T22:00:00.000Z');
            // end esclusivo = 1 set 00:00 Rome = 31 ago 22:00 UTC
            assert.strictEqual(end.toISOString(), '2026-08-31T22:00:00.000Z');
        });

        test('una chiusura registrata l’1 del mese alle 00:30 italiane sta nel mese nuovo', () => {
            const now = new Date('2026-08-24T12:00:00+02:00');
            const { start } = operativaPeriodBounds('MESE', now);
            const chiusuraNotturna = new Date('2026-08-01T00:30:00+02:00');
            assert.ok(chiusuraNotturna >= start, 'deve cadere dentro agosto');
        });

        test('l’ultima ora del mese non sconfina nel mese successivo', () => {
            const now = new Date('2026-08-24T12:00:00+02:00');
            const { end } = operativaPeriodBounds('MESE', now);
            const primoSettembre = new Date('2026-09-01T00:30:00+02:00');
            assert.ok(primoSettembre >= end, 'settembre deve restare fuori da agosto');
        });

        test('gennaio: il mese precedente è dicembre dell’anno prima', () => {
            const now = new Date('2026-01-15T12:00:00+01:00');
            const { start, end } = operativaPeriodBounds('MESE', now);
            // Gennaio = ora solare, Rome = UTC+1
            assert.strictEqual(start.toISOString(), '2025-12-31T23:00:00.000Z');
            assert.strictEqual(end.toISOString(), '2026-01-31T23:00:00.000Z');
        });
    });

    describe('OGGI', () => {
        test('copre il giorno solare italiano, end esclusivo', () => {
            const now = new Date('2026-08-24T12:00:00+02:00');
            const { start, end } = operativaPeriodBounds('OGGI', now);
            assert.strictEqual(start.toISOString(), '2026-08-23T22:00:00.000Z');
            assert.strictEqual(end.toISOString(), '2026-08-24T22:00:00.000Z');
        });

        test('alle 00:30 italiane il giorno è già quello nuovo', () => {
            // 00:30 Rome del 25 = 22:30 UTC del 24: con i bounds UTC finiva nel giorno prima
            const now = new Date('2026-08-25T00:30:00+02:00');
            const { start } = operativaPeriodBounds('OGGI', now);
            assert.strictEqual(start.toISOString(), '2026-08-24T22:00:00.000Z');
        });
    });

    describe('TRIMESTRE', () => {
        test('copre 90 giorni pieni fino a fine giornata di oggi', () => {
            const now = new Date('2026-08-24T12:00:00+02:00');
            const { start, end } = operativaPeriodBounds('TRIMESTRE', now);
            // start = mezzanotte italiana di 90 giorni fa (26 maggio 2026)
            assert.strictEqual(start.toISOString(), '2026-05-25T22:00:00.000Z');
            // end = mezzanotte italiana di domani (esclusivo)
            assert.strictEqual(end.toISOString(), '2026-08-24T22:00:00.000Z');
        });

        test('attraversa il cambio di ora legale senza perdere un giorno', () => {
            // 15 gennaio (solare) meno 90 gg = 17 ottobre (legale): offset diverso
            const now = new Date('2026-01-15T12:00:00+01:00');
            const { start, end } = operativaPeriodBounds('TRIMESTRE', now);
            const giorni = Math.round((end.getTime() - start.getTime()) / 86_400_000);
            assert.strictEqual(giorni, 91, '90 giorni indietro + oggi = 91 giorni di finestra');
        });
    });

    test('end è sempre esclusivo e strettamente maggiore di start', () => {
        const now = new Date('2026-08-24T12:00:00+02:00');
        for (const p of ['OGGI', 'MESE', 'TRIMESTRE'] as const) {
            const { start, end } = operativaPeriodBounds(p, now);
            assert.ok(end > start, `${p}: end deve superare start`);
        }
    });
});

describe('leaderboardPeriodBounds', () => {
    test('month: mezzanotte italiana del 1°, end esclusivo', () => {
        const now = new Date('2026-08-24T12:00:00+02:00');
        const { start, end } = leaderboardPeriodBounds('month', now);
        assert.strictEqual(start.toISOString(), '2026-07-31T22:00:00.000Z');
        assert.strictEqual(end.toISOString(), '2026-08-31T22:00:00.000Z');
    });

    test('week: lunedì-domenica italiano, non UTC', () => {
        // 24 agosto 2026 è un lunedì
        const now = new Date('2026-08-24T12:00:00+02:00');
        const { start, end } = leaderboardPeriodBounds('week', now);
        assert.strictEqual(start.toISOString(), '2026-08-23T22:00:00.000Z');
        assert.strictEqual(end.toISOString(), '2026-08-30T22:00:00.000Z');
    });

    test('week: la domenica appartiene ancora alla settimana che si chiude', () => {
        // domenica 23 agosto: la settimana ISO va da lun 17 a lun 24 (escluso)
        const domenica = new Date('2026-08-23T18:00:00+02:00');
        const { start, end } = leaderboardPeriodBounds('week', domenica);
        assert.strictEqual(start.toISOString(), '2026-08-16T22:00:00.000Z');
        assert.ok(domenica >= start && domenica < end, 'la domenica sta dentro');
    });

    test('week: un appuntamento della domenica sera non slitta alla settimana dopo', () => {
        // 23:30 di domenica Rome = 21:30 UTC: coi bounds UTC finiva già in lunedì
        const domenicaSera = new Date('2026-08-23T23:30:00+02:00');
        const { start, end } = leaderboardPeriodBounds('week', domenicaSera);
        assert.ok(domenicaSera >= start && domenicaSera < end);
        assert.strictEqual(end.toISOString(), '2026-08-23T22:00:00.000Z');
    });

    test('today: giorno solare italiano', () => {
        const now = new Date('2026-08-24T12:00:00+02:00');
        const { start, end } = leaderboardPeriodBounds('today', now);
        assert.strictEqual(start.toISOString(), '2026-08-23T22:00:00.000Z');
        assert.strictEqual(end.toISOString(), '2026-08-24T22:00:00.000Z');
    });
});
