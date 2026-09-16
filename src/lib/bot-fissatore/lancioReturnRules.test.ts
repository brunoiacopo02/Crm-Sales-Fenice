import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LANCIO_WEBDEV_BUCKET,
    checkLancioReturnToPool,
    isAlreadyReturned,
    motivoRestituzioneDaNota,
    needsReturnEventCheck,
    type LancioAlreadyReturnedLead,
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

// --- Doppioni: lo stesso esito che riarriva su un lead gia' restituito --------

const restituito = (over: Partial<LancioAlreadyReturnedLead & { hasReturnEvent: boolean }> = {}) => ({
    launchBucket: LANCIO_WEBDEV_BUCKET,
    assignedToId: null,
    status: 'NEW',
    hasReturnEvent: true,
    ...over,
});

test('lead gia\' restituito: il doppione si riconosce dallo stato + evento', () => {
    assert.equal(isAlreadyReturned(restituito(), 'NON_RISPOSTO'), true);
    assert.equal(isAlreadyReturned(restituito(), 'INTERROTTO'), true);
});

test('lead gia\' restituito: senza l\'evento non e\' un doppione', () => {
    // Un lead del lancio non assegnato e NEW che non e' mai tornato dal bot e'
    // semplicemente un lead nel pool: non deve passare per doppione, o si
    // coprirebbe un 403 legittimo.
    assert.equal(isAlreadyReturned(restituito({ hasReturnEvent: false }), 'NON_RISPOSTO'), false);
});

test('lead gia\' restituito: ogni altra combinazione non e\' un doppione', () => {
    assert.equal(isAlreadyReturned(restituito({ launchBucket: null }), 'NON_RISPOSTO'), false);
    assert.equal(isAlreadyReturned(restituito({ launchBucket: 'BLACK_SUMMER' }), 'NON_RISPOSTO'), false);
    // Gia' ridistribuito a un GDO: non e' piu' nel pool, il 403 e' corretto.
    assert.equal(isAlreadyReturned(restituito({ assignedToId: 'gdo-110' }), 'NON_RISPOSTO'), false);
    // Qualcuno ci ha lavorato dopo il ritorno: lo stato non e' piu' NEW.
    assert.equal(isAlreadyReturned(restituito({ status: 'IN_PROGRESS' }), 'NON_RISPOSTO'), false);
    assert.equal(isAlreadyReturned(restituito({ status: 'APPOINTMENT' }), 'NON_RISPOSTO'), false);
    assert.equal(isAlreadyReturned(restituito({ status: 'REJECTED' }), 'NON_RISPOSTO'), false);
    // Altri esiti non c'entrano: APPUNTAMENTO e NOTA hanno i loro rami.
    for (const o of ['APPUNTAMENTO', 'NOTA', 'CONTATTO_UMANO', 'RICHIAMO', 'DA_SCARTARE']) {
        assert.equal(isAlreadyReturned(restituito(), o), false, `${o} non deve passare di qui`);
    }
});

test('la query sull\'evento si paga solo quando tutto il resto combacia', () => {
    assert.equal(needsReturnEventCheck({ launchBucket: LANCIO_WEBDEV_BUCKET, assignedToId: null, status: 'NEW' }, 'NON_RISPOSTO'), true);
    assert.equal(needsReturnEventCheck({ launchBucket: null, assignedToId: null, status: 'NEW' }, 'NON_RISPOSTO'), false);
    assert.equal(needsReturnEventCheck({ launchBucket: LANCIO_WEBDEV_BUCKET, assignedToId: 'gdo-110', status: 'NEW' }, 'NON_RISPOSTO'), false);
    assert.equal(needsReturnEventCheck({ launchBucket: LANCIO_WEBDEV_BUCKET, assignedToId: null, status: 'NEW' }, 'NOTA'), false);
});

test('scenario del route: il bot ritenta lo stesso esito e non prende un 403', () => {
    // Sequenza vera (cron `lancio-restituzioni`, che segna `restituito` solo dopo
    // una risposta positiva del CRM: se la risposta si perde, ritenta ogni ora).
    //
    // 1) Primo POST NON_RISPOSTO: il lead e' del lancio e ancora al bot.
    const primo = base();
    assert.deepEqual(checkLancioReturnToPool(primo), { ok: true });
    assert.equal(motivoRestituzioneDaNota('Lancio: mai risposto', 'NON_RISPOSTO'), 'mai_risposto');

    // 2) Il ritorno al pool toglie l'assegnatario e riporta il lead a NEW,
    //    scrivendo l'evento LANCIO_RETURNED_TO_POOL.
    const dopo = restituito();

    // 3) La risposta si perde, il bot ritenta. Senza questa regola il lead
    //    (assignedToId nullo => assigneeIsBot falso) si prende il 403 «lead non
    //    assegnato a un account bot». Con la regola: 200, skipped 'already_returned',
    //    nessuna scrittura, e il cron segna `restituito` e smette di ritentare.
    assert.equal(needsReturnEventCheck(dopo, 'NON_RISPOSTO'), true);
    assert.equal(isAlreadyReturned(dopo, 'NON_RISPOSTO'), true);
});
