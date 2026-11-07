import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLeadBlackFridayAc, BLACK_FRIDAY_FUNNEL } from './blackFriday';

test('la campagna delle inserzioni Black Friday basta, anche con Provenienza TELEGRAM', () => {
    assert.equal(isLeadBlackFridayAc({ provenienza: 'TELEGRAM', utmCampaign: '|CBO| Black Friday - Test Creative - LEAD' }), true);
});

test('Provenienza vuota + campagna Black Friday (caso Giovanna 07/11)', () => {
    assert.equal(isLeadBlackFridayAc({ provenienza: '', utmCampaign: '|CBO| Black Friday - Test Creative - LEAD' }), true);
});

test('varianti di scrittura', () => {
    for (const c of ['BLACK FRIDAY', 'black-friday', 'BlackFriday nov', 'Blak Friday']) {
        assert.equal(isLeadBlackFridayAc({ utmCampaign: c }), true, c);
    }
});

test('lista AC Black Friday dal payload o dalle membership', () => {
    const ids = new Set(['140']);
    assert.equal(isLeadBlackFridayAc({ blackFridayListIds: ids, triggerListId: '140' }), true);
    assert.equal(isLeadBlackFridayAc({ blackFridayListIds: ids, activeListIds: new Set(['7', '140']) }), true);
    assert.equal(isLeadBlackFridayAc({ blackFridayListIds: ids, triggerListId: '7', activeListIds: new Set(['7']) }), false);
});

test('gli altri funnel restano fuori', () => {
    assert.equal(isLeadBlackFridayAc({ provenienza: 'CORSO 10 ORE', utmCampaign: '|CBO| - Corso 10h - Andromeda - Scaling' }), false);
    assert.equal(isLeadBlackFridayAc({ provenienza: 'TELEGRAM', utmCampaign: null, blackFridayListIds: null }), false);
    assert.equal(isLeadBlackFridayAc({}), false);
});

test('nome del funnel allineato a Panoramica e al bot', () => {
    assert.equal(BLACK_FRIDAY_FUNNEL, 'BLACK FRIDAY');
});
