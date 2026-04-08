"use client"
import { PipelineBoard } from "@/components/PipelineBoard"
import React from 'react'
import { createRoot } from 'react-dom/client'

const mockLeads = [
    {
        id: "mock1",
        name: "Test Mario Rossi",
        phone: "3331234567",
        email: "mario@example.com",
        funnel: "Facebook",
        callCount: 1,
        lastCallDate: "2026-04-04T10:00:00.000Z",
        status: "IN_PROGRESS",
        recallDate: null,
        appointmentDate: null
    }
];

export default function TestHydration() {
    return (
        <div>
            <h2>Test Render</h2>
            <PipelineBoard
                firstCall={[]}
                secondCall={mockLeads}
                thirdCall={[]}
                fourthCall={[]}
                isFourthCallActive={false}
                recalls={[]}
            />
        </div>
    )
}
