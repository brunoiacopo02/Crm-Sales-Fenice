// Pool "Lead del lancio mai contattati dal bot" (PO 07/10/2026): i lead del
// lancio Web Dev a cui il bot non ha mai mandato il follow-up e che non gli
// hanno scritto dopo la live escono dal bot e vanno nel pool a parte di /import
// (leads.lancioPool = 'VERGINI', assignedToId null). Nel bot la chat si blocca
// (handed_off_reason 'lancio_pool_vergini', fase di prima in
// lancio_info.pool_vergini) finché il TL non la ridà al bot.
//
//   node scripts/lancio-vergini-pool.mjs          -> prova a vuoto
//   node scripts/lancio-vergini-pool.mjs --scrivi -> scrive
import 'dotenv/config';
import dotenv from 'dotenv';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SCRIVI = process.argv.includes('--scrivi');
const BOT_ENV = 'C:/Users/bruno/Desktop/Software Messaggistica/.env.local';
const LIVE_AT = '2026-10-05T19:00:00Z'; // 21:00 ora italiana
const MOTIVO = 'lancio_pool_vergini';
const FASI = ['attesa', 'posto_bloccato', 'link_inviato', 'post_pitch'];

const botEnv = dotenv.config({ path: BOT_ENV, processEnv: {} }).parsed;
const bot = createClient(botEnv.NEXT_PUBLIC_SUPABASE_URL, botEnv.SUPABASE_SERVICE_ROLE_KEY);

// 1. Le chat candidate nel bot (paginate: PostgREST torna 1000 righe al massimo).
let chat = [];
for (let da = 0; ; da += 1000) {
    const { data, error } = await bot
        .from('conversations')
        .select('id, crm_lead_id, lancio_fase, lancio_info')
        .not('lancio_slug', 'is', null)
        .is('lancio_followup_inviato_at', null)
        .is('bot_outcome', null)
        .is('handed_off_reason', null)
        .is('ai_paused_at', null)
        .in('lancio_fase', FASI)
        .not('crm_lead_id', 'is', null)
        .order('id')
        .range(da, da + 999);
    if (error) throw error;
    chat.push(...data);
    if (data.length < 1000) break;
}
// Fuori chi ha scritto dopo la live: sta parlando col bot.
const scritto = new Set();
for (let i = 0; i < chat.length; i += 200) {
    const ids = chat.slice(i, i + 200).map((c) => c.id);
    const { data, error } = await bot
        .from('messages').select('conversation_id')
        .in('conversation_id', ids).eq('direction', 'in').gt('created_at', LIVE_AT);
    if (error) throw error;
    for (const m of data) scritto.add(m.conversation_id);
}
chat = chat.filter((c) => !scritto.has(c.id));
console.log(`chat candidate nel bot: ${chat.length} (escluse ${scritto.size} che hanno scritto dopo la live)`);

// 2. CRM: dal bot al pool, solo se il lead e' ancora del bot e NEW.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
let spostati = [];
try {
    const { rows: utenti } = await client.query(`select id from users where "gdoCode" = 201`);
    const botId = utenti[0].id;
    const { rows: admin } = await client.query(
        `select id from users where role = 'ADMIN' and name = 'Admin Fenice' limit 1`);
    const leadIds = chat.map((c) => c.crm_lead_id);

    await client.query('begin');
    const now = new Date();
    const { rows } = await client.query(
        `update leads set "assignedToId" = null, "lancioPool" = 'VERGINI', "updatedAt" = $1, version = version + 1
         where id = any($2::text[]) and "assignedToId" = $3 and status = 'NEW'
           and "humanTestCohort" is null and "launchBucket" = 'LANCIO_WEBDEV_2026'
         returning id, "companyId"`,
        [now, leadIds, botId]);
    spostati = rows;
    const convDi = Object.fromEntries(chat.map((c) => [c.crm_lead_id, c.id]));
    for (let i = 0; i < rows.length; i += 500) {
        const blocco = rows.slice(i, i + 500);
        const valori = [];
        const params = [];
        blocco.forEach((r, j) => {
            const b = j * 6;
            valori.push(`($${b + 1}, $${b + 2}, 'LANCIO_VERGINI_POOL', $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
            params.push(crypto.randomUUID(), r.id, admin[0]?.id ?? null,
                JSON.stringify({ reason: MOTIVO, fromAssigneeId: botId, botConversationId: convDi[r.id] }),
                now, r.companyId);
        });
        await client.query(
            `insert into "leadEvents" (id, "leadId", "eventType", "userId", metadata, timestamp, "companyId")
             values ${valori.join(', ')}`, params);
    }
    console.log(`CRM: ${rows.length} lead spostati nel pool, ${leadIds.length - rows.length} saltati (non piu' del bot o non NEW)`);
    if (SCRIVI) { await client.query('commit'); console.log('CRM SCRITTO'); }
    else { await client.query('rollback'); console.log('prova a vuoto: niente scritto (usa --scrivi)'); }
} catch (e) {
    await client.query('rollback');
    throw e;
} finally {
    client.release();
    await pool.end();
}

// 3. Bot: blocco delle sole chat i cui lead sono davvero passati al pool.
if (SCRIVI) {
    const ok = new Set(spostati.map((r) => r.id));
    const adesso = new Date().toISOString();
    let bloccate = 0;
    for (const c of chat) {
        if (!ok.has(c.crm_lead_id)) continue;
        const { data, error } = await bot.from('conversations').update({
            handed_off_reason: MOTIVO,
            handed_off_at: adesso,
            ai_paused_at: adesso,
            ai_status: 'handed_off',
            lancio_fase: 'chiuso',
            lancio_info: { ...(c.lancio_info ?? {}), pool_vergini: { fase_prima: c.lancio_fase, at: adesso } },
        }).eq('id', c.id).is('handed_off_reason', null).select('id');
        if (error) throw error;
        bloccate += data.length;
    }
    await bot.from('event_log').insert({
        type: 'lancio_vergini_pool',
        payload: { bloccate, candidati: chat.length },
        message: `[lancio] ${bloccate} chat tolte al bot e messe nel pool "mai contattati" del CRM`,
        level: 'info',
    });
    console.log(`bot: ${bloccate} chat bloccate`);
}
