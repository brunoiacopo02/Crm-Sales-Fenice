import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LANCIO_FUNNEL, LANCIO_BUCKET, LANCIO_SLUG, LANCIO_LIST_NAME_NORMALIZED,
    isLancioIntakeEnabled, decideLancioIntake, lancioPayloadField, lancioFieldForLead,
    buildLancioLeadRow, buildLancioIntakeEventRows,
} from './intake';

// ------------------------------------------------------------ costanti

test('i nomi sono quelli della spec, lettera per lettera', () => {
    assert.equal(LANCIO_FUNNEL, 'Lancio Web Dev AI');
    assert.equal(LANCIO_BUCKET, 'LANCIO_WEBDEV_2026');
    assert.equal(LANCIO_SLUG, 'webdev-2026-10');
    assert.equal(LANCIO_LIST_NAME_NORMALIZED, 'lancio web developer ai');
});

// ------------------------------------------------------------ interruttore

test('l interruttore si accende SOLO con la stringa esatta "on"', () => {
    assert.equal(isLancioIntakeEnabled({ LANCIO_WEBDEV_INTAKE: 'on' }), true);
    for (const v of ['ON', 'On', 'true', '1', 'yes', 'off', '', undefined]) {
        assert.equal(isLancioIntakeEnabled({ LANCIO_WEBDEV_INTAKE: v }), false, `valore ${String(v)}`);
    }
    assert.equal(isLancioIntakeEnabled({}), false);
});

// ------------------------------------------------------------ decisione

const LISTA = '132';

test('spento: mai lancio, anche se la lista combacia', () => {
    const d = decideLancioIntake({ enabled: false, lancioListId: LISTA, triggerListId: LISTA, activeListIds: new Set([LISTA]) });
    assert.deepEqual(d, { lancio: false, motivo: 'spento' });
});

test('acceso ma la lista non esiste su AC: non e lancio e lo dice', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: null, triggerListId: LISTA, activeListIds: null });
    assert.deepEqual(d, { lancio: false, motivo: 'lista_sconosciuta' });
});

test('fastpath: la lista del payload combacia, nessuna membership serve', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: LISTA, triggerListId: LISTA, activeListIds: null });
    assert.deepEqual(d, { lancio: true, via: 'payload', listId: LISTA });
});

test('senza lista nel payload e senza membership ancora letta: non_in_lista (il chiamante deve leggere le membership)', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: LISTA, triggerListId: null, activeListIds: null });
    assert.deepEqual(d, { lancio: false, motivo: 'non_in_lista' });
});

test('membership: il contatto e iscritto alla lista lancio anche se il trigger e un altra lista', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: LISTA, triggerListId: '7', activeListIds: new Set(['7', LISTA]) });
    assert.deepEqual(d, { lancio: true, via: 'membership', listId: LISTA });
});

test('membership letta e la lista lancio non c e: non_in_lista', () => {
    const d = decideLancioIntake({ enabled: true, lancioListId: LISTA, triggerListId: '7', activeListIds: new Set(['7']) });
    assert.deepEqual(d, { lancio: false, motivo: 'non_in_lista' });
});

// ------------------------------------------------------------ payload

test('il campo lancio del payload intake porta slug e ingresso', () => {
    assert.deepEqual(lancioPayloadField('lista'), { slug: 'webdev-2026-10', ingresso: 'lista' });
    assert.deepEqual(lancioPayloadField('pulsante_webinar'), { slug: 'webdev-2026-10', ingresso: 'pulsante_webinar' });
});

test('lancioFieldForLead: solo i lead del bucket lancio portano il campo', () => {
    assert.deepEqual(lancioFieldForLead({ launchBucket: 'LANCIO_WEBDEV_2026', lancioIngresso: 'lista' }), { slug: 'webdev-2026-10', ingresso: 'lista' });
    assert.equal(lancioFieldForLead({ launchBucket: 'BLACK_SUMMER', lancioIngresso: null }), undefined);
    assert.equal(lancioFieldForLead({ launchBucket: null, lancioIngresso: null }), undefined);
});

test('lancioFieldForLead: ingresso sconosciuto o assente ricade su "lista" (i lead del bucket nascono dalla lista)', () => {
    assert.deepEqual(lancioFieldForLead({ launchBucket: 'LANCIO_WEBDEV_2026', lancioIngresso: null }), { slug: 'webdev-2026-10', ingresso: 'lista' });
    assert.deepEqual(lancioFieldForLead({ launchBucket: 'LANCIO_WEBDEV_2026', lancioIngresso: 'boh' }), { slug: 'webdev-2026-10', ingresso: 'lista' });
});

