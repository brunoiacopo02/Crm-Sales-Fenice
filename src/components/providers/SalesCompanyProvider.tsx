'use client'
import { createContext, useContext, ReactNode } from 'react'

const SalesCompanyContext = createContext<string>('fenice')

export function SalesCompanyProvider({ company, children }: { company: string; children: ReactNode }) {
    return <SalesCompanyContext.Provider value={company}>{children}</SalesCompanyContext.Provider>
}

/** Azienda sales attiva (es. 'fenice' | 'serenamente'). */
export function useSalesCompany() {
    return useContext(SalesCompanyContext)
}
