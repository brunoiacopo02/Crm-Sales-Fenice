import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoutingWindow, getLeadRouting, BOT_DAILY_MIN } from './leadRouting';

/** Istante UTC → Date. Il server Vercel gira in UTC, la regola è su Europe/Rome. */
const utc = (iso: string) => new Date(iso);

function withEnv(value: string | undefined, fn: () => void) {
    const prev = process.env.BOT_ROUTING;
    if (value === undefined) delete process.env.BOT_ROUTING;
    else process.env.BOT_ROUTING = value;
    try { fn(); } finally {
        if (prev === undefined) delete process.env.BOT_ROUTING;
        else process.env.BOT_ROUTING = prev;
    }
}

/**
 * Nota sul contatore giornaliero.
 *
 * Questo modulo è puro e guarda solo l'orologio. Dice in quale delle tre
 * finestre cade l'istante: 'bot_only' (tutto al bot, nessun limite),
 * 'bot_first' (ai GDO, ma il bot passa avanti finché è sotto BOT_DAILY_MIN),
 * 'gdo_only' (fascia protetta del sabato, bot escluso a prescindere).
 *
 * Il conteggio dei lead già presi dal bot nel giorno civile di Roma vive nella
 * query del webhook AC (src/app/api/webhooks/activecampaign/route.ts, predicato
 * `underDailyMin`), perché è per-account e deve stare nella stessa transazione.
 *
 * Qui si testa quindi la mappa istante → finestra, che è ciò che decide se la
 * soglia va applicata, ignorata, o se il bot è proprio fuori dai giochi.
 */

/** Il clock di Roma ricostruito nel test, per asserire senza fidarsi del modulo. */
function romeParts(d: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// ---------------------------------------------------------------- feriali

// 2026-08-24 è un lunedì. Agosto è ora legale (CEST, +2): 11:00 UTC = 13:00 a Roma.
test('feriale: alle 12:59 siamo nella finestra del bot, alle 13:00 si apre quella mista', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-24T10:59:00Z')), 'bot_only');
    assert.equal(resolveRoutingWindow(utc('2026-08-24T11:00:00Z')), 'bot_first');
});

test('feriale: alle 19:59 siamo ancora nella finestra mista, alle 20:00 torna tutto al bot', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-24T17:59:00Z')), 'bot_first');
    assert.equal(resolveRoutingWindow(utc('2026-08-24T18:00:00Z')), 'bot_only');
});

test('feriale: la notte è finestra del bot, senza limite di quota', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-24T22:00:00Z')), 'bot_only'); // mezzanotte a Roma (martedì)
    assert.equal(resolveRoutingWindow(utc('2026-08-25T01:00:00Z')), 'bot_only'); // 03:00 a Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-25T05:30:00Z')), 'bot_only'); // 07:30 a Roma
});

test('feriale: alle 09:00 NON scatta nessuna fascia protetta, quella è solo del sabato', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-24T07:00:00Z')), 'bot_only'); // lunedì 09:00 Roma
});

test('la finestra mista vale tutti i giorni feriali, non solo il lunedì', () => {
    // 25→28 agosto 2026 = martedì → venerdì, alle 15:00 di Roma
    for (const day of ['25', '26', '27', '28']) {
        assert.equal(resolveRoutingWindow(utc(`2026-08-${day}T13:00:00Z`)), 'bot_first', `giorno ${day}`);
    }
});

// ---------------------------------------------------------------- sabato

// 2026-08-22 è un sabato. Fascia protetta 09:00 → 16:30 (turno GDO 10:00 → 16:30).
test('sabato: prima delle 09:00 è finestra del bot', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-22T05:00:00Z')), 'bot_only'); // 07:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T06:59:00Z')), 'bot_only'); // 08:59 Roma
});

test("sabato: la fascia protetta si apre alle 09:00, un'ora prima del turno", () => {
    // Voluto dal PO: l'ora di scarto accumula lead per i GDO che attaccano alle 10:00.
    assert.equal(resolveRoutingWindow(utc('2026-08-22T07:00:00Z')), 'gdo_only'); // 09:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T07:30:00Z')), 'gdo_only'); // 09:30 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T08:00:00Z')), 'gdo_only'); // 10:00 Roma, inizio turno
});

test('sabato: dalle 09:00 alle 16:30 il bot è escluso a prescindere dalla soglia', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-22T12:00:00Z')), 'gdo_only'); // 14:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T14:29:00Z')), 'gdo_only'); // 16:29 Roma
});

test('sabato: a fine turno (16:30) torna la finestra del bot, senza limite', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-22T14:30:00Z')), 'bot_only'); // 16:30 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T20:00:00Z')), 'bot_only'); // 22:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-22T21:59:00Z')), 'bot_only'); // 23:59 Roma
});

test('sabato: la fascia mista dei feriali non esiste, il bot non ha mai la precedenza', () => {
    // A nessuna ora del sabato la finestra è 'bot_first': o è del bot, o è protetta.
    // 2026-08-21T22:00Z = sabato 22 agosto 00:00 a Roma (CEST, +2).
    const mezzanotteRoma = Date.UTC(2026, 7, 21, 22, 0, 0);
    for (let h = 0; h < 24; h++) {
        const at = new Date(mezzanotteRoma + h * 3600 * 1000);
        assert.equal(romeParts(at).weekday, 'Sat', `ora ${h}: dovrebbe essere sabato`);
        assert.notEqual(resolveRoutingWindow(at), 'bot_first', `ora ${h} Roma`);
    }
});

