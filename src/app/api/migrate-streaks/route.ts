import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        console.log("Migrazione streak system...");

        // ADDITIVE migration: add streak fields to users table
        await db.execute(sql`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS "streakCount" INTEGER NOT NULL DEFAULT 0
        `);

        await db.execute(sql`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS "lastStreakDate" TEXT
        `);

        console.log("Migrazione streak system completata!");
        return NextResponse.json({ success: true, message: "Streak columns added to users table." });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Errore migrazione streak:", e);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
    }
}
