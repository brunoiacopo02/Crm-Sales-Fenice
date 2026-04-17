import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(request: Request) {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins integer DEFAULT 0 NOT NULL`);

        return NextResponse.json({ success: true, message: "Colonna 'coins' aggiunta correttamente via Vercel Edge/Server." });
    } catch (e: any) {
        console.error("Errore migrazione:", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
