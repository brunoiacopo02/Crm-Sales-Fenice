"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads } from "@/db/schema"
import { eq, asc, desc, and } from "drizzle-orm"
export async function getAppointments() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    const conditions = [
        eq(leads.status, 'APPOINTMENT')
    ]
    if (isGdo) conditions.push(eq(leads.assignedToId, userId))

    // Fetch only leads with status = APPOINTMENT
    const allAppointments = await db.select()
            .from(leads)
            .where(and(...conditions))
            .orderBy(desc(leads.appointmentCreatedAt)) // default order by newest booked
        

    const now = new Date()

    // We can split them into Upcoming and Past
    const upcoming = allAppointments.filter(l => l.appointmentDate && l.appointmentDate >= now)
    const past = allAppointments.filter(l => l.appointmentDate && l.appointmentDate < now)

    // Sort upcoming by appointmentDate ascending (closest first)
    upcoming.sort((a, b) => {
        if (!a.appointmentDate || !b.appointmentDate) return 0
        return a.appointmentDate.getTime() - b.appointmentDate.getTime()
    })

    // Sort past by appointmentDate descending (most recent first)
    past.sort((a, b) => {
        if (!a.appointmentDate || !b.appointmentDate) return 0
        return b.appointmentDate.getTime() - a.appointmentDate.getTime()
    })

    return { upcoming, past }
}
