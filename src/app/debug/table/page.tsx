import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"

export default async function DebugTablePage() {
    // Only allow in development mode for safety
    if (process.env.NODE_ENV === "production") {
        redirect("/")
    }

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
        

    return (
        <div className="p-8 font-sans">
            <h1 className="text-2xl font-bold mb-4">Debug Leads Table (Dev Only)</h1>
            <p className="mb-6 text-gray-600">This page bypasses NextAuth so the internal browser module can read the table data.</p>

            <div className="overflow-x-auto shadow-md sm:rounded-lg">
                <table className="w-full text-sm text-left text-gray-500">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Email</th>
                            <th className="px-6 py-3">Phone</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3">Assigned To</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((lead) => (
                            <tr key={lead.id} className="bg-white border-b hover:bg-gray-50">
                                <td className="px-6 py-4 font-medium text-gray-900">{lead.name}</td>
                                <td className="px-6 py-4">{lead.email || '-'}</td>
                                <td className="px-6 py-4">{lead.phone}</td>
                                <td className="px-6 py-4">
                                    <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded">
                                        {lead.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4">{lead.assignedTo || 'Unassigned'}</td>
                            </tr>
                        ))}
                        {data.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-4 text-center">Nessun lead trovato.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
