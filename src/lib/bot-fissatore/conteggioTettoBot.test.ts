import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import { sqlFreschiBotOggiPerTetto } from './conteggioTettoBot';
import { BLACK_FRIDAY_FUNNEL } from '@/lib/acIntake/blackFriday';

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
    assert.deepEqual(q.params, ['fenice', '2026-11-09', BLACK_FRIDAY_FUNNEL]);
});

test('conteggio tetto bot: si confronta col tetto dentro la WHERE del pool', () => {
    const q = dialect.sqlToQuery(sql`${sqlFreschiBotOggiPerTetto(users.id, '2026-11-09', 'fenice')} < ${70}`);
    assert.match(q.sql, /\) < \$4$/);
    assert.equal(q.params[3], 70);
});
