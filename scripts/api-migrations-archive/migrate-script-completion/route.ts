import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    try {
        await db.execute(sql`
            ALTER TABLE "callLogs"
            ADD COLUMN IF NOT EXISTS "scriptCompleted" BOOLEAN DEFAULT false
        `);

        return NextResponse.json({
            success: true,
            message: "Migration completed: added scriptCompleted column to callLogs"
        });
    } catch (e: any) {
        console.error("Errore migrazione script-completion:", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
