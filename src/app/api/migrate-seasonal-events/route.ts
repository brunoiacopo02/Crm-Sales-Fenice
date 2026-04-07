import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export async function GET() {
    try {
        // Create seasonalEvents table (ADDITIVE)
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "seasonalEvents" (
                "id" text PRIMARY KEY,
                "title" text NOT NULL,
                "description" text NOT NULL,
                "theme" text NOT NULL,
                "startDate" timestamp with time zone NOT NULL,
                "endDate" timestamp with time zone NOT NULL,
                "xpMultiplier" real NOT NULL DEFAULT 1,
                "coinsMultiplier" real NOT NULL DEFAULT 1,
                "isActive" boolean NOT NULL DEFAULT true,
                "createdBy" text REFERENCES "users"("id"),
                "createdAt" timestamp with time zone NOT NULL DEFAULT now()
            )
        `);

        // Index for quick lookup of active events
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "seasonal_events_active_idx" ON "seasonalEvents" ("isActive")
        `);

        return NextResponse.json({ success: true, message: 'Seasonal events table created successfully' });
    } catch (error: any) {
        console.error('Migration error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
