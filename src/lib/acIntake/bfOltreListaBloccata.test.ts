import test from 'node:test';
import assert from 'node:assert/strict';
import { bfOltreListaBloccata, type BfOltreBloccoInput } from './bfOltreListaBloccata';
import { isLeadBlackFridayAc } from './blackFriday';

const HARD = new Set(['137']);
const BF = new Set(['136']);

const base = (x: Partial<BfOltreBloccoInput> = {}): BfOltreBloccoInput => ({
    eventType: 'subscribe',
    triggerListId: '136',
    listaBloccata: '137',
    listeBloccateSenzaEccezioni: HARD,
    listeBlackFriday: BF,
    listeAttive: new Set(['136', '137']),
    segnoBfNeiCampi: true,
    ...x,
});

test('iscrizione vera dalla landing BF (subscribe lista 136, utm LancioBlackFriday2026): passa', () => {
    assert.deepEqual(bfOltreListaBloccata(base()), { passa: true });
});

test('contatto gia noto che compila la landing (update, lista 0, iscritto alla 136, segno BF): passa', () => {
    assert.deepEqual(bfOltreListaBloccata(base({ eventType: 'update', triggerListId: '0' })), { passa: true });
});

test('retry manuale da /lead-automatici (subscribe senza lista, iscritto alla 136, segno BF): passa', () => {
    assert.deepEqual(bfOltreListaBloccata(base({ triggerListId: null })), { passa: true });
});

test('caricamento di massa: subscribe dalla 137 resta fuori anche col segno BF e la 136', () => {
    assert.deepEqual(
        bfOltreListaBloccata(base({ triggerListId: '137' })),
        { passa: false, motivo: 'evento_dalla_lista_bloccata' },
    );
});

test('caricamento di massa tipico: subscribe 137, niente 136, utm vuoti: fuori', () => {
    const r = bfOltreListaBloccata(base({ triggerListId: '137', listeAttive: new Set(['18', '33', '137']), segnoBfNeiCampi: false }));
    assert.equal(r.passa, false);
});

test('contatto della 137 aggiornato ma NON nella lista BF: fuori', () => {
    assert.deepEqual(
        bfOltreListaBloccata(base({ eventType: 'update', triggerListId: '0', listeAttive: new Set(['137', '7']) })),
        { passa: false, motivo: 'non_in_lista_bf' },
    );
});

test('nella lista BF ma senza il segno BF nei campi (es. aggiunto in blocco alla 136): fuori', () => {
    assert.deepEqual(
        bfOltreListaBloccata(base({ segnoBfNeiCampi: false })),
        { passa: false, motivo: 'senza_segno_bf' },
    );
});

test('lista BF non risolvibile su AC: fuori (si chiude, non si apre)', () => {
    assert.deepEqual(bfOltreListaBloccata(base({ listeBlackFriday: null })), { passa: false, motivo: 'lista_bf_sconosciuta' });
    assert.deepEqual(bfOltreListaBloccata(base({ listeBlackFriday: new Set() })), { passa: false, motivo: 'lista_bf_sconosciuta' });
});

test('unsubscribe o altri eventi: mai', () => {
    assert.deepEqual(bfOltreListaBloccata(base({ eventType: 'unsubscribe' })), { passa: false, motivo: 'evento' });
    assert.deepEqual(bfOltreListaBloccata(base({ eventType: 'bounce' })), { passa: false, motivo: 'evento' });
});

test('il segno BF si legge dagli utm veri dei 30 scartati (landing e inserzione Meta)', () => {
    assert.equal(isLeadBlackFridayAc({ utmSource: 'ActiveCampaign', utmMedium: 'LancioBlackFriday2026', utmCampaign: 'email1' }), true);
    assert.equal(isLeadBlackFridayAc({ utmSource: 'Meta', utmMedium: 'Paid', utmCampaign: '|CBO| Black Friday - Test Creative - LEAD' }), true);
    // Un contatto del caricamento di massa: utm vecchi o vuoti, Provenienza di un altro funnel.
    assert.equal(isLeadBlackFridayAc({ provenienza: 'JOB SIMULATOR', utmSource: '', utmMedium: '', utmCampaign: '' }), false);
    assert.equal(isLeadBlackFridayAc({ provenienza: 'ORG', utmSource: 'bioorg', utmMedium: 'Lanciosmm', utmCampaign: 'instagram' }), false);
});
