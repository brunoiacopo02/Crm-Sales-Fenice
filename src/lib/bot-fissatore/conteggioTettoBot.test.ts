import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import { sqlFreschiBotOggiPerTetto } from './conteggioTettoBot';
import { BLACK_FRIDAY_FUNNEL } from '@/lib/acIntake/blackFriday';
import { UTM_BROCHURE_PG, utmDaBrochure } from '@/lib/brochure/brochure';

const dialect = new PgDialect();

test('conteggio tetto bot: esclude i lead col funnel BLACK FRIDAY (PO 09/11/2026)', () => {
    const q = dialect.sqlToQuery(sqlFreschiBotOggiPerTetto(users.id, '2026-11-09', 'fenice'));
    assert.match(q.sql, /upper\(trim\(coalesce\(l\."funnel", ''\)\)\) <> \$\d/);
    assert.ok(q.params.includes(BLACK_FRIDAY_FUNNEL));
    assert.equal(BLACK_FRIDAY_FUNNEL, 'BLACK FRIDAY');
});

test('conteggio tetto bot: stesso perimetro di prima (bot, azienda, nati oggi a Roma)', () => {
    const q = dialect.sqlToQuery(sqlFreschiBotOggiPerTetto(users.id, '2026-11-09', 'fenice'));
    assert.match(q.sql, /l\."assignedToId" = "users"\."id"/);
    assert.match(q.sql, /l\."companyId" = \$\d/);
    assert.match(q.sql, /l\."createdAt" >= \(\$\d \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Europe\/Rome'/);
    assert.deepEqual(q.params, ['fenice', '2026-11-09', BLACK_FRIDAY_FUNNEL, UTM_BROCHURE_PG]);
});

test('conteggio tetto bot: si confronta col tetto dentro la WHERE del pool', () => {
    const q = dialect.sqlToQuery(sql`${sqlFreschiBotOggiPerTetto(users.id, '2026-11-09', 'fenice')} < ${70}`);
    assert.match(q.sql, /\) < \$5$/);
    assert.equal(q.params[4], 70);
});

test('conteggio tetto bot: esclude i lead della campagna brochure dagli utm, non dal funnel (PO 10/11/2026)', () => {
    const q = dialect.sqlToQuery(sqlFreschiBotOggiPerTetto(users.id, '2026-11-10', 'fenice'));
    assert.match(q.sql, /concat_ws\(' ', l\."utmSource", l\."utmMedium", l\."utmCampaign", l\."utmContent", l\."utmTerm"\) !~\* \$\d/);
    assert.ok(q.params.includes(UTM_BROCHURE_PG));
    // Il funnel PROFESSIONI non compare: il criterio sono gli utm della campagna pdf.
    assert.doesNotMatch(q.sql, /PROFESSIONI/);
    assert.ok(!q.params.includes('PROFESSIONI'));
});

test('regola utm brochure: la stessa in JS e in Postgres', () => {
    assert.equal(utmDaBrochure(['Campagna di Ret - pdf']), true);
    assert.equal(utmDaBrochure(['brochure-gratuita']), true);
    assert.equal(utmDaBrochure(['|CBO| - Corso 10h - Andromeda - Scaling', 'Video 1  smm']), false);
    assert.equal(utmDaBrochure(['pdfx', 'webpdf']), false);
    assert.equal(utmDaBrochure([null, undefined]), false);
});
