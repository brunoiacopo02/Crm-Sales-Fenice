import { createClient } from "@/utils/supabase/server"
import { NextResponse } from "next/server";
import { setConfermeOutcome } from "@/app/actions/confermeActions";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { isNull } from "drizzle-orm";

export async function GET() {
    try {
        const pendingAppts = await db.select().from(leads).where(isNull(leads.confirmationsOutcome));
        const freshLead = pendingAppts.find(l => l.appointmentDate !== null);

        if (!freshLead) return NextResponse.json({ error: "Nessun lead disponibile per test" });

        // Bypass auth by temporarily mocking the session in the route or we assume it will fail?
        // Wait, setConfermeOutcome calls `getServerSession` automatically!
        // So a basic GET request will fail with "Unauthorized" unless we're logged in.
        // Let's just catch the Unauthorized to see if the handler works.
        return NextResponse.json({ message: "Ready. Needs Auth" });
    } catch (e: any) {
        return NextResponse.json({ error: e.message, stack: e.stack });
    }
}
