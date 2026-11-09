import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLeadBlackFridayAc, BLACK_FRIDAY_FUNNEL, segniBlackFridayDaCampi, decidiConversioneBf } from './blackFriday';

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

test('utm della landing BF nel medium (PO 09/11: Abiuso, Bossola, Ferrero)', () => {
    // Telegram|BlackFriday|TelegramBF1 e Email|LancioBlackFriday2026|email1
    assert.equal(isLeadBlackFridayAc({ utmSource: 'Telegram', utmMedium: 'BlackFriday', utmCampaign: 'TelegramBF1' }), true);
    assert.equal(isLeadBlackFridayAc({ utmSource: 'Email', utmMedium: 'LancioBlackFriday2026', utmCampaign: 'email1' }), true);
    assert.equal(isLeadBlackFridayAc({ utmCampaign: 'lancio_black_friday' }), true);
    assert.equal(isLeadBlackFridayAc({ provenienza: 'TELEGRAM', utmSource: 'Facebook', utmMedium: 'Paid', utmCampaign: 'Cbo - Telegram - Scaling' }), false);
});

test('pagina o landing_url "blackfriday2026" in un campo AC', () => {
    assert.equal(isLeadBlackFridayAc({ altriCampi: ['https://lp.feniceacademy.it/blackfriday2026?utm_source=bioorg'] }), true);
    assert.equal(isLeadBlackFridayAc({ altriCampi: ['blackfriday2026'] }), true);
    assert.equal(isLeadBlackFridayAc({ altriCampi: ['https://lp.feniceacademy.it/corso10ore', 'Libero Professionista'] }), false);
});

test('segniBlackFridayDaCampi legge i 5 utm e gli altri campi', () => {
    const s = segniBlackFridayDaCampi([
        { field: '2', value: 'JOB SIMULATOR' },
        { field: '32', value: 'LancioBlackFriday2026' },
        { field: '33', value: 'email1' },
        { field: '40', value: 'https://lp.feniceacademy.it/blackfriday2026' },
        { field: '41', value: null },
    ]);
    assert.equal(s.utmMedium, 'LancioBlackFriday2026');
    assert.equal(s.utmCampaign, 'email1');
    assert.equal(s.utmSource, null);
    assert.equal(s.altriCampi.length, 4);
    assert.equal(isLeadBlackFridayAc({ provenienza: 'JOB SIMULATOR', ...s }), true);
    assert.deepEqual(segniBlackFridayDaCampi(undefined).altriCampi, []);
});

const ADESSO = new Date('2026-11-09T17:00:00Z');
const base = {
    funnel: 'TELEGRAM', status: 'NEW', appointmentDate: null, callCount: 0, lastCallDate: null, assegnatoAlBot: false,
};

test('conversione BF: lead aperto mai chiamato di un GDO -> al bot (Abiuso, Bossola)', () => {
    assert.equal(decidiConversioneBf(base, ADESSO), 'al_bot');
    assert.equal(decidiConversioneBf({ ...base, status: 'IN_PROGRESS' }, ADESSO), 'al_bot');
});

test('conversione BF: appuntamento del bot -> push al bot, appuntamento intatto (Luciani)', () => {
    assert.equal(decidiConversioneBf({ ...base, funnel: 'JOB SIMULATOR', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-10T18:00:00Z'), callCount: 1, lastCallDate: new Date('2026-11-09T09:50:00Z'), assegnatoAlBot: true }, ADESSO), 'push_bot');
    assert.equal(decidiConversioneBf({ ...base, assegnatoAlBot: true }, ADESSO), 'push_bot');
});

test('conversione BF: lavoro di un GDO (appuntamento, chiamato da poco) o chiuso -> solo funnel', () => {
    assert.equal(decidiConversioneBf({ ...base, status: 'APPOINTMENT', appointmentDate: '2026-11-10T18:00:00Z' }, ADESSO), 'solo_funnel');
    assert.equal(decidiConversioneBf({ ...base, callCount: 1, lastCallDate: new Date('2026-11-09T15:00:00Z') }, ADESSO), 'solo_funnel');
    assert.equal(decidiConversioneBf({ ...base, status: 'REJECTED' }, ADESSO), 'solo_funnel');
    assert.equal(decidiConversioneBf({ ...base, status: 'REJECTED', assegnatoAlBot: true }, ADESSO), 'solo_funnel');
});

test('conversione BF: agenda appena mandata dal GDO -> solo funnel (Abiuso 09/11)', () => {
    assert.equal(decidiConversioneBf({ ...base, agendaSentAt: new Date('2026-11-09T16:21:13Z') }, ADESSO), 'solo_funnel');
    assert.equal(decidiConversioneBf({ ...base, agendaSentAt: new Date('2026-11-01T16:21:13Z') }, ADESSO), 'al_bot');
});

test('conversione BF: chiamate vecchie non fermano il passaggio al bot', () => {
    assert.equal(decidiConversioneBf({ ...base, callCount: 2, lastCallDate: new Date('2026-10-22T16:49:00Z') }, ADESSO), 'al_bot');
});

test('conversione BF: gia BLACK FRIDAY -> niente', () => {
    assert.equal(decidiConversioneBf({ ...base, funnel: 'BLACK FRIDAY' }, ADESSO), 'gia_bf');
    assert.equal(decidiConversioneBf({ ...base, funnel: 'black friday ' }, ADESSO), 'gia_bf');
});

test('nome del funnel allineato a Panoramica e al bot', () => {
    assert.equal(BLACK_FRIDAY_FUNNEL, 'BLACK FRIDAY');
});
