import test from 'node:test';
import assert from 'node:assert/strict';
import { isBotHolidayWindow, getConfiguredWindow, getActiveHolidayWindow } from './holidayWindow';

/** Istante UTC → Date. Il server Vercel gira in UTC, la regola è su Europe/Rome. */
const utc = (iso: string) => new Date(iso);

function withEnv(value: string | undefined, fn: () => void) {
    const prev = process.env.BOT_HOLIDAY_WINDOW;
    if (value === undefined) delete process.env.BOT_HOLIDAY_WINDOW;
    else process.env.BOT_HOLIDAY_WINDOW = value;
    try { fn(); } finally {
        if (prev === undefined) delete process.env.BOT_HOLIDAY_WINDOW;
        else process.env.BOT_HOLIDAY_WINDOW = prev;
    }
}

test('default: la finestra è 8 agosto → 17 agosto escluso', () => {
    withEnv(undefined, () => {
        assert.deepEqual(getConfiguredWindow(), { from: '2026-08-08', until: '2026-08-17' });
    });
});

test('il 7 agosto (oggi) i lead vanno ancora ai GDO', () => {
    withEnv(undefined, () => {
        assert.equal(isBotHolidayWindow(utc('2026-08-07T16:00:00Z')), false);
    });
});

test('la finestra si apre a mezzanotte italiana dell\'8, non a mezzanotte UTC', () => {
    withEnv(undefined, () => {
        // 2026-08-07 21:59 UTC = 7 agosto 23:59 a Roma (CEST, +2) → ancora fuori
        assert.equal(isBotHolidayWindow(utc('2026-08-07T21:59:00Z')), false);
        // 2026-08-07 22:00 UTC = 8 agosto 00:00 a Roma → dentro
        assert.equal(isBotHolidayWindow(utc('2026-08-07T22:00:00Z')), true);
    });
});

test('tutti i giorni di ferie sono dentro, 16 incluso', () => {
    withEnv(undefined, () => {
        for (const day of ['08', '09', '10', '11', '12', '13', '14', '15', '16']) {
            assert.equal(isBotHolidayWindow(utc(`2026-08-${day}T09:00:00Z`)), true, `il ${day} agosto deve essere dentro`);
        }
    });
});

test('la finestra si chiude a mezzanotte italiana del 17, quando i GDO rientrano', () => {
    withEnv(undefined, () => {
        // 16 agosto 23:59 a Roma → ultimo istante dentro
        assert.equal(isBotHolidayWindow(utc('2026-08-16T21:59:00Z')), true);
        // 17 agosto 00:00 a Roma → fuori
        assert.equal(isBotHolidayWindow(utc('2026-08-16T22:00:00Z')), false);
        assert.equal(isBotHolidayWindow(utc('2026-08-17T09:00:00Z')), false);
    });
});

test('BOT_HOLIDAY_WINDOW=off spegne la finestra subito', () => {
    withEnv('off', () => {
        assert.equal(getConfiguredWindow(), null);
        assert.equal(isBotHolidayWindow(utc('2026-08-10T09:00:00Z')), false);
        assert.equal(getActiveHolidayWindow(utc('2026-08-10T09:00:00Z')), null);
    });
});

test('BOT_HOLIDAY_WINDOW valida sposta le date', () => {
    withEnv('2026-08-08..2026-08-20', () => {
        assert.deepEqual(getConfiguredWindow(), { from: '2026-08-08', until: '2026-08-20' });
        assert.equal(isBotHolidayWindow(utc('2026-08-19T09:00:00Z')), true);
        assert.equal(isBotHolidayWindow(utc('2026-08-20T09:00:00Z')), false);
    });
});

test('una env malformata non rompe l\'intake: si torna al default', () => {
    for (const bad of ['2026-08-08', 'pippo', '2026-8-8..2026-8-17', '2026-08-17..2026-08-08', '..']) {
        withEnv(bad, () => {
            assert.deepEqual(getConfiguredWindow(), { from: '2026-08-08', until: '2026-08-17' }, `env "${bad}"`);
        });
    }
});

test('getActiveHolidayWindow dà l\'ultimo giorno incluso, per il testo in UI', () => {
    withEnv(undefined, () => {
        assert.deepEqual(getActiveHolidayWindow(utc('2026-08-10T09:00:00Z')), {
            from: '2026-08-08', until: '2026-08-17', lastDay: '2026-08-16',
        });
        // fuori finestra: niente striscia
        assert.equal(getActiveHolidayWindow(utc('2026-08-07T09:00:00Z')), null);
    });
});
