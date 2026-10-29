import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadAssenteRow } from './leadAssente';

const sheet = {
    fullName: 'Marika Sainato',
    email: 'marika@example.com',
    signedAt: new Date(Date.UTC(2026, 9, 23, 12)),
    amountEur: 1074,
    salesCode: 'Sales 008',
};

test('il lead creato dalla riconciliazione porta il venditore (salespersonUserId)', () => {
    const row = buildLeadAssenteRow({ leadId: 'l1', companyId: 'fenice', phone: '3330000000', sheet, salesUserId: 'u-008' });
    assert.equal(row.salespersonUserId, 'u-008');
    assert.equal(row.salespersonAssigned, 'Sales 008');
    assert.equal(row.salespersonOutcome, 'Chiuso');
    assert.equal(row.closeAmountEur, 1074);
    assert.equal(row.salespersonOutcomeAt.toISOString(), '2026-10-23T12:00:00.000Z');
    assert.equal(row.funnel, 'FUORI FUNNEL');
});

test('non entra nel funnel GDO/Conferme: niente presenza, appuntamento, GDO o Conferme', () => {
    const row = buildLeadAssenteRow({ leadId: 'l1', companyId: 'fenice', phone: '3330000000', sheet, salesUserId: 'u-008' }) as Record<string, unknown>;
    for (const k of ['presentedAt', 'appointmentDate', 'assignedToId', 'confermeUserId', 'status', 'confirmationsOutcome']) {
        assert.equal(k in row, false, `${k} non deve essere scritto`);
    }
});
