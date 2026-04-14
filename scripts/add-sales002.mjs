import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const EMAIL = 'sales002@fenice.com';
const NAME = 'Sales 002';
const PASSWORD = 'Venditore2026!';
const ROLE = 'VENDITORE';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRole) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabaseAdmin = createClient(supabaseUrl, serviceRole);

const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  // Abort if already in public.users
  const existing = await pool.query(`SELECT id, email, role FROM users WHERE email = $1`, [EMAIL]);
  if (existing.rows.length > 0) {
    console.log(`⚠️  ${EMAIL} già presente in public.users:`, existing.rows[0]);
    process.exit(0);
  }

  // 1) Create in Supabase Auth
  let userId;
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role: ROLE, name: NAME },
  });

  if (authError) {
    if (authError.message?.includes('already been registered')) {
      // Auth user exists but DB record missing — recover the id
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const found = list?.users?.find(u => u.email === EMAIL);
      if (!found) {
        console.error('Auth dice che esiste ma non lo trovo in listUsers. Abort.');
        process.exit(1);
      }
      userId = found.id;
      console.log(`Auth: ${EMAIL} già esistente (id=${userId}). Aggiorno password + metadata e procedo con insert in public.users.`);
      // Ensure password + metadata are consistent
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: PASSWORD,
        user_metadata: { role: ROLE, name: NAME },
      });
    } else {
      console.error('Errore Auth:', authError.message);
      process.exit(1);
    }
  } else {
    userId = authData.user.id;
    console.log(`✅ Auth creato: ${EMAIL} (id=${userId})`);
  }

  // 2) Insert into public.users
  const hashed = await bcrypt.hash(PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (id, name, email, password, role, "displayName", "isActive", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, true, NOW())`,
    [userId, NAME, EMAIL, hashed, ROLE, NAME]
  );
  console.log(`✅ public.users: ${EMAIL} inserito con ruolo ${ROLE}`);

  // 3) Verify
  const check = await pool.query(
    `SELECT id, email, name, "displayName", role, "isActive", "walletCoins", level FROM users WHERE id = $1`,
    [userId]
  );
  console.log('\nRecord finale:');
  console.log(check.rows[0]);
  console.log(`\nCredenziali: ${EMAIL} / ${PASSWORD}`);
} catch (e) {
  console.error('Errore:', e.message || e);
  process.exit(1);
} finally {
  await pool.end();
}
