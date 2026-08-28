import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildLeadRejected, deterministicEventId } from './payload-builders';
import type { LeadRejectedData } from './types';

// Lead minimo: il builder legge solo i campi qui sotto. Il cast tiene il test
// puro senza dover costruire tutte le ~90 colonne della tabella leads.
function fakeLead(over: Record<string, unknown> = {}) {
    return {
        id: 'lead-1',
        name: 'Mario Rossi',
        email: 'mario@example.com',
        phone: '+393331234567',
        funnel: 'Black Summer',
        source: 'activecampaign',
        createdAt: new Date('2026-08-20T09:14:00Z'),
        utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'bs-agosto',
        utmContent: null, utmTerm: null,
        callCount: 2,
        discardReason: 'non ha soldi',
        confirmationsDiscardReason: null,
        ...over,
    } as never;
}

const ACTOR = { id: 'u-1', displayName: 'GDO 106', name: 'GDO 106', role: 'GDO' } as never;
const AT = new Date('2026-08-24T13:12:00Z');

describe('buildLeadRejected', () => {
    test('scarto GDO a mano: legge la causale da discardReason', () => {
        const env = buildLeadRejected({
            lead: fakeLead(), actor: ACTOR, occurredAt: AT,
            stage: 'GDO', automatic: false, byBot: false,
        });
        const data = env.data as LeadRejectedData;

        assert.strictEqual(env.eventType, 'lead.rejected');
        assert.strictEqual(env.apiVersion, '1');
        assert.strictEqual(data.stage, 'GDO');
        assert.strictEqual(data.automatic, false);
        assert.strictEqual(data.byBot, false);
        assert.strictEqual(data.reasonCode, 'NO_BUDGET');
        assert.strictEqual(data.rawReason, 'non ha soldi');
        assert.strictEqual(data.callCount, 2);
        assert.strictEqual(data.rejectedAt, '2026-08-24T13:12:00.000Z');
        assert.deepStrictEqual(data.rejectedBy, {
            userId: 'u-1', displayName: 'GDO 106', role: 'GDO',
        });
    });

    test('scarto Conferme: legge la causale da confirmationsDiscardReason', () => {
        const env = buildLeadRejected({
            lead: fakeLead({
                discardReason: 'non interessato',              // campo GDO: da ignorare
                confirmationsDiscardReason: 'attaccato in faccia',
            }),
            actor: ACTOR, occurredAt: AT,
            stage: 'CONFERME', automatic: false, byBot: false,
        });
        const data = env.data as LeadRejectedData;

        assert.strictEqual(data.stage, 'CONFERME');
        assert.strictEqual(data.reasonCode, 'HUNG_UP');
        assert.strictEqual(data.rawReason, 'attaccato in faccia');
        assert.strictEqual(data.reasonLabel, 'Attaccato in faccia');
    });

    test('auto-scarto: automatic true e nessun operatore', () => {
        const env = buildLeadRejected({
            lead: fakeLead({ discardReason: 'irreperibile (3 tentativi vuoti)', callCount: 3 }),
            actor: null, occurredAt: AT,
            stage: 'GDO', automatic: true, byBot: false,
        });
        const data = env.data as LeadRejectedData;

        assert.strictEqual(data.automatic, true);
        assert.strictEqual(data.reasonCode, 'UNREACHABLE');
        assert.strictEqual(data.rejectedBy, null);
    });

    test('scarto del bot: byBot true', () => {
        const env = buildLeadRejected({
            lead: fakeLead(), actor: ACTOR, occurredAt: AT,
            stage: 'GDO', automatic: false, byBot: true,
        });
        assert.strictEqual((env.data as LeadRejectedData).byBot, true);
    });

    test('una causale mai vista non fa esplodere il builder', () => {
        const env = buildLeadRejected({
            lead: fakeLead({ discardReason: 'motivo inventato domani' }),
            actor: ACTOR, occurredAt: AT,
            stage: 'GDO', automatic: false, byBot: false,
        });
        const data = env.data as LeadRejectedData;
        assert.strictEqual(data.reasonCode, 'OTHER');
        assert.strictEqual(data.rawReason, 'motivo inventato domani');
    });

    test('porta anagrafica e UTM come gli altri eventi', () => {
        const env = buildLeadRejected({
            lead: fakeLead(), actor: ACTOR, occurredAt: AT,
            stage: 'GDO', automatic: false, byBot: false,
        });
        assert.strictEqual(env.lead.id, 'lead-1');
        assert.strictEqual(env.lead.phone, '+393331234567');
        assert.strictEqual(env.lead.utm.campaign, 'bs-agosto');
    });
});

describe('deterministicEventId per lead.rejected', () => {
    test('lo stesso scarto rimandato produce lo stesso id', () => {
        const a = deterministicEventId('lead.rejected', 'lead-1', AT);
        const b = deterministicEventId('lead.rejected', 'lead-1', new Date(AT));
        assert.strictEqual(a, b);
    });

    test('due scarti dello stesso giorno a secondi diversi sono eventi diversi', () => {
        // Granularita' al secondo, non al giorno: un lead riaperto e riscartato
        // lo stesso giorno e' un fatto nuovo e deve propagarsi.
        const a = deterministicEventId('lead.rejected', 'lead-1', new Date('2026-08-24T13:12:00Z'));
        const b = deterministicEventId('lead.rejected', 'lead-1', new Date('2026-08-24T18:40:00Z'));
        assert.notStrictEqual(a, b);
    });

    test('lead diversi non collidono', () => {
        const a = deterministicEventId('lead.rejected', 'lead-1', AT);
        const b = deterministicEventId('lead.rejected', 'lead-2', AT);
        assert.notStrictEqual(a, b);
    });
});
