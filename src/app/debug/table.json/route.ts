import { NextResponse } from "next/server"
import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { eq } from "drizzle-orm"

export async function GET() {
    // Only allow in development mode for safety
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Access denied. Development only." }, { status: 403 })
    }

    try {
        // Fetch leads with their assigned user
        const data = await db.select({
                    id: leads.id,
                    name: leads.name,
                    email: leads.email,
                    phone: leads.phone,
                    status: leads.status,
                    assignedTo: users.name
                })
                    .from(leads)
                    .leftJoin(users, eq(leads.assignedToId, users.id))
                    .limit(100)
            

        return NextResponse.json({
            success: true,
            count: data.length,
            leads: data
        })
    } catch (error) {
        console.error("Error fetching debug leads:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
