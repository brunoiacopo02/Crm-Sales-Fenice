// PO 07/10/2026: i lead del lancio che il bot ha restituito al pool SENZA mai
// mandare il follow-up, e che nessun GDO ha ancora chiamato, passano dal pool dei
// ridati al pool "mai contattati dal bot" (lancioPool = 'VERGINI'). Nel bot la
// chat si marca come quelle del pool, così il TL può ridarli al bot.
//
//   node scripts/lancio-restituiti-a-vergini.mjs          -> prova a vuoto
//   node scripts/lancio-restituiti-a-vergini.mjs --scrivi -> scrive
import 'dotenv/config';
import dotenv from 'dotenv';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SCRIVI = process.argv.includes('--scrivi');
const MOTIVO = 'lancio_pool_vergini';
const botEnv = dotenv.config({ path: 'C:/Users/bruno/Desktop/Software Messaggistica/.env.local', processEnv: {} }).parsed;
const bot = createClient(botEnv.NEXT_PUBLIC_SUPABASE_URL, botEnv.SUPABASE_SERVICE_ROLE_KEY);

// 1. Nel bot: le chat del lancio restituite senza follow-up.
let chat = [];
for (let da = 0; ; da += 1000) {
    const { data, error } = await bot.from('conversations')
        .select('id, crm_lead_id, lancio_info, handed_off_reason')
        .not('lancio_slug', 'is', null).is('lancio_followup_inviato_at', null)
        .eq('lancio_fase', 'restituito').not('crm_lead_id', 'is', null)
        .order('id').range(da, da + 999);
    if (error) throw error;
    chat.push(...data);
    if (data.length < 1000) break;
}
chat = chat.filter((c) => !(c.handed_off_reason ?? '').startsWith('gdo_umani'));
console.log(`chat restituite senza follow-up: ${chat.length}`);

// 2. Nel CRM: solo se nel pool dei ridati, NEW, mai chiamati da un GDO.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
let spostati = [];
try {
    await client.query('begin');
    const now = new Date();
    const { rows } = await client.query(
        `update leads l set "lancioPool" = 'VERGINI', "updatedAt" = $1, version = version + 1
         where l.id = any($2::text[]) and l."assignedToId" is null and l.status = 'NEW'
           and l."lancioPool" is null and l."humanTestCohort" is null and l."launchBucket" = 'LANCIO_WEBDEV_2026'
           and not exists (select 1 from "callLogs" c join users u on u.id = c."userId"
                           where c."leadId" = l.id and u."isBot" = false)
         returning l.id, l."companyId"`,
        [now, chat.map((c) => c.crm_lead_id)]);
    spostati = rows;
    for (let i = 0; i < rows.length; i += 500) {
        const blocco = rows.slice(i, i + 500);
        const valori = [], params = [];
        blocco.forEach((r, j) => {
            const b = j * 5;
            valori.push(`($${b + 1}, $${b + 2}, 'LANCIO_VERGINI_POOL', null, $${b + 3}, $${b + 4}, $${b + 5})`);
            params.push(crypto.randomUUID(), r.id, JSON.stringify({ reason: MOTIVO, da: 'pool_ridati_senza_followup' }), now, r.companyId);
        });
        await client.query(`insert into "leadEvents" (id, "leadId", "eventType", "userId", metadata, timestamp, "companyId") values ${valori.join(', ')}`, params);
    }
    console.log(`CRM: ${rows.length} passano al pool "mai contattati", ${chat.length - rows.length} restano dove sono (assegnati, chiamati o chiusi)`);
    if (SCRIVI) { await client.query('commit'); console.log('CRM SCRITTO'); }
    else { await client.query('rollback'); console.log('prova a vuoto (usa --scrivi)'); }
} catch (e) { await client.query('rollback'); throw e; }
finally { client.release(); await pool.end(); }

// 3. Nel bot: la chat si marca come quelle del pool (ripartirà da 'attesa').
if (SCRIVI) {
    const ok = new Set(spostati.map((r) => r.id));
    const adesso = new Date().toISOString();
    let marcate = 0;
    for (const c of chat) {
        if (!ok.has(c.crm_lead_id)) continue;
        const { data, error } = await bot.from('conversations').update({
            handed_off_reason: MOTIVO, handed_off_at: adesso, ai_paused_at: adesso, ai_status: 'handed_off',
            lancio_fase: 'chiuso',
            lancio_info: { ...(c.lancio_info ?? {}), pool_vergini: { fase_prima: 'attesa', at: adesso, da: 'restituito' } },
        }).eq('id', c.id).eq('lancio_fase', 'restituito').select('id');
        if (error) throw error;
        marcate += data.length;
    }
    console.log(`bot: ${marcate} chat marcate`);
}
