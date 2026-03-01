"use server"

import { db } from "@/db"
import { leads } from "@/db/schema"
import { or, like, desc } from "drizzle-orm"

export type SearchResult = {
    id: string
    name: string
    phone: string
    email: string | null
    statusLabel: string
    statusColor: string
}

export async function searchLeads(query: string): Promise<SearchResult[]> {
    if (!query || query.trim().length < 2) return []

    const searchTerm = `%${query.trim()}%`

    const results = await db.select()
            .from(leads)
            .where(
                or(
                    like(leads.name, searchTerm),
                    like(leads.phone, searchTerm),
                    like(leads.email, searchTerm)
                )
            )
            .orderBy(desc(leads.updatedAt))
            .limit(10)
        

    const mappedResults = results.map(lead => {
        let statusLabel = ""
        let statusColor = ""

        if (lead.status === 'REJECTED') {
            statusLabel = "Da Scartare"
            statusColor = "bg-red-100 text-red-700"
        }
        else if (lead.status === 'APPOINTMENT') {
            statusLabel = "Appuntamento"
            statusColor = "bg-green-100 text-green-700"
        }
        else if (lead.recallDate) {
            statusLabel = "Richiamo"
            statusColor = "bg-blue-100 text-blue-700"
        }
        else {
            // It's in pipeline
            if (lead.callCount === 0) {
                statusLabel = "1ª Chiamata"
                statusColor = "bg-brand-orange text-white"
            } else if (lead.callCount === 1) {
                statusLabel = "2ª Chiamata"
                statusColor = "bg-gray-200 text-gray-700"
            } else {
                statusLabel = "3ª Chiamata"
                statusColor = "bg-gray-200 text-gray-700"
            }
        }

        return {
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            statusLabel,
            statusColor
        }
    })

    return mappedResults
}
