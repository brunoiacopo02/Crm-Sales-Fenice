import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    retryAfterMs,
    declaredNotAccepted,
    isDuplicate,
    timeoutRetryEnabled,
    intakeTimeoutMs,
    DEFAULT_INTAKE_TIMEOUT_MS,
    MAX_INTAKE_TIMEOUT_MS,
    DEFAULT_RETRY_WAIT_MS,
    MAX_RETRY_WAIT_MS,
} from './retryAfter'

const NOW = new Date('2026-09-09T18:00:00Z')

test('legge dopoSecondi dal corpo JSON del 429', () => {
    const body = JSON.stringify({ ok: false, error: 'rate_limited', accettato: false, ritenta: true, dopoSecondi: 7 })
    assert.deepEqual(retryAfterMs(body, null, NOW), { waitMs: 7000, tooLong: false })
})

test('il corpo ha la precedenza sull header', () => {
    const body = JSON.stringify({ dopoSecondi: 3 })
    assert.equal(retryAfterMs(body, '20', NOW).waitMs, 3000)
})

test('usa retry-after in secondi quando il corpo non lo dice', () => {
    assert.equal(retryAfterMs(null, '12', NOW).waitMs, 12000)
    assert.equal(retryAfterMs('non json', '12', NOW).waitMs, 12000)
})

test('usa retry-after in forma di data HTTP', () => {
    const fra10s = new Date(NOW.getTime() + 10_000).toUTCString()
    assert.equal(retryAfterMs(null, fra10s, NOW).waitMs, 10000)
})

test('senza indicazioni usa il fallback', () => {
    assert.deepEqual(retryAfterMs(null, null, NOW), { waitMs: DEFAULT_RETRY_WAIT_MS, tooLong: false })
    assert.deepEqual(retryAfterMs('', '', NOW), { waitMs: DEFAULT_RETRY_WAIT_MS, tooLong: false })
})

test('un attesa piu lunga del tetto e segnalata come tooLong', () => {
    const body = JSON.stringify({ dopoSecondi: 120 })
    const hint = retryAfterMs(body, null, NOW)
    assert.equal(hint.waitMs, 120_000)
    assert.equal(hint.tooLong, true)
    assert.ok(hint.waitMs > MAX_RETRY_WAIT_MS)
})

test('valori non validi non producono attese assurde', () => {
    assert.equal(retryAfterMs(JSON.stringify({ dopoSecondi: -5 }), null, NOW).waitMs, DEFAULT_RETRY_WAIT_MS)
    assert.equal(retryAfterMs(JSON.stringify({ dopoSecondi: 'boh' }), null, NOW).waitMs, DEFAULT_RETRY_WAIT_MS)
    assert.equal(retryAfterMs(null, 'domani', NOW).waitMs, DEFAULT_RETRY_WAIT_MS)
})

test('dopoSecondi come stringa numerica e accettato', () => {
    assert.equal(retryAfterMs(JSON.stringify({ dopoSecondi: '4' }), null, NOW).waitMs, 4000)
})

test('riconosce la dichiarazione accettato:false', () => {
    assert.equal(declaredNotAccepted(JSON.stringify({ accettato: false })), true)
    assert.equal(declaredNotAccepted(JSON.stringify({ accettato: true })), false)
    assert.equal(declaredNotAccepted('429 Too Many Requests'), false, 'corpo testuale: nessuna dichiarazione')
    assert.equal(declaredNotAccepted(null), false)
})

test('riconosce duplicato:true nella risposta 200', () => {
    assert.equal(isDuplicate(JSON.stringify({ ok: true, accettato: true, duplicato: true })), true)
    assert.equal(isDuplicate(JSON.stringify({ ok: true, accettato: true })), false)
    assert.equal(isDuplicate('OK'), false)
    assert.equal(isDuplicate(null), false)
})

test('il retry sui timeout e spento se la env non e esplicitamente true', () => {
    const prev = process.env.BOT_INTAKE_RETRY_TIMEOUT
    try {
        delete process.env.BOT_INTAKE_RETRY_TIMEOUT
        assert.equal(timeoutRetryEnabled(), false, 'default: spento')
        process.env.BOT_INTAKE_RETRY_TIMEOUT = 'yes'
        assert.equal(timeoutRetryEnabled(), false, 'solo la stringa true accende')
        process.env.BOT_INTAKE_RETRY_TIMEOUT = 'true'
        assert.equal(timeoutRetryEnabled(), true)
    } finally {
        if (prev === undefined) delete process.env.BOT_INTAKE_RETRY_TIMEOUT
        else process.env.BOT_INTAKE_RETRY_TIMEOUT = prev
    }
})

test('il timeout dell intake vale 15s quando la env non c e', () => {
    assert.equal(intakeTimeoutMs({}), DEFAULT_INTAKE_TIMEOUT_MS)
    assert.equal(DEFAULT_INTAKE_TIMEOUT_MS, 15_000)
})

test('una env valida vince sul default', () => {
    assert.equal(intakeTimeoutMs({ BOT_INTAKE_TIMEOUT_MS: '8000' }), 8000)
    assert.equal(intakeTimeoutMs({ BOT_INTAKE_TIMEOUT_MS: '20000' }), 20_000)
})

test('una env sbagliata non puo far rientrare un timeout stretto', () => {
    for (const raw of ['', 'quindici', '0', '-1', 'NaN']) {
        assert.equal(intakeTimeoutMs({ BOT_INTAKE_TIMEOUT_MS: raw }), DEFAULT_INTAKE_TIMEOUT_MS, raw)
    }
})

test('il timeout e tappato al tetto: un push appeso non affama la coda', () => {
    assert.equal(intakeTimeoutMs({ BOT_INTAKE_TIMEOUT_MS: '120000' }), MAX_INTAKE_TIMEOUT_MS)
})
