import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "manualAdjustments" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL,
                type TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 1,
                note TEXT,
                "addedByUserId" TEXT NOT NULL,
                "createdAt" TIMESTAMPTZ DEFAULT NOW() NOT NULL
            )
        `);
        return NextResponse.json({ success: true, message: "manualAdjustments table created" });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
}
