import { AssignmentMode } from "@/app/actions/importLeads"

export function previewLeadDistribution(validCount: number, activeGdos: any[], mode: AssignmentMode, customSettings: Record<string, number>) {
    const distribution: Record<string, { count: number, name: string }> = {}
    activeGdos.forEach(g => distribution[g.id] = { count: 0, name: g.displayName || g.name })

    if (activeGdos.length === 0) return distribution

    if (mode === 'equal') {
        let currentGdoIndex = 0
        for (let i = 0; i < validCount; i++) {
            const gdo = activeGdos[currentGdoIndex]
            distribution[gdo.id].count++
            currentGdoIndex = (currentGdoIndex + 1) % activeGdos.length
        }
    } else if (mode === 'custom_quota') {
        let remaining = validCount
        const quotas = activeGdos.map(gdo => ({ id: gdo.id, q: customSettings[gdo.id] || 0 }))

        // Fase 1: Riempi le quote fino a capienza
        for (const qt of quotas) {
            if (remaining <= 0) break
            const assignable = Math.min(qt.q, remaining)
            distribution[qt.id].count += assignable
            remaining -= assignable
        }

        // Fase 2: Se avanzano lead e tutti hanno raggiunto la quota, fallback Round-Robin
        if (remaining > 0) {
            let currentGdoIndex = 0
            for (let i = 0; i < remaining; i++) {
                const gdo = activeGdos[currentGdoIndex]
                distribution[gdo.id].count++
                currentGdoIndex = (currentGdoIndex + 1) % activeGdos.length
            }
        }
    }

    return distribution
}
