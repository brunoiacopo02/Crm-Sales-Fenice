// Gruppo di prova "solo umani" (PO 06/10/2026): i 400 lead del lancio Web Dev
// che il bot ha gia' bloccato (conversations.handed_off_reason='gdo_umani_lancio',
// GDO scelto in lancio_info.gdo_umani.gdo) passano nel CRM dal bot 201 ai GDO
// 106 e 119, col segno humanTestCohort. Una sola transazione.
//
//   node scripts/lancio-umani-assegna.mjs          -> prova a vuoto
//   node scripts/lancio-umani-assegna.mjs --scrivi -> scrive
import 'dotenv/config';
import dotenv from 'dotenv';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SCRIVI = process.argv.includes('--scrivi');
const COHORT = 'LANCIO_UMANI_20261007';
const BOT_ENV = 'C:/Users/bruno/Desktop/Software Messaggistica/.env.local';

const botEnv = dotenv.config({ path: BOT_ENV, processEnv: {} }).parsed;
const bot = createClient(botEnv.NEXT_PUBLIC_SUPABASE_URL, botEnv.SUPABASE_SERVICE_ROLE_KEY);

const { data: chat, error } = await bot
    .from('conversations')
    .select('id, crm_lead_id, lancio_info')
    .eq('handed_off_reason', 'gdo_umani_lancio');
if (error) throw error;
const righe = chat.map((c) => ({
    conv: c.id,
    leadId: c.crm_lead_id,
    gdo: Number(c.lancio_info?.gdo_umani?.gdo),
    rank: Number(c.lancio_info?.gdo_umani?.rank),
    zoomMinuti: Number(c.lancio_info?.zoom_minuti),
}));
console.log(`chat bloccate nel bot: ${righe.length}`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
try {
    const { rows: utenti } = await client.query(
        `select id, "gdoCode" from users where "gdoCode" in (106, 119, 201)`);
    const idDi = Object.fromEntries(utenti.map((u) => [u.gdoCode, u.id]));
    const { rows: admin } = await client.query(
        `select id from users where role = 'ADMIN' and name = 'Admin Fenice' limit 1`);

    await client.query('begin');
    const now = new Date();
    const spostati = { 106: 0, 119: 0 };
    const saltati = [];
    for (const r of righe) {
        const verso = idDi[r.gdo];
        if (!verso) { saltati.push({ ...r, motivo: 'gdo_sconosciuto' }); continue; }
        const { rows } = await client.query(
            `update leads set "assignedToId" = $1,
                 "assignedAt" = coalesce("assignedAt", $2),
                 "humanTestCohort" = $3, "updatedAt" = $2, version = version + 1
             where id = $4 and "assignedToId" = $5 and status = 'NEW' and "humanTestCohort" is null
             returning id`,
            [verso, now, COHORT, r.leadId, idDi[201]]);
        if (rows.length === 0) {
            const { rows: stato } = await client.query(
                `select status, "assignedToId" from leads where id = $1`, [r.leadId]);
            saltati.push({ ...r, motivo: 'non_piu_del_bot_o_non_new', stato: stato[0] ?? null });
            continue;
        }
        spostati[r.gdo]++;
        await client.query(
            `insert into "leadEvents" (id, "leadId", "eventType", "userId", "fromSection", "toSection", metadata, timestamp)
             values ($1, $2, 'REASSIGNED_ADMIN', $3, 'Lancio Web Dev (bot)', 'Test lancio umani', $4, $5)`,
            [crypto.randomUUID(), r.leadId, admin[0]?.id ?? null, JSON.stringify({
                reason: 'lancio_test_umani', cohort: COHORT,
                fromAssigneeId: idDi[201], toAssigneeId: verso,
                botConversationId: r.conv, rank: r.rank, zoomMinuti: r.zoomMinuti,
            }), now]);
    }
    for (const gdo of [106, 119]) {
        if (spostati[gdo] === 0) continue;
        await client.query(
            `insert into notifications (id, "recipientUserId", type, title, body, metadata, status, "createdAt")
             values ($1, $2, 'lead_assignment', 'Nuovi lead del lancio', $3, $4, 'unread', $5)`,
            [crypto.randomUUID(), idDi[gdo],
             `Hai ricevuto ${spostati[gdo]} lead del lancio Web Developer AI: hanno visto la live e li segui solo tu. Li trovi anche in "Test lancio umani".`,
             JSON.stringify({ source: 'lancio_test_umani', cohort: COHORT, count: spostati[gdo] }), now]);
    }
    console.log('spostati:', spostati, 'saltati:', saltati.length);
    for (const s of saltati) console.log('  saltato', s);
    if (SCRIVI) { await client.query('commit'); console.log('SCRITTO'); }
    else { await client.query('rollback'); console.log('prova a vuoto: niente scritto (usa --scrivi)'); }
} catch (e) {
    await client.query('rollback');
    throw e;
} finally {
    client.release();
    await pool.end();
}