// ------------------------------------------------------------ riga lead

const NOW = new Date('2026-09-16T10:00:00Z');

test('riga lead lancio assegnata al bot: funnel, bucket, ingresso, assignedAt = adesso', () => {
    const row = buildLancioLeadRow({
        id: 'L1', name: 'Mario Rossi', phone: '3331234567', email: 'm@x.it',
        acContactId: '999', phoneSuspicious: false, botId: 'BOT', now: NOW,
    });
    assert.equal(row.funnel, 'Lancio Web Dev AI');
    assert.equal(row.launchBucket, 'LANCIO_WEBDEV_2026');
    assert.equal(row.lancioIngresso, 'lista');
    assert.equal(row.source, 'activecampaign');
    assert.equal(row.status, 'NEW');
    assert.equal(row.callCount, 0);
    assert.equal(row.assignedToId, 'BOT');
    assert.equal(row.assignedAt, NOW);
    assert.equal(row.createdAt, NOW);
    assert.equal(row.companyId, 'fenice');
    assert.equal(row.phoneSuspicious, false);
});

test('telefono sospetto o bot assente: la riga resta nel bucket senza padrone e senza assignedAt', () => {
    const sospetto = buildLancioLeadRow({ id: 'L2', name: 'X', phone: '0000000000', email: null, acContactId: '1', phoneSuspicious: true, botId: 'BOT', now: NOW });
    assert.equal(sospetto.assignedToId, null);
    assert.equal(sospetto.assignedAt, null);
    assert.equal(sospetto.phoneSuspicious, true);
    const senzaBot = buildLancioLeadRow({ id: 'L3', name: 'X', phone: '3331234567', email: null, acContactId: '2', phoneSuspicious: false, botId: null, now: NOW });
    assert.equal(senzaBot.assignedToId, null);
    assert.equal(senzaBot.assignedAt, null);
});

// ------------------------------------------------------------ eventi

test('eventi intake con bot: IMPORTED + ASSIGNED(routing=lancio) + LANCIO_INTAKE', () => {
    const rows = buildLancioIntakeEventRows({ leadId: 'L1', botId: 'BOT', adminId: null, acContactId: '999', source: 'activecampaign', via: 'payload', listId: '132', now: NOW });
    assert.deepEqual(rows.map(r => r.eventType), ['IMPORTED', 'ASSIGNED', 'LANCIO_INTAKE']);
    for (const r of rows) {
        assert.equal(r.leadId, 'L1');
        assert.equal(r.companyId, 'fenice');
        assert.equal(r.timestamp, NOW);
        assert.equal(typeof r.id, 'string');
        assert.ok(r.id.length > 10);
    }
    assert.equal(rows[0].toSection, 'Prima Chiamata');
    assert.deepEqual(rows[0].metadata, { source: 'activecampaign', acContactId: '999', provenienza: 'Lancio Web Dev AI', lancio: true });
    assert.deepEqual(rows[1].metadata, { assignedToUser: 'BOT', source: 'activecampaign', routing: 'lancio' });
    assert.deepEqual(rows[2].metadata, { slug: 'webdev-2026-10', ingresso: 'lista', via: 'payload', listId: '132', assegnatoAlBot: true });
});

test('eventi intake senza bot: niente ASSIGNED, LANCIO_INTAKE dice assegnatoAlBot=false', () => {
    const rows = buildLancioIntakeEventRows({ leadId: 'L3', botId: null, adminId: 'ADM', acContactId: null, source: 'lancio_sync', via: 'sync', listId: null, now: NOW });
    assert.deepEqual(rows.map(r => r.eventType), ['IMPORTED', 'LANCIO_INTAKE']);
    assert.equal(rows[0].userId, 'ADM');
    assert.equal(rows[1].userId, 'ADM');
    assert.deepEqual(rows[1].metadata, { slug: 'webdev-2026-10', ingresso: 'lista', via: 'sync', listId: null, assegnatoAlBot: false });
});

test('gli id degli eventi sono tutti diversi (bulk insert su primary key)', () => {
    const rows = buildLancioIntakeEventRows({ leadId: 'L1', botId: 'BOT', adminId: null, acContactId: null, source: 'lancio_sync', via: 'sync', listId: null, now: NOW });
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
});
