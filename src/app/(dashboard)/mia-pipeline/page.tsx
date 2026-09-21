import { redirect } from "next/navigation"
import {
    getSalesPipelineLeads,
    getSalesSelfAppointments,
    requireSalesPipelineUser,
} from "@/app/actions/salesPipelineActions"
import MiaPipelineClient from "./MiaPipelineClient"

export default async function MiaPipelinePage() {
    const me = await requireSalesPipelineUser()
    if (!me) redirect("/")

    const [{ firstCall, secondCall, thirdCall, recalls }, appointments] = await Promise.all([
        getSalesPipelineLeads(),
        getSalesSelfAppointments(),
    ])

    return (
        <div className="min-h-screen bg-ash-50/50 p-4 sm:p-6 lg:p-8">
            <MiaPipelineClient
                firstCall={firstCall}
                secondCall={secondCall}
                thirdCall={thirdCall}
                recalls={recalls}
                appointments={appointments.map(a => ({
                    id: a.id,
                    name: a.name,
                    phone: a.phone,
                    // Serializzato a stringa: fra Server Component e Client
                    // Component i `Date` passano, ma tornano indietro come
                    // stringhe e il tipo mentirebbe.
                    appointmentDate: a.appointmentDate.toISOString(),
                    appointmentNote: a.appointmentNote,
                    version: a.version,
                }))}
            />
        </div>
    )
}
