import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Supabase Pro + IPv4 add-on
// Use POOLER (port 6543) for Vercel serverless — handles 200+ concurrent clients
// Use DIRECT (port 5432) only for migrations and local dev
const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;

const poolerUrl = process.env.DATABASE_POOLER_URL
    || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:6543/postgres?pgbouncer=true";

const directUrl = process.env.DATABASE_URL
    || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";

const dbUrl = isServerless ? poolerUrl : directUrl;

const pool = new Pool({
    connectionString: dbUrl,
    max: isServerless ? 5 : 15,
    idleTimeoutMillis: isServerless ? 10000 : 30000,
    connectionTimeoutMillis: 15000,
    allowExitOnIdle: true,
    ssl: {
        rejectUnauthorized: false
    }
});

export const db = drizzle(pool, { schema });
