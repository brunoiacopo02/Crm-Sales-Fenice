"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads } from "@/db/schema"
import { eq, and, ne, isNotNull, asc, lte, or } from "drizzle-orm"
export async function getRecallLeads() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    const now = new Date()

    // We fetch leads that:
    // 1. Are NOT REJECTED or APPOINTMENT
    // 2. Have a recallDate set

    const conditions = [
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNotNull(leads.recallDate)
    ]

    if (isGdo) conditions.push(eq(leads.assignedToId, userId))

    const allRecalls = await db.select()
            .from(leads)
            .where(and(...conditions))
            .orderBy(asc(leads.recallDate))
        

    // Split into "Scaduti/Da Fare Ora" and "In Arrivo"
    const expired = allRecalls.filter(l => l.recallDate && l.recallDate <= now)
    const upcoming = allRecalls.filter(l => l.recallDate && l.recallDate > now)

    return { expired, upcoming }
}
