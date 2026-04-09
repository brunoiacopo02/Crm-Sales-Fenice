import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Direct connection to Supabase PostgreSQL (IPv4 add-on enabled, Pro plan)
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";

const pool = new Pool({
    connectionString: dbUrl,
    max: 15,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 15000,
    allowExitOnIdle: true,
    ssl: {
        rejectUnauthorized: false
    }
});

export const db = drizzle(pool, { schema });