// ---------------------------------------------------------------- domenica

// 2026-08-23 è una domenica.
test('domenica: finestra del bot a qualsiasi ora, anche nella fascia protetta del sabato', () => {
    assert.equal(resolveRoutingWindow(utc('2026-08-23T06:00:00Z')), 'bot_only'); // 08:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-23T07:00:00Z')), 'bot_only'); // 09:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-23T09:00:00Z')), 'bot_only'); // 11:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-23T13:00:00Z')), 'bot_only'); // 15:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-23T21:00:00Z')), 'bot_only'); // 23:00 Roma
});

// ---------------------------------------------------------------- ora legale

test("la finestra segue l'ora di Roma, non quella UTC (ora solare)", () => {
    // 15 gennaio 2026 è un giovedì, CET (+1): 12:00 UTC = 13:00 a Roma.
    assert.equal(resolveRoutingWindow(utc('2026-01-15T11:59:00Z')), 'bot_only');  // 12:59 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-15T12:00:00Z')), 'bot_first'); // 13:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-15T18:59:00Z')), 'bot_first'); // 19:59 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-15T19:00:00Z')), 'bot_only');  // 20:00 Roma
});

test("sabato d'inverno: i confini della fascia protetta restano 09:00 e 16:30 di Roma", () => {
    // 17 gennaio 2026 è un sabato, CET (+1).
    assert.equal(resolveRoutingWindow(utc('2026-01-17T07:59:00Z')), 'bot_only'); // 08:59 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-17T08:00:00Z')), 'gdo_only'); // 09:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-17T15:29:00Z')), 'gdo_only'); // 16:29 Roma
    assert.equal(resolveRoutingWindow(utc('2026-01-17T15:30:00Z')), 'bot_only'); // 16:30 Roma
});

test('il giorno della settimana è quello di Roma, non quello UTC', () => {
    // 2026-08-23T22:30:00Z = lunedì 24 agosto 00:30 a Roma: notte feriale, non domenica.
    assert.equal(resolveRoutingWindow(utc('2026-08-23T22:30:00Z')), 'bot_only');
    // 2026-08-22T22:30:00Z = domenica 23 agosto 00:30 a Roma.
    assert.equal(resolveRoutingWindow(utc('2026-08-22T22:30:00Z')), 'bot_only');
    // Sabato 12:00 Roma = fascia protetta; venerdì 12:00 Roma = ancora bot (prima delle 13).
    assert.equal(resolveRoutingWindow(utc('2026-08-22T10:00:00Z')), 'gdo_only'); // sabato 12:00 Roma
    assert.equal(resolveRoutingWindow(utc('2026-08-21T10:00:00Z')), 'bot_only'); // venerdì 12:00 Roma
});

// ---------------------------------------------------------------- interruttore

test('senza env la regola è attiva', () => {
    withEnv(undefined, () => {
        assert.equal(getLeadRouting(utc('2026-08-24T11:00:00Z')), 'bot_first');
    });
});

test('BOT_ROUTING=off riporta il round-robin storico', () => {
    for (const off of ['off', 'OFF', 'none', 'disabled', 'false', '0']) {
        withEnv(off, () => {
            assert.equal(getLeadRouting(utc('2026-08-24T11:00:00Z')), 'legacy');
            assert.equal(getLeadRouting(utc('2026-08-23T09:00:00Z')), 'legacy');
            // Anche la fascia protetta del sabato cede all'interruttore.
            assert.equal(getLeadRouting(utc('2026-08-22T10:00:00Z')), 'legacy');
        });
    }
});

test('un valore non riconosciuto non spegne la regola', () => {
    withEnv('si', () => {
        assert.equal(getLeadRouting(utc('2026-08-24T11:00:00Z')), 'bot_first');
    });
});

// ---------------------------------------------------------------- soglia minima

test('la soglia minima giornaliera del bot è 150', () => {
    assert.equal(BOT_DAILY_MIN, 150);
});

test("il sabato 09:00–16:30 è l'UNICA fascia della settimana in cui il bot non compare", () => {
    // Setaccio di una settimana intera a passi di 15 minuti. Fuori dalla fascia
    // protetta il bot deve sempre poter ricevere lead, altrimenti non arriva mai
    // a BOT_DAILY_MIN; dentro, non deve mai comparire nemmeno se è sotto soglia.
    const start = utc('2026-08-17T00:00:00Z'); // lunedì
    let protetti = 0;

    for (let i = 0; i < 7 * 96; i++) {
        const at = new Date(start.getTime() + i * 15 * 60 * 1000);
        const { weekday, minutes } = romeParts(at);
        const inFasciaProtetta = weekday === 'Sat'
            && minutes >= 9 * 60 && minutes < 16 * 60 + 30;
        const window = resolveRoutingWindow(at);

        if (inFasciaProtetta) {
            assert.equal(window, 'gdo_only', `${at.toISOString()} dovrebbe essere protetta`);
            protetti++;
        } else {
            assert.ok(
                window === 'bot_only' || window === 'bot_first',
                `${at.toISOString()} → ${window}, il bot resta fuori senza motivo`,
            );
        }
    }

    // 7 ore e mezza a passi di 15 minuti: la fascia c'è ed è larga quanto deve.
    assert.equal(protetti, 30);
});
