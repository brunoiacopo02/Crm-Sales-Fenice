import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Use Supabase Session Pooler (IPv4 compatible, faster cold starts)
const poolerUrl = "postgresql://postgres.ncutwzsifzundikwllxp:Infernape02.88I@aws-1-eu-west-1.pooler.supabase.com:5432/postgres";
const poolUrl = process.env.DATABASE_POOLER_URL || poolerUrl;

const pool = new Pool({
    connectionString: poolUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: {
        rejectUnauthorized: false
    }
});

export const db = drizzle(pool, { schema });
