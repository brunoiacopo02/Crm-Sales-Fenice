"use client"

import { useRouter, usePathname } from "next/navigation"
import { formatMonth } from "./format"

export function MonthSelect({ months, value }: { months: string[]; value: string }) {
    const router = useRouter()
    const pathname = usePathname()
    return (
        <select
            className="rounded-md border border-ash-200 bg-white px-3 py-1.5 text-sm text-ash-800"
            value={value}
            onChange={(e) => router.push(`${pathname}?mese=${e.target.value}`)}
        >
            {months.map(m => <option key={m} value={m}>{formatMonth(m)}</option>)}
        </select>
    )
}
