import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, type CrmClosure } from './match';
import type { SheetContract } from './sheetRows';

function sheet(over: Partial<SheetContract> = {}): SheetContract {
    return {
        key: over.phone ? `${over.phone}|2026-08` : '+393663515565|2026-08',
        phone: '+393663515565',
        email: 'mario.rossi@example.com',
        fullName: 'Mario Rossi',
        signedAt: new Date(Date.UTC(2026, 7, 1, 12)),
        monthKey: '2026-08',
        amountEur: 1390,
        paymentStatuses: ['Pagato'],
        tutor: 'Paolo S.',
        salesCode: 'Sales 004',
        sourceRows: [2],
        ...over,
    };
}

function crm(over: Partial<CrmClosure> = {}): CrmClosure {
    return {
        leadId: 'lead-1',
        phone: '+393663515565',
        email: 'mario.rossi@example.com',
        fullName: 'Mario Rossi',
        funnel: 'EVERGREEN',
        outcome: 'Chiuso',
        outcomeAt: new Date(Date.UTC(2026, 7, 1, 12)),
        amountEur: 1390,
        attemptsAmountEur: 1390,
        isRejected: false,
        salespersonAssigned: 'Sales 004',
        ...over,
    };
}

test('un contratto che coincide non produce differenze', () => {
    assert.deepEqual(reconcile([sheet()], [crm()]), []);
});

test('lead regolare con esito sbagliato → famiglia esito-mancante', () => {
    const d = reconcile([sheet()], [crm({ outcome: 'Non chiuso', amountEur: null, attemptsAmountEur: 0 })]);
    assert.equal(d.length, 1);
    assert.equal(d[0].family, 'esito-mancante');
    assert.equal(d[0].appliable, true);
});

test('lead scartato con contratto nel foglio → famiglia lead-scartato', () => {
    const d = reconcile([sheet()], [crm({ outcome: null, isRejected: true, amountEur: null, attemptsAmountEur: 0 })]);
    assert.equal(d[0].family, 'lead-scartato');
});

test('contratto senza alcun lead → famiglia lead-assente', () => {
    const d = reconcile([sheet()], []);
    assert.equal(d[0].family, 'lead-assente');
    assert.equal(d[0].crm, null);
});

test('importo divergente oltre la tolleranza → famiglia importo', () => {
    const d = reconcile([sheet({ amountEur: 1390 })], [crm({ amountEur: 1200, attemptsAmountEur: 1200 })]);
    assert.equal(d[0].family, 'importo');
    assert.equal(d[0].deltaEur, 190);
    assert.equal(d[0].note, null);
});

test('scarto da arrotondamento del foglio resta segnalato ma etichettato', () => {
    const d = reconcile([sheet({ amountEur: 2080 })], [crm({ amountEur: 2079, attemptsAmountEur: 2079 })]);
    assert.equal(d[0].family, 'importo');
    assert.equal(d[0].note, 'arrotondamento del foglio');
});

test('chiuso nel CRM ma assente dal foglio → famiglia solo-crm', () => {
    const d = reconcile([], [crm()]);
    assert.equal(d[0].family, 'solo-crm');
    assert.equal(d[0].sheet, null);
});

test('match sulla mail quando il telefono nel CRM è storpiato (caso Ludovici)', () => {
    const d = reconcile([sheet({ phone: '+393663515565' })], [crm({ phone: '+393663515575' })]);
    assert.deepEqual(d, []);
});

test('un tutor non mappato rende la riga non applicabile', () => {
    const d = reconcile([sheet({ tutor: 'Matteo D.', salesCode: null })], []);
    assert.equal(d[0].appliable, false);
    assert.match(d[0].blockedReason!, /Matteo D\./);
});

test('leads e salesAttempts in disaccordo emergono come differenza a sé', () => {
    const d = reconcile([sheet()], [crm({ amountEur: 1390, attemptsAmountEur: 2780 })]);
    assert.equal(d.length, 1);
    assert.match(d[0].blockedReason ?? '', /salesAttempts/);
});

test('le chiavi delle differenze sono stabili e uniche', () => {
    const d = reconcile([sheet({ phone: '+393331112222', key: '+393331112222|2026-08' }), sheet()], []);
    assert.equal(new Set(d.map(x => x.key)).size, 2);
});

test('stesso telefono in mesi diversi: due chiusure indipendenti, niente collasso', () => {
    // Stesso numero di telefono ma chiuso in due mesi diversi nel CRM.
    // Ogni mese nel foglio deve matchare solo il suo corrispondente CRM.
    const d = reconcile(
        [
            sheet({ monthKey: '2026-08' }),
            sheet({ monthKey: '2026-09', key: '+393663515565|2026-09', signedAt: new Date(Date.UTC(2026, 8, 1, 12)) }),
        ],
        [
            crm({ leadId: 'lead-08', outcomeAt: new Date(Date.UTC(2026, 7, 15, 12)) }),
            crm({ leadId: 'lead-09', outcomeAt: new Date(Date.UTC(2026, 8, 15, 12)) }),
        ]
    );
    // Non ci sono differenze: agosto foglio ← agosto CRM, settembre foglio ← settembre CRM.
    assert.deepEqual(d, []);
});

test('tutor non mappato con match perfetto CRM: blocca l\'applicazione anche se importo ok', () => {
    const d = reconcile(
        [sheet({ tutor: 'Matteo D.', salesCode: null })],
        [crm()]
    );
    assert.equal(d.length, 1);
    assert.equal(d[0].family, 'importo');
    assert.equal(d[0].deltaEur, 0);
    assert.equal(d[0].appliable, false);
    assert.match(d[0].blockedReason!, /Matteo D\./);
});

test('chiusura al limite di mese (00:30 Roma primo agosto): matcha il contratto agosto, non torna lead-assente', () => {
    // 2026-07-31T22:30:00Z è esattamente 2026-08-01T00:30:00+02:00 (00:30 Roma primo agosto).
    // Deve matchare il contratto agosto, non essere trattato come lead-assente.
    const d = reconcile(
        [sheet({ monthKey: '2026-08' })],
        [crm({ outcomeAt: new Date('2026-07-31T22:30:00Z') })]
    );
    assert.deepEqual(d, []);
});

test('chiusura dopo limite di mese (00:30 Roma primo settembre): NON matcha agosto', () => {
    // 2026-08-31T22:30:00Z è esattamente 2026-09-01T00:30:00+02:00 (00:30 Roma primo settembre).
    // Il contratto agosto NON deve matchare questa chiusura, che è in settembre.
    const d = reconcile(
        [sheet({ monthKey: '2026-08' })],
        [crm({ outcomeAt: new Date('2026-08-31T22:30:00Z') })]
    );
    // Due differenze: contratto agosto è lead-assente (no CRM match agosto),
    // chiusura settembre è solo-crm (no sheet match settembre).
    assert.equal(d.length, 2);
    const leadAssente = d.find(e => e.family === 'lead-assente');
    assert.ok(leadAssente);
    assert.equal(leadAssente!.sheet?.monthKey, '2026-08');
    const soloCrm = d.find(e => e.family === 'solo-crm');
    assert.ok(soloCrm);
});
