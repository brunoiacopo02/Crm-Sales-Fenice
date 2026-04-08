import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Direct connection to Supabase PostgreSQL (IPv4 add-on enabled, Pro plan)
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";

const pool = new Pool({
    connectionString: dbUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: {
        rejectUnauthorized: false
    }
});

export const db = drizzle(pool, { schema });
