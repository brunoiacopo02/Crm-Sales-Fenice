import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(request: Request) {
    try {
        console.log("Inizia migrazione Vercel-side...");
        await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins integer DEFAULT 0 NOT NULL`);
        console.log("Colonna coins aggiunta con successo!");

        return NextResponse.json({ success: true, message: "Colonna 'coins' aggiunta correttamente via Vercel Edge/Server." });
    } catch (e: any) {
        console.error("Errore migrazione:", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
