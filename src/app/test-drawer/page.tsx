"use client"
import { ContactDrawer } from "@/components/ContactDrawer"
import { useState, useEffect } from "react"

export default function TestDrawerPage() {
    const [isOpen, setIsOpen] = useState(false)
    const [leadId, setLeadId] = useState<string | null>(null)

    useEffect(() => {
        // Find a random lead id by calling search
        fetch('/api/test_conferme') // Just to trigger something, or we can hardcode id
    }, [])

    return (
        <div className="p-10">
            <button onClick={() => { setIsOpen(true); setLeadId("mock-id"); }} className="bg-blue-500 text-white p-4">Apri Drawer O finto</button>
            <ContactDrawer isOpen={isOpen} leadId={leadId} onClose={() => setIsOpen(false)} />
        </div>
    )
}
