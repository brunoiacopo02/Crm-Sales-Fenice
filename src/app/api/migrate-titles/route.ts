import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        // ADDITIVE migration: add activeTitle column to users
        await db.execute(sql`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS "activeTitle" TEXT;
        `);

        return NextResponse.json({
            success: true,
            message: "Migration complete: activeTitle column added to users",
        });
    } catch (error) {
        console.error("Migration error:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
