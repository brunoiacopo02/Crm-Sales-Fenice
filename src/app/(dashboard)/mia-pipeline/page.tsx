import { redirect } from "next/navigation"
import { getSalesPipelineLeads, requireSalesPipelineUser } from "@/app/actions/salesPipelineActions"
import MiaPipelineClient from "./MiaPipelineClient"

export default async function MiaPipelinePage() {
    const me = await requireSalesPipelineUser()
    if (!me) redirect("/")

    const { firstCall, secondCall, thirdCall, recalls } = await getSalesPipelineLeads()

    return (
        <div className="min-h-screen bg-ash-50/50 p-4 sm:p-6 lg:p-8">
            <MiaPipelineClient
                firstCall={firstCall}
                secondCall={secondCall}
                thirdCall={thirdCall}
                recalls={recalls}
            />
        </div>
    )
}
