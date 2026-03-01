import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const poolUrl = process.env.DATABASE_URL?.split('?')[0] || process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: poolUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: {
        rejectUnauthorized: false
    }
});

export const db = drizzle(pool, { schema });
