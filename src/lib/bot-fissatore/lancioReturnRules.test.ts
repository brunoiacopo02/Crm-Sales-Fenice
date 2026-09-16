import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LANCIO_WEBDEV_BUCKET,
    checkLancioReturnToPool,
    motivoRestituzioneDaNota,
    type LancioReturnLead,
} from './lancioReturnRules';

const base = (over: Partial<LancioReturnLead> = {}): LancioReturnLead => ({
    launchBucket: LANCIO_WEBDEV_BUCKET,
    assigneeIsBot: true,
    status: 'NEW',
    presentedAt: null,
    appointmentDate: null,
    lancioScelta: null,
    ...over,
});

test('il bucket è quello della spec', () => {
    assert.equal(LANCIO_WEBDEV_BUCKET, 'LANCIO_WEBDEV_2026');
});

test('motivo dalla nota: le due note del bot', () => {
    assert.equal(motivoRestituzioneDaNota('Lancio: mai risposto', 'NON_RISPOSTO'), 'mai_risposto');
    assert.equal(motivoRestituzioneDaNota('Lancio: silenzio dopo il follow-up', 'NON_RISPOSTO'), 'silenzio_dopo_followup');
    assert.equal(motivoRestituzioneDaNota('  lancio: SILENZIO dopo il follow-up.', 'NON_RISPOSTO'), 'silenzio_dopo_followup');
});

test('motivo dalla nota: il follow-up mai partito è un terzo caso', () => {
    // Nota di riconciliazione: il bot distingue "non ha risposto al follow-up"
    // da "il follow-up non gliel'ho proprio mandato". Il secondo NON è freddezza
    // del lead: è una consegna mancata, e chi guarda i motivi deve vederla.
    assert.equal(motivoRestituzioneDaNota('Lancio: follow-up non inviato', 'INTERROTTO'), 'followup_non_inviato');
    assert.equal(motivoRestituzioneDaNota('  LANCIO: Follow-Up non inviato.', 'NON_RISPOSTO'), 'followup_non_inviato');
    assert.equal(motivoRestituzioneDaNota('Lancio: followup non inviato', 'NON_RISPOSTO'), 'followup_non_inviato');
});

test('motivo dalla nota: senza nota riconoscibile decide l\'esito', () => {
    assert.equal(motivoRestituzioneDaNota(undefined, 'NON_RISPOSTO'), 'mai_risposto');
    assert.equal(motivoRestituzioneDaNota('boh', 'NON_RISPOSTO'), 'mai_risposto');
    assert.equal(motivoRestituzioneDaNota(null, 'INTERROTTO'), 'silenzio_dopo_followup');
});

test('torna al pool: lead del lancio, al bot, NEW/IN_PROGRESS, senza storico', () => {
    assert.deepEqual(checkLancioReturnToPool(base()), { ok: true });
    assert.deepEqual(checkLancioReturnToPool(base({ status: 'IN_PROGRESS' })), { ok: true });
});

test('non torna: non è del lancio, o non è al bot', () => {
    assert.deepEqual(checkLancioReturnToPool(base({ launchBucket: 'BLACK_SUMMER' })), { ok: false, reason: 'not_lancio' });
    assert.deepEqual(checkLancioReturnToPool(base({ launchBucket: null })), { ok: false, reason: 'not_lancio' });
    assert.deepEqual(checkLancioReturnToPool(base({ assigneeIsBot: false })), { ok: false, reason: 'not_bot' });
});

test('i lead NON del lancio non vengono toccati da questo ramo', () => {
    // La regressione da evitare: il ritorno al pool del lancio non deve
    // intercettare i lead del bot ordinario, che continuano a passare da
    // reassignBotLeadToHumanPool (round robin verso un GDO umano). Qualunque
    // bucket diverso — compreso "nessun bucket", che è il caso della stragrande
    // maggioranza dei lead — esce con 'not_lancio' PRIMA di ogni altra guardia.
    for (const bucket of [null, '', 'BLACK_SUMMER', 'DB_SET25', 'lancio_webdev_2026']) {
        assert.deepEqual(
            checkLancioReturnToPool(base({ launchBucket: bucket })),
            { ok: false, reason: 'not_lancio' },
            `bucket ${JSON.stringify(bucket)} non deve entrare nel ramo lancio`,
        );
    }
    // Anche con uno stato che nel lancio sarebbe bloccante, un lead non del
    // lancio esce sempre con 'not_lancio': la decisione non dipende da altro.
    assert.deepEqual(
        checkLancioReturnToPool(base({ launchBucket: null, status: 'APPOINTMENT', appointmentDate: new Date('2026-10-06T09:00:00Z') })),
        { ok: false, reason: 'not_lancio' },
    );
});

test('guardie invariate: REJECTED e isLeadLocked (APPOINTMENT / presentedAt)', () => {
    assert.deepEqual(checkLancioReturnToPool(base({ status: 'REJECTED' })), { ok: false, reason: 'already_rejected' });
    assert.deepEqual(checkLancioReturnToPool(base({ status: 'APPOINTMENT' })), { ok: false, reason: 'locked_appointment' });
    assert.deepEqual(checkLancioReturnToPool(base({ presentedAt: new Date('2026-10-06T09:00:00Z') })), { ok: false, reason: 'locked_appointment' });
});

test('guardie del lancio: appuntamento in agenda o scelta fatta', () => {
    assert.deepEqual(checkLancioReturnToPool(base({ appointmentDate: new Date('2026-10-06T09:00:00Z') })), { ok: false, reason: 'locked_appointment' });
    assert.deepEqual(checkLancioReturnToPool(base({ lancioScelta: 'chiamata_subito' })), { ok: false, reason: 'scelta_fatta' });
    assert.deepEqual(checkLancioReturnToPool(base({ lancioScelta: 'app_pomeriggio' })), { ok: false, reason: 'scelta_fatta' });
    assert.deepEqual(checkLancioReturnToPool(base({ lancioScelta: undefined })), { ok: true });
});
