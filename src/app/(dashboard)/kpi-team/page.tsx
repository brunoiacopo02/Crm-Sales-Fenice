import { redirect } from "next/navigation"

/**
 * /kpi-team è stato unificato in /kpi-gdo (con toggle "Solo ore lavoro
 * 13:30-20:00" e filtro multi-GDO). La pagina ManagerOperativaBoard è
 * stata spostata in /operativa-team. Questo redirect preserva i
 * bookmark vecchi.
 */
export default function KpiTeamPage() {
    redirect("/kpi-gdo")
}
