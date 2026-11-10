import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLeadBrochureAc, professioneDaUtmContent, BROCHURE_FUNNEL } from './brochure';

test('la campagna "Campagna di Ret - pdf" e\' brochure, anche con Provenienza TELEGRAM', () => {
    assert.equal(isLeadBrochureAc({ utmCampaign: 'Campagna di Ret - pdf', utmContent: 'Video 2 generale' }), true);
    assert.equal(isLeadBrochureAc({ utmCampaign: 'Brochure gratuita' }), true);
    assert.equal(BROCHURE_FUNNEL, 'PROFESSIONI');
});

test('gli altri lead restano fuori ("pdf" solo come parola)', () => {
    assert.equal(isLeadBrochureAc({ utmCampaign: '|CBO| - Corso 10h - Andromeda - Scaling' }), false);
    assert.equal(isLeadBrochureAc({ utmCampaign: 'pdfx', utmContent: 'updfate' }), false);
    assert.equal(isLeadBrochureAc({}), false);
});

test('utm_content della campagna: smm → social_media_manager, generale → nessun corso', () => {
    assert.equal(professioneDaUtmContent('Video 1  smm'), 'social_media_manager');
    assert.equal(professioneDaUtmContent('Video 2 generale'), null);
    assert.equal(professioneDaUtmContent(null), null);
    assert.equal(professioneDaUtmContent('Video 3 Video Editor'), 'video_editor');
    assert.equal(professioneDaUtmContent('copy-writer v1'), 'copywriter');
    assert.equal(professioneDaUtmContent('Social Media Manager'), 'social_media_manager');
});
